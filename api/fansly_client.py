#!/usr/bin/env python3
"""Shared Fansly API request helper — the Fansly analogue of ``of_client.py``.

Same contract as ``of_client.handle_of_request`` so the two are
interchangeable behind ``platform_client.handle_platform_request``:

    handle_fansly_request(...) -> (success, data_or_error, status_code, relogin_flag)

Handles session loading, expired-session detection, and auto-relogin with
stored credentials. Unlike OF, a proxy is optional (Fansly serves direct
connections); when present it is loaded from the saved account.
"""

import threading
import time

import crm_database as db
import fansly_auth
import fansly_login
import transport_errors

# ── Relogin circuit breaker (mirrors of_client's) ──────────────────────────
# A dead session + an open dashboard tab (parallel auto-refetches) must never
# fan out into parallel Fansly logins. One lock per account serialises
# attempts; a fresh success is shared with requests that were waiting on the
# lock; failures set either a DB-backed block (dead pasted token / 2FA —
# needs a human, never retry until the user reconnects) or an in-memory
# cooldown (transient errors — retry after a pause).
RELOGIN_COOLDOWN_SECONDS = 300
# A success this recent is handed to concurrent/just-behind callers instead of
# logging in again — their 401 came from the pre-refresh session.
RELOGIN_REUSE_WINDOW_SECONDS = 30

_relogin_registry_guard = threading.Lock()
_relogin_locks = {}            # "crm:account" -> threading.Lock
_relogin_cooldowns = {}        # "crm:account" -> (retry_after_unix_ts, error_dict)
_relogin_last_success = {}     # "crm:account" -> (unix_ts, session_result)


def _relogin_lock_for(key):
    with _relogin_registry_guard:
        lock = _relogin_locks.get(key)
        if lock is None:
            lock = _relogin_locks[key] = threading.Lock()
        return lock


def _blocked_error(account):
    reason = account.get('relogin_block_reason') or 'the stored Fansly credentials no longer work'
    return {
        'reason': 'blocked',
        'message': f'Auto re-login is paused: {reason} Reconnect the account to resume.'
        if reason.endswith('.') else
        f'Auto re-login is paused: {reason}. Reconnect the account to resume.',
    }


def _is_credential_rejection(error_text):
    """True when a Fansly login error is a genuine bad-password/username
    rejection (not a transient/proxy failure) — mirrors
    of_client._is_credential_rejection so a dead password gets a persistent DB
    block instead of retrying a real login every cooldown window forever."""
    low = (error_text or '').lower()
    return (
        ('invalid' in low and ('password' in low or 'username' in low or 'credential' in low))
        or 'incorrect password' in low
        or 'wrong password' in low
        or 'bad credentials' in low
    )


# ── Transport/proxy error translation ──────────────────────────────────────
# Same job as of_client.translate_transport_error, sharing the same classifier
# (transport_errors.classify) so the two can't drift. Two things genuinely
# differ, and both are deliberate:
#
#  1. WORDING + REASON PREFIX. On OF a proxy is effectively mandatory, so every
#     transport failure is a proxy failure and of_client always says "proxy".
#     On Fansly the proxy is OPTIONAL (direct egress is the common case — see
#     the module docstring), and the dashboard turns a "proxy_*" reason into an
#     inline "fix your proxy" flow (xcelerate-company-page/lib/proxy-error.ts).
#     Tagging a direct-connection timeout as proxy_timeout would march the user
#     into a modal for a proxy they never configured, so with no proxy saved we
#     emit "network_*" — same clean message, no bogus fix-proxy CTA.
#  2. NO {success: false} ENVELOPE. Fansly's own errors arrive as
#     {success: false, error: {...}} and is_session_expired parses that shape.
#     A transport failure is OURS, not Fansly's — Fansly never answered — so
#     the synthesized payload keeps of_client's {error, reason} shape instead,
#     which is what makes the two clients interchangeable behind
#     platform_client.handle_platform_request. fansly_data adds success=False
#     when it turns the tuple into an HTTP body.
_TRANSPORT_MESSAGES = {  # kind -> (reason suffix, proxied message, direct message)
    'auth': (
        'auth',
        'Proxy authentication failed (407) — the proxy username or password is wrong. '
        'Update the proxy saved on this account and try again.',
        'Got a 407 proxy-authentication challenge but no proxy is configured on this '
        'account — something on the network path is intercepting the connection.',
    ),
    'reset': (
        'reset',
        'Connection dropped while routing through the proxy. The proxy may be unstable or '
        'blocking Fansly — try again or switch proxy.',
        'The connection to Fansly was dropped mid-request. Try again; if it persists, '
        "Fansly may be blocking this server's IP.",
    ),
    'timeout': (
        'timeout',
        'The proxy timed out reaching Fansly. It may be overloaded — try again or switch proxy.',
        'Fansly did not respond in time. It may be slow or unreachable from this server — try again.',
    ),
    'dns': (
        'dns',
        'The proxy host could not be resolved — check the proxy address.',
        'Could not resolve the Fansly API hostname — this server has a DNS problem.',
    ),
    'connection': (
        'connection',
        'Could not connect to the proxy — it may be offline or the port is wrong.',
        'Could not connect to Fansly — it may be down or blocked from this server.',
    ),
    'tls': (
        'tls',
        'TLS error while routing through the proxy. Try a different proxy.',
        'TLS error while connecting to Fansly. The connection may be intercepted — try again.',
    ),
    # Unknown transport-ish failure. Keep it clean — never echo the raw curl
    # string back to the user. Suffix is "error" (not "generic") to match
    # of_client's proxy_error, which the dashboard already recognises.
    'generic': (
        'error',
        'Could not reach Fansly through the proxy. Check the proxy and try again.',
        "Could not reach Fansly. Check this server's connectivity and try again.",
    ),
}


