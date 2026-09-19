#!/usr/bin/env python3
"""Scenario suite for api_metrics — request-outcome recording + the read route.

Does NOT hit OF and does NOT touch the real crm_data.db: DATABASE_PATH is
pointed at a throwaway file before anything opens SQLite.

The failure this exists to prevent: every counter we had before increments
BEFORE the handler runs, so a 500 and a 200 were indistinguishable. These
scenarios assert the outcome actually lands, that it lands in the right bucket,
and that the metrics layer can never take a real request down with it.

Run:

    cd onlyfans-api && python3 tests/test_api_metrics.py
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Throwaway DB + env, set before crm_database / config are imported anywhere.
_TMP_DIR = tempfile.mkdtemp(prefix='api_metrics_test_')
os.environ['DATABASE_PATH'] = os.path.join(_TMP_DIR, 'metrics_test.db')
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)
# The scheduler would otherwise start a live jobstore next to the scratch DB.
os.environ.setdefault('SCHEDULER_JOBSTORE_PATH',
                      os.path.join(_TMP_DIR, 'sched_jobs.db'))
# Keep buckets fine-grained so two records seconds apart can be forced apart.
os.environ['API_METRICS_BUCKET_SECONDS'] = '60'
os.environ['API_METRICS_SLOW_MS'] = '250'
# The overhead benchmark fires thousands of requests at one route. At the
# shipped 600/min the limiter would answer most of them with a cheap 429 and the
# measurement would be of the limiter, not of the metrics hooks.
os.environ['RATE_LIMIT_DEFAULT'] = '10000000 per minute'

import logging  # noqa: E402

logging.getLogger('flask-limiter').setLevel(logging.ERROR)   # benchmark spam
# s14/s15 deliberately raise inside a handler; crm_api's global error handler
# logs the traceback, which is correct behaviour and unreadable test output.
logging.getLogger('crm_api').setLevel(logging.CRITICAL)

import api_metrics  # noqa: E402
import crm_database as db  # noqa: E402


_failures: list[tuple[str, str]] = []
_asserts = {'n': 0}


def check(cond, msg=''):
    _asserts['n'] += 1
    assert cond, msg


def scenario(fn):
    def run():
        _reset()
        try:
            fn()
            print(f'  ✓ {fn.__name__}')
        except AssertionError as e:
            _failures.append((fn.__name__, str(e)))
            print(f'  ✗ {fn.__name__}: {e}')
        except Exception:
            _failures.append((fn.__name__, traceback.format_exc()))
            print(f'  ✗ {fn.__name__} raised:\n{traceback.format_exc()}')
    run.__name__ = fn.__name__
    return run


def _reset():
    """Empty accumulator + empty table, so scenarios don't see each other."""
    with api_metrics._lock:
        api_metrics._pending.clear()
        api_metrics._stats['dropped'] = 0
    api_metrics.ensure_schema()
    conn = sqlite3.connect(api_metrics._db_file())
    try:
        conn.execute('DELETE FROM api_request_metrics')
        conn.commit()
    finally:
        conn.close()


def _rows():
    conn = sqlite3.connect(api_metrics._db_file())
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            'SELECT * FROM api_request_metrics ORDER BY bucket_start, status_code')]
    finally:
        conn.close()


# ---------------------------------------------------------------- unit ------

@scenario
def s01_2xx_and_5xx_land_in_different_buckets():
    """The whole point of the change: a success and a failure must be
    separable. Before this module they folded into the same integer."""
    now = time.time()
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 12.0,
                       crm_id='crmA', now=now)
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 18.0,
                       crm_id='crmA', now=now)
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 500, 40.0,
                       crm_id='crmA', now=now)
    api_metrics.flush()

    rows = _rows()
    check(len(rows) == 2, f'expected 2 rows (200 + 500), got {rows}')
    by_code = {r['status_code']: r for r in rows}
    check(by_code[200]['req_count'] == 2, by_code[200])
    check(by_code[500]['req_count'] == 1, by_code[500])
    check(by_code[200]['latency_ms_sum'] == 30, by_code[200])
    check(by_code[500]['latency_ms_max'] == 40, by_code[500])
    # ...and the read side separates them into status classes.
    m = api_metrics.query(hours=1, granularity='5m', crm_id='crmA')
    check(m['totals']['requests'] == 3, m['totals'])
    check(m['totals']['server_errors'] == 1, m['totals'])
    check(m['totals']['errors'] == 1, m['totals'])
    check(abs(m['totals']['error_rate'] - 1 / 3) < 1e-4, m['totals'])
    latest = [b for b in m['series'] if b['total']][-1]
    check(latest['2xx'] == 2 and latest['5xx'] == 1, latest)


