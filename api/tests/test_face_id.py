#!/usr/bin/env python3
"""Tests for the OnlyFans face (selfie) verification gate.

The bug this pins down: an account can hold a perfectly valid session and still
have OnlyFans refuse every account-scoped call with

    HTTP 400 {"error":{"code":101,"payload":{"otpState":{"forceFaceOtp":true,…}}}}

Before this, `is_access_denied` didn't match that shape, so the raw OnlyFans
JSON was handed to the dashboard and the account kept rendering as "Connected".
Covers:

  - parse_otp_challenge classifies 101/105 and honours forceFaceOtp
  - forceFaceOtp collapses the factor list to face only (OF's own client does
    this; offering an email code there burns one of three attempts for nothing)
  - handle_of_request answers 403 face_id_required and flags the account
  - the flag never triggers a relogin (that would buy a captcha for nothing)
  - a later 200 clears the flag
  - GET /accounts exposes needs_verification separately from needs_reconnect
  - the face-id routes are reachable and reject an unknown source

Throwaway DB, zero network (make_authenticated_request is monkeypatched).

    python tests/test_face_id.py
"""

import os
import sys
import tempfile

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import of_client                   # noqa: E402
import of_faceid                   # noqa: E402
import crm_api                     # noqa: E402

_failures = []


def check(name, cond, detail=''):
    print(f'  [{"PASS" if cond else "FAIL"}] {name}'
          + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Face ID Test Panel')
CRM_ID = panel['crm_id']
API_KEY = panel['api_key']
OF_USER_ID = '539000001'

db.add_of_account(
    crm_id=CRM_ID, of_user_id=OF_USER_ID,
    email='gated@test.com', password='pw',
    username=None, x_bc='xbc', x_hash='xh', proxy=None,
)

# The exact payload OnlyFans returns for a face-gated account (captured live
# from account 539827124 on 2026-08-09).
FORCED_FACE = {'error': {'code': 101, 'message': 'Some Creator', 'payload': {'otpState': {
    'app': False, 'appOtp': False, 'email': True,
    'emailCode': {'requestAttemptsLeft': 3, 'requestAttemptsLimit': 3},
    'emailMask': 'gat*****@test.com',
    'faceCode': {'requestAttemptsLeft': 3, 'requestAttemptsLimit': 3},
    'faceOtp': True, 'forceFaceOtp': True, 'phone': False, 'phoneOtp': False,
}}}}


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self):
        return self._body


def _serve(status, body):
    of_client.mt_auth.load_session = lambda *a, **k: {'cookies': {}, 'user_id': OF_USER_ID}
    of_client.mt_auth.make_authenticated_request = lambda *a, **k: _Resp(status, body)


def _reset_flag_cache():
    of_client._verification_clean.clear()
    of_client._verification_seen.clear()


# ── parse_otp_challenge ────────────────────────────────────────────────────
print('\n── parse_otp_challenge classifies the OF error shapes ──')

c = of_client.parse_otp_challenge(FORCED_FACE)
check('101 recognised', c is not None and c['code'] == 101)
check('forceFaceOtp → face_required', c['face_required'] is True)
check('forceFaceOtp collapses to face only', c['methods'] == ['face'], str(c['methods']))
check('otpState passed through verbatim',
      c['otp_state'].get('emailMask') == 'gat*****@test.com')

plain = of_client.parse_otp_challenge({'error': {'code': 101, 'payload': {'otpState': {
    'email': True, 'phoneOtp': True}}}})
check('plain 101 lists every offered factor', plain['methods'] == ['email', 'sms'],
      str(plain['methods']))
check('plain 101 is not face_required', plain['face_required'] is False)

sec = of_client.parse_otp_challenge({'error': {'code': 105, 'payload': {'otpState': {
    'faceOtp': True}}}})
check('105 recognised', sec is not None and sec['code'] == 105)
check('faceOtp alone still means face', sec['face_required'] is True)

check('200-shaped body is not a challenge',
      of_client.parse_otp_challenge({'id': 1, 'username': 'x'}) is None)
check('access-denied is not a challenge',
      of_client.parse_otp_challenge({'error': {'message': 'Access denied.'}}) is None)
check('garbage tolerated', of_client.parse_otp_challenge('nope') is None)


# ── handle_of_request ──────────────────────────────────────────────────────
print('\n── a gated account gets a typed 403, not raw OF JSON ──')

_reset_flag_cache()
login_calls = []
of_client.login_module.login = lambda *a, **k: login_calls.append(1)
_serve(400, FORCED_FACE)
ok, payload, status, relogged = of_client.handle_of_request(
    CRM_ID, OF_USER_ID, '/api2/v2/users/me')
check('not ok', ok is False)
check('403 not 400', status == 403, str(status))
check('reason is face_id_required', payload.get('reason') == 'face_id_required',
      str(payload.get('reason')))
check('needs_verification flagged', payload.get('needs_verification') is True)
check('methods surfaced for the UI', payload.get('verification_methods') == ['face'])
check('OF error code kept', payload.get('of_error_code') == 101)
check('message explains the IP constraint',
      'ip' in (payload.get('error') or '').lower(), payload.get('error'))
check('no relogin attempted', login_calls == [], str(login_calls))
check('relogin flag false', relogged is False)

acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('flag persisted', bool(acc.get('verification_required_at')))
check('reason persisted', 'face' in (acc.get('verification_reason') or '').lower())
first_stamp = acc.get('verification_required_at')

