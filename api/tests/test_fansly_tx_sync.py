#!/usr/bin/env python3
"""Tests for the Fansly wallet-ledger sync (fansly_sync) + the enriched tx
normalizer. All Fansly API calls are mocked — zero network, throwaway DB.

Covers:
  - _normalize_tx money math (amount = net wallet credit; destinationTax is a
    RATE in percent×100 → gross/net/fee reconstruction), type labels,
    synthetic descriptions, status mapping, fan enrichment
  - sync_fansly_transactions initial walk (before-cursor paging), upserts into
    transactions_cache with correct tx_type via _classify_tx
  - snowflake cursor persisted to polling_cursor.last_fansly_tx_id and the
    delta walk stopping at it (caught_up)
  - payout rows excluded from local_earnings_from_cache
  - normalize_transactions hasMore / nextMarker semantics (marker advances)
  - fansly_data._attach_earnings_series builds a daily chart from the cache
  - platform_features: new keys present, fansly websocket/polling reflect flags

    venv/bin/python tests/test_fansly_tx_sync.py
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
import fansly_client               # noqa: E402
import fansly_normalize as fnorm   # noqa: E402
import fansly_sync                 # noqa: E402
import fansly_data                 # noqa: E402
import fansly_wallet as fwallet    # noqa: E402
import platform_features as pf     # noqa: E402
import config                      # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Fansly Sync Test Panel')
CRM_ID = panel['crm_id']
ACCT = '847000000000000001'
FAN_A = '111000000000000001'   # harvested (has username)
FAN_B = '222000000000000002'   # not harvested

db.add_of_account(crm_id=CRM_ID, of_user_id=ACCT, email='f@test.com',
                  password=None, username='fanslycreator', platform='fansly')
db.upsert_fan(CRM_ID, ACCT, FAN_A, username='bigspender', display_name='Big Spender')

# Wallet rows modeled on CONFIRMED live shapes: amount is the creator's NET
# credit in *tenths of a cent* (value/1000 == dollars, NOT cents — see
# fansly_normalize._cents); destinationTax is the fee rate ×100 (2000 == 20.00%).
DAY1 = 1784219134000  # ms
DAY0 = DAY1 - 86400000


def _row(tid, ttype, amount, fan=None, created=DAY1, status=2, rate=2000,
         payout=False):
    return {
        'transactionId': tid, 'type': ttype, 'amount': amount,
        'destinationAmount': None if payout else amount,
        'destinationTax': 0 if payout else rate,
        'correlationAccountId': fan,
        'senderId': ACCT if payout else None,
        'receiverId': None if payout else ACCT,
        'destination': 1 if payout else 2,
        'status': status, 'createdAt': created,
    }


PAGE1 = [
    _row('934000000000000005', 7101, 8000, fan=FAN_A, status=1),         # $10 tip → net $8
    _row('934000000000000004', 15001, 40000, fan=FAN_B),                 # sub, net $40
    _row('934000000000000003', 2116, 160000, fan=FAN_A, created=DAY0),   # msg, net $160
]
PAGE2 = [
    _row('934000000000000002', 2110, 80000, fan=FAN_B, created=DAY0),    # post, net $80
    _row('934000000000000001', 16012, 1580000, created=DAY0, payout=True),  # payout $1580
]


def _fake_wallet(pages):
    total = sum(len(p) for p in pages)

    def handle(crm_id, account_id, path, method='GET', body=None, proxy=None):
        assert method == 'GET'
        assert path.startswith('/api/v1/account/wallets/transactions')
        if 'before=' in path:
            before = path.split('before=')[1].split('&')[0]
            flat = [r for p in pages for r in p]
            page = [r for r in flat if int(r['transactionId']) < int(before)][:100]
        else:
            page = pages[0]
        return True, {'success': True,
                      'response': {'total': total, 'data': page}}, 200, False
    return handle


# ── 1. normalizer money math + enrichment ─────────────────────────────────
print('\n_normalize_tx:')
fan_idx = db.fans_username_index(CRM_ID, ACCT)
n = fnorm._normalize_tx(PAGE1[0], self_account_id=ACCT, fan_idx=fan_idx)
check('tip: type label', n['type'] == 'tip', f"got {n['type']!r}")
check('tip: net = wallet credit $8', n['net'] == 8.0, f"got {n['net']!r}")
check('tip: gross reconstructed $10', n['amount'] == 10.0, f"got {n['amount']!r}")
check('tip: fee $2', n['fee'] == 2.0, f"got {n['fee']!r}")
check('tip: status 1 → done', n['status'] == 'done', f"got {n['status']!r}")
check('tip: username enriched from fans table',
      n['user']['username'] == 'bigspender', f"got {n['user']!r}")
check('tip: description keys the categorizer',
      n['description'] == 'Tip from Big Spender', f"got {n['description']!r}")
check('tip: createdAt is ISO', str(n['createdAt']).startswith('2026-'))

n2 = fnorm._normalize_tx(PAGE1[1], self_account_id=ACCT, fan_idx=fan_idx)
check('sub: type/description', n2['type'] == 'subscription'
      and n2['description'].startswith('Subscription from'), f"got {n2['description']!r}")
check('unharvested fan: id kept, username None',
      n2['user']['id'] == FAN_B and n2['user']['username'] is None)

n3 = fnorm._normalize_tx(PAGE2[1], self_account_id=ACCT, fan_idx=fan_idx)
check('payout: type + no fan', n3['type'] == 'payout' and n3['user']['id'] is None,
      f"got {n3['type']!r}/{n3['user']!r}")
check('payout: rate 0 → fee 0, amount = net', n3['fee'] == 0.0 and n3['amount'] == 1580.0)

nu = fnorm._normalize_tx(_row('1', 424242, 500, fan=FAN_B), self_account_id=ACCT)
check('unknown code: string type, never int',
      isinstance(nu['type'], str) and nu['type'] == '424242')

# ── 2. initial sync walks pages, upserts, persists cursor ─────────────────
print('\nsync (initial):')
_orig_handle = fansly_client.handle_fansly_request
fansly_client.handle_fansly_request = _fake_wallet([PAGE1, PAGE2])
# force paging: shrink page size so 'hasMore' logic (len < PAGE_SIZE) pages on
fansly_sync.PAGE_SIZE = 3
try:
    res = fansly_sync.sync_fansly_transactions(CRM_ID, ACCT, mode='initial')
    check('sync success', res['success'], str(res))
    check('5 rows inserted', res['rows_inserted'] == 5, str(res))
    check('walked 2 pages', res['pages_fetched'] == 2, str(res))

    rows, total = db.list_transactions_cache(CRM_ID, ACCT, limit=100)
    check('cache holds 5 rows', total == 5, f'total={total}')
    by_type = {}
    for r0, _t in [(r, None) for r in rows]:
        # rows carry raw_json (normalized dict); the flat row has tx_type
        pass
    flat, _ = db.list_transactions_cache(CRM_ID, ACCT, limit=100)
    types = sorted(r['tx_type'] for r in flat)
    check('tx_type classified from the wallet type code',
          types == ['message', 'payout', 'post', 'subscription', 'tip'],
          f'got {types}')
    tip_row = next(r for r in flat if r['tx_type'] == 'tip')
    check('cache row: gross/net/fee dollars',
          tip_row['amount'] == 10.0 and tip_row['net'] == 8.0 and tip_row['fee'] == 2.0)
    check('cache row: fan attribution',
          tip_row['fan_of_user_id'] == FAN_A and tip_row['fan_username'] == 'bigspender')

    cursor = db.load_polling_cursor(CRM_ID, ACCT) or {}
    check('cursor persisted (newest snowflake)',
          cursor.get('last_fansly_tx_id') == '934000000000000005',
          f"got {cursor.get('last_fansly_tx_id')!r}")
    summary = db.transactions_cache_summary(CRM_ID, ACCT)
    check('refresh status has last_refreshed_at',
          bool(summary.get('last_refreshed_at')))

    # ── 3. delta walk stops at the cursor ──────────────────────────────────
    print('\nsync (delta):')
    res2 = fansly_sync.sync_fansly_transactions(CRM_ID, ACCT, mode='delta')
    check('delta caught_up with 0 inserts',
          res2['stopped_reason'] == 'caught_up' and res2['rows_inserted'] == 0,
          str(res2))
    check('delta walked 1 page', res2['pages_fetched'] == 1, str(res2))

    # new row lands → delta picks it up and advances the cursor
    NEW = _row('934000000000000009', 7101, 16000, fan=FAN_A, status=1)
    fansly_client.handle_fansly_request = _fake_wallet([[NEW] + PAGE1[:2], PAGE1[2:] + PAGE2])
    res3 = fansly_sync.sync_fansly_transactions(CRM_ID, ACCT, mode='delta')
    check('delta inserts only the new row',
          res3['rows_inserted'] == 1 and res3['stopped_reason'] == 'caught_up', str(res3))
    cursor = db.load_polling_cursor(CRM_ID, ACCT) or {}
    check('cursor advanced', cursor.get('last_fansly_tx_id') == '934000000000000009',
          f"got {cursor.get('last_fansly_tx_id')!r}")
finally:
    fansly_client.handle_fansly_request = _orig_handle
    fansly_sync.PAGE_SIZE = 100

# ── 4. payout excluded from local earnings ────────────────────────────────
print('\nearnings from cache:')
curr, prev, chart, cats, cnt = db.local_earnings_from_cache(
    CRM_ID, ACCT, '2020-01-01 00:00:00', '2030-01-01 00:00:00',
    '2010-01-01 00:00:00', '2019-12-31 23:59:59')
# nets: tip 8 + sub 40 + msg 160 + post 80 + new tip 16 = 304 (payout 1580 excluded)
check('payout excluded from totals', abs(curr - 304.0) < 0.01, f'got {curr}')
check('categories bucketed', abs(cats.get('tips', 0) - 24.0) < 0.01
      and abs(cats.get('subscriptions', 0) - 40.0) < 0.01
      and abs(cats.get('messages', 0) - 160.0) < 0.01
      and abs(cats.get('posts', 0) - 80.0) < 0.01, f'got {cats}')
check('payout not a category', 'payout' not in cats)

# ── 5. earnings daily series from cache ───────────────────────────────────
print('\n_attach_earnings_series:')
body = {'success': True, 'earnings': {'total': {'chartAmount': [], 'chartCount': []},
                                      'chartAmount': [], 'chartCount': [],
                                      'series_available': False}}
fansly_data._attach_earnings_series(CRM_ID, ACCT, body, '2026-07-01', '2026-07-31')
e = body['earnings']
check('series_available flipped true', e['series_available'] is True)
check('continuous daily axis (31 points)', len(e['chartAmount']) == 31,
      f"got {len(e['chartAmount'])}")
total_amt = round(sum(p['count'] for p in e['chartAmount']), 2)
check('series sums to net earnings (payout excluded)', abs(total_amt - 304.0) < 0.01,
      f'got {total_amt}')
check('total.chartAmount mirrored', body['earnings']['total']['chartAmount'] is e['chartAmount'])

body2 = {'success': True, 'earnings': {'series_available': False}}
fansly_data._attach_earnings_series(CRM_ID, ACCT, body2, '2019-01-01', '2019-01-31')
check('empty range keeps series_available false',
      body2['earnings']['series_available'] is False)

# ── 6. normalize_transactions paging semantics ────────────────────────────
print('\nnormalize_transactions paging:')
env = {'success': True, 'response': {'total': 5, 'data': PAGE1}}
b = fnorm.normalize_transactions(env, offset='0', limit='3', self_account_id=ACCT)
check("string offset/limit don't crash", b['success'] and b['count'] == 3)
check('offset paging: hasMore from total', b['hasMore'] is True)
check('nextMarker emitted on page 1', b['nextMarker'] == '934000000000000003')

b2 = fnorm.normalize_transactions(env, offset=3, limit=3, self_account_id=ACCT,
                                  marker='934000000000000003')
# same page again (marker didn't advance server-side)
check('non-advancing marker → no nextMarker', b2['nextMarker'] is None
      and b2['hasMore'] is False, f"got {b2['nextMarker']!r}/{b2['hasMore']!r}")

env3 = {'success': True, 'response': {'total': 5, 'data': PAGE2}}
b3 = fnorm.normalize_transactions(env3, limit=3, marker='934000000000000003')
check('short page under marker → hasMore false, no marker loop',
      b3['hasMore'] is False and b3['nextMarker'] is None)

# ── 6b. classification comes from the type code, not the fan's name ───────
print('\nexplicit tx_type:')
db.upsert_fan(CRM_ID, ACCT, '333000000000000003', username='tipsy',
              display_name='Tipsy Payout Messages')
fan_idx = db.fans_username_index(CRM_ID, ACCT)


def _typed(raw, **kw):
    """What fansly_sync stores: the normalizer's row + the exact type."""
    return fwallet.annotate_tx(
        fnorm._normalize_tx(raw, self_account_id=ACCT, **kw), raw)


