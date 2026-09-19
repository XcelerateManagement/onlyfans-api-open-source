#!/usr/bin/env python3
"""Tests for the relogin circuit breaker in fansly_client.py.

Covers (mirroring of_client's breaker semantics):
  - concurrent 401 burst → exactly one login, success shared with all callers
  - token-paste account (no stored password) → persistent DB block
    (reason=auth_token_expired) + needs_reconnect surfaced on the 401 payload
  - blocked account fails fast (login never called) and keeps needs_reconnect
  - transient login failure → in-memory cooldown, no immediate retry
  - reconnecting via add_of_account clears the block
  - transport/proxy exceptions are translated into a clean 424 instead of
    escaping to the global 500 handler, and a non-transport exception still
    propagates so real bugs stay loud
  - a transport fault never trips the breaker (no login attempt, no cooldown,
    no DB block) — a dead proxy is not a credential problem — while a genuine
    credential rejection still does
  - proxied reason codes stay identical to of_client's (lib/proxy-error.ts)
  - fansly limit/offset slicing: chats + notifications normalizers

Runs against a throwaway DB — zero network calls (auth layer is monkeypatched).

    python tests/test_fansly_breaker.py
"""

import os
import sys
import tempfile
import threading

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import fansly_client               # noqa: E402
import fansly_normalize as fnorm   # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Fansly Breaker Test Panel')
CRM_ID = panel['crm_id']
ACC_PW = '111222333444555666'    # has stored password → real login path
ACC_TOK = '111222333444555667'   # token-paste connection → no password
ACC_PROXY = '111222333444555668'  # routes through a proxy → proxy_* reasons
ACC_CRED = '111222333444555669'   # dedicated to the credential-rejection block
PROXY_URL = 'http://user:pass@10.255.255.1:8080'

db.add_of_account(crm_id=CRM_ID, of_user_id=ACC_PW, email='fbrk@test.com',
                  password='pw123', username='fbrk_pw', platform='fansly')
db.add_of_account(crm_id=CRM_ID, of_user_id=ACC_TOK, email='fbrk2@test.com',
                  password=None, username='fbrk_tok', platform='fansly',
                  fansly_auth_token='deadtoken')
db.add_of_account(crm_id=CRM_ID, of_user_id=ACC_PROXY, email='fbrk3@test.com',
                  password='pw123', username='fbrk_proxy', platform='fansly',
                  proxy=PROXY_URL)
db.add_of_account(crm_id=CRM_ID, of_user_id=ACC_CRED, email='fbrk4@test.com',
                  password='pw123', username='fbrk_cred', platform='fansly')


class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


login_calls = []
login_done = threading.Event()


def _reset_breaker_state():
    fansly_client._relogin_locks.clear()
    fansly_client._relogin_cooldowns.clear()
    fansly_client._relogin_last_success.clear()
    login_calls.clear()
    login_done.clear()


def fake_login_success(email, password, proxy=None, device_id=None):
    login_calls.append(email)
    login_done.set()
    return {'success': True, 'account_id': ACC_PW, 'auth_token': 'tok2',
            'fansly_client_id': 'dev1', 'fansly_session_id': 'sess2'}


def fake_login_transient(email, password, proxy=None, device_id=None):
    login_calls.append(email)
    raise Exception('Fansly login failed: temporary upstream error')


def fake_login_rate_limited(email, password, proxy=None, device_id=None):
    login_calls.append(email)
    raise Exception('Fansly login failed: {"code":429,"details":"rate limited"}')


def fake_load(crm_id, account_id, proxy=None):
    return {'auth_token': 'tok', 'account_id': account_id}


def fake_request_401_until_login(session_data, path, method='GET', body=None):
    if login_done.is_set():
        return _Resp(200, {'success': True, 'response': {'ok': 1}})
    return _Resp(401, {'success': False, 'error': {'message': 'token expired'}})


_real_login = fansly_client.fansly_login.login
_real_save = fansly_client.fansly_auth.save_session
_real_load = fansly_client.fansly_auth.load_session
_real_mar = fansly_client.fansly_auth.make_authenticated_request

fansly_client.fansly_auth.save_session = lambda *a, **k: None
fansly_client.fansly_auth.load_session = fake_load
fansly_client.fansly_auth.make_authenticated_request = fake_request_401_until_login

