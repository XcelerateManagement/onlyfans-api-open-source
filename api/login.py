#!/usr/bin/env python3
"""
OnlyFans login script with Cloudflare Turnstile solving.

This script logs into OnlyFans by:
1. Getting initial cookies from /users/me
2. Fetching x-hash from CDN
3. Solving Cloudflare Turnstile captcha using Solv API
4. Generating proper sign headers using the Node.js generator
5. Making the login request with proxy support
"""

from curl_cffi import requests
from header_generator import generate_headers
from captcha_solver import solve_turnstile
from multi_tenant_auth import REQUEST_TIMEOUT
import json
import base64
import re
import threading
import config

# NB: every network call below passes `timeout=REQUEST_TIMEOUT`. curl_cffi has
# no default timeout, so an omitted one is an unbounded block — see the comment
# on REQUEST_TIMEOUT in multi_tenant_auth for the ~12h hang that established
# this rule. It matters more here than anywhere else: bulk onboarding runs this
# path concurrently from a worker pool, so one hung socket costs a worker, not
# just a request.


# ── OnlyFans login error codes ─────────────────────────────────────────────
# Read off the captured webapp bundle (app.js, axios error interceptor):
#
#   if (101 === d) { const {payload:{otpState, strong}, message} = error;
#                    commit("modals/setOtpState", otpState); ... }
#   if (105 === X()(e,"response.data.error.code")) { ... }   // security check
#
# 101 — first-login 2FA. The user picks a factor (email / sms / app) and types
#       a code. Recoverable with `verify_otp` below.
# 105 — on-the-fly *security check*, which on many accounts is face id. It is
#       resolved over `wss://ws2.onlyfans.com/ws2/`, NOT by submitting a code
#       (see FACE_ID_LOGIN_RESEARCH.md). There is deliberately no code path
#       here that pretends otherwise — 105 is terminal for the password flow.
# 102 — wrong/absent captcha (handled inline in login()).
OF_ERROR_CAPTCHA_WRONG = 102
OF_ERROR_2FA_REQUIRED = 101
OF_ERROR_SECURITY_CHECK = 105

FACE_ID_MESSAGE = (
    'OnlyFans requires a face (selfie) verification for this account. No typed '
    'code can clear it — a human has to pass a liveness check at OnlyFans\' '
    'identity provider, from the same IP this account uses. Start it from the '
    'dashboard (Verify account) or POST to '
    '/accounts/<of_user_id>/face-id/start.'
)


# ── Which endpoint accepts a submitted OTP code ────────────────────────────
# UNRESOLVED at the time of writing, so this is a fallback chain rather than a
# constant. Evidence for each candidate:
#
#   /api2/v2/users/otp/check   — present in the captured bundle as
#       `y = e => r.Ay.post(`${r.XV}/users/otp/check`, e)` (app.js), exported
#       as `i6`, and listed as POST in of-scripts/endpoints.json. No call site
#       is visible because the OTP modal lives in a lazily-loaded chunk we did
#       not capture, so the *body* shape is inferred, not observed.
#   /api2/v2/users/verify-code — claimed by FACE_ID_LOGIN_RESEARCH.md:171. It
#       appears in NO captured artifact: not app.js, not the deobfuscated
#       bundle, not the 494-path endpoints.json. Kept only as a cheap second
#       guess.
#
# First candidate that does not answer 404/405 wins and is remembered for the
# life of the process, so the unknown costs one extra request once — never a
# redesign. The `[verify_otp] OTP endpoint confirmed:` log line below is how
# this question gets settled from production traffic.
OTP_ENDPOINT_CANDIDATES = (
    '/api2/v2/users/otp/check',
    '/api2/v2/users/verify-code',
)
# HTTP statuses that mean "wrong URL", not "wrong code".
_OTP_ENDPOINT_MISS_STATUSES = (404, 405)

_otp_endpoint_lock = threading.Lock()
_confirmed_otp_endpoint = None


def _otp_endpoint_order():
    """Candidates to try, cheapest-first. Once one has answered, it is the only
    one we try again in this process."""
    with _otp_endpoint_lock:
        confirmed = _confirmed_otp_endpoint
    return (confirmed,) if confirmed else tuple(OTP_ENDPOINT_CANDIDATES)