sub_row = _row('934000000000000020', 15001, 4000, fan='333000000000000003')
check('the plain normalizer still keyword-misfiles this fan',
      db._classify_tx(fnorm._normalize_tx(sub_row, self_account_id=ACCT,
                                          fan_idx=fan_idx)) != 'subscription')
ns = _typed(sub_row, fan_idx=fan_idx)
check('description still names the fan', 'Tipsy Payout' in ns['description'],
      ns['description'])
check('explicit tx_type from code', ns.get('tx_type') == 'subscription', ns.get('tx_type'))
check("fan named 'Tipsy Payout' stays a subscription",
      db._classify_tx(ns) == 'subscription', db._classify_tx(ns))
nu2 = _typed(_row('1', 424242, 500, fan=FAN_B))
check('unknown code → no tx_type, keyword fallback → other',
      'tx_type' not in nu2 and db._classify_tx(nu2) == 'other',
      f"{nu2.get('tx_type')!r}/{db._classify_tx(nu2)!r}")
stream = _typed(_row('9', 32101, 4000, fan=FAN_B))
check('32101 (live-stream tips) → stream', stream.get('tx_type') == 'stream'
      and stream['description'].startswith('Payment for stream'), str(stream)[:200])
xfer = _row('10', 6002, 5000)
xfer.update({'destination': 1, 'destinationTax': 0, 'senderId': ACCT, 'receiverId': ACCT})
nx = _typed(xfer)
check('non-earnings-wallet row → transfer', nx.get('tx_type') == 'transfer'
      and 'transfer' in nx['description'], str(nx)[:200])