print('\n── concurrent 401 burst → exactly one login, success shared ──')
_reset_breaker_state()
fansly_client.fansly_login.login = fake_login_success
results = []


def _worker():
    results.append(fansly_client.handle_fansly_request(CRM_ID, ACC_PW, '/api/v1/account/me'))


threads = [threading.Thread(target=_worker) for _ in range(8)]
for t in threads:
    t.start()
for t in threads:
    t.join()
check('all callers succeed', all(r[0] is True for r in results),
      str([(r[0], r[2]) for r in results]))
check('login called exactly once', len(login_calls) == 1, str(len(login_calls)))

print('\n── token-paste account → DB block (auth_token_expired) ──')
_reset_breaker_state()
ok, data, status, relogged = fansly_client.handle_fansly_request(
    CRM_ID, ACC_TOK, '/api/v1/account/me')
check('401 returned', status == 401 and not ok, f'{status} {data}')
check('reason auth_token_expired', (data or {}).get('reason') == 'auth_token_expired', str(data))
check('needs_reconnect flagged', (data or {}).get('needs_reconnect') is True, str(data))
acc = db.get_of_account(CRM_ID, ACC_TOK)
check('block persisted in DB', bool(acc.get('relogin_blocked_at')))
check('login never called', login_calls == [], str(login_calls))

print('\n── blocked account fails fast, keeps needs_reconnect ──')
ok, data, status, _ = fansly_client.handle_fansly_request(CRM_ID, ACC_TOK, '/api/v1/account/me')
check('fails fast 401', status == 401 and not ok, f'{status} {data}')
check('reason blocked', (data or {}).get('reason') == 'blocked', str(data))
check('needs_reconnect kept', (data or {}).get('needs_reconnect') is True, str(data))
check('login still never called', login_calls == [], str(login_calls))

print('\n── reconnect (add_of_account) clears the block ──')
db.add_of_account(crm_id=CRM_ID, of_user_id=ACC_TOK, email='fbrk2@test.com',
                  password=None, username='fbrk_tok', platform='fansly',
                  fansly_auth_token='freshtoken')
acc = db.get_of_account(CRM_ID, ACC_TOK)
check('block cleared', not acc.get('relogin_blocked_at'), str(acc.get('relogin_blocked_at')))

print('\n── transient login failure → cooldown, no immediate retry ──')
_reset_breaker_state()
fansly_client.fansly_login.login = fake_login_transient
session, err = fansly_client.attempt_relogin(CRM_ID, ACC_PW)
check('transient failure returned', session is None and (err or {}).get('reason') == 'login_failed',
      str(err))
acc = db.get_of_account(CRM_ID, ACC_PW)
check('transient failure does NOT block', not acc.get('relogin_blocked_at'))
login_calls.clear()
session, err = fansly_client.attempt_relogin(CRM_ID, ACC_PW)
check('cooldown reason on retry', (err or {}).get('reason') == 'cooldown', str(err))
check('login not re-called during cooldown', login_calls == [], str(login_calls))

print('\n── login rate limit → persistent rate_limited, never password failure ──')
_reset_breaker_state()
fansly_client.fansly_login.login = fake_login_rate_limited
fansly_client.fansly_auth.make_authenticated_request = (
    lambda *args, **kwargs: _Resp(
        401, {'success': False, 'error': {'message': 'token expired'}}
    )
)
ok, data, status, _ = fansly_client.handle_fansly_request(
    CRM_ID, ACC_PW, '/api/v1/trackinglinks'
)
check('rate-limited relogin returns 429', status == 429 and not ok,
      f'{status} {data}')
check('rate-limited state returned',
      (data or {}).get('connection_state') == 'rate_limited', str(data))
check('rate limit never claims invalid credentials',
      (data or {}).get('reason') != 'invalid_credentials', str(data))
acc = db.get_of_account(CRM_ID, ACC_PW)
check('rate-limited state persisted',
      acc.get('last_connection_state') == 'rate_limited', str(acc))
fansly_client.fansly_auth.make_authenticated_request = fake_request_401_until_login