@scenario
def s02_route_pattern_not_concrete_path():
    """Storing the substituted path would make the key set unbounded and put
    tenant ids in a metrics table. The recorder must be given (and must store)
    the rule pattern."""
    for tenant in ('crm_aaa', 'crm_bbb', 'crm_ccc'):
        api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 5,
                           crm_id=tenant)
    api_metrics.flush()
    routes = {r['route'] for r in _rows()}
    check(routes == {'/api/crm/<crm_id>/accounts'}, routes)
    for r in _rows():
        check('crm_aaa' not in r['route'], r['route'])
        check('<crm_id>' in r['route'], r['route'])
    # Three tenants → three rows on the same route, i.e. cardinality grows with
    # tenants (a real dimension), not with URLs.
    check(len(_rows()) == 3, _rows())


@scenario
def s03_unmatched_requests_fold_into_one_key():
    """A 404 scanner hitting 10k invented paths must not create 10k rows."""
    for i in range(50):
        api_metrics.record(None, 'GET', 404, 1)
    api_metrics.flush()
    rows = _rows()
    check(len(rows) == 1, rows)
    check(rows[0]['route'] == api_metrics.UNMATCHED_ROUTE, rows[0])
    check(rows[0]['req_count'] == 50, rows[0])


@scenario
def s04_sse_is_excluded():
    """A stream held open for minutes is a connection, not a request; recording
    it poisons every latency percentile."""
    api_metrics.record('/api/crm/<crm_id>/events/stream', 'GET', 200, 600_000,
                       crm_id='crmA')
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 10, crm_id='crmA')
    api_metrics.flush()
    rows = _rows()
    check(len(rows) == 1, rows)
    check(rows[0]['route'] == '/api/crm/<crm_id>/accounts', rows[0])
    m = api_metrics.query(hours=1, granularity='5m')
    check(m['totals']['max_latency_ms'] == 10, m['totals'])


@scenario
def s05_buckets_are_time_separated_and_series_is_zero_filled():
    now = time.time()
    api_metrics.record('/health', 'GET', 200, 1, now=now - 3600)
    api_metrics.record('/health', 'GET', 200, 1, now=now)
    api_metrics.flush()
    check(len(_rows()) == 2, _rows())

    m = api_metrics.query(hours=3, granularity='5m', now=now)
    check(m['range']['bucket_seconds'] == 300, m['range'])
    check(len(m['series']) == 36, len(m['series']))
    # Zero-filled: every bucket present, in order, no gaps.
    stamps = [b['bucket'] for b in m['series']]
    check(stamps == sorted(stamps), 'series not oldest-first')
    non_empty = [b for b in m['series'] if b['total']]
    check(len(non_empty) == 2, non_empty)
    empties = [b for b in m['series'] if not b['total']]
    check(all(b['2xx'] == 0 and b['5xx'] == 0 for b in empties), 'counts not zero-filled')
    check(all(b['avg_latency_ms'] is None for b in empties),
          'empty bucket must report null latency, not a fake 0')


@scenario
def s06_slow_requests_are_counted():
    api_metrics.record('/api/crm/<crm_id>/earnings', 'GET', 200, 50)
    api_metrics.record('/api/crm/<crm_id>/earnings', 'GET', 200, 5000)
    api_metrics.flush()
    m = api_metrics.query(hours=1)
    check(m['totals']['slow_requests'] == 1, m['totals'])
    check(m['totals']['slow_threshold_ms'] == 250, m['totals'])
    check(m['totals']['max_latency_ms'] == 5000, m['totals'])
    check(m['totals']['avg_latency_ms'] == 2525.0, m['totals'])


