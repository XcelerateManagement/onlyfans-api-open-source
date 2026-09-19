#!/usr/bin/env python3
"""Scenario suite for subscriber liveness freshness.

`subscribers_cache.is_active` is written once per subscriber sync, and the full
OF walk is on a 7-day cadence — so anything reading the stored flag was up to a
week wrong about who is actually subscribed. These scenarios pin the fix down:
liveness is DERIVED from `expired_at` at read time, the stored column is only a
decaying index anchor, and a scheduled sweep converges it.

The clock is simulated the only way that matters: a row is written with a
future expiry (so the sync stores is_active=1) and then only its `expired_at`
is rewritten into the past. That is byte-for-byte the state a real cache lands
in when a subscription lapses between syncs — the flag says 1, the timestamp
says otherwise — and it is why every "no re-sync" assertion below is honest.

Zero network, throwaway DB. Run:

    cd onlyfans-api && venv/bin/python tests/test_subscriber_freshness.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import traceback
from datetime import datetime, timedelta, timezone

os.environ['WERKZEUG_RUN_MAIN'] = 'false'          # don't auto-start scheduler
os.environ['DATABASE_PATH'] = tempfile.mktemp(suffix='.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database as db          # noqa: E402
import crm_api                     # noqa: E402


_failures: list[tuple[str, str]] = []


def scenario(fn):
    def run():
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


# ── fixtures ────────────────────────────────────────────────────────────────
CLIENT = crm_api.app.test_client()
_panel = db.create_crm_panel('subs-freshness-test')
CRM_ID, API_KEY = _panel['crm_id'], _panel['api_key']
OF_ID = '770770770'
db.add_of_account(CRM_ID, OF_ID, 'fresh@e.com', username='fresh', platform='onlyfans')
HDRS = {'X-API-Key': API_KEY}
BASE = f'/api/crm/{CRM_ID}/accounts/{OF_ID}'

# A second tenant on the same fan ids — every count below has to ignore it.
_panel2 = db.create_crm_panel('subs-freshness-other-tenant')
CRM_ID_2, API_KEY_2 = _panel2['crm_id'], _panel2['api_key']
db.add_of_account(CRM_ID_2, OF_ID, 'other@e.com', username='other', platform='onlyfans')

NOW = datetime.now(timezone.utc)
FUTURE = (NOW + timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%S+00:00')
PAST = (NOW - timedelta(days=1)).strftime('%Y-%m-%dT%H:%M:%S+00:00')


def _fan(fan_id, expired_at=FUTURE, sub_at=None, extra=None):
    row = {
        'id': str(fan_id),
        'username': f'fan{fan_id}',
        'name': f'Fan {fan_id}',
        'subscribedOnData': {
            'subscribeAt': sub_at or (NOW - timedelta(days=3)).strftime(
                '%Y-%m-%dT%H:%M:%S+00:00'),
            'expiredAt': expired_at,
            'subscribePrice': 9.99,
            'totalSumm': 0,
        },
    }
    if extra:
        row.update(extra)
    return row


def _sql(query, params=()):
    conn = sqlite3.connect(db.DB_FILE)
    try:
        return conn.execute(query, params).fetchall()
    finally:
        conn.close()


def _write(query, params=()):
    conn = sqlite3.connect(db.DB_FILE)
    try:
        conn.execute(query, params)
        conn.commit()
    finally:
        conn.close()


def _lapse(fan_id, crm_id=CRM_ID, when=PAST):
    """Move a fan's expiry into the past WITHOUT touching is_active — i.e. let
    wall-clock pass, exactly as it does between the 7-day subscriber walks."""
    _write('''UPDATE subscribers_cache SET expired_at = ?
              WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
           (when, crm_id, OF_ID, str(fan_id)))


def _stored_flag(fan_id, crm_id=CRM_ID):
    rows = _sql('''SELECT is_active FROM subscribers_cache
                   WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
                (crm_id, OF_ID, str(fan_id)))
    return rows[0][0] if rows else None


def _cached(**qs):
    q = '&'.join(f'{k}={v}' for k, v in qs.items())
    return CLIENT.get(f'{BASE}/subscribers/cached' + (f'?{q}' if q else ''),
                      headers=HDRS).get_json()


def _ids(body):
    return {str(x.get('fan_of_user_id') or x.get('id')) for x in (body.get('list') or [])}


# ── the primary bug: a frozen is_active ─────────────────────────────────────

@scenario
def s01_lapsed_subscriber_drops_out_of_active_without_a_resync():
    db.upsert_subscriber(CRM_ID, OF_ID, _fan(1001))
    assert _stored_flag(1001) == 1, 'sync should have stored active'
    _lapse(1001)
    assert '1001' not in _ids(_cached(type='active')), \
        'a fan whose expiry has passed is still being served as active'
    assert '1001' in _ids(_cached(type='expired')), \
        'and they are not in the expired list either — the row vanished'


@scenario
def s02_the_stored_flag_still_says_active_which_is_the_whole_point():
    """Proves the fix is read-side. If this ever fails because the flag was
    already repaired, s01 stops testing anything and becomes a tautology."""
    assert _stored_flag(1001) == 1, \
        'stored column was rewritten — s01 is no longer testing the stale case'


@scenario
def s03_null_expired_at_is_active_not_expired():
    """NULL is how an open-ended / freshly-renewed sub reports 'no end date'.
    Treating it as expired would empty out the roster of exactly the fans a
    creator most wants to see."""
    db.upsert_subscriber(CRM_ID, OF_ID, _fan(1002, expired_at=None))
    assert _stored_flag(1002) == 1
    assert '1002' in _ids(_cached(type='active'))
    assert '1002' not in _ids(_cached(type='expired'))
    # And it stays active however long nothing syncs — there is no timestamp
    # for the clock to overtake.
    assert db.subscribers_cache_summary(CRM_ID, OF_ID)['active'] >= 1


@scenario
def s04_projected_is_active_agrees_with_the_filter():
    """The row body carries the derived flag, not the stored one — otherwise
    /subscribers/cached returns a fan under type=expired with is_active=1 on
    them."""
    body = _cached(type='expired')
    row = next(r for r in body['list'] if str(r.get('fan_of_user_id') or r.get('id')) == '1001')
    assert row['is_active'] == 0, f"projected flag is stale: {row['is_active']}"
    new = CLIENT.get(f'{BASE}/subscribers/new?type=expired', headers=HDRS).get_json()
    assert [s for s in new['subscribers'] if s['fan_of_user_id'] == '1001'
            and s['is_active'] == 0], f'/subscribers/new disagrees: {new}'


@scenario
def s05_summary_counts_are_derived_too():
    """The summary is embedded in the very responses whose lists are derived,
    so a stored-column count here contradicts the list next to it."""
    s = db.subscribers_cache_summary(CRM_ID, OF_ID)
    assert s['active'] + s['expired'] == s['total'], \
        f'active+expired must partition the roster: {s}'
    assert s['expired'] >= 1, f'the lapsed fan is not counted expired: {s}'
    stored_active = _sql('''SELECT COUNT(*) FROM subscribers_cache
                            WHERE crm_id=? AND of_user_id=? AND is_active=1''',
                         (CRM_ID, OF_ID))[0][0]
    assert stored_active > s['active'], \
        'stored column should still over-count — otherwise nothing was stale'


@scenario
def s06_unparseable_expiry_reads_as_active_not_silently_dropped():
    """Matches what the old Python computation did on a parse failure. Erring
    the other way would delete a fan from the roster over a timestamp format we
    did not anticipate."""
    db.upsert_subscriber(CRM_ID, OF_ID, _fan(1003, expired_at='not-a-timestamp'))
    assert _stored_flag(1003) == 1
    assert '1003' in _ids(_cached(type='active'))


@scenario
def s07_expiry_with_a_utc_offset_is_compared_as_an_instant():
    """A raw string compare against '+02:00' would be wrong by hours; the SQL
    normalises through datetime() so this is a real instant comparison."""
    plus2 = (NOW - timedelta(hours=1)).astimezone(
        timezone(timedelta(hours=2))).strftime('%Y-%m-%dT%H:%M:%S+02:00')
    db.upsert_subscriber(CRM_ID, OF_ID, _fan(1004, expired_at=plus2))
    assert _stored_flag(1004) == 0, 'an hour-ago expiry in +02:00 read as live'
    assert '1004' in _ids(_cached(type='expired'))


@scenario
def s08_fansly_status_string_cannot_contradict_is_active():
    """Fansly rows carry a frozen `status` inside raw_json. Serving it verbatim
    put status='active' next to is_active=0 in the same object."""
    db.upsert_subscriber(CRM_ID, OF_ID,
                         _fan(1005, extra={'status': 'active', 'platform': 'fansly'}))
    _lapse(1005)
    row = next(r for r in _cached(type='expired')['list']
               if str(r.get('fan_of_user_id') or r.get('id')) == '1005')
    assert row['is_active'] == 0 and row['status'] == 'expired', \
        f'raw payload won over the derived truth: {row}'


@scenario
def s09_a_resync_that_renews_brings_the_fan_back():
    """The derived rule has to work in both directions: a renewal pushes
    expired_at forward and the fan is live again immediately."""
    db.upsert_subscriber(CRM_ID, OF_ID, _fan(1001, expired_at=FUTURE))
    assert '1001' in _ids(_cached(type='active'))
    assert _stored_flag(1001) == 1


# ── multi-tenant isolation ──────────────────────────────────────────────────

@scenario
def s10_liveness_never_leaks_across_tenants():
    """Same fan id, same of_user_id, different crm_id — the derived predicate
    must not widen the (crm_id, of_user_id) scope."""
    db.upsert_subscriber(CRM_ID_2, OF_ID, _fan(1001, expired_at=FUTURE))
    _lapse(1001, crm_id=CRM_ID)
    other = CLIENT.get(f'/api/crm/{CRM_ID_2}/accounts/{OF_ID}/subscribers/cached'
                       '?type=active', headers={'X-API-Key': API_KEY_2}).get_json()
    assert '1001' in _ids(other), "tenant 2's live row was expired by tenant 1's clock"
    assert '1001' not in _ids(_cached(type='active'))
    s2 = db.subscribers_cache_summary(CRM_ID_2, OF_ID)
    assert s2['total'] == 1, f"tenant 2's summary sees tenant 1's rows: {s2}"


# ── the index anchor (the reason the derived term is not written alone) ─────

@scenario
def s11_hot_active_query_still_uses_the_index():
    """The derived predicate rides ON TOP of is_active=1 precisely so the plan
    doesn't change. Written alone it falls off idx_subs_cache_account onto the
    UNIQUE autoindex plus a temp b-tree sort — measured 0.113ms → 2.15ms at 3M
    rows. If this assertion ever fails, that regression just shipped."""
    sql = (f"SELECT * FROM subscribers_cache "
           f"WHERE crm_id = ? AND of_user_id = ? "
           f"AND is_active = 1 AND {db.SUBSCRIPTION_ACTIVE_SQL} "
           f"ORDER BY subscribed_at DESC LIMIT 100")
    plan = ' | '.join(str(r[-1]) for r in
                      _sql('EXPLAIN QUERY PLAN ' + sql, (CRM_ID, OF_ID)))
    assert 'SCAN' not in plan, f'hot query degraded to a scan: {plan}'
    assert 'idx_subs_cache_account' in plan, \
        f'hot query no longer uses the account index: {plan}'
    assert 'TEMP B-TREE' not in plan, \
        f'hot query lost its index-ordered sort: {plan}'


@scenario
def s12_the_naive_derived_only_filter_is_the_regression_we_avoided():
    """Documents the alternative so the trade-off stays visible in the suite:
    dropping the is_active anchor is what loses the index."""
    naive = (f"SELECT * FROM subscribers_cache "
             f"WHERE crm_id = ? AND of_user_id = ? AND {db.SUBSCRIPTION_ACTIVE_SQL} "
             f"ORDER BY subscribed_at DESC LIMIT 100")
    plan = ' | '.join(str(r[-1]) for r in
                      _sql('EXPLAIN QUERY PLAN ' + naive, (CRM_ID, OF_ID)))
    assert 'idx_subs_cache_account' not in plan, (
        'the naive filter now uses the account index — if SQLite got smarter, '
        f'the anchor in list_cached_subscribers may be reconsidered: {plan}')


@scenario
def s13_route_level_active_filter_is_index_backed_end_to_end():
    """s11 asserts a hand-written query; this asserts the one the route
    actually builds, so the two can't drift."""
    seen: list[str] = []
    real_connect = sqlite3.connect

    def spy(*a, **kw):
        conn = real_connect(*a, **kw)
        # The trace callback hands back FULLY EXPANDED sql (params inlined),
        # which is what lets us EXPLAIN it below without knowing the bindings.
        conn.set_trace_callback(seen.append)
        return conn

    sqlite3.connect = spy
    try:
        db.list_cached_subscribers(CRM_ID, OF_ID, type_='active', limit=100)
    finally:
        sqlite3.connect = real_connect
    listing = [s for s in seen
               if 'FROM subscribers_cache' in s and 'ORDER BY' in s]
    assert listing, f'did not capture the route query: {seen}'
    plan = ' | '.join(str(r[-1]) for r in
                      _sql('EXPLAIN QUERY PLAN ' + listing[0]))
    assert 'SCAN' not in plan and 'idx_subs_cache_account' in plan, \
        f'route query is not index-backed: {plan}'