def _remember_otp_endpoint(path):
    global _confirmed_otp_endpoint
    with _otp_endpoint_lock:
        already = _confirmed_otp_endpoint
        _confirmed_otp_endpoint = path
    if already != path:
        # Deliberately loud and greppable — this line is the answer to the one
        # genuine unknown in the 2FA flow.
        print(f'[verify_otp] OTP endpoint confirmed: {path}')


def reset_otp_endpoint_cache():
    """Forget the learned endpoint. Exists for tests and for a live operator who
    wants to re-probe after an OF-side change."""
    global _confirmed_otp_endpoint
    with _otp_endpoint_lock:
        _confirmed_otp_endpoint = None


def _parse_of_error(response):
    """(code, message, payload) out of an OnlyFans error response.

    OF answers failures with {"error": {"code": N, "message": "...",
    "payload": {...}}}. Everything is optional and the body is not always JSON,
    so every field degrades to None rather than raising."""
    try:
        body = response.json()
    except Exception:
        return None, (getattr(response, 'text', '') or '').strip()[:400], None
    if not isinstance(body, dict):
        return None, str(body)[:400], None
    error = body.get('error')
    if not isinstance(error, dict):
        return None, None, None
    payload = error.get('payload')
    return (
        error.get('code'),
        error.get('message'),
        payload if isinstance(payload, dict) else None,
    )


class UpstreamBlockedError(Exception):
    """OnlyFans' Cloudflare refused the login from this egress IP.

    Not a credential verdict and not a transient fault: the same request from
    the same proxy will keep being turned away, so the caller should ask for a
    different proxy. The message is matched as text by other classifiers
    (account_status, transport_errors, account_connect), so it deliberately
    avoids their keywords: "account ... blocked", "proxy", "refused", "(6)"."""

    def __init__(self, blocked_ip=None, ray_id=None):
        self.blocked_ip = blocked_ip
        self.ray_id = ray_id
        where = f' from IP {blocked_ip}' if blocked_ip else ''
        super().__init__(f'Cloudflare on onlyfans.com blocked the login request{where}')


# Markers of Cloudflare's "Sorry, you have been blocked" page (WAF block, as
# opposed to a solvable challenge). Seen on /users/login from a flagged proxy.
_CF_BLOCK_MARKERS = (
    'cf-error-details',
    'sorry, you have been blocked',
    'attention required! | cloudflare',
)
_CF_BLOCK_IP_RE = re.compile(r'id="cf-footer-ip"[^>]*>\s*([0-9a-fA-F:.]+)\s*<')
_CF_RAY_RE = re.compile(r'Ray ID:\s*(?:<[^>]+>\s*)*([0-9a-fA-F]+)')


def _cloudflare_block_info(response):
    """{'blocked_ip', 'ray_id'} if `response` is Cloudflare's block page, else None.

    Only a 403 with a non-JSON body counts — OnlyFans' own 403s are JSON and
    must keep flowing through _parse_of_error."""
    if getattr(response, 'status_code', None) != 403:
        return None
    try:
        response.json()
        return None
    except Exception:
        pass
    text = getattr(response, 'text', '') or ''
    low = text.lower()
    if not any(marker in low for marker in _CF_BLOCK_MARKERS):
        return None
    ip = _CF_BLOCK_IP_RE.search(text)
    ray = _CF_RAY_RE.search(text)
    return {
        'blocked_ip': ip.group(1) if ip else None,
        'ray_id': ray.group(1) if ray else None,
    }


def _otp_methods(otp_state):
    """Factor names OF says are available, in the order a UI should offer them.

    otpState is the flag bag OF sends with error 101/105:
    {email, phoneOtp, appOtp, faceOtp, forceFaceOtp, phoneLast4, ...}."""
    if not isinstance(otp_state, dict):
        return []
    order = (('email', 'email'), ('phoneOtp', 'sms'),
             ('appOtp', 'app'), ('faceOtp', 'face'))
    return [name for key, name in order if otp_state.get(key)]


def _pre_auth_headers(path, x_bc, x_hash=None, with_body=False):
    """Signed headers for a call made before the session is authenticated.

    Signatures are time-bound, so this is called fresh per attempt — never
    cached, never reused across a retry. `user_id=0` matches what the login
    call itself signs with; the account is not authenticated yet."""
    sign_headers = generate_headers(path, user_id=0)
    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'app-token': sign_headers['app-token'],
        'priority': 'u=1, i',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sign': sign_headers['sign'],
        'time': sign_headers['time'],
        # The x-bc established by the login that triggered the 2FA prompt. A
        # fresh one invalidates the pending challenge, so it is threaded through
        # untouched — never regenerated from sign_headers['x-bc'].
        'x-bc': x_bc,
        'x-of-rev': config.X_OF_REV,
        'referer': 'https://onlyfans.com/',
        'user-agent': config.USER_AGENT,
    }
    if x_hash:
        headers['x-hash'] = x_hash
    if with_body:
        headers['content-type'] = 'application/json'
    return headers