def translate_transport_error(exc, proxy=None):
    """Map a curl_cffi / transport exception to a clean, actionable (message,
    reason) pair — the Fansly analogue of ``of_client.translate_transport_error``.

    ``proxy`` selects the wording and the reason prefix: proxy_* when the
    account routes through a proxy (the dashboard can offer to fix it),
    network_* when it egresses directly (nothing to fix on the proxy).

    Returns (None, None) when the exception does not look like a transport
    failure, so the caller re-raises and the generic 500 handler owns it rather
    than a real bug being mislabelled as a network fault.
    """
    kind = transport_errors.classify(exc)
    if kind is None:
        return (None, None)
    suffix, proxied_message, direct_message = _TRANSPORT_MESSAGES[kind]
    if proxy:
        return (proxied_message, f'proxy_{suffix}')
    return (direct_message, f'network_{suffix}')


def _request_or_translated_error(session_data, path, method, body, proxy=None):
    """Call make_authenticated_request, converting transport/proxy exceptions
    into a clean handle_fansly_request-style error tuple. Returns the raw
    response on success, or an error tuple ``(False, {...}, 424, False)`` on a
    translated transport failure. Re-raises anything that isn't transport.

    Mirrors of_client._request_or_translated_error. Without this the exception
    escapes to the global 500 handler and the operator sees an opaque 500
    instead of "the proxy timed out".
    """
    try:
        return fansly_auth.make_authenticated_request(session_data, path, method, body)
    except Exception as exc:
        message, reason = translate_transport_error(exc, proxy)
        if message is None:
            raise
        # A tenant's proxy/direct network path is an upstream dependency of
        # that account, not a server fault. 424 keeps the failure actionable
        # without tripping the platform-wide 5xx stop threshold.
        return False, {'error': message, 'reason': reason}, 424, False


def _record_connection_result(crm_id, account_id, result):
    """Persist only sanitized Fansly transport state."""
    if not isinstance(result, tuple) or len(result) < 3:
        return
    ok, data, status = result[:3]
    if ok or status == 200:
        db.clear_connection_error(crm_id, account_id)
        return
    reason = data.get('reason') if isinstance(data, dict) else None
    if str(reason or '').startswith('proxy_'):
        db.set_connection_error(crm_id, account_id, 'proxy_error', reason)
    elif status == 429 or reason == 'rate_limited':
        db.set_connection_error(crm_id, account_id, 'rate_limited', 'rate_limited')
    elif str(reason or '').startswith('network_') or status >= 500:
        db.set_connection_error(crm_id, account_id, 'temporary_error', 'temporary_error')


def is_session_expired(response, response_data):
    """Detect an expired/invalid Fansly session (the relogin trigger).

    Conservative: a 401 is the unambiguous signal. We also treat a
    ``success:false`` envelope as expired only when its error text is
    auth-related — so ordinary business errors (422 bad post id, etc.) don't
    spuriously trigger a relogin.
    """
    if response.status_code == 401:
        return True
    if isinstance(response_data, dict) and response_data.get('success') is False:
        err = response_data.get('error')
        if isinstance(err, dict):
            text = (err.get('details') or err.get('message') or '').lower()
        else:
            text = str(err or '').lower()
        return any(w in text for w in (
            'auth', 'session', 'token', 'unauthor', 'not logged',
            'expired', 'revoked', 'logged out', 'invalid credential',
            'login required', 'please log in',
        ))
    return False


