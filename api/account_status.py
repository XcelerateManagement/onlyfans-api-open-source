"""Customer-safe account connection state and login-failure classification.

Only values defined in this module may be returned to dashboards.  In
particular, raw upstream response bodies and exception strings must never be
persisted as customer-visible login failures.
"""

from __future__ import annotations


LOGIN_FAILURES = {
    'captcha_key_missing': {
        'message': ('No captcha provider key is configured. OnlyFans will not accept a '
                    'login without a solved captcha. Add a 2captcha key under Settings -> '
                    'Captcha provider, then try again.'),
        # Not 'reconnect': nothing about the account is wrong. The operator has
        # to supply a key before any connect attempt can succeed.
        'action': 'configure',
    },
    'invalid_password': {
        'message': 'OnlyFans rejected the saved password. It may have been changed.',
        'action': 'reconnect',
    },
    'invalid_credentials': {
        'message': 'OnlyFans rejected the saved login details.',
        'action': 'reconnect',
    },
    'account_not_found': {
        'message': 'OnlyFans no longer resolves this account.',
        'action': 'contact_support',
    },
    'account_disabled': {
        'message': 'OnlyFans reports that this account is disabled or blocked.',
        'action': 'contact_support',
    },
    'account_deleted': {
        'message': 'OnlyFans reports that this account was deleted.',
        'action': 'remove_account',
    },
    'session_revoked': {
        'message': 'The saved OnlyFans session was revoked and could not be restored.',
        'action': 'reconnect',
    },
    'missing_credentials': {
        'message': 'The saved session expired and no password is available for automatic login.',
        'action': 'reconnect',
    },
}

CONNECTION_ERRORS = {
    'proxy_error': {
        'message': 'The saved proxy could not reach OnlyFans. Check or replace the proxy.',
        'retryable': True,
    },
    'proxy_blocked': {
        'message': ('OnlyFans blocked logins from this proxy\'s IP address. Use a different '
                    'proxy (residential or mobile, in the account\'s usual country) and try again.'),
        'retryable': True,
    },
    'rate_limited': {
        'message': 'OnlyFans is temporarily rate limiting this account. Synchronization will retry later.',
        'retryable': True,
    },
    'sync_blocked': {
        'message': 'Synchronization is paused because a required local service is unavailable.',
        'retryable': True,
    },
    'temporary_error': {
        'message': 'OnlyFans synchronization failed temporarily. It will retry with backoff.',
        'retryable': True,
    },
}


# Connect-flow failures (POST /accounts/login and /login/verify-otp), shown in
# the Add Account modal: `error` says what went wrong, `suggestion` what to do.
CONNECT_ERRORS = {
    'proxy_blocked': {
        'error': "Proxy blocked: OnlyFans refused logins from this proxy's IP address.",
        'suggestion': ("Use a different proxy — a residential or mobile IP in the account's "
                       "usual country — and try again."),
    },
    'proxy_error': {
        'error': 'Proxy error: the proxy could not reach OnlyFans.',
        'suggestion': 'Check the proxy with Test proxy, or switch to a different proxy.',
    },
    'rate_limited': {
        'error': 'Rate limited: OnlyFans is limiting login attempts right now.',
        'suggestion': 'Wait a few minutes before trying again — every retry extends the limit.',
    },
    'sync_blocked': {
        'error': 'Service unavailable: account connections are paused on our side.',
        'suggestion': 'Try again in a few minutes. If it keeps happening, contact support.',
    },
    'temporary_error': {
        'error': 'OnlyFans login is temporarily unavailable.',
        'suggestion': ('Try again in a minute. If it keeps failing, try a different proxy '
                       'or contact support.'),
    },
    'captcha_key_missing': {
        'error': 'No captcha provider key is configured.',
        'suggestion': ('OnlyFans will not accept a login without a solved captcha. Add a '
                       '2captcha key under Settings -> Captcha provider (get one at '
                       'https://2captcha.com and add a few dollars of credit), then try '
                       'again.'),
    },
}


def classify_terminal_login_failure(error_text):
    """Return a stable terminal failure code, or ``None`` for transient errors.

    Ordering is deliberate: deleted/disabled states can contain generic words
    such as "invalid", and proxy errors can mention a proxy password without
    saying anything about the OnlyFans account password.
    """
    low = str(error_text or '').lower()
    if not low:
        return None
    # Checked before the transient markers below: this one is permanent until
    # the operator supplies a key, and retrying it silently wastes their time.
    if 'no captcha provider key is configured' in low:
        return 'captcha_key_missing'
    if any(marker in low for marker in (
            'proxy ', 'proxy:', 'proxy authentication', '407',
            'timed out', 'timeout', 'rate limit', 'too many requests')):
        return None
    if any(marker in low for marker in ('account has been deleted', 'account deleted')):
        return 'account_deleted'
    if any(marker in low for marker in (
            'account is disabled', 'account disabled', 'account is blocked',
            'account blocked', 'account is banned', 'account banned')):
        return 'account_disabled'
    if any(marker in low for marker in (
            'account not found', 'user not found', 'no account found')):
        return 'account_not_found'
    if ('wrong email or password' in low
            or ('invalid' in low and 'password' in low)
            or 'rejected the stored password' in low
            or 'rejected the saved password' in low):
        return 'invalid_password'
    if 'invalid credentials' in low or 'credentials rejected' in low:
        return 'invalid_credentials'
    if any(marker in low for marker in (
            'invalid or expired session', 'session revoked', 'session was revoked')):
        return 'session_revoked'
    return None


def infer_legacy_code(reason):
    """Map old free-text relogin blocks to the structured contract."""
    code = classify_terminal_login_failure(reason)
    return code or 'invalid_credentials'


def classify_non_login_state(error_text):
    """Classify a failure that is known not to be a terminal login failure."""
    low = str(error_text or '').lower()
    if any(marker in low for marker in (
            'proxy ', 'proxy:', 'proxy authentication', '407')):
        return 'proxy_error'
    if any(marker in low for marker in (
            '429', 'rate limit', 'too many requests')):
        return 'rate_limited'
    if any(marker in low for marker in (
            '2fa', 'two-factor', 'face verification')):
        return 'verification_required'
    return 'temporary_error'


def login_failure_payload(account):
    """Build a safe public login_failure object for a blocked DB account."""
    if not account.get('relogin_blocked_at'):
        return None
    code = account.get('relogin_block_code')
    if code not in LOGIN_FAILURES:
        code = infer_legacy_code(account.get('relogin_block_reason'))
    spec = LOGIN_FAILURES[code]
    return {
        'code': code,
        'message': spec['message'],
        'occurred_at': account.get('relogin_blocked_at'),
        'action': account.get('relogin_block_action') or spec['action'],
    }


def connection_error_payload(account):
    state = account.get('last_connection_state')
    if state not in CONNECTION_ERRORS or not account.get('last_connection_error_at'):
        return None
    spec = CONNECTION_ERRORS[state]
    message = spec['message']
    if (account.get('platform') or 'onlyfans') == 'fansly':
        message = message.replace('OnlyFans', 'Fansly')
    return {
        'code': account.get('last_connection_error_code') or state,
        'message': message,
        'occurred_at': account.get('last_connection_error_at'),
        'retryable': spec['retryable'],
    }