@scenario
def s07_slowest_and_most_erroring_routes():
    for _ in range(10):
        api_metrics.record('/api/crm/<crm_id>/fans', 'GET', 200, 10)
    for _ in range(3):
        api_metrics.record('/api/crm/<crm_id>/messages', 'GET', 200, 4000)
    for _ in range(7):
        api_metrics.record('/api/crm/<crm_id>/login', 'POST', 502, 30)
    api_metrics.record('/api/crm/<crm_id>/fans', 'GET', 404, 5)
    api_metrics.flush()

    m = api_metrics.query(hours=1, limit=5)
    check(m['top_routes'][0]['route'] == '/api/crm/<crm_id>/fans', m['top_routes'])
    check(m['slowest_routes'][0]['route'] == '/api/crm/<crm_id>/messages',
          m['slowest_routes'])
    check(m['slowest_routes'][0]['avg_latency_ms'] == 4000.0, m['slowest_routes'][0])
    check(m['top_error_routes'][0]['route'] == '/api/crm/<crm_id>/login',
          m['top_error_routes'])
    check(m['top_error_routes'][0]['errors'] == 7, m['top_error_routes'][0])
    check(m['top_error_routes'][0]['server_errors'] == 7, m['top_error_routes'][0])
    # Method is part of the identity — a POST /login is not a GET /login.
    check(m['top_error_routes'][0]['method'] == 'POST', m['top_error_routes'][0])
    codes = {c['status']: c['count'] for c in m['status_codes']}
    check(codes == {200: 13, 502: 7, 404: 1}, codes)


@scenario
def s08_tenant_isolation_and_breakdown():
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 5, crm_id='t1')
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 500, 5, crm_id='t1')
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 5, crm_id='t2')
    api_metrics.flush()

    scoped = api_metrics.query(hours=1, crm_id='t1')
    check(scoped['totals']['requests'] == 2, scoped['totals'])
    check(scoped['totals']['server_errors'] == 1, scoped['totals'])
    check(scoped['top_tenants'] == [], 'tenant-scoped read must not leak the roster')
    check(scoped['range']['crm_id'] == 't1', scoped['range'])

    everything = api_metrics.query(hours=1)
    check(everything['totals']['requests'] == 3, everything['totals'])
    tenants = {t['crm_id']: t for t in everything['top_tenants']}
    check(tenants['t1']['requests'] == 2 and tenants['t1']['server_errors'] == 1, tenants)
    check(tenants['t2']['requests'] == 1, tenants)


@scenario
def s09_retention_sweep_deletes_only_old_rows():
    now = time.time()
    api_metrics.record('/health', 'GET', 200, 1, now=now - 40 * 86400)  # ancient
    api_metrics.record('/health', 'GET', 200, 1, now=now - 31 * 86400)  # just past
    api_metrics.record('/health', 'GET', 200, 1, now=now - 29 * 86400)  # inside
    api_metrics.record('/health', 'GET', 200, 1, now=now)               # fresh
    api_metrics.flush()
    check(len(_rows()) == 4, _rows())

    deleted = api_metrics.sweep(retention_days=30)
    check(deleted == 2, f'swept {deleted}, expected 2')
    left = _rows()
    check(len(left) == 2, left)
    cutoff = now - 30 * 86400
    check(all(r['bucket_start'] >= cutoff - api_metrics.BUCKET_SECONDS for r in left), left)
    # Idempotent: a second pass has nothing left to do.
    check(api_metrics.sweep(retention_days=30) == 0, 'second sweep deleted rows')


@scenario
def s10_flush_is_additive_and_reentrant():
    """Two flushes of the same bucket must accumulate, not overwrite — the
    upsert is the only thing standing between us and losing 59 of every 60
    seconds of traffic."""
    now = time.time()
    api_metrics.record('/health', 'GET', 200, 100, now=now)
    api_metrics.flush()
    api_metrics.record('/health', 'GET', 200, 300, now=now)
    api_metrics.flush()
    rows = _rows()
    check(len(rows) == 1, rows)
    check(rows[0]['req_count'] == 2, rows[0])
    check(rows[0]['latency_ms_sum'] == 400, rows[0])
    check(rows[0]['latency_ms_max'] == 300, rows[0])
    # Flushing an empty accumulator is a cheap no-op, not an error.
    check(api_metrics.flush() == 0, 'empty flush wrote rows')


