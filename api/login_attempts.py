"""Every account-connect attempt, kept for backend debugging.

When a customer says "my account won't connect", there is otherwise nothing to
look at: a failed login (wrong password, blocked proxy, transport error) writes
no `of_accounts` row and no log, so support has to go back and forth with the
customer to reproduce it. This module records every attempt — the submitted
identifier, an ENCRYPTED copy of the password/cookies, the proxy, and the
outcome — so an operator can inspect it and re-test the account server-side
without involving the customer.

This is an internal debugging store, visible only through the admin surface
(`_require_admin`). It is deliberately NOT surfaced to the customer, and it is
deliberately NOT auto-expired: unlike the 2FA-session and import-secret stores
(which zero credentials fast on purpose), retention here is indefinite so a
recurring connection problem can be diagnosed weeks later. That is an explicit
operator decision — see the plan/ACCOUNT_SECURITY notes.

Passwords and cookies are encrypted at rest with the same Fernet helper the
rest of the app uses (`crm_database.encrypt_password`). The proxy is stored in
full (it is needed to re-run the login) and masked by the read path unless a
super-admin explicitly reveals it.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime, timezone

ENABLED = os.environ.get('LOGIN_ATTEMPTS_ENABLED', 'true').lower() != 'false'

_lock = threading.Lock()

SCHEMA = '''
    CREATE TABLE IF NOT EXISTS login_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempted_at TEXT NOT NULL,
        finished_at TEXT,
        latency_ms INTEGER,
        crm_id TEXT NOT NULL DEFAULT '',
        owner_email TEXT,
        platform TEXT,
        identifier TEXT,
        encrypted_password TEXT,
        encrypted_cookies TEXT,
        proxy TEXT,
        source TEXT NOT NULL DEFAULT 'connect',
        outcome TEXT,
        reason_code TEXT,
        http_status INTEGER,
        error_message TEXT,
        blocked_ip TEXT,
        ray_id TEXT,
        resolved_user_id TEXT
    )
'''

INDEXES = (
    'CREATE INDEX IF NOT EXISTS idx_login_attempts_time '
    '  ON login_attempts(id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_login_attempts_panel '
    '  ON login_attempts(crm_id, id DESC)',
    'CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier '
    '  ON login_attempts(identifier, id DESC)',
)


def _db_path():
    import crm_database as _db
    return _db.DB_FILE


def init(cursor) -> None:
    """Declared from crm_database.init_database (house rule: every table lives
    there), same as api_errors.init."""
    cursor.execute(SCHEMA)
    for stmt in INDEXES:
        cursor.execute(stmt)


# ── crypto helpers (reuse the app-wide Fernet) ───────────────────────────────

def _encrypt(value):
    if not value:
        return None
    import crm_database as _db
    return _db.encrypt_password(value)


def _decrypt(value):
    if not value:
        return None
    import crm_database as _db
    return _db.decrypt_password(value)


def _now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')


# ── write ────────────────────────────────────────────────────────────────────

def record_start(*, crm_id, owner_email=None, platform=None, identifier=None,
                 password=None, proxy=None, cookies=None,
                 source='connect'):
    """Insert a 'started' attempt row and return its id (or None).

    Fail-open: any error is swallowed and returns None so a logging problem can
    never break a login. `cookies` may be a dict (cookie/token connect) — it is
    JSON-encoded then encrypted.
    """
    if not ENABLED:
        return None
    try:
        cookie_blob = None
        if cookies:
            try:
                cookie_blob = json.dumps(cookies) if not isinstance(cookies, str) else cookies
            except Exception:
                cookie_blob = None
        conn = sqlite3.connect(_db_path(), timeout=5)
        try:
            cur = conn.execute(
                'INSERT INTO login_attempts (attempted_at, crm_id, owner_email, '
                'platform, identifier, encrypted_password, encrypted_cookies, '
                'proxy, source, outcome) '
                'VALUES (?,?,?,?,?,?,?,?,?,?)',
                (_now(), crm_id or '', owner_email, platform, identifier,
                 _encrypt(password), _encrypt(cookie_blob), proxy, source,
                 'started'))
            conn.commit()
            return cur.lastrowid
        finally:
            conn.close()
    except Exception:
        return None


def _classify(http_status, body):
    """(outcome, reason_code, error_message, blocked_ip, ray_id, resolved_user_id)
    from a connect route's JSON response body + status."""
    body = body if isinstance(body, dict) else {}
    reason = body.get('reason') or body.get('connection_state') or body.get('code')
    error = body.get('error')
    blocked_ip = body.get('blocked_ip')
    ray_id = body.get('ray_id')
    user_id = body.get('of_user_id') or body.get('user_id')

    if body.get('success') is True or (http_status == 200 and body.get('success') is not False
                                       and not body.get('requires_2fa')
                                       and not body.get('requires_verification')
                                       and not body.get('needs_verification')):
        outcome = 'connected'
    elif body.get('requires_2fa'):
        outcome = 'needs_2fa'
    elif body.get('requires_verification') or body.get('needs_verification'):
        outcome = 'needs_verification'
    elif reason:
        outcome = str(reason)
    elif http_status and int(http_status) >= 400:
        outcome = 'failed'
    else:
        outcome = 'failed'

    return (
        outcome,
        str(reason) if reason else None,
        str(error)[:500] if error else None,
        str(blocked_ip) if blocked_ip else None,
        str(ray_id) if ray_id else None,
        str(user_id) if user_id else None,
    )


