#!/usr/bin/env python3
"""Headless account-connect primitives for the bulk importer.

``crm_api``'s four login routes each do the same three things inline — talk to
the platform, save the session, write the ``of_accounts`` row — wrapped in
request parsing and ``jsonify``. The importer needs the middle part with no
Flask around it, 600 times, from a worker thread.

Each function here returns a plain result dict rather than a Response::

    {'status': 'success',   'of_user_id', 'username', 'email', 'platform'}
    {'status': 'needs_2fa', 'otp_state', 'x_bc', 'x_hash', 'cookies', 'twofa_type'}
    {'status': 'failed',    'error', 'reason', 'permanent': bool}

**Scope note.** The routes still carry their own copies of this logic; this
module is used only by ``import_runner``. Rewriting the routes to call it would
be the right cleanup, but doing it in the same change as the importer would put
every existing single-account login flow at risk for no importer benefit. The
two are behaviourally aligned today — most importantly both go through
``mt_auth.save_session`` and ``db.add_of_account`` — and any divergence is a
bug in this file.

Nothing here decides POLICY: no slot checks, no dedup, no retry, no rate limit.
The runner owns all of that, because those decisions are per-row and per-job.
"""

from __future__ import annotations

import logging

import config
import crm_database as db
import login as login_module
import multi_tenant_auth as mt_auth
import of_client

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Failure classification — the part with a money cost
# ---------------------------------------------------------------------------

# Phrases OnlyFans/Fansly use when the ACCOUNT is the problem. A row that hits
# one of these is terminal on the first attempt: retrying a credential the
# platform has already rejected buys nothing and adds authentication failures
# to an account the platform is, by definition, already watching.
_PERMANENT_NEEDLES = (
    'wrong email or password',
    'invalid credentials',
    'account is disabled',
    'account has been deleted',
    'account not found',
    'user not found',
    'too many login attempts',   # backing off IS the correct response
    'account is blocked',
    'banned',
)

# 2FA is not a failure at all — it is a state.
_TWO_FA_NEEDLES = (
    'two-factor', 'two factor', '2fa', 'otp', 'one-time',
    'verification code', 'authenticator',
)


def classify_failure(exc_or_text):
    """(reason, permanent, message) for a failed connect attempt.

    Order matters. Transport failures are checked FIRST via the shared
    ``of_client.translate_transport_error`` / ``transport_errors`` classifier,
    because a dead proxy produces a 407 that says nothing about the credential
    — calling that permanent would abandon a perfectly good account, and
    calling a rejected password transient would spend three more login attempts
    on it. Both mistakes are expensive; they are just expensive in opposite
    directions.
    """
    text = str(exc_or_text or '')

    if isinstance(exc_or_text, BaseException):
        message, reason = of_client.translate_transport_error(exc_or_text)
        if message is not None:
            return reason, False, message

    low = text.lower()
    if 'login failed:' in low:
        text = text.split('Login failed:', 1)[-1].strip() or text
        low = text.lower()

    if any(n in low for n in _TWO_FA_NEEDLES):
        return 'needs_2fa', False, text[:400]

    # of_client owns the canonical credential-rejection test; reuse it so the
    # importer and the relogin circuit breaker can never disagree about what
    # "OnlyFans rejected this password" looks like.
    if of_client._is_credential_rejection(low) or any(n in low for n in _PERMANENT_NEEDLES):
        return 'invalid_credentials', True, text[:400]

    return 'error', False, text[:400]


def looks_like_2fa(exc_or_text):
    reason, _permanent, _msg = classify_failure(exc_or_text)
    return reason == 'needs_2fa'


# ---------------------------------------------------------------------------
# OnlyFans — password
# ---------------------------------------------------------------------------