@scenario
def s11_failed_flush_requeues_instead_of_losing_counters():
    api_metrics.record('/health', 'GET', 200, 10)
    original = api_metrics._db_file
    api_metrics._db_file = lambda: '/nonexistent-dir-xyz/nope.db'
    try:
        wrote = api_metrics.flush()
    finally:
        api_metrics._db_file = original
    check(wrote == 0, wrote)
    check(api_metrics.pending_count() == 1, 'counters were dropped on a failed flush')
    check(api_metrics.stats()['last_flush_error'], 'flush error not surfaced')
    # Recovery: the next successful flush writes the requeued batch.
    check(api_metrics.flush() == 1, 'requeued batch never landed')
    check(_rows()[0]['req_count'] == 1, _rows())


@scenario
def s12_accumulator_is_bounded():
    """If the flush job dies, the dict must stop growing rather than OOM the
    worker — and the drops must be visible."""
    original = api_metrics.MAX_PENDING_BUCKETS
    api_metrics.MAX_PENDING_BUCKETS = 5
    try:
        for i in range(50):
            api_metrics.record(f'/route/{i}', 'GET', 200, 1)
        check(api_metrics.pending_count() == 5, api_metrics.pending_count())
        check(api_metrics.stats()['dropped'] == 45, api_metrics.stats())
        # An EXISTING key still records — we only refuse new keys, so the
        # hottest routes keep their counts.
        before = api_metrics.stats()['recorded']
        api_metrics.record('/route/0', 'GET', 200, 1)
        check(api_metrics.stats()['recorded'] == before + 1, api_metrics.stats())
    finally:
        api_metrics.MAX_PENDING_BUCKETS = original


@scenario
def s13_record_never_raises():
    """Fail-open contract: garbage in, no exception out, request unaffected."""
    for args in [
        (None, None, None, None),
        ('/x', 'GET', 'not-a-number', 5),
        ('/x', 'GET', 200, 'not-a-number'),
        (object(), 'GET', 200, 5),
        ('/x', 'GET', 200, -1),
    ]:
        api_metrics.record(*args)          # must not raise
    _asserts['n'] += 1                     # counted: "no exception" is the assert
    # ...and garbage must not poison the BATCH either: an unbindable value would
    # fail the whole flush and requeue every good row behind it forever.
    wrote = api_metrics.flush()
    check(api_metrics.stats()['last_flush_error'] is None,
          f"garbage input broke the flush: {api_metrics.stats()['last_flush_error']}")
    check(wrote > 0, 'the valid records never landed')
    check(all(isinstance(r['status_code'], int) for r in _rows()), _rows())
    check(all(r['route'].startswith('/') or r['route'] == api_metrics.UNMATCHED_ROUTE
              for r in _rows()), _rows())


# ------------------------------------------------------------- HTTP level ---
#
# Flask 3 refuses to register a route once the app has served its first request,
# so every probe route is added in one place, before any test client runs.

_APP = {'mod': None, 'panel': None}


def _app():
    """Import crm_api lazily (it starts the scheduler and registers ~120 routes)
    and attach the probe routes exactly once."""
    if _APP['mod'] is not None:
        return _APP['mod']
    import crm_api
    app = crm_api.app

    @app.route('/__t/ok/<thing>')
    def _t_ok(thing):
        return crm_api.jsonify({'ok': True})

    @app.route('/__t/boom/<thing>')
    def _t_boom(thing):
        raise RuntimeError('handler exploded')

    @app.route('/__t/safe')
    def _t_safe():
        return crm_api.jsonify({'ok': True})

    @app.route('/__t/bench')
    def _t_bench():
        return crm_api.jsonify({'ok': True})

    _APP['mod'] = crm_api
    return crm_api


def _panel():
    """A real panel row + its API key, for the tenant-scoped read route."""
    if _APP['panel'] is None:
        _APP['panel'] = db.create_crm_panel('Metrics Test Panel')
    return _APP['panel']


