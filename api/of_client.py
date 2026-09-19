#!/usr/bin/env python3
"""Shared OnlyFans API request helpers used by both Flask routes and the
background poller. Handles signed requests, session expiry detection, and
auto-relogin with stored credentials."""

import threading
import time

import crm_database as db
import multi_tenant_auth as mt_auth
import login as login_module
import transport_errors
import account_status
import runtime_readiness

# ── Relogin circuit breaker ────────────────────────────────────────────────
# Every OF login attempt buys a 2captcha solve, so a dead session + an open
# dashboard tab (parallel auto-refetches) must never fan out into parallel
# logins. One lock per account serialises attempts; a fresh success is shared
# with requests that were waiting on the lock; failures set either a DB-backed
# block (credential rejection — never retry until the user reconnects) or an
# in-memory cooldown (transient errors — retry after a pause).
RELOGIN_COOLDOWN_SECONDS = 300
# A success this recent is handed to concurrent/just-behind callers instead of
# logging in again — their "Access denied" came from the pre-refresh session.
RELOGIN_REUSE_WINDOW_SECONDS = 30

_relogin_registry_guard = threading.Lock()
_relogin_locks = {}            # "crm:of_user" -> threading.Lock
_relogin_cooldowns = {}        # "crm:of_user" -> (retry_after_unix_ts, error_message)
_relogin_last_success = {}     # "crm:of_user" -> (unix_ts, session_data)


def _relogin_lock_for(key):
    with _relogin_registry_guard:
        lock = _relogin_locks.get(key)
        if lock is None:
            lock = _relogin_locks[key] = threading.Lock()
        return lock


def _is_credential_rejection(error_text):
    return account_status.classify_terminal_login_failure(error_text) in (
        'invalid_password', 'invalid_credentials')


def _blocked_message(account):
    failure = account_status.login_failure_payload(account)
    reason = (failure or {}).get('message') or 'OnlyFans rejected the saved login details.'
    return f'Automatic login is paused: {reason}'


def _verification_paused_message(account):
    """Why auto re-login is standing down while an identity gate is live.

    The password is right and the cookies may even be fine — the account is
    behind a second factor, so another login just buys a captcha solve and
    lands on the same wall. Point the caller at the thing that actually lifts
    it instead of at "Reconnect"."""
    reason = (account.get('verification_reason')
              or 'OnlyFans asked for a 2FA code before it will answer for this account')
    return (f'{reason.rstrip(".")}. Finish that check to restore the session — '
            'send the code to /accounts/login/verify-otp with this account\'s '
            'email, or complete the face check from the dashboard. Automatic '
            're-login is paused until then.')


_2FA_RELOGIN_REASON = 'OnlyFans asked for a 2FA code to finish the re-login'
_2FA_RELOGIN_MESSAGE = (
    'OnlyFans asked for a 2FA code to finish the re-login. A code has been sent '
    'to the account; submit it to /accounts/login/verify-otp with this account\'s '
    'email to restore the session. Automatic re-login is paused until then.'
)


def _park_2fa_relogin(crm_id, of_user_id, email, password, proxy, result):
    """A background re-login hit a 2FA challenge. Nobody is at a keyboard, so
    the session cannot be completed here — but the challenge is still live for
    a few minutes, so stash its state where the existing verify-otp route can
    find it and stop the poller from buying another captcha solve every five
    minutes forever.

    Returns the error string attempt_relogin should surface."""
    try:
        db.store_2fa_session(
            crm_id=crm_id,
            email=email,
            otp_state=result.get('otp_state') or {},
            x_bc=result.get('x_bc'),
            x_hash=result.get('x_hash'),
            cookies=result.get('cookies') or {},
            proxy=proxy,
            password=password,
        )
    except Exception as exc:
        # Parking is best-effort — the gate below is the part that must happen:
        # it is what stops the next poll from logging in all over again.
        print(f'[attempt_relogin] could not park 2FA session for {email}: {exc}')
    # Verification is not a failed login. Persist it on the dedicated identity
    # gate so the dashboard offers the code/face flow rather than "Reconnect".
    db.set_verification_required(
        crm_id, of_user_id, _2FA_RELOGIN_REASON, result.get('otp_state'))
    return _2FA_RELOGIN_MESSAGE


