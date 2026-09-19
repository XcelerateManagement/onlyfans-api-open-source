"""Only API account security: authenticator 2FA and signed-in sessions.

The dashboard password is checked by the billing dashboard (see
xcelerate-company-page/lib/auth-options.ts), which skips its own 2FA for
Only API logins. This module owns the Only API second step and the list of
signed-in dashboard sessions, so a customer can see where they are signed in
and sign those browsers out.

Every route is server-to-server (X-Service-Token) and is called by the
Next.js server with the crm_id it read from its own signed session cookie.
The browser never talks to these routes directly.

TOTP secrets are encrypted at rest with the app-wide Fernet helper. Recovery
codes and login challenge tokens are stored only as SHA-256 hashes (both are
high-entropy random values, so a plain hash is enough).
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager

import pyotp
from flask import Blueprint, g, jsonify, request

ISSUER = 'The Only API'
CHALLENGE_TTL = 5 * 60          # password accepted → code must follow within this
CHALLENGE_MAX_ATTEMPTS = 5
SETUP_TTL = 15 * 60             # scan the QR and confirm within this
FAILURE_WINDOW = 15 * 60
FAILURE_LIMIT = 10              # wrong codes per user per window before lockout
SESSION_IDLE_LIMIT = 30 * 24 * 3600   # NextAuth's default JWT lifetime
LAST_SEEN_WRITE_EVERY = 60
RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

SCHEMA = (
    '''CREATE TABLE IF NOT EXISTS user_mfa (
        user_id INTEGER PRIMARY KEY,
        secret_enc TEXT,
        enabled_at INTEGER,
        last_step INTEGER NOT NULL DEFAULT 0,
        pending_secret_enc TEXT,
        pending_at INTEGER,
        failed_count INTEGER NOT NULL DEFAULT 0,
        failed_window_start INTEGER NOT NULL DEFAULT 0
    )''',
    '''CREATE TABLE IF NOT EXISTS user_mfa_recovery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        code_hash TEXT NOT NULL,
        used_at INTEGER
    )''',
    'CREATE INDEX IF NOT EXISTS idx_user_mfa_recovery_user ON user_mfa_recovery(user_id)',
    '''CREATE TABLE IF NOT EXISTS mfa_challenges (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        crm_id TEXT NOT NULL,
        pending TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        used_at INTEGER
    )''',
    '''CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        crm_id TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'password',
        ip TEXT,
        country TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER
    )''',
    'CREATE INDEX IF NOT EXISTS idx_user_sessions_crm ON user_sessions(crm_id, revoked_at)',
)


class SecurityError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def init(cursor) -> None:
    """Declared from crm_database.init_database (house rule: every table lives there)."""
    for stmt in SCHEMA:
        cursor.execute(stmt)
    cursor.execute('PRAGMA table_info(crm_users)')
    if not any(row[1] == 'sessions_valid_after' for row in cursor.fetchall()):
        # Unix seconds. Session cookies issued before this moment that carry no
        # session id (issued before this feature shipped) are treated as signed out.
        cursor.execute('ALTER TABLE crm_users ADD COLUMN sessions_valid_after INTEGER DEFAULT 0')


# ── helpers ──────────────────────────────────────────────────────────────────

def _connect():
    import crm_database
    conn = sqlite3.connect(crm_database.DB_FILE, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def _db():
    """Commit on success, roll back on error, always close."""
    conn = _connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _encrypt(value):
    import crm_database
    return crm_database.encrypt_password(value)


def _decrypt(value):
    import crm_database
    return crm_database.decrypt_password(value)


def _hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


def _now():
    return int(time.time())


def _user(conn, crm_id):
    if not isinstance(crm_id, str) or not crm_id:
        raise SecurityError('Unauthorized', 401)
    row = conn.execute(
        '''SELECT u.id, u.email, u.is_suspended, COALESCE(u.sessions_valid_after, 0) AS valid_after
           FROM crm_users u JOIN crm_panels p ON p.id = u.crm_panel_id
           WHERE p.crm_id = ?''',
        (crm_id,),
    ).fetchone()
    if not row:
        raise SecurityError('Unauthorized', 401)
    return row


def _admin_allowlists():
    """(ips, countries) an admin account may sign in from. Empty = no limit."""
    ips = [v.strip() for v in os.environ.get('ADMIN_IP_ALLOWLIST', '').split(',') if v.strip()]
    countries = [v.strip().upper() for v in os.environ.get('ADMIN_COUNTRY_ALLOWLIST', '').split(',') if v.strip()]
    return ips, countries


def _ip_allowed(ip, rules):
    try:
        addr = ipaddress.ip_address((ip or '').strip())
    except ValueError:
        return False
    for rule in rules:
        try:
            if '/' in rule:
                if addr in ipaddress.ip_network(rule, strict=False):
                    return True
            elif addr == ipaddress.ip_address(rule):
                return True
        except ValueError:
            continue
    return False


def _guard_admin_location(conn, user_id, ip, country):
    """Admin panels may only start a session from an allowlisted place.

    Both allowlists unset means no restriction, so a blank config can never
    lock the owner out of their own panel. Non-admin accounts are untouched.
    """
    ips, countries = _admin_allowlists()
    if not ips and not countries:
        return
    row = conn.execute('SELECT is_admin, email FROM crm_users WHERE id = ?', (user_id,)).fetchone()
    if not row or not row['is_admin']:
        return
    if _ip_allowed(ip, ips):
        return
    if countries and (country or '').strip().upper() in countries:
        return
    print(f"[account_security] blocked admin sign-in for {row['email']} from ip={ip} country={country}", flush=True)
    raise SecurityError('Sign-in from this location is not allowed for this account.', 403)


def _clean_code(code):
    return re.sub(r'[\s-]', '', code or '') if isinstance(code, str) else ''


def _new_recovery_codes(conn, user_id):
    conn.execute('DELETE FROM user_mfa_recovery WHERE user_id = ?', (user_id,))
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = ''.join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        codes.append(f'{raw[:5]}-{raw[5:]}')
        conn.execute('INSERT INTO user_mfa_recovery (user_id, code_hash) VALUES (?, ?)',
                     (user_id, _hash(raw)))
    return codes


def _match_totp(secret, code, last_step):
    """Return the matched time step, or None. A step at or before last_step is a
    replay of a code that was already accepted and is refused."""
    if not re.fullmatch(r'\d{6}', code):
        return None
    totp = pyotp.TOTP(secret)
    current = int(time.time() // totp.interval)
    for step in (current - 1, current, current + 1):
        if step > last_step and hmac.compare_digest(totp.at(step * totp.interval), code):
            return step
    return None


def _verify_factor(conn, user_id, code, recovery):
    """Check an authenticator or recovery code for an enrolled user.

    Commits its own bookkeeping (failure counter, used step / code) so a wrong
    code is counted even when the caller then raises."""
    mfa = conn.execute('SELECT * FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL',
                       (user_id,)).fetchone()
    if not mfa:
        raise SecurityError('Two-factor authentication is not enabled', 409)
    now = _now()
    in_window = now - mfa['failed_window_start'] < FAILURE_WINDOW
    if in_window and mfa['failed_count'] >= FAILURE_LIMIT:
        raise SecurityError('Too many incorrect codes. Try again in 15 minutes.', 429)

    code = _clean_code(code)
    ok = False
    if recovery:
        row = conn.execute(
            'SELECT id FROM user_mfa_recovery WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
            (user_id, _hash(code.lower())),
        ).fetchone()
        if row:
            conn.execute('UPDATE user_mfa_recovery SET used_at = ? WHERE id = ?', (now, row['id']))
            ok = True
    else:
        secret = _decrypt(mfa['secret_enc'])
        step = _match_totp(secret, code, mfa['last_step']) if secret else None
        if step is not None:
            conn.execute('UPDATE user_mfa SET last_step = ? WHERE user_id = ?', (step, user_id))
            ok = True

    if ok:
        conn.execute('UPDATE user_mfa SET failed_count = 0 WHERE user_id = ?', (user_id,))
    elif in_window:
        conn.execute('UPDATE user_mfa SET failed_count = failed_count + 1 WHERE user_id = ?', (user_id,))
    else:
        conn.execute('UPDATE user_mfa SET failed_count = 1, failed_window_start = ? WHERE user_id = ?',
                     (now, user_id))
    conn.commit()
    if not ok:
        raise SecurityError('That code is not valid' if not recovery else 'That recovery code is not valid', 401)


def _enabled(conn, user_id):
    return conn.execute('SELECT 1 FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL',
                        (user_id,)).fetchone() is not None


# ── 2FA ──────────────────────────────────────────────────────────────────────

def mfa_status(crm_id):
    with _db() as conn:
        user = _user(conn, crm_id)
        remaining = conn.execute(
            'SELECT COUNT(*) FROM user_mfa_recovery WHERE user_id = ? AND used_at IS NULL',
            (user['id'],)).fetchone()[0]
        return {'enabled': _enabled(conn, user['id']), 'recovery_codes_remaining': remaining}


def mfa_setup(crm_id):
    with _db() as conn:
        user = _user(conn, crm_id)
        if _enabled(conn, user['id']):
            raise SecurityError('Two-factor authentication is already on. Turn it off first to switch apps.', 409)
        secret = pyotp.random_base32()
        conn.execute(
            '''INSERT INTO user_mfa (user_id, pending_secret_enc, pending_at) VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET pending_secret_enc = excluded.pending_secret_enc,
                                                  pending_at = excluded.pending_at''',
            (user['id'], _encrypt(secret), _now()),
        )
        uri = pyotp.TOTP(secret).provisioning_uri(name=user['email'], issuer_name=ISSUER)
        return {'secret': secret, 'otpauth_uri': uri}


def mfa_enable(crm_id, code):
    with _db() as conn:
        user = _user(conn, crm_id)
        row = conn.execute('SELECT * FROM user_mfa WHERE user_id = ?', (user['id'],)).fetchone()
        if row and row['enabled_at']:
            raise SecurityError('Two-factor authentication is already on', 409)
        if not row or not row['pending_secret_enc'] or _now() - (row['pending_at'] or 0) > SETUP_TTL:
            raise SecurityError('Setup expired. Start again.', 409)
        secret = _decrypt(row['pending_secret_enc'])
        step = _match_totp(secret, _clean_code(code), 0) if secret else None
        if step is None:
            raise SecurityError('That code is not valid. Check the time on your phone and try again.', 401)
        conn.execute(
            '''UPDATE user_mfa SET secret_enc = pending_secret_enc, pending_secret_enc = NULL,
                   pending_at = NULL, enabled_at = ?, last_step = ?, failed_count = 0
               WHERE user_id = ?''',
            (_now(), step, user['id']),
        )
        codes = _new_recovery_codes(conn, user['id'])
        return {'enabled': True, 'recovery_codes': codes}


def mfa_disable(crm_id, code, recovery=False):
    with _db() as conn:
        user = _user(conn, crm_id)
        _verify_factor(conn, user['id'], code, recovery)
        conn.execute('DELETE FROM user_mfa WHERE user_id = ?', (user['id'],))
        conn.execute('DELETE FROM user_mfa_recovery WHERE user_id = ?', (user['id'],))
        conn.execute('DELETE FROM mfa_challenges WHERE user_id = ?', (user['id'],))
        return {'enabled': False}


def regenerate_recovery_codes(crm_id, code, recovery=False):
    with _db() as conn:
        user = _user(conn, crm_id)
        _verify_factor(conn, user['id'], code, recovery)
        return {'recovery_codes': _new_recovery_codes(conn, user['id'])}


# ── login challenge ──────────────────────────────────────────────────────────

def create_challenge(crm_id, pending=None):
    """Called after the password (or billing-dashboard SSO) has been accepted.
    Returns {mfa_required: False} when the user has no 2FA, otherwise a
    single-use token the login page exchanges together with a code."""
    with _db() as conn:
        user = _user(conn, crm_id)
        if user['is_suspended']:
            raise SecurityError('Account suspended. Contact support.', 403)
        if not _enabled(conn, user['id']):
            return {'mfa_required': False}
        now = _now()
        conn.execute('DELETE FROM mfa_challenges WHERE expires_at < ?', (now - 3600,))
        token = secrets.token_urlsafe(32)
        conn.execute(
            '''INSERT INTO mfa_challenges (token_hash, user_id, crm_id, pending, created_at, expires_at)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (_hash(token), user['id'], crm_id, json.dumps(pending or {})[:4000], now, now + CHALLENGE_TTL),
        )
        return {'mfa_required': True, 'challenge': token}


def verify_challenge(token, code, recovery=False):
    if not isinstance(token, str) or not token:
        raise SecurityError('This sign-in step expired. Sign in again.', 401)
    conn = _connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM mfa_challenges WHERE token_hash = ?', (_hash(token),)).fetchone()
        if (not row or row['used_at'] or row['expires_at'] < _now()
                or row['attempts'] >= CHALLENGE_MAX_ATTEMPTS):
            conn.rollback()
            raise SecurityError('This sign-in step expired. Sign in again.', 401)
        conn.execute('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ?', (row['token_hash'],))
        _verify_factor(conn, row['user_id'], code, recovery)   # commits, raises on a bad code
        conn.execute('BEGIN IMMEDIATE')
        used = conn.execute('UPDATE mfa_challenges SET used_at = ? WHERE token_hash = ? AND used_at IS NULL',
                            (_now(), row['token_hash'])).rowcount
        conn.commit()
        if not used:
            raise SecurityError('This sign-in step expired. Sign in again.', 401)
        return {'crm_id': row['crm_id'], 'pending': json.loads(row['pending'] or '{}')}
    finally:
        conn.close()


# ── sessions ─────────────────────────────────────────────────────────────────

def _clip(value, limit):
    return value[:limit] if isinstance(value, str) and value else None


def create_session(crm_id, method='password', ip=None, country=None, user_agent=None):
    with _db() as conn:
        user = _user(conn, crm_id)
        _guard_admin_location(conn, user['id'], ip, country)
        now = _now()
        session_id = secrets.token_urlsafe(32)
        conn.execute(
            '''INSERT INTO user_sessions (session_id, user_id, crm_id, method, ip, country, user_agent,
                                          created_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (session_id, user['id'], crm_id, method if method in ('password', 'sso', 'legacy') else 'password',
             _clip(ip, 64), _clip(country, 8), _clip(user_agent, 300), now, now),
        )
        return {'session_id': session_id}


def check_session(crm_id, session_id=None, issued_at=None):
    with _db() as conn:
        try:
            user = _user(conn, crm_id)
        except SecurityError:
            return {'active': False}
        if user['is_suspended']:
            return {'active': False}
        now = _now()
        if not session_id:
            # Cookie issued before sessions were tracked. Valid until the user
            # signs out everywhere, which moves sessions_valid_after forward.
            issued = issued_at if isinstance(issued_at, (int, float)) else 0
            return {'active': issued > user['valid_after']}
        row = conn.execute('SELECT id, crm_id, revoked_at, last_seen_at FROM user_sessions WHERE session_id = ?',
                           (session_id,)).fetchone()
        if (not row or row['crm_id'] != crm_id or row['revoked_at']
                or now - row['last_seen_at'] > SESSION_IDLE_LIMIT):
            return {'active': False}
        if now - row['last_seen_at'] >= LAST_SEEN_WRITE_EVERY:
            conn.execute('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?', (now, row['id']))
        return {'active': True}


def list_sessions(crm_id, current_session_id=None):
    with _db() as conn:
        _user(conn, crm_id)
        rows = conn.execute(
            '''SELECT id, session_id, method, ip, country, user_agent, created_at, last_seen_at
               FROM user_sessions
               WHERE crm_id = ? AND revoked_at IS NULL AND last_seen_at > ?
               ORDER BY last_seen_at DESC LIMIT 100''',
            (crm_id, _now() - SESSION_IDLE_LIMIT),
        ).fetchall()
        return {'sessions': [{
            'id': r['id'],
            'method': r['method'],
            'ip': r['ip'] or 'Unknown',
            'country': r['country'] or 'Unknown',
            'user_agent': r['user_agent'] or 'Unknown device',
            'created_at': r['created_at'],
            'last_seen_at': r['last_seen_at'],
            'current': bool(current_session_id) and r['session_id'] == current_session_id,
        } for r in rows]}


def revoke_sessions(crm_id, current_session_id=None, mode='one', target_id=None):
    with _db() as conn:
        user = _user(conn, crm_id)
        now = _now()
        if mode == 'one':
            if not isinstance(target_id, int) or isinstance(target_id, bool):
                raise SecurityError('Session not found', 404)
            row = conn.execute('SELECT session_id FROM user_sessions WHERE id = ? AND crm_id = ? AND revoked_at IS NULL',
                               (target_id, crm_id)).fetchone()
            if not row:
                raise SecurityError('Session not found', 404)
            conn.execute('UPDATE user_sessions SET revoked_at = ? WHERE id = ?', (now, target_id))
            current = bool(current_session_id) and row['session_id'] == current_session_id
            return {'revoked': 1, 'current_revoked': current}
        if mode == 'others':
            if not current_session_id:
                raise SecurityError('Reload the page and try again', 409)
            count = conn.execute(
                'UPDATE user_sessions SET revoked_at = ? WHERE crm_id = ? AND revoked_at IS NULL AND session_id <> ?',
                (now, crm_id, current_session_id)).rowcount
            # Also signs out cookies from before session tracking existed.
            conn.execute('UPDATE crm_users SET sessions_valid_after = ? WHERE id = ?', (now, user['id']))
            return {'revoked': count, 'current_revoked': False}
        if mode == 'all':
            count = conn.execute('UPDATE user_sessions SET revoked_at = ? WHERE crm_id = ? AND revoked_at IS NULL',
                                 (now, crm_id)).rowcount
            conn.execute('UPDATE crm_users SET sessions_valid_after = ? WHERE id = ?', (now, user['id']))
            return {'revoked': count, 'current_revoked': True}
        raise SecurityError('Unknown sign-out option', 400)


def end_session(crm_id, session_id):
    if not session_id:
        return {'ended': False}
    with _db() as conn:
        count = conn.execute('UPDATE user_sessions SET revoked_at = ? WHERE crm_id = ? AND session_id = ? AND revoked_at IS NULL',
                             (_now(), crm_id, session_id)).rowcount
        return {'ended': bool(count)}


# ── routes ───────────────────────────────────────────────────────────────────

def blueprint(verify_service):
    bp = Blueprint('account_security', __name__, url_prefix='/internal/account-security')

    @bp.before_request
    def _require_service():
        if not verify_service():
            return jsonify({'error': 'Unauthorized'}), 401
        # Authenticated service caller: keep responses byte-clean, same as a
        # valid API key (see inject_ai_shield in crm_api.py).
        g.shield_skip = True

    def route(path, handler):
        def view():
            body = request.get_json(silent=True)
            if not isinstance(body, dict):
                body = {}
            try:
                return jsonify(handler(body))
            except SecurityError as e:
                return jsonify({'error': str(e)}), e.status
        bp.add_url_rule(path, endpoint=path.strip('/').replace('/', '_'), view_func=view, methods=['POST'])

    recovery = lambda b: b.get('recovery') is True  # noqa: E731
    route('/mfa/status', lambda b: mfa_status(b.get('crm_id')))
    route('/mfa/setup', lambda b: mfa_setup(b.get('crm_id')))
    route('/mfa/enable', lambda b: mfa_enable(b.get('crm_id'), b.get('code')))
    route('/mfa/disable', lambda b: mfa_disable(b.get('crm_id'), b.get('code'), recovery(b)))
    route('/mfa/recovery/regenerate', lambda b: regenerate_recovery_codes(b.get('crm_id'), b.get('code'), recovery(b)))
    route('/challenge/create', lambda b: create_challenge(b.get('crm_id'), b.get('pending') if isinstance(b.get('pending'), dict) else None))
    route('/challenge/verify', lambda b: verify_challenge(b.get('challenge'), b.get('code'), recovery(b)))
    route('/sessions/create', lambda b: create_session(b.get('crm_id'), b.get('method'), b.get('ip'), b.get('country'), b.get('user_agent')))
    route('/sessions/check', lambda b: check_session(b.get('crm_id'), b.get('session_id'), b.get('issued_at')))
    route('/sessions/list', lambda b: list_sessions(b.get('crm_id'), b.get('session_id')))
    route('/sessions/revoke', lambda b: revoke_sessions(b.get('crm_id'), b.get('session_id'), b.get('mode'), b.get('target_id')))
    route('/sessions/end', lambda b: end_session(b.get('crm_id'), b.get('session_id')))
    return bp
