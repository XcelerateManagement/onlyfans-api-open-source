#!/usr/bin/env python3
"""Tests for the Fansly send_message wiring — ALL network calls are mocked
(NEVER sends anything to api.fansly.com; write paths are untestable live by
policy, so this is the coverage).

Covers:
  - PPV price dollars→cents conversion in fansly_data._path_for('send_message')
  - reply_to_id passthrough as body['inReplyTo']
  - integrations/of_dm branches to Fansly: group lookup via /messaging/groups,
    send via fansly_data.fetch, allow_of_write_actions gate still enforced
  - no group found → actionable error, nothing sent

Runs against a throwaway DB — zero network calls.

    venv/bin/python tests/test_fansly_send.py
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
import fansly_data                 # noqa: E402
import fansly_client               # noqa: E402
from integrations import of_dm    # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Fansly Send Test Panel')
CRM_ID = panel['crm_id']
ACCT = '847000000000000001'
FAN = '999000000000000002'
GROUP = '555000000000000003'

db.add_of_account(crm_id=CRM_ID, of_user_id=ACCT, email='f@test.com',
                  password=None, username='fanslycreator', platform='fansly')
db.update_account_polling(CRM_ID, ACCT, allow_of_write_actions=True)


# ── 1. price dollars→cents + inReplyTo in _path_for ───────────────────────
print('\n_path_for(send_message):')
method, path, body = fansly_data._path_for('send_message', {
    'groupId': GROUP, 'text': 'hi', 'price': 5,
})
check('POST /api/v1/message', method == 'POST' and path == '/api/v1/message')
check('price 5 dollars → 5000 tenths-of-cent', body.get('price') == 5000,
      f"got {body.get('price')!r}")
check('price value is int', isinstance(body.get('price'), int))

_, _, body = fansly_data._path_for('send_message', {
    'groupId': GROUP, 'text': 'ppv', 'price': '19.99',
})
check("price '19.99' (str) → 19990 tenths-of-cent", body.get('price') == 19990,
      f"got {body.get('price')!r}")

_, _, body = fansly_data._path_for('send_message', {
    'groupId': GROUP, 'text': 'free',
})
check('no price → no price key', 'price' not in body)
check('no reply → no inReplyTo key', 'inReplyTo' not in body)

_, _, body = fansly_data._path_for('send_message', {
    'groupId': GROUP, 'text': 'reply', 'reply_to_id': 123456789,
})
check('reply_to_id → inReplyTo (str)', body.get('inReplyTo') == '123456789',
      f"got {body.get('inReplyTo')!r}")


# ── 2. of_dm branches to Fansly (mocked client + fetch) ───────────────────
print('\nof_dm fansly branch:')
calls = {'requests': [], 'fetches': []}


def _fake_handle(crm_id, account_id, path, method='GET', body=None, proxy=None):
    calls['requests'].append((path, method, body))
    if path.startswith('/api/v1/messaging/groups'):
        assert method == 'GET', 'group lookup must be a GET'
        return True, {'success': True, 'response': {'data': [
            {'groupId': GROUP, 'partnerAccountId': FAN},
            {'groupId': '111', 'partnerAccountId': '42'},
        ]}}, 200, False
    raise AssertionError(f'unexpected fansly request {method} {path}')


def _fake_fetch(crm_id, account_id, feature, params=None, proxy=None):
    calls['fetches'].append((feature, dict(params or {})))
    return 200, {'success': True, 'message_id': '777'}


_orig_handle = fansly_client.handle_fansly_request
_orig_fetch = fansly_data.fetch
fansly_client.handle_fansly_request = _fake_handle
fansly_data.fetch = _fake_fetch
try:
    of_dm.send(CRM_ID, ACCT, {'message': 'thanks for the tip!'},
               {'payload': {'fan': {'id': FAN}}})
    check('group lookup was a GET /messaging/groups',
          any(p.startswith('/api/v1/messaging/groups') and m == 'GET'
              for p, m, _ in calls['requests']))
    check('send went through fansly_data.fetch(send_message)',
          len(calls['fetches']) == 1 and calls['fetches'][0][0] == 'send_message')
    sent = calls['fetches'][0][1] if calls['fetches'] else {}
    check('resolved the fan → groupId', sent.get('groupId') == GROUP,
          f"got {sent.get('groupId')!r}")
    check('message text forwarded', sent.get('text') == 'thanks for the tip!')

    # No conversation with the fan → actionable error, nothing sent
    calls['fetches'].clear()
    err = None
    try:
        of_dm.send(CRM_ID, ACCT, {'message': 'x'},
                   {'payload': {'fan': {'id': '424242'}}})
    except RuntimeError as e:
        err = str(e)
    check('unknown fan raises (no group)', err is not None and 'group' in err.lower(),
          f'err={err!r}')
    check('nothing sent when no group resolves', len(calls['fetches']) == 0)

    # allow_of_write_actions gate still applies to Fansly sends
    db.update_account_polling(CRM_ID, ACCT, allow_of_write_actions=False)
    gated = False
    try:
        of_dm.send(CRM_ID, ACCT, {'message': 'x'}, {'payload': {'fan': {'id': FAN}}})
    except PermissionError:
        gated = True
    check('write-gate blocks fansly send_dm', gated)
    db.update_account_polling(CRM_ID, ACCT, allow_of_write_actions=True)
finally:
    fansly_client.handle_fansly_request = _orig_handle
    fansly_data.fetch = _orig_fetch


# ── 3. fetch() builds the cents body end-to-end (client mocked) ───────────
print('\nfetch(send_message) end-to-end body:')
captured = {}


def _capture_handle(crm_id, account_id, path, method='GET', body=None, proxy=None):
    captured.update({'path': path, 'method': method, 'body': body})
    return True, {'success': True, 'response': {'id': '888'}}, 200, False


fansly_client.handle_fansly_request = _capture_handle
try:
    status, resp = fansly_data.fetch(CRM_ID, ACCT, 'send_message', {
        'with_user_id': GROUP, 'text': 'ppv drop', 'price': 560.0,
        'reply_to_id': '936000000000000000',
    })
    check('fetch returns 200/success', status == 200 and resp.get('success'))
    check('POST body price is 560000 tenths-of-cent ($560)',
          (captured.get('body') or {}).get('price') == 560000,
          f"got {(captured.get('body') or {}).get('price')!r}")
    check('POST body carries inReplyTo',
          (captured.get('body') or {}).get('inReplyTo') == '936000000000000000')
    check('message_id echoed', resp.get('message_id') == '888')
finally:
    fansly_client.handle_fansly_request = _orig_handle


print()
if _failures:
    print(f'FAILED: {len(_failures)} check(s): {_failures}')
    sys.exit(1)
print('ALL PASS')