check('payout keeps payout despite destination 1',
      fwallet.fansly_tx_type(16012, 1) == 'payout')
check('OF row (no tx_type) still keyword-classified',
      db._classify_tx({'description': 'Tip from <a>x</a>'}) == 'tip')
check('undo beats an explicit type',
      db._classify_tx({'status': 'undo', 'tx_type': 'tip'}) == 'chargeback')
check('unknown explicit value falls back to keywords',
      db._classify_tx({'tx_type': 'bogus', 'description': 'Subscription by x'})
      == 'subscription')
check('transfer excluded from panel earnings', 'transfer' in db._NON_EARNING_TX_TYPES)

print('\nwallet figures:')
check('balance is withdrawable; pending sits on top',
      fwallet.wallet_figures(73.70, 447.92) == (521.62, 73.70, 447.92),
      str(fwallet.wallet_figures(73.70, 447.92)))
check('unknown pending → current = available, pending None',
      fwallet.wallet_figures(73.70, None) == (73.70, 73.70, None))
me_env = {'success': True, 'response': {'account': {'earningsWallet': {'balance': 73696}}}}
pend_env = {'success': True, 'response': {'pendingBalance': 447920}}
nb = fwallet.apply_pending(fnorm.normalize_balances(me_env), pend_env)['balances']
check('apply_pending: current/available/pending',
      (nb['currentBalance'], nb['payoutAvailable'], nb['pendingBalance'])
      == (521.62, 73.7, 447.92), str(nb))
