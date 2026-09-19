#!/usr/bin/env python3
"""HTTP-level tests (Flask test_client) for the Fansly route seams.

All Fansly API traffic is mocked — zero network, throwaway DB.

Covers:
  - GET /purchases?offset=N no longer 500s (params coerced before the seam)
    and marker translates to the wallet 'before' cursor (pages advance)
  - GET /subscribers/cached + /subscribers/refresh/status → 501
    platform_not_supported for fansly (no more silently-empty 200)
  - POST /accounts/<id>/request + /api2/v2/<path> passthrough → 501 with hint
  - POST /transactions/refresh accepted (202) for fansly; status reports rows
  - POST /backfill accepted (202) for fansly
  - PATCH /polling carries a warning when FANSLY_POLLING_ENABLED is off and
    dispatches the fansly backfill (not the OF bundle) on OFF→ON
  - OF accounts keep their behavior (no regression on the 501s)

    venv/bin/python tests/test_fansly_routes_http.py
"""

import os
import sys
import tempfile
import time

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import fansly_client               # noqa: E402
import crm_api                     # noqa: E402
import scheduler as scheduler_mod  # noqa: E402
import fansly_sync                 # noqa: E402
import refresh_state               # noqa: E402
import config                      # noqa: E402

# The scheduler never starts under WERKZEUG_RUN_MAIN=false — stub the job
# (un)registration the polling PATCH calls so it doesn't NPE in tests.
scheduler_mod.schedule_account = lambda *a, **k: None
scheduler_mod.unschedule_account = lambda *a, **k: None
scheduler_mod.start_ws_listener = lambda *a, **k: None
scheduler_mod.start_fansly_ws_listener = lambda *a, **k: None

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Fansly Routes Test Panel')
CRM_ID = panel['crm_id']
KEY = panel['api_key']
ACCT = '847000000000000001'
OF_ACCT = '482000001'

db.add_of_account(crm_id=CRM_ID, of_user_id=ACCT, email='f@test.com',
                  password=None, username='fanslycreator', platform='fansly')
db.add_of_account(crm_id=CRM_ID, of_user_id=OF_ACCT, email='o@test.com',
                  password=None, username='ofcreator')

client = crm_api.app.test_client()
H = {'X-API-Key': KEY, 'User-Agent': 'Mozilla/5.0 test'}


def _row(tid, amount, created):
    return {'transactionId': tid, 'type': 7101, 'amount': amount,
            'destinationAmount': amount, 'destinationTax': 2000,
            'correlationAccountId': '111', 'senderId': None,
            'receiverId': ACCT, 'destination': 2, 'status': 2,
            'createdAt': created}


ALL_ROWS = [_row(str(934000000000000010 - i), 8000 + i, 1784219134000 - i * 1000)
            for i in range(7)]


# /account/wallets/earnings behaviour: None → no pendingBalance in the body
# (the pre-existing fixture), an int → that pendingBalance, 'fail' → a 502.
PENDING = {'value': None}
CALLS = []


def _fake_handle(crm_id, account_id, path, method='GET', body=None, proxy=None):
    CALLS.append(path)
    if path.startswith('/api/v1/account/wallets/earnings'):
        if PENDING['value'] == 'fail':
            return False, {'success': False, 'error': 'upstream 502'}, 502, False
        resp = {} if PENDING['value'] is None else {'pendingBalance': PENDING['value']}
        return True, {'success': True, 'response': resp}, 200, False
    if path.startswith('/api/v1/account/wallets/transactions'):
        q = path.split('?', 1)[1] if '?' in path else ''
        params = dict(kv.split('=') for kv in q.split('&') if '=' in kv)
        limit = int(params.get('limit', 100))
        rows = ALL_ROWS
        if 'before' in params:
            rows = [r for r in rows if int(r['transactionId']) < int(params['before'])]
        elif 'offset' in params:
            rows = rows[int(params['offset']):]
        return True, {'success': True, 'response': {'total': len(ALL_ROWS),
                                                    'data': rows[:limit]}}, 200, False
    if path.startswith('/api/v1/account/me'):
        return True, {'success': True, 'response': {'account': {
            'id': ACCT, 'username': 'fanslycreator',
            'earningsWallet': {'balance': 489360}}}}, 200, False
    return True, {'success': True, 'response': {}}, 200, False


_orig = fansly_client.handle_fansly_request
fansly_client.handle_fansly_request = _fake_handle

