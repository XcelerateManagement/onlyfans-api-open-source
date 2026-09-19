#!/usr/bin/env python3
"""Scenario suite for the referrals routes.

HTTP-level via the Flask test_client, with `handle_of_request` replaced by a
programmable stub — zero network, throwaway DB.

Covers the three routes added over OF's referral endpoints:

    GET /accounts/<id>/referrals                  → /api2/v2/users/me/referrals
    GET /accounts/<id>/referrals/earnings         → /api2/v2/payments/referrals/balance
                                                  + /api2/v2/payouts/referrals/chart
    GET /accounts/<id>/referrals/payout-requests  → /api2/v2/payouts/requests/referral

...plus the cross-cutting guards: another tenant's account is a 403, a Fansly
account is a 501 from the capability matrix, and an upstream failure surfaces
the upstream status instead of a 500 or a misleading empty list.

IMPORTANT: the upstream bodies used here are the shapes recorded in the
reverse-engineering capture ({list, hasMore} / {list, marker}). The ITEM shape
inside those lists was never captured, so no scenario asserts anything about
item fields — the routes pass rows through untouched and these tests encode
exactly that.

Run:

    cd onlyfans-api && venv/bin/python tests/test_referrals.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import traceback

os.environ['WERKZEUG_RUN_MAIN'] = 'false'
os.environ.setdefault('DATABASE_PATH', tempfile.mktemp(suffix='.db'))
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import crm_api                     # noqa: E402
import platform_features as pf     # noqa: E402
import scheduler as scheduler_mod  # noqa: E402

scheduler_mod.schedule_account = lambda *a, **k: None
scheduler_mod.unschedule_account = lambda *a, **k: None
scheduler_mod.start_ws_listener = lambda *a, **k: None
scheduler_mod.start_fansly_ws_listener = lambda *a, **k: None


# ── Fixtures ───────────────────────────────────────────────────────────────
panel = db.create_crm_panel('Referrals Test Panel')
CRM_ID, KEY = panel['crm_id'], panel['api_key']
OTHER = db.create_crm_panel('Other Tenant Panel')
OTHER_CRM_ID, OTHER_KEY = OTHER['crm_id'], OTHER['api_key']

OF_ACCT = '482000777'
FANSLY_ACCT = '847000000000000777'
OTHER_ACCT = '482000888'

db.add_of_account(crm_id=CRM_ID, of_user_id=OF_ACCT, email='of@test.com',
                  password=None, username='ofcreator')
db.add_of_account(crm_id=CRM_ID, of_user_id=FANSLY_ACCT, email='f@test.com',
                  password=None, username='fanslycreator', platform='fansly')
db.add_of_account(crm_id=OTHER_CRM_ID, of_user_id=OTHER_ACCT, email='x@test.com',
                  password=None, username='someoneelse')

client = crm_api.app.test_client()
H = {'X-API-Key': KEY, 'User-Agent': 'Mozilla/5.0 test'}
BASE = f'/api/crm/{CRM_ID}/accounts/{OF_ACCT}'

# Envelope bodies exactly as the capture recorded them. Item contents are
# deliberately opaque blobs — nothing in the routes may depend on their fields.
REFERRAL_ROWS = [{'opaque': 1}, {'opaque': 2}]
PAYOUT_ROWS = [{'opaque': 'a'}]

# Programmable upstream. `_responses` maps an OF path PREFIX to
# (success, body, status, relogin); `_calls` records every path requested so
# scenarios can assert on querystring forwarding.
_responses: dict = {}
_calls: list = []


def _fake_handle(crm_id, of_user_id, path, method='GET', body=None, proxy=None):
    _calls.append(path)
    for prefix, resp in _responses.items():
        if path.startswith(prefix):
            return resp
    return True, {}, 200, False


crm_api.handle_of_request = _fake_handle


def _ok_upstream():
    """Reset the stub to the all-healthy baseline."""
    _responses.clear()
    _calls.clear()
    _responses['/api2/v2/users/me/referrals'] = (
        True, {'list': REFERRAL_ROWS, 'hasMore': True}, 200, False)
    _responses['/api2/v2/payouts/requests/referral'] = (
        True, {'list': PAYOUT_ROWS, 'marker': 991}, 200, False)
    _responses['/api2/v2/payments/referrals/balance'] = (
        True, {'balance': 12.5}, 200, False)
    _responses['/api2/v2/payouts/referrals/chart'] = (
        True, [{'date': '2026-07-01', 'amount': 3.0}], 200, False)


_failures: list = []


def scenario(fn):
    def run():
        _ok_upstream()
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
        except AssertionError as e:
            _failures.append((fn.__name__, str(e)))
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception:
            _failures.append((fn.__name__, traceback.format_exc()))
            print(f"  ✗ {fn.__name__} raised:\n{traceback.format_exc()}")
    return run


def _path_for(prefix):
    """The single recorded upstream call starting with `prefix`."""
    hits = [p for p in _calls if p.startswith(prefix)]
    assert len(hits) == 1, f'expected 1 call to {prefix}, got {hits}'
    return hits[0]


# ── Happy paths ────────────────────────────────────────────────────────────

@scenario
def s01_list_referrals_happy_path():
    r = client.get(f'{BASE}/referrals', headers=H)
    assert r.status_code == 200, r.status_code
    b = r.get_json()
    assert b['success'] is True
    assert b['referrals'] == REFERRAL_ROWS, b['referrals']
    assert b['count'] == 2
    assert b['hasMore'] is True
    # The raw upstream body is echoed so a wrong envelope assumption is
    # recoverable by the client.
    assert b['data'] == {'list': REFERRAL_ROWS, 'hasMore': True}
    assert _path_for('/api2/v2/users/me/referrals') == '/api2/v2/users/me/referrals'


@scenario
def s02_referral_payout_requests_happy_path():
    r = client.get(f'{BASE}/referrals/payout-requests', headers=H)
    assert r.status_code == 200, r.status_code
    b = r.get_json()
    assert b['success'] is True
    assert b['requests'] == PAYOUT_ROWS, b['requests']
    assert b['count'] == 1
    assert b['marker'] == 991, b['marker']
    assert b['data'] == {'list': PAYOUT_ROWS, 'marker': 991}


@scenario
def s03_referral_earnings_composites_both_sources():
    r = client.get(f'{BASE}/referrals/earnings', headers=H)
    assert r.status_code == 200, r.status_code
    b = r.get_json()
    assert b['success'] is True
    # Bodies are passed through VERBATIM — no field mapping, because neither
    # upstream shape is confirmed.
    assert b['balance'] == {'balance': 12.5}, b['balance']
    assert b['chart'] == [{'date': '2026-07-01', 'amount': 3.0}], b['chart']
    assert b['sources']['balance'] == {'ok': True, 'status': 200}
    assert b['sources']['chart'] == {'ok': True, 'status': 200}
    # Both upstream endpoints were actually called.
    _path_for('/api2/v2/payments/referrals/balance')
    _path_for('/api2/v2/payouts/referrals/chart')


@scenario
def s04_response_keys_mirror_the_payout_siblings():
    """/referrals/payout-requests is the referral twin of /payout-requests and
    must be shaped the same, or clients need two code paths for one concept."""
    r = client.get(f'{BASE}/referrals/payout-requests', headers=H).get_json()
    assert set(['success', 'requests', 'count']).issubset(r.keys()), r.keys()


# ── Query forwarding ───────────────────────────────────────────────────────

@scenario
def s05_query_params_forwarded_only_when_supplied():
    """No invented date window: an unsupplied param must not appear upstream,
    because a wrong default silently truncates money figures."""
    client.get(f'{BASE}/referrals?startDate=2026-01-01&offset=40', headers=H)
    p = _path_for('/api2/v2/users/me/referrals')
    assert 'startDate=2026-01-01' in p, p
    assert 'offset=40' in p, p
    assert 'endDate' not in p, p
    assert 'marker' not in p, p


@scenario
def s06_chart_defaults_reproduce_the_captured_web_client_call():
    client.get(f'{BASE}/referrals/earnings', headers=H)
    p = _path_for('/api2/v2/payouts/referrals/chart')
    assert 'withTotal=1' in p, p
    assert 'withChart=true' in p, p
    assert p.startswith('/api2/v2/payouts/referrals/chart?'), p
    # The balance call takes no params.
    assert _path_for('/api2/v2/payments/referrals/balance') == \
        '/api2/v2/payments/referrals/balance'


@scenario
def s07_chart_defaults_are_overridable():
    client.get(f'{BASE}/referrals/earnings?withTotal=0&withChart=false'
               f'&startDate=2026-02-01&endDate=2026-03-01', headers=H)
    p = _path_for('/api2/v2/payouts/referrals/chart')
    assert 'withTotal=0' in p and 'withTotal=1' not in p, p
    assert 'withChart=false' in p and 'withChart=true' not in p, p
    assert 'startDate=2026-02-01' in p, p


@scenario
def s08_datetime_values_are_url_encoded():
    """OF is picky: the space inside a datetime must arrive percent-encoded."""
    client.get(f'{BASE}/referrals/payout-requests'
               f'?startDate=2026-01-01 00:00:00', headers=H)
    p = _path_for('/api2/v2/payouts/requests/referral')
    assert '%20' in p and ' ' not in p, p


@scenario
def s09_bad_date_is_a_400_not_a_passthrough():
    for route in ('referrals', 'referrals/earnings', 'referrals/payout-requests'):
        r = client.get(f'{BASE}/{route}?startDate=last-tuesday', headers=H)
        assert r.status_code == 400, f'{route} → {r.status_code}'
        assert not _calls, f'{route} hit upstream with a bad date: {_calls}'


# ── Envelope tolerance ─────────────────────────────────────────────────────

@scenario
def s10_bare_array_body_is_tolerated():
    """Only `list`/`hasMore`/`marker` are treated as known keys. If OF ever
    returns a bare array instead, the route must not explode or lose rows."""
    _responses['/api2/v2/users/me/referrals'] = (True, REFERRAL_ROWS, 200, False)
    b = client.get(f'{BASE}/referrals', headers=H).get_json()
    assert b['referrals'] == REFERRAL_ROWS, b
    assert b['count'] == 2 and b['hasMore'] is False


@scenario
def s11_unexpected_body_degrades_to_empty_not_500():
    _responses['/api2/v2/payouts/requests/referral'] = (True, 'surprise', 200, False)
    r = client.get(f'{BASE}/referrals/payout-requests', headers=H)
    assert r.status_code == 200, r.status_code
    b = r.get_json()
    assert b['requests'] == [] and b['count'] == 0
    assert b['data'] == 'surprise', b['data']


# ── Upstream failure ───────────────────────────────────────────────────────

@scenario
def s12_upstream_401_surfaces_as_401_not_500_or_empty():
    """The bug class this whole feature was reported under: a dead session must
    not be indistinguishable from 'you have no referrals'."""
    _responses['/api2/v2/users/me/referrals'] = (
        False, {'error': 'Session expired'}, 401, False)
    r = client.get(f'{BASE}/referrals', headers=H)
    assert r.status_code == 401, r.status_code
    b = r.get_json()
    assert b['success'] is False
    assert b['error'] == 'Session expired', b


@scenario
def s13_upstream_failure_on_payout_requests_surfaces():
    _responses['/api2/v2/payouts/requests/referral'] = (
        False, {'error': 'Forbidden'}, 403, False)
    r = client.get(f'{BASE}/referrals/payout-requests', headers=H)
    assert r.status_code == 403, r.status_code
    assert r.get_json()['success'] is False


@scenario
def s14_non_http_error_becomes_502_not_500():
    """handle_of_request can fail with a non-4xx/5xx status (e.g. 0 on a
    transport error). That must still be a sane gateway error."""
    _responses['/api2/v2/users/me/referrals'] = (False, 'connection reset', 0, False)
    r = client.get(f'{BASE}/referrals', headers=H)
    assert r.status_code == 502, r.status_code
    assert r.get_json()['success'] is False


@scenario
def s15_earnings_tolerates_one_dead_source():
    """/payments/referrals/balance is in no reverse-engineering capture, so it
    may simply not exist any more. A 404 from it must not take the chart down
    with it — mirrors how /payout-account nulls a failed sub-source."""
    _responses['/api2/v2/payments/referrals/balance'] = (
        False, {'error': 'Not found'}, 404, False)
    r = client.get(f'{BASE}/referrals/earnings', headers=H)
    assert r.status_code == 200, r.status_code
    b = r.get_json()
    assert b['success'] is True
    assert b['balance'] is None, b['balance']
    assert b['chart'] is not None
    assert b['sources']['balance'] == {'ok': False, 'status': 404}, b['sources']
    assert b['sources']['chart']['ok'] is True


@scenario
def s16_earnings_fails_hard_when_both_sources_die():
    _responses['/api2/v2/payments/referrals/balance'] = (
        False, {'error': 'Not found'}, 404, False)
    _responses['/api2/v2/payouts/referrals/chart'] = (
        False, {'error': 'Session expired'}, 401, False)
    r = client.get(f'{BASE}/referrals/earnings', headers=H)
    # The CHART status wins: it's the capture-verified endpoint, so its 401 is
    # the trustworthy diagnosis; the balance 404 may just be a retired route.
    assert r.status_code == 401, r.status_code
    b = r.get_json()
    assert b['success'] is False
    assert b['error'] == 'Session expired', b
    assert b['sources']['balance']['status'] == 404
    assert b['sources']['chart']['status'] == 401


# ── Tenant isolation ───────────────────────────────────────────────────────

@scenario
def s17_another_tenants_account_is_403_on_every_route():
    for route in ('referrals', 'referrals/earnings', 'referrals/payout-requests'):
        r = client.get(f'/api/crm/{CRM_ID}/accounts/{OTHER_ACCT}/{route}', headers=H)
        assert r.status_code == 403, f'{route} → {r.status_code}'
        assert not _calls, f'{route} reached OF for a foreign account: {_calls}'


@scenario
def s18_foreign_key_against_our_crm_id_is_rejected():
    """Ownership is not the only gate — a valid key for a DIFFERENT panel must
    not read this panel's account either."""
    hdr = {'X-API-Key': OTHER_KEY, 'User-Agent': 'Mozilla/5.0 test'}
    r = client.get(f'{BASE}/referrals', headers=hdr)
    assert r.status_code in (401, 403), r.status_code
    assert not _calls, _calls


