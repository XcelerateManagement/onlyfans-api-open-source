#!/usr/bin/env python3
"""OnlyFans' Cloudflare blocking a login must reach the dashboard as JSON.

Production, 2026-09-17: OnlyFans answered /users/login with Cloudflare's
"Sorry, you have been blocked" page (403) for a flagged proxy IP. login()
raised it as a generic failure, the route answered 502, and Cloudflare in front
of this API replaced that 502 with its own HTML page — so the dashboard said
"API server is temporarily unavailable" while the API was healthy.

Covers:
  - _cloudflare_block_info recognises the block page, ignores OF's JSON 403s
  - login() raises UpstreamBlockedError with the blocked IP and ray id
  - the block message is not misread by the other text classifiers
  - verify_otp() reports a block as proxy_blocked (terminal), not session_expired
  - POST /accounts/login: block → 424 proxy_blocked, generic failure → 503 +
    retry_after (never 502), transport failure → 424 with the curated message;
    every failure carries a `suggestion`
  - POST /accounts/login/verify-otp: block → 424 proxy_blocked + suggestion

Every network call is stubbed — no OnlyFans traffic.

    python tests/test_login_cloudflare_block.py
"""

import os
import sys
import tempfile

# Isolate from the real deployment BEFORE importing app modules.
os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import account_status              # noqa: E402
import login as login_module       # noqa: E402
import transport_errors            # noqa: E402
import crm_api                     # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# Trimmed from the page OnlyFans served in production; IP and ray are synthetic.
BLOCK_PAGE = '''<!DOCTYPE html>
<html class="no-js" lang="en-US"> <head>
<title>Attention Required! | Cloudflare</title>
</head><body>
  <div id="cf-wrapper">
    <div class="cf-alert cf-alert-error cf-cookie-error" id="cookie-alert">Please enable cookies.</div>
    <div id="cf-error-details" class="cf-error-details-wrapper">
      <div class="cf-wrapper cf-header cf-error-overview">
        <h1 data-translate="block_headline">Sorry, you have been blocked</h1>
        <h2 class="cf-subheadline"><span>You are unable to access</span> onlyfans.com</h2>
      </div><!-- /.captcha-container -->
      <div class="cf-error-footer cf-wrapper">
        <span class="cf-footer-item sm:block sm:mb-1">Cloudflare Ray ID: <strong class="font-semibold">8f1c2d3e4a5b6c7d</strong></span>
        <span id="cf-footer-item-ip" class="cf-footer-item hidden sm:block sm:mb-1">
          <button type="button" id="cf-footer-ip-reveal" class="cf-footer-ip-reveal-btn">Click to reveal</button>
          <span class="hidden" id="cf-footer-ip">203.0.113.7</span>
        </span>
      </div>
    </div>
  </div>
</body></html>'''


class _FakeResponse:
    def __init__(self, status_code, payload=None, text=''):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text else (str(payload) if payload is not None else '')

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


# ── Detection ──────────────────────────────────────────────────────────────
print('\n── _cloudflare_block_info ──')

info = login_module._cloudflare_block_info(_FakeResponse(403, text=BLOCK_PAGE))
check('block page recognised', info is not None, str(info))
check('blocked IP extracted', (info or {}).get('blocked_ip') == '203.0.113.7', str(info))
check('ray id extracted', (info or {}).get('ray_id') == '8f1c2d3e4a5b6c7d', str(info))

check('OF JSON 403 is not a block',
      login_module._cloudflare_block_info(
          _FakeResponse(403, {'error': {'code': 0, 'message': 'Access denied'}})) is None)
check('plain-text 403 is not a block',
      login_module._cloudflare_block_info(_FakeResponse(403, text='Forbidden')) is None)
check('block page with another status is not a block',
      login_module._cloudflare_block_info(_FakeResponse(400, text=BLOCK_PAGE)) is None)

no_ip = BLOCK_PAGE.replace('203.0.113.7', '')
info = login_module._cloudflare_block_info(_FakeResponse(403, text=no_ip))
check('page without an IP still counts, ip is None',
      info is not None and info['blocked_ip'] is None, str(info))


# ── The message must not trip the other classifiers ────────────────────────
print('\n── block message vs text classifiers ──')

for exc in (login_module.UpstreamBlockedError('203.0.113.7', 'ray'),
            login_module.UpstreamBlockedError(None, None)):
    msg = str(exc)
    check(f'not transport: {msg!r}', transport_errors.classify(exc) is None,
          str(transport_errors.classify(exc)))
    check(f'not a terminal login failure: {msg!r}',
          account_status.classify_terminal_login_failure(msg) is None,
          str(account_status.classify_terminal_login_failure(msg)))