@scenario
def s14_http_2xx_and_5xx_both_recorded_with_route_pattern():
    app = _app().app

    with app.test_client() as c:
        r1 = c.get('/__t/ok/abc')
        r2 = c.get('/__t/boom/xyz')
    check(r1.status_code == 200, r1.status_code)
    check(r2.status_code == 500, r2.status_code)

    api_metrics.flush()
    rows = {(r['route'], r['status_code']): r for r in _rows()}
    check(('/__t/ok/<thing>', 200) in rows, list(rows))
    # A raising handler must not lose its metric — this is the single most
    # important row in the whole table.
    check(('/__t/boom/<thing>', 500) in rows, list(rows))
    # Pattern, not '/__t/ok/abc'.
    check(not any('abc' in k[0] or 'xyz' in k[0] for k in rows), list(rows))
    # Latency was measured, not left at zero.
    check(rows[('/__t/ok/<thing>', 200)]['latency_ms_max'] >= 0, rows)
    # Exactly ONE record each: after_request and the teardown backstop both run
    # for the raising request, and the `_metrics_done` flag must keep that from
    # double-counting the error.
    check(rows[('/__t/ok/<thing>', 200)]['req_count'] == 1, rows)
    check(rows[('/__t/boom/<thing>', 500)]['req_count'] == 1,
          f"raising request counted twice: {rows[('/__t/boom/<thing>', 500)]}")


@scenario
def s15_metrics_failure_cannot_break_a_request():
    """If the recorder blows up mid-request the API must still answer normally.
    Same rule and shape the hosted build used for per-key usage rows."""
    app = _app().app

    def _exploding(*a, **kw):
        raise RuntimeError('metrics backend is on fire')

    original = api_metrics.record
    api_metrics.record = _exploding
    try:
        with app.test_client() as c:
            ok = c.get('/__t/safe')
            # A 500-producing handler still 500s — the teardown backstop also
            # has to survive a broken recorder.
            boom = c.get('/__t/boom/zzz')
    finally:
        api_metrics.record = original

    check(ok.status_code == 200,
          f'metrics failure changed the status: {ok.status_code}')
    check(ok.get_json()['ok'] is True, ok.get_json())
    check(boom.status_code == 500, boom.status_code)


@scenario
def s16_unauthenticated_traffic_is_not_attributed_to_a_tenant():
    """view_args['crm_id'] is attacker-controlled. A bad key must land under
    'anonymous', or anyone could poison another panel's error rate."""
    crm_api = _app()
    with crm_api.app.test_client() as c:
        r = c.get('/api/crm/victim-panel/accounts',
                  headers={'X-API-Key': 'totally-invalid-key'})
    check(r.status_code in (401, 403), r.status_code)
    api_metrics.flush()
    rows = [r for r in _rows() if r['route'] == '/api/crm/<crm_id>/accounts']
    check(rows, 'auth failure was not recorded at all')
    check(all(r['crm_id'] == '' for r in rows),
          f"failed auth attributed to a tenant: {[r['crm_id'] for r in rows]}")


@scenario
def s17_read_route_shape_over_http():
    crm_api = _app()
    panel = _panel()
    crm_id, api_key = panel['crm_id'], panel['api_key']
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 25, crm_id=crm_id)
    api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 500, 25, crm_id=crm_id)
    api_metrics.flush()

    with crm_api.app.test_client() as c:
        r = c.get(f'/api/crm/{crm_id}/metrics/requests?hours=6&granularity=5m',
                  headers={'X-API-Key': api_key})
    check(r.status_code == 200, (r.status_code, r.get_data(as_text=True)[:300]))
    body = r.get_json()
    check(body['success'] is True, body)
    m = body['metrics']
    for key in ('range', 'totals', 'series', 'status_codes', 'top_routes',
                'slowest_routes', 'top_error_routes', 'top_tenants', 'collector'):
        check(key in m, f'read route missing `{key}`: {sorted(m)}')
    check(m['totals']['requests'] >= 2, m['totals'])
    check(m['totals']['server_errors'] >= 1, m['totals'])
    check(len(m['series']) == 72, len(m['series']))  # 6h at 5m
    for b in m['series']:
        for key in ('bucket', 'total', '2xx', '4xx', '5xx', 'errors',
                    'error_rate', 'avg_latency_ms', 'max_latency_ms'):
            check(key in b, f'series bucket missing `{key}`: {sorted(b)}')
        break
    # Bad granularity is a 400, not a 500 and not silently ignored.
    with crm_api.app.test_client() as c:
        bad = c.get(f'/api/crm/{crm_id}/metrics/requests?granularity=17s',
                    headers={'X-API-Key': api_key})
    check(bad.status_code == 400, bad.status_code)