@scenario
def s19_missing_api_key_is_rejected():
    r = client.get(f'{BASE}/referrals', headers={'User-Agent': 'Mozilla/5.0 test'})
    assert r.status_code in (401, 403), r.status_code


# ── Platform gating ────────────────────────────────────────────────────────

@scenario
def s20_fansly_gets_501_platform_not_supported():
    for route in ('referrals', 'referrals/earnings', 'referrals/payout-requests'):
        r = client.get(
            f'/api/crm/{CRM_ID}/accounts/{FANSLY_ACCT}/{route}', headers=H)
        assert r.status_code == 501, f'{route} → {r.status_code}'
        b = r.get_json()
        assert b['code'] == 'platform_not_supported', b
        assert b['feature'] == 'referrals', b
        assert b['platform'] == 'fansly', b
        assert not _calls, f'{route} hit the OF surface for a Fansly account: {_calls}'


@scenario
def s21_capability_matrix_advertises_the_feature():
    """The 501 must be discoverable up front, so the dashboard can hide the tab
    instead of rendering a panel that always errors."""
    assert pf.capabilities('onlyfans')['referrals'] is True
    assert pf.capabilities('fansly')['referrals'] is False
    assert pf.supports('onlyfans', 'referrals') is True
    assert pf.supports('fansly', 'referrals') is False
    assert 'referrals' in pf.FEATURES