def is_access_denied(response_data):
    if isinstance(response_data, dict):
        error = response_data.get('error', {})
        if isinstance(error, dict) and error.get('message') == 'Access denied.':
            return True
    return False


# ── OTP / identity challenges ──────────────────────────────────────────────
# A session can be *alive* (cookies valid, signing valid) and still be refused
# by OnlyFans because the account is parked behind a second factor. That comes
# back as an HTTP 400 carrying an error code and an `otpState` flag bag:
#
#   101 — the login-level 2FA gate. A session that never cleared it answers
#         101 on every account-scoped call, not just on /users/login.
#   105 — an on-the-fly security check on an otherwise-authenticated session.
#
# Neither is "Access denied.", so `is_access_denied` above never sees them and
# nothing used to classify them: the raw OF JSON was handed straight to the
# dashboard, which kept rendering the account as Connected. See of_faceid.py
# for the resolution flow.
OF_ERROR_2FA_REQUIRED = 101
OF_ERROR_SECURITY_CHECK = 105
_OTP_CHALLENGE_CODES = (OF_ERROR_2FA_REQUIRED, OF_ERROR_SECURITY_CHECK)

# otpState flag -> the factor name we report. Order is the order a UI should
# offer them in. Mirrors login._otp_methods; kept separate so of_client has no
# import dependency on the login stack (the poller imports this module).
_OTP_FACTOR_FLAGS = (('email', 'email'), ('phoneOtp', 'sms'),
                     ('appOtp', 'app'), ('faceOtp', 'face'))

FACE_ID_REQUIRED_MESSAGE = (
    'OnlyFans requires a face (selfie) verification for this account before it '
    'will answer any API call. Start the check from the dashboard and complete '
    'it in a browser on the same IP as this account\'s proxy.'
)


def parse_otp_challenge(response_data):
    """Classify an OF error body as a second-factor challenge, or None.

    Returns::

        {'code': 101|105,
         'otp_state': {...},        # verbatim, for the UI
         'methods': ['face'],       # factors OF says are available
         'face_required': True}     # face is the ONLY way through

    `face_required` is not simply "faceOtp is set". The webapp's own Vuex
    mutation (build 202608071337-eb45c33904, `modals/setOtpState`) does::

        t.forceFaceOtp && (t = {forceFaceOtp:1, faceOtp:1,
                                email:0, phoneOtp:0, appOtp:0})

    — when OF forces the face factor the client *discards* the email/sms/app
    options even though the payload still advertises them. So `forceFaceOtp`
    means face-only, and offering the operator an email code there would just
    burn one of their three attempts against a gate it cannot open.
    """
    if not isinstance(response_data, dict):
        return None
    error = response_data.get('error')
    if not isinstance(error, dict):
        return None
    code = error.get('code')
    if code not in _OTP_CHALLENGE_CODES:
        return None
    otp_state = error.get('payload')
    otp_state = (otp_state or {}).get('otpState') if isinstance(otp_state, dict) else None
    if not isinstance(otp_state, dict):
        otp_state = {}
    forced = bool(otp_state.get('forceFaceOtp'))
    methods = (['face'] if forced
               else [name for flag, name in _OTP_FACTOR_FLAGS if otp_state.get(flag)])
    return {
        'code': code,
        'otp_state': otp_state,
        'methods': methods,
        'face_required': forced or methods == ['face'],
    }