# A second refusal must not restart the clock — "waiting since" would jump
# around in the UI on every blocked request.
ok2, _p2, _s2, _r2 = of_client.handle_of_request(
    CRM_ID, OF_USER_ID, '/api2/v2/payouts/balances')
check('repeat refusal keeps the original timestamp',
      db.get_of_account(CRM_ID, OF_USER_ID).get('verification_required_at') == first_stamp)


print('\n── a non-face 101 is reported as a code challenge, not a face check ──')
_reset_flag_cache()
_serve(400, {'error': {'code': 101, 'payload': {'otpState': {'email': True}}}})
ok, payload, status, _ = of_client.handle_of_request(
    CRM_ID, OF_USER_ID, '/api2/v2/users/me')
check('403 for a plain OTP gate too', status == 403, str(status))
check('reason is otp_required', payload.get('reason') == 'otp_required',
      str(payload.get('reason')))


print('\n── the gate lifting clears the flag ──')
_reset_flag_cache()
_serve(200, {'id': int(OF_USER_ID), 'username': 'gatedcreator',
             'avatar': 'https://x/y.jpg'})
ok, payload, status, _ = of_client.handle_of_request(
    CRM_ID, OF_USER_ID, '/api2/v2/users/me')
check('200 passes through', ok is True and status == 200)
acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('flag cleared', not acc.get('verification_required_at'),
      str(acc.get('verification_required_at')))

# Second call must not pay for another UPDATE — the in-process cache absorbs it.
writes = []
_real_clear = db.clear_verification_required
db.clear_verification_required = lambda *a, **k: writes.append(1)
of_client.handle_of_request(CRM_ID, OF_USER_ID, '/api2/v2/users/me')
check('clean account costs no repeat DB write', writes == [], str(writes))
db.clear_verification_required = _real_clear


# ── profile backfill ───────────────────────────────────────────────────────
print('\n── username/avatar backfill after the gate lifts ──')
db.update_of_account_profile(CRM_ID, OF_USER_ID, username='gatedcreator',
                             avatar='https://x/y.jpg')
acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('username backfilled', acc.get('username') == 'gatedcreator')
check('avatar backfilled', acc.get('avatar') == 'https://x/y.jpg')
db.update_of_account_profile(CRM_ID, OF_USER_ID, username=None, avatar=None)
acc = db.get_of_account(CRM_ID, OF_USER_ID)
check('None never blanks an existing value', acc.get('username') == 'gatedcreator')


# ── HTTP surface ───────────────────────────────────────────────────────────
print('\n── HTTP routes ──')
crm_api.app.config['TESTING'] = True
client = crm_api.app.test_client()
H = {'X-API-Key': API_KEY}

_reset_flag_cache()
_serve(400, FORCED_FACE)
of_client.handle_of_request(CRM_ID, OF_USER_ID, '/api2/v2/users/me')  # re-arm

r = client.get(f'/api/crm/{CRM_ID}/accounts', headers=H)
body = r.get_json()
row = next(a for a in body['accounts'] if a['of_user_id'] == OF_USER_ID)
check('needs_verification exposed', row.get('needs_verification') is True)
check('needs_reconnect stays false', row.get('needs_reconnect') is False,
      str(row.get('needs_reconnect')))
check('verification detail attached', bool(row.get('verification')))
check('face_required surfaced', row['verification'].get('face_required') is True)
check('otp_state decoded to an object',
      isinstance(row['verification'].get('otp_state'), dict))
check('raw JSON column not leaked', 'verification_otp_state' not in row)

r = client.get(f'/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/face-id/status', headers=H)
st = r.get_json()
check('status route 200', r.status_code == 200, str(r.status_code))
check('status is required', st.get('status') == 'required', str(st.get('status')))
check('status carries otpState', isinstance(st.get('otp_state'), dict))

r = client.post(f'/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/face-id/start',
                headers=H, json={'source': 'bogus'})
check('unknown source rejected', r.status_code == 400, str(r.status_code))

# OF hands back a redirect URL; the route must return it and arm a watcher.
_serve(200, {'redirectUrl': 'https://verify.example/session/abc'})
r = client.post(f'/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/face-id/start',
                headers=H, json={'source': 'regular'})
started = r.get_json()
check('start route 200', r.status_code == 200, str(r.status_code) + ' ' + str(started))
check('verify_url returned',
      started.get('verify_url') == 'https://verify.example/session/abc',
      str(started.get('verify_url')))
watcher = of_faceid.get_watcher(CRM_ID, OF_USER_ID)
check('watcher armed', watcher is not None)
if watcher:
    watcher.stop()

# A start that OF answers without a URL is a 502, not a fake success.
_serve(200, {'ok': True})
of_faceid._watchers.clear()
r = client.post(f'/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/face-id/start',
                headers=H, json={})
check('missing redirectUrl → 502', r.status_code == 502, str(r.status_code))

# Cross-tenant: another panel must not see this account at all.
other = db.create_crm_panel('Other Panel')
r = client.get(f'/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/face-id/status',
               headers={'X-API-Key': other['api_key']})
check('cross-tenant status refused', r.status_code in (403, 404),
      str(r.status_code))


print()
if _failures:
    print(f'{len(_failures)} FAILURE(S): {_failures}')
    sys.exit(1)
print('ALL PASS')