nb0 = fwallet.apply_pending(fnorm.normalize_balances(me_env), None)['balances']
check('apply_pending without the pending call',
      nb0['currentBalance'] == nb0['payoutAvailable'] == 73.7
      and nb0['pendingBalance'] is None, str(nb0))
check('earnings_wallet_balance reads the raw integer',
      fwallet.earnings_wallet_balance(me_env) == 73.7)
check('pending_balance reads the raw integer',
      fwallet.pending_balance(pend_env) == 447.92 and fwallet.pending_balance(None) is None)

# ── 6c. one-off reclassification of already-stored rows ────────────────────
print('\nreclassify_fansly_tx_types:')
OF_ACCT = '555000000000000005'
db.add_of_account(crm_id=CRM_ID, of_user_id=OF_ACCT, email='o@test.com',
                  password=None, username='ofcreator')
db.upsert_subscriber(CRM_ID, ACCT, fnorm._normalize_subscription(
    {'subscriberId': '333000000000000003', 'createdAt': DAY0, 'endsAt': DAY1 + 86400000,
     'status': 3, 'price': 5000}))
import json as _json  # noqa: E402


def _raw_insert(acct, tx_id, tx_type, raw_json, net=4.0, fan=None):
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        conn.execute(
            'INSERT INTO transactions_cache (crm_id, of_user_id, tx_id, fan_of_user_id, '
            'created_at, net, amount, tx_type, raw_json, synced_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?)',
            (CRM_ID, acct, tx_id, fan, '2026-07-10T00:00:00+00:00', net, net * 1.25,
             tx_type, raw_json, '2026-07-10T00:00:00+00:00'))
        conn.commit()
    finally:
        conn.close()