# Capture background dispatches instead of running them.
_dispatched = []
_orig_bg = scheduler_mod.run_in_background


def _fake_bg(fn, *args, job_id_prefix='oneshot'):
    _dispatched.append((getattr(fn, '__name__', str(fn)), args, job_id_prefix))
    return 'job-test'


scheduler_mod.run_in_background = _fake_bg
crm_api.scheduler_mod.run_in_background = _fake_bg

try:
    # ── 1. purchases offset/marker paging ──────────────────────────────────
    print('\nGET /purchases:')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/purchases?limit=3&offset=0',
                   headers=H)
    check('offset=0 no longer 500s', r.status_code == 200, f'{r.status_code}')
    p1 = r.get_json()
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/purchases?limit=3&offset=3',
                   headers=H)
    check('offset=3 returns 200', r.status_code == 200, f'{r.status_code}')
    p2 = r.get_json()
    ids1 = [x['id'] for x in p1['purchases']]
    ids2 = [x['id'] for x in p2['purchases']]
    check('offset paging advances', ids1 and ids2 and set(ids1).isdisjoint(ids2),
          f'{ids1} vs {ids2}')
    check('page-1 emits an advancing nextMarker', p1.get('nextMarker') == ids1[-1])
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/purchases'
                   f'?limit=3&marker={p1["nextMarker"]}', headers=H)
    p3 = r.get_json()
    ids3 = [x['id'] for x in p3['purchases']]
    check('marker paging advances past the marker',
          ids3 and all(int(i) < int(p1['nextMarker']) for i in ids3), f'{ids3}')
    check('bad offset is a 400 not a 500',
          client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/purchases?offset=abc',
                     headers=H).status_code == 400)

    # ── 2. subscribers cached/status/refresh now SERVE fansly ──────────────
    # (enumeration is live-proven; deep coverage in test_fansly_subscribers.py)
    print('\nsubscribers cached/status/refresh:')
    for ep in ('subscribers/cached', 'subscribers/refresh/status'):
        r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/{ep}', headers=H)
        b = r.get_json()
        check(f'{ep} → 200 for fansly (no more 501)',
              r.status_code == 200 and b.get('success') is True,
              f'{r.status_code} {b}')
    _dispatched.clear()
    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers/refresh',
                    headers=H, json={'mode': 'full'})
    check('POST /subscribers/refresh → 202 for fansly', r.status_code == 202,
          f'{r.status_code}')
    check('dispatches the shared subs progress wrapper (fansly-aware)',
          _dispatched and _dispatched[-1][0] == 'run_subs_refresh_with_progress',
          str(_dispatched))
    refresh_state.finish(CRM_ID, ACCT, 'subs', success=True)
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{OF_ACCT}/subscribers/cached', headers=H)
    check('OF subscribers/cached still 200', r.status_code == 200, f'{r.status_code}')

    # ── 3. raw proxy guards ────────────────────────────────────────────────
    print('\nraw proxy:')
    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/request', headers=H,
                    json={'path': '/api2/v2/users/me', 'method': 'GET'})
    b = r.get_json()
    check('POST /request → 501 with hint',
          r.status_code == 501 and b.get('code') == 'platform_not_supported'
          and 'Fansly' in (b.get('hint') or ''), f'{r.status_code} {b}')
    r = client.get(f'/api/crm/{CRM_ID}/api2/v2/users/me',
                   headers={**H, 'user-id': ACCT})
    b = r.get_json()
    check('/api2/v2 passthrough → 501 with hint',
          r.status_code == 501 and 'Fansly' in (b.get('hint') or ''),
          f'{r.status_code} {b}')

    # ── 4. transactions refresh + backfill accepted for fansly ────────────
    print('\nrefresh/backfill dispatch:')
    _dispatched.clear()
    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/transactions/refresh',
                    headers=H, json={'mode': 'delta'})
    check('POST /transactions/refresh → 202', r.status_code == 202, f'{r.status_code}')
    check('dispatches the FANSLY tx sync',
          _dispatched and _dispatched[-1][0] == 'run_fansly_tx_refresh_with_progress',
          str(_dispatched))
    # The mocked bg pool never runs the job, so finish the route's state stub
    # manually (else /backfill sees it mid-flight and reports already_running).
    refresh_state.finish(CRM_ID, ACCT, 'tx', success=True)
    time.sleep(3.2)  # completed entries linger COMPLETED_TTL_SECONDS
    _dispatched.clear()
    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/backfill', headers=H, json={})
    check('POST /backfill → 202', r.status_code == 202, f'{r.status_code}')
    check('dispatches the FANSLY backfill',
          _dispatched and _dispatched[-1][0] == 'run_fansly_backfill_with_progress',
          str(_dispatched))
    check('transactions_refresh capability true on account payloads',
          client.get(f'/api/crm/{CRM_ID}/accounts', headers=H).get_json()
          ['accounts'] is not None)

    # run the real sync inline to prove /transactions/refresh/status fills in
    fansly_sync.run_fansly_tx_refresh_with_progress(CRM_ID, ACCT, mode='initial')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/transactions/refresh/status',
                   headers=H)
    cache = (r.get_json() or {}).get('cache') or {}
    check('refresh/status reports fansly rows + last_refreshed_at',
          cache.get('total') == len(ALL_ROWS) and cache.get('last_refreshed_at'),
          str(cache))
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/transactions/cached', headers=H)
    b = r.get_json()
    check('GET /transactions/cached serves the synced ledger',
          b.get('total') == len(ALL_ROWS) and b['list'][0].get('type') == 'tip',
          f"total={b.get('total')}")

    # ── 5. polling PATCH: fansly backfill + gate warning ───────────────────
    print('\nPATCH /polling:')
    _dispatched.clear()
    saved_flag = config.FANSLY_POLLING_ENABLED
    config.FANSLY_POLLING_ENABLED = False
    try:
        r = client.patch(f'/api/crm/{CRM_ID}/accounts/{ACCT}/polling', headers=H,
                         json={'enabled': True})
        b = r.get_json()
        check('PATCH ok', r.status_code == 200 and b.get('success'), f'{r.status_code}')
        check('warning when FANSLY_POLLING_ENABLED=false',
              'FANSLY_POLLING_ENABLED' in (b.get('warning') or ''), str(b))
        backfills = [d for d in _dispatched if 'backfill' in d[2]]
        check('OFF→ON dispatches the FANSLY backfill (not the OF bundle)',
              backfills and backfills[-1][0] == 'run_fansly_backfill_with_progress',
              str(_dispatched))
    finally:
        config.FANSLY_POLLING_ENABLED = saved_flag
        client.patch(f'/api/crm/{CRM_ID}/accounts/{ACCT}/polling', headers=H,
                     json={'enabled': False})

    # ── 6. earnings summary: balance separated from period totals ─────────
    #
    # The summary no longer makes a live wallet call per account — that was
    # O(accounts) upstream requests and is exactly why the route could not
    # converge at panel scale. It reads the last SAMPLED balance instead, so
    # the flow under test is now two-step: something has to stamp the sample
    # first. Assert the unsampled state explicitly rather than only the happy
    # path, because "0" is what a regression here would look like.
    print('\nearnings summary:')
    r = client.get(f'/api/crm/{CRM_ID}/earnings/summary?period=today', headers=H)
    b = r.get_json()
    check('summary 200', r.status_code == 200, f'{r.status_code}')
    check('unsampled fansly account reports floor 0 but declares coverage',
          (b.get('fansly_balance_floor') == 0.0
           and b.get('fansly_accounts') == 1
           and b.get('fansly_balance_sampled') == 0), str(b))
    check('summary is served from cache, not live calls',
          b.get('source') == 'cache', str(b.get('source')))

    # A normal dashboard balances fetch stamps the sample (_maybe_fansly →
    # record_account_balance). After that the floor must appear.
    rb = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/balances', headers=H)
    check('balances 200', rb.status_code == 200, f'{rb.status_code}')
    crm_api.earnings_cache.invalidate(CRM_ID)
    r = client.get(f'/api/crm/{CRM_ID}/earnings/summary?period=today', headers=H)
    b = r.get_json()
    check('fansly_balance_floor emitted separately once sampled',
          abs((b.get('fansly_balance_floor') or 0) - 489.36) < 0.01, str(b))
    check('coverage reports the account as sampled',
          b.get('fansly_balance_sampled') == 1, str(b))
    check('wallet balance NOT inside period total',
          (b.get('total') or 0) < 489.0, f"total={b.get('total')}")

    # ── 7. current / available / pending ─────────────────────────────────
    # Confirmed live: earningsWallet.balance is the WITHDRAWABLE figure and
    # /account/wallets/earnings pendingBalance is held on top of it.
    print('\nwallet: current / available / pending:')
    PENDING['value'] = 120500            # $120.50 on hold
    rb = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/balances', headers=H)
    bal = (rb.get_json() or {}).get('balances') or {}
    check('/balances returns all three figures',
          (bal.get('currentBalance'), bal.get('payoutAvailable'), bal.get('pendingBalance'))
          == (609.86, 489.36, 120.5), str(bal))
    crm_api.earnings_cache.invalidate(CRM_ID)
    b = client.get(f'/api/crm/{CRM_ID}/earnings/summary?period=today', headers=H).get_json()
    fb = b.get('fansly_balance') or {}
    check('summary fansly_balance carries current/available/pending',
          (fb.get('current'), fb.get('available'), fb.get('pending'))
          == (609.86, 489.36, 120.5), str(fb))
    check('floor still aliases available', b.get('fansly_balance_floor') == 489.36,
          str(b.get('fansly_balance_floor')))

    PENDING['value'] = 'fail'
    rb = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/balances', headers=H)
    check('a failing pending call does not fail /balances', rb.status_code == 200,
          f'{rb.status_code}')
    acc = db.get_of_account(CRM_ID, ACCT)
    check('…and keeps the stored pending figure',
          acc.get('last_balance_pending') == 120.5
          and acc.get('last_balance_current') == 609.86, str(acc.get('last_balance_pending')))

    # ── 8. scheduled Fansly refresh (independent of polling) ──────────────
    print('\nrun_fansly_scheduled_refresh:')
    PENDING['value'] = 100000            # $100.00 on hold now
    crm_api.earnings_cache.put(CRM_ID, 'week', {'total': 1})
    out = fansly_sync.run_fansly_scheduled_refresh(CRM_ID, ACCT)
    check('ran', out['ran'] and out['skipped'] is None, str(out))
    check('wallet snapshot taken and changed', out['wallet_ok'] and out['wallet_changed'],
          str(out))
    acc = db.get_of_account(CRM_ID, ACCT)
    check('stamped current/available/pending',
          (acc.get('last_balance_current'), acc.get('last_balance_available'),
           acc.get('last_balance_pending')) == (589.36, 489.36, 100.0),
          str((acc.get('last_balance_current'), acc.get('last_balance_available'),
               acc.get('last_balance_pending'))))
    check('ledger refresh stamped', bool(acc.get('last_transactions_refresh_at')))
    check('summary cache dropped after a change',
          crm_api.earnings_cache.get(CRM_ID, 'week') is None)

    out = fansly_sync.run_fansly_scheduled_refresh(CRM_ID, OF_ACCT)
    check('OF accounts are not handled here', out['skipped'] == 'not_fansly', str(out))

    db.set_relogin_block(CRM_ID, ACCT, 'session dead')
    CALLS.clear()
    out = fansly_sync.run_fansly_scheduled_refresh(CRM_ID, ACCT)
    check('relogin-blocked: skipped, zero upstream calls',
          out['skipped'] == 'relogin_blocked' and not CALLS, f'{out} {CALLS}')
    conn = db.sqlite3.connect(db.DB_FILE)
    conn.execute('UPDATE of_accounts SET relogin_blocked_at = NULL WHERE of_user_id = ?',
                 (ACCT,))
    conn.commit()
    conn.close()

    db.set_connection_error(CRM_ID, ACCT, 'proxy_error', 'proxy_connection')
    conn = db.sqlite3.connect(db.DB_FILE)
    conn.execute('UPDATE of_accounts SET transactions_refresh_failure_count = 3 '
                 'WHERE of_user_id = ?', (ACCT,))
    conn.commit()
    conn.close()
    CALLS.clear()
    out = fansly_sync.run_fansly_scheduled_refresh(CRM_ID, ACCT)
    check('dead proxy: backs off, zero upstream calls',
          out['skipped'] == 'backoff' and not CALLS, f'{out} {CALLS}')
    db.clear_connection_error(CRM_ID, ACCT)
    out = fansly_sync.run_fansly_scheduled_refresh(CRM_ID, ACCT)
    check('cleared connection state: runs again', out['ran'], str(out))
finally:
    fansly_client.handle_fansly_request = _orig
    scheduler_mod.run_in_background = _orig_bg
    crm_api.scheduler_mod.run_in_background = _orig_bg

print()
if _failures:
    print(f'FAILED: {len(_failures)} check(s): {_failures}')
    sys.exit(1)
print('ALL PASS')