def record_finish(attempt_id, http_status, body):
    """Fill in the outcome of a started attempt. Fail-open."""
    if not ENABLED or not attempt_id:
        return
    try:
        outcome, reason, error, blocked_ip, ray_id, user_id = _classify(http_status, body)
        conn = sqlite3.connect(_db_path(), timeout=5)
        try:
            conn.execute(
                "UPDATE login_attempts SET finished_at = ?, "
                "latency_ms = CAST((julianday(?) - julianday(attempted_at)) * 86400000 AS INTEGER), "
                "http_status = ?, outcome = ?, reason_code = ?, error_message = ?, "
                "blocked_ip = ?, ray_id = ?, resolved_user_id = ? WHERE id = ?",
                (_now(), _now(), int(http_status) if http_status else None,
                 outcome, reason, error, blocked_ip, ray_id, user_id,
                 int(attempt_id)))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


# ── read (admin only) ────────────────────────────────────────────────────────

_PUBLIC_COLUMNS = (
    'id, attempted_at, finished_at, latency_ms, crm_id, owner_email, platform, '
    'identifier, proxy, source, outcome, reason_code, http_status, '
    'error_message, blocked_ip, ray_id, resolved_user_id'
)


def _mask_proxy(proxy):
    """host:port only — a proxy URL carries user:pass credentials."""
    if not proxy:
        return None
    try:
        rest = proxy.split('://', 1)[-1]
        return rest.rsplit('@', 1)[-1]
    except Exception:
        return None


def _row_public(row):
    d = dict(row)
    d['proxy'] = _mask_proxy(d.get('proxy'))
    d['has_password'] = bool(d.pop('_has_password', False))
    d['has_cookies'] = bool(d.pop('_has_cookies', False))
    return d


def list_attempts(crm_id=None, identifier=None, outcome=None, limit=50, offset=0):
    """Most recent attempts, newest first. Proxy masked; no secrets."""
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    sql = ('SELECT ' + _PUBLIC_COLUMNS + ', '
           '(encrypted_password IS NOT NULL) AS _has_password, '
           '(encrypted_cookies IS NOT NULL) AS _has_cookies '
           'FROM login_attempts WHERE 1=1')
    args = []
    if crm_id:
        sql += ' AND crm_id = ?'
        args.append(crm_id)
    if identifier:
        sql += ' AND identifier LIKE ?'
        args.append(f'%{identifier}%')
    if outcome:
        sql += ' AND outcome = ?'
        args.append(outcome)
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?'
    args += [limit, offset]
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        rows = [_row_public(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()
    return rows


def get(attempt_id, reveal=False):
    """One attempt. With reveal=True, decrypts password/cookies and returns the
    full proxy — caller MUST be a super-admin and MUST audit the reveal."""
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute('SELECT * FROM login_attempts WHERE id = ?',
                           (int(attempt_id),)).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    d = dict(row)
    enc_pw = d.pop('encrypted_password', None)
    enc_ck = d.pop('encrypted_cookies', None)
    d['has_password'] = bool(enc_pw)
    d['has_cookies'] = bool(enc_ck)
    if reveal:
        d['password'] = _decrypt(enc_pw)
        cookies = _decrypt(enc_ck)
        if cookies:
            try:
                d['cookies'] = json.loads(cookies)
            except Exception:
                d['cookies'] = cookies
        else:
            d['cookies'] = None
        # proxy stays raw (full) on reveal
    else:
        d['proxy'] = _mask_proxy(d.get('proxy'))
    return d