def of_password_login(email, password, proxy=None, use_captcha=True, captcha_api_key=None):
    """Run a full OF login. Returns a result dict; never raises."""
    try:
        result = login_module.login(email, password,
                                    use_captcha=use_captcha, proxy=proxy,
                                    captcha_api_key=captcha_api_key)
    except Exception as e:
        reason, permanent, message = classify_failure(e)
        if reason == 'needs_2fa':
            # OF surfaced a 2FA demand as a non-200 rather than a structured
            # response. We have no otp_state to park with, so the row parks
            # WITHOUT one and its /otp submission will restart the login. Better
            # a row the operator can act on than a hard failure.
            return {'status': 'needs_2fa', 'otp_state': None, 'x_bc': None,
                    'x_hash': None, 'cookies': None, 'error': message,
                    'twofa_type': 'unknown'}
        return {'status': 'failed', 'error': message, 'reason': reason,
                'permanent': permanent}

    # Structured 2FA challenge (what login() returns once the concurrent 2FA
    # repair lands). Handled defensively so this works either way.
    if result.get('requires_2fa'):
        return {
            'status': 'needs_2fa',
            'otp_state': result.get('otp_state'),
            'x_bc': result.get('x_bc'),
            'x_hash': result.get('x_hash'),
            'cookies': result.get('cookies') or {},
            'twofa_type': result.get('twofa_type') or 'totp',
        }

    return {'status': 'authenticated', 'session': result}


def of_verify_otp(email, otp_code, x_bc, x_hash, cookies, proxy=None):
    """Complete an OF 2FA challenge.

    ``login.verify_otp`` is being written by a concurrent change. Until it
    lands the attribute does not exist, and a bulk import must not 500 over
    that — the row goes back to `needs_2fa` and the operator can try again once
    the capability ships.
    """
    verify = getattr(login_module, 'verify_otp', None)
    if verify is None:
        return {'status': 'needs_2fa', 'error':
                'OnlyFans 2FA verification is not available on this build yet — '
                'the code was not submitted. The row stays parked.',
                'reason': 'verify_otp_unavailable'}
    try:
        result = verify(email=email, otp_code=otp_code, x_bc=x_bc,
                        x_hash=x_hash, cookies=cookies, proxy=proxy)
    except Exception as e:
        reason, permanent, message = classify_failure(e)
        return {'status': 'failed', 'error': message, 'reason': reason,
                'permanent': permanent}
    if not result or not result.get('user_id'):
        return {'status': 'failed', 'error': 'OTP verification returned no session',
                'reason': 'error', 'permanent': False}
    return {'status': 'authenticated', 'session': result}


# ---------------------------------------------------------------------------
# OnlyFans — session cookies
# ---------------------------------------------------------------------------

def of_cookie_connect(sess, auth_id, fp=None, proxy=None):
    """Validate a pasted OF session and build a session_data dict.

    Mirrors ``crm_api.login_with_cookies`` minus its debug printing — which is
    not a stylistic choice: that route prints every cookie value, and doing so
    600 times would put 600 live session tokens in the journal.
    """
    from curl_cffi import requests as curl_requests
    from header_generator import generate_headers

    try:
        session = curl_requests.Session(impersonate='chrome136')
        if proxy:
            session.proxies = {'http': proxy, 'https': proxy}

        # Step 0 — pick up Cloudflare cookies before our own are attached.
        init_path = '/api2/v2/users/me'
        init_sign = generate_headers(init_path, user_id=0)
        x_bc = fp if fp else init_sign['x-bc']
        session.get(f'{config.OF_BASE_URL}{init_path}',
                    headers=_of_headers(init_path, x_bc, init_sign),
                    timeout=mt_auth.REQUEST_TIMEOUT)

        session.cookies.set('sess', sess, domain='.onlyfans.com', path='/')
        session.cookies.set('auth_id', str(auth_id), domain='.onlyfans.com', path='/')
        if fp:
            session.cookies.set('fp', fp, domain='.onlyfans.com', path='/')

        # Step 1 — x-hash from the CDN.
        hash_resp = session.get('https://cdn2.onlyfans.com/hash/',
                                params={'u': str(auth_id)},
                                timeout=mt_auth.REQUEST_TIMEOUT)
        x_hash = hash_resp.text.strip() if hash_resp.status_code == 200 else None

        # Step 2 — prove the session works.
        me_path = '/api2/v2/users/me'
        me_sign = generate_headers(me_path, user_id=0)
        headers = _of_headers(me_path, x_bc, me_sign)
        if x_hash:
            headers['x-hash'] = x_hash
        me_resp = session.get(f'{config.OF_BASE_URL}{me_path}', headers=headers,
                              timeout=mt_auth.REQUEST_TIMEOUT)
    except Exception as e:
        reason, permanent, message = classify_failure(e)
        return {'status': 'failed', 'error': message, 'reason': reason,
                'permanent': permanent}

    if me_resp.status_code != 200:
        # An expired/revoked cookie will never start working again — permanent.
        return {'status': 'failed',
                'error': 'Invalid or expired session cookies',
                'reason': 'invalid_cookies', 'permanent': True}
    try:
        me_data = me_resp.json()
    except Exception:
        return {'status': 'failed', 'error': 'OnlyFans returned a non-JSON profile',
                'reason': 'error', 'permanent': False}
    if me_data.get('error') or not me_data.get('id'):
        return {'status': 'failed', 'error': 'Session did not resolve to a user',
                'reason': 'invalid_cookies', 'permanent': True}

    return {'status': 'authenticated', 'session': {
        'user_id': str(me_data.get('id')),
        'data': me_data,
        'cookies': {'sess': sess, 'auth_id': str(auth_id), 'fp': fp or ''},
        'x_hash': x_hash,
        'x_bc': x_bc,
        'session': session,
    }}