# kind (transport_errors.classify) -> (user-facing message, reason code).
# Every OF request goes through the account's proxy, so the wording names the
# proxy unconditionally. The reason codes are the contract the dashboard reads
# to offer its inline "fix proxy" flow (xcelerate-company-page/lib/proxy-error.ts) —
# renaming one silently drops that flow back to a dead-end error.
_TRANSPORT_MESSAGES = {
    'auth': ('Proxy authentication failed (407) — the proxy username or password is wrong. '
             'Update the proxy saved on this account and try again.', 'proxy_auth'),
    'reset': ('Connection dropped while routing through the proxy. The proxy may be unstable or '
              'blocking OnlyFans — try again or switch proxy.', 'proxy_reset'),
    'timeout': ('The proxy timed out reaching OnlyFans. It may be overloaded — try again or switch proxy.',
                'proxy_timeout'),
    'dns': ('The proxy host could not be resolved — check the proxy address.', 'proxy_dns'),
    'connection': ('Could not connect to the proxy — it may be offline or the port is wrong.',
                   'proxy_connection'),
    'tls': ('TLS error while routing through the proxy. Try a different proxy.', 'proxy_tls'),
    # Unknown transport-ish failure (still a curl/proxy error). Keep it clean —
    # never echo the raw curl string back to the user.
    'generic': ('Could not reach OnlyFans through the proxy. Check the proxy and try again.',
                'proxy_error'),
}


def translate_transport_error(exc):
    """Map a curl_cffi / transport exception to a clean, actionable (message,
    reason) pair. The OF request goes through the account's proxy, so the most
    common failures are proxy-side (wrong password → 407, dead proxy, timeout).

    Returns (None, None) when the exception does not look like a transport/proxy
    failure, so the caller can re-raise it and let the generic 500 handler take
    over instead of mislabelling a real bug as a proxy error.

    The pattern matching lives in ``transport_errors`` because fansly_client
    needs exactly the same classification with different wording; only the
    message table above is OF-specific.
    """
    kind = transport_errors.classify(exc)
    if kind is None:
        return (None, None)
    return _TRANSPORT_MESSAGES[kind]


def _request_or_translated_error(session_data, path, method, body):
    """Call make_authenticated_request, converting transport/proxy exceptions
    into a clean handle_of_request-style error tuple. Returns the raw response
    on success, or an error tuple ``(False, {...}, status, False)`` on a
    translated transport failure. Re-raises anything that isn't transport."""
    try:
        return mt_auth.make_authenticated_request(session_data, path, method, body)
    except runtime_readiness.SignedJobsPausedError:
        return False, {
            'error': 'OnlyFans synchronization is temporarily paused.',
            'reason': 'sync_blocked',
            'retryable': True,
        }, 409, False
    except runtime_readiness.SignerUnavailableError:
        return False, {
            'error': 'OnlyFans synchronization is temporarily unavailable.',
            'reason': 'sync_blocked',
            'retryable': True,
        }, 503, False
    except Exception as exc:
        message, reason = translate_transport_error(exc)
        if message is None:
            raise
        # This is a customer/account dependency failure, not an API server
        # failure. 424 keeps it actionable as proxy_error without inflating
        # the platform-wide 5xx circuit breaker.
        return False, {'error': message, 'reason': reason}, 424, False


def _record_connection_result(crm_id, of_user_id, result, path=None):
    """Persist a safe non-login state from a handle_of_request result tuple."""
    if not isinstance(result, tuple) or len(result) < 3:
        return
    ok, data, status = result[:3]
    if ok or status == 200:
        # A successful lightweight poll must not erase a partial-sync failure
        # from another surface.  In particular, some accounts can answer
        # /users/me while OnlyFans continues to deny their payout ledger.  The
        # ledger state is cleared only by a successful ledger request.
        account = db.get_of_account(crm_id, of_user_id) or {}
        if (account.get('last_connection_state') == 'temporary_error'
                and account.get('last_connection_error_code') == 'transactions_unavailable'
                and not str(path or '').startswith('/api2/v2/payouts/transactions')):
            return
        db.clear_connection_error(crm_id, of_user_id)
        return
    reason = data.get('reason') if isinstance(data, dict) else None
    if reason == 'sync_blocked':
        state = 'sync_blocked'
    elif str(reason or '').startswith('proxy_'):
        state = 'proxy_error'
    elif status == 429 or reason == 'rate_limited':
        state = 'rate_limited'
    elif status >= 500:
        state = 'temporary_error'
    else:
        return
    db.set_connection_error(crm_id, of_user_id, state, reason or state)


