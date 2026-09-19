#!/usr/bin/env python3
"""HTTP-level tests (Flask test_client) for the Fansly campaigns /
subscription-price / payouts seams.

All Fansly API traffic is mocked with shapes copied from the live probe
(trackinglinks / account/me subscriptionTiers / payments/payoutmethods) —
zero network, throwaway DB.

Covers:
  - GET /campaigns → 200 OF-shaped rows from /api/v1/trackinglinks
    (cents→dollars, clicks/subscriptions mapping, local tag merge, hasMore
    False) — POST stays 501 keyed on campaigns_create
  - claimers → 501 (campaign_claimers), refresh → honest no-op 200,
    refresh/status → 200 with live flag, /campaigns/earnings → live
    CampaignEarnings rows (coverage 100)
  - GET /subscription-price → base 30-day plan of the first tier in dollars +
    full tiers list; PATCH → 501 keyed on subscription_price_update
  - GET /payout-account → payout methods + wallet balance, can_withdraw False
    with NO blockers; GET /payout-requests → history from the synced ledger
    (tx_type='payout'); POST /payout-requests → 501 keyed on payouts_request
  - capability matrix flips surfaced on the account payload

    venv/bin/python tests/test_fansly_campaigns_payouts.py
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
import crm_api                     # noqa: E402
import scheduler as scheduler_mod  # noqa: E402

scheduler_mod.schedule_account = lambda *a, **k: None
scheduler_mod.unschedule_account = lambda *a, **k: None

_failures = []


def check(name, cond, detail=''):
    status = 'PASS' if cond else 'FAIL'
    print(f'  [{status}] {name}' + (f'  ({detail})' if detail and not cond else ''))
    if not cond:
        _failures.append(name)


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Fansly Campaigns/Payouts Test Panel')
CRM_ID = panel['crm_id']
KEY = panel['api_key']
ACCT = '847000000000000002'

db.add_of_account(crm_id=CRM_ID, of_user_id=ACCT, email='f2@test.com',
                  password=None, username='fanslycreator2', platform='fansly')

client = crm_api.app.test_client()
H = {'X-API-Key': KEY, 'User-Agent': 'Mozilla/5.0 test'}

# Shapes copied from the live probe dumps (scratchpad trackinglinks.json /
# me_full.json / payoutmethods) — cents everywhere.
TRACKINGLINKS = [
    {'id': '911672768062304256', 'accountId': ACCT, 'internalId': '1000',
     'type': 1000, 'status': 1, 'label': 'Test fansly traffic',
     'description': 'testing traffic launch batch 1', 'metadata': '{}',
     'createdAt': 1778854086000, 'clicks': 2319, 'claims': 2091,
     'follows': 294, 'subscriptions': 38, 'totalNet': 0, 'totalGross': 17982100},
    {'id': '920503407901429761', 'accountId': ACCT, 'internalId': '1',
     'type': 1, 'status': 1, 'label': 'Fansly FYP',
     'description': 'FYP attribution', 'metadata': '{}',
     'createdAt': 1780959474000, 'clicks': 0, 'claims': 1550,
     'follows': 264, 'subscriptions': 30, 'totalNet': 0, 'totalGross': 18659700},
]

ME = {'account': {
    'id': ACCT, 'username': 'fanslycreator2', 'displayName': 'Fansly Creator',
    'earningsWallet': {'balance': 609360, 'balance64': 609360},
    'subscriptionTiers': [
        {'id': 't1', 'accountId': ACCT, 'name': 'tier one', 'color': '#FF69B4',
         'pos': 0, 'price': 50000, 'plans': [
             {'id': 'p30', 'status': 1, 'billingCycle': 30, 'price': 50000},
             {'id': 'p60', 'status': 1, 'billingCycle': 60, 'price': 80000},
         ]},
        {'id': 't2', 'accountId': ACCT, 'name': 'tier two', 'color': '#F73838',
         'pos': 0, 'price': 50000, 'plans': [
             {'id': 'q30', 'status': 1, 'billingCycle': 30, 'price': 150000},
         ]},
    ],
}}

PAYOUT_METHODS = [{'accountId': ACCT, 'flags': 0, 'id': 'pm1', 'metadata': '{}',
                   'providerId': '3', 'status': 1, 'type': 2, 'version': 1}]


def _fake_handle(crm_id, account_id, path, method='GET', body=None, proxy=None):
    assert method == 'GET', f'non-GET to Fansly from test flow: {method} {path}'
    if path.startswith('/api/v1/trackinglinks'):
        return True, {'success': True, 'response': TRACKINGLINKS}, 200, False
    if path.startswith('/api/v1/account/me'):
        return True, {'success': True, 'response': ME}, 200, False
    if path.startswith('/api/v1/payments/payoutmethods'):
        return True, {'success': True, 'response': PAYOUT_METHODS}, 200, False
    return True, {'success': True, 'response': {}}, 200, False


_orig = fansly_client.handle_fansly_request
fansly_client.handle_fansly_request = _fake_handle

# Seed one payout ledger row the way fansly_sync would (16012 → 'payout').
PAYOUT_TX = {'transactionId': '934000000000000099', 'type': 16012,
             'amount': 450000, 'destinationAmount': 450000, 'destinationTax': 0,
             'correlationAccountId': None, 'senderId': ACCT, 'receiverId': None,
             'destination': 1, 'status': 2, 'createdAt': 1784219134000}
db.upsert_transaction(CRM_ID, ACCT, fnorm._normalize_tx(PAYOUT_TX, self_account_id=ACCT))
# ...and one tip row that must NOT leak into payout history.
TIP_TX = {'transactionId': '934000000000000100', 'type': 7101,
          'amount': 8000, 'destinationAmount': 8000, 'destinationTax': 2000,
          'correlationAccountId': '111', 'senderId': None, 'receiverId': ACCT,
          'destination': 2, 'status': 2, 'createdAt': 1784219135000}
db.upsert_transaction(CRM_ID, ACCT, fnorm._normalize_tx(TIP_TX, self_account_id=ACCT))

try:
    # ── 1. campaigns GET ────────────────────────────────────────────────────
    print('\nGET /campaigns:')
    db.add_campaign_tag(CRM_ID, ACCT, '911672768062304256', 'paid-traffic')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/campaigns', headers=H)
    b = r.get_json() or {}
    rows = b.get('campaigns') or []
    check('200 with 2 rows', r.status_code == 200 and len(rows) == 2,
          f'{r.status_code} {b}')
    row = next((c for c in rows if c.get('id') == '911672768062304256'), {})
    check('clicks → countTransitions', row.get('countTransitions') == 2319, str(row))
    check('subscriptions → countSubscribers', row.get('countSubscribers') == 38)
    check('totalGross cents → dollars', row.get('grossEarnings') == 17982.10,
          str(row.get('grossEarnings')))
    check('type 1000 → link / 1 → claim',
          row.get('linkType') == 'link' and
          next((c for c in rows if c.get('id') == '920503407901429761'), {}).get('linkType') == 'claim')
    check('label → campaignName + ISO createdAt',
          row.get('campaignName') == 'Test fansly traffic'
          and str(row.get('createdAt', '')).startswith('2026-'), str(row.get('createdAt')))
    check('no shareable code fabricated', row.get('campaignCode') is None)
    check('local tags merged', row.get('tags') == ['paid-traffic'], str(row.get('tags')))
    check('hasMore False (unpaginated)', b.get('hasMore') is False)

    # ── 2. campaigns POST + claimers stay 501 ──────────────────────────────
    print('\ncampaigns writes/claimers:')
    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/campaigns', headers=H,
                    json={'name': 'nope'})
    b = r.get_json() or {}
    check('POST /campaigns → 501 campaigns_create',
          r.status_code == 501 and b.get('code') == 'platform_not_supported'
          and b.get('feature') == 'campaigns_create', f'{r.status_code} {b}')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/campaigns/123/claimers', headers=H)
    b = r.get_json() or {}
    check('claimers → 501 campaign_claimers',
          r.status_code == 501 and b.get('feature') == 'campaign_claimers',
          f'{r.status_code} {b}')

    # ── 3. refresh no-op + status + live earnings ──────────────────────────
    print('\nrefresh/status/earnings:')
    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/campaigns/refresh', headers=H)
    b = r.get_json() or {}
    check('refresh → 200 not_needed no-op',
          r.status_code == 200 and b.get('success') and b.get('not_needed'),
          f'{r.status_code} {b}')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/campaigns/refresh/status', headers=H)
    b = r.get_json() or {}
    check('status → 200 live', r.status_code == 200 and b.get('live') is True,
          f'{r.status_code} {b}')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/campaigns/earnings', headers=H)
    b = r.get_json() or {}
    earn = {e['campaign_id']: e for e in (b.get('earnings') or [])}
    e1 = earn.get('911672768062304256') or {}
    check('earnings → live rows, dollars, coverage 100',
          r.status_code == 200 and e1.get('total_spent') == 17982.10
          and e1.get('claimers_count') == 38 and e1.get('coverage_pct') == 100,
          f'{r.status_code} {b}')
    check('earnings cache meta present with no stale hint',
          (b.get('cache') or {}).get('campaigns') == 2
          and (b.get('cache') or {}).get('last_refreshed_at') is None,
          str(b.get('cache')))

    # ── 4. subscription price ──────────────────────────────────────────────
    print('\nsubscription-price:')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscription-price', headers=H)
    b = r.get_json() or {}
    check('GET → 200 base 30d plan of first tier in dollars',
          r.status_code == 200 and b.get('subscribePrice') == 50.0
          and b.get('isFree') is False, f'{r.status_code} {b}')
    tiers = b.get('tiers') or []
    check('full tiers list with plan dollars',
          len(tiers) == 2 and tiers[0]['plans'][0]['price'] == 50.0
          and tiers[1]['plans'][0]['price'] == 150.0, str(tiers))
    r = client.patch(f'/api/crm/{CRM_ID}/accounts/{ACCT}/subscription-price',
                     headers=H, json={'subscribePrice': 5})
    b = r.get_json() or {}
    check('PATCH → 501 subscription_price_update',
          r.status_code == 501 and b.get('feature') == 'subscription_price_update',
          f'{r.status_code} {b}')

    # ── 5. payouts ─────────────────────────────────────────────────────────
    print('\npayouts:')
    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/payout-account', headers=H)
    b = r.get_json() or {}
    check('payout-account → 200 wallet balance in dollars',
          r.status_code == 200
          and (b.get('balances') or {}).get('payoutAvailable') == 609.36,
          f'{r.status_code} {b}')
    check('payout methods listed',
          (b.get('account') or {}).get('hasPayoutMethod') is True
          and (b.get('account') or {}).get('payoutMethods')[0].get('id') == 'pm1',
          str(b.get('account')))
    check('can_withdraw False with NO blockers (no OF banking warnings)',
          b.get('can_withdraw') is False and b.get('blockers') == [], str(b))

    r = client.get(f'/api/crm/{CRM_ID}/accounts/{ACCT}/payout-requests', headers=H)
    b = r.get_json() or {}
    reqs = b.get('requests') or []
    check('payout-requests GET → ledger payout row only',
          r.status_code == 200 and len(reqs) == 1
          and reqs[0].get('id') == '934000000000000099', f'{r.status_code} {b}')
    check('history row shape: dollars + completed + ISO date',
          reqs[0].get('amount') == 450.0 and reqs[0].get('amountPaid') == 450.0
          and reqs[0].get('status') == 'completed'
          and str(reqs[0].get('createdAt', '')).startswith('2026-'), str(reqs))

    r = client.post(f'/api/crm/{CRM_ID}/accounts/{ACCT}/payout-requests',
                    headers=H, json={'withdrawal_amount': 10})
    b = r.get_json() or {}
    check('payout-requests POST → 501 payouts_request',
          r.status_code == 501 and b.get('feature') == 'payouts_request',
          f'{r.status_code} {b}')

    # ── 6. capability flips on the account payload ─────────────────────────
    print('\ncapabilities:')
    accounts = (client.get(f'/api/crm/{CRM_ID}/accounts', headers=H).get_json()
                or {}).get('accounts') or []
    caps = next((a.get('capabilities') for a in accounts
                 if str(a.get('of_user_id')) == ACCT), {}) or {}
    check('read caps true / write caps false',
          caps.get('campaigns') is True and caps.get('campaigns_create') is False
          and caps.get('payouts') is True and caps.get('payouts_request') is False
          and caps.get('subscription_price') is True
          and caps.get('subscription_price_update') is False, str(caps))
finally:
    fansly_client.handle_fansly_request = _orig

print()
if _failures:
    print(f'FAILED: {len(_failures)} check(s): {_failures}')
    sys.exit(1)
print('ALL PASS')