def _of_headers(path, x_bc, sign):
    return {
        'host': 'onlyfans.com',
        'connection': 'keep-alive',
        'x-of-rev': config.X_OF_REV,
        'sec-ch-ua-platform': '"Windows"',
        'x-bc': x_bc,
        'sign': sign['sign'],
        'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
        'sec-ch-ua-mobile': '?0',
        'app-token': sign['app-token'],
        'time': sign['time'],
        'user-agent': config.USER_AGENT,
        'accept': 'application/json, text/plain, */*',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://onlyfans.com/',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9',
    }


# ---------------------------------------------------------------------------
# Fansly
# ---------------------------------------------------------------------------

def fansly_password_login(identifier, password, proxy=None):
    import fansly_login
    try:
        result = fansly_login.login(identifier, password, proxy=proxy)
    except Exception as e:
        reason, permanent, message = classify_failure(e)
        return {'status': 'failed', 'error': message, 'reason': reason,
                'permanent': permanent}
    if result.get('requires_2fa'):
        return {
            'status': 'needs_2fa',
            'otp_state': result.get('twofa_token'),
            'x_bc': result.get('fansly_client_id'),
            'x_hash': None,
            'cookies': result.get('session_cookies') or {},
            'twofa_type': result.get('twofa_type') or 'totp',
        }
    if not result.get('success'):
        # Email-verification gate: a link, not a code. No amount of retrying
        # fixes it — the operator must use an auth token instead.
        return {'status': 'failed',
                'error': result.get('message') or
                         'Fansly requires email verification; import this one with an auth token.',
                'reason': 'requires_verification', 'permanent': True}
    return {'status': 'authenticated', 'session': result, 'fansly': True}


def fansly_verify_otp(twofa_token, code, device_id, cookies=None, proxy=None):
    import fansly_login
    try:
        result = fansly_login.verify_twofa(twofa_token, code, device_id,
                                           session_cookies=cookies, proxy=proxy)
    except Exception as e:
        reason, permanent, message = classify_failure(e)
        return {'status': 'failed', 'error': message, 'reason': reason,
                'permanent': permanent}
    if not result or not result.get('account_id'):
        return {'status': 'failed', 'error': 'Fansly 2FA returned no session',
                'reason': 'error', 'permanent': False}
    return {'status': 'authenticated', 'session': result, 'fansly': True}