def attempt_relogin(crm_id, account_id, proxy=None):
    """Re-establish a Fansly session from stored email+password.

    Returns (session_result, None) on success, or (None, {'reason','message'})
    on failure with an ACTIONABLE reason the dashboard / polling-paused event can
    surface:
      - auth_token_expired : connected via auth-token paste (no stored password)
                             → persistent DB block (needs a fresh token paste)
      - requires_2fa       : re-login needs a fresh 2FA / email-verification code
                             → persistent DB block (needs a human)
      - login_failed       : credentials rejected / transient error → cooldown
      - blocked            : a previous failure set a DB block — fail fast
      - cooldown           : a recent transient failure — retry after a pause

    Circuit-breaker semantics match of_client.attempt_relogin: one login per
    account per burst, success shared with concurrent callers, DB block cleared
    by the next reconnect (add_of_account).
    """
    account = db.get_of_account(crm_id, account_id)
    if not account:
        return None, {'reason': 'no_account', 'message': 'No account found'}
    if account.get('relogin_blocked_at'):
        return None, _blocked_error(account)

    key = f'{crm_id}:{account_id}'
    lock = _relogin_lock_for(key)
    with lock:
        # Someone else may have just finished while we waited on the lock —
        # honour their outcome instead of piling on with another attempt.
        prev = _relogin_last_success.get(key)
        if prev and time.time() - prev[0] < RELOGIN_REUSE_WINDOW_SECONDS:
            return prev[1], None
        cooldown = _relogin_cooldowns.get(key)
        if cooldown and time.time() < cooldown[0]:
            return None, cooldown[1]
        account = db.get_of_account(crm_id, account_id)
        if not account:
            return None, {'reason': 'no_account', 'message': 'No account found'}
        if account.get('relogin_blocked_at'):
            return None, _blocked_error(account)

        email = account.get('email')
        password = account.get('password')
        if not email or not password:
            # Token-paste connections can never auto-relogin — block in the DB
            # so every caller (routes, poller, WS listener) fails fast with
            # needs_reconnect instead of re-walking this path on each 401.
            msg = ('Re-paste your Fansly auth token — automatic re-login '
                   'needs stored credentials.')
            db.set_relogin_block(crm_id, account_id, msg)
            return None, {'reason': 'auth_token_expired', 'message': msg}

        try:
            result = fansly_login.login(
                email, password, proxy=proxy, device_id=account.get('fansly_client_id')
            )
        except Exception as e:
            # Surface a clean proxy/transport message when that's the cause;
            # otherwise fall back to the underlying error (of_client does the
            # same `message or str(e)`), so the raw curl string never reaches
            # the user or the cooldown text.
            message, _reason = translate_transport_error(e, proxy)
            error_text = message or str(e)
            # A genuine password rejection won't fix itself on retry — persist a
            # DB block (like of_client) so every caller fails fast with
            # needs_reconnect instead of re-attempting a real Fansly login every
            # cooldown window forever. A TRANSPORT failure is explicitly excluded
            # from that test: a dead proxy is not a credential problem, and
            # blocking on one would strand a healthy account behind
            # needs_reconnect until a human reconnected it. of_client relies on
            # its translated messages not matching the rejection patterns; the
            # guard is spelled out here so rewording a message can never
            # accidentally start blocking accounts.
            if message is None and _is_credential_rejection(error_text):
                msg = ('Fansly rejected the stored password (it was likely '
                       'changed). Auto re-login is paused; reconnect the account '
                       'with its current password.')
                db.set_relogin_block(crm_id, account_id, msg)
                return None, {'reason': 'invalid_credentials', 'message': msg}
            _relogin_cooldowns[key] = (time.time() + RELOGIN_COOLDOWN_SECONDS, {
                'reason': 'cooldown',
                'message': f'Fansly re-login failed ({error_text}). '
                           'Automatic retry is paused for a few minutes.',
            })
            return None, {'reason': 'login_failed', 'message': error_text}

        if not result.get('success'):
            if result.get('requires_2fa') or result.get('requires_verification'):
                msg = ('Re-connect this account — Fansly re-login needs a '
                       'fresh 2FA / verification code.')
                db.set_relogin_block(crm_id, account_id, msg)
                return None, {'reason': 'requires_2fa', 'message': msg}
            msg = result.get('message') or result.get('error') or 'Fansly re-login failed'
            _relogin_cooldowns[key] = (time.time() + RELOGIN_COOLDOWN_SECONDS, {
                'reason': 'cooldown',
                'message': f'Fansly re-login failed ({msg}). '
                           'Automatic retry is paused for a few minutes.',
            })
            return None, {'reason': 'login_failed', 'message': msg}

        sid = result.get('account_id') or account_id
        fansly_auth.save_session(crm_id, sid, result, proxy=proxy)
        # Keep the DB session columns in lockstep with the rotated session file —
        # otherwise they hold the dead token after a refresh (add_of_account upserts
        # via COALESCE, so unspecified fields are preserved).
        try:
            db.add_of_account(
                crm_id, sid, email, password=None,
                username=account.get('username'), proxy=proxy, platform='fansly',
                fansly_auth_token=result.get('auth_token'),
                fansly_client_id=result.get('fansly_client_id') or account.get('fansly_client_id'),
                fansly_session_id=result.get('fansly_session_id'),
            )
        except Exception:
            pass
        _relogin_last_success[key] = (time.time(), result)
        _relogin_cooldowns.pop(key, None)
        return result, None


