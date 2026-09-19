#!/usr/bin/env python3
"""Dashboard 2FA, login challenges and signed-in sessions (account_security.py).

    python tests/test_account_security.py
"""

import os
import sys
import tempfile
import time

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)
os.environ['INTER_SERVICE_TOKEN'] = 'synthetic-service-token-for-tests-only'

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pyotp                        # noqa: E402
import crm_database as db           # noqa: E402
import account_security as sec      # noqa: E402
import crm_api                      # noqa: E402

db.init_database()
client = crm_api.app.test_client()
SERVICE = {'X-Service-Token': os.environ['INTER_SERVICE_TOKEN']}
_failures = []


def check(name, cond, detail=''):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


def call(path, body, headers=SERVICE):
    r = client.post('/internal/account-security' + path, json=body, headers=headers)
    return r.status_code, r.get_json()


def code_for(secret, offset_steps=0):
    totp = pyotp.TOTP(secret)
    return totp.at(int(time.time()) + offset_steps * totp.interval)


def enroll(crm_id):
    _, setup = call('/mfa/setup', {'crm_id': crm_id})
    _, enabled = call('/mfa/enable', {'crm_id': crm_id, 'code': code_for(setup['secret'])})
    return setup['secret'], enabled['recovery_codes']


def reset_step(crm_id):
    """Let the test reuse the current TOTP window (production refuses reuse)."""
    with sec._db() as conn:
        uid = sec._user(conn, crm_id)['id']
        conn.execute('UPDATE user_mfa SET last_step = 0, failed_count = 0 WHERE user_id = ?', (uid,))


a = db.create_user('alice@example.test', 'synthetic-password-a', 'Alice')
b = db.create_user('bob@example.test', 'synthetic-password-b', 'Bob')
A, B = a['crm_id'], b['crm_id']

# ── service token ────────────────────────────────────────────────────────────
print('\n-- service token required --')
for path in ['/mfa/status', '/mfa/setup', '/challenge/verify', '/sessions/create', '/sessions/check',
             '/sessions/list', '/sessions/revoke']:
    status, _ = call(path, {'crm_id': A}, headers={})
    check(f'{path} without token → 401', status == 401, str(status))
status, _ = call('/mfa/status', {'crm_id': A}, headers={'X-Service-Token': 'wrong'})
check('wrong token → 401', status == 401, str(status))
status, _ = call('/mfa/status', {'crm_id': 'crm_missing'})
check('unknown crm → 401', status == 401, str(status))

# ── enrollment ───────────────────────────────────────────────────────────────
print('\n-- enrollment --')
status, body = call('/mfa/status', {'crm_id': A})
check('starts disabled', status == 200 and body['enabled'] is False, str(body))
status, body = call('/challenge/create', {'crm_id': A})
check('no challenge while disabled', status == 200 and body == {'mfa_required': False}, str(body))
status, setup = call('/mfa/setup', {'crm_id': A})
check('setup returns secret + otpauth uri', status == 200 and setup['otpauth_uri'].startswith('otpauth://totp/'), str(setup))
check('otpauth uri names the issuer', 'The%20Only%20API' in setup['otpauth_uri'], setup['otpauth_uri'])
with sec._db() as conn:
    stored = conn.execute('SELECT pending_secret_enc FROM user_mfa').fetchone()[0]
check('pending secret encrypted at rest', stored and setup['secret'] not in stored)
status, body = call('/mfa/enable', {'crm_id': A, 'code': '000000'})
check('wrong enrollment code rejected', status == 401, str(status))
status, body = call('/mfa/enable', {'crm_id': A, 'code': code_for(setup['secret'])})
check('enable with correct code', status == 200 and body['enabled'] is True, str(body))
codes = body['recovery_codes']
check('10 recovery codes', len(codes) == 10 and len(set(codes)) == 10, str(codes))
with sec._db() as conn:
    hashes = [r[0] for r in conn.execute('SELECT code_hash FROM user_mfa_recovery')]
check('recovery codes stored hashed only', not any(c.replace('-', '') in hashes for c in codes))
status, body = call('/mfa/setup', {'crm_id': A})
check('setup refused while enabled', status == 409, str(status))
status, body = call('/mfa/status', {'crm_id': A})
check('status enabled + 10 codes', body == {'enabled': True, 'recovery_codes_remaining': 10}, str(body))
status, body = call('/mfa/status', {'crm_id': B})
check('other user unaffected', body['enabled'] is False, str(body))
secret = setup['secret']

