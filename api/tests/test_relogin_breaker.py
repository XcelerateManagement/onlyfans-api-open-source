#!/usr/bin/env python3
"""Tests for the relogin circuit breaker in of_client.py.

Covers:
  - credential rejection sets a persistent DB block (no more paid attempts)
  - blocked accounts fail fast without calling login
  - transient failures set an in-memory cooldown
  - a fresh success is shared with concurrent callers (single login per burst)
  - reconnecting via add_of_account clears the block
  - handle_of_request surfaces needs_reconnect on blocked accounts
  - GET /accounts exposes needs_reconnect

Runs against a throwaway DB — zero network calls (login is monkeypatched).

    python tests/test_relogin_breaker.py
"""

import os
import sys
import tempfile
import threading

# Isolate from the real deployment BEFORE importing app modules.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import of_client                   # noqa: E402
import crm_api                     # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Breaker Test Panel')
CRM_ID = panel['crm_id']
API_KEY = panel['api_key']
OF_USER_ID = '999000111'

db.add_of_account(
    crm_id=CRM_ID, of_user_id=OF_USER_ID,
    email='breaker@test.com', password='old-password',
    username='breakertester', x_bc='xbc', x_hash='xh', proxy=None,
)

login_calls = []


def _reset_breaker_state():
    of_client._relogin_locks.clear()
    of_client._relogin_cooldowns.clear()
    of_client._relogin_last_success.clear()
    login_calls.clear()


class _FakeLogin:
    """Stands in for login_module.login."""
    def __init__(self, outcome):
        self.outcome = outcome  # exception instance OR result dict

    def __call__(self, email, password, use_captcha=True, proxy=None, **kwargs):
        login_calls.append(email)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


_real_login = of_client.login_module.login
_real_save_session = of_client.mt_auth.save_session

print('\n── credential rejection → persistent block ──')
_reset_breaker_state()
of_client.login_module.login = _FakeLogin(Exception('Login failed: Wrong email or password'))
session, err = of_client.attempt_relogin(CRM_ID, OF_USER_ID)
check('relogin fails', session is None)
check('safe password reason returned', 'saved password' in (err or '').lower(), err)
acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('block persisted in DB', bool(acc.get('relogin_blocked_at')))
check('invalid_password code persisted', acc.get('relogin_block_code') == 'invalid_password', str(acc))
check('reconnect action persisted', acc.get('relogin_block_action') == 'reconnect', str(acc))

print('\n── blocked account fails fast, login never called ──')
login_calls.clear()
session, err = of_client.attempt_relogin(CRM_ID, OF_USER_ID)
check('fails fast', session is None and 'paused' in (err or '').lower(), err)
check('login not called', login_calls == [], str(login_calls))

print('\n── handle_of_request surfaces needs_reconnect ──')


class _DeniedResponse:
    status_code = 403

    @staticmethod
    def json():
        return {'error': {'message': 'Access denied.'}}


of_client.mt_auth.load_session = lambda *a, **k: {'cookies': {}, 'user_id': OF_USER_ID}
of_client.mt_auth.make_authenticated_request = lambda *a, **k: _DeniedResponse()
ok, payload, status, relogged = of_client.handle_of_request(CRM_ID, OF_USER_ID, '/api2/v2/users/me')
check('401 returned', status == 401, str(status))
check('needs_reconnect flagged', payload.get('needs_reconnect') is True, str(payload))
check('relogin_failed flagged', payload.get('relogin_failed') is True)
check('connection_state is login_failed', payload.get('connection_state') == 'login_failed', str(payload))
check('structured code returned', payload.get('login_failure', {}).get('code') == 'invalid_password', str(payload))

print('\n── reconnect (add_of_account) clears the block ──')
db.add_of_account(
    crm_id=CRM_ID, of_user_id=OF_USER_ID,
    email='breaker@test.com', password='new-password',
    username='breakertester', x_bc='xbc2', x_hash='xh2', proxy=None,
)
acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('block cleared', not acc.get('relogin_blocked_at'), str(acc.get('relogin_blocked_at')))
check('structured failure cleared', not acc.get('relogin_block_code') and not acc.get('relogin_block_action'), str(acc))
check('failure counter cleared', acc.get('polling_failure_count') == 0, str(acc))
check('new password stored', acc.get('password') == 'new-password')