def handle_fansly_request(crm_id, account_id, path, method='GET', body=None, proxy=None):
    """Make an authenticated Fansly API call with auto-relogin.

    ``path`` must include the ``/api/v1`` prefix (e.g. ``/api/v1/account/me``).
    Returns: (success, data_or_error, status_code, relogin_flag)
    """
    if not proxy:
        account = db.get_of_account(crm_id, account_id)
        if account:
            proxy = account.get('proxy')  # may be None — that's fine for Fansly

    session_data = fansly_auth.load_session(crm_id, account_id, proxy=proxy)
    if not session_data:
        return False, {'error': 'No session found. Please login first'}, 404, False

    # Transport failures short-circuit HERE, before is_session_expired — a dead
    # proxy is not a dead session. Routing one into attempt_relogin would burn
    # the breaker's cooldown on a network fault and leave the account looking
    # credential-broken when its credentials are fine.
    result = _request_or_translated_error(session_data, path, method, body, proxy)
    if isinstance(result, tuple):
        _record_connection_result(crm_id, account_id, result)
        return result  # translated transport error
    response = result
    try:
        response_data = response.json()
    except Exception:
        response_data = response.text

    if is_session_expired(response, response_data):
        for attempt in range(2):
            new_session, relogin_error = attempt_relogin(crm_id, account_id, proxy)
            if relogin_error:
                reason = relogin_error.get('reason') if isinstance(relogin_error, dict) else 'relogin_failed'
                msg = relogin_error.get('message') if isinstance(relogin_error, dict) else str(relogin_error)
                if reason in ('cooldown', 'login_failed'):
                    low = str(msg or '').lower()
                    if '429' in low or 'rate limit' in low or 'too many requests' in low:
                        state, safe_code, response_status = (
                            'rate_limited', 'rate_limited', 429
                        )
                        safe_error = (
                            'Fansly is temporarily rate limiting this account. '
                            'Synchronization will retry later.'
                        )
                    else:
                        state, safe_code, response_status = (
                            'temporary_error', 'temporary_error', 424
                        )
                        safe_error = (
                            'Fansly automatic login could not be completed. '
                            'Synchronization will retry later.'
                        )
                    db.set_connection_error(
                        crm_id, account_id, state, safe_code
                    )
                    return False, {
                        'error': safe_error,
                        'reason': safe_code,
                        'connection_state': state,
                        'relogin_failed': True,
                        'retryable': True,
                    }, response_status, False
                # Reasons that need a human (2FA / dead pasted token / DB block)
                # or a pause (cooldown) won't fix themselves — return immediately
                # instead of spinning.
                if reason in ('requires_2fa', 'auth_token_expired', 'no_account',
                              'blocked', 'cooldown', 'invalid_credentials') or attempt == 1:
                    error_payload = {
                        'error': f'Session expired and re-login failed: {msg}',
                        'relogin_failed': True,
                        'reason': reason,
                    }
                    account = db.get_of_account(crm_id, account_id) or {}
                    if account.get('relogin_blocked_at'):
                        # Same flag the OF breaker sets — the dashboard reads it
                        # to show the "reconnect" state.
                        error_payload['needs_reconnect'] = True
                    return False, error_payload, 401, False
                continue
            session_data = fansly_auth.load_session(crm_id, account_id, proxy=proxy)
            result = _request_or_translated_error(session_data, path, method, body, proxy)
            if isinstance(result, tuple):
                _record_connection_result(crm_id, account_id, result)
                return result  # translated transport error — stop retrying
            response = result
            try:
                response_data = response.json()
            except Exception:
                response_data = response.text
            if not is_session_expired(response, response_data):
                final = (response.status_code == 200, response_data, response.status_code, True)
                _record_connection_result(crm_id, account_id, final)
                return final
        # The login itself succeeded but this specific API surface still
        # denied the refreshed session. That is not a password failure. Persist
        # a retryable state so dashboard guards stop re-running the login flow
        # on every refresh; a later successful account request clears it.
        db.set_connection_error(
            crm_id, account_id, 'temporary_error', 'temporary_error'
        )
        return False, {
            'error': 'Fansly accepted the refreshed login but still denied this API request.',
            'reason': 'temporary_error',
            'connection_state': 'temporary_error',
            'retryable': True,
        }, 424, False

    final = (response.status_code == 200, response_data, response.status_code, False)
    _record_connection_result(crm_id, account_id, final)
    return final
