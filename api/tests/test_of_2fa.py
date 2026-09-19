#!/usr/bin/env python3
"""Tests for the OnlyFans 2FA path: login.verify_otp, the code-101/105 split,
the OTP endpoint fallback chain, and TWO_FA_SESSION_EXPIRY enforcement.

Covers:
  - verify_otp's signature is EXACTLY what crm_api.verify_otp_account calls
  - a successful verify_otp returns the same shape login() returns
  - login() parses OF error 101 into otpState instead of raising
  - OF error 105 is terminal face_id, never retried, never a code prompt
  - the endpoint fallback tries candidate 2 when candidate 1 404s, then sticks
  - x_bc is preserved byte-for-byte across login → OTP submit → result
  - an expired two_fa_sessions row reads as absent, and the sweeper drops it
  - a wrong code is a clean credential rejection, not a 500

Every network call is stubbed — no OnlyFans traffic, no OTP is ever sent.
Runs against a throwaway DB.

    python tests/test_of_2fa.py
"""

import inspect
import os
import sys
import tempfile
from datetime import datetime, timedelta

# Isolate from the real deployment BEFORE importing app modules.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config                      # noqa: E402
import crm_database as db          # noqa: E402
import login as login_module       # noqa: E402
import of_client                   # noqa: E402
import crm_api                     # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Network stubs ──────────────────────────────────────────────────────────
# Nothing below touches OnlyFans. `generate_headers` shells out to Node, so it
# is stubbed too — this suite must run with no network and no node binary.

_SIGN_CALLS = []


def _fake_generate_headers(path, user_id=0):
    _SIGN_CALLS.append((path, user_id))
    return {
        'sign': f'sign-for-{path}-{len(_SIGN_CALLS)}',
        'time': str(1700000000 + len(_SIGN_CALLS)),
        'app-token': 'app-token',
        # A *fresh* x-bc, which verify_otp must NOT use — it must carry the one
        # it was handed. If this value ever shows up on the wire, the pending
        # challenge on OF's side would be invalidated.
        'x-bc': 'FRESH-XBC-MUST-NOT-BE-USED',
    }


login_module.generate_headers = _fake_generate_headers