check('proxy_blocked is a retryable connection state',
      account_status.CONNECTION_ERRORS['proxy_blocked']['retryable'] is True)


# ── login() raises the typed error ─────────────────────────────────────────
print('\n── login() on a Cloudflare block ──')

login_module.generate_headers = lambda path, user_id=0: {
    'sign': 'sign', 'time': '1700000000', 'app-token': 'app-token', 'x-bc': 'xbc',
}


class _FakeCookieJar(dict):
    def set(self, name, value, domain=None, path=None):
        self[name] = value


class _FakeSession:
    def __init__(self, impersonate=None):
        self.proxies = None
        self.cookies = _FakeCookieJar()

    def get(self, url, headers=None, params=None, timeout=None, **kw):
        if 'cdn2' in url:
            return _FakeResponse(200, text='the-x-hash')
        return _FakeResponse(200, {'id': 0})

    def post(self, url, headers=None, json=None, timeout=None, **kw):
        return _FakeResponse(403, text=BLOCK_PAGE)


class _FakeRequestsModule:
    Session = _FakeSession


_real_requests = login_module.requests
login_module.requests = _FakeRequestsModule
try:
    raised = None
    try:
        login_module.login('user@test.com', 'pw', use_captcha=False, proxy=None)
    except Exception as e:  # noqa: BLE001 — the type is what is under test
        raised = e
    check('raises UpstreamBlockedError', isinstance(raised, login_module.UpstreamBlockedError),
          repr(raised))
    check('carries the blocked IP', getattr(raised, 'blocked_ip', None) == '203.0.113.7')
    check('carries the ray id', getattr(raised, 'ray_id', None) == '8f1c2d3e4a5b6c7d')
    check('no HTML in the message', '<' not in str(raised), str(raised))

    print('\n── verify_otp() on a Cloudflare block ──')
    login_module.reset_otp_endpoint_cache()
    otp = login_module.verify_otp(email='user@test.com', otp_code='123456', x_bc='xbc',
                                  x_hash='h', cookies={'sess': 's'}, proxy='http://p:1')
    check('status proxy_blocked (not session_expired)', otp.get('status') == 'proxy_blocked',
          str(otp.get('status')))
    check('not retryable — the challenge cannot move IPs', otp.get('retryable') is False)
    check('otp carries the blocked IP', otp.get('blocked_ip') == '203.0.113.7', str(otp))
    check('otp carries the ray id', otp.get('ray_id') == '8f1c2d3e4a5b6c7d', str(otp))
    check('block does not confirm an OTP endpoint',
          login_module._confirmed_otp_endpoint is None, str(login_module._confirmed_otp_endpoint))
finally:
    login_module.requests = _real_requests
    login_module.reset_otp_endpoint_cache()


# ── HTTP: statuses the dashboard can read ──────────────────────────────────
print('\n── POST /accounts/login statuses ──')

db.init_database()
panel = db.create_crm_panel('Cloudflare Block Test Panel')
CRM_ID = panel['crm_id']
HEADERS = {'X-API-Key': panel['api_key']}
client = crm_api.app.test_client()
_real_login = crm_api.login_module.login


def _post_login():
    return client.post(f'/api/crm/{CRM_ID}/accounts/login', headers=HEADERS,
                       json={'email': 'user@test.com', 'password': 'synthetic-pw-123'})


def _raise(exc):
    def fake_login(*args, **kwargs):
        raise exc
    return fake_login