def fansly_token_connect(auth_token, fansly_session_id, fansly_client_id=None,
                         proxy=None):
    import fansly_login
    if not fansly_client_id:
        import fansly_header_generator as _fhg
        fansly_client_id = _fhg.generate_device_id()
    if not fansly_session_id:
        # Fansly's own token-paste route demands a session id; without one the
        # signed-header scheme cannot be satisfied.
        return {'status': 'failed',
                'error': 'fansly_session_id is required alongside auth_token',
                'reason': 'missing_field', 'permanent': True}
    try:
        me = fansly_login.fetch_account_me(auth_token, fansly_client_id,
                                           fansly_session_id, None, proxy)
    except Exception as e:
        reason, permanent, message = classify_failure(e)
        return {'status': 'failed', 'error': message, 'reason': reason,
                'permanent': permanent}
    if not me:
        return {'status': 'failed', 'error': 'Invalid or expired Fansly auth token',
                'reason': 'invalid_cookies', 'permanent': True}
    account_id = str(me.get('id') or me.get('accountId') or '')
    if not account_id:
        return {'status': 'failed',
                'error': 'Could not resolve a Fansly account id from the token',
                'reason': 'invalid_cookies', 'permanent': True}
    return {'status': 'authenticated', 'fansly': True, 'me': me, 'session': {
        'account_id': account_id,
        'auth_token': auth_token,
        'fansly_client_id': fansly_client_id,
        'fansly_session_id': fansly_session_id,
        'session_cookies': {},
        'data': me,
    }}


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def persist(crm_id, platform, session, email=None, password=None, proxy=None,
            me=None):
    """Save the session file + the of_accounts row. Returns (of_user_id, username).

    NOTE: `polling_enabled` is left at its column default of 0. That is not an
    oversight — see import_runner's module docstring.
    """
    if platform == 'fansly':
        return _persist_fansly(crm_id, session, email, password, proxy, me)
    return _persist_of(crm_id, session, email, password, proxy)


def _persist_of(crm_id, session, email, password, proxy):
    of_user_id = str(session['user_id'])
    mt_auth.save_session(crm_id, of_user_id, session, proxy=proxy)

    data = session.get('data') or {}
    username = data.get('username')
    avatar = data.get('avatar')
    about = data.get('about')
    if not username:
        # A password login's response can be thin; ask /users/me once.
        try:
            resp = mt_auth.make_authenticated_request(
                session_data=session, path='/api2/v2/users/me', method='GET')
            if resp.status_code == 200:
                me = resp.json()
                username = me.get('username')
                avatar = me.get('avatar')
                about = me.get('about')
        except Exception as e:
            logger.warning('import: profile fetch failed for %s: %s', of_user_id, e)

    db.add_of_account(
        crm_id=crm_id, of_user_id=of_user_id,
        email=email or data.get('email') or '',
        password=password, username=username,
        x_bc=session.get('x_bc'), x_hash=session.get('x_hash'),
        proxy=proxy, avatar=avatar, about=about, platform='onlyfans')
    return of_user_id, username


def _persist_fansly(crm_id, session, email, password, proxy, me):
    import fansly_auth
    import fansly_login
    import fansly_normalize as _fnorm

    account_id = str(session.get('account_id'))
    auth_token = session.get('auth_token')
    device_id = session.get('fansly_client_id')
    session_id = session.get('fansly_session_id')

    fansly_auth.save_session(crm_id, account_id, session, proxy=proxy)

    if me is None:
        try:
            me = fansly_login.fetch_account_me(
                auth_token, device_id, session_id,
                session.get('session_cookies'), proxy)
        except Exception:
            me = None
    src = me or session.get('data') or {}
    username = src.get('username') or src.get('displayName')
    about = src.get('about')
    try:
        avatar = _fnorm._avatar_url(src.get('avatar'))
    except Exception:
        avatar = None

    db.add_of_account(
        crm_id=crm_id, of_user_id=account_id,
        email=email or src.get('email') or '',
        password=password, username=username, proxy=proxy,
        avatar=avatar, about=about, platform='fansly',
        fansly_auth_token=auth_token, fansly_client_id=device_id,
        fansly_session_id=session_id)
    return account_id, username


def notify_slot(crm_id, of_user_id):
    """No-op. The hosted build told a billing dashboard that an account slot
    had been taken; there are no slots in this build. Kept so call sites read
    the same in both."""
    return