# ── the convergence sweep ───────────────────────────────────────────────────

@scenario
def s14_sweep_converges_the_stored_column():
    assert _stored_flag(1001) == 1 and _stored_flag(1005) == 1, \
        'setup: both rows should still carry a stale 1'
    changed = db.recompute_subscriber_activity()
    assert changed >= 2, f'sweep found nothing to fix: {changed}'
    assert _stored_flag(1001) == 0 and _stored_flag(1005) == 0
    assert _stored_flag(1002) == 1, 'NULL-expiry row must stay active'
    assert _stored_flag(1003) == 1, 'unparseable-expiry row must stay active'


@scenario
def s15_sweep_is_idempotent():
    assert db.recompute_subscriber_activity() == 0, \
        'a second pass rewrote rows — the sweep is not converging'


@scenario
def s16_sweep_repairs_a_false_negative_too():
    """The read path leans on 'stored 1 is a superset of live', which holds
    because upsert derives both from one expression. The sweep still checks
    both directions so a future direct writer that broke the invariant heals
    within one pass instead of silently hiding live fans forever."""
    _write('''UPDATE subscribers_cache SET is_active = 0
              WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
           (CRM_ID, OF_ID, '1002'))
    assert '1002' not in _ids(_cached(type='active')), \
        'setup: the corrupted row should be hidden by the anchor'
    assert db.recompute_subscriber_activity() == 1
    assert _stored_flag(1002) == 1
    assert '1002' in _ids(_cached(type='active')), 'sweep did not restore the row'


@scenario
def s17_sweep_respects_max_rows():
    for fid in (2001, 2002, 2003):
        db.upsert_subscriber(CRM_ID, OF_ID, _fan(fid))
        _lapse(fid)
    assert db.recompute_subscriber_activity(max_rows=2) == 2
    assert db.recompute_subscriber_activity() == 1, 'remainder not picked up'


@scenario
def s18_sweep_leaves_a_null_flag_healed_not_skipped():
    """`NULL <> 1` is NULL, not true — an unguarded comparison would skip such
    a row for good."""
    db.upsert_subscriber(CRM_ID, OF_ID, _fan(2004))
    _write('''UPDATE subscribers_cache SET is_active = NULL
              WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
           (CRM_ID, OF_ID, '2004'))
    assert db.recompute_subscriber_activity() == 1
    assert _stored_flag(2004) == 1