# the live misfile: a subscription stored as 'tip' because of the fan's name
_raw_insert(ACCT, 'stale-sub', 'tip',
            _json.dumps({'raw': {'type': 15001, 'destination': 2}}),
            fan='333000000000000003')
# the live self-transfer pair stored as income
_raw_insert(ACCT, 'stale-xfer', 'other',
            _json.dumps({'raw': {'type': 58000, 'destination': 1}}))
_raw_insert(ACCT, 'no-raw', 'other', None)
_raw_insert(ACCT, 'bad-raw', 'other', '{not json')
_raw_insert(ACCT, 'unknown-code', 'other',
            _json.dumps({'raw': {'type': 424242, 'destination': 2}}))
# an OF row that happens to carry a look-alike shape must never be touched
_raw_insert(OF_ACCT, 'of-lookalike', 'tip',
            _json.dumps({'raw': {'type': 15001, 'destination': 2}}))

changed = db.reclassify_fansly_tx_types(fwallet.TX_TYPE_BY_CODE,
                                        fwallet.EARNINGS_WALLET_DESTINATION)
check('exactly the two stale fansly rows changed', changed == 2, f'changed={changed}')
flat, _ = db.list_transactions_cache(CRM_ID, ACCT, limit=500)
by_id = {r['tx_id']: r['tx_type'] for r in flat}
check('misfiled subscription fixed', by_id.get('stale-sub') == 'subscription',
      by_id.get('stale-sub'))
check('self-transfer relabelled', by_id.get('stale-xfer') == 'transfer',
      by_id.get('stale-xfer'))
check('rows without usable raw_json untouched',
      by_id.get('no-raw') == 'other' and by_id.get('bad-raw') == 'other'
      and by_id.get('unknown-code') == 'other', str(by_id))
of_rows, _ = db.list_transactions_cache(CRM_ID, OF_ACCT, limit=10)
check('OF rows untouched', of_rows and of_rows[0]['tx_type'] == 'tip',
      str(of_rows and of_rows[0]['tx_type']))
check('second run is a no-op',
      db.reclassify_fansly_tx_types(fwallet.TX_TYPE_BY_CODE, 2) == 0)
conn = db.sqlite3.connect(db.DB_FILE)
spent = conn.execute(
    "SELECT spent_subscriptions, spent_tips FROM subscribers_cache "
    "WHERE of_user_id = ? AND fan_of_user_id = '333000000000000003'", (ACCT,)).fetchone()
conn.close()
check('per-fan spend recomputed from the corrected type',
      spent is not None and abs((spent[0] or 0) - 5.0) < 0.01 and (spent[1] or 0) == 0,
      str(spent))

# ── 7. capability matrix ───────────────────────────────────────────────────
print('\nplatform_features:')
caps_f = pf.capabilities('fansly')
caps_of = pf.capabilities('onlyfans')
for k in ('transactions_refresh', 'backfill', 'ppv_stats', 'send_attachments'):
    check(f"'{k}' present on both platforms", k in caps_f and k in caps_of)
check('fansly transactions_refresh true', caps_f['transactions_refresh'] is True)
check('fansly backfill true', caps_f['backfill'] is True)
check('fansly ppv_stats false', caps_f['ppv_stats'] is False)
check('send_attachments false on BOTH', caps_f['send_attachments'] is False
      and caps_of['send_attachments'] is False)
check('fansly websocket reflects FANSLY_WS_ENABLED',
      caps_f['websocket'] == bool(config.FANSLY_WS_ENABLED))
check('fansly polling reflects FANSLY_POLLING_ENABLED',
      caps_f['polling'] == bool(config.FANSLY_POLLING_ENABLED))
_saved_ws = config.FANSLY_WS_ENABLED
config.FANSLY_WS_ENABLED = True
check('flipping the WS flag flips the capability',
      pf.capabilities('fansly')['websocket'] is True)
config.FANSLY_WS_ENABLED = _saved_ws
check('OF capabilities untouched by flags',
      caps_of['websocket'] is True and caps_of['polling'] is True)

print()
if _failures:
    print(f'FAILED: {len(_failures)} check(s): {_failures}')
    sys.exit(1)
print('ALL PASS')