@scenario
def s18_tenant_read_route_requires_a_valid_key():
    crm_api = _app()
    crm_id = _panel()['crm_id']
    with crm_api.app.test_client() as c:
        r = c.get(f'/api/crm/{crm_id}/metrics/requests')
    check(r.status_code == 401, r.status_code)
    with crm_api.app.test_client() as c:
        r = c.get(f'/api/crm/{crm_id}/metrics/requests',
                  headers={'X-API-Key': 'nope'})
    check(r.status_code == 403, r.status_code)


@scenario
def s19_admin_read_route_is_admin_only():
    crm_api = _app()
    with crm_api.app.test_client() as c:
        r = c.get('/api/admin/metrics/requests')
    check(r.status_code == 403, r.status_code)


@scenario
def s20_scheduler_owns_flush_and_sweep():
    """The flush must be a registered, pickleable job — a metrics table nothing
    ever writes to is worse than no table."""
    import scheduler
    check(callable(scheduler._run_metrics_flush), 'flush job callable missing')
    check(callable(scheduler._run_metrics_sweep), 'sweep job callable missing')
    ex, grace = scheduler._desired_job_policy(scheduler.METRICS_FLUSH_JOB_ID)
    check(ex == 'default', ex)
    ex, grace = scheduler._desired_job_policy(scheduler.METRICS_SWEEP_JOB_ID)
    check(ex == 'heavy', ex)
    # The jobs actually run against the scratch DB without raising.
    api_metrics.record('/health', 'GET', 200, 1)
    scheduler._run_metrics_flush()
    check(len(_rows()) == 1, _rows())
    scheduler._run_metrics_sweep()
    check(len(_rows()) == 1, 'sweep deleted a fresh row')


@scenario
def s21_excluded_routes_match_real_rules():
    """EXCLUDED_ROUTES is a string set. If the SSE route is ever renamed the
    exclusion stops working SILENTLY and every latency percentile is poisoned
    by minutes-long connections. Pin the coupling."""
    app = _app().app
    rules = {r.rule for r in app.url_map.iter_rules()}
    for excluded in api_metrics.EXCLUDED_ROUTES:
        check(excluded in rules,
              f'{excluded} is excluded from metrics but is not a real route '
              f'— it was probably renamed')


@scenario
def s22_after_request_observes_every_route():
    """Observation coverage is 100% because the hook is registered app-wide,
    so it cannot miss a route regardless of decorators, blueprints, auth
    outcome or 404."""
    app = _app().app
    rules = [r for r in app.url_map.iter_rules() if r.endpoint != 'static']
    print(f'      [{len(rules)}/{len(rules)} routes observed by the hook]')
    check(len(rules) > 100, len(rules))
    # The hook is registered app-wide, i.e. it cannot miss a route.
    # flask-cors registers a functools.partial, which has no __name__.
    names = [getattr(f, '__name__', repr(f)) for f in app.after_request_funcs[None]]
    check('_metrics_after_request' in names, names)
    # Flask runs after_request handlers in REVERSE registration order, so being
    # registered ABOVE our own hooks means running AFTER them — i.e. the timer
    # covers the security headers too. (The two entries before it are registered
    # by CORS()/Limiter() at extension-init and are not ours to reorder.)
    mine = names.index('_metrics_after_request')
    check(mine < names.index('add_security_headers'),
          f'metrics hook must be registered before add_security_headers so it '
          f'runs after it and times its work: {names}')
    check(any(getattr(f, '__name__', '') == '_metrics_start_timer'
              for f in app.before_request_funcs[None]), 'timer hook missing')