# ── week bucketing (the expression that looks wrong and isn't) ──────────────

@scenario
def s19_every_weekday_lands_in_the_same_monday_bucket():
    """`weekday 0` IS Sunday in SQLite — the '-6 days' is what makes the bucket
    Monday-start. Mon 2026-06-01 .. Sun 2026-06-07 must all bucket to
    2026-06-01, and the Sunday is the case a naive reading gets wrong."""
    crm = db.create_crm_panel('week-bucket')['crm_id']
    acct = '990990990'
    db.add_of_account(crm, acct, 'wk@e.com', username='wk', platform='onlyfans')
    for day in range(1, 8):
        db.upsert_subscriber(crm, acct, _fan(
            3000 + day, sub_at=f'2026-06-0{day}T12:00:00+00:00'))
    buckets, total, _zf = db.new_subscribers_timeseries(
        crm, acct, since='2026-06-01', until='2026-06-07T23:59:59',
        granularity='week')
    assert total == 7, total
    assert buckets == [{'bucket': '2026-06-01', 'count': 7}], buckets
    # And the following Monday opens a NEW bucket rather than joining this one.
    db.upsert_subscriber(crm, acct, _fan(3100, sub_at='2026-06-08T12:00:00+00:00'))
    buckets, _t, _zf = db.new_subscribers_timeseries(
        crm, acct, since='2026-06-01', until='2026-06-08T23:59:59',
        granularity='week')
    assert buckets == [{'bucket': '2026-06-01', 'count': 7},
                       {'bucket': '2026-06-08', 'count': 1}], buckets