def login(email, password, use_captcha=True, proxy=None, captcha_api_key=None):
    """
    Login to OnlyFans.

    Args:
        email (str): Your OnlyFans email
        password (str): Your OnlyFans password
        use_captcha (bool): Whether to solve Turnstile captcha (default: True)
        proxy (str, optional): Proxy URL (e.g., 'http://user:pass@host:port')

    Returns:
        dict: Response data including cookies and user info

    Raises:
        Exception: If login fails
    """
    print('=== OnlyFans Login ===')
    print(f'Email: {email}')
    if proxy:
        print(f'Proxy: {proxy[:30]}...')
    print()

    # Create session with Chrome 136 impersonation and optional proxy
    session = requests.Session(impersonate="chrome136")
    if proxy:
        session.proxies = {
            'http': proxy,
            'https': proxy
        }

    # Step 0: Get initial cookies from /users/me
    print('Step 0: Getting initial cookies from OnlyFans...')
    me_path = '/api2/v2/users/me'
    me_sign_headers = generate_headers(me_path, user_id=0)

    # Store x-bc to be reused throughout the session
    x_bc = me_sign_headers['x-bc']
    print(f'Using x-bc for this session: {x_bc[:20]}...')

    me_headers = {
        'host': 'onlyfans.com',
        'connection': 'keep-alive',
        'x-of-rev': config.X_OF_REV,
        'sec-ch-ua-platform': '"Windows"',
        'x-bc': x_bc,  # Use the same x-bc throughout
        'sign': me_sign_headers['sign'],
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'app-token': me_sign_headers['app-token'],
        'time': me_sign_headers['time'],
        'user-agent': config.USER_AGENT,
        'accept': 'application/json, text/plain, */*',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://onlyfans.com/',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9'
    }

    me_url = f'{config.OF_BASE_URL}{me_path}'
    me_response = session.get(me_url, headers=me_headers, timeout=REQUEST_TIMEOUT)

    print(f'Initial /me response: {me_response.status_code}')
    print(f'Cookies received: {list(session.cookies.keys())}')

    # Step 0.5: Fetch x-hash from CDN
    print('Step 0.5: Fetching x-hash from OnlyFans CDN...')
    hash_url = 'https://cdn2.onlyfans.com/hash/'
    hash_headers = {
        'host': 'cdn2.onlyfans.com',
        'connection': 'keep-alive',
        'sec-ch-ua-platform': '"Windows"',
        'user-agent': config.USER_AGENT,
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'accept': '*/*',
        'origin': 'https://onlyfans.com',
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://onlyfans.com/',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9'
    }
    hash_response = session.get(hash_url, headers=hash_headers, params={'u': '0'}, timeout=REQUEST_TIMEOUT)

    x_hash = None
    if hash_response.status_code == 200:
        x_hash = hash_response.text.strip()
        print(f'x-hash fetched: {x_hash[:20]}...')
    else:
        print(f'Warning: Failed to fetch x-hash (status {hash_response.status_code})')
    print()

    # Step 1: Solve invisible captcha first
    turnstile_token = None
    if use_captcha:
        if not (captcha_api_key or config.TWOCAPTCHA_API_KEY):
            # The one prerequisite the software cannot supply for itself. Say so
            # plainly here rather than failing somewhere deep in the login flow.
            raise RuntimeError(
                'No captcha provider key is configured, and OnlyFans will not '
                'accept a login without one. Add a 2captcha key in the panel '
                'under Settings -> Captcha provider, or set TWOCAPTCHA_API_KEY '
                'in .env and restart. Get a key at https://2captcha.com/ and '
                'add a few dollars of credit - each login costs one solve.'
            )
        print('Step 1: Solving Turnstile invisible captcha...')
        try:
            turnstile_token = solve_turnstile(
                api_key=captcha_api_key or config.TWOCAPTCHA_API_KEY,
                site_url='https://onlyfans.com/',
                sitekey=config.TURNSTILE_SITEKEY,
                action=config.TURNSTILE_ACTION,
                user_agent=config.USER_AGENT,
                max_wait=120,
                poll_interval=5
            )
            print('Invisible captcha solved!')
            print()
        except Exception as e:
            print(f'Invisible captcha solving failed: {e}')
            raise Exception(f'Captcha solving failed: {e}')

    # Step 2: Generate sign headers and build request
    print('Step 2: Preparing login request...')
    path = '/api2/v2/users/login'
    sign_headers = generate_headers(path, user_id=0)
    encoded_password = base64.b64encode(password.encode()).decode()

    body = {
        'email': email,
        'encodedPassword': encoded_password
    }

    if turnstile_token:
        body['turnstile-invisible-response'] = turnstile_token

    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'app-token': sign_headers['app-token'],
        'content-type': 'application/json',
        'priority': 'u=1, i',
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'x-bc': x_bc,  # Use the same x-bc throughout the session
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'sign': sign_headers['sign'],
        'time': sign_headers['time'],
        'x-of-rev': config.X_OF_REV,
        'referer': 'https://onlyfans.com/',
        'user-agent': config.USER_AGENT
    }

    # Add x-hash if we have it
    if x_hash:
        headers['x-hash'] = x_hash

    # Step 3: Make first login attempt
    print('Step 3: Sending login request...')
    url = f'{config.OF_BASE_URL}/api2/v2/users/login'
    response = session.post(url, headers=headers, json=body, timeout=REQUEST_TIMEOUT)

    print(f'First login attempt status: {response.status_code}')
    print()

    # Step 4: If captcha wrong, solve managed captcha and retry
    if response.status_code == 400:
        try:
            error_data = response.json()
            error_code = error_data.get('error', {}).get('code')
            if error_code == 102:  # Captcha wrong
                print('Captcha wrong - solving managed captcha...')

                turnstile_managed_token = solve_turnstile(
                    api_key=captcha_api_key or config.TWOCAPTCHA_API_KEY,
                    site_url='https://onlyfans.com/',
                    sitekey=config.TURNSTILE_SITEKEY_MANAGED,
                    action=config.TURNSTILE_ACTION,
                    user_agent=config.USER_AGENT,
                    max_wait=120,
                    poll_interval=5
                )
                print('Managed captcha solved!')

                # Re-generate sign headers with new timestamp
                sign_headers = generate_headers(path, user_id=0)

                # Add managed captcha to body
                body['turnstile-managed-response'] = turnstile_managed_token

                # Update headers with new sign and time
                headers['sign'] = sign_headers['sign']
                headers['time'] = sign_headers['time']
                headers['app-token'] = sign_headers['app-token']

                # Retry login
                print('Retrying login with both captchas...')
                response = session.post(url, headers=headers, json=body, timeout=REQUEST_TIMEOUT)
                print(f'Second login attempt status: {response.status_code}')
                print()
        except:
            pass

    # Step 5: Check final response
    if response.status_code != 200:
        # Cloudflare WAF block on the egress IP. One line, not the whole page.
        block = _cloudflare_block_info(response)
        if block:
            print(f'=== LOGIN BLOCKED BY CLOUDFLARE (403) === ip={block["blocked_ip"]} '
                  f'ray={block["ray_id"]}')
            raise UpstreamBlockedError(block['blocked_ip'], block['ray_id'])

        of_code, of_message, of_payload = _parse_of_error(response)

        # 2FA challenge. NOT a failure — the password was right, OF just wants a
        # second factor. Hand back everything `verify_otp` will need, above all
        # the SAME x-bc and the partial-auth cookies this exchange established.
        if of_code == OF_ERROR_2FA_REQUIRED:
            otp_state = (of_payload or {}).get('otpState') or {}
            cookies_dict = dict(session.cookies)
            print('=== LOGIN REQUIRES 2FA (OnlyFans error 101) ===')
            print(f'otpState: {otp_state}')
            print(f'Available factors: {_otp_methods(otp_state) or "unknown"}')
            print(f'Carrying x-bc into the OTP step: {x_bc[:20]}...')
            return {
                'success': False,
                'status': 'requires_2fa',
                'requires_2fa': True,
                'user_id': None,
                'data': {},
                'otp_state': otp_state,
                'otp_methods': _otp_methods(otp_state),
                'strong': bool((of_payload or {}).get('strong')),
                'message': of_message,
                'cookies': cookies_dict,
                'x_hash': x_hash,
                'x_bc': x_bc,
                'session': session,
            }

        # Face-id / on-the-fly security check. Terminal for the password flow —
        # it is approved over a WebSocket, not with a code. Raised (not
        # returned) so no caller can mistake it for a completed login; the Flask
        # login route turns "Login failed: ..." into a clean 400.
        if of_code == OF_ERROR_SECURITY_CHECK:
            print('=== LOGIN BLOCKED BY SECURITY CHECK (OnlyFans error 105) ===')
            raise Exception(f'Login failed: {FACE_ID_MESSAGE}')

        print('=== LOGIN FAILED ===')
        print(f'Response body: {response.text}')
        error_msg = of_message or response.text
        raise Exception(f'Login failed: {error_msg}')

    data = response.json()
    user_id = str(data.get('userId') or data.get('id'))

    # Get cookies - curl_cffi returns dict-like cookies
    cookies_dict = dict(session.cookies)
    fp_cookie = cookies_dict.get('fp')

    # x-bc is already set at the beginning and should be kept consistent
    # Just log if fp cookie differs from our x-bc
    if fp_cookie:
        if fp_cookie != x_bc:
            print(f'Note: Server set fp cookie ({fp_cookie[:20]}...) differs from our x-bc ({x_bc[:20]}...)')
            print(f'Keeping our original x-bc for consistency')
        else:
            print(f'Server fp cookie matches our x-bc: {x_bc[:20]}...')
    else:
        print(f'No fp cookie set by server. Using our x-bc: {x_bc[:20]}...')

    print('=== LOGIN SUCCESS ===')
    print()
    print(f'User ID: {user_id}')
    if 'name' in data:
        print(f"Name: {data['name']}")
    if 'username' in data:
        print(f"Username: {data['username']}")
    print(f'x-bc: {x_bc}...')
    print(f'x-hash: {x_hash if x_hash else "None"}...')

    print()
    print('=== SESSION DETAILS ===')
    print()
    print('Session Headers:')
    if hasattr(session, 'headers'):
        for header_name, header_value in session.headers.items():
            print(f'  {header_name}: {header_value}')
    else:
        print('  (No persistent session headers)')

    print()
    print('Session Cookies:')
    for name, value in cookies_dict.items():
        print(f'  {name}: {value}')

    return {
        'success': True,
        'status': 'success',
        'user_id': user_id,
        'data': data,
        'cookies': cookies_dict,
        'x_hash': x_hash,
        'x_bc': x_bc,
        'session': session
    }