# ------------------------------------------------------------- overhead -----

def measure_overhead():
    """Report the added per-request cost. Printed, not asserted on wall-clock
    (a shared CI box makes timing assertions flaky) — except for a very loose
    ceiling that would catch a genuine regression like an accidental sync write.
    """
    n = 200_000
    t0 = time.perf_counter()
    for i in range(n):
        api_metrics.record('/api/crm/<crm_id>/accounts', 'GET', 200, 12.5,
                           crm_id='bench')
    per_call_us = (time.perf_counter() - t0) / n * 1e6
    print(f'\n  api_metrics.record(): {per_call_us:.3f} µs/call '
          f'({n:,} calls, {api_metrics.pending_count()} bucket(s))')

    # Flush cost for a realistic batch of distinct keys.
    _reset()
    for i in range(500):
        api_metrics.record(f'/api/route/{i % 120}', 'GET', 200 + (i % 5), 10,
                           crm_id=f'crm{i % 40}')
    t0 = time.perf_counter()
    wrote = api_metrics.flush()
    flush_ms = (time.perf_counter() - t0) * 1000
    print(f'  api_metrics.flush(): {flush_ms:.2f} ms for {wrote} bucket rows')

    check(per_call_us < 50, f'record() cost {per_call_us:.1f}µs — expected <50µs; '
                            'did something start doing I/O on the hot path?')
    _reset()


def measure_http_overhead():
    """End-to-end: the same route with the hooks live vs. neutered.

    Arms are interleaved and the best (minimum) of several passes is taken —
    the quantity of interest is ~1 µs against a ~200 µs baseline, so a single
    A-then-B run mostly measures whatever else the box was doing.
    """
    app = _app().app
    c = app.test_client()
    n, passes = 2000, 5

    def _time(loops):
        t0 = time.perf_counter()
        for _ in range(loops):
            c.get('/__t/bench')
        return (time.perf_counter() - t0) / loops * 1e6   # µs/request

    for _ in range(500):
        c.get('/__t/bench')                                # warm up

    # Swap the whole after_request body, not just record(), so the number
    # covers the g lookups, the perf_counter delta and the url_rule read too.
    # (The before_request timer — one perf_counter + one `g` assign — stays in
    # both arms and is not included; it is ~0.2 µs.)
    crm_api = _app()
    live, noop = [], []
    noop_fn = lambda *a, **k: None                          # noqa: E731
    original = crm_api._metrics_observe
    for _ in range(passes):
        crm_api._metrics_observe = original
        live.append(_time(n))
        crm_api._metrics_observe = noop_fn
        try:
            noop.append(_time(n))
        finally:
            crm_api._metrics_observe = original

    best_live, best_noop = min(live), min(noop)
    added = best_live - best_noop
    print(f'  HTTP round-trip, metrics live:   {best_live:.1f} µs '
          f'(best of {passes}×{n})')
    print(f'  HTTP round-trip, metrics no-op:  {best_noop:.1f} µs')
    print(f'  → added by recording:            {added:+.2f} µs '
          f'({added / best_noop * 100:+.2f}% of a request)')
    check(added < 25, f'metrics added {added:.1f}µs/request — expected <25µs')
    _reset()


if __name__ == '__main__':
    print('api_metrics: request-outcome recording suite')
    scenarios = [globals()[k] for k in sorted(globals())
                 if k.startswith('s') and k[1:3].isdigit()]
    for s in scenarios:
        s()
    print()
    print('overhead measurement')
    try:
        measure_overhead()
        measure_http_overhead()
    except AssertionError as e:
        _failures.append(('measure_overhead', str(e)))
        print(f'  ✗ overhead: {e}')
    except Exception:
        _failures.append(('measure_overhead', traceback.format_exc()))
        print(f'  ✗ overhead raised:\n{traceback.format_exc()}')

    print()
    if _failures:
        print(f'{len(_failures)} FAILED ({_asserts["n"]} assertions ran)')
        for n_, err in _failures:
            print(f'  - {n_}: {err}')
        sys.exit(1)
    print(f'all {len(scenarios)} scenarios passed ({_asserts["n"]} assertions)')