# ── server-side zero-fill ───────────────────────────────────────────────────

@scenario
def s20_day_buckets_are_contiguous():
    crm = db.create_crm_panel('zerofill')['crm_id']
    acct = '991991991'
    db.add_of_account(crm, acct, 'zf@e.com', username='zf', platform='onlyfans')
    db.upsert_subscriber(crm, acct, _fan(4001, sub_at='2026-03-01T09:00:00+00:00'))
    db.upsert_subscriber(crm, acct, _fan(4002, sub_at='2026-03-04T09:00:00+00:00'))
    buckets, total, zf = db.new_subscribers_timeseries(crm, acct, granularity='day')
    assert zf is True
    assert total == 2, total
    assert [b['bucket'] for b in buckets] == ['2026-03-01', '2026-03-02',
                                              '2026-03-03', '2026-03-04'], buckets
    assert [b['count'] for b in buckets] == [1, 0, 0, 1], buckets


@scenario
def s21_an_explicit_window_is_honoured_even_when_empty():
    """A charting client asking for a specific fortnight gets that fortnight —
    an empty array would render as 'no axis' rather than 'a quiet fortnight'."""
    crm = db.create_crm_panel('zerofill-empty')['crm_id']
    acct = '992992992'
    db.add_of_account(crm, acct, 'zfe@e.com', username='zfe', platform='onlyfans')
    buckets, total, zf = db.new_subscribers_timeseries(
        crm, acct, since='2026-03-01', until='2026-03-05', granularity='day')
    assert zf is True and total == 0
    assert len(buckets) == 5 and all(b['count'] == 0 for b in buckets), buckets
    assert buckets[0]['bucket'] == '2026-03-01' and buckets[-1]['bucket'] == '2026-03-05'