def attempt_relogin(crm_id, of_user_id, proxy=None):
    account = db.get_of_account(crm_id, of_user_id)
    if not account:
        return None, "No account found"
    if account.get('relogin_blocked_at'):
        return None, _blocked_message(account)
    # An identity gate is not a login failure, but it is just as final for an
    # unattended retry: without it this path logs in (and pays for a captcha
    # solve) on every poll, forever, only to be handed the same challenge.
    if account.get('verification_required_at'):
        return None, _verification_paused_message(account)

    email = account.get('email')
    password = account.get('password')
    if not email or not password:
        spec = account_status.LOGIN_FAILURES['missing_credentials']
        db.set_relogin_block(
            crm_id, of_user_id, spec['message'],
            code='missing_credentials', action=spec['action'])
        return None, spec['message']

    key = f'{crm_id}:{of_user_id}'
    lock = _relogin_lock_for(key)
    with lock:
        # Someone else may have just finished while we waited on the lock —
        # honour their outcome instead of piling on with another paid attempt.
        prev = _relogin_last_success.get(key)
        if prev and time.time() - prev[0] < RELOGIN_REUSE_WINDOW_SECONDS:
            return prev[1], None
        cooldown = _relogin_cooldowns.get(key)
        if cooldown and time.time() < cooldown[0]:
            return None, cooldown[1]
        account = db.get_of_account(crm_id, of_user_id)
        if not account:
            return None, "No account found"
        if account.get('relogin_blocked_at'):
            return None, _blocked_message(account)
        if account.get('verification_required_at'):
            return None, _verification_paused_message(account)

        try:
            result = login_module.login(
                email, password, use_captcha=True, proxy=proxy,
                captcha_api_key=db.get_panel_captcha_key(crm_id))
            # login() returns (rather than raises) when OF answers error 101, so
            # a 2FA account lands here with user_id=None. Saving that would write
            # saved_sessions/<crm>/None.json and cache a half-session as if the
            # login had worked — check before touching disk.
            if result.get('requires_2fa') or not result.get('user_id'):
                if result.get('requires_2fa'):
                    return None, _park_2fa_relogin(
                        crm_id, of_user_id, email, password, proxy, result)
                return None, ('OnlyFans returned a login response with no user id; '
                              'the session was not saved.')
            mt_auth.save_session(crm_id, result['user_id'], result, proxy=proxy)
            _relogin_last_success[key] = (time.time(), result)
            _relogin_cooldowns.pop(key, None)
            return result, None
        except Exception as e:
            # Surface a clean proxy/transport message when that's the cause; otherwise
            # fall back to the underlying error (e.g. "Wrong email or password").
            message, _reason = translate_transport_error(e)
            error_text = message or str(e)
            failure_code = account_status.classify_terminal_login_failure(error_text)
            if failure_code:
                spec = account_status.LOGIN_FAILURES[failure_code]
                db.set_relogin_block(
                    crm_id, of_user_id, spec['message'],
                    code=failure_code, action=spec['action'],
                )
                return None, spec['message']
            _relogin_cooldowns[key] = (
                time.time() + RELOGIN_COOLDOWN_SECONDS,
                f'Re-login failed ({error_text}). Automatic retry is paused for a few minutes.'
            )
            return None, error_text


# Accounts this process has already confirmed carry no verification flag.
# Clearing the flag is a DB write and every successful OF call would otherwise
# pay for one, so the write happens at most once per account per process —
# _challenge_error evicts the key when a fresh challenge re-arms the flag.
_verification_guard = threading.Lock()
_verification_clean = set()
# Accounts already reported as challenged, so the SSE fanout fires on the
# transition rather than on every blocked call.
_verification_seen = set()