print('\n── refreshed login still denied → temporary_error, no password claim ──')
_reset_breaker_state()
fansly_client.fansly_login.login = fake_login_success
fansly_client.fansly_auth.make_authenticated_request = (
    lambda *args, **kwargs: _Resp(
        401, {'success': False, 'error': {'message': 'endpoint denied'}}
    )
)
ok, data, status, _ = fansly_client.handle_fansly_request(
    CRM_ID, ACC_PW, '/api/v1/trackinglinks'
)
check('endpoint denial is a 424 dependency failure', status == 424 and not ok,
      f'{status} {data}')
check('endpoint denial is temporary_error',
      (data or {}).get('connection_state') == 'temporary_error', str(data))
check('endpoint denial never claims invalid credentials',
      (data or {}).get('reason') != 'invalid_credentials', str(data))
check('only one real login was attempted', len(login_calls) == 1, str(login_calls))
acc = db.get_of_account(CRM_ID, ACC_PW)
check('temporary endpoint state persisted',
      acc.get('last_connection_state') == 'temporary_error', str(acc))
fansly_client.fansly_auth.make_authenticated_request = fake_request_401_until_login

print('\n── transport failure is translated, not raised ──')
_reset_breaker_state()
fansly_client.fansly_login.login = fake_login_success


def _raise_timeout(session_data, path, method='GET', body=None):
    raise Exception('Failed to perform, curl: (28) Operation timed out after 30000 ms')


fansly_client.fansly_auth.make_authenticated_request = _raise_timeout
ok, data, status, raised = None, None, None, False
try:
    ok, data, status, _relogged = fansly_client.handle_fansly_request(
        CRM_ID, ACC_PW, '/api/v1/account/me')
except Exception as exc:
    raised = True
    data = {'exc': str(exc)}
check('transport exception does not escape', not raised, str(data))
check('424 returned', status == 424 and ok is False, f'{status} {data}')
check('classified as a timeout', (data or {}).get('reason') == 'network_timeout', str(data))
check('raw curl string never reaches the caller',
      'curl' not in str((data or {}).get('error', '')).lower(), str(data))

print('\n── a dead proxy/network does NOT trip the relogin breaker ──')
# The whole point of short-circuiting before is_session_expired: a transport
# fault must not consume a login attempt, arm a cooldown, or DB-block an
# account whose credentials are perfectly fine.
check('relogin never attempted', login_calls == [], str(login_calls))
check('no cooldown armed', fansly_client._relogin_cooldowns == {},
      str(fansly_client._relogin_cooldowns))
acc = db.get_of_account(CRM_ID, ACC_PW)
check('account not blocked in DB', not acc.get('relogin_blocked_at'),
      str(acc.get('relogin_blocked_at')))
check('needs_reconnect not claimed', (data or {}).get('needs_reconnect') is not True, str(data))

print('\n── proxied account → proxy_* reason (dashboard fix-proxy flow) ──')
_reset_breaker_state()
ok, data, status, _relogged = fansly_client.handle_fansly_request(
    CRM_ID, ACC_PROXY, '/api/v1/account/me')
check('proxy_timeout when a proxy is configured',
      (data or {}).get('reason') == 'proxy_timeout', str(data))
check('message names the proxy', 'proxy' in str((data or {}).get('error', '')).lower(), str(data))

print('\n── proxied reason codes stay identical to of_client ──')
# lib/proxy-error.ts keys its inline "fix proxy" flow off these exact strings,
# so the two clients must agree wherever a proxy is in play.
import of_client  # noqa: E402
for _text in ('CONNECT tunnel failed, response 407',
              'Recv failure: Connection reset by peer',
              'curl: (28) Operation timed out',
              'curl: (6) Could not resolve host',
              'curl: (7) Failed to connect: Connection refused',
              'SSL certificate problem',
              'Failed to perform'):
    _of_msg, _of_reason = of_client.translate_transport_error(Exception(_text))
    _f_msg, _f_reason = fansly_client.translate_transport_error(
        Exception(_text), proxy=PROXY_URL)
    check(f'reason matches of_client for {_text[:34]!r}', _f_reason == _of_reason,
          f'of={_of_reason} fansly={_f_reason}')

print('\n── a non-transport exception still propagates (real bugs stay loud) ──')


def _raise_bug(session_data, path, method='GET', body=None):
    raise KeyError('user_id')


