#!/usr/bin/env python3
"""Request-outcome metrics: what the API actually *did*, not just how often.

## Why this exists

Counters that increment *before* a handler runs cannot tell a 500 from a 200,
and record no latency at all. "Are there any API failures?" is unanswerable from
them.

So this module observes the *response* instead, in an after_request hook.
Nothing here can change a request's outcome or fail it.

## Why aggregation instead of a row per request

One synchronous INSERT per request against a 1.5 GB SQLite file, from a single
gunicorn worker with 32 threads, is a write lock every thread has to queue for —
on the same file that serves every read and every poll cursor write. At a few
hundred requests/second that is the dominant cost of the request.

Instead requests fold into an in-process dict keyed on
`(bucket_start, crm_id, route, method, status_code)`. The hot path is a tuple
build, one dict lookup and four integer adds under a short-lived lock — ~1 µs,
no I/O, no SQLite. A periodic `flush()` (owned by the scheduler, see
`scheduler.METRICS_FLUSH_JOB_ID`) writes the accumulated buckets in one
`executemany` upsert. Write volume becomes O(distinct keys per flush) instead of
O(requests), which is what makes this affordable at 600 accounts.

The cost is granularity — you cannot ask "show me request #4,182" — and a
bounded loss window: a hard kill loses at most one flush interval of counters.
Both are the right trade for an operational dashboard. `atexit` covers the
graceful case.

## Cardinality

`route` is ALWAYS `request.url_rule.rule` — the pattern
(`/api/crm/<crm_id>/accounts`), never the substituted path. Storing the concrete
path would make the key set unbounded (one per tenant per account per fan id)
and would put tenant ids inside a metrics table for no gain: the tenant is
already its own column.

`api_key_id` is deliberately NOT part of the key. Per-key attribution already
exists in `api_key_usage` / `api_key_endpoint_usage`; adding it here would
multiply every bucket by the number of live keys on a panel to answer a question
nobody asked.

## Fail-open

Everything public is wrapped. A metrics failure must never 500 a real API call —
a metrics write is never worth an API error.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ---- tunables ---------------------------------------------------------------

# Storage bucket width. 5 minutes is the finest granularity any chart in the
# dashboard asks for, and it keeps the row count sane: rows/day is
# (distinct route/status/tenant combos actually seen) × 288, not × 86400.
BUCKET_SECONDS = int(os.environ.get('API_METRICS_BUCKET_SECONDS', 300))

# A request slower than this counts as "slow". Aggregates cannot give a true
# p95, so this is the cheap honest substitute: a count of requests over a fixed
# line, which is chartable and comparable across buckets.
SLOW_MS = int(os.environ.get('API_METRICS_SLOW_MS', 1000))

# How long a bucket row survives before the sweeper deletes it. This table grows
# without bound otherwise, on the same file that already holds 1.5 GB of cache.
RETENTION_DAYS = int(os.environ.get('API_METRICS_RETENTION_DAYS', 30))

# Hard ceiling on unflushed keys. Only reachable if the flush job is dead (or a
# pathological 404-scan invents route patterns, which it cannot — unmatched
# requests all fold into one route). Past the ceiling we drop and count the
# drops, so the failure is visible in the read route instead of being an OOM.
MAX_PENDING_BUCKETS = int(os.environ.get('API_METRICS_MAX_PENDING', 20000))

# Off switch, in case this ever needs to be disabled without a deploy.
ENABLED = os.environ.get('API_METRICS_ENABLED', '1') not in ('0', 'false', 'no')

# Route patterns never recorded. SSE holds one connection open for minutes at a
# time; `after_request` fires at response construction so it would land in the
# table as a fast request anyway, but recording a long-lived stream as a normal
# request is misleading either way — it inflates the request count with
# connections rather than calls. Excluded explicitly so the intent is readable.
EXCLUDED_ROUTES = {
    '/api/crm/<crm_id>/events/stream',
}

# Route recorded when no rule matched (404s, probe traffic, scanners). One
# bounded key rather than one per invented path.
UNMATCHED_ROUTE = '<unmatched>'

# ---- in-process accumulator -------------------------------------------------

# {(bucket_start_epoch, crm_id, route, method, status_code):
#     [req_count, latency_ms_sum, latency_ms_max, slow_count]}
_pending: dict[tuple, list] = {}
_lock = threading.Lock()
_stats = {
    'dropped': 0,          # records refused because the accumulator was full
    'recorded': 0,         # requests folded in since process start
    'flushed_rows': 0,     # bucket rows written since process start
    'last_flush_at': None,
    'last_flush_error': None,
}


def _db_file() -> str:
    """Resolved at call time, not import time: tests point `crm_database.DB_FILE`
    at a scratch file after import, and this must follow them there."""
    import crm_database as _db
    return _db.DB_FILE


def _bucket_start(ts: float) -> int:
    return int(ts) - (int(ts) % BUCKET_SECONDS)


def status_class(status_code: int) -> str:
    """'2xx' / '4xx' / … — the bucket a chart legend wants."""
    try:
        return f'{int(status_code) // 100}xx'
    except (TypeError, ValueError):
        return 'unknown'


# ---- recording (hot path) ---------------------------------------------------

def record(route, method, status_code, latency_ms, crm_id=None, now=None):
    """Fold one request outcome into the accumulator.

    No I/O. Never raises — the caller is an `after_request` hook on a live API.
    """
    if not ENABLED:
        return
    try:
        if route is None:
            route = UNMATCHED_ROUTE
        elif not isinstance(route, str):
            # Only ever reached if a caller passes something that isn't a
            # url_rule. Refuse rather than str() it: repr'd objects carry
            # per-instance addresses, which would be an unbounded key space —
            # and an unbindable value would fail the whole flush batch, not
            # just this row.
            return
        if route in EXCLUDED_ROUTES:
            return
        key = (
            _bucket_start(now if now is not None else time.time()),
            str(crm_id or '')[:64],
            route[:200],
            str(method or 'GET').upper()[:10],
            int(status_code),
        )
        ms = int(latency_ms) if latency_ms and latency_ms > 0 else 0
        slow = 1 if ms >= SLOW_MS else 0
        with _lock:
            cell = _pending.get(key)
            if cell is None:
                if len(_pending) >= MAX_PENDING_BUCKETS:
                    _stats['dropped'] += 1
                    return
                _pending[key] = [1, ms, ms, slow]
            else:
                cell[0] += 1
                cell[1] += ms
                if ms > cell[2]:
                    cell[2] = ms
                cell[3] += slow
            _stats['recorded'] += 1
    except Exception:
        # Fail-open, silently. A metrics bug must not be able to take the API
        # down, and logging here would be one log line per request.
        pass


def pending_count() -> int:
    with _lock:
        return len(_pending)


def stats() -> dict:
    with _lock:
        out = dict(_stats)
        out['pending_buckets'] = len(_pending)
        out['pending_requests'] = sum(c[0] for c in _pending.values())
    out['bucket_seconds'] = BUCKET_SECONDS
    out['slow_ms'] = SLOW_MS
    out['retention_days'] = RETENTION_DAYS
    out['enabled'] = ENABLED
    return out


# ---- persistence ------------------------------------------------------------

# `bucket_start` leads the primary key on purpose: every read is a time range
# and every sweep is a time cutoff, so the PK index alone serves both — no
# separate index on bucket_start is needed (it would be a pure write tax).
#
# WITHOUT ROWID because this is exactly the shape SQLite recommends it for: a
# narrow row whose natural composite key IS the row, and no need for a rowid.
# It folds the table into the PK btree instead of storing the data once and the
# unique PK index again beside it. Measured on a primed 1.04M-row table (a full
# 30-day window at a pessimistic 240 distinct keys per 5-minute bucket): 83 MB
# / 80 bytes per row, against 197 MB with a rowid table and a redundant
# bucket_start index. This shares a file with 1.5 GB of cache — worth one
# keyword. Lower API_METRICS_RETENTION_DAYS if even that is too much.
_SCHEMA = '''
    CREATE TABLE IF NOT EXISTS api_request_metrics (
        bucket_start INTEGER NOT NULL,
        crm_id TEXT NOT NULL DEFAULT '',
        route TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        req_count INTEGER NOT NULL DEFAULT 0,
        latency_ms_sum INTEGER NOT NULL DEFAULT 0,
        latency_ms_max INTEGER NOT NULL DEFAULT 0,
        slow_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (bucket_start, crm_id, route, method, status_code)
    ) WITHOUT ROWID
'''

# Only the tenant-scoped read needs its own index — it filters on crm_id first,
# which the PK cannot serve.
_INDEXES = (
    'CREATE INDEX IF NOT EXISTS idx_api_request_metrics_crm '
    'ON api_request_metrics(crm_id, bucket_start)',
)


def ensure_schema(cursor=None):
    """Create the table + indexes. Idempotent.

    Called from `crm_database.init_database()` (house rule: every table is
    declared there) and again lazily on first flush, so this module still works
    standalone if it is ever imported before the schema is created.
    """
    if cursor is not None:
        cursor.execute(_SCHEMA)
        for sql in _INDEXES:
            cursor.execute(sql)
        return
    conn = sqlite3.connect(_db_file())
    try:
        cur = conn.cursor()
        cur.execute(_SCHEMA)
        for sql in _INDEXES:
            cur.execute(sql)
        conn.commit()
    finally:
        conn.close()


_UPSERT = '''
    INSERT INTO api_request_metrics
        (bucket_start, crm_id, route, method, status_code,
         req_count, latency_ms_sum, latency_ms_max, slow_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bucket_start, crm_id, route, method, status_code) DO UPDATE SET
        req_count      = api_request_metrics.req_count + excluded.req_count,
        latency_ms_sum = api_request_metrics.latency_ms_sum + excluded.latency_ms_sum,
        latency_ms_max = MAX(api_request_metrics.latency_ms_max, excluded.latency_ms_max),
        slow_count     = api_request_metrics.slow_count + excluded.slow_count
'''

_schema_ready = False


def flush() -> int:
    """Write the accumulator to SQLite in one transaction. Returns rows written.

    Swap-then-write: the dict is replaced under the lock so recording threads
    are never blocked on I/O. If the write fails the batch is folded back in so
    the next flush retries it rather than silently losing counters.
    """
    global _schema_ready
    if not ENABLED:
        return 0
    with _lock:
        if not _pending:
            return 0
        # Copy-then-clear, NOT `batch = _pending`: that would alias the same
        # dict and `.clear()` would empty the batch we are about to write.
        batch = dict(_pending)
        _pending.clear()
    rows = [(k[0], k[1], k[2], k[3], k[4], v[0], v[1], v[2], v[3])
            for k, v in batch.items()]
    try:
        if not _schema_ready:
            ensure_schema()
            _schema_ready = True
        conn = sqlite3.connect(_db_file(), timeout=30)
        try:
            conn.executemany(_UPSERT, rows)
            conn.commit()
        finally:
            conn.close()
        with _lock:
            _stats['flushed_rows'] += len(rows)
            _stats['last_flush_at'] = _iso(time.time())
            _stats['last_flush_error'] = None
        return len(rows)
    except Exception as e:
        # Put the batch back so nothing is lost to a transient lock. Merge
        # rather than assign — requests kept arriving while we were writing.
        with _lock:
            for k, v in batch.items():
                cell = _pending.get(k)
                if cell is None:
                    if len(_pending) < MAX_PENDING_BUCKETS:
                        _pending[k] = v
                    else:
                        _stats['dropped'] += 1
                else:
                    cell[0] += v[0]
                    cell[1] += v[1]
                    cell[2] = max(cell[2], v[2])
                    cell[3] += v[3]
            _stats['last_flush_error'] = str(e)[:200]
        logger.warning('api_metrics flush failed (%d buckets requeued): %s',
                       len(rows), e)
        return 0


def sweep(retention_days: int = None) -> int:
    """Delete bucket rows older than the retention window. Returns rows deleted."""
    days = RETENTION_DAYS if retention_days is None else retention_days
    cutoff = _bucket_start(time.time() - days * 86400)
    try:
        conn = sqlite3.connect(_db_file(), timeout=30)
        try:
            ensure_schema(conn.cursor())
            cur = conn.execute(
                'DELETE FROM api_request_metrics WHERE bucket_start < ?', (cutoff,))
            deleted = cur.rowcount or 0
            conn.commit()
        finally:
            conn.close()
        if deleted:
            logger.info('api_metrics: swept %d bucket row(s) older than %d days',
                        deleted, days)
        return deleted
    except Exception:
        logger.exception('api_metrics retention sweep failed')
        return 0


# ---- read side --------------------------------------------------------------

def _iso(epoch) -> str:
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).strftime(
        '%Y-%m-%dT%H:%M:%S+00:00')


# Granularities the read route accepts. Anything finer than BUCKET_SECONDS is
# impossible (the storage bucket is the floor) and anything unbounded would let
# a caller ask for 700 days at 5-minute resolution.
GRANULARITIES = {
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '6h': 21600,
    '1d': 86400,
}


def default_granularity(hours: int) -> str:
    if hours <= 6:
        return '5m'
    if hours <= 48:
        return '1h'
    if hours <= 24 * 14:
        return '6h'
    return '1d'


def _rate(numerator, denominator):
    return round(numerator / denominator, 6) if denominator else 0.0


def _route_row(r):
    reqs = r['reqs'] or 0
    errs = r['errs'] or 0
    return {
        'route': r['route'],
        'method': r['method'],
        'requests': reqs,
        'errors': errs,
        'client_errors': (r['client_errs'] or 0),
        'server_errors': (r['server_errs'] or 0),
        'error_rate': _rate(errs, reqs),
        'avg_latency_ms': round((r['lat_sum'] or 0) / reqs, 1) if reqs else None,
        'max_latency_ms': r['lat_max'] or 0,
        'slow_requests': r['slow'] or 0,
    }


def query(hours: int = 24, granularity: str = None, crm_id: str = None,
          limit: int = 10, now: float = None) -> dict:
    """Chart-ready aggregate over the last `hours`.

    Zero-filled series, so a chart can bind straight to it without gap
    handling. See the module docstring
    in `crm_api.api_metrics_route` for the JSON contract.
    """
    now = time.time() if now is None else now
    granularity = granularity if granularity in GRANULARITIES else default_granularity(hours)
    step = GRANULARITIES[granularity]
    # Align both ends to the granularity so the last bucket is a whole one and
    # the series doesn't shift under the caller between polls.
    until = (int(now) // step) * step + step
    since = until - hours * 3600
    since -= since % step

    where = 'bucket_start >= ? AND bucket_start < ?'
    params = [since, until]
    if crm_id:
        where += ' AND crm_id = ?'
        params.append(crm_id)

    conn = sqlite3.connect(_db_file(), timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        ensure_schema(conn.cursor())
        series_rows = conn.execute(
            f'''SELECT (bucket_start / ?) * ? AS b,
                       status_code / 100 AS klass,
                       SUM(req_count)      AS reqs,
                       SUM(latency_ms_sum) AS lat_sum,
                       MAX(latency_ms_max) AS lat_max,
                       SUM(slow_count)     AS slow
                FROM api_request_metrics
                WHERE {where}
                GROUP BY b, klass''',
            [step, step] + params,
        ).fetchall()
        route_rows = conn.execute(
            f'''SELECT route, method,
                       SUM(req_count) AS reqs,
                       SUM(CASE WHEN status_code >= 400 THEN req_count ELSE 0 END) AS errs,
                       SUM(CASE WHEN status_code BETWEEN 400 AND 499 THEN req_count ELSE 0 END) AS client_errs,
                       SUM(CASE WHEN status_code >= 500 THEN req_count ELSE 0 END) AS server_errs,
                       SUM(latency_ms_sum) AS lat_sum,
                       MAX(latency_ms_max) AS lat_max,
                       SUM(slow_count) AS slow
                FROM api_request_metrics
                WHERE {where}
                GROUP BY route, method''',
            params,
        ).fetchall()
        code_rows = conn.execute(
            f'''SELECT status_code, SUM(req_count) AS reqs
                FROM api_request_metrics
                WHERE {where}
                GROUP BY status_code
                ORDER BY reqs DESC''',
            params,
        ).fetchall()
        tenant_rows = conn.execute(
            f'''SELECT crm_id,
                       SUM(req_count) AS reqs,
                       SUM(CASE WHEN status_code >= 400 THEN req_count ELSE 0 END) AS errs,
                       SUM(CASE WHEN status_code >= 500 THEN req_count ELSE 0 END) AS server_errs
                FROM api_request_metrics
                WHERE {where}
                GROUP BY crm_id
                ORDER BY reqs DESC
                LIMIT ?''',
            params + [limit],
        ).fetchall() if not crm_id else []
    finally:
        conn.close()

    # ---- zero-filled series ----
    by_bucket = {}
    for r in series_rows:
        b = int(r['b'])
        slot = by_bucket.setdefault(b, {'lat_sum': 0, 'lat_max': 0, 'slow': 0})
        cls = f"{r['klass']}xx" if r['klass'] in (1, 2, 3, 4, 5) else 'other'
        slot[cls] = slot.get(cls, 0) + (r['reqs'] or 0)
        slot['lat_sum'] += (r['lat_sum'] or 0)
        slot['lat_max'] = max(slot['lat_max'], r['lat_max'] or 0)
        slot['slow'] += (r['slow'] or 0)

    series = []
    b = since
    while b < until:
        slot = by_bucket.get(b)
        if slot:
            total = sum(v for k, v in slot.items()
                        if k not in ('lat_sum', 'lat_max', 'slow'))
            errors = slot.get('4xx', 0) + slot.get('5xx', 0)
            series.append({
                'bucket': _iso(b),
                'total': total,
                '1xx': slot.get('1xx', 0),
                '2xx': slot.get('2xx', 0),
                '3xx': slot.get('3xx', 0),
                '4xx': slot.get('4xx', 0),
                '5xx': slot.get('5xx', 0),
                'errors': errors,
                'error_rate': _rate(errors, total),
                'avg_latency_ms': round(slot['lat_sum'] / total, 1) if total else None,
                'max_latency_ms': slot['lat_max'],
                'slow_requests': slot['slow'],
            })
        else:
            series.append({
                'bucket': _iso(b), 'total': 0,
                '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0,
                'errors': 0, 'error_rate': 0.0,
                'avg_latency_ms': None, 'max_latency_ms': 0, 'slow_requests': 0,
            })
        b += step

    # ---- route rollups ----
    routes = [_route_row(r) for r in route_rows]
    total_reqs = sum(r['requests'] for r in routes)
    total_errs = sum(r['errors'] for r in routes)
    total_client = sum(r['client_errors'] for r in routes)
    total_server = sum(r['server_errors'] for r in routes)
    total_slow = sum(r['slow_requests'] for r in routes)
    total_lat = sum((r['avg_latency_ms'] or 0) * r['requests'] for r in routes)

    return {
        'range': {
            'since': _iso(since),
            'until': _iso(until),
            'hours': hours,
            'granularity': granularity,
            'bucket_seconds': step,
            'buckets': len(series),
            'crm_id': crm_id or None,
        },
        'totals': {
            'requests': total_reqs,
            'errors': total_errs,
            'client_errors': total_client,
            'server_errors': total_server,
            'error_rate': _rate(total_errs, total_reqs),
            'server_error_rate': _rate(total_server, total_reqs),
            'avg_latency_ms': round(total_lat / total_reqs, 1) if total_reqs else None,
            'max_latency_ms': max([r['max_latency_ms'] for r in routes], default=0),
            'slow_requests': total_slow,
            'slow_rate': _rate(total_slow, total_reqs),
            'slow_threshold_ms': SLOW_MS,
        },
        'series': series,
        'status_codes': [
            {'status': r['status_code'],
             'status_class': status_class(r['status_code']),
             'count': r['reqs'] or 0}
            for r in code_rows
        ],
        'top_routes': sorted(routes, key=lambda r: -r['requests'])[:limit],
        'slowest_routes': sorted(
            [r for r in routes if r['avg_latency_ms'] is not None],
            key=lambda r: -r['avg_latency_ms'])[:limit],
        'top_error_routes': sorted(
            [r for r in routes if r['errors'] > 0],
            key=lambda r: (-r['errors'], -r['error_rate']))[:limit],
        'top_tenants': [
            {'crm_id': r['crm_id'] or None,
             'requests': r['reqs'] or 0,
             'errors': r['errs'] or 0,
             'server_errors': r['server_errs'] or 0,
             'error_rate': _rate(r['errs'] or 0, r['reqs'] or 0)}
            for r in tenant_rows
        ],
        'collector': stats(),
    }


# Graceful shutdown: don't lose the current window's counters to a restart.
# (A hard kill still loses up to one flush interval — see module docstring.)
import atexit as _atexit
_atexit.register(lambda: flush())