print('\n── transient failure → cooldown, no immediate retry ──')
_reset_breaker_state()
of_client.login_module.login = _FakeLogin(Exception('Login failed: Too many requests.'))
session, err = of_client.attempt_relogin(CRM_ID, OF_USER_ID)
check('transient failure returned', session is None)
acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('transient failure does NOT block', not acc.get('relogin_blocked_at'))
login_calls.clear()
session, err = of_client.attempt_relogin(CRM_ID, OF_USER_ID)
check('cooldown message', 'paused' in (err or '').lower(), err)
check('login not re-called during cooldown', login_calls == [], str(login_calls))

print('\n── concurrent burst → exactly one login, success shared ──')
_reset_breaker_state()
fake_result = {'user_id': OF_USER_ID, 'x_bc': 'xbc3', 'x_hash': 'xh3',
               'cookies': {'sess': 's'}, 'data': {}}
of_client.login_module.login = _FakeLogin(fake_result)
of_client.mt_auth.save_session = lambda *a, **k: None
results = []


def _worker():
    results.append(of_client.attempt_relogin(CRM_ID, OF_USER_ID))


threads = [threading.Thread(target=_worker) for _ in range(8)]
for t in threads:
    t.start()
for t in threads:
    t.join()
check('all callers got the session', all(r[0] is fake_result and r[1] is None for r in results),
      str(results[:2]))
check('login called exactly once', len(login_calls) == 1, str(len(login_calls)))

print('\n── GET /accounts exposes needs_reconnect ──')
db.set_relogin_block(
    CRM_ID, OF_USER_ID,
    'OnlyFans rejected the saved password. It may have been changed.',
    code='invalid_password', action='reconnect')
client = crm_api.app.test_client()
resp = client.get(f'/api/crm/{CRM_ID}/accounts', headers={'X-API-Key': API_KEY})
check('accounts 200', resp.status_code == 200, str(resp.status_code))
accounts = resp.get_json()['accounts']
target = next(a for a in accounts if a['of_user_id'] == OF_USER_ID)
check('needs_reconnect true in API', target.get('needs_reconnect') is True, str(target))
check('reason present in API', bool(target.get('relogin_block_reason')))
check('API connection_state', target.get('connection_state') == 'login_failed', str(target))
check('structured block returned safely', target.get('login_failure', {}).get('code') == 'invalid_password', str(target))

print('\n── direct login returns the same safe contract ──')
of_client.login_module.login = _FakeLogin(Exception(
    'Login failed: Wrong email or password RAW cookie=secret'))
resp = client.post(
    f'/api/crm/{CRM_ID}/accounts/login',
    headers={'X-API-Key': API_KEY},
    json={'email': 'new@test.com', 'password': 'old-password'},
)
body = resp.get_json()
check('direct bad password is 400', resp.status_code == 400, str(resp.status_code))
check('direct login_failed state', body.get('connection_state') == 'login_failed', str(body))
check('direct invalid_password code', body.get('login_failure', {}).get('code') == 'invalid_password', str(body))
check('direct raw error hidden', 'RAW' not in str(body) and 'cookie=secret' not in str(body), str(body))

of_client.login_module.login = _FakeLogin(Exception(
    'Proxy authentication failed: 407 proxy password=secret'))
resp = client.post(
    f'/api/crm/{CRM_ID}/accounts/login',
    headers={'X-API-Key': API_KEY},
    json={'email': 'new@test.com', 'password': 'old-password'},
)
body = resp.get_json()
check('proxy failure is not login_failed', body.get('connection_state') == 'proxy_error', str(body))
check('proxy raw error hidden', 'password=secret' not in str(body), str(body))

of_client.login_module.login = _real_login
of_client.mt_auth.save_session = _real_save_session

print()
if _failures:
    print(f'{len(_failures)} FAILURE(S): {_failures}')
    sys.exit(1)
print('ALL PASS')