try:
    crm_api.login_module.login = _raise(
        login_module.UpstreamBlockedError('203.0.113.7', '8f1c2d3e4a5b6c7d'))
    resp = _post_login()
    body = resp.get_json(silent=True) or {}
    check('block → 424', resp.status_code == 424, str(resp.status_code))
    check('block body is JSON', resp.is_json, resp.content_type)
    check('reason proxy_blocked', body.get('reason') == 'proxy_blocked', str(body))
    check('connection_state proxy_blocked', body.get('connection_state') == 'proxy_blocked')
    check('blocked_ip returned', body.get('blocked_ip') == '203.0.113.7', str(body))
    check('ray_id returned', body.get('ray_id') == '8f1c2d3e4a5b6c7d', str(body))
    check('error names the cause and the IP',
          (body.get('error') or '').startswith('Proxy blocked:')
          and '203.0.113.7' in body.get('error', ''), str(body.get('error')))
    check('suggestion says to switch proxy', 'different proxy' in (body.get('suggestion') or ''),
          str(body.get('suggestion')))
    check('retryable', body.get('retryable') is True)

    # What production used to turn into a 502: an unclassified login failure.
    crm_api.login_module.login = _raise(Exception('Login failed: <!DOCTYPE html><p>oops</p>'))
    resp = _post_login()
    body = resp.get_json(silent=True) or {}
    check('generic failure → 503, never 502', resp.status_code == 503, str(resp.status_code))
    check('503 carries retry_after', body.get('retry_after') == 30, str(body))
    check('503 reason temporary_error', body.get('reason') == 'temporary_error', str(body))
    check('raw upstream body not echoed', '<' not in (body.get('error') or ''), str(body))
    check('503 carries a suggestion', bool(body.get('suggestion')), str(body))

    crm_api.login_module.login = _raise(
        Exception('Failed to perform, curl: (7) Failed to connect to proxy port 1080'))
    resp = _post_login()
    body = resp.get_json(silent=True) or {}
    check('transport failure → 424', resp.status_code == 424, str(resp.status_code))
    check('transport reason proxy_error', body.get('reason') == 'proxy_error', str(body))
    check('curated proxy message, not the curl string',
          body.get('error') and 'curl' not in body['error'].lower(), str(body))
    check('proxy_error carries a suggestion', 'proxy' in (body.get('suggestion') or '').lower(),
          str(body))
finally:
    crm_api.login_module.login = _real_login


print('\n── POST /accounts/login input checks ──')
_login_calls = []


def _record_login(email, password, use_captcha=True, proxy=None, **kwargs):
    _login_calls.append({'password': password, 'proxy': proxy})
    raise Exception('Login failed: stop here')


try:
    crm_api.login_module.login = _record_login
    resp = client.post(f'/api/crm/{CRM_ID}/accounts/login', headers=HEADERS,
                       json={'email': 'user@test.com', 'password': 'synthetic-pw-123',
                             'proxy': 'http://user:pass@203.0.113.7'})
    body = resp.get_json(silent=True) or {}
    check('malformed proxy → 400, not a proxy-less login', resp.status_code == 400,
          f'{resp.status_code} {body}')
    check('malformed proxy message names the format', 'proxy format' in (body.get('error') or '').lower(),
          str(body))
    check('login never attempted with the proxy dropped', _login_calls == [], str(_login_calls))

    resp = client.post(f'/api/crm/{CRM_ID}/accounts/login', headers=HEADERS,
                       json={'email': 'user@test.com', 'password': 'short'})
    check('short platform password is passed through (not a signup-strength check)',
          resp.status_code != 400 and _login_calls and _login_calls[-1]['password'] == 'short',
          f'{resp.status_code} {resp.get_json(silent=True)} {_login_calls}')
finally:
    crm_api.login_module.login = _real_login


print('\n── POST /accounts/login/verify-otp on a block ──')
_real_verify = crm_api.login_module.verify_otp
db.store_2fa_session(crm_id=CRM_ID, email='user@test.com', otp_state={'email': True},
                     x_bc='xbc', x_hash='h', cookies={'sess': 's'},
                     proxy='http://p:1', password='synthetic-pw-123')
try:
    crm_api.login_module.verify_otp = lambda **kw: login_module._otp_failure(
        'proxy_blocked', 'blocked', False,
        blocked_ip='203.0.113.7', ray_id='8f1c2d3e4a5b6c7d')
    resp = client.post(f'/api/crm/{CRM_ID}/accounts/login/verify-otp', headers=HEADERS,
                       json={'email': 'user@test.com', 'otp_code': '123456'})
    body = resp.get_json(silent=True) or {}
    check('otp block → 424', resp.status_code == 424, str(resp.status_code))
    check('otp reason proxy_blocked', body.get('reason') == 'proxy_blocked', str(body))
    check('otp error names the cause and the IP',
          (body.get('error') or '').startswith('Proxy blocked:')
          and '203.0.113.7' in body.get('error', ''), str(body.get('error')))
    check('otp suggestion says to start over with another proxy',
          'different proxy' in (body.get('suggestion') or ''), str(body.get('suggestion')))
    check('otp blocked_ip returned', body.get('blocked_ip') == '203.0.113.7', str(body))
    check('dead challenge dropped', db.get_2fa_session(CRM_ID, 'user@test.com') is None)
finally:
    crm_api.login_module.verify_otp = _real_verify


print()
if _failures:
    print(f'FAILED: {len(_failures)}')
    for name in _failures:
        print(f'  - {name}')
    sys.exit(1)
print('ALL PASS')