@scenario
def s22_composite_route_fans_out_to_both_upstreams():
    """/referrals/earnings is one route that fans out to TWO OnlyFans
    endpoints. The hosted build additionally asserted it billed as a single
    quota call; this build does no call counting, so what remains worth
    testing is the fan-out itself."""
    r = client.get(f'{BASE}/referrals/earnings', headers=H)
    assert r.status_code == 200, r.status_code
    assert len([p for p in _calls if p.startswith('/api2/v2/')]) == 2, _calls


@scenario
def s23_accounts_payload_carries_the_new_capability():
    r = client.get(f'/api/crm/{CRM_ID}/accounts', headers=H)
    assert r.status_code == 200, r.status_code
    accounts = r.get_json().get('accounts') or []
    by_id = {str(a.get('of_user_id')): a for a in accounts}
    assert by_id[OF_ACCT]['capabilities']['referrals'] is True, by_id[OF_ACCT]
    assert by_id[FANSLY_ACCT]['capabilities']['referrals'] is False, by_id[FANSLY_ACCT]


def main():
    scenarios = [
        s01_list_referrals_happy_path,
        s02_referral_payout_requests_happy_path,
        s03_referral_earnings_composites_both_sources,
        s04_response_keys_mirror_the_payout_siblings,
        s05_query_params_forwarded_only_when_supplied,
        s06_chart_defaults_reproduce_the_captured_web_client_call,
        s07_chart_defaults_are_overridable,
        s08_datetime_values_are_url_encoded,
        s09_bad_date_is_a_400_not_a_passthrough,
        s10_bare_array_body_is_tolerated,
        s11_unexpected_body_degrades_to_empty_not_500,
        s12_upstream_401_surfaces_as_401_not_500_or_empty,
        s13_upstream_failure_on_payout_requests_surfaces,
        s14_non_http_error_becomes_502_not_500,
        s15_earnings_tolerates_one_dead_source,
        s16_earnings_fails_hard_when_both_sources_die,
        s17_another_tenants_account_is_403_on_every_route,
        s18_foreign_key_against_our_crm_id_is_rejected,
        s19_missing_api_key_is_rejected,
        s20_fansly_gets_501_platform_not_supported,
        s21_capability_matrix_advertises_the_feature,
        s22_composite_route_fans_out_to_both_upstreams,
        s23_accounts_payload_carries_the_new_capability,
    ]
    print(f"Running {len(scenarios)} referrals scenarios")
    for s in scenarios:
        s()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for name, msg in _failures:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    print(f"All {len(scenarios)} scenarios passed.")


if __name__ == "__main__":
    main()