def _clear_verification_flag(crm_id, of_user_id):
    key = f'{crm_id}:{of_user_id}'
    with _verification_guard:
        if key in _verification_clean:
            return
    try:
        db.clear_verification_required(crm_id, of_user_id)
    except Exception:
        return  # never let bookkeeping break a request that already succeeded
    with _verification_guard:
        _verification_clean.add(key)
        _verification_seen.discard(key)


def challenge_reason_and_message(challenge):
    """(reason, human message) for a parsed OTP challenge.

    `reason` is the contract the dashboard switches on: 'face_id_required' when
    OnlyFans forces a selfie (no code can clear it), 'otp_required' when a code
    factor (app/email/sms) is on offer."""
    face = challenge['face_required']
    if face:
        return 'face_id_required', FACE_ID_REQUIRED_MESSAGE
    return 'otp_required', (
        'OnlyFans wants a 2FA code (%s) before it will answer for this account. '
        'Enter the code from the account\'s authenticator, or request one to its '
        'email/phone, to finish connecting it.'
        % (', '.join(challenge['methods']) or 'unknown'))


def flag_verification_required(crm_id, of_user_id, challenge):
    """Record that an account is behind a 2FA/verification gate and tell the
    dashboard, at most once per transition.

    Shared by handle_of_request (a live call hit 101/105) and the login route (a
    fresh login came back already gated), so both arrive at the identical DB
    flag + SSE event. Returns (reason, message) for the caller to surface."""
    key = f'{crm_id}:{of_user_id}'
    with _verification_guard:
        first_seen = key not in _verification_seen
        _verification_clean.discard(key)
        _verification_seen.add(key)
    reason, message = challenge_reason_and_message(challenge)
    try:
        db.set_verification_required(crm_id, of_user_id, message,
                                     challenge['otp_state'])
    except Exception:
        pass
    if first_seen:
        _broadcast_verification_required(crm_id, of_user_id, reason, challenge)
    return reason, message


def mark_verified(crm_id, of_user_id):
    """Force-clear an account's verification gate after a code/selfie cleared
    it, and tell the dashboard. Unlike _clear_verification_flag (which is a
    lazy, once-per-process side effect of a 200), this is the explicit "the
    operator just resolved it" transition, so it always writes and always
    broadcasts `verification.approved`."""
    key = f'{crm_id}:{of_user_id}'
    try:
        db.clear_verification_required(crm_id, of_user_id)
    except Exception:
        pass
    with _verification_guard:
        _verification_clean.add(key)
        _verification_seen.discard(key)
    try:
        from sse_hub import hub
        hub.broadcast(crm_id, {
            'event_type': 'verification.approved',
            'payload': {'of_user_id': str(of_user_id)},
        })
    except Exception:
        pass


def _challenge_error(crm_id, of_user_id, challenge):
    """Persist the challenge and render it as a handle_of_request error tuple.

    403, not OF's raw 400: this is "the platform will not serve this account
    until a human proves who they are", which is a different thing from the
    malformed-request 400s callers already handle."""
    reason, message = flag_verification_required(crm_id, of_user_id, challenge)
    return False, {
        'error': message,
        'reason': reason,
        'needs_verification': True,
        'verification_methods': challenge['methods'],
        'otp_state': challenge['otp_state'],
        'of_error_code': challenge['code'],
    }, 403, False


def _broadcast_verification_required(crm_id, of_user_id, reason, challenge):
    """Tell any open dashboard, once per transition. Best-effort: a missing SSE
    hub must never turn into a failed OF request."""
    try:
        from sse_hub import hub
        hub.broadcast(crm_id, {
            'event_type': 'verification.required',
            'payload': {
                'of_user_id': str(of_user_id),
                'reason': reason,
                'methods': challenge['methods'],
                'otp_state': challenge['otp_state'],
            },
        })
    except Exception:
        pass