class _FakeResponse:
    def __init__(self, status_code, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text else (str(payload) if payload is not None else '')

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


class _FakeCookieJar(dict):
    def set(self, name, value, domain=None, path=None):
        self[name] = value


class _FakeSession:
    """Stands in for curl_cffi.requests.Session. Records every request."""

    instances = []

    def __init__(self, impersonate=None):
        self.impersonate = impersonate
        self.proxies = None
        self.cookies = _FakeCookieJar()
        self.requests = []
        _FakeSession.instances.append(self)

    # Responses are supplied by the active scenario via _RESPONDER.
    def post(self, url, headers=None, json=None, timeout=None, **kw):
        self.requests.append(('POST', url, headers or {}, json, timeout))
        return _RESPONDER('POST', url, headers or {}, json)

    def get(self, url, headers=None, params=None, timeout=None, **kw):
        self.requests.append(('GET', url, headers or {}, None, timeout))
        return _RESPONDER('GET', url, headers or {}, None)


_RESPONDER = lambda *a: _FakeResponse(500)  # noqa: E731 — replaced per scenario


class _FakeRequestsModule:
    Session = _FakeSession


login_module.requests = _FakeRequestsModule


def _reset_transport():
    _FakeSession.instances.clear()
    _SIGN_CALLS.clear()
    login_module.reset_otp_endpoint_cache()


OTP_CHECK_URL = f'{config.OF_BASE_URL}/api2/v2/users/otp/check'
VERIFY_CODE_URL = f'{config.OF_BASE_URL}/api2/v2/users/verify-code'
ME_URL = f'{config.OF_BASE_URL}/api2/v2/users/me'

LOGIN_XBC = 'XBC-FROM-THE-LOGIN-THAT-RAISED-101'
LOGIN_COOKIES = {'sess': 'partial-auth-sess', 'fp': 'fp-value'}


# ── The signature is the contract ──────────────────────────────────────────
print('\n── verify_otp signature matches the existing call site ──')

check('login.verify_otp exists', hasattr(login_module, 'verify_otp'))
sig = inspect.signature(login_module.verify_otp)
check('parameter names + order',
      list(sig.parameters) == ['email', 'otp_code', 'x_bc', 'x_hash', 'cookies', 'proxy'],
      str(list(sig.parameters)))
check('proxy is optional', sig.parameters['proxy'].default is None,
      str(sig.parameters['proxy'].default))
# The keywords crm_api.verify_otp_account actually passes, read out of the source
# so this test fails if the route is edited to call it differently.
route_src = inspect.getsource(crm_api.verify_otp_account)
call_kwargs = {'email', 'otp_code', 'x_bc', 'x_hash', 'cookies', 'proxy'}
check('every kwarg the route passes is accepted',
      all(f'{k}=' in route_src for k in call_kwargs)
      and call_kwargs.issubset(set(sig.parameters)),
      str(sorted(call_kwargs - set(sig.parameters))))
try:
    sig.bind(email='a@b.c', otp_code='123456', x_bc='x', x_hash='h',
             cookies={}, proxy=None)
    bound_ok = True
except TypeError as e:
    bound_ok = False
    print(f'    bind error: {e}')
check('call site binds cleanly', bound_ok)


# ── login() turns error 101 into an otpState, not an exception ─────────────
print('\n── login() parses OF error 101 into otpState ──')

OTP_STATE_EMAIL = {
    'email': True, 'phoneOtp': False, 'appOtp': False, 'faceOtp': False,
    'forceFaceOtp': False, 'phoneLast4': '', 'phoneCode': {}, 'faceCode': {},
    'emailCode': {},
}


def _login_responder(code, payload=None, status=400):
    """Responder for a login() run: /me → 200, CDN hash → 200, login → error."""
    def respond(method, url, headers, body):
        if url.endswith('/users/me'):
            return _FakeResponse(200, {'id': 1})
        if 'cdn2' in url:
            return _FakeResponse(200, text='the-x-hash')
        if url.endswith('/users/login'):
            return _FakeResponse(status, {'error': {
                'code': code, 'message': 'Please enter the code',
                'payload': payload or {},
            }})
        return _FakeResponse(404, {})
    return respond


_reset_transport()
_RESPONDER = _login_responder(101, {'otpState': OTP_STATE_EMAIL, 'strong': False})
result_101 = login_module.login('user@test.com', 'pw', use_captcha=False, proxy=None)
check('does not raise', isinstance(result_101, dict))
check('requires_2fa flagged', result_101.get('requires_2fa') is True, str(result_101.get('status')))
check('status is requires_2fa', result_101.get('status') == 'requires_2fa')
check('otpState carried through', result_101.get('otp_state') == OTP_STATE_EMAIL,
      str(result_101.get('otp_state')))
check('otp_methods derived', result_101.get('otp_methods') == ['email'],
      str(result_101.get('otp_methods')))
check('user_id is None (nothing to save)', result_101.get('user_id') is None)
check('cookies carried through', result_101.get('cookies') == {},
      str(result_101.get('cookies')))
check('x_bc present for the OTP step', bool(result_101.get('x_bc')))
LOGIN_101_XBC = result_101.get('x_bc')

# Every factor combination a UI has to render.
check('otp_methods for sms', login_module._otp_methods({'phoneOtp': True}) == ['sms'])
check('otp_methods for app', login_module._otp_methods({'appOtp': True}) == ['app'])
check('otp_methods for face', login_module._otp_methods({'faceOtp': True}) == ['face'])
check('otp_methods on garbage', login_module._otp_methods(None) == [])


# ── 105 is face id: terminal, never a code prompt ──────────────────────────
print('\n── OF error 105 is terminal face_id, never retried ──')

_reset_transport()
_RESPONDER = _login_responder(105, {'otpState': {'faceOtp': True, 'forceFaceOtp': True}})
raised = None
try:
    login_module.login('user@test.com', 'pw', use_captcha=False, proxy=None)
except Exception as e:
    raised = e
check('login() raises on 105', raised is not None)
check('message names the face check', 'face' in str(raised).lower(), str(raised))
check('message points at the verification flow',
      'face-id/start' in str(raised).lower() or 'verify' in str(raised).lower(),
      str(raised))
check('never reported as requires_2fa', 'requires_2fa' not in str(raised).lower())
check('prefixed "Login failed:" so the route returns 400 not 500',
      str(raised).startswith('Login failed:'), str(raised))

# ... and on the verify_otp side.
_reset_transport()
_RESPONDER = lambda m, u, h, b: _FakeResponse(400, {'error': {  # noqa: E731
    'code': 105, 'message': 'security check',
    'payload': {'otpState': {'faceOtp': True}},
}})
face = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                               x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
check('verify_otp status face_id_required', face.get('status') == 'face_id_required',
      str(face.get('status')))
check('face_id is NOT retryable', face.get('retryable') is False, str(face.get('retryable')))
check('face_id success False', face.get('success') is False)
check('face_id message points at the verification flow',
      'face-id/start' in face.get('error', '').lower()
      or 'verify' in face.get('error', '').lower(),
      face.get('error', ''))
posts = [r for r in _FakeSession.instances[-1].requests if r[0] == 'POST']
check('face_id submitted exactly once (no retry)', len(posts) == 1, str(len(posts)))


# ── Success: same shape login() returns ────────────────────────────────────
print('\n── verify_otp success returns login()\'s shape ──')

USER_PAYLOAD = {'id': 55512345, 'username': 'creator', 'name': 'Creator',
                'avatar': 'https://cdn/av.jpg', 'about': 'hi'}


def _success_responder(method, url, headers, body):
    if url == OTP_CHECK_URL:
        return _FakeResponse(200, {'success': True})   # no user object echoed
    if url == ME_URL:
        return _FakeResponse(200, USER_PAYLOAD)
    return _FakeResponse(404, {})


_reset_transport()
_RESPONDER = _success_responder
ok = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                             x_hash='the-hash', cookies=LOGIN_COOKIES,
                             proxy='http://user:pw@proxy:8080')