@scenario
def s22_month_buckets_step_across_a_year_boundary():
    crm = db.create_crm_panel('zerofill-month')['crm_id']
    acct = '993993993'
    db.add_of_account(crm, acct, 'zfm@e.com', username='zfm', platform='onlyfans')
    db.upsert_subscriber(crm, acct, _fan(4101, sub_at='2025-11-15T09:00:00+00:00'))
    db.upsert_subscriber(crm, acct, _fan(4102, sub_at='2026-02-02T09:00:00+00:00'))
    buckets, _t, zf = db.new_subscribers_timeseries(crm, acct, granularity='month')
    assert zf is True
    assert [b['bucket'] for b in buckets] == ['2025-11', '2025-12',
                                              '2026-01', '2026-02'], buckets
    assert [b['count'] for b in buckets] == [1, 0, 0, 1], buckets


@scenario
def s23_absurd_spans_fall_back_to_sparse_instead_of_a_megabyte_of_zeros():
    """Hourly over years is ~26k buckets. We say so rather than build it."""
    crm = db.create_crm_panel('zerofill-cap')['crm_id']
    acct = '994994994'
    db.add_of_account(crm, acct, 'zfc@e.com', username='zfc', platform='onlyfans')
    db.upsert_subscriber(crm, acct, _fan(4201, sub_at='2020-01-01T09:00:00+00:00'))
    db.upsert_subscriber(crm, acct, _fan(4202, sub_at='2026-01-01T09:00:00+00:00'))
    buckets, total, zf = db.new_subscribers_timeseries(crm, acct, granularity='hour')
    assert zf is False, 'a 6-year hourly axis was zero-filled anyway'
    assert len(buckets) == 2 and total == 2, len(buckets)


