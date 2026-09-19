#!/usr/bin/env python3
"""No-network checks for the public account-status contract."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import account_status  # noqa: E402


def assert_equal(actual, expected, name):
    if actual != expected:
        raise AssertionError(f'{name}: expected {expected!r}, got {actual!r}')
    print(f'  [PASS] {name}')


print('\n-- terminal login classifications --')
cases = {
    'Wrong email or password': 'invalid_password',
    'invalid password': 'invalid_password',
    'invalid credentials': 'invalid_credentials',
    'account not found': 'account_not_found',
    'account is disabled': 'account_disabled',
    'account has been deleted': 'account_deleted',
    'session was revoked': 'session_revoked',
}
for raw, expected in cases.items():
    assert_equal(account_status.classify_terminal_login_failure(raw), expected, raw)

expected_actions = {
    # Not a problem with the account: the operator has not supplied a captcha
    # provider key yet, so no connect attempt can succeed until they do.
    'captcha_key_missing': 'configure',
    'invalid_password': 'reconnect',
    'invalid_credentials': 'reconnect',
    'account_not_found': 'contact_support',
    'account_disabled': 'contact_support',
    'account_deleted': 'remove_account',
    'session_revoked': 'reconnect',
    'missing_credentials': 'reconnect',
}
assert_equal(
    {code: spec['action'] for code, spec in account_status.LOGIN_FAILURES.items()},
    expected_actions,
    'terminal failure actions',
)

print('\n-- non-login failures stay separate --')
for raw in (
    'proxy authentication required (407)',
    'proxy password invalid',
    'request timed out',
    '429 too many requests',
    'signer missing',
    'internal server error',
    '2FA code required',
    'face verification required',
):
    assert_equal(account_status.classify_terminal_login_failure(raw), None, raw)

assert_equal(account_status.classify_non_login_state('proxy 407'), 'proxy_error', 'proxy state')
assert_equal(account_status.classify_non_login_state('429 too many requests'), 'rate_limited', 'rate state')
assert_equal(account_status.classify_non_login_state('face verification required'), 'verification_required', 'verification state')

print('\n-- public payload never leaks legacy raw text --')
payload = account_status.login_failure_payload({
    'relogin_blocked_at': '2026-09-01T17:36:00Z',
    'relogin_block_code': 'invalid_password',
    'relogin_block_action': 'reconnect',
    'relogin_block_reason': 'RAW upstream body cookie=secret password=hunter2',
})
assert_equal(payload, {
    'code': 'invalid_password',
    'message': 'OnlyFans rejected the saved password. It may have been changed.',
    'occurred_at': '2026-09-01T17:36:00Z',
    'action': 'reconnect',
}, 'sanitized structured payload')

legacy = account_status.login_failure_payload({
    'relogin_blocked_at': '2026-09-01T17:36:00Z',
    'relogin_block_reason': 'OnlyFans rejected the stored password (it was likely changed)',
})
assert_equal(legacy['code'], 'invalid_password', 'legacy password reason inferred')

connection_error = account_status.connection_error_payload({
    'last_connection_state': 'proxy_error',
    'last_connection_error_code': 'proxy_auth',
    'last_connection_error_at': '2026-09-15T19:00:00Z',
})
assert_equal(connection_error, {
    'code': 'proxy_auth',
    'message': 'The saved proxy could not reach OnlyFans. Check or replace the proxy.',
    'occurred_at': '2026-09-15T19:00:00Z',
    'retryable': True,
}, 'sanitized proxy payload')

fansly_connection_error = account_status.connection_error_payload({
    'platform': 'fansly',
    'last_connection_state': 'proxy_error',
    'last_connection_error_code': 'proxy_connection',
    'last_connection_error_at': '2026-09-15T19:00:00Z',
})
assert_equal(
    fansly_connection_error['message'],
    'The saved proxy could not reach Fansly. Check or replace the proxy.',
    'Fansly proxy message names the correct platform',
)

blocked_connection_error = account_status.connection_error_payload({
    'last_connection_state': 'proxy_blocked',
    'last_connection_error_at': '2026-09-17T09:58:08Z',
})
assert_equal(blocked_connection_error, {
    'code': 'proxy_blocked',
    'message': ("OnlyFans blocked logins from this proxy's IP address. Use a different "
                "proxy (residential or mobile, in the account's usual country) and try again."),
    'occurred_at': '2026-09-17T09:58:08Z',
    'retryable': True,
}, 'proxy_blocked payload')

print('\n-- every connect error says what happened and what to do --')
for state, spec in account_status.CONNECT_ERRORS.items():
    assert_equal(bool(spec.get('error')) and bool(spec.get('suggestion')), True,
                 f'{state} has error + suggestion')

print('\nALL PASS')
