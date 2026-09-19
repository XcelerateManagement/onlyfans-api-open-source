#!/usr/bin/env python3
"""Per-account 2FA confirmation flow.

The scenario this locks down: OnlyFans returns 200 from /users/login (password
is right, we hold a session) but then refuses /users/me with error 101 — a
post-login step-up. Before this, the account was saved looking connected with a
null username and nothing worked. Now it becomes a first-class "needs 2FA"
state, confirmable with a code from next to the account.

Covers:
  - the login route detects the step-up, parks a 2fa session, flags the row,
    and returns requires_2fa + the offered factors (instead of a fake success)
  - GET  /accounts/<id>/2fa/status reflects the flag + factors, unbilled
  - POST /accounts/<id>/2fa/submit completes it against the parked session,
    clears the flag, and backfills the profile
  - a wrong code is reported (retryable), the flag stays
  - POST /2fa/request-code is rejected for the app factor, allowed for email
  - cross-tenant isolation

Throwaway DB, no network (login + OTP submit monkeypatched).

    python tests/test_account_2fa.py
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
import login as login_module       # noqa: E402
import multi_tenant_auth as mt     # noqa: E402
import crm_api                     # noqa: E402

_failures = []


def check(name, cond, detail=''):
    print(f'  [{"PASS" if cond else "FAIL"}] {name}'
          + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


panel = db.create_crm_panel('2FA Panel')
CRM_ID = panel['crm_id']
API_KEY = panel['api_key']
OTHER = db.create_crm_panel('Other 2FA Panel')

crm_api.app.config['TESTING'] = True
client = crm_api.app.test_client()
H = {'X-API-Key': API_KEY}

# otpState for an app+email step-up (not forced face).
STEP_UP_OTP = {'app': True, 'appOtp': True, 'email': True,
               'emailMask': 'te***@x.com', 'phone': False, 'phoneOtp': False,
               'faceOtp': False, 'forceFaceOtp': False}


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body

    def json(self):
        return self._body


# ── login route detects the post-login step-up ─────────────────────────────
print('\n── login step-up → requires_2fa, account parked ──')

# login() succeeds (200 from /users/login), but /users/me is gated.
login_module.login = lambda email, password, use_captcha=True, proxy=None, **kwargs: {
    'success': True, 'status': 'success', 'user_id': '700100200',
    'data': {'userId': 700100200},  # bare echo — no username
    'cookies': {'sess': 'abc', 'auth_id': '700100200'},
    'x_hash': 'H', 'x_bc': 'B', 'session': object(),
}
mt.save_session = lambda *a, **k: None
mt.make_authenticated_request = lambda *a, **k: _Resp(
    400, {'error': {'code': 101, 'payload': {'otpState': STEP_UP_OTP}}})

r = client.post(f'/api/crm/{CRM_ID}/accounts/login', headers=H,
                json={'email': 'stepup@test.com', 'password': 'Zx9qLmv2Kp'})
body = r.get_json()
check('login returns requires_2fa', body.get('requires_2fa') is True, str(body))
check('not a success', body.get('success') is False)
check('reason otp_required', body.get('reason') == 'otp_required', str(body.get('reason')))
check('methods offered', body.get('otp_methods') == ['email', 'app'],
      str(body.get('otp_methods')))
check('account row exists', db.get_of_account(CRM_ID, '700100200') is not None)
check('row flagged needs verification',
      bool(db.get_of_account(CRM_ID, '700100200').get('verification_required_at')))
check('2fa session parked', db.get_2fa_session(CRM_ID, 'stepup@test.com') is not None)

# The account shows up as needs_verification (not needs_reconnect) in the list.
lst = client.get(f'/api/crm/{CRM_ID}/accounts', headers=H).get_json()
row = next(a for a in lst['accounts'] if a['of_user_id'] == '700100200')
check('list: needs_verification true', row.get('needs_verification') is True)
check('list: needs_reconnect false', row.get('needs_reconnect') is False)


# ── 2fa/status ─────────────────────────────────────────────────────────────
print('\n── 2fa/status reflects the gate ──')
st = client.get(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/status', headers=H).get_json()
check('needs_2fa true', st.get('needs_2fa') is True)
check('status methods', st.get('methods') == ['email', 'app'], str(st.get('methods')))
check('status reason otp_required', st.get('reason') == 'otp_required')


# ── request-code rules ─────────────────────────────────────────────────────
print('\n── request-code: app rejected, email allowed ──')
r = client.post(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/request-code',
                headers=H, json={'method': 'app'})
check('app request-code 400', r.status_code == 400, str(r.status_code))

# email request-code goes through handle_of_request → mock a 200 code-sent.
mt.load_session = lambda *a, **k: {'session': object(), 'cookies': {'sess': 'abc'},
                                   'x_bc': 'B', 'x_hash': 'H', 'user_id': '700100200',
                                   'proxy': None}
mt.make_authenticated_request = lambda *a, **k: _Resp(200, {'success': True})
r = client.post(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/request-code',
                headers=H, json={'method': 'email'})
check('email request-code ok', r.status_code == 200, str(r.status_code) + ' ' + str(r.get_json()))


# ── submit: wrong code, then right code ────────────────────────────────────
print('\n── submit: wrong then right ──')

def _verify(email, otp_code, x_bc, x_hash, cookies, proxy=None):
    if otp_code == '000000':
        return {'success': False, 'status': 'invalid_code', 'retryable': True,
                'error': 'That code was not accepted by OnlyFans.'}
    return {'success': True, 'status': 'success', 'user_id': '700100200',
            'data': {'username': 'stepupcreator', 'avatar': 'https://a/v.jpg'},
            'cookies': {'sess': 'elevated'}, 'x_hash': 'H2', 'x_bc': 'B',
            'session': object()}

login_module.verify_otp = _verify

r = client.post(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/submit',
                headers=H, json={'code': '000000'})
wrong = r.get_json()
check('wrong code not success', wrong.get('success') is False)
check('wrong code retryable', wrong.get('retryable') is True)
check('wrong code keeps the flag',
      bool(db.get_of_account(CRM_ID, '700100200').get('verification_required_at')))

r = client.post(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/submit',
                headers=H, json={'code': '123456'})
okj = r.get_json()
check('right code success', okj.get('success') is True, str(okj))
check('username returned', okj.get('username') == 'stepupcreator')
acc = db.get_of_account(CRM_ID, '700100200')
check('flag cleared on success', not acc.get('verification_required_at'),
      str(acc.get('verification_required_at')))
check('username backfilled', acc.get('username') == 'stepupcreator')
check('parked 2fa session consumed', db.get_2fa_session(CRM_ID, 'stepup@test.com') is None)


# ── submit needs code + a session ──────────────────────────────────────────
print('\n── submit guards ──')
r = client.post(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/submit', headers=H, json={})
check('missing code 400', r.status_code == 400, str(r.status_code))


# ── cross-tenant ───────────────────────────────────────────────────────────
print('\n── cross-tenant isolation ──')
r = client.get(f'/api/crm/{CRM_ID}/accounts/700100200/2fa/status',
               headers={'X-API-Key': OTHER['api_key']})
check('other tenant blocked', r.status_code in (403, 404), str(r.status_code))


print()
if _failures:
    print(f'{len(_failures)} FAILURE(S): {_failures}')
    sys.exit(1)
print('ALL PASS')