# The exact keys login()'s success return carries — both feed
# mt_auth.save_session(crm_id, result['user_id'], result, ...).
LOGIN_SUCCESS_KEYS = {'user_id', 'data', 'cookies', 'x_hash', 'x_bc', 'session'}
check('success True', ok.get('success') is True, str(ok.get('status')))
check('status success', ok.get('status') == 'success')
check('carries every login() key', LOGIN_SUCCESS_KEYS.issubset(set(ok)),
      str(sorted(LOGIN_SUCCESS_KEYS - set(ok))))
check('user_id resolved from /users/me', ok.get('user_id') == '55512345',
      str(ok.get('user_id')))
check('user_id is a str like login()', isinstance(ok.get('user_id'), str))
check('data is the user object', ok.get('data', {}).get('username') == 'creator')
check('x_hash preserved', ok.get('x_hash') == 'the-hash')
check('session object returned', ok.get('session') is not None)
check('reports which endpoint worked', ok.get('otp_endpoint') == '/api2/v2/users/otp/check',
      str(ok.get('otp_endpoint')))
check('proxy applied to the session',
      ok['session'].proxies == {'http': 'http://user:pw@proxy:8080',
                                'https': 'http://user:pw@proxy:8080'},
      str(ok['session'].proxies))

# save_session must survive on this dict verbatim — it is the whole point of
# "same shape". Nothing here touches the network or the real sessions dir.
saved = {}


def _capture_save(crm_id, of_user_id, session_data, proxy=None):
    saved['args'] = (crm_id, of_user_id, proxy)
    saved['payload'] = {
        'user_id': session_data['user_id'],
        'data': session_data.get('data', {}),
        'cookies': session_data.get('cookies', {}),
        'x_hash': session_data.get('x_hash'),
        'x_bc': session_data.get('x_bc'),
    }


_capture_save('crm-x', ok['user_id'], ok, proxy=None)
check('save_session-shaped access works', saved['payload']['user_id'] == '55512345',
      str(saved))

# /users/otp/check echoing a user id is NOT proof the session works. OF accepts
# the code and returns {"userId": N} for an account it still gates behind a face
# check — trusting that echo is how a half-authenticated session got written to
# disk and showed up as "Connected" in the dashboard. /users/me must answer 200.
_reset_transport()
_RESPONDER = lambda m, u, h, b: (  # noqa: E731
    _FakeResponse(200, USER_PAYLOAD) if u == OTP_CHECK_URL else _FakeResponse(500, {}))
inline = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                                 x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
check('echoed user id alone is not a login', inline.get('user_id') is None,
      str(inline.get('user_id')))
check('unusable session reported, not saved', inline.get('status') == 'of_rejected',
      str(inline.get('status')))
check('/users/me is always verified',
      any(r[1] == ME_URL for r in _FakeSession.instances[-1].requests),
      str(_FakeSession.instances[-1].requests))

# ... and when that /users/me is the face gate, the operator is told which wall
# they hit rather than "try again".
_reset_transport()
_RESPONDER = lambda m, u, h, b: (  # noqa: E731
    _FakeResponse(200, {'userId': 55512345}) if u == OTP_CHECK_URL
    else _FakeResponse(400, {'error': {'code': 101, 'payload': {'otpState': {
        'faceOtp': True, 'forceFaceOtp': True, 'email': True}}}}))
gated = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                                x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
check('gated /users/me → face_id_required', gated.get('status') == 'face_id_required',
      str(gated.get('status')))
check('gated session not retryable', gated.get('retryable') is False)
check('otpState handed back for the UI',
      (gated.get('otp_state') or {}).get('forceFaceOtp') is True,
      str(gated.get('otp_state')))