fansly_client.fansly_auth.make_authenticated_request = _raise_bug
propagated = False
try:
    fansly_client.handle_fansly_request(CRM_ID, ACC_PW, '/api/v1/account/me')
except KeyError:
    propagated = True
check('non-transport exception re-raised', propagated)

print('\n── transport failure during re-login → cooldown, never a block ──')
_reset_breaker_state()
fansly_client.fansly_auth.make_authenticated_request = fake_request_401_until_login


def fake_login_transport(email, password, proxy=None, device_id=None):
    login_calls.append(email)
    raise Exception('Failed to perform, curl: (56) CONNECT tunnel failed, response 407')


fansly_client.fansly_login.login = fake_login_transport
session, err = fansly_client.attempt_relogin(CRM_ID, ACC_PROXY, proxy=PROXY_URL)
check('login_failed (not invalid_credentials)', (err or {}).get('reason') == 'login_failed', str(err))
check('407 translated for the operator',
      'Proxy authentication failed' in str((err or {}).get('message', '')), str(err))
check('no raw curl in the message', 'curl' not in str((err or {}).get('message', '')).lower(), str(err))
acc = db.get_of_account(CRM_ID, ACC_PROXY)
check('dead proxy does NOT block the account', not acc.get('relogin_blocked_at'),
      str(acc.get('relogin_blocked_at')))

print('\n── genuine credential rejection still trips the breaker ──')
_reset_breaker_state()


def fake_login_badpw(email, password, proxy=None, device_id=None):
    login_calls.append(email)
    raise Exception('Fansly login failed: invalid password')


fansly_client.fansly_login.login = fake_login_badpw
session, err = fansly_client.attempt_relogin(CRM_ID, ACC_CRED)
check('reason invalid_credentials', (err or {}).get('reason') == 'invalid_credentials', str(err))
acc = db.get_of_account(CRM_ID, ACC_CRED)
check('credential rejection persists a DB block', bool(acc.get('relogin_blocked_at')))
login_calls.clear()
session, err = fansly_client.attempt_relogin(CRM_ID, ACC_CRED)
check('blocked account fails fast', (err or {}).get('reason') == 'blocked', str(err))
check('login not re-called once blocked', login_calls == [], str(login_calls))

print('\n── fansly limit/offset slicing (chats + notifications) ──')
groups_env = {
    'success': True,
    'response': {
        'data': [{'groupId': str(i), 'partnerAccountId': str(100 + i)} for i in range(5)],
        'aggregationData': {'accounts': [], 'groups': []},
    },
}
body = fnorm.normalize_chats(groups_env, limit=2, offset=0)
check('chats limit=2 slices', len(body['chats']) == 2 and body['hasMore'] is True,
      f"n={len(body['chats'])} hasMore={body['hasMore']}")
body = fnorm.normalize_chats(groups_env, limit=2, offset=4)
check('chats offset=4 tail', len(body['chats']) == 1 and body['hasMore'] is False,
      f"n={len(body['chats'])}")
body = fnorm.normalize_chats(groups_env)
check('chats limit=None keeps all (export path)', len(body['chats']) == 5,
      str(len(body['chats'])))
notif_env = {
    'success': True,
    'response': {
        'notifications': [{'id': str(i), 'type': 7101, 'correlationId': None,
                           'createdAt': 1752600000, 'acknowledgedAt': None} for i in range(3)],
        'tips': [], 'accounts': [], 'messages': [],
    },
}
body = fnorm.normalize_notifications(notif_env, limit=1)
check('notifications limit=1 slices + count matches',
      len(body['notifications']) == 1 and body['count'] == 1,
      f"n={len(body['notifications'])} count={body['count']}")
body = fnorm.normalize_notifications(notif_env)
check('notifications limit=None keeps all', len(body['notifications']) == 3,
      str(len(body['notifications'])))

fansly_client.fansly_login.login = _real_login
fansly_client.fansly_auth.save_session = _real_save
fansly_client.fansly_auth.load_session = _real_load
fansly_client.fansly_auth.make_authenticated_request = _real_mar

print()
if _failures:
    print(f'{len(_failures)} FAILURE(S): {_failures}')
    sys.exit(1)
print('ALL PASS')
