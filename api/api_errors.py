"""Recent failed requests, with enough detail to act on.

`api_metrics` answers "how many failed"; it stores counters only, so it can
never answer "what happened". This module keeps the other half: a bounded log
of individual failures with the response body, so an operator can look at the
actual error, copy it, and send it to us.

Deliberately separate from api_metrics rather than bolted onto it. Metrics are
an aggregate written once a minute from an in-process accumulator; these are
individual rows with a payload, and mixing the two would either make the
metrics table wide and sparse or force per-request writes on the counter path.

Retention is both time- and count-bounded. A panel in a redirect loop can
generate thousands of identical failures in a minute, and the useful signal is
"this is happening", not the ten-thousandth copy of it.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone

# Keep at most this many rows per panel. The read path shows far fewer; the
# cap exists so one broken integration cannot crowd out every other panel's
# history before the time-based sweep runs.
MAX_ROWS_PER_PANEL = int(os.environ.get('API_ERROR_LOG_MAX_PER_PANEL', 500))
RETENTION_DAYS = int(os.environ.get('API_ERROR_LOG_RETENTION_DAYS', 14))
BODY_LIMIT = int(os.environ.get('API_ERROR_LOG_BODY_LIMIT', 4000))
ENABLED = os.environ.get('API_ERROR_LOG_ENABLED', 'true').lower() != 'false'

_lock = threading.Lock()

SCHEMA = '''
    CREATE TABLE IF NOT EXISTS api_error_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crm_id TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        route TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT,
        status_code INTEGER NOT NULL,
        latency_ms INTEGER,
        error_code TEXT,
        message TEXT,
        body TEXT,
        of_user_id TEXT,
        reported_at TEXT,
        report_note TEXT
    )
'''

INDEXES = (
    'CREATE INDEX IF NOT EXISTS idx_api_error_panel_time '
    '  ON api_error_log(crm_id, id DESC)',
)


def _db_path():
    import crm_database as _db
    return _db.DB_FILE


def init(cursor) -> None:
    """Called from crm_database.init_database — house rule is that every table
    is declared there, even when its behaviour lives in its own module."""
    cursor.execute(SCHEMA)
    for stmt in INDEXES:
        cursor.execute(stmt)


# ── write ────────────────────────────────────────────────────────────────────

def _extract(body_text: str):
    """Pull a machine code and a human message out of an error body.

    Our own errors are JSON with `error` and sometimes `code`; upstream ones
    passed through can be anything. Returns (code, message) with either side
    possibly None — a body we cannot parse is still worth storing verbatim.
    """
    if not body_text:
        return None, None
    try:
        data = json.loads(body_text)
    except Exception:
        return None, body_text.strip()[:300] or None
    if not isinstance(data, dict):
        return None, None
    code = data.get('code') or data.get('error_code')
    msg = data.get('error') or data.get('message') or data.get('detail')
    if isinstance(msg, dict):
        code = code or msg.get('code')
        msg = msg.get('message') or json.dumps(msg)[:300]
    return (str(code) if code is not None else None,
            str(msg)[:500] if msg is not None else None)


def record(*, crm_id, route, method, path, status_code, latency_ms,
           body_text, of_user_id=None) -> None:
    """Store one failed request. Fail-open: never raises into the request."""
    if not ENABLED:
        return
    try:
        body = (body_text or '')[:BODY_LIMIT]
        code, message = _extract(body)
        now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        conn = sqlite3.connect(_db_path(), timeout=5)
        try:
            conn.execute(
                'INSERT INTO api_error_log (crm_id, occurred_at, route, method, '
                'path, status_code, latency_ms, error_code, message, body, '
                'of_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (crm_id or '', now, route, method, path, int(status_code),
                 int(latency_ms or 0), code, message, body, of_user_id),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def sweep() -> int:
    """Drop rows past the retention window, then trim any panel over its cap.

    Reported rows are kept regardless of age until the cap forces them out —
    if someone told us about a problem, the evidence should outlive the default
    window while we look at it.
    """
    removed = 0
    try:
        conn = sqlite3.connect(_db_path(), timeout=10)
        try:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM api_error_log WHERE reported_at IS NULL AND "
                "occurred_at < datetime('now', ?)", (f'-{RETENTION_DAYS} days',))
            removed += cur.rowcount or 0
            cur.execute('SELECT crm_id, COUNT(*) c FROM api_error_log '
                        'GROUP BY crm_id HAVING c > ?', (MAX_ROWS_PER_PANEL,))
            for crm_id, _count in cur.fetchall():
                cur.execute(
                    'DELETE FROM api_error_log WHERE crm_id = ? AND id NOT IN ('
                    '  SELECT id FROM api_error_log WHERE crm_id = ? '
                    '  ORDER BY id DESC LIMIT ?)',
                    (crm_id, crm_id, MAX_ROWS_PER_PANEL))
                removed += cur.rowcount or 0
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f'[api_errors] sweep failed: {e}', flush=True)
    return removed


# ── read ─────────────────────────────────────────────────────────────────────

def recent(crm_id, limit=50, status_class=None):
    """Most recent failures for a panel, newest first."""
    limit = max(1, min(int(limit or 50), 200))
    sql = ('SELECT id, occurred_at, route, method, path, status_code, '
           'latency_ms, error_code, message, body, of_user_id, reported_at, '
           'report_note FROM api_error_log WHERE crm_id = ?')
    args = [crm_id]
    if status_class in ('4xx', '5xx'):
        lo = 400 if status_class == '4xx' else 500
        sql += ' AND status_code >= ? AND status_code < ?'
        args += [lo, lo + 100]
    sql += ' ORDER BY id DESC LIMIT ?'
    args.append(limit)
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()
    for r in rows:
        r['reported'] = bool(r.pop('reported_at', None))
    return rows


def get(crm_id, error_id):
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            'SELECT * FROM api_error_log WHERE id = ? AND crm_id = ?',
            (int(error_id), crm_id)).fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def mark_reported(crm_id, error_id, note=None) -> bool:
    conn = sqlite3.connect(_db_path(), timeout=5)
    try:
        cur = conn.execute(
            "UPDATE api_error_log SET reported_at = datetime('now'), "
            "report_note = ? WHERE id = ? AND crm_id = ?",
            (str(note)[:500] if note else None, int(error_id), crm_id))
        conn.commit()
        return (cur.rowcount or 0) > 0
    finally:
        conn.close()
