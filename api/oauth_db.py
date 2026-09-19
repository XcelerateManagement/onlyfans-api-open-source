"""OAuth 2.1 authorization server — persistence layer.

Three tables, all idempotent, all added by ``init_oauth_tables()``:

- ``oauth_clients``   — registered OAuth clients (DCR per RFC 7591)
- ``oauth_codes``     — short-lived authorization codes (with PKCE binding)
- ``oauth_consents``  — remembered user→client consent grants

The schema follows the OAuth 2.1 draft + RFC 7591/6749. We don't store
refresh tokens yet — access tokens are 1h, and ChatGPT can re-run the
auth flow transparently when one expires. If you want long-lived
sessions later, add an ``oauth_refresh_tokens`` table and wire it into
oauth_routes.token.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import time
from typing import Any

# Honor DATABASE_PATH env override for sandbox / pen-test runs.
DB_FILE = os.environ.get('DATABASE_PATH', 'crm_data.db')


def _column_exists(cursor, table: str, column: str) -> bool:
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def init_oauth_tables() -> None:
    """Create the OAuth tables if they don't exist. Idempotent — safe to
    call on every app boot."""
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()

        # Registered OAuth clients. ``client_id`` is what ChatGPT (or any
        # other MCP client) presents on the token endpoint. ``redirect_uris``
        # is a JSON array — RFC 6749 §3.1.2 requires exact match.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS oauth_clients (
                client_id TEXT PRIMARY KEY,
                client_secret TEXT,                  -- NULL = public client (PKCE only)
                client_name TEXT,
                client_uri TEXT,
                redirect_uris TEXT NOT NULL,         -- JSON array
                grant_types TEXT NOT NULL DEFAULT '["authorization_code"]',
                response_types TEXT NOT NULL DEFAULT '["code"]',
                token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
                scope TEXT NOT NULL DEFAULT 'of:read',
                created_at TEXT NOT NULL,
                created_via TEXT NOT NULL DEFAULT 'dcr'   -- 'dcr' | 'admin' | 'cimd'
            )
            """
        )

        # One-shot authorization codes. Bound to (client, user, redirect_uri,
        # code_challenge, resource) so they can't be replayed across context.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS oauth_codes (
                code TEXT PRIMARY KEY,
                client_id TEXT NOT NULL,
                user_crm_id TEXT NOT NULL,
                redirect_uri TEXT NOT NULL,
                scope TEXT NOT NULL,
                code_challenge TEXT NOT NULL,
                code_challenge_method TEXT NOT NULL,  -- 'S256'
                resource TEXT,                          -- audience the client asked for
                state TEXT,
                expires_at INTEGER NOT NULL,           -- unix seconds
                used INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_codes(expires_at)")

        # Persistent consent — once a user approves a client + scope set, we
        # skip the consent screen on subsequent authorizations unless the
        # client asks for additional scopes.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS oauth_consents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_crm_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                scopes TEXT NOT NULL,                  -- space-separated, normalized sort
                granted_at INTEGER NOT NULL,
                UNIQUE(user_crm_id, client_id)
            )
            """
        )

        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Clients (Dynamic Client Registration)
# ---------------------------------------------------------------------------

def register_client(
    *,
    client_name: str | None,
    client_uri: str | None,
    redirect_uris: list[str],
    token_endpoint_auth_method: str = "none",
    scope: str = "of:read",
    created_via: str = "dcr",
) -> dict[str, Any]:
    """Insert a new OAuth client. Returns the full client record (without
    secret if it's a public client).

    No caller-supplied client_id — we mint it. RFC 7591 §3.2 requires the
    server to issue ``client_id`` (and ``client_secret`` for confidential
    clients) on registration.
    """
    client_id = "client_" + secrets.token_urlsafe(24)
    client_secret = None
    if token_endpoint_auth_method != "none":
        # Confidential clients (private_key_jwt would supply a JWKS URL
        # instead; we keep client_secret_basic as a third option for parity
        # with non-MCP OAuth clients that may also hit this AS).
        client_secret = secrets.token_urlsafe(48)

    now = int(time.time())
    # Only advertise grants we actually implement. Previously we listed
    # ``refresh_token`` in the DCR response even though /oauth/token only
    # handles ``authorization_code`` — strict clients (ChatGPT's connector
    # validator in particular) reject DCR responses whose ``grant_types``
    # isn't a subset of the AS metadata's ``grant_types_supported``.
    grants = ["authorization_code"]
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO oauth_clients
              (client_id, client_secret, client_name, client_uri,
               redirect_uris, grant_types, response_types,
               token_endpoint_auth_method, scope, created_at, created_via)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                client_id,
                client_secret,
                client_name,
                client_uri,
                json.dumps(redirect_uris),
                json.dumps(grants),
                json.dumps(["code"]),
                token_endpoint_auth_method,
                scope,
                str(now),
                created_via,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "client_id": client_id,
        "client_secret": client_secret,
        "client_id_issued_at": now,
        "client_name": client_name,
        "client_uri": client_uri,
        "redirect_uris": redirect_uris,
        "grant_types": grants,
        "response_types": ["code"],
        "token_endpoint_auth_method": token_endpoint_auth_method,
        "scope": scope,
    }


def get_client(client_id: str) -> dict[str, Any] | None:
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        c.execute(
            "SELECT client_id, client_secret, client_name, client_uri, "
            "redirect_uris, grant_types, response_types, "
            "token_endpoint_auth_method, scope, created_at "
            "FROM oauth_clients WHERE client_id = ?",
            (client_id,),
        )
        row = c.fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {
        "client_id": row[0],
        "client_secret": row[1],
        "client_name": row[2],
        "client_uri": row[3],
        "redirect_uris": json.loads(row[4]),
        "grant_types": json.loads(row[5]),
        "response_types": json.loads(row[6]),
        "token_endpoint_auth_method": row[7],
        "scope": row[8],
        "created_at": row[9],
    }


# ---------------------------------------------------------------------------
# Authorization codes
# ---------------------------------------------------------------------------

def issue_code(
    *,
    client_id: str,
    user_crm_id: str,
    redirect_uri: str,
    scope: str,
    code_challenge: str,
    code_challenge_method: str,
    resource: str | None,
    state: str | None,
    ttl_seconds: int = 60,
) -> str:
    """Mint and persist an authorization code. 60s TTL per OAuth 2.1 BCP.

    Caller is expected to have *already* checked PKCE method support,
    redirect_uri exact-match against the registered client, and scope
    subset against what the client is allowed. We just persist.
    """
    code = secrets.token_urlsafe(32)
    now = int(time.time())
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        c.execute(
            """
            INSERT INTO oauth_codes
              (code, client_id, user_crm_id, redirect_uri, scope,
               code_challenge, code_challenge_method, resource,
               state, expires_at, used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                code,
                client_id,
                user_crm_id,
                redirect_uri,
                scope,
                code_challenge,
                code_challenge_method,
                resource,
                state,
                now + ttl_seconds,
                now,
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return code


def consume_code(code: str) -> dict[str, Any] | None:
    """Atomically consume an authorization code.

    Returns the bound context (client, user, redirect_uri, scope,
    code_challenge, resource) or None if the code is invalid / expired /
    already used. Mark-as-used happens in the same transaction so two
    concurrent token requests can't both succeed.
    """
    now = int(time.time())
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        # Use a transaction with BEGIN IMMEDIATE so the SELECT and UPDATE
        # are seen atomically — important because RFC 6749 §10.5 says
        # authorization codes MUST be single-use.
        c.execute("BEGIN IMMEDIATE")
        c.execute(
            "SELECT client_id, user_crm_id, redirect_uri, scope, "
            "code_challenge, code_challenge_method, resource, expires_at, used "
            "FROM oauth_codes WHERE code = ?",
            (code,),
        )
        row = c.fetchone()
        if not row:
            conn.rollback()
            return None
        if row[8] != 0:
            conn.rollback()
            return None
        if row[7] < now:
            conn.rollback()
            return None
        c.execute("UPDATE oauth_codes SET used = 1 WHERE code = ?", (code,))
        conn.commit()
        return {
            "client_id": row[0],
            "user_crm_id": row[1],
            "redirect_uri": row[2],
            "scope": row[3],
            "code_challenge": row[4],
            "code_challenge_method": row[5],
            "resource": row[6],
        }
    finally:
        conn.close()


def gc_expired_codes() -> int:
    """Remove rows past their expires_at. Cheap, can run on a cron or
    pre-emptively from /oauth/token. Returns rows deleted."""
    now = int(time.time())
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        c.execute("DELETE FROM oauth_codes WHERE expires_at < ?", (now - 600,))
        deleted = c.rowcount
        conn.commit()
        return deleted
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Consent
# ---------------------------------------------------------------------------

def has_consent(user_crm_id: str, client_id: str, scopes: list[str]) -> bool:
    """True if the user has already granted these scopes (or a superset)
    to this client."""
    want = set(scopes)
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        c.execute(
            "SELECT scopes FROM oauth_consents WHERE user_crm_id = ? AND client_id = ?",
            (user_crm_id, client_id),
        )
        row = c.fetchone()
    finally:
        conn.close()
    if not row:
        return False
    have = set(row[0].split())
    return want.issubset(have)


def record_consent(user_crm_id: str, client_id: str, scopes: list[str]) -> None:
    """Upsert consent. We always merge (set-union) so re-consenting with
    additional scopes doesn't erase prior grants."""
    now = int(time.time())
    conn = sqlite3.connect(DB_FILE)
    try:
        c = conn.cursor()
        c.execute(
            "SELECT scopes FROM oauth_consents WHERE user_crm_id = ? AND client_id = ?",
            (user_crm_id, client_id),
        )
        row = c.fetchone()
        existing = set(row[0].split()) if row else set()
        merged = sorted(existing | set(scopes))
        merged_str = " ".join(merged)
        if row:
            c.execute(
                "UPDATE oauth_consents SET scopes = ?, granted_at = ? "
                "WHERE user_crm_id = ? AND client_id = ?",
                (merged_str, now, user_crm_id, client_id),
            )
        else:
            c.execute(
                "INSERT INTO oauth_consents (user_crm_id, client_id, scopes, granted_at) "
                "VALUES (?, ?, ?, ?)",
                (user_crm_id, client_id, merged_str, now),
            )
        conn.commit()
    finally:
        conn.close()


# Make tables exist as a side-effect of `import oauth_db`. Mirrors
# crm_database.py's convention of self-initializing at import time.
# Idempotent — safe across reloads, multiple imports, and concurrent
# processes (sqlite handles the CREATE TABLE IF NOT EXISTS race).
try:
    init_oauth_tables()
except Exception as _e:
    import sys
    print(f"[oauth_db] init_oauth_tables failed at import: {_e}", file=sys.stderr)