def _resolve_user(session, x_bc, x_hash, body):
    """(user_id, user_data) after a successful OTP submission.

    `/users/otp/check` may or may not echo the user object. We now know it
    does — it answers `{"userId": <id>}` and nothing else.

    That echo is NOT sufficient to call the login finished. Accepting it is
    what let account 539827124 be stored as connected on 2026-08-09 while
    OnlyFans was refusing every account-scoped call with error 101
    (`forceFaceOtp`): the code was accepted, the id came back, the session was
    written to disk, and the first real request failed. So the echo is only
    used to *know which account we are talking about* — `/users/me` still has
    to answer 200 before this returns a user id, because that 200 is the only
    proof the session is actually usable.

    Returns (None, {}) when the session is not usable; `verify_otp` turns that
    into an `of_rejected` / `face_id_required` failure rather than a save."""
    echoed_id = None
    if isinstance(body, dict):
        echoed_id = body.get('userId') or body.get('id')
        if not echoed_id and isinstance(body.get('user'), dict):
            echoed_id = body['user'].get('id') or body['user'].get('userId')

    me_path = '/api2/v2/users/me'
    me_response = session.get(
        f'{config.OF_BASE_URL}{me_path}',
        headers=_pre_auth_headers(me_path, x_bc, x_hash),
        timeout=REQUEST_TIMEOUT,
    )
    if me_response.status_code != 200:
        # Distinguish "OF wants a face check" from a generic failure — the
        # caller reports them differently and only one of them is worth a retry.
        # Imported here, not at module scope: of_client imports this module for
        # attempt_relogin, so a top-level import would be a cycle.
        import of_client
        _code, _msg, payload = _parse_of_error(me_response)
        challenge = of_client.parse_otp_challenge(
            {'error': {'code': _code, 'payload': payload}}) if _code else None
        if challenge:
            print(f'[verify_otp] code accepted for {echoed_id or "?"} but OF '
                  f'still gates /users/me: code={_code} '
                  f'methods={challenge["methods"]}')
        return None, {}, challenge
    try:
        me_data = me_response.json()
    except Exception:
        return None, {}, None
    if not isinstance(me_data, dict):
        return None, {}, None
    user_id = me_data.get('id') or me_data.get('userId')
    return (str(user_id) if user_id else None), me_data, None


