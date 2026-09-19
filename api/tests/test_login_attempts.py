#!/usr/bin/env python3
"""The connect-attempt debugging store: encryption, classification, fail-open,
route logging, and the admin gate.

    python tests/test_login_attempts.py
"""

import os
import sys
import tempfile

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import login_attempts              # noqa: E402
import crm_api                     # noqa: E402

db.init_database()
_failures = []


def check(name, cond, detail=''):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── encryption round-trip + masking ─────────────────────────────────────────
print('\n-- store round-trip --')
aid = login_attempts.record_start(
    crm_id='crm_a', owner_email='owner@e.test', platform='onlyfans',
    identifier='creator@e.test', password='synthetic-secret',
    proxy='http://puser:ppass@9.9.9.9:8080', cookies={'sess': 'tok'})
check('record_start returns an id', isinstance(aid, int) and aid > 0, str(aid))
login_attempts.record_finish(aid, 424, {
    'reason': 'proxy_blocked', 'error': 'Proxy blocked: ...',
    'blocked_ip': '69.17.1.26', 'ray_id': 'ray123'})

listed = login_attempts.list_attempts(crm_id='crm_a')
row = listed[0]
check('list masks the proxy password', row['proxy'] == '9.9.9.9:8080', row['proxy'])
check('list never carries the raw password', 'password' not in row and row['has_password'] is True)
check('outcome classified from body', row['outcome'] == 'proxy_blocked', row['outcome'])
check('blocked_ip captured', row['blocked_ip'] == '69.17.1.26', row['blocked_ip'])
check('latency recorded', isinstance(row['latency_ms'], int))

full = login_attempts.get(aid, reveal=True)
check('reveal decrypts the password', full['password'] == 'synthetic-secret', str(full.get('password')))
check('reveal decrypts cookies to a dict', full['cookies'] == {'sess': 'tok'}, str(full.get('cookies')))
check('reveal returns the full proxy', full['proxy'] == 'http://puser:ppass@9.9.9.9:8080')

masked_get = login_attempts.get(aid, reveal=False)
check('no-reveal get masks the proxy and omits secrets',
      masked_get['proxy'] == '9.9.9.9:8080' and 'password' not in masked_get)

# Ciphertext at rest, not plaintext.
import sqlite3  # noqa: E402
conn = sqlite3.connect(os.environ['DATABASE_PATH'])
enc_pw, enc_ck = conn.execute(
    'SELECT encrypted_password, encrypted_cookies FROM login_attempts WHERE id=?',
    (aid,)).fetchone()
conn.close()
check('password stored encrypted (gAAAAA Fernet)', (enc_pw or '').startswith('gAAAAA'), str(enc_pw)[:12])
check('cookies stored encrypted', (enc_ck or '').startswith('gAAAAA'))
check('plaintext password is NOT in the row', 'synthetic-secret' not in (enc_pw or ''))


# ── classification ──────────────────────────────────────────────────────────
print('\n-- outcome classification --')
cases = [
    (200, {'success': True, 'of_user_id': '55'}, 'connected'),
    (200, {'success': False, 'requires_2fa': True}, 'needs_2fa'),
    (200, {'success': False, 'requires_verification': True}, 'needs_verification'),
    (424, {'reason': 'proxy_blocked'}, 'proxy_blocked'),
    (400, {'reason': 'invalid_password', 'connection_state': 'login_failed'}, 'invalid_password'),
    (503, {'reason': 'temporary_error'}, 'temporary_error'),
    (500, {}, 'failed'),
]
for status, body, expected in cases:
    outcome = login_attempts._classify(status, body)[0]
    check(f'{status} {body} -> {expected}', outcome == expected, outcome)


# ── fail-open ────────────────────────────────────────────────────────────────
print('\n-- fail-open --')
_orig = login_attempts._db_path
login_attempts._db_path = lambda: '/nonexistent/dir/nope.db'
check('record_start never raises on a broken db', login_attempts.record_start(
    crm_id='x', identifier='y', password='z') is None)
try:
    login_attempts.record_finish(123, 500, {'reason': 'x'})
    ok = True
except Exception:
    ok = False
check('record_finish never raises on a broken db', ok)
login_attempts._db_path = _orig

os.environ['LOGIN_ATTEMPTS_ENABLED'] = 'false'
import importlib  # noqa: E402
importlib.reload(login_attempts)
check('disabled: record_start returns None', login_attempts.record_start(crm_id='x') is None)
os.environ['LOGIN_ATTEMPTS_ENABLED'] = 'true'
importlib.reload(login_attempts)


# ── route logging: a failed connect writes a row ────────────────────────────
print('\n-- route logs every attempt --')
panel = db.create_crm_panel('Attempt Log Panel')
CRM_ID = panel['crm_id']
HEADERS = {'X-API-Key': panel['api_key']}
client = crm_api.app.test_client()
_real_login = crm_api.login_module.login
try:
    crm_api.login_module.login = lambda *a, **k: (_ for _ in ()).throw(
        Exception('Login failed: Wrong email or password'))
    r = client.post(f'/api/crm/{CRM_ID}/accounts/login', headers=HEADERS,
                    json={'email': 'logme@e.test', 'password': 'synthetic-pw-123',
                          'proxy': 'http://u:p@1.2.3.4:8080'})
    check('failed login returns 400', r.status_code == 400, str(r.status_code))
    rows = login_attempts.list_attempts(crm_id=CRM_ID)
    check('a row was written for the failed attempt', len(rows) >= 1, str(len(rows)))
    if rows:
        a = rows[0]
        check('identifier captured', a['identifier'] == 'logme@e.test', str(a['identifier']))
        check('failed-attempt password was still stored (encrypted)', a['has_password'] is True)
        check('outcome is the terminal reason', a['outcome'] == 'invalid_password', a['outcome'])
        check('proxy stored + masked in list', a['proxy'] == '1.2.3.4:8080', a['proxy'])
finally:
    crm_api.login_module.login = _real_login


# ── admin gate ───────────────────────────────────────────────────────────────
print('\n-- admin endpoints require admin --')
r = client.get('/api/admin/login-attempts')
check('list without admin creds is rejected', r.status_code in (401, 403), str(r.status_code))
r = client.get('/api/admin/login-attempts/1')
check('detail without admin creds is rejected', r.status_code in (401, 403), str(r.status_code))
r = client.post('/api/admin/login-attempts/1/retest')
check('retest without admin creds is rejected', r.status_code in (401, 403), str(r.status_code))


print()
if _failures:
    print(f'FAILED: {len(_failures)}')
    for n in _failures:
        print(f'  - {n}')
    sys.exit(1)
print('ALL PASS')