# ── x_bc is preserved across the whole sequence ────────────────────────────
print('\n── x_bc survives login → OTP submit → result ──')

_reset_transport()
_RESPONDER = _success_responder
xbc_run = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                                  x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
sent_headers = [r[2] for r in _FakeSession.instances[-1].requests]
check('every request carried the login x-bc',
      sent_headers and all(h.get('x-bc') == LOGIN_XBC for h in sent_headers),
      str([h.get('x-bc') for h in sent_headers]))
check('the freshly-signed x-bc was NOT used',
      all(h.get('x-bc') != 'FRESH-XBC-MUST-NOT-BE-USED' for h in sent_headers))
check('x_bc echoed back unchanged', xbc_run.get('x_bc') == LOGIN_XBC,
      str(xbc_run.get('x_bc')))
check('partial-auth cookies replayed',
      dict(_FakeSession.instances[-1].cookies).get('sess') == 'partial-auth-sess',
      str(dict(_FakeSession.instances[-1].cookies)))
# Signatures are time-bound: each attempt signs fresh rather than reusing one set.
signs = [h.get('sign') for h in sent_headers]
check('a fresh signature per request', len(signs) == len(set(signs)), str(signs))
check('signed pre-auth (user_id=0)', all(c[1] == 0 for c in _SIGN_CALLS), str(_SIGN_CALLS))
check('missing x_bc fails fast without a request',
      login_module.verify_otp(email='u@t.c', otp_code='1', x_bc=None, x_hash='h',
                              cookies={}, proxy=None).get('status') == 'session_expired')


# ── Endpoint fallback: try candidate 2 on 404, then stick ──────────────────
print('\n── OTP endpoint fallback tries candidate 2, then sticks ──')

check('candidate order is otp/check first',
      login_module.OTP_ENDPOINT_CANDIDATES[0] == '/api2/v2/users/otp/check',
      str(login_module.OTP_ENDPOINT_CANDIDATES))

_hits = []


def _fallback_responder(method, url, headers, body):
    _hits.append(url)
    if url == OTP_CHECK_URL:
        return _FakeResponse(404, None, text='Not Found')     # candidate 1 is wrong
    if url == VERIFY_CODE_URL:
        return _FakeResponse(200, {'success': True})          # candidate 2 wins
    if url == ME_URL:
        return _FakeResponse(200, USER_PAYLOAD)
    return _FakeResponse(500, {})


_reset_transport()
_RESPONDER = _fallback_responder
fb = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                             x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
otp_hits = [u for u in _hits if u in (OTP_CHECK_URL, VERIFY_CODE_URL)]
check('tried candidate 1 then candidate 2', otp_hits == [OTP_CHECK_URL, VERIFY_CODE_URL],
      str(otp_hits))
check('fallback succeeded', fb.get('success') is True, str(fb.get('status')))
check('winner reported', fb.get('otp_endpoint') == '/api2/v2/users/verify-code',
      str(fb.get('otp_endpoint')))
check('winner remembered module-level',
      login_module._confirmed_otp_endpoint == '/api2/v2/users/verify-code',
      str(login_module._confirmed_otp_endpoint))