def _otp_failure(status, error, retryable, **extra):
    payload = {
        'success': False,
        'status': status,
        'error': error,
        'retryable': retryable,
        'user_id': None,
        'data': {},
    }
    payload.update(extra)
    return payload


def verify_otp(email, otp_code, x_bc, x_hash, cookies, proxy=None):
    """Submit the 2FA code for a login that came back with OnlyFans error 101.

    Signature is fixed by the existing call site in
    crm_api.verify_otp_account() — keyword args only, do not reorder or rename.

    Args:
        email (str):    account the code belongs to (logging/correlation only —
                        OF identifies the pending challenge by the cookies).
        otp_code (str): the code the user typed.
        x_bc (str):     the x-bc minted by the login that raised the challenge.
                        MUST be the same value; a fresh one invalidates the
                        pending 2FA session on OF's side.
        x_hash (str):   x-hash from the same login (may be None).
        cookies (dict): cookies from the same login — they carry the partial
                        auth state that makes the code meaningful.
        proxy (str):    same egress the login used, or None for direct.

    Returns:
        dict — never raises for an OF-side rejection. On success the shape is
        the SAME as login()'s, because both feed
        mt_auth.save_session(crm_id, result['user_id'], result, ...):

            {'success': True, 'status': 'success', 'user_id', 'data',
             'cookies', 'x_hash', 'x_bc', 'session', 'otp_endpoint'}

        On failure: {'success': False, 'status': <see below>, 'error': str,
                     'retryable': bool, 'user_id': None, 'data': {}}

        statuses: invalid_code | code_expired | face_id_required |
                  session_expired | of_rejected | endpoint_not_found |
                  proxy_blocked | transport_error
    """
    print('=== OnlyFans OTP Verification ===')
    print(f'Email: {email}')
    if proxy:
        print(f'Proxy: {proxy[:30]}...')
    if not x_bc:
        return _otp_failure(
            'session_expired',
            'The stored 2FA session has no x-bc, so the pending challenge cannot '
            'be identified. Start the login again.',
            False,
        )

    # Rebuild the browser context the login left behind: same impersonation,
    # same proxy, same cookies. x-bc is threaded through untouched.
    session = requests.Session(impersonate='chrome136')
    if proxy:
        session.proxies = {'http': proxy, 'https': proxy}
    for name, value in (cookies or {}).items():
        if value:
            session.cookies.set(name, value, domain='.onlyfans.com', path='/')

    body = {'code': str(otp_code)}
    last_miss = None

    for path in _otp_endpoint_order():
        url = f'{config.OF_BASE_URL}{path}'
        # Fresh signature per attempt — `time` is part of what is signed, so a
        # header set reused across the fallback would be rejected on its own.
        headers = _pre_auth_headers(path, x_bc, x_hash, with_body=True)
        try:
            response = session.post(url, headers=headers, json=body,
                                    timeout=REQUEST_TIMEOUT)
        except Exception as exc:
            # Transport/proxy failure. The code itself is untouched and the
            # parked 2FA session is still valid, so this is worth retrying.
            # Never echo `exc` to the caller: curl's text can carry the proxy's
            # user:pass. Imported here — of_client imports this module.
            print(f'[verify_otp] transport failure on {path}: {exc}')
            try:
                from of_client import translate_transport_error
                detail, _reason = translate_transport_error(exc)
            except Exception:
                detail = None
            return _otp_failure(
                'transport_error',
                detail or 'Could not reach OnlyFans to verify the code.',
                True,
            )

        print(f'[verify_otp] POST {path} -> {response.status_code}')

        # Cloudflare turned the proxy's IP away. The parked challenge cannot be
        # finished from another IP, so this is terminal for this attempt —
        # checked before the 401/403 branch below would call it an expired
        # session, and before the endpoint is remembered (nothing was learned).
        block = _cloudflare_block_info(response)
        if block:
            print(f'[verify_otp] blocked by Cloudflare on {path}: '
                  f'ip={block["blocked_ip"]} ray={block["ray_id"]}')
            return _otp_failure(
                'proxy_blocked',
                str(UpstreamBlockedError(block['blocked_ip'], block['ray_id'])),
                False,
                blocked_ip=block['blocked_ip'],
                ray_id=block['ray_id'],
            )

        if response.status_code in _OTP_ENDPOINT_MISS_STATUSES:
            # Wrong URL, not a wrong code — try the next candidate.
            last_miss = (path, response.status_code)
            continue

        # This endpoint exists. Lock it in even if the code was wrong, so a
        # retype does not re-probe.
        _remember_otp_endpoint(path)

        if response.status_code == 200:
            try:
                data = response.json()
            except Exception:
                data = {}
            user_id, user_data, challenge = _resolve_user(
                session, x_bc, x_hash, data)
            if challenge and challenge['face_required']:
                return _otp_failure(
                    'face_id_required', FACE_ID_MESSAGE, False,
                    otp_state=challenge['otp_state'],
                    otp_endpoint=path,
                )
            if not user_id:
                return _otp_failure(
                    'of_rejected',
                    'OnlyFans accepted the code but will not answer for this '
                    'account yet. Try connecting it again.',
                    True,
                    otp_endpoint=path,
                )
            print(f'=== OTP VERIFIED === user_id={user_id} via {path}')
            return {
                'success': True,
                'status': 'success',
                'user_id': user_id,
                'data': user_data,
                'cookies': dict(session.cookies),
                'x_hash': x_hash,
                'x_bc': x_bc,          # unchanged, end to end
                'session': session,
                'otp_endpoint': path,
            }

        of_code, of_message, of_payload = _parse_of_error(response)
        message = of_message or f'OnlyFans rejected the code (HTTP {response.status_code}).'
        low = (of_message or '').lower()

        if of_code == OF_ERROR_SECURITY_CHECK:
            # Terminal. Not a code problem and not retryable — see FACE_ID_MESSAGE.
            return _otp_failure(
                'face_id_required', FACE_ID_MESSAGE, False,
                otp_state=(of_payload or {}).get('otpState') or {},
                otp_endpoint=path,
            )

        if of_code == OF_ERROR_2FA_REQUIRED:
            # We just answered a 101 and got another one back: the code was not
            # accepted. Treating this as a fresh challenge would loop forever.
            return _otp_failure(
                'invalid_code',
                'That code was not accepted by OnlyFans. Check the newest code and try again.',
                True,
                otp_endpoint=path,
            )

        if 'expire' in low:
            return _otp_failure(
                'code_expired',
                'That code has expired. Start the login again to get a new one.',
                False,
                otp_endpoint=path,
            )

        if response.status_code in (401, 403) or 'access denied' in low:
            return _otp_failure(
                'session_expired',
                'The pending 2FA session is no longer valid on OnlyFans. Log in again.',
                False,
                otp_endpoint=path,
            )

        if response.status_code == 400:
            return _otp_failure('invalid_code', message, True, otp_endpoint=path)

        return _otp_failure('of_rejected', message, True,
                            otp_endpoint=path, http_status=response.status_code)

    # Every candidate 404'd. Nothing is retryable about that — it is our bug or
    # an OF-side rename, not the user's code.
    tried = ', '.join(_otp_endpoint_order())
    print(f'[verify_otp] no OTP endpoint answered. Tried: {tried} (last: {last_miss})')
    return _otp_failure(
        'endpoint_not_found',
        f'No OnlyFans OTP endpoint accepted the request (tried {tried}). '
        'The OnlyFans API path has probably changed.',
        False,
    )


if __name__ == '__main__':
    import os
    import getpass
    
    print('=== OnlyFans Login (Interactive) ===')
    print()
    
    # Get credentials from environment variables or prompt
    email = os.environ.get('OF_EMAIL')
    password = os.environ.get('OF_PASSWORD')
    
    if not email:
        email = input('Email: ').strip()
    else:
        print(f'Using email from environment: {email}')
    
    if not password:
        password = getpass.getpass('Password: ')
    else:
        print('Using password from environment variable')
    
    if not email or not password:
        print('Error: Email and password are required')
        exit(1)
    
    try:
        result = login(email, password, use_captcha=True)

        # Save session for later use
        from auth_persistence import save_session
        save_session(result['user_id'], result)

        print()
        print('Session saved! You can now use the session and cookies for authenticated requests!')

    except Exception as e:
        print()
        print(f'Error: {e}')
        exit(1)