print('\n-- expired setup --')
_, setup_b = call('/mfa/setup', {'crm_id': B})
with sec._db() as conn:
    conn.execute('UPDATE user_mfa SET pending_at = pending_at - ?', (sec.SETUP_TTL + 5,))
status, _ = call('/mfa/enable', {'crm_id': B, 'code': code_for(setup_b['secret'])})
check('stale setup cannot be confirmed', status == 409, str(status))

# ── login challenge ──────────────────────────────────────────────────────────
print('\n-- login challenge --')
reset_step(A)
status, body = call('/challenge/create', {'crm_id': A, 'pending': {'email': 'alice@example.test'}})
check('challenge issued when enabled', status == 200 and body['mfa_required'] and body['challenge'], str(body))
challenge = body['challenge']
status, body = call('/challenge/verify', {'challenge': challenge, 'code': '123456'})
check('wrong code rejected', status == 401, str(status))
status, body = call('/challenge/verify', {'challenge': challenge, 'code': code_for(secret)})
check('right code accepted', status == 200 and body['crm_id'] == A, str(body))
check('pending identity returned', body.get('pending') == {'email': 'alice@example.test'}, str(body))
status, _ = call('/challenge/verify', {'challenge': challenge, 'code': code_for(secret)})
check('challenge is single use', status == 401, str(status))

_, body = call('/challenge/create', {'crm_id': A})
status, _ = call('/challenge/verify', {'challenge': body['challenge'], 'code': code_for(secret)})
check('same TOTP code cannot be replayed', status == 401, str(status))

reset_step(A)
_, body = call('/challenge/create', {'crm_id': A})
c2 = body['challenge']
for _ in range(sec.CHALLENGE_MAX_ATTEMPTS):
    call('/challenge/verify', {'challenge': c2, 'code': '000000'})
status, _ = call('/challenge/verify', {'challenge': c2, 'code': code_for(secret)})
check('challenge dies after max attempts', status == 401, str(status))

reset_step(A)
_, body = call('/challenge/create', {'crm_id': A})
with sec._db() as conn:
    conn.execute('UPDATE mfa_challenges SET expires_at = ? WHERE token_hash = ?',
                 (int(time.time()) - 1, sec._hash(body['challenge'])))
status, _ = call('/challenge/verify', {'challenge': body['challenge'], 'code': code_for(secret)})
check('expired challenge rejected', status == 401, str(status))
status, _ = call('/challenge/verify', {'challenge': 'made-up', 'code': code_for(secret)})
check('unknown challenge rejected', status == 401, str(status))

print('\n-- recovery codes --')
reset_step(A)
_, body = call('/challenge/create', {'crm_id': A})
status, _ = call('/challenge/verify', {'challenge': body['challenge'], 'code': codes[0].upper(), 'recovery': True})
check('recovery code accepted (case-insensitive)', status == 200, str(status))
_, body = call('/challenge/create', {'crm_id': A})
status, _ = call('/challenge/verify', {'challenge': body['challenge'], 'code': codes[0], 'recovery': True})
check('recovery code single use', status == 401, str(status))
status, _ = call('/challenge/verify', {'challenge': body['challenge'], 'code': codes[1]})
check('recovery code not accepted as TOTP', status == 401, str(status))
_, body = call('/mfa/status', {'crm_id': A})
check('remaining count drops to 9', body['recovery_codes_remaining'] == 9, str(body))

print('\n-- per-user lockout --')
reset_step(A)
for _ in range(sec.FAILURE_LIMIT):
    _, body = call('/challenge/create', {'crm_id': A})
    call('/challenge/verify', {'challenge': body['challenge'], 'code': '000000'})
_, body = call('/challenge/create', {'crm_id': A})
status, err = call('/challenge/verify', {'challenge': body['challenge'], 'code': code_for(secret)})
check('locked after repeated wrong codes', status == 429, f'{status} {err}')
with sec._db() as conn:
    conn.execute('UPDATE user_mfa SET failed_window_start = failed_window_start - ?', (sec.FAILURE_WINDOW + 1,))
_, body = call('/challenge/create', {'crm_id': A})
status, _ = call('/challenge/verify', {'challenge': body['challenge'], 'code': code_for(secret)})
check('lockout clears after the window', status == 200, str(status))