@scenario
def s24_stats_route_exposes_zero_filled():
    j = CLIENT.get(f'{BASE}/subscribers/stats?granularity=day', headers=HDRS).get_json()
    assert j['success'] and 'zero_filled' in j, j
    labels = [b['bucket'] for b in j['buckets']]
    assert labels == sorted(labels) and len(set(labels)) == len(labels), labels


# ── cross-platform pagination contract ──────────────────────────────────────

@scenario
def s25_of_subscribers_route_emits_nextoffset():
    """OF filters by type server-side so its offset counts rows returned, while
    Fansly's counts rows consumed. Emitting nextOffset on BOTH is what lets one
    generic pager be correct on either platform."""
    import of_client

    page = [{'id': str(5000 + i), 'username': f'p{i}'} for i in range(10)]
    calls = []

    def fake(crm_id, of_user_id, path, method='GET', body=None, proxy=None, **kw):
        calls.append(path)
        off = int(path.split('offset=')[1].split('&')[0])
        chunk = page[off:off + 4]
        return True, {'users': chunk, 'list': chunk,
                      'hasMore': off + len(chunk) < len(page)}, 200, False

    real = crm_api.handle_of_request
    crm_api.handle_of_request = fake
    try:
        b = CLIENT.get(f'{BASE}/subscribers?limit=4&offset=0', headers=HDRS).get_json()
        assert b['nextOffset'] == 4, b
        assert b['hasMore'] is True and b['count'] == 4, b
        b = CLIENT.get(f'{BASE}/subscribers?limit=4&offset={b["nextOffset"]}',
                       headers=HDRS).get_json()
        assert b['nextOffset'] == 8, b
        b = CLIENT.get(f'{BASE}/subscribers?limit=4&offset={b["nextOffset"]}',
                       headers=HDRS).get_json()
        assert b['nextOffset'] == 10 and b['hasMore'] is False, b
    finally:
        crm_api.handle_of_request = real
    assert of_client  # imported for the module-not-stubbed-elsewhere check


def main():
    scenarios = [
        s01_lapsed_subscriber_drops_out_of_active_without_a_resync,
        s02_the_stored_flag_still_says_active_which_is_the_whole_point,
        s03_null_expired_at_is_active_not_expired,
        s04_projected_is_active_agrees_with_the_filter,
        s05_summary_counts_are_derived_too,
        s06_unparseable_expiry_reads_as_active_not_silently_dropped,
        s07_expiry_with_a_utc_offset_is_compared_as_an_instant,
        s08_fansly_status_string_cannot_contradict_is_active,
        s09_a_resync_that_renews_brings_the_fan_back,
        s10_liveness_never_leaks_across_tenants,
        s11_hot_active_query_still_uses_the_index,
        s12_the_naive_derived_only_filter_is_the_regression_we_avoided,
        s13_route_level_active_filter_is_index_backed_end_to_end,
        s14_sweep_converges_the_stored_column,
        s15_sweep_is_idempotent,
        s16_sweep_repairs_a_false_negative_too,
        s17_sweep_respects_max_rows,
        s18_sweep_leaves_a_null_flag_healed_not_skipped,
        s19_every_weekday_lands_in_the_same_monday_bucket,
        s20_day_buckets_are_contiguous,
        s21_an_explicit_window_is_honoured_even_when_empty,
        s22_month_buckets_step_across_a_year_boundary,
        s23_absurd_spans_fall_back_to_sparse_instead_of_a_megabyte_of_zeros,
        s24_stats_route_exposes_zero_filled,
        s25_of_subscribers_route_emits_nextoffset,
    ]
    print(f"Running {len(scenarios)} subscriber-freshness scenarios")
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