def handle_of_request(crm_id, of_user_id, path, method='GET', body=None, proxy=None):
    """Make an authenticated OF API call with auto-relogin.

    Returns: (success, data_or_error, status_code, relogin_flag)
    """
    if not proxy:
        account = db.get_of_account(crm_id, of_user_id)
        if account:
            proxy = account.get('proxy')
    # No proxy configured → run direct on the server's own IP. The session layer
    # only sets session.proxies when a proxy is present, so a None proxy means
    # requests egress on the host IP (fine on a clean/residential box).

    session_data = mt_auth.load_session(crm_id, of_user_id, proxy=proxy)
    if not session_data:
        return False, {'error': 'No session found. Please login first'}, 404, False

    result = _request_or_translated_error(session_data, path, method, body)
    if isinstance(result, tuple):
        _record_connection_result(crm_id, of_user_id, result, path)
        return result  # translated proxy/transport error
    response = result
    try:
        response_data = response.json()
    except Exception:
        response_data = response.text

    challenge = parse_otp_challenge(response_data)
    if challenge:
        # A live session behind a second factor. Re-logging in cannot clear it
        # (the login lands on the same challenge and costs a captcha solve), so
        # this returns before attempt_relogin is ever considered.
        return _challenge_error(crm_id, of_user_id, challenge)

    if is_access_denied(response_data):
        # attempt_relogin owns the retry policy (per-account lock, credential
        # block, transient cooldown) — one call, no outer retry loop.
        new_session, relogin_error = attempt_relogin(crm_id, of_user_id, proxy)
        if relogin_error:
            account = db.get_of_account(crm_id, of_user_id) or {}
            login_failure = account_status.login_failure_payload(account)
            if login_failure:
                error_payload = {
                    'error': login_failure['message'],
                    'reason': login_failure['code'],
                    'connection_state': 'login_failed',
                    'login_failure': login_failure,
                    'relogin_failed': True,
                    'needs_reconnect': True,
                }
            elif account.get('verification_required_at'):
                error_payload = {
                    'error': account.get('verification_reason') or _2FA_RELOGIN_REASON,
                    'reason': 'verification_required',
                    'connection_state': 'verification_required',
                    'relogin_failed': True,
                    'needs_verification': True,
                }
            else:
                # Transient login errors can contain upstream implementation
                # detail. Keep the raw text in server logs, not the API body.
                error_payload = {
                    'error': 'Automatic login could not be completed. Try again later.',
                    'reason': 'temporary_error',
                    'connection_state': 'temporary_error',
                    'relogin_failed': True,
                    'retryable': True,
                }
            return False, error_payload, 401, False
        result = _request_or_translated_error(new_session, path, method, body)
        if isinstance(result, tuple):
            _record_connection_result(crm_id, of_user_id, result, path)
            return result  # translated proxy/transport error
        response = result
        try:
            response_data = response.json()
        except Exception:
            response_data = response.text
        if is_access_denied(response_data):
            # A freshly-minted session being denied is not a credential problem
            # (the login just succeeded) — don't burn another captcha on it.
            return False, {
                'error': 'Session expired; a fresh login succeeded but OnlyFans still denied the request.',
                'relogin_failed': True
            }, 401, False
        challenge = parse_otp_challenge(response_data)
        if challenge:
            return _challenge_error(crm_id, of_user_id, challenge)
        if response.status_code == 200:
            _clear_verification_flag(crm_id, of_user_id)
        final = (response.status_code == 200, response_data, response.status_code, True)
        _record_connection_result(crm_id, of_user_id, final, path)
        return final

    if response.status_code == 200:
        # Authoritative "the gate is open" signal. Any 200 from an
        # account-scoped call means OF is answering this session again, so a
        # stale verification flag must not keep the account greyed out — this
        # is also what makes the face-ID watcher's poll loop terminate.
        _clear_verification_flag(crm_id, of_user_id)
    final = (response.status_code == 200, response_data, response.status_code, False)
    _record_connection_result(crm_id, of_user_id, final, path)
    return final