print('\n-- regenerate + disable --')
reset_step(A)
status, body = call('/mfa/recovery/regenerate', {'crm_id': A, 'code': '000000'})
check('regenerate needs a valid code', status == 401, str(status))
status, body = call('/mfa/recovery/regenerate', {'crm_id': A, 'code': code_for(secret)})
check('regenerate returns 10 fresh codes', status == 200 and len(body['recovery_codes']) == 10, str(body))
new_codes = body['recovery_codes']
status, _ = call('/mfa/disable', {'crm_id': A, 'code': codes[2], 'recovery': True})
check('old recovery codes invalid after regenerate', status == 401, str(status))
_, pending = call('/challenge/create', {'crm_id': A})
status, _ = call('/mfa/disable', {'crm_id': B, 'code': new_codes[0], 'recovery': True})
check("another user's code cannot disable", status == 409, str(status))
status, body = call('/mfa/disable', {'crm_id': A, 'code': new_codes[0], 'recovery': True})
check('disable with recovery code', status == 200 and body['enabled'] is False, str(body))
status, _ = call('/challenge/verify', {'challenge': pending['challenge'], 'code': code_for(secret)})
check('outstanding challenges die on disable', status == 401, str(status))
_, body = call('/challenge/create', {'crm_id': A})
check('no challenge after disable', body == {'mfa_required': False}, str(body))

print('\n-- suspended user --')
db.set_user_suspended('bob@example.test', True)
status, _ = call('/challenge/create', {'crm_id': B})
check('suspended user cannot start login', status == 403, str(status))

# ── sessions ─────────────────────────────────────────────────────────────────
print('\n-- sessions --')
_, s1 = call('/sessions/create', {'crm_id': A, 'method': 'password', 'ip': '203.0.113.5', 'country': 'NZ',
                                   'user_agent': 'Browser One'})
_, s2 = call('/sessions/create', {'crm_id': A, 'method': 'sso', 'user_agent': 'Browser Two'})
_, s3 = call('/sessions/create', {'crm_id': A, 'user_agent': 'Browser Three'})
check('session ids issued', all(len(s['session_id']) >= 40 for s in (s1, s2, s3)))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s1['session_id']})
check('fresh session active', body == {'active': True}, str(body))
_, body = call('/sessions/check', {'crm_id': B, 'session_id': s1['session_id']})
check("session not valid under another crm", body == {'active': False}, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': 'made-up'})
check('unknown session inactive', body == {'active': False}, str(body))
_, body = call('/sessions/check', {'crm_id': B, 'session_id': None, 'issued_at': int(time.time())})
check('suspended user inactive', body == {'active': False}, str(body))

_, listing = call('/sessions/list', {'crm_id': A, 'session_id': s1['session_id']})
rows = listing['sessions']
check('lists 3 sessions', len(rows) == 3, str(rows))
check('current session flagged', [r['current'] for r in rows if r['user_agent'] == 'Browser One'] == [True], str(rows))
check('session secret not exposed', not any('session_id' in r for r in rows), str(rows[0]))
first = next(r for r in rows if r['user_agent'] == 'Browser One')
check('ip/country recorded', (first['ip'], first['country']) == ('203.0.113.5', 'NZ'), str(first))
_, other = call('/sessions/list', {'crm_id': B})
check("other user sees none of A's sessions", other['sessions'] == [], str(other))

two = next(r for r in rows if r['user_agent'] == 'Browser Two')
status, _ = call('/sessions/revoke', {'crm_id': B, 'mode': 'one', 'target_id': two['id']})
check("B cannot revoke A's session", status == 404, str(status))
status, body = call('/sessions/revoke', {'crm_id': A, 'session_id': s1['session_id'], 'mode': 'one', 'target_id': two['id']})
check('revoke one', status == 200 and body == {'revoked': 1, 'current_revoked': False}, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s2['session_id']})
check('revoked session inactive', body == {'active': False}, str(body))
status, _ = call('/sessions/revoke', {'crm_id': A, 'mode': 'one', 'target_id': two['id']})
check('revoking twice → 404', status == 404, str(status))
status, _ = call('/sessions/revoke', {'crm_id': A, 'mode': 'one', 'target_id': str(two['id'])})
check('string target id refused', status == 404, str(status))
status, _ = call('/sessions/revoke', {'crm_id': A, 'mode': 'nuke'})
check('unknown mode refused', status == 400, str(status))

print('\n-- tokens from before session tracking --')
before = int(time.time()) - 10
_, body = call('/sessions/check', {'crm_id': A, 'issued_at': before})
check('old cookie still active', body == {'active': True}, str(body))
status, _ = call('/sessions/revoke', {'crm_id': A, 'mode': 'others'})
check('"others" needs the current session id', status == 409, str(status))
status, body = call('/sessions/revoke', {'crm_id': A, 'session_id': s1['session_id'], 'mode': 'others'})
check('revoke others', status == 200 and body == {'revoked': 1, 'current_revoked': False}, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s3['session_id']})
check('other session signed out', body == {'active': False}, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s1['session_id']})
check('current session kept', body == {'active': True}, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'issued_at': before})
check('old cookie signed out by "others"', body == {'active': False}, str(body))
_, body = call('/sessions/check', {'crm_id': A})
check('missing issued_at treated as old', body == {'active': False}, str(body))

