#!/usr/bin/env python3
"""Fansly subscriber enumeration — live route + cached pipeline + capability.

All Fansly API traffic is mocked — zero network, throwaway DB.

Covers:
  - capability matrix: 'subscribers' now True for fansly (both platforms)
  - GET /accounts/<id>/subscribers (live): one roster page + one batched
    /account?ids= hydration call, OF row shape, cents→dollars, status map
    (3→active, 5→expired, other→unknown), nextOffset/hasMore/total semantics,
    client-side type filter
  - hydration failure tolerated (page still 200, identity None)
  - subscribers_sync fansly dispatch: full walk pages into subscribers_cache,
    hydrated identities land in `fans`, spend backfilled from the wallet
    ledger (transactions_cache via correlationAccountId), NULL spend for
    unattributable fans
  - /subscribers/cached, /refresh/status, /new, /stats serve the fansly rows
  - OF matrix untouched

    venv/bin/python tests/test_fansly_subscribers.py
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

import crm_database as db            # noqa: E402
import fansly_client                 # noqa: E402
import fansly_normalize as fnorm     # noqa: E402
import crm_api                       # noqa: E402
import platform_features as pf       # noqa: E402
import subscribers_sync              # noqa: E402

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Fansly Subs Test Panel')
CRM_ID = panel['crm_id']
KEY = panel['api_key']
ACCT = '847000000000000002'

db.add_of_account(crm_id=CRM_ID, of_user_id=ACCT, email='f@test.com',
                  password=None, username='fanslycreator', platform='fansly')

client = crm_api.app.test_client()
H = {'X-API-Key': KEY, 'User-Agent': 'Mozilla/5.0 test'}

NOW_MS = int(time.time() * 1000)
DAY_MS = 86400000


def _sub(sid, status, created_off_days, ends_off_days, price=50000):
    return {
        'id': f'93400000000000{sid[-4:]}', 'subscriberId': sid,
        'subscriptionTierId': '918567612684722176',
        'subscriptionTierName': 'tier one', 'subscriptionTierColor': '#FF69B4',
        'planId': '918567612785389569', 'status': status,
        'price': price, 'renewPrice': price, 'autoRenew': 1,
        'billingCycle': 30, 'duration': 30,
        'renewDate': NOW_MS + ends_off_days * DAY_MS,
        'createdAt': NOW_MS - created_off_days * DAY_MS,
        'updatedAt': NOW_MS - created_off_days * DAY_MS,
        'endsAt': NOW_MS + ends_off_days * DAY_MS,
    }


# 5-row roster: 3 active, 1 expired, 1 unknown status code.
ROSTER = [
    _sub('401000000000000001', 3, 10, 20),
    _sub('401000000000000002', 3, 8, 22, price=150000),
    _sub('401000000000000003', 3, 6, 24),
    _sub('401000000000000004', 5, 90, -30),          # lapsed
    _sub('401000000000000005', 9, 5, 25),            # unobserved status code
]
STATS = {'totalActive': 3, 'totalExpired': 1, 'total': len(ROSTER)}

# Hydration: one fan with an avatar media OBJECT, one with username only,
# id ...003 deliberately MISSING from the response (unresolvable identity).
ACCOUNTS = {
    '401000000000000001': {
        'id': '401000000000000001', 'username': 'whale_fan',
        'displayName': 'Whale Fan',
        'avatar': {'id': 'm1', 'location': '/rel/path.jpg', 'variants': [
            {'locations': [{'location': 'https://cdn.fansly.com/signed.jpg?Signature=abc'}]}]},
    },
    '401000000000000002': {'id': '401000000000000002', 'username': 'kyle012'},
    '401000000000000004': {'id': '401000000000000004', 'username': 'lapsed_fan',
                           'displayName': 'Lapsed'},
    '401000000000000005': {'id': '401000000000000005', 'username': 'mystery'},
}

FAIL_HYDRATION = {'on': False}
CALLS = []


def _fake_handle(crm_id, account_id, path, method='GET', body=None, proxy=None):
    CALLS.append(path)
    assert method == 'GET', f'non-GET to fansly in subscribers flow: {method} {path}'
    if path.startswith('/api/v1/subscribers'):
        q = path.split('?', 1)[1] if '?' in path else ''
        params = dict(kv.split('=') for kv in q.split('&') if '=' in kv)
        limit = int(params.get('limit', 25))
        offset = int(params.get('offset', 0))
        page = ROSTER[offset:offset + limit]
        return True, {'success': True, 'response': {
            'stats': dict(STATS), 'subscriptions': page}}, 200, False
    if path.startswith('/api/v1/account?') or path.startswith('/api/v1/account%3F'):
        if FAIL_HYDRATION['on']:
            return False, {'error': 'boom'}, 500, False
        ids = path.split('ids=', 1)[1].split('&')[0]
        out = [ACCOUNTS[i] for i in ids.replace('%2C', ',').split(',')
               if i in ACCOUNTS]
        return True, {'success': True, 'response': out}, 200, False
    return True, {'success': True, 'response': {}}, 200, False


_orig = fansly_client.handle_fansly_request
fansly_client.handle_fansly_request = _fake_handle

try:
    # ── 0. capability flip ──────────────────────────────────────────────────
    print('\ncapabilities:')
    check("fansly 'subscribers' capability is True",
          pf.capabilities('fansly')['subscribers'] is True)
    check("OF 'subscribers' capability still True",
          pf.capabilities('onlyfans')['subscribers'] is True)

    # ── 1. live route ───────────────────────────────────────────────────────
    print('\nGET /subscribers (live):')
    CALLS.clear()
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers?limit=3&offset=0',
                   headers=H)
    b = r.get_json()
    check('200 (no more 501)', r.status_code == 200 and b.get('success'),
          f'{r.status_code} {b}')
    check('exactly 1 roster + 1 hydration call',
          len([c for c in CALLS if c.startswith('/api/v1/subscribers')]) == 1
          and len([c for c in CALLS if c.startswith('/api/v1/account')]) == 1,
          str(CALLS))
    rows = b.get('list') or []
    check('page has 3 rows', len(rows) == 3, str(len(rows)))
    r0 = rows[0]
    check('identity hydrated', r0.get('username') == 'whale_fan'
          and r0.get('name') == 'Whale Fan', str(r0)[:200])
    check('avatar resolved from media object (signed URL)',
          (r0.get('avatar') or '').startswith('https://cdn.fansly.com/'),
          str(r0.get('avatar')))
    check('price cents→dollars', r0.get('subscribePrice') == 50.0
          and r0['subscribedOnData']['subscribePrice'] == 50.0, str(r0)[:200])
    check('status 3 → active', r0.get('status') == 'active')
    check('lifecycle timestamps ISO',
          str(r0['subscribedOnData'].get('subscribeAt', '')).startswith('20'),
          str(r0['subscribedOnData']))
    check('total from stats', b.get('total') == 5, str(b.get('total')))
    check('nextOffset advances by raw rows', b.get('nextOffset') == 3)
    check('hasMore true mid-roster', b.get('hasMore') is True)

    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers?limit=3&offset=3',
                   headers=H)
    b = r.get_json()
    check('page 2: hasMore false at end', b.get('hasMore') is False
          and b.get('nextOffset') == 5, str(b)[:200])
    statuses = {x['id']: x['status'] for x in b['list']}
    check('status 5 → expired', statuses.get('401000000000000004') == 'expired',
          str(statuses))
    check('unknown status code → unknown',
          statuses.get('401000000000000005') == 'unknown', str(statuses))

    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers'
                   f'?limit=5&offset=0&type=expired', headers=H)
    b = r.get_json()
    check('type=expired filters client-side',
          len(b['list']) == 1 and b['list'][0]['id'] == '401000000000000004',
          str(b)[:200])
    check('filtered page still advances by raw consumed',
          b.get('nextOffset') == 5, str(b.get('nextOffset')))
    check('bad type still 400',
          client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers?type=bogus',
                     headers=H).status_code == 400)

    # hydration failure → page still serves (ids-only)
    FAIL_HYDRATION['on'] = True
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers?limit=2&offset=0',
                   headers=H)
    b = r.get_json()
    check('hydration failure tolerated (200, identity None)',
          r.status_code == 200 and b['list'][0].get('username') is None,
          f'{r.status_code} {str(b)[:200]}')
    FAIL_HYDRATION['on'] = False

    # ── 2. cached pipeline (sync → cache → routes) ─────────────────────────
    print('\nfansly subscribers sync:')
    # Seed the wallet ledger so the spend backfill has rows to attribute:
    # 2 tips + 1 subscription for fan ...001, one message for ...002.
    for i, (fan, amt, typ) in enumerate([
            ('401000000000000001', 8000, 7101), ('401000000000000001', 16000, 7101),
            ('401000000000000001', 40000, 15001), ('401000000000000002', 24000, 2116)]):
        raw = {'transactionId': str(934000000000000100 + i), 'type': typ,
               'amount': amt, 'destinationAmount': amt, 'destinationTax': 2000,
               'correlationAccountId': fan, 'senderId': None, 'receiverId': ACCT,
               'destination': 2, 'status': 2, 'createdAt': NOW_MS - i * 1000}
        db.upsert_transaction(CRM_ID, ACCT, fnorm._normalize_tx(
            raw, self_account_id=ACCT))

    progress = []
    res = subscribers_sync.full_sync_subscribers(
        CRM_ID, ACCT, on_progress=lambda **kw: progress.append(kw))
    check('full sync success', res.get('success') is True, str(res))
    check('5 rows inserted', res.get('rows_inserted') == 5, str(res))
    check('progress callbacks fired', len(progress) >= 2, str(progress))
    res2 = subscribers_sync.delta_sync_subscribers(CRM_ID, ACCT)
    check('delta re-run counts updates not inserts',
          res2.get('success') and res2.get('rows_updated') == 5
          and res2.get('rows_inserted') == 0, str(res2))

    summary = db.subscribers_cache_summary(CRM_ID, ACCT)
    check('cache summary totals', summary['total'] == 5 and summary['active'] == 4
          and summary['expired'] == 1, str(summary))
    check('refresh timestamp recorded', bool(summary.get('last_refreshed_at')),
          str(summary))

    # fans table got the hydrated identities
    fan_idx = db.fans_username_index(CRM_ID, ACCT) or {}
    check('hydrated identities upserted into fans',
          (fan_idx.get('401000000000000001') or {}).get('username') == 'whale_fan'
          and (fan_idx.get('401000000000000002') or {}).get('username') == 'kyle012',
          str(fan_idx))

    # spend backfilled from the ledger (gross dollars: 800c net @20% → $10 gross)
    rows_c, _t = db.list_cached_subscribers(CRM_ID, ACCT, sort='total_spent')
    by_fan = {r['fan_of_user_id']: r for r in rows_c}
    check('spend backfilled from wallet ledger (gross $)',
          abs((by_fan['401000000000000001']['total_spent'] or 0) - 80.0) < 0.01
          and abs((by_fan['401000000000000001']['spent_tips'] or 0) - 30.0) < 0.01
          and abs((by_fan['401000000000000001']['spent_subscriptions'] or 0) - 50.0) < 0.01,
          str({k: (v['total_spent'], v['spent_tips'], v['spent_subscriptions'])
               for k, v in by_fan.items()}))
    check('unattributable fan keeps NULL spend (unknown, not $0)',
          by_fan['401000000000000003']['total_spent'] is None,
          str(by_fan['401000000000000003']['total_spent']))

    print('\ncached routes:')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers/cached'
                   f'?sort=total_spent', headers=H)
    b = r.get_json()
    check('/cached 200 with 5 rows', r.status_code == 200 and b.get('total') == 5,
          f'{r.status_code} {str(b)[:200]}')
    top = (b.get('list') or [{}])[0]
    check('/cached merges flat spend under raw payload',
          top.get('total_spent') == 80.0 and top.get('username') == 'whale_fan',
          str(top)[:300])
    check('/cached rows carry is_active', top.get('is_active') == 1, str(top)[:200])
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers/cached'
                   f'?type=expired', headers=H)
    b = r.get_json()
    check('/cached type=expired → 1 row', b.get('total') == 1, str(b)[:200])

    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers/refresh/status',
                   headers=H)
    b = r.get_json()
    check('/refresh/status 200 for fansly',
          r.status_code == 200 and (b.get('cache') or {}).get('total') == 5,
          f'{r.status_code} {str(b)[:200]}')

    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers/new', headers=H)
    b = r.get_json()
    check('/new serves fansly rows', b.get('total') == 5
          and b['subscribers'][0].get('subscribed_at'), str(b)[:200])
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscribers/stats', headers=H)
    b = r.get_json()
    check('/stats buckets fansly rows', b.get('total_in_window') == 5, str(b)[:200])

    # ── 3. duplicate fan in one walk: the newest subscription wins ─────────
    print('\nroster dedupe + panel new subs:')
    fan1_before = db.get_cached_subscriber_subscribe_at(CRM_ID, ACCT, '401000000000000001')
    # An old lapsed subscription for the SAME fan, listed after the current one.
    ROSTER.append(_sub('401000000000000001', 5, 400, -370))
    STATS['total'] = len(ROSTER)
    try:
        res = subscribers_sync.full_sync_subscribers(CRM_ID, ACCT)
    finally:
        ROSTER.pop()
        STATS['total'] = len(ROSTER)
    check('walk with a duplicate fan succeeds', res.get('success') is True, str(res))
    fan1_after = db.get_cached_subscriber_subscribe_at(CRM_ID, ACCT, '401000000000000001')
    check('older duplicate did not drag subscribed_at backwards',
          fan1_after == fan1_before, f'{fan1_before} -> {fan1_after}')
    rows_c, _t = db.list_cached_subscribers(CRM_ID, ACCT, sort='total_spent')
    fan1 = next(r for r in rows_c if r['fan_of_user_id'] == '401000000000000001')
    check('…nor flipped the live fan to expired', fan1.get('is_active') == 1, str(fan1)[:200])

    from datetime import datetime as _dt, timedelta as _td
    _now = _dt.utcnow()
    _f = '%Y-%m-%d %H:%M:%S'
    ns = db.panel_new_subscribers(
        CRM_ID, (_now - _td(days=30)).strftime(_f), _now.strftime(_f),
        (_now - _td(days=60)).strftime(_f), (_now - _td(days=30)).strftime(_f))
    check('fansly rows count as new subs in the window (lapsed one excluded)',
          ns['count'] == 4 and ns['by_platform']['fansly']['count'] == 4, str(ns))
    # The seeded 15001 ledger payment for fan ...001 lands today, 10 days after
    # that subscription started → a renewal, counted from the ledger.
    check('fansly renewal counted from the subscription ledger',
          ns['renewals'] == 1 and ns['by_platform']['fansly']['renewals'] == 1, str(ns))
    check('coverage: the synced fansly account is tracked',
          ns['accounts'] == 1 and ns['accounts_tracked'] == 1, str(ns))
finally:
    fansly_client.handle_fansly_request = _orig

print()
if _failures:
    print(f'FAILED: {len(_failures)} check(s): {_failures}')
    sys.exit(1)
print('ALL PASS')