# ... and it sticks: the second call must not pay for the 404 again.
_hits.clear()
login_module.verify_otp(email='u@t.c', otp_code='222222', x_bc=LOGIN_XBC,
                        x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
otp_hits2 = [u for u in _hits if u in (OTP_CHECK_URL, VERIFY_CODE_URL)]
check('sticks — dead candidate never re-probed', otp_hits2 == [VERIFY_CODE_URL],
      str(otp_hits2))

# A 405 counts as "wrong URL" too.
_reset_transport()
_hits.clear()
_RESPONDER = lambda m, u, h, b: (  # noqa: E731
    _FakeResponse(405, None, 'Method Not Allowed') if u == OTP_CHECK_URL
    else _FakeResponse(200, USER_PAYLOAD) if u == VERIFY_CODE_URL
    else _FakeResponse(500, {}))
m405 = login_module.verify_otp(email='u@t.c', otp_code='1', x_bc=LOGIN_XBC,
                               x_hash='h', cookies={}, proxy=None)
check('405 also falls through', m405.get('otp_endpoint') == '/api2/v2/users/verify-code',
      str(m405.get('status')))

# Both dead → terminal, and honest about it.
_reset_transport()
_RESPONDER = lambda m, u, h, b: _FakeResponse(404, None, 'Not Found')  # noqa: E731
dead = login_module.verify_otp(email='u@t.c', otp_code='1', x_bc=LOGIN_XBC,
                               x_hash='h', cookies={}, proxy=None)
check('both 404 → endpoint_not_found', dead.get('status') == 'endpoint_not_found',
      str(dead.get('status')))
check('endpoint_not_found is not retryable', dead.get('retryable') is False)
check('nothing was remembered', login_module._confirmed_otp_endpoint is None,
      str(login_module._confirmed_otp_endpoint))

# A 404 does NOT poison the cache for a later working candidate 1.
_reset_transport()
_RESPONDER = _success_responder
after = login_module.verify_otp(email='u@t.c', otp_code='1', x_bc=LOGIN_XBC,
                                x_hash='h', cookies={}, proxy=None)
check('candidate 1 remembered when it works',
      login_module._confirmed_otp_endpoint == '/api2/v2/users/otp/check',
      str(login_module._confirmed_otp_endpoint))
check('and the call succeeded', after.get('success') is True)


# ── Wrong code → clean credential rejection ────────────────────────────────
print('\n── wrong code is a clean rejection, not a 500 ──')

_reset_transport()
_RESPONDER = lambda m, u, h, b: _FakeResponse(400, {'error': {  # noqa: E731
    'code': 100, 'message': 'Invalid code'}})
bad = login_module.verify_otp(email='u@t.c', otp_code='000000', x_bc=LOGIN_XBC,
                              x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
check('status invalid_code', bad.get('status') == 'invalid_code', str(bad.get('status')))
check('retryable (user can retype)', bad.get('retryable') is True)
check('no user_id leaked', bad.get('user_id') is None)
check('error message present', bool(bad.get('error')))
check('endpoint still learned on a rejection',
      login_module._confirmed_otp_endpoint == '/api2/v2/users/otp/check')

# A second 101 after we already answered one means "not accepted" — never a
# fresh prompt, or the flow loops forever.
_reset_transport()
_RESPONDER = lambda m, u, h, b: _FakeResponse(400, {'error': {  # noqa: E731
    'code': 101, 'message': 'Please enter the code',
    'payload': {'otpState': OTP_STATE_EMAIL}}})
loop = login_module.verify_otp(email='u@t.c', otp_code='000000', x_bc=LOGIN_XBC,
                               x_hash='h', cookies=LOGIN_COOKIES, proxy=None)
check('repeat 101 → invalid_code, not a re-prompt',
      loop.get('status') == 'invalid_code', str(loop.get('status')))
check('repeat 101 does not claim requires_2fa', 'requires_2fa' not in loop)

# Expired / dead-session variants.
_reset_transport()
_RESPONDER = lambda m, u, h, b: _FakeResponse(400, {'error': {  # noqa: E731
    'code': 100, 'message': 'The code has expired'}})
expd = login_module.verify_otp(email='u@t.c', otp_code='000000', x_bc=LOGIN_XBC,
                               x_hash='h', cookies={}, proxy=None)
check('expired code → code_expired', expd.get('status') == 'code_expired',
      str(expd.get('status')))
check('code_expired is terminal', expd.get('retryable') is False)

_reset_transport()
_RESPONDER = lambda m, u, h, b: _FakeResponse(401, {'error': {  # noqa: E731
    'message': 'Access denied.'}})
denied = login_module.verify_otp(email='u@t.c', otp_code='000000', x_bc=LOGIN_XBC,
                                 x_hash='h', cookies={}, proxy=None)
check('401 → session_expired', denied.get('status') == 'session_expired',
      str(denied.get('status')))

# Transport failure must be reported, never raised into the route.
_reset_transport()


def _boom(method, url, headers, body):
    raise ConnectionError('Failed to connect to proxy http://puser:psecret@p:1')


_RESPONDER = _boom
trans = login_module.verify_otp(email='u@t.c', otp_code='123456', x_bc=LOGIN_XBC,
                                x_hash='h', cookies={}, proxy='http://p:1')
check('transport failure returned not raised', trans.get('status') == 'transport_error',
      str(trans.get('status')))
check('transport failure is retryable', trans.get('retryable') is True)
check('transport message never echoes the proxy credentials',
      'psecret' not in (trans.get('error') or ''), str(trans.get('error')))

# Every failure dict must be uniformly shaped — the importer branches on this.
for label, payload in (('invalid_code', bad), ('face_id', face), ('expired', expd),
                       ('session_expired', denied), ('transport', trans), ('dead', dead)):
    check(f'{label} failure shape',
          payload.get('success') is False
          and isinstance(payload.get('status'), str)
          and isinstance(payload.get('error'), str)
          and isinstance(payload.get('retryable'), bool)
          and payload.get('user_id') is None
          and payload.get('data') == {},
          str(payload))


# ── TWO_FA_SESSION_EXPIRY is enforced ──────────────────────────────────────
print('\n── expired 2FA session reads as absent ──')

panel = db.create_crm_panel('2FA Test Panel')
CRM_ID = panel['crm_id']
API_KEY = panel['api_key']

db.store_2fa_session(crm_id=CRM_ID, email='fresh@test.com',
                     otp_state=OTP_STATE_EMAIL, x_bc=LOGIN_XBC, x_hash='h',
                     cookies=LOGIN_COOKIES, proxy=None, password='secret-pw')
fresh = db.get_2fa_session(CRM_ID, 'fresh@test.com')
check('fresh session readable', fresh is not None)
check('otpState round-trips as a dict', fresh['otp_state'] == OTP_STATE_EMAIL,
      str(fresh['otp_state']))
check('cookies round-trip', fresh['cookies'] == LOGIN_COOKIES, str(fresh['cookies']))
check('password decrypts', fresh['password'] == 'secret-pw')
check('x_bc round-trips', fresh['x_bc'] == LOGIN_XBC)
check('expires_in_seconds present',
      isinstance(fresh.get('expires_in_seconds'), int), str(fresh.get('expires_in_seconds')))
check('expires_in_seconds within the window',
      0 < fresh['expires_in_seconds'] <= config.TWO_FA_SESSION_EXPIRY,
      str(fresh['expires_in_seconds']))
check('expires_at present', bool(fresh.get('expires_at')), str(fresh.get('expires_at')))

remaining = db.get_2fa_session_remaining_seconds(CRM_ID, 'fresh@test.com')
check('remaining-time helper agrees',
      isinstance(remaining, int) and 0 < remaining <= config.TWO_FA_SESSION_EXPIRY,
      str(remaining))
check('helper returns None for an unknown email',
      db.get_2fa_session_remaining_seconds(CRM_ID, 'nobody@test.com') is None)

# A Fansly-style plain-string token must survive the dict handling untouched.
db.store_2fa_session(crm_id=CRM_ID, email='fansly-user', otp_state='twofa-token-abc',
                     x_bc='device-id', x_hash=None, cookies={'a': 'b'}, proxy=None,
                     password='pw')
fansly_row = db.get_2fa_session(CRM_ID, 'fansly-user')
check('plain-string otp_state untouched', fansly_row['otp_state'] == 'twofa-token-abc',
      str(fansly_row['otp_state']))


def _age_row(email, seconds):
    """Backdate created_at so the row is `seconds` old."""
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    conn.execute(
        'UPDATE two_fa_sessions SET created_at = ? WHERE crm_id = ? AND email = ?',
        ((datetime.utcnow() - timedelta(seconds=seconds)).isoformat(), CRM_ID, email))
    conn.commit()
    conn.close()


db.store_2fa_session(crm_id=CRM_ID, email='stale@test.com',
                     otp_state=OTP_STATE_EMAIL, x_bc=LOGIN_XBC, x_hash='h',
                     cookies=LOGIN_COOKIES, proxy=None, password='secret-pw')
_age_row('stale@test.com', config.TWO_FA_SESSION_EXPIRY + 60)
check('expired session reads as absent', db.get_2fa_session(CRM_ID, 'stale@test.com') is None)
check('remaining-time helper says None too',
      db.get_2fa_session_remaining_seconds(CRM_ID, 'stale@test.com') is None)


def _row_count(email):
    import sqlite3
    conn = sqlite3.connect(db.DB_FILE)
    n = conn.execute(
        'SELECT COUNT(*) FROM two_fa_sessions WHERE crm_id = ? AND email = ?',
        (CRM_ID, email)).fetchone()[0]
    conn.close()
    return n


check('expired row deleted on read (no stale encrypted password left behind)',
      _row_count('stale@test.com') == 0, str(_row_count('stale@test.com')))

# The sweeper catches the rows nobody reads again.
db.store_2fa_session(crm_id=CRM_ID, email='abandoned@test.com',
                     otp_state=OTP_STATE_EMAIL, x_bc=LOGIN_XBC, x_hash='h',
                     cookies=LOGIN_COOKIES, proxy=None, password='secret-pw')
_age_row('abandoned@test.com', config.TWO_FA_SESSION_EXPIRY + 60)
swept = db.sweep_expired_2fa_sessions()
check('sweeper deleted the abandoned row', swept >= 1, str(swept))
check('abandoned row gone', _row_count('abandoned@test.com') == 0)
check('live row survived the sweep', _row_count('fresh@test.com') == 1)

check('TWO_FA_SESSION_EXPIRY is actually read',
      db._2fa_expiry_seconds() == config.TWO_FA_SESSION_EXPIRY,
      f'{db._2fa_expiry_seconds()} vs {config.TWO_FA_SESSION_EXPIRY}')

import scheduler  # noqa: E402
check('sweep is wired to a scheduler job', hasattr(scheduler, '_run_two_fa_sweep'))
check('sweep job id registered', scheduler.TWO_FA_SWEEP_JOB_ID == 'internal.two_fa_sweep')


# ── HTTP level: the route no longer 500s ───────────────────────────────────
print('\n── verify-otp route: statuses, not 500s ──')

client = crm_api.app.test_client()
HEADERS = {'X-API-Key': API_KEY}


def _post_otp(email, code='123456'):
    return client.post(f'/api/crm/{CRM_ID}/accounts/login/verify-otp',
                       json={'email': email, 'otp_code': code}, headers=HEADERS)


_real_verify = crm_api.login_module.verify_otp

# Wrong code.
db.store_2fa_session(crm_id=CRM_ID, email='route@test.com', otp_state=OTP_STATE_EMAIL,
                     x_bc=LOGIN_XBC, x_hash='h', cookies=LOGIN_COOKIES,
                     proxy=None, password='pw')
crm_api.login_module.verify_otp = lambda **kw: login_module._otp_failure(
    'invalid_code', 'That code was not accepted by OnlyFans.', True)
resp = _post_otp('route@test.com')
check('wrong code → 401 not 500', resp.status_code == 401, str(resp.status_code))
body = resp.get_json()
check('reason is machine-readable', body.get('reason') == 'invalid_code', str(body))
check('status echoed', body.get('status') == 'invalid_code')
check('retryable true', body.get('retryable') is True)
check('countdown returned for a retryable failure',
      isinstance(body.get('expires_in_seconds'), int), str(body.get('expires_in_seconds')))
check('session kept for the retry', db.get_2fa_session(CRM_ID, 'route@test.com') is not None)

# Face id — terminal, and the parked session is dropped.
crm_api.login_module.verify_otp = lambda **kw: login_module._otp_failure(
    'face_id_required', login_module.FACE_ID_MESSAGE, False, otp_state={})
resp = _post_otp('route@test.com')
check('face_id → 400 not 500', resp.status_code == 400, str(resp.status_code))
body = resp.get_json()
check('face_id reason', body.get('reason') == 'face_id_required', str(body))
check('requires_face_id flag', body.get('requires_face_id') is True)
check('face_id not retryable', body.get('retryable') is False)
check('dead session dropped', db.get_2fa_session(CRM_ID, 'route@test.com') is None)

# Transport failure.
db.store_2fa_session(crm_id=CRM_ID, email='route@test.com', otp_state=OTP_STATE_EMAIL,
                     x_bc=LOGIN_XBC, x_hash='h', cookies=LOGIN_COOKIES,
                     proxy=None, password='pw')
crm_api.login_module.verify_otp = lambda **kw: login_module._otp_failure(
    'transport_error', 'Could not reach OnlyFans', True)
resp = _post_otp('route@test.com')
check('transport → 503 (Cloudflare replaces 502 bodies)', resp.status_code == 503,
      str(resp.status_code))
body = resp.get_json()
check('transport body is JSON with a suggestion', bool((body or {}).get('suggestion')), str(body))
check('transport body carries retry_after', (body or {}).get('retry_after') == 30, str(body))
check('transport keeps the parked session', db.get_2fa_session(CRM_ID, 'route@test.com') is not None)

# Expired parked session → 404 "log in again", never a submit-time surprise.
_age_row('route@test.com', config.TWO_FA_SESSION_EXPIRY + 60)
crm_api.login_module.verify_otp = lambda **kw: (_ for _ in ()).throw(
    AssertionError('verify_otp must not be called for an expired session'))
resp = _post_otp('route@test.com')
check('expired session → 404', resp.status_code == 404, str(resp.status_code))
check('404 says log in again', 'expired' in (resp.get_json().get('error') or '').lower(),
      str(resp.get_json()))

# Success end-to-end through the route.
db.store_2fa_session(crm_id=CRM_ID, email='route@test.com', otp_state=OTP_STATE_EMAIL,
                     x_bc=LOGIN_XBC, x_hash='the-hash', cookies=LOGIN_COOKIES,
                     proxy=None, password='pw')
crm_api.login_module.verify_otp = lambda **kw: {
    'success': True, 'status': 'success', 'user_id': '55512345',
    'data': USER_PAYLOAD, 'cookies': LOGIN_COOKIES, 'x_hash': 'the-hash',
    'x_bc': kw['x_bc'], 'session': None, 'otp_endpoint': '/api2/v2/users/otp/check',
}
_saved = {}
crm_api.mt_auth.save_session = lambda *a, **k: _saved.update({'called': True})
resp = _post_otp('route@test.com')
check('success → 200', resp.status_code == 200, f'{resp.status_code} {resp.get_data(as_text=True)[:200]}')
body = resp.get_json()
check('of_user_id returned', body.get('of_user_id') == '55512345', str(body))
check('x_bc echoed to the client', body.get('x_bc') == LOGIN_XBC, str(body.get('x_bc')))
check('account persisted', db.get_of_account(CRM_ID, '55512345') is not None)
check('parked session cleaned up', db.get_2fa_session(CRM_ID, 'route@test.com') is None)

crm_api.login_module.verify_otp = _real_verify


# ── attempt_relogin no longer saves a half-session for a 2FA account ───────
print('\n── attempt_relogin parks 2FA instead of writing None.json ──')

RELOGIN_USER = '778899'
db.add_of_account(crm_id=CRM_ID, of_user_id=RELOGIN_USER, email='twofa@test.com',
                  password='pw', username='twofauser', x_bc='xbc', x_hash='xh',
                  proxy=None)

of_client._relogin_locks.clear()
of_client._relogin_cooldowns.clear()
of_client._relogin_last_success.clear()

save_calls = []
of_client.mt_auth.save_session = lambda *a, **k: save_calls.append(a)
of_client.login_module.login = lambda email, password, use_captcha=True, proxy=None, captcha_api_key=None: {
    'success': False, 'status': 'requires_2fa', 'requires_2fa': True,
    'user_id': None, 'data': {}, 'otp_state': OTP_STATE_EMAIL,
    'otp_methods': ['email'], 'cookies': LOGIN_COOKIES, 'x_hash': 'h',
    'x_bc': LOGIN_XBC, 'session': None,
}
sess, err = of_client.attempt_relogin(CRM_ID, RELOGIN_USER)
check('relogin returns no session', sess is None)
check('save_session never called with a None user_id', save_calls == [], str(save_calls))
check('error names the 2FA code', '2fa code' in (err or '').lower(), str(err))
check('error points at verify-otp', 'verify-otp' in (err or ''), str(err))

parked = db.get_2fa_session(CRM_ID, 'twofa@test.com')
check('challenge parked for the user to finish', parked is not None)
check('parked with the login x_bc', parked and parked['x_bc'] == LOGIN_XBC)
check('parked with the partial-auth cookies', parked and parked['cookies'] == LOGIN_COOKIES)
check('parked otpState is a dict', parked and parked['otp_state'] == OTP_STATE_EMAIL)

# The stand-down is recorded on the identity gate, NOT on relogin_block_*.
# The older expectation (relogin_blocked_at) was wrong on both ends: a 2FA
# challenge means the stored password was *accepted*, so surfacing it as a
# login failure told the dashboard to render "Reconnect" — the one action that
# cannot clear a second factor. verification_required_* is the dedicated gate
# that makes the dashboard offer the code/face flow, and (like the old block)
# it is cleared by add_of_account when verify-otp finishes the login.
acct = db.get_of_account(CRM_ID, RELOGIN_USER)
check('account gated (no more captcha solves)', bool(acct.get('verification_required_at')))
check('gate reason names 2FA', '2fa' in (acct.get('verification_reason') or '').lower(),
      str(acct.get('verification_reason')))
check('gate is not reported as a login failure', not acct.get('relogin_blocked_at'),
      str(acct.get('relogin_block_reason')))

# Second call must fail fast — the whole point of the gate.
login_hits = []
of_client.login_module.login = lambda *a, **k: login_hits.append(1)
sess, err = of_client.attempt_relogin(CRM_ID, RELOGIN_USER)
check('gated account fails fast', sess is None and 'paused' in (err or '').lower(), str(err))
check('login not re-attempted', login_hits == [], str(login_hits))

# Finishing the flow (add_of_account, as verify-otp does) clears the gate.
db.add_of_account(crm_id=CRM_ID, of_user_id=RELOGIN_USER, email='twofa@test.com',
                  password='pw', username='twofauser', x_bc='xbc2', x_hash='xh2',
                  proxy=None)
_reconnected = db.get_of_account(CRM_ID, RELOGIN_USER)
check('completing 2FA clears the gate',
      not _reconnected.get('verification_required_at')
      and not _reconnected.get('relogin_blocked_at'))
check('auto re-login resumes after 2FA',
      of_client.attempt_relogin(CRM_ID, RELOGIN_USER)[0] is None
      and login_hits == [1], str(login_hits))

print()
if _failures:
    print(f'{len(_failures)} FAILURE(S): {_failures}')
    sys.exit(1)
print('ALL PASS')