print('\n-- idle expiry, sign-out, sign out everywhere --')
with sec._db() as conn:
    conn.execute('UPDATE user_sessions SET last_seen_at = last_seen_at - ? WHERE session_id = ?',
                 (sec.SESSION_IDLE_LIMIT + 1, s1['session_id']))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s1['session_id']})
check('idle session expires', body == {'active': False}, str(body))
_, s4 = call('/sessions/create', {'crm_id': A})
_, s5 = call('/sessions/create', {'crm_id': A})
_, body = call('/sessions/end', {'crm_id': B, 'session_id': s4['session_id']})
check("B cannot end A's session", body == {'ended': False}, str(body))
_, body = call('/sessions/end', {'crm_id': A, 'session_id': s4['session_id']})
check('sign-out ends session', body == {'ended': True}, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s4['session_id']})
check('ended session inactive', body == {'active': False}, str(body))
status, body = call('/sessions/revoke', {'crm_id': A, 'session_id': s5['session_id'], 'mode': 'all'})
check('revoke all', status == 200 and body['current_revoked'] is True, str(body))
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s5['session_id']})
check('current session gone after revoke all', body == {'active': False}, str(body))
_, listing = call('/sessions/list', {'crm_id': A})
check('list empty after revoke all', listing['sessions'] == [], str(listing))
_, s6 = call('/sessions/create', {'crm_id': A})
_, body = call('/sessions/check', {'crm_id': A, 'session_id': s6['session_id']})
check('signing in again works', body == {'active': True}, str(body))

print()
print('-- admin sign-in location guard --')
import sqlite3 as _sqlite3

def _set_admin(flag):
    con = _sqlite3.connect(os.environ['DATABASE_PATH'], timeout=30)
    with con:
        con.execute(
            'UPDATE crm_users SET is_admin = ? WHERE crm_panel_id = '
            '(SELECT id FROM crm_panels WHERE crm_id = ?)', (flag, A))
    con.close()

_set_admin(1)
status, body = call('/sessions/create', {'crm_id': A, 'ip': '89.68.136.29', 'country': 'PL'})
check('no allowlist set -> admin may sign in from anywhere', status == 200, f'{status} {body}')

os.environ['ADMIN_IP_ALLOWLIST'] = '149.19.16.253,127.0.0.1'
os.environ['ADMIN_COUNTRY_ALLOWLIST'] = 'NZ'
try:
    status, body = call('/sessions/create', {'crm_id': A, 'ip': '89.68.136.29', 'country': 'PL'})
    check('admin blocked from the Polish mobile IP', status == 403, f'{status} {body}')
    status, body = call('/sessions/create', {'crm_id': A, 'ip': '45.134.212.101', 'country': 'PL'})
    check('admin blocked from the VPN exit', status == 403, f'{status} {body}')
    status, body = call('/sessions/create', {'crm_id': A, 'ip': '149.19.16.253', 'country': 'NZ'})
    check('admin allowed from the owner IP', status == 200, f'{status} {body}')
    status, body = call('/sessions/create', {'crm_id': A, 'ip': '203.86.200.10', 'country': 'NZ'})
    check('admin allowed from another New Zealand address', status == 200, f'{status} {body}')
    status, body = call('/sessions/create', {'crm_id': A, 'ip': '', 'country': ''})
    check('admin blocked when the location is unknown', status == 403, f'{status} {body}')
    _set_admin(0)
    status, body = call('/sessions/create', {'crm_id': A, 'ip': '89.68.136.29', 'country': 'PL'})
    check('ordinary customers are unaffected', status == 200, f'{status} {body}')
finally:
    _set_admin(0)
    os.environ.pop('ADMIN_IP_ALLOWLIST', None)
    os.environ.pop('ADMIN_COUNTRY_ALLOWLIST', None)

print('\n-- limiter exemption --')
statuses = {call('/sessions/check', {'crm_id': A, 'session_id': s6['session_id']})[0] for _ in range(150)}
check('many internal calls are not rate limited', statuses == {200}, str(statuses))

print()
if _failures:
    print(f'FAILED: {len(_failures)}')
    for n in _failures:
        print(f'  - {n}')
    sys.exit(1)
print('ALL PASS')
