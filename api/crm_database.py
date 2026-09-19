#!/usr/bin/env python3
"""
Simple database for multi-tenant CRM panel management.
Uses SQLite to store CRM panels and OnlyFans accounts.
Uses bcrypt for secure password hashing.
"""

import sqlite3
import secrets
import json
import bcrypt
from datetime import datetime, timezone, timedelta
from cryptography.fernet import Fernet
import base64
import hashlib
import config


# Canonical UTC ISO timestamp format. Must match OF's `createdAt` / `subscribeAt`
# format so string `>` comparisons against those work correctly in SQL (no mixing
# of "2026-04-18T15:12:40.016872" with "2026-04-18T14:51:45+00:00", which breaks
# lexicographic ordering around the '.' vs '+' boundary). Used for every field
# we later compare to an OF-sourced timestamp — in particular subscribers_cache
# .last_synced_at and transactions_cache.synced_at.
def iso_utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')


# ---------------------------------------------------------------------------
# Subscription liveness
# ---------------------------------------------------------------------------
# `subscribers_cache.is_active` is a SNAPSHOT: it is only ever written by
# upsert_subscriber, i.e. by a subscriber sync, and the full OF walk runs on a
# 7-day cadence (scheduler.SUBS_REFRESH_INTERVAL_HOURS). Wall-clock keeps
# moving between syncs, so a fan whose subscription lapsed yesterday still has
# is_active=1 on disk. Reading that column raw made "active subscribers" — the
# headline number on the dashboard, and the filter behind /subscribers/cached
# ?type=active and /subscribers/new — wrong by up to a week.
#
# Liveness needs no upstream call to fix: it is derivable from `expired_at`,
# which we already store. A subscription is live iff its end date is in the
# future. A NULL expired_at is NOT expired — it is how both platforms report an
# open-ended or freshly-renewed subscription (see the expired_at note on the
# ON CONFLICT clause in upsert_subscriber) — so it must read as ACTIVE.
#
# COALESCE(datetime(x), '9999-12-31') does three jobs in one expression:
#   - datetime() normalises every timestamp shape we store ("…Z", "…+00:00",
#     "…+02:00", with or without microseconds) to UTC, so this compares real
#     instants instead of relying on a lexicographic accident. Raw string `>`
#     against a "+02:00" expiry would be wrong by hours.
#   - A NULL expired_at yields datetime(NULL) = NULL → the far-future sentinel
#     → live, which is the semantics above.
#   - An UNPARSEABLE expired_at also yields NULL → live. That is deliberate: it
#     preserves what the old Python computation did (its `except: pass` left
#     is_active at 1) and errs towards showing a fan rather than silently
#     dropping them off the roster over a timestamp format we didn't foresee.
#
# The expression is never NULL, so `NOT (…)` is a safe, total complement — that
# is what the `expired` filter uses, and it is why active+expired still
# partition the roster exactly.
SUBSCRIPTION_ACTIVE_SQL = (
    "COALESCE(datetime(expired_at), '9999-12-31') > datetime('now')")

# The same predicate over a bound parameter, used to compute the stored column
# at INSERT time from the value being written. Deriving both from one SQL
# expression is the point: a parallel Python implementation would drift from
# the read queries the first time either side learned about a timestamp format
# the other didn't, and the read-side optimisation below depends on the two
# agreeing exactly.
_SUBSCRIPTION_ACTIVE_PARAM_SQL = (
    "COALESCE(datetime(?), '9999-12-31') > datetime('now')")

import os as _os
# Honor DATABASE_PATH env override so pen-test / sandbox runs can point at a
# throwaway copy (cp crm_data.db /tmp/sandbox.db && DATABASE_PATH=/tmp/sandbox.db).
# Falls back to the legacy hardcoded path so existing deployments are unaffected.
DB_FILE = _os.environ.get('DATABASE_PATH', 'crm_data.db')


def get_encryption_key():
    """Generate a Fernet-compatible key from the encryption key."""
    key = config.ENCRYPTION_KEY.encode()
    # Create a consistent 32-byte key from any input
    key_hash = hashlib.sha256(key).digest()
    return base64.urlsafe_b64encode(key_hash)


def encrypt_password(password):
    """Encrypt a password using Fernet symmetric encryption."""
    if not password:
        return None
    f = Fernet(get_encryption_key())
    encrypted = f.encrypt(password.encode())
    return encrypted.decode()


def decrypt_password(encrypted_password):
    """Decrypt a password using Fernet symmetric encryption."""
    if not encrypted_password:
        return None
    try:
        f = Fernet(get_encryption_key())
        decrypted = f.decrypt(encrypted_password.encode())
        return decrypted.decode()
    except Exception:
        return None


def _column_exists(cursor, table, column):
    cursor.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cursor.fetchall())


def _ensure_column(cursor, table, column, definition):
    if not _column_exists(cursor, table, column):
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _key_prefix(key):
    """First 8 chars of a key, for non-identifying masked display."""
    return (key or '')[:8]


def _mirror_primary_api_key(cursor, crm_id, api_key, created_at=None):
    """Ensure an is_primary=1 row in api_keys mirrors crm_panels.api_key.
    INSERT OR IGNORE keyed on the UNIQUE key column → idempotent. Operates on a
    caller-provided cursor so it can run inside create_user/create_crm_panel
    transactions and the init_database backfill."""
    if not crm_id or not api_key:
        return
    created_at = created_at or datetime.utcnow().isoformat()
    cursor.execute(
        '''INSERT OR IGNORE INTO api_keys (crm_id, key, name, prefix, is_primary, created_at)
           VALUES (?, ?, 'Default', ?, 1, ?)''',
        (crm_id, api_key, _key_prefix(api_key), created_at),
    )


def init_database():
    """Initialize the database with required tables."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # WAL journal mode: readers never block the writer and vice-versa. In the
    # default DELETE mode a single writer (an API usage-counter write, or the
    # APScheduler jobstore polling) blocks EVERY concurrent reader, which under
    # real traffic produced "database is locked" storms → 500s on /events/stream
    # and the dashboard showing "no accounts". WAL is a persistent file property,
    # so once set here every connection (including SQLAlchemy/APScheduler) uses
    # it. synchronous=NORMAL is the safe, fast WAL pairing; busy_timeout makes a
    # contended writer WAIT briefly instead of erroring out immediately.
    try:
        cursor.execute('PRAGMA journal_mode=WAL')
        cursor.execute('PRAGMA synchronous=NORMAL')
        cursor.execute('PRAGMA busy_timeout=30000')
    except sqlite3.Error as _e:
        print(f'[db] could not set WAL pragmas: {_e}')

    # CRM Panels table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS crm_panels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            api_key TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL
        )
    ''')

    # OnlyFans Accounts table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS of_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_panel_id INTEGER NOT NULL,
            of_user_id TEXT NOT NULL,
            email TEXT NOT NULL,
            username TEXT,
            x_bc TEXT,
            x_hash TEXT,
            proxy TEXT,
            encrypted_password TEXT,  -- Encrypted OF password
            created_at TEXT NOT NULL,
            last_login TEXT,
            FOREIGN KEY (crm_panel_id) REFERENCES crm_panels(id),
            UNIQUE(crm_panel_id, of_user_id)
        )
    ''')

    # Polling/event-engine columns on of_accounts (idempotent add)
    _ensure_column(cursor, 'of_accounts', 'polling_enabled', 'INTEGER DEFAULT 0')
    _ensure_column(cursor, 'of_accounts', 'polling_interval_seconds', 'INTEGER DEFAULT 120')
    _ensure_column(cursor, 'of_accounts', 'last_polled_at', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'polling_cursor', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'polling_failure_count', 'INTEGER DEFAULT 0')
    _ensure_column(cursor, 'of_accounts', 'allow_of_write_actions', 'INTEGER DEFAULT 0')
    _ensure_column(cursor, 'of_accounts', 'last_subscribers_refresh_at', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'subscribers_refresh_failure_count', 'INTEGER DEFAULT 0')
    _ensure_column(cursor, 'of_accounts', 'last_transactions_refresh_at', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'transactions_refresh_failure_count', 'INTEGER DEFAULT 0')
    # Newest seen tx marker per account — speeds up delta walks by letting us
    # pass `?marker=<last_seen>` as a cheap resume point instead of walking
    # from the very top every time.
    _ensure_column(cursor, 'of_accounts', 'last_tx_marker', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'last_campaigns_refresh_at', 'TEXT')
    # Relogin circuit breaker: set when OF rejects the stored password so
    # auto-relogin stops re-buying captchas; cleared on the next successful
    # connect (add_of_account).
    _ensure_column(cursor, 'of_accounts', 'relogin_blocked_at', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'relogin_block_reason', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'relogin_block_code', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'relogin_block_action', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'last_connection_state', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'last_connection_error_code', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'last_connection_error_at', 'TEXT')
    # Platform-side identity gate (OnlyFans face/selfie check). Distinct from
    # the relogin block: the credentials and the session are BOTH fine, the
    # platform simply refuses every account-scoped call until a human passes a
    # liveness check. Nothing we can retry our way out of, so it must never
    # feed the relogin circuit breaker — see of_faceid.py.
    _ensure_column(cursor, 'of_accounts', 'verification_required_at', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'verification_reason', 'TEXT')
    # Raw otpState from the challenge, JSON. Kept so the dashboard can say
    # *which* factor OF wants without re-provoking the error to find out.
    _ensure_column(cursor, 'of_accounts', 'verification_otp_state', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'campaigns_refresh_failure_count', 'INTEGER DEFAULT 0')
    # Optional allowlist of tracking-link campaigns to keep synced (JSON array
    # of names/codes, e.g. ["szvrils"]). When set, scheduled + backfill claimer
    # syncs walk ONLY these — so a 20k-sub link doesn't get walked on a timer.
    # NULL/empty = fall back to the subscriber-count cap (see campaigns_sync).
    _ensure_column(cursor, 'of_accounts', 'tracked_campaigns', 'TEXT')
    # Profile metadata fetched from /users/me on login. Avatar shows up
    # next to the username in the dashboard accounts table.
    _ensure_column(cursor, 'of_accounts', 'avatar', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'about', 'TEXT')
    # Platform this account belongs to. DEFAULT 'onlyfans' grandfathers every
    # existing row as an OF account; new Fansly accounts store 'fansly'. The
    # column name of the table stays `of_accounts` for backwards-compat — it's
    # now the generic "connected creator account" table.
    _ensure_column(cursor, 'of_accounts', 'platform', "TEXT DEFAULT 'onlyfans'")
    # Fansly session fields. OF accounts leave these NULL (they use x_bc/x_hash
    # + the sess/auth_id cookies instead). Fansly's auth is a bearer token plus
    # a device id + session id; there is no x_bc/x_hash equivalent.
    _ensure_column(cursor, 'of_accounts', 'fansly_auth_token', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'fansly_client_id', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'fansly_session_id', 'TEXT')
    # Last known payout balance, stamped opportunistically whenever something
    # already fetched it for this account. `payoutAvailable` is only knowable
    # from the platform, so a panel-wide total would otherwise cost one live
    # call per account — which the dashboard was paying serially, per page
    # load. Persisting the value each time it flows past costs no extra
    # upstream traffic and lets the summary be served from one local query.
    _ensure_column(cursor, 'of_accounts', 'last_balance_available', 'REAL')
    _ensure_column(cursor, 'of_accounts', 'last_balance_pending', 'REAL')
    _ensure_column(cursor, 'of_accounts', 'last_balance_currency', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'last_balance_at', 'TEXT')
    # Whole wallet including earnings still on hold. Only Fansly reports it as
    # a separate figure (available + pending); NULL = not sampled / not known,
    # readers fall back to available + pending.
    _ensure_column(cursor, 'of_accounts', 'last_balance_current', 'REAL')
    # When scheduler._run_avatar_refresh last ATTEMPTED this account (not last
    # succeeded — see the note there). It's the queue key that lets the sweep
    # cover every account on a bounded per-run budget instead of walking the
    # whole table in one sitting. NULL = never swept, so new accounts sort first.
    _ensure_column(cursor, 'of_accounts', 'last_avatar_refresh_at', 'TEXT')
    # Country flags shown on the accounts table (see backfill_account_geo).
    #  - proxy_*  : the proxy's real EXIT country, resolved by probing through
    #    the proxy. `proxy_geo_for` records the proxy string it was resolved
    #    for, so a changed proxy re-resolves without every proxy-write path
    #    having to remember to invalidate it.
    #  - profile_country_* : the OnlyFans banking country from /payouts/account
    #    (account.code). OnlyFans-only; Fansly rows leave it NULL.
    # All are cached — resolved once in the background, then read from here.
    _ensure_column(cursor, 'of_accounts', 'proxy_country_code', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'proxy_country', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'proxy_geo_for', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'proxy_geo_at', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'profile_country_code', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'profile_country', 'TEXT')
    _ensure_column(cursor, 'of_accounts', 'profile_country_at', 'TEXT')
    # NB: _ensure_column for subscribers_cache lives further down, after that
    # table has actually been created. See the block right after
    # `CREATE TABLE IF NOT EXISTS subscribers_cache`.

    # Dashboard users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS crm_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT,
            crm_panel_id INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (crm_panel_id) REFERENCES crm_panels(id)
        )
    ''')
    # Admin flag — admins can review pending webhook domain approvals.
    _ensure_column(cursor, 'crm_users', 'is_admin', 'INTEGER DEFAULT 0')
    # Suspend flag — admin can disable a user without deleting (their API
    # key resolution still works, but verify_api_key/_require_admin treat
    # suspended users as 401). Default 0 keeps every existing user active.
    _ensure_column(cursor, 'crm_users', 'is_suspended', 'INTEGER DEFAULT 0')
    # Email verification fields. DEFAULT 1 so every existing user is
    # auto-grandfathered as verified — only NEW signups via the free-tier
    # /api/auth/register flow explicitly start at 0 and need to consume a
    # token to flip to 1. verification_token is NULL whenever there's no
    # active link outstanding (after consumption or never sent).
    _ensure_column(cursor, 'crm_users', 'email_verified', 'INTEGER DEFAULT 1')
    _ensure_column(cursor, 'crm_users', 'verification_token', 'TEXT')
    _ensure_column(cursor, 'crm_users', 'verification_expires_at', 'TEXT')

    # Admin audit log — every privileged write goes here so we can answer
    # "who approved that webhook" / "who promoted that user". Append-only:
    # no UPDATE on this table from app code (only INSERTs).
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS admin_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            admin_email TEXT NOT NULL,
            action TEXT NOT NULL,
            target_kind TEXT,
            target_id TEXT,
            payload TEXT,
            ip TEXT,
            user_agent TEXT
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit(ts DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_admin_audit_email ON admin_audit(admin_email, ts DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit(action, ts DESC)')

    # 2FA sessions table (temporary storage)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS two_fa_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            email TEXT NOT NULL,
            otp_state TEXT,
            x_bc TEXT,
            x_hash TEXT,
            cookies TEXT,
            proxy TEXT,
            encrypted_password TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (crm_id) REFERENCES crm_panels(crm_id),
            UNIQUE(crm_id, email)
        )
    ''')

    # Event store
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS account_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            source_event_id TEXT,
            payload TEXT,
            occurred_at TEXT,
            created_at TEXT NOT NULL,
            UNIQUE(crm_id, of_user_id, event_type, source_event_id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_account_events_crm_created ON account_events(crm_id, created_at DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_account_events_type ON account_events(crm_id, event_type)')

    # Webhook subscriptions
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS webhooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            url TEXT NOT NULL,
            secret TEXT NOT NULL,
            event_types TEXT NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            consecutive_failures INTEGER DEFAULT 0,
            last_delivery_at TEXT,
            last_status_code INTEGER,
            created_at TEXT NOT NULL,
            UNIQUE(crm_id, url)
        )
    ''')
    # Domain-approval columns. `status` is pending until an admin approves
    # the URL's domain for this CRM; deliveries only fire when approved.
    _ensure_column(cursor, 'webhooks', 'status', "TEXT DEFAULT 'approved'")
    _ensure_column(cursor, 'webhooks', 'reject_reason', 'TEXT')
    _ensure_column(cursor, 'webhooks', 'reviewed_at', 'TEXT')

    # Approved (crm_id, domain) pairs. Once a domain is approved for a CRM,
    # subsequent webhooks on that domain auto-approve for that same CRM.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS webhook_approved_domains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            domain TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            approved_by TEXT,
            UNIQUE(crm_id, domain)
        )
    ''')

    # Webhook delivery attempts
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS webhook_deliveries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            webhook_id INTEGER NOT NULL,
            event_id INTEGER,
            attempt INTEGER DEFAULT 1,
            status TEXT NOT NULL,
            response_code INTEGER,
            response_snippet TEXT,
            next_retry_at TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries(status, next_retry_at)')

    # ---- Panel-level Telegram channel --------------------------------------
    #
    # PANEL-scoped, not account-scoped: one row per crm_id, UNIQUE on crm_id.
    # It is deliberately NOT in _ACCOUNT_SCOPED_PURGES — disconnecting one OF
    # account must not silently kill the panel's whole notification channel.
    #
    # `encrypted_bot_token` holds a Fernet ciphertext (encrypt_password) and is
    # populated ONLY in custom mode; shared mode carries no per-tenant secret at
    # all, it uses config.TELEGRAM_SHARED_BOT_TOKEN. Nothing in this row is ever
    # returned raw by the API — see crm_api._telegram_public().
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS telegram_integrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL UNIQUE,
            bot_mode TEXT NOT NULL DEFAULT 'shared',
            encrypted_bot_token TEXT,
            bot_username TEXT,
            chat_id TEXT,
            chat_title TEXT,
            chat_type TEXT,
            event_types TEXT NOT NULL DEFAULT '["*"]',
            is_active INTEGER NOT NULL DEFAULT 0,
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            last_delivery_at TEXT,
            last_error TEXT,
            paired_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    ''')

    # Single-use, short-lived pairing codes. The code travels in a t.me deep
    # link and comes back to us inside a `/start <code>` message, so it is the
    # only thing binding a Telegram chat to a CRM panel: it must expire and it
    # must not be replayable. `used_at IS NULL` in the redeem UPDATE is what
    # makes single-use atomic under concurrency, not a read-then-write.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS telegram_pairing_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            crm_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_telegram_codes_open '
                   'ON telegram_pairing_codes(used_at, expires_at)')

    # getUpdates cursor, keyed by a fingerprint of the bot token rather than the
    # token — this table would otherwise be a second, unencrypted copy of every
    # tenant's secret. Rotating a token yields a new fingerprint, which resets
    # the offset, which is the correct behaviour for a different bot.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS telegram_bot_state (
            token_fingerprint TEXT PRIMARY KEY,
            update_offset INTEGER NOT NULL DEFAULT 0,
            last_polled_at TEXT,
            last_error TEXT
        )
    ''')

    # Automations (trigger + condition + action)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS automations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT,
            name TEXT NOT NULL,
            trigger_event TEXT NOT NULL,
            conditions TEXT,
            action_type TEXT NOT NULL,
            action_params TEXT,
            is_active INTEGER DEFAULT 1,
            last_run_at TEXT,
            run_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        )
    ''')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_automations_trigger ON automations(crm_id, trigger_event, is_active)')

    # Automation run log
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS automation_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            automation_id INTEGER NOT NULL,
            event_id INTEGER,
            status TEXT NOT NULL,
            error_snippet TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (automation_id) REFERENCES automations(id)
        )
    ''')

    # Fans (seen via events)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS fans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            fan_of_user_id TEXT NOT NULL,
            username TEXT,
            display_name TEXT,
            avatar TEXT,
            first_seen_at TEXT,
            last_seen_at TEXT,
            UNIQUE(crm_id, of_user_id, fan_of_user_id)
        )
    ''')

    # Subscribers cache — one row per (crm, of_account, fan).
    # Populated by subscribers_sync.delta_sync_subscribers. `subscribed_at` is
    # the canonical ordering key — delta-sync walks /subscribers/latest (which
    # is sorted by most recent subscribe/renewal) and stops when (fan_of_user_id,
    # subscribed_at) already matches a DB row. `raw_json` keeps the full OF
    # payload so callers don't re-hit OF when they want richer fields.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscribers_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            fan_of_user_id TEXT NOT NULL,
            username TEXT,
            display_name TEXT,
            avatar TEXT,
            subscribed_at TEXT,
            expired_at TEXT,
            subscribe_price REAL,
            total_spent REAL,
            -- Spending breakdown from subscribedOnData (OF's server-side aggregate)
            spent_tips REAL,
            spent_messages REAL,
            spent_posts REAL,
            spent_streams REAL,
            spent_subscriptions REAL,
            is_active INTEGER DEFAULT 1,
            campaign_id TEXT,
            raw_json TEXT,
            last_synced_at TEXT NOT NULL,
            UNIQUE(crm_id, of_user_id, fan_of_user_id)
        )
    ''')
    # `is_active` here is a DECAYING CACHE of SUBSCRIPTION_ACTIVE_SQL, not the
    # source of truth — see that constant, and the invariant note in
    # list_cached_subscribers for why the reads still lean on it. It stays in
    # the index because dropping it costs 20x on the hot subscriber page
    # (measured: 0.115ms → 2.15ms at 3M rows, plus a temp b-tree sort).
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_subs_cache_account
                      ON subscribers_cache(crm_id, of_user_id, is_active, subscribed_at DESC)''')

    # Breakdown columns were added in a later iteration after subscribers_cache
    # first shipped. For freshly-created DBs the CREATE TABLE above already has
    # them; for existing deployments, _ensure_column ALTERs them in.
    _ensure_column(cursor, 'subscribers_cache', 'spent_tips', 'REAL')
    _ensure_column(cursor, 'subscribers_cache', 'spent_messages', 'REAL')
    _ensure_column(cursor, 'subscribers_cache', 'spent_posts', 'REAL')
    _ensure_column(cursor, 'subscribers_cache', 'spent_streams', 'REAL')
    _ensure_column(cursor, 'subscribers_cache', 'spent_subscriptions', 'REAL')
    # OF custom-list memberships ("whales", "VIP", … — the creator's own groups,
    # type='custom' in the subscriber payload's listsStates). Stored as a JSON
    # array of list names, refreshed on every subscriber sync. Surfaced as
    # auto-imported tags on the Fans page. NULL = not synced / not in any list.
    _ensure_column(cursor, 'subscribers_cache', 'of_lists', 'TEXT')
    # 'subscribe' | 'renewal' | NULL — what the event at `subscribed_at` was.
    # OF moves subscribed_at forward on every renewal, so a date-window count of
    # subscribed_at alone mixes brand-new subs with renewals. Taken from the
    # latest subscribedByData.subscribes[].action (the same rule poller.py uses
    # to pick new_subscriber vs renewed_subscriber). NULL on rows written before
    # this column existed and on Fansly rows (whose subscribed_at is the
    # subscription's createdAt and never moves on renewal) — readers fall back
    # to raw_json, see panel_new_subscribers.
    _ensure_column(cursor, 'subscribers_cache', 'subscribe_action', 'TEXT')
    # Per-fan private note (a "note to self", mirroring OnlyFans' fan note).
    # Local-only — OF does not expose fan notes via the API.
    _ensure_column(cursor, 'fans', 'note', 'TEXT')

    # Transactions cache — one row per OF payout ledger entry. Populated by
    # transactions_sync. We NEVER do an unbounded initial backfill (creators
    # with millions of tx would take hours); the first sync is bounded to a
    # window (default 30 days / 30 pages), and the delta walker fills forward
    # from there with no gaps by stopping at the newest known tx id.
    #
    # `tx_id` is OF's own stable hex string — used as the delta-stop key and
    # as the dedup constraint. `fan_of_user_id` is pulled from the embedded
    # `user.id` in the OF payload so we can attribute spending without joining.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transactions_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            tx_id TEXT NOT NULL,
            fan_of_user_id TEXT,
            fan_username TEXT,
            amount REAL,
            net REAL,
            fee REAL,
            vat_amount REAL,
            tax_amount REAL,
            media_tax_amount REAL,
            currency TEXT,
            description TEXT,
            tx_type TEXT,
            status TEXT,
            created_at TEXT,
            raw_json TEXT,
            synced_at TEXT NOT NULL,
            UNIQUE(crm_id, of_user_id, tx_id)
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_tx_cache_account_time
                      ON transactions_cache(crm_id, of_user_id, created_at DESC)''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_tx_cache_fan
                      ON transactions_cache(crm_id, of_user_id, fan_of_user_id, created_at DESC)''')

    # Campaign claimers cache — one row per (account, campaign, fan). The
    # /campaigns/{cid}/claimers response is minimal (no subscribedOnData /
    # spending fields), so this cache only stores the claimer-level membership.
    # Spending is resolved at read time by JOINing against `subscribers_cache`
    # — a fan who claimed a campaign IS by definition a subscriber, so the
    # weekly subs refresh already has their totalSumm. The JOIN is pure SQL
    # (free), which is why we don't try to call /users/{id} per claimer
    # (~1.8s each × 100s of claimers = many minutes per campaign).
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS campaign_claimers_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            campaign_id TEXT NOT NULL,
            fan_of_user_id TEXT NOT NULL,
            fan_username TEXT,
            claimed_at TEXT,
            raw_json TEXT,
            synced_at TEXT NOT NULL,
            UNIQUE(crm_id, of_user_id, campaign_id, fan_of_user_id)
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_claimers_campaign
                      ON campaign_claimers_cache(crm_id, of_user_id, campaign_id)''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_claimers_fan
                      ON campaign_claimers_cache(crm_id, of_user_id, fan_of_user_id)''')

    # Fan tags
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS fan_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fan_id INTEGER NOT NULL,
            tag TEXT NOT NULL,
            added_at TEXT NOT NULL,
            added_by TEXT,
            FOREIGN KEY (fan_id) REFERENCES fans(id),
            UNIQUE(fan_id, tag)
        )
    ''')

    # Campaign tags — campaigns are an OF-side resource with no local row
    # (only campaign_claimers_cache exists), so unlike fan_tags there is no FK
    # to reference. We store the full (crm_id, of_user_id, campaign_id) tuple
    # directly, mirroring campaign_claimers_cache's keying.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS campaign_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            campaign_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            added_at TEXT NOT NULL,
            added_by TEXT,
            UNIQUE(crm_id, of_user_id, campaign_id, tag)
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_campaign_tags_acct
                      ON campaign_tags(crm_id, of_user_id)''')

    # Account tags — the third instance of the fan_tags/campaign_tags pattern.
    #
    # Keyed by the (crm_id, of_user_id) tuple like campaign_tags rather than by
    # an of_accounts.id FK like fan_tags, and NOT just for symmetry: disconnect
    # deletes the of_accounts row immediately while the cached data is purged
    # later by the sweeper, so an FK-shaped purge
    # (`WHERE account_id IN (SELECT id FROM of_accounts …)`) would resolve to
    # zero rows by the time it ran and strand every tag forever. Carrying the
    # columns directly also puts the table in reach of the s12 drift guard and
    # of adopt_orphaned_accounts().
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS account_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            tag TEXT NOT NULL,
            added_at TEXT NOT NULL,
            added_by TEXT,
            UNIQUE(crm_id, of_user_id, tag)
        )
    ''')
    # The UNIQUE above auto-indexes (crm_id, of_user_id, tag) — that serves
    # "tags OF this account". The filter asks the opposite question ("accounts
    # WITH this tag"), whose leading columns are (crm_id, tag), so it needs its
    # own index; without it SQLite falls back to the UNIQUE index and inverts
    # the loop order, probing once per account in the panel instead of once per
    # match. of_user_id rides along as the third column so the seek is answered
    # entirely from the index (COVERING INDEX in the plan) — see the tag branch
    # of get_of_accounts and tests/test_account_tags.py s16/s17.
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_account_tags_tag
                      ON account_tags(crm_id, tag, of_user_id)''')

    # MCP feature flags + audit. The unsafe-proxy flag gates non-GET calls
    # through the generic OF proxy tool; off by default.
    _ensure_column(cursor, 'crm_panels', 'mcp_unsafe_proxy', 'INTEGER DEFAULT 0')

    # Vestigial. The hosted build used this to exempt a tenant from its monthly
    # API-call cap. There is no call cap in this build, so the column is kept
    # only so an existing database migrates cleanly; nothing reads it.
    _ensure_column(cursor, 'crm_panels', 'quota_override', 'INTEGER DEFAULT 1')

    # Per-CRM bypass of the flask-limiter per-minute caps (RATE_LIMIT_*).
    # Set to 1 manually for a tenant whose legitimate traffic exceeds the
    # anti-flood tiers. Off by default — the limiter request_filter in
    # crm_api.py reads it (cached) per request.
    _ensure_column(cursor, 'crm_panels', 'rate_limit_exempt', 'INTEGER DEFAULT 0')

    # Per-panel captcha provider key, Fernet-encrypted at rest like account
    # passwords. Optional: when NULL the panel uses the server-wide
    # TWOCAPTCHA_API_KEY from the environment. Set it from Settings when a panel
    # should spend against its own captcha balance rather than the operator's.
    _ensure_column(cursor, 'crm_panels', 'captcha_api_key', 'TEXT')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS mcp_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            crm_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            tool TEXT NOT NULL,
            status INTEGER NOT NULL,
            latency_ms INTEGER NOT NULL,
            args_redacted TEXT,
            error_snippet TEXT
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_mcp_audit_crm_ts
                      ON mcp_audit(crm_id, ts)''')

    # ── Multiple API keys per panel (Anthropic/OpenAI-style console) ─────────
    # crm_panels.api_key stays the canonical "primary" key (the dashboard JWT
    # flow uses it). It's mirrored here as an is_primary=1 'Default' row so it
    # shows in the key list and accrues per-key stats. Secondary keys live only
    # here. All keys for a panel share the panel's monthly quota.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            key TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            prefix TEXT NOT NULL,
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            last_used_at TEXT,
            revoked_at TEXT
        )
    ''')
    cursor.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_api_keys_crm ON api_keys(crm_id, revoked_at)')

    # Per-key daily request counters → time-series sparkline + totals + last-used.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS api_key_usage (
            api_key_id INTEGER NOT NULL,
            day TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            last_updated TEXT NOT NULL,
            PRIMARY KEY (api_key_id, day)
        )
    ''')
    # Per-key, per-month endpoint breakdown (route pattern, bounded cardinality).
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS api_key_endpoint_usage (
            api_key_id INTEGER NOT NULL,
            month TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (api_key_id, month, endpoint)
        )
    ''')

    # Request OUTCOMES — status code + latency per (bucket, tenant, route
    # pattern, method). The three tables above all count calls *before* the
    # handler runs (they exist to bill and cap), so none of them can tell a 200
    # from a 500. Owned by api_metrics.py, which also declares the schema so it
    # works standalone; declared here too because that is the house rule and
    # because a fresh DB must have it before the first request lands.
    # Panel-scoped, not account-scoped → deliberately absent from
    # _ACCOUNT_SCOPED_PURGES, same as api_usage / api_keys. Bounded by the
    # api_metrics retention sweep instead.
    try:
        import api_metrics as _api_metrics
        _api_metrics.ensure_schema(cursor)
    except Exception as _e:  # never block init on the observability table
        print(f'[crm_database] api_request_metrics schema skipped: {_e}')

    # The other half of the same question. api_request_metrics counts failures;
    # this keeps the individual ones with their response body, which is what an
    # operator needs in order to see what actually broke and report it. Same
    # panel-scoping and same "never block init" rule.
    try:
        import api_errors as _api_errors
        _api_errors.init(cursor)
    except Exception as _e:
        print(f'[crm_database] api_error_log schema skipped: {_e}')

    # Every account-connect attempt (incl. failures), with an encrypted copy of
    # the credentials, so support can inspect and re-test a broken connection
    # server-side. Internal/admin-only. Same "never block init" rule.
    try:
        import login_attempts as _login_attempts
        _login_attempts.init(cursor)
    except Exception as _e:
        print(f'[crm_database] login_attempts schema skipped: {_e}')

    # Dashboard 2FA (authenticator + recovery codes), pending login challenges
    # and the signed-in session list shown in Settings. Additive only.
    try:
        import account_security as _account_security
        _account_security.init(cursor)
    except Exception as _e:
        print(f'[crm_database] account_security schema skipped: {_e}')

    # Idempotent backfill: mirror every panel's primary api_key into api_keys.
    # UNIQUE(key) makes re-runs a no-op. One row per tenant → cheap.
    primary_rows = cursor.execute(
        'SELECT crm_id, api_key, created_at FROM crm_panels'
    ).fetchall()
    for _crm_id, _api_key, _created in primary_rows:
        _mirror_primary_api_key(cursor, _crm_id, _api_key, _created)

    # "Download your data" export jobs. One row per export request. Persistent
    # (unlike refresh_state, which is in-process/ephemeral) so a generated ZIP
    # survives restarts and can be downloaded later. The worker (export_runner)
    # writes status/phase/counts here; the DB row is the source of truth and the
    # SSE export.* events are just a live nudge.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS export_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT UNIQUE NOT NULL,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            platform TEXT,
            status TEXT NOT NULL DEFAULT 'queued',
            phase TEXT,
            data_types TEXT NOT NULL,
            since TEXT,
            until TEXT,
            include_media INTEGER DEFAULT 0,
            counts TEXT,
            warnings TEXT,
            file_path TEXT,
            file_name TEXT,
            file_size INTEGER,
            error TEXT,
            requested_by TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            expires_at TEXT
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_export_jobs_acct
                      ON export_jobs(crm_id, of_user_id, created_at DESC)''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_export_jobs_status
                      ON export_jobs(status, expires_at)''')

    # ---- Bulk account import ------------------------------------------------
    # Modelled on export_jobs (persistent, DB-row-is-truth, SSE is a nudge) with
    # one structural difference: the unit of work is a ROW, not a job, and the
    # row table IS the queue. The worker never holds the list in memory — it
    # claims a batch with one UPDATE and re-reads — which is what makes a
    # 600-account import resumable after a restart instead of restartable.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS import_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT UNIQUE NOT NULL,
            crm_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            source TEXT,
            default_platform TEXT DEFAULT 'onlyfans',
            format TEXT,
            delimiter TEXT,
            has_header INTEGER DEFAULT 0,
            total_rows INTEGER DEFAULT 0,
            counts TEXT,
            error TEXT,
            requested_by TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            heartbeat_at TEXT
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_import_jobs_crm
                      ON import_jobs(crm_id, created_at DESC)''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_import_jobs_status
                      ON import_jobs(status, created_at)''')

    # One row per account being imported. Secrets are Fernet ciphertext (same
    # helper as of_accounts.encrypted_password) and are NULLed the moment the
    # row reaches a terminal state — 600 OnlyFans passwords must not sit in this
    # file after the import finishes. `needs_2fa` is deliberately NOT terminal:
    # it still holds a credential because the whole point is that a human can
    # supply the code later, and config.IMPORT_CREDENTIAL_TTL_HOURS bounds it.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS import_job_rows (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            crm_id TEXT NOT NULL,
            row_index INTEGER NOT NULL,
            source_line INTEGER,
            lane TEXT NOT NULL DEFAULT 'password',
            platform TEXT NOT NULL DEFAULT 'onlyfans',
            email TEXT,
            label TEXT,
            proxy TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            encrypted_password TEXT,
            encrypted_totp_secret TEXT,
            encrypted_cookies TEXT,
            otp_state TEXT,
            x_bc TEXT,
            x_hash TEXT,
            encrypted_2fa_cookies TEXT,
            two_fa_expires_at TEXT,
            of_user_id TEXT,
            username TEXT,
            error TEXT,
            error_reason TEXT,
            permanent INTEGER DEFAULT 0,
            attempts INTEGER DEFAULT 0,
            claim_token TEXT,
            claimed_at TEXT,
            started_at TEXT,
            finished_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            UNIQUE(job_id, row_index)
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_import_rows_claim
                      ON import_job_rows(job_id, lane, status, row_index)''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_import_rows_2fa
                      ON import_job_rows(crm_id, status, two_fa_expires_at)''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_import_rows_job
                      ON import_job_rows(job_id, row_index)''')

    # Tombstones for disconnected accounts. One row per (crm_id, of_user_id)
    # whose `of_accounts` row is gone but whose cached data is still on disk,
    # waiting out config.ACCOUNT_DATA_RETENTION_DAYS. This table does three jobs
    # with one row:
    #   1. tells the sweeper (scheduler `internal.account_purge`) what to
    #      hard-delete once `purge_after` has passed;
    #   2. hides the leftovers from the panel-wide reads *immediately* —
    #      list_fans() and list_events() accept of_user_id=None, so without this
    #      a disconnected creator's fans and events would keep showing on the
    #      Fans/Activity pages for the whole retention window;
    #   3. is deleted by add_of_account() on reconnect, which is what makes
    #      "disconnect by mistake, reconnect, get your history back" work.
    # Bounded by definition: one row per pending purge, removed when it runs.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS account_data_retention (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            crm_id TEXT NOT NULL,
            of_user_id TEXT NOT NULL,
            disconnected_at TEXT NOT NULL,
            purge_after TEXT NOT NULL,
            UNIQUE(crm_id, of_user_id)
        )
    ''')
    cursor.execute('''CREATE INDEX IF NOT EXISTS idx_account_retention_due
                      ON account_data_retention(purge_after)''')

    conn.commit()
    conn.close()

    # Re-derive tx_type for already-synced Fansly ledger rows from their wallet
    # type code. Rows written before _classify_tx honoured the explicit type
    # were keyword-classified off a description that embeds the fan's display
    # name. Idempotent (only rows whose stored type differs are touched), so
    # after the first start this is a cheap no-op. Never blocks init.
    try:
        import fansly_wallet as _fwallet
        reclassify_fansly_tx_types(_fwallet.TX_TYPE_BY_CODE,
                                   _fwallet.EARNINGS_WALLET_DESTINATION)
    except Exception as _e:
        print(f'[crm_database] fansly tx reclassification skipped: {_e}')


def hash_password(password):
    """Hash a password using bcrypt with a random salt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12)).decode('utf-8')


def verify_password(password, password_hash):
    """Verify a password against a stored bcrypt hash."""
    if not password_hash:
        return False
    
    # Check if this is a bcrypt hash (starts with $2b$)
    if not password_hash.startswith('$2'):
        # Old SHA-256 hash - password needs to be reset
        print("Warning: Account uses old password hash format. Please re-register.")
        return False
    
    try:
        return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
    except ValueError:
        # Invalid hash format
        return False


def create_user(email, password, name=None, email_verified=True):
    """
    Create a new dashboard user and auto-create a CRM panel.

    Args:
        email_verified: When False, the user starts unverified — login will
            be refused until they consume a verification token via
            start_email_verification + consume_verification_token. Defaults
            to True so existing callers (NextAuth's fallback register path)
            don't accidentally trap their users behind a verification step.

    Returns:
        dict: User data with crm_id and api_key
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Check if email already exists
    cursor.execute('SELECT id FROM crm_users WHERE email = ?', (email,))
    if cursor.fetchone():
        conn.close()
        raise Exception('Email already registered')

    # Create a CRM panel for this user
    crm_id = f'crm_{secrets.token_hex(8)}'
    api_key = secrets.token_urlsafe(32)
    created_at = datetime.utcnow().isoformat()
    panel_name = name or email.split('@')[0]

    # quota_override=1 by default so new panels are NOT capped by the free-tier
    # monthly API-call limit (avoids the "API call limit reached" errors that
    # break account refresh). Clear the override per-panel to enforce the cap.
    cursor.execute(
        'INSERT INTO crm_panels (crm_id, name, api_key, created_at, quota_override) VALUES (?, ?, ?, ?, 1)',
        (crm_id, panel_name, api_key, created_at)
    )
    panel_id = cursor.lastrowid
    # Mirror the primary key into api_keys so it lists + accrues stats.
    _mirror_primary_api_key(cursor, crm_id, api_key, created_at)

    # Create user with bcrypt hashed password
    password_hash = hash_password(password)
    cursor.execute(
        '''INSERT INTO crm_users
           (email, password_hash, name, crm_panel_id, created_at, email_verified)
           VALUES (?, ?, ?, ?, ?, ?)''',
        (email, password_hash, name, panel_id, created_at, 1 if email_verified else 0)
    )
    user_id = cursor.lastrowid

    conn.commit()
    conn.close()

    return {
        'user_id': user_id,
        'email': email,
        'name': name,
        'crm_id': crm_id,
        'api_key': api_key,
        'email_verified': bool(email_verified),
    }


def start_email_verification(email, ttl_hours=24):
    """Generate a fresh verification token for ``email`` and store it. Any
    prior outstanding token for this user is overwritten (one live link at
    a time). Returns (token, expires_at_iso) or raises if the user is gone.
    The token itself is what the caller embeds in the verification URL — it
    must be opaque, single-use, and the consume step must compare in
    constant time."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('SELECT id FROM crm_users WHERE LOWER(email) = LOWER(?)', (email,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise Exception('User not found')
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.utcnow() + timedelta(hours=int(ttl_hours))).isoformat()
    cur.execute(
        'UPDATE crm_users SET verification_token = ?, verification_expires_at = ? WHERE id = ?',
        (token, expires_at, row[0])
    )
    conn.commit()
    conn.close()
    return token, expires_at


def consume_verification_token(token):
    """Atomically validate ``token`` and, if valid + unexpired, mark the
    matching user as ``email_verified=1`` and clear the token. Returns the
    user's email on success, or None on any failure (unknown, expired,
    already-consumed). Single SQL UPDATE so two concurrent clicks can't
    both succeed."""
    if not token:
        return None
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # SELECT first so we can return the email; the UPDATE then clears the
    # token. Wrapped in an IF: only succeeds if token still matches and
    # hasn't expired — guards against a second click after the first.
    cur.execute(
        '''SELECT id, email FROM crm_users
           WHERE verification_token = ?
             AND (verification_expires_at IS NULL OR verification_expires_at > ?)''',
        (token, datetime.utcnow().isoformat()),
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        return None
    cur.execute(
        '''UPDATE crm_users
           SET email_verified = 1,
               verification_token = NULL,
               verification_expires_at = NULL
           WHERE id = ? AND verification_token = ?''',
        (row['id'], token),
    )
    if cur.rowcount == 0:
        # Race: another click consumed it between our SELECT and UPDATE.
        conn.close()
        return None
    conn.commit()
    email = row['email']
    conn.close()
    return email


def set_user_password(email, new_password):
    """Update a user's password hash. Returns True if a row was updated,
    False if the email is unknown. Used by the dashboard's reset-password
    flow to keep Flask in sync — without this, a user who resets via the
    dashboard could log in there but theonlyapi's NextAuth (which calls
    Flask /api/auth/login) would still reject the new password."""
    hashed = hash_password(new_password)
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute(
        'UPDATE crm_users SET password_hash = ? WHERE LOWER(email) = LOWER(?)',
        (hashed, email),
    )
    changed = cur.rowcount
    conn.commit()
    conn.close()
    return changed > 0


def is_email_verified(email):
    """True when ``email`` exists AND email_verified=1. Unknown emails are
    treated as unverified — callers should not leak the distinction."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT email_verified FROM crm_users WHERE LOWER(email) = LOWER(?)', (email,))
    row = cur.fetchone()
    conn.close()
    return bool(row and row['email_verified'])


def authenticate_user(email, password):
    """
    Authenticate a dashboard user.

    Returns:
        dict: User data with crm_id and api_key, or None if invalid
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute('''
        SELECT u.*, p.crm_id, p.api_key
        FROM crm_users u
        JOIN crm_panels p ON u.crm_panel_id = p.id
        WHERE u.email = ?
    ''', (email,))
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    if not verify_password(password, row['password_hash']):
        return None

    return {
        'user_id': row['id'],
        'email': row['email'],
        'name': row['name'],
        'crm_id': row['crm_id'],
        'api_key': row['api_key'],
        'is_admin': bool(row['is_admin']) if 'is_admin' in row.keys() else False,
    }


def is_user_admin(crm_id, email):
    """Is the user identified by (crm_id via api_key) + email a known admin?"""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT u.is_admin FROM crm_users u
                   JOIN crm_panels p ON p.id = u.crm_panel_id
                   WHERE p.crm_id = ? AND u.email = ?''',
                (crm_id, email))
    row = cur.fetchone()
    conn.close()
    return bool(row and row['is_admin'])


def set_user_admin(email, is_admin=True):
    """Promote/demote a user by email. Returns True if a row was updated."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('UPDATE crm_users SET is_admin = ? WHERE email = ?',
                (1 if is_admin else 0, email))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def create_crm_panel(name):
    """
    Create a new CRM panel.

    Args:
        name (str): Name of the CRM panel

    Returns:
        dict: CRM panel data with crm_id and api_key
    """
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    crm_id = f'crm_{secrets.token_hex(8)}'
    api_key = secrets.token_urlsafe(32)
    created_at = datetime.utcnow().isoformat()

    # quota_override=1 by default (see register-CRM path above for rationale).
    cursor.execute(
        'INSERT INTO crm_panels (crm_id, name, api_key, created_at, quota_override) VALUES (?, ?, ?, ?, 1)',
        (crm_id, name, api_key, created_at)
    )
    _mirror_primary_api_key(cursor, crm_id, api_key, created_at)

    conn.commit()
    panel_id = cursor.lastrowid
    conn.close()

    return {
        'id': panel_id,
        'crm_id': crm_id,
        'name': name,
        'api_key': api_key,
        'created_at': created_at
    }


def get_crm_panel(crm_id):
    """Get CRM panel by crm_id."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute('SELECT * FROM crm_panels WHERE crm_id = ?', (crm_id,))
    row = cursor.fetchone()
    conn.close()

    return dict(row) if row else None


def get_panel_captcha_key(crm_id):
    """This panel's own captcha provider key, decrypted, or None.

    None means "use the server-wide default" — callers should fall back to
    ``config.TWOCAPTCHA_API_KEY`` rather than treating this as an error.
    """
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('SELECT captcha_api_key FROM crm_panels WHERE crm_id = ?', (crm_id,))
    row = cursor.fetchone()
    conn.close()

    if not row or not row[0]:
        return None
    try:
        return decrypt_password(row[0])
    except Exception:
        # A key encrypted under a different ENCRYPTION_KEY cannot be recovered.
        # Fall back to the server default rather than failing every login.
        print(f'[captcha] could not decrypt stored key for {crm_id}; using server default')
        return None


def set_panel_captcha_key(crm_id, api_key):
    """Store (or clear, with None/empty) this panel's captcha provider key.

    Returns True if the panel exists. The value is Fernet-encrypted at rest,
    the same as stored account passwords.
    """
    stored = encrypt_password(api_key.strip()) if api_key and api_key.strip() else None

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute(
        'UPDATE crm_panels SET captcha_api_key = ? WHERE crm_id = ?',
        (stored, crm_id),
    )
    changed = cursor.rowcount > 0
    conn.commit()
    conn.close()

    return changed


def rotate_api_key(crm_id):
    """Generate a fresh API key for a CRM panel and replace the old one.

    The old key stops resolving immediately (``api_key`` is UNIQUE, so
    ``find_crm_by_api_key`` / ``verify_api_key`` no longer match it). Returns
    ``{'crm_id', 'api_key', 'old_api_key'}`` on success so the caller can also
    invalidate any cached resolution of the previous key, or ``None`` if no
    panel exists for ``crm_id``.

    Generated with ``secrets.token_urlsafe(32)`` to match the format used by
    ``create_crm_panel`` / the registration path.
    """
    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()
        cursor.execute('SELECT api_key FROM crm_panels WHERE crm_id = ?', (crm_id,))
        row = cursor.fetchone()
        if not row:
            return None
        old_api_key = row[0]

        new_api_key = secrets.token_urlsafe(32)
        cursor.execute(
            'UPDATE crm_panels SET api_key = ? WHERE crm_id = ?',
            (new_api_key, crm_id),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return None
        # Keep the is_primary mirror in sync — otherwise the OLD key would still
        # resolve via api_keys. This is the load-bearing coupling for rotation.
        cursor.execute(
            'UPDATE api_keys SET key = ?, prefix = ? WHERE crm_id = ? AND is_primary = 1',
            (new_api_key, _key_prefix(new_api_key), crm_id),
        )
        if cursor.rowcount == 0:
            # Older panel with no mirror yet — create one.
            _mirror_primary_api_key(cursor, crm_id, new_api_key)
        conn.commit()
        return {
            'crm_id': crm_id,
            'api_key': new_api_key,
            'old_api_key': old_api_key,
        }
    finally:
        conn.close()


def verify_api_key(crm_id, api_key):
    """Verify API key for a CRM panel using a constant-time compare.

    Looking up rows by ``crm_id AND api_key`` would let SQLite's byte-by-byte
    TEXT comparison leak the first differing byte via response timing. Instead
    we look up by ``crm_id`` only and compare the stored key with
    ``hmac.compare_digest``.
    """
    if not crm_id or not api_key:
        return False
    import hmac
    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT api_key FROM crm_panels WHERE crm_id = ?',
            (crm_id,),
        )
        row = cursor.fetchone()
        # Primary key path (unchanged: constant-time, no byte-leak via crm_id-only
        # lookup). A match short-circuits.
        if row and row[0] and hmac.compare_digest(str(row[0]), str(api_key)):
            return True
        # Secondary key path: single-row indexed lookup on the UNIQUE `key`
        # column (active only) — same anti-leak property find_crm_by_api_key
        # relies on. NOT 'WHERE crm_id=? AND key=?' (that re-introduces the
        # byte-by-byte timing leak the primary path deliberately avoids).
        cursor.execute(
            'SELECT crm_id, key FROM api_keys WHERE key = ? AND revoked_at IS NULL LIMIT 1',
            (api_key,),
        )
        krow = cursor.fetchone()
    finally:
        conn.close()
    if not krow:
        # Dummy compare so the not-found branch isn't trivially distinguishable
        # by wall clock from the wrong-key branch.
        hmac.compare_digest(api_key, '\x00' * 64)
        return False
    # Constant-time compare + tenant-scope check (reject a valid key for another panel).
    return hmac.compare_digest(str(krow[1]), str(api_key)) and str(krow[0]) == str(crm_id)


def find_crm_by_api_key(api_key):
    """
    Look up a CRM panel by API key only (no crm_id needed).
    Used by /api/whoami so the MCP server can resolve a bearer token
    to a crm_id. `api_key` is UNIQUE on crm_panels so the lookup is indexed.
    """
    if not api_key:
        return None
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.execute(
            'SELECT crm_id, name, mcp_unsafe_proxy, created_at FROM crm_panels WHERE api_key = ? LIMIT 1',
            (api_key,),
        )
        row = cursor.fetchone()
        if row:
            return dict(row)
        # Secondary key → resolve via api_keys (active only), join panel meta so
        # callers (whoami, MCP, _require_admin) get the same shape as the primary.
        cursor = conn.execute(
            '''SELECT p.crm_id, p.name, p.mcp_unsafe_proxy, p.created_at
               FROM api_keys ak JOIN crm_panels p ON ak.crm_id = p.crm_id
               WHERE ak.key = ? AND ak.revoked_at IS NULL LIMIT 1''',
            (api_key,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ── Multiple-API-key management ──────────────────────────────────────────────

def resolve_api_key_id(api_key):
    """Active api_keys.id for a key (primary mirror or secondary), or None.
    Single indexed lookup on the UNIQUE `key` column."""
    if not api_key:
        return None
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.execute(
            'SELECT id FROM api_keys WHERE key = ? AND revoked_at IS NULL LIMIT 1',
            (api_key,),
        )
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def is_rate_limit_exempt_key(api_key):
    """True iff `api_key` belongs to a panel with rate_limit_exempt=1.
    Accepts either the panel's legacy primary key (crm_panels.api_key) or an
    active row in api_keys. Fail-closed: any error means not exempt."""
    if not api_key:
        return False
    conn = sqlite3.connect(DB_FILE)
    try:
        row = conn.execute(
            '''SELECT 1 FROM crm_panels p
               WHERE p.rate_limit_exempt = 1
                 AND (p.api_key = ?
                      OR p.crm_id IN (SELECT k.crm_id FROM api_keys k
                                      WHERE k.key = ? AND k.revoked_at IS NULL))
               LIMIT 1''',
            (api_key, api_key),
        ).fetchone()
        return row is not None
    except Exception:
        return False
    finally:
        conn.close()


def is_primary_api_key(crm_id, api_key):
    """True iff `api_key` is the panel's PRIMARY key (constant-time). Used to
    gate key-management operations so a leaked secondary key can't mint/revoke."""
    if not crm_id or not api_key:
        return False
    import hmac
    conn = sqlite3.connect(DB_FILE)
    try:
        row = conn.execute(
            'SELECT api_key FROM crm_panels WHERE crm_id = ?', (crm_id,)
        ).fetchone()
    finally:
        conn.close()
    if not row or not row[0]:
        hmac.compare_digest(api_key, '\x00' * 64)
        return False
    return hmac.compare_digest(str(row[0]), str(api_key))


def create_api_key(crm_id, name):
    """Mint a new SECONDARY API key for a panel. Returns the full key dict once
    (caller must surface `key` to the user — it's not retrievable again)."""
    if not crm_id:
        return None
    name = (str(name or '').strip() or 'Untitled key')[:60]
    key = secrets.token_urlsafe(32)
    created_at = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        if not cur.execute('SELECT 1 FROM crm_panels WHERE crm_id = ?', (crm_id,)).fetchone():
            return None
        cur.execute(
            '''INSERT INTO api_keys (crm_id, key, name, prefix, is_primary, created_at)
               VALUES (?, ?, ?, ?, 0, ?)''',
            (crm_id, key, name, _key_prefix(key), created_at),
        )
        conn.commit()
        return {
            'id': cur.lastrowid, 'crm_id': crm_id, 'key': key, 'name': name,
            'prefix': _key_prefix(key), 'is_primary': 0, 'created_at': created_at,
            'last_used_at': None, 'revoked_at': None,
        }
    finally:
        conn.close()


def list_api_keys(crm_id):
    """All keys for a panel (active + revoked), primary first then newest.
    Never returns full key bodies — only the display prefix."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            '''SELECT id, name, prefix, is_primary, created_at, last_used_at, revoked_at
               FROM api_keys WHERE crm_id = ?
               ORDER BY is_primary DESC, created_at DESC''',
            (crm_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_api_key(crm_id, key_id):
    """One key's metadata (no full key), scoped to the panel. None if not found."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            '''SELECT id, crm_id, name, prefix, is_primary, created_at, last_used_at, revoked_at
               FROM api_keys WHERE crm_id = ? AND id = ? LIMIT 1''',
            (crm_id, key_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def revoke_api_key(crm_id, key_id):
    """Revoke a SECONDARY key. Refuses the primary mirror and already-revoked
    rows. Returns the revoked key string (for cache invalidation) or None."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        row = cur.execute(
            'SELECT key, is_primary, revoked_at FROM api_keys WHERE crm_id = ? AND id = ?',
            (crm_id, key_id),
        ).fetchone()
        if not row or row['is_primary'] or row['revoked_at']:
            return None
        cur.execute(
            'UPDATE api_keys SET revoked_at = ? WHERE crm_id = ? AND id = ? AND is_primary = 0',
            (datetime.utcnow().isoformat(), crm_id, key_id),
        )
        conn.commit()
        return row['key'] if cur.rowcount else None
    finally:
        conn.close()


def set_mcp_unsafe_proxy(crm_id, enabled):
    """Toggle the per-CRM flag that allows non-GET calls via the MCP escape hatch."""
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            'UPDATE crm_panels SET mcp_unsafe_proxy = ? WHERE crm_id = ?',
            (1 if enabled else 0, crm_id),
        )
        conn.commit()
    finally:
        conn.close()


def record_mcp_audit(crm_id, token_hash, tool, status, latency_ms, args_redacted=None, error_snippet=None):
    """Insert one row into mcp_audit. Best-effort: swallow any DB errors."""
    try:
        conn = sqlite3.connect(DB_FILE)
        conn.execute(
            'INSERT INTO mcp_audit (ts, crm_id, token_hash, tool, status, latency_ms, args_redacted, error_snippet) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (iso_utc_now(), crm_id, token_hash, tool, int(status), int(latency_ms), args_redacted, error_snippet),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f'[mcp_audit] insert failed: {e}')


def add_of_account(crm_id, of_user_id, email, password=None, username=None, x_bc=None, x_hash=None, proxy=None, avatar=None, about=None,
                   platform='onlyfans', fansly_auth_token=None, fansly_client_id=None, fansly_session_id=None):
    """
    Add a connected creator account (OnlyFans or Fansly) to a CRM panel.

    Args:
        crm_id (str): CRM panel ID
        of_user_id (str): Platform user/account ID (OF user id or Fansly account id)
        email (str): Account email
        password (str, optional): Account password (will be encrypted)
        username (str, optional): Account username
        x_bc (str, optional): OF x-bc value (OF only)
        x_hash (str, optional): OF x-hash value (OF only)
        proxy (str, optional): Proxy URL to use for this account
        avatar (str, optional): Avatar URL
        about (str, optional): About text
        platform (str): 'onlyfans' (default) or 'fansly'
        fansly_auth_token (str, optional): Fansly bearer token (Fansly only)
        fansly_client_id (str, optional): Fansly device id (Fansly only)
        fansly_session_id (str, optional): Fansly session id (Fansly only)

    Returns:
        dict: Account data
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        raise Exception(f'CRM panel {crm_id} not found')

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    created_at = datetime.utcnow().isoformat()

    # Encrypt password if provided
    encrypted_password = encrypt_password(password) if password else None

    # The outer try/finally is load-bearing. The close used to sit on the happy
    # path only, so ANY exception other than IntegrityError — an
    # OperationalError("database is locked") above all — leaked the connection
    # with its write transaction still open. That turns one moment of
    # contention into a PERMANENT lock, and the next caller to time out leaks
    # another: a cascade, not a blip.
    #
    # Invisible until now because every caller was a Flask request handler or a
    # scheduler job, i.e. effectively serial. The bulk importer writes from 16
    # threads and is the first thing to hit it — without this, one stall part
    # way through a 600-account import marks every remaining good account as
    # failed. See "Common gotchas" in CLAUDE.md: always try/finally conn.close().
    try:
        try:
            cursor.execute('''
                INSERT INTO of_accounts
                (crm_panel_id, of_user_id, email, username, x_bc, x_hash, proxy, encrypted_password, created_at, last_login, avatar, about,
                 platform, fansly_auth_token, fansly_client_id, fansly_session_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (panel['id'], of_user_id, email, username, x_bc, x_hash, proxy, encrypted_password, created_at, created_at, avatar, about,
                  platform, fansly_auth_token, fansly_client_id, fansly_session_id))

            conn.commit()
            account_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            # Account already exists — refresh credentials AND profile metadata.
            # COALESCE preserves existing values when a re-login call doesn't carry
            # one (e.g. /users/me failed silently, or the platform's session fields
            # aren't relevant to this login method).
            cursor.execute('''
                UPDATE of_accounts
                SET email = ?, username = ?, x_bc = ?, x_hash = ?, proxy = ?,
                    encrypted_password = COALESCE(?, encrypted_password), last_login = ?,
                    avatar = COALESCE(?, avatar), about = COALESCE(?, about),
                    platform = ?,
                    fansly_auth_token = COALESCE(?, fansly_auth_token),
                    fansly_client_id = COALESCE(?, fansly_client_id),
                    fansly_session_id = COALESCE(?, fansly_session_id),
                    relogin_blocked_at = NULL, relogin_block_reason = NULL,
                    relogin_block_code = NULL, relogin_block_action = NULL,
                    last_connection_state = NULL, last_connection_error_code = NULL,
                    last_connection_error_at = NULL,
                    polling_failure_count = 0,
                    verification_required_at = NULL, verification_reason = NULL,
                    verification_otp_state = NULL
                WHERE crm_panel_id = ? AND of_user_id = ?
            ''', (email, username, x_bc, x_hash, proxy, encrypted_password, created_at, avatar, about,
                  platform, fansly_auth_token, fansly_client_id, fansly_session_id, panel['id'], of_user_id))
            conn.commit()

            cursor.execute(
                'SELECT id FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
                (panel['id'], of_user_id)
            )
            account_id = cursor.fetchone()[0]

        # Reconnecting cancels a pending purge. The cache tables are keyed on
        # (crm_id, of_user_id), so everything this account had before the disconnect
        # lines straight back up — dropping the tombstone both saves it from the
        # sweeper and un-hides it from list_fans/list_events. No-op for a first-time
        # connect (no tombstone) and for an account that was purged outright.
        cursor.execute(
            'DELETE FROM account_data_retention WHERE crm_id = ? AND of_user_id = ?',
            (crm_id, str(of_user_id))
        )
        conn.commit()
    finally:
        conn.close()

    return {
        'id': account_id,
        'crm_panel_id': panel['id'],
        'of_user_id': of_user_id,
        'email': email,
        'username': username,
        'proxy': proxy,
        'avatar': avatar,
        'about': about,
        'platform': platform,
        'created_at': created_at
    }


def get_of_accounts(crm_id, search=None, tag=None):
    """Get the CRM panel's accounts, optionally filtered server-side.

    ``search`` matches username / email / of_user_id; ``tag`` keeps only
    accounts carrying that account_tag. Both are applied in SQL rather than in
    the caller: a panel bringing ~600 accounts onto the platform would
    otherwise ship the whole list on every keystroke, which is the exact thing
    the filter exists to avoid.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        return []

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Get available columns to handle schema migrations gracefully
    cursor.execute("PRAGMA table_info(of_accounts)")
    available_columns = [row[1] for row in cursor.fetchall()]
    
    # Build column list based on available columns
    base_columns = ['id', 'crm_panel_id', 'of_user_id', 'email', 'username',
                    'x_bc', 'x_hash', 'proxy', 'created_at', 'last_login']
    # polling_* and last_balance_* ride along so the dashboard can render a
    # panel-wide view from this one response. Without them the overview fell
    # back to one live call per account, serially, on every page load.
    optional_columns = ['avatar', 'about', 'platform',
                        'relogin_blocked_at', 'relogin_block_reason',
                        'relogin_block_code', 'relogin_block_action',
                        'last_connection_state', 'last_connection_error_code',
                        'last_connection_error_at',
                        'verification_required_at', 'verification_reason',
                        'verification_otp_state',
                        'polling_enabled', 'polling_interval_seconds',
                        'last_polled_at', 'polling_failure_count',
                        'last_balance_available', 'last_balance_pending',
                        'last_balance_currency', 'last_balance_at',
                        'last_balance_current', 'last_subscribers_refresh_at',
                        'proxy_country_code', 'proxy_country', 'proxy_geo_at',
                        'profile_country_code', 'profile_country',
                        # Internal — used by get_accounts to decide what still
                        # needs a background geo lookup, then popped from the
                        # response. Not part of the public account shape.
                        'proxy_geo_for', 'profile_country_at']
    
    columns = base_columns.copy()
    for col in optional_columns:
        if col in available_columns:
            columns.append(col)

    sql = (f"SELECT {', '.join(columns)} FROM of_accounts "
           "WHERE crm_panel_id = ?")
    params = [panel['id']]

    if search:
        # A leading-wildcard LIKE ('%q%') is unindexable by construction, so
        # this one is a filter rather than a seek — but the crm_panel_id term
        # is still a seek on the UNIQUE(crm_panel_id, of_user_id) auto-index,
        # so it only ever filters ONE tenant's rows, never the whole table.
        # Kept as a plain column comparison: wrapping it in LOWER() would make
        # it a derived predicate for no gain, since SQLite's LIKE is already
        # case-insensitive for ASCII.
        sql += " AND (username LIKE ? OR email LIKE ? OR of_user_id = ?)"
        needle = f'%{search}%'
        params.extend([needle, needle, str(search)])

    if tag:
        # `IN (subquery)`, NOT a correlated EXISTS, and the difference is
        # measured rather than assumed. Both forms hit an index, so both look
        # fine at a glance — but EXISTS makes account_tags the INNER loop, so
        # it probes once per account in the panel (600 probes to return 5), and
        # once ANALYZE has run SQLite drops the outer index entirely and picks
        # `SCAN of_accounts`. Measured at 600 accounts / 5 matches:
        #
        #   EXISTS        SCAN of_accounts + correlated probe   ~110 us
        #   IN (subquery) covering-index seek, then 5 probes      ~5.8 us
        #
        # This form drives FROM the tag index, so cost scales with the number
        # of MATCHES, not with the size of the panel. Every term is a bare
        # column = bound-value comparison on purpose: wrapping tag in LOWER()
        # or COLLATE would make it a derived predicate and knock it straight
        # back off idx_account_tags_tag.
        sql += (" AND of_user_id IN (SELECT of_user_id FROM account_tags"
                " WHERE crm_id = ? AND tag = ?)")
        params.extend([crm_id, tag])

    cursor.execute(sql, params)
    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]


def set_proxy_geo(crm_id, of_user_id, proxy_for, country_code, country):
    """Cache a proxy's resolved EXIT country on the account.

    `proxy_for` is the proxy string the geo was resolved for; storing it lets
    `backfill_account_geo` notice a changed proxy and re-resolve, so no
    proxy-write path has to remember to invalidate this. Pass all-None (with the
    current proxy as `proxy_for`) to record "resolved, but unknown" so we don't
    retry a dead proxy on every list load.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
                  SET proxy_country_code = ?, proxy_country = ?,
                      proxy_geo_for = ?, proxy_geo_at = ?
                WHERE crm_panel_id = ? AND of_user_id = ?''',
            (country_code, country, proxy_for, datetime.utcnow().isoformat(),
             panel['id'], of_user_id))
        conn.commit()
    finally:
        conn.close()


def set_profile_country(crm_id, of_user_id, country_code, country):
    """Cache the OnlyFans banking country (from /payouts/account) on the account.
    Pass None/None to record "resolved, unknown" and stop retrying."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
                  SET profile_country_code = ?, profile_country = ?,
                      profile_country_at = ?
                WHERE crm_panel_id = ? AND of_user_id = ?''',
            (country_code, country, datetime.utcnow().isoformat(), panel['id'], of_user_id))
        conn.commit()
    finally:
        conn.close()


def get_of_account(crm_id, of_user_id):
    """Get specific OnlyFans account for a CRM panel with decrypted password."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return None

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        'SELECT * FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
        (panel['id'], of_user_id)
    )
    row = cursor.fetchone()
    conn.close()

    if not row:
        return None

    account = dict(row)
    # Decrypt password for potential re-login
    if account.get('encrypted_password'):
        account['password'] = decrypt_password(account['encrypted_password'])
    else:
        account['password'] = None
    
    return account


def set_relogin_block(crm_id, of_user_id, reason, code='invalid_credentials',
                      action='reconnect'):
    """Disable auto-relogin for an account (e.g. OF rejected the stored
    password). Cleared by the next successful connect via add_of_account."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            'UPDATE of_accounts SET relogin_blocked_at = COALESCE(relogin_blocked_at, ?), '
            'relogin_block_reason = ?, relogin_block_code = ?, relogin_block_action = ? '
            'WHERE crm_panel_id = ? AND of_user_id = ?',
            (datetime.utcnow().isoformat(), reason, code, action,
             panel['id'], of_user_id)
        )
        conn.commit()
    finally:
        conn.close()


def clear_relogin_block(crm_id, of_user_id):
    """Clear all structured and legacy login-failure state."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
               SET relogin_blocked_at = NULL, relogin_block_reason = NULL,
                   relogin_block_code = NULL, relogin_block_action = NULL
               WHERE crm_panel_id = ? AND of_user_id = ?''',
            (panel['id'], of_user_id),
        )
        conn.commit()
    finally:
        conn.close()


def set_connection_error(crm_id, of_user_id, state, code=None):
    """Persist only a stable non-login state/code; never raw exception text."""
    allowed_codes = {
        'proxy_error': {'proxy_auth', 'proxy_reset', 'proxy_timeout', 'proxy_dns',
                        'proxy_connection', 'proxy_tls', 'proxy_error'},
        'rate_limited': {'rate_limited'},
        'sync_blocked': {'sync_blocked'},
        'temporary_error': {'temporary_error', 'transactions_unavailable'},
    }
    if state not in allowed_codes:
        return
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    safe_code = str(code or state)
    if safe_code not in allowed_codes[state]:
        safe_code = state
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
               SET last_connection_state = ?, last_connection_error_code = ?,
                   last_connection_error_at = ?
               WHERE crm_panel_id = ? AND of_user_id = ?''',
            (state, safe_code, datetime.utcnow().isoformat(), panel['id'], of_user_id),
        )
        conn.commit()
    finally:
        conn.close()


def clear_connection_error(crm_id, of_user_id):
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
               SET last_connection_state = NULL, last_connection_error_code = NULL,
                   last_connection_error_at = NULL
               WHERE crm_panel_id = ? AND of_user_id = ?''',
            (panel['id'], of_user_id),
        )
        conn.commit()
    finally:
        conn.close()


def set_verification_required(crm_id, of_user_id, reason, otp_state=None):
    """Flag an account as blocked behind a platform identity check.

    Deliberately NOT set_relogin_block: the password is right and the session
    is alive, so re-logging in buys a captcha solve and lands on the same
    wall. `verification_required_at` is only cleared by
    clear_verification_required (the gate actually lifting) or by a fresh
    successful connect. The first flag wins — re-stamping the timestamp on
    every subsequent 400 would make "waiting since" jump around in the UI."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
               SET verification_required_at = COALESCE(verification_required_at, ?),
                   verification_reason = ?,
                   verification_otp_state = ?
               WHERE crm_panel_id = ? AND of_user_id = ?''',
            (datetime.utcnow().isoformat(), reason,
             json.dumps(otp_state) if otp_state else None,
             panel['id'], str(of_user_id))
        )
        conn.commit()
    finally:
        conn.close()


def clear_verification_required(crm_id, of_user_id):
    """The identity gate lifted — the account is usable again."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
               SET verification_required_at = NULL, verification_reason = NULL,
                   verification_otp_state = NULL
               WHERE crm_panel_id = ? AND of_user_id = ?''',
            (panel['id'], str(of_user_id))
        )
        conn.commit()
    finally:
        conn.close()


# Every table keyed on (crm_id, of_user_id), children before parents so the
# id-subqueries still resolve. Enumerated from init_database(); if you add an
# account-scoped table, add it here too or its rows outlive the account forever.
#
# `automations` is filtered on `of_user_id = ?` and NOT on IS NULL: a NULL
# of_user_id means "all accounts on this panel", which must survive one account
# being disconnected. Deliberately absent: webhooks / webhook_approved_domains /
# api_keys / api_usage / mcp_audit / admin_audit — panel-scoped, not
# account-scoped. `webhook_deliveries.event_id` will dangle once the events go,
# but it is already a transient retry queue with no FK on that column.
_ACCOUNT_SCOPED_PURGES = (
    ('automation_runs', '''DELETE FROM automation_runs WHERE automation_id IN
                           (SELECT id FROM automations
                            WHERE crm_id = ? AND of_user_id = ?)'''),
    ('automations', 'DELETE FROM automations WHERE crm_id = ? AND of_user_id = ?'),
    ('fan_tags', '''DELETE FROM fan_tags WHERE fan_id IN
                    (SELECT id FROM fans WHERE crm_id = ? AND of_user_id = ?)'''),
    ('fans', 'DELETE FROM fans WHERE crm_id = ? AND of_user_id = ?'),
    ('subscribers_cache', 'DELETE FROM subscribers_cache WHERE crm_id = ? AND of_user_id = ?'),
    ('transactions_cache', 'DELETE FROM transactions_cache WHERE crm_id = ? AND of_user_id = ?'),
    ('campaign_claimers_cache', 'DELETE FROM campaign_claimers_cache WHERE crm_id = ? AND of_user_id = ?'),
    ('campaign_tags', 'DELETE FROM campaign_tags WHERE crm_id = ? AND of_user_id = ?'),
    ('account_tags', 'DELETE FROM account_tags WHERE crm_id = ? AND of_user_id = ?'),
    ('account_events', 'DELETE FROM account_events WHERE crm_id = ? AND of_user_id = ?'),
    ('export_jobs', 'DELETE FROM export_jobs WHERE crm_id = ? AND of_user_id = ?'),
    # import_job_rows is the one entry here that SCRUBS instead of DELETEs, and
    # the difference is deliberate.
    #
    # The row is job-scoped, not account-scoped: it is one line of "on 5 Aug the
    # operator imported 600 accounts; 587 succeeded, 9 needed a 2FA code, 4 were
    # rejected". Deleting one line out of that would silently rewrite the job's
    # own history — a 600-row job would render as 599 rows with counts that no
    # longer add up, and the operator would have no way to tell a row that was
    # never there from one whose account was later disconnected.
    #
    # But the row also carries the disconnected account's of_user_id, login
    # email, label and proxy, which is exactly the PII this list exists to
    # remove. So the purge detaches the row from the account (of_user_id → NULL,
    # which is what makes it invisible to every (crm_id, of_user_id) read,
    # including test_account_deletion's schema-drift counter) and destroys the
    # identifiers, leaving an anonymized placeholder that still counts.
    #
    # Credentials are not mentioned because they are already gone: a row cannot
    # reach `success` without zero_import_row_secrets() having run on it.
    ('import_job_rows', '''UPDATE import_job_rows
                              SET of_user_id = NULL, email = NULL, label = NULL,
                                  proxy = NULL, username = NULL,
                                  error = 'account disconnected — row scrubbed'
                            WHERE crm_id = ? AND of_user_id = ?'''),
    # Same shape, same reasoning, for the error log. A logged failure is a fact
    # about the PANEL's traffic — "your integration got four 403s at 14:02" —
    # and the error-rate history it feeds should not silently shrink because an
    # account was later disconnected. But the row carries that account's id in
    # `of_user_id`, and the response body can echo it too, so both are removed:
    # the row stays as evidence, detached and anonymized.
    ('api_error_log', '''UPDATE api_error_log
                            SET of_user_id = NULL,
                                path = NULL,
                                body = 'account disconnected — details scrubbed'
                          WHERE crm_id = ? AND of_user_id = ?'''),
)


def _purge_account_rows(cursor, crm_id, of_user_id):
    """Run every account-scoped DELETE on a caller-supplied cursor.

    Takes a cursor rather than opening its own connection so the purge can join
    an existing transaction — a half-applied purge would leave rows that nothing
    ever points at again, which is the exact failure this whole change exists to
    fix. Returns {table: rows_deleted} for logging/response bodies.
    """
    of_user_id = str(of_user_id)
    counts = {}
    for table, sql in _ACCOUNT_SCOPED_PURGES:
        cursor.execute(sql, (crm_id, of_user_id))
        if cursor.rowcount > 0:
            counts[table] = cursor.rowcount
    return counts


def _collect_export_files(cursor, crm_id, of_user_id):
    """Paths of export ZIPs belonging to this account, read BEFORE the rows go.

    Usually empty: export_runner.cleanup_expired() unlinks archives after
    EXPORT_RETENTION_DAYS (7) and nulls file_path, well inside the account
    retention window. It matters on the purge_now path, where dropping the row
    without the file would leave the single most sensitive artifact we produce —
    a ZIP containing the creator's whole history — on disk with no DB row left
    to ever sweep it.
    """
    cursor.execute(
        'SELECT file_path FROM export_jobs WHERE crm_id = ? AND of_user_id = ? '
        'AND file_path IS NOT NULL',
        (crm_id, str(of_user_id))
    )
    return [r[0] for r in cursor.fetchall() if r[0]]


def _unlink_export_files(paths):
    """Best-effort unlink. Called AFTER commit: a leftover file is recoverable
    (an admin can delete it), a file deleted for a transaction that then rolled
    back is not."""
    for p in paths:
        try:
            if _os.path.exists(p):
                _os.remove(p)
        except OSError as e:
            print(f'[purge_account_data] could not remove export {p}: {e}')


def purge_account_data(crm_id, of_user_id):
    """Hard-delete every cached row for one (crm_id, of_user_id) + its tombstone.

    Called by the scheduled sweeper once the retention window expires, and
    directly by delete_of_account(purge_now=True). Safe to call for an account
    that still exists (nothing here touches `of_accounts`), but you almost never
    want that — see delete_of_account for the intended entry point.
    """
    of_user_id = str(of_user_id)
    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()
        export_files = _collect_export_files(cursor, crm_id, of_user_id)
        counts = _purge_account_rows(cursor, crm_id, of_user_id)
        cursor.execute(
            'DELETE FROM account_data_retention WHERE crm_id = ? AND of_user_id = ?',
            (crm_id, of_user_id)
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _unlink_export_files(export_files)
    return counts


# Tables to scan for (crm_id, of_user_id) pairs with no account behind them.
# Only the ones that carry the columns directly — fan_tags / automation_runs
# hang off fans / automations and get swept with their parent. `automations` is
# excluded on purpose: of_user_id IS NULL there means "whole panel".
_ORPHAN_SCAN_TABLES = (
    'subscribers_cache', 'transactions_cache', 'fans', 'account_events',
    'campaign_claimers_cache', 'campaign_tags', 'account_tags', 'export_jobs',
)


def adopt_orphaned_accounts(now_iso=None):
    """Tombstone cached data whose account row is already gone.

    The pre-fix delete_of_account removed only the `of_accounts` row, so every
    account ever disconnected left its whole cache behind with nothing pointing
    at it — production was carrying ~1,500 such rows when this shipped, and no
    code path would ever have reclaimed them. Adopting them into the normal
    tombstone flow repairs that backlog with the same safeguards as a fresh
    disconnect: a full retention window before anything is deleted, and a
    reconnect cancels it.

    A cache row with no `of_accounts` row always means the account is gone —
    every writer (poller, subs/tx/campaign sync, the event bus) is driven either
    by a scheduled job for a connected account or by a route behind
    check_account_ownership, so nothing populates these tables ahead of the
    account existing.

    Returns the number of accounts adopted.
    """
    now_iso = now_iso or iso_utc_now()
    purge_after = (
        datetime.now(timezone.utc) + timedelta(days=config.ACCOUNT_DATA_RETENTION_DAYS)
    ).strftime('%Y-%m-%dT%H:%M:%S+00:00')
    union = ' UNION '.join(
        f'SELECT crm_id, of_user_id FROM {t}' for t in _ORPHAN_SCAN_TABLES)

    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        # INSERT OR IGNORE so an account already tombstoned keeps its original
        # (earlier) deadline instead of having the clock reset every 6 hours —
        # otherwise nothing would ever actually become due.
        cur.execute(f'''
            INSERT OR IGNORE INTO account_data_retention
                (crm_id, of_user_id, disconnected_at, purge_after)
            SELECT DISTINCT o.crm_id, o.of_user_id, ?, ?
            FROM ({union}) o
            WHERE NOT EXISTS (
                SELECT 1 FROM of_accounts a
                JOIN crm_panels p ON p.id = a.crm_panel_id
                WHERE p.crm_id = o.crm_id AND a.of_user_id = o.of_user_id
            )
        ''', (now_iso, purge_after))
        adopted = cur.rowcount
        conn.commit()
        return adopted
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def list_due_account_purges(now_iso=None):
    """Tombstones whose retention window has elapsed. Drives the sweeper."""
    now_iso = now_iso or iso_utc_now()
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            'SELECT crm_id, of_user_id, disconnected_at, purge_after '
            'FROM account_data_retention WHERE purge_after <= ? ORDER BY purge_after',
            (now_iso,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_of_account(crm_id, of_user_id, purge_now=False):
    """Disconnect a creator account from a CRM panel.

    Credentials go immediately and unconditionally: the `of_accounts` row (which
    holds the encrypted password, x_bc/x_hash and the Fansly bearer token) plus
    any half-finished 2FA session. Everything the account *accumulated* —
    subscribers, transactions, fans, tags, events, exports — is tombstoned
    instead, and hard-deleted by the `internal.account_purge` sweeper after
    config.ACCOUNT_DATA_RETENTION_DAYS.

    Why not delete it all here: fan tags, campaign tags, fan notes and the local
    `account_events` log are not re-fetchable from OF/Fansly, and the tx backfill
    is bounded to a window so old transactions never come back either. One
    misclicked "Disconnect" would be unrecoverable. Why not keep it forever
    (the old behaviour): a single disconnected account left 951 orphaned rows
    behind, nothing ever reclaimed them, and a former creator's fan list and
    money ledger sat in the DB indefinitely. The tombstone gives us bounded
    growth (churn × retention window) *and* an undo, and hides the leftovers
    from the panel-wide reads meanwhile so the UI behaves as if they were gone.

    purge_now=True skips the window and erases immediately — for a genuine
    "delete my data" request, where the retention window is the wrong answer.

    Returns {'purged': bool, 'counts': {table: rows}, 'purge_after': iso|None}.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        raise Exception(f"CRM panel not found: {crm_id}")

    of_user_id = str(of_user_id)
    now = iso_utc_now()
    purge_after = now if purge_now else (
        datetime.now(timezone.utc) + timedelta(days=config.ACCOUNT_DATA_RETENTION_DAYS)
    ).strftime('%Y-%m-%dT%H:%M:%S+00:00')

    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()

        # Read the email BEFORE the account row goes. The old code ran the 2FA
        # delete with a `(SELECT email FROM of_accounts ...)` subquery *after*
        # the DELETE above it, in the same transaction — so the subquery saw the
        # row already gone, returned NULL, `email = NULL` matched nothing, and
        # 2FA sessions were never actually cleaned up.
        row = cursor.execute(
            'SELECT email FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
            (panel['id'], of_user_id)
        ).fetchone()
        email = row[0] if row else None

        export_files = []
        counts = {}
        if purge_now:
            export_files = _collect_export_files(cursor, crm_id, of_user_id)
            counts = _purge_account_rows(cursor, crm_id, of_user_id)

        cursor.execute(
            'DELETE FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
            (panel['id'], of_user_id)
        )
        if email:
            cursor.execute(
                'DELETE FROM two_fa_sessions WHERE crm_id = ? AND email = ?',
                (crm_id, email)
            )

        if purge_now:
            # Nothing left to sweep, so leave no tombstone — and clear any
            # earlier one (a reconnect-then-purge cycle would otherwise leave a
            # stale row that hides the *next* connection's data from list_fans).
            cursor.execute(
                'DELETE FROM account_data_retention WHERE crm_id = ? AND of_user_id = ?',
                (crm_id, of_user_id)
            )
        else:
            # INSERT OR REPLACE, not INSERT: disconnect → reconnect → disconnect
            # must restart the clock, not collide on UNIQUE(crm_id, of_user_id).
            cursor.execute(
                'INSERT OR REPLACE INTO account_data_retention '
                '(crm_id, of_user_id, disconnected_at, purge_after) VALUES (?, ?, ?, ?)',
                (crm_id, of_user_id, now, purge_after)
            )

        # One commit for the whole thing. A sequence of committed statements
        # could half-apply and leave the account gone but its 2FA session (or
        # half its cached rows) behind — exactly the orphaning we're fixing.
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    _unlink_export_files(export_files)
    return {
        'purged': bool(purge_now),
        'counts': counts,
        'purge_after': None if purge_now else purge_after,
    }


def update_of_account_avatar(crm_id, of_user_id, avatar):
    """Persist a fresh avatar URL for an account. Used to re-sign Fansly CDN
    avatars (signed URLs expire ~8-10 days). No-op on falsy avatar."""
    if not avatar:
        return
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE of_accounts SET avatar = ? WHERE crm_panel_id = ? AND of_user_id = ?',
            (avatar, panel['id'], str(of_user_id))
        )
        conn.commit()
    finally:
        conn.close()


def update_of_account_profile(crm_id, of_user_id, username=None, avatar=None,
                              about=None):
    """Backfill profile metadata read from a later /users/me.

    COALESCE on every field: an account that connects while OnlyFans is
    refusing account-scoped calls (see of_faceid) lands with username/avatar
    NULL, and this is how they get filled once the gate lifts — without a
    partial response blanking a value we already had."""
    panel = get_crm_panel(crm_id)
    if not panel or not any((username, avatar, about)):
        return
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''UPDATE of_accounts
               SET username = COALESCE(?, username),
                   avatar = COALESCE(?, avatar),
                   about = COALESCE(?, about)
               WHERE crm_panel_id = ? AND of_user_id = ?''',
            (username, avatar, about, panel['id'], str(of_user_id))
        )
        conn.commit()
    finally:
        conn.close()


def record_account_balance(crm_id, of_user_id, available, pending=None, currency=None,
                           *, current=None):
    """Stamp the last-known payout balance for an account.

    Called opportunistically from wherever a balance was already fetched, so it
    adds no upstream traffic of its own. Best-effort by design: a bookkeeping
    write must never turn a successful balance fetch into a failed request.

    ``current`` is the whole wallet including earnings on hold (Fansly reports
    it; OF callers leave it None). Stamped in UTC with an explicit offset so the
    dashboard's "as of" never shifts by the server's local zone.
    """
    try:
        available = float(available)
    except (TypeError, ValueError):
        return
    try:
        pending = float(pending) if pending is not None else None
    except (TypeError, ValueError):
        pending = None
    try:
        current = float(current) if current is not None else None
    except (TypeError, ValueError):
        current = None
    try:
        panel = get_crm_panel(crm_id)
        if not panel:
            return
        conn = sqlite3.connect(DB_FILE)
        try:
            conn.execute(
                'UPDATE of_accounts SET last_balance_available = ?, '
                'last_balance_pending = ?, last_balance_currency = ?, '
                'last_balance_current = ?, '
                'last_balance_at = ? WHERE crm_panel_id = ? AND of_user_id = ?',
                (available, pending, currency, current, iso_utc_now(),
                 panel['id'], str(of_user_id))
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        print(f'[db] record_account_balance failed for {crm_id}/{of_user_id}: {e}')


def balances_summary(crm_id):
    """Panel-wide payout totals from the last-known per-account balances.

    One query, zero upstream calls. Reports how many accounts have never been
    sampled and how old the oldest sample is, so the caller can label the
    figure honestly rather than presenting a stale sum as live.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        return {'total_available': 0.0, 'total_pending': 0.0, 'accounts': 0,
                'accounts_with_balance': 0, 'accounts_never_sampled': 0,
                'oldest_sample_at': None, 'newest_sample_at': None, 'currency': None}
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            '''SELECT COUNT(*) AS accounts,
                      SUM(CASE WHEN last_balance_at IS NOT NULL THEN 1 ELSE 0 END) AS sampled,
                      COALESCE(SUM(last_balance_available), 0) AS total_available,
                      COALESCE(SUM(last_balance_pending), 0)   AS total_pending,
                      MIN(last_balance_at) AS oldest, MAX(last_balance_at) AS newest
                 FROM of_accounts WHERE crm_panel_id = ?''',
            (panel['id'],)
        ).fetchone()
        # Currency is per-account in principle; in practice a panel is single
        # currency. Report the most common one rather than inventing a mix.
        cur_row = conn.execute(
            '''SELECT last_balance_currency AS c, COUNT(*) AS n FROM of_accounts
                WHERE crm_panel_id = ? AND last_balance_currency IS NOT NULL
                GROUP BY c ORDER BY n DESC LIMIT 1''',
            (panel['id'],)
        ).fetchone()
    finally:
        conn.close()
    sampled = int(row['sampled'] or 0)
    return {
        'total_available': round(float(row['total_available'] or 0), 2),
        'total_pending': round(float(row['total_pending'] or 0), 2),
        'accounts': int(row['accounts'] or 0),
        'accounts_with_balance': sampled,
        'accounts_never_sampled': int(row['accounts'] or 0) - sampled,
        'oldest_sample_at': row['oldest'],
        'newest_sample_at': row['newest'],
        'currency': cur_row['c'] if cur_row else None,
    }


def update_of_account_proxy(crm_id, of_user_id, proxy):
    """Update proxy for an OnlyFans account."""
    panel = get_crm_panel(crm_id)
    if not panel:
        raise Exception(f"CRM panel not found: {crm_id}")

    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute(
        'UPDATE of_accounts SET proxy = ? WHERE crm_panel_id = ? AND of_user_id = ?',
        (proxy, panel['id'], of_user_id)
    )
    conn.commit()
    conn.close()

    return cursor.rowcount > 0


# 2FA Session Management
#
# A row in two_fa_sessions is a *pending challenge*, not a session: it holds the
# x-bc, cookies and password of a login that OnlyFans answered with error 101,
# waiting for a human to type the code. OF expires the challenge on its own side
# after a few minutes, so a row older than config.TWO_FA_SESSION_EXPIRY is
# worthless — and worse, it holds an encrypted password. get_2fa_session()
# therefore treats an expired row as absent and deletes it on the way past;
# sweep_expired_2fa_sessions() catches the rows nobody ever comes back for.
# Set TWO_FA_SESSION_EXPIRY <= 0 to disable expiry entirely.

def _2fa_expiry_seconds():
    return int(getattr(config, 'TWO_FA_SESSION_EXPIRY', 0) or 0)


def _parse_2fa_created_at(created_at):
    """Stored by store_2fa_session as a naive UTC isoformat string. Returns a
    naive-UTC datetime, or None when unparseable (treated as 'never expires' so
    a formatting bug can't silently log everyone out mid-flow)."""
    if not created_at:
        return None
    try:
        parsed = datetime.fromisoformat(str(created_at).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _2fa_remaining_seconds(created_at):
    """Whole seconds left before this row expires. None when expiry is disabled
    or created_at is unreadable. Can be <= 0, meaning already expired."""
    expiry = _2fa_expiry_seconds()
    if expiry <= 0:
        return None
    created = _parse_2fa_created_at(created_at)
    if created is None:
        return None
    elapsed = (datetime.utcnow() - created).total_seconds()
    return int(expiry - elapsed)


def store_2fa_session(crm_id, email, otp_state, x_bc, x_hash, cookies, proxy=None, password=None):
    """Store temporary 2FA session data."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    created_at = datetime.utcnow().isoformat()
    encrypted_password = encrypt_password(password) if password else None

    import json
    cookies_json = json.dumps(cookies) if cookies else None
    # OF's otpState is a flag dict ({email, phoneOtp, appOtp, faceOtp, ...});
    # Fansly parks a plain challenge-token string in the same column. sqlite3
    # cannot bind a dict, so json-encode structured values and leave strings
    # alone — get_2fa_session() reverses exactly this.
    if isinstance(otp_state, (dict, list)):
        otp_state = json.dumps(otp_state)

    cursor.execute('''
        INSERT OR REPLACE INTO two_fa_sessions
        (crm_id, email, otp_state, x_bc, x_hash, cookies, proxy, encrypted_password, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (crm_id, email, otp_state, x_bc, x_hash, cookies_json, proxy, encrypted_password, created_at))

    conn.commit()
    conn.close()


def get_2fa_session(crm_id, email):
    """Get 2FA session data with decrypted password.

    Returns None when there is no row OR the row has outlived
    config.TWO_FA_SESSION_EXPIRY — an expired challenge is indistinguishable
    from an absent one to every caller, which is what lets the login route say
    "log in again" instead of failing at submit time. A live row additionally
    carries `expires_in_seconds` (None if expiry is disabled) and `expires_at`
    so a UI can count down.
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        'SELECT * FROM two_fa_sessions WHERE crm_id = ? AND email = ?',
        (crm_id, email)
    )
    row = cursor.fetchone()

    if not row:
        conn.close()
        return None

    session = dict(row)
    remaining = _2fa_remaining_seconds(session.get('created_at'))
    if remaining is not None and remaining <= 0:
        # Expired: drop it here rather than leaving a dead encrypted password
        # behind for the sweeper to find later.
        cursor.execute(
            'DELETE FROM two_fa_sessions WHERE crm_id = ? AND email = ?',
            (crm_id, email)
        )
        conn.commit()
        conn.close()
        return None
    conn.close()

    import json
    stored_cookies = session.get('cookies')
    session['cookies'] = json.loads(stored_cookies) if stored_cookies else {}
    # Decode otpState back to a dict when that is what was stored. Fansly's
    # plain token never starts with '{', so it comes back untouched.
    otp_state = session.get('otp_state')
    if isinstance(otp_state, str) and otp_state.startswith('{'):
        try:
            session['otp_state'] = json.loads(otp_state)
        except ValueError:
            pass
    session['password'] = decrypt_password(session['encrypted_password']) if session.get('encrypted_password') else None
    session['expires_in_seconds'] = remaining
    created = _parse_2fa_created_at(session.get('created_at'))
    expiry = _2fa_expiry_seconds()
    session['expires_at'] = (
        (created + timedelta(seconds=expiry)).isoformat()
        if created is not None and expiry > 0 else None
    )

    return session


def get_2fa_session_remaining_seconds(crm_id, email):
    """How long a parked 2FA challenge has left, in whole seconds.

    Returns None when there is no live session at all, or when expiry is
    disabled (TWO_FA_SESSION_EXPIRY <= 0) — those are different answers, so
    callers that need to tell them apart should check get_2fa_session() first.
    Never returns <= 0: an expired row reads as absent everywhere.

    This is what the bulk importer polls to render a countdown and to decide
    when to tell the operator "this one timed out, log in again" instead of
    letting them type a code into a challenge OnlyFans already dropped.
    """
    session = get_2fa_session(crm_id, email)
    if not session:
        return None
    return session.get('expires_in_seconds')


def sweep_expired_2fa_sessions():
    """Delete every 2FA challenge past its expiry. Returns the row count.

    get_2fa_session already self-heals on read; this catches the rows nobody
    reads again — the common case, since a user who abandons the flow never
    comes back for their row, and every one of them holds an encrypted
    password."""
    expiry = _2fa_expiry_seconds()
    if expiry <= 0:
        return 0
    cutoff = (datetime.utcnow() - timedelta(seconds=expiry)).isoformat()
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute(
        'DELETE FROM two_fa_sessions WHERE created_at IS NOT NULL AND created_at < ?',
        (cutoff,)
    )
    deleted = cursor.rowcount
    conn.commit()
    conn.close()
    return deleted


def delete_2fa_session(crm_id, email):
    """Delete 2FA session after successful verification."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    cursor.execute(
        'DELETE FROM two_fa_sessions WHERE crm_id = ? AND email = ?',
        (crm_id, email)
    )
    conn.commit()
    conn.close()


# ============================================================================
# Polling / Events / Webhooks / Automations helpers
# ============================================================================

import json as _json


def _row_to_dict(row):
    return dict(row) if row else None


def list_pollable_accounts():
    """Return every of_account row that has polling_enabled=1 or is targeted by an
    active webhook/automation. Joined with crm_panel crm_id for scheduling."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute('''
        SELECT a.id, a.of_user_id, a.polling_enabled, a.polling_interval_seconds,
               a.last_polled_at, a.polling_cursor, a.polling_failure_count,
               a.proxy, a.email, a.username, p.crm_id
        FROM of_accounts a
        JOIN crm_panels p ON a.crm_panel_id = p.id
        WHERE a.polling_enabled = 1
    ''')
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def list_tx_syncable_accounts():
    """OF accounts that need a transactions delta-sync but are NOT polled.

    `list_pollable_accounts` is the only source `scheduler.reconcile_accounts`
    consults, so an account with polling switched off never gets a tx-refresh
    job and its `transactions_cache` freezes at whatever the last manual sync
    left behind. That was tolerable while the earnings summary asked OnlyFans
    directly per account, but the panel-wide summary now reads the cache — so a
    frozen cache silently under-reports revenue for exactly these accounts.

    Excluded on purpose:
      * `platform = 'fansly'` — Fansly accounts get their own refresh job
        (wallet ledger + wallet snapshot + roster) from
        `list_fansly_refreshable_accounts`, whatever their polling state.
      * `relogin_blocked_at IS NOT NULL` — the session is dead and the circuit
        breaker already refused to re-log-in. Scheduling a recurring upstream
        walk against it just burns quota and re-trips the breaker on a cadence.
        These accounts surface as `needs_reconnect` in the API and the UI; they
        come back automatically once the operator reconnects, because that
        clears the block.
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute('''
            SELECT a.id, a.of_user_id, a.polling_enabled, a.proxy,
                   a.email, a.username, a.last_transactions_refresh_at, p.crm_id
            FROM of_accounts a
            JOIN crm_panels p ON a.crm_panel_id = p.id
            WHERE COALESCE(a.polling_enabled, 0) = 0
              AND COALESCE(a.platform, 'onlyfans') != 'fansly'
              AND a.relogin_blocked_at IS NULL
        ''').fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def list_fansly_refreshable_accounts():
    """Every Fansly account that should have a scheduled wallet/roster refresh.

    Polling state is deliberately NOT a filter. The panel earnings summary and
    the New Subs count read the local caches for every account, and before this
    a Fansly account only refreshed inside the poll cycle — so one with polling
    off (or never backfilled) reported frozen or zero numbers indefinitely.
    `polling_enabled` is returned so the scheduler can pick the cadence.

    Relogin-blocked accounts are excluded for the same reason as in
    `list_tx_syncable_accounts`: the session is dead until someone reconnects.
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute('''
            SELECT a.of_user_id, a.polling_enabled, a.proxy,
                   a.last_transactions_refresh_at, a.last_subscribers_refresh_at,
                   a.last_balance_at, a.last_balance_current, p.crm_id
            FROM of_accounts a
            JOIN crm_panels p ON a.crm_panel_id = p.id
            WHERE COALESCE(a.platform, 'onlyfans') = 'fansly'
              AND a.relogin_blocked_at IS NULL
        ''').fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


def get_account_polling(crm_id, of_user_id):
    panel = get_crm_panel(crm_id)
    if not panel:
        return None
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''SELECT of_user_id, polling_enabled, polling_interval_seconds,
                             last_polled_at, polling_failure_count, allow_of_write_actions
                      FROM of_accounts
                      WHERE crm_panel_id = ? AND of_user_id = ?''',
                   (panel['id'], of_user_id))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_tracked_campaigns(crm_id, of_user_id):
    """Return the allowlist of tracking-link campaign names/codes to keep
    synced for this account, or None if none configured (→ size-cap fallback)."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return None
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute('''SELECT tracked_campaigns FROM of_accounts
                      WHERE crm_panel_id = ? AND of_user_id = ?''',
                   (panel['id'], of_user_id))
    row = cursor.fetchone()
    conn.close()
    if not row or not row['tracked_campaigns']:
        return None
    try:
        val = json.loads(row['tracked_campaigns'])
        return val if isinstance(val, list) and val else None
    except (ValueError, TypeError):
        return None


def set_tracked_campaigns(crm_id, of_user_id, names):
    """Persist the tracked-campaign allowlist (list of names/codes). Pass an
    empty list / None to clear it (revert to the size-cap behaviour)."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return False
    payload = json.dumps([str(n).strip() for n in names if str(n).strip()]) if names else None
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''UPDATE of_accounts SET tracked_campaigns = ?
                      WHERE crm_panel_id = ? AND of_user_id = ?''',
                   (payload, panel['id'], of_user_id))
    conn.commit()
    conn.close()
    return True


def update_account_polling(crm_id, of_user_id, enabled=None, interval_seconds=None, allow_of_write_actions=None):
    """Persist the polling settings for one account.

    Deliberately platform-agnostic: `polling_enabled` is stored exactly as the
    operator set it, even when this deployment's poller will not act on it
    (a Fansly account while `config.FANSLY_POLLING_ENABLED` is false).

    Do NOT "clean up" the flag for such platforms. It is a stored user setting,
    and whether it currently does anything is a DEPLOYMENT question decided by
    an environment variable that can flip either way between restarts — this
    box ships with FANSLY_POLLING_ENABLED=true, the code default is false.
    Clearing the row on the off state would silently discard the setting, and
    flipping the flag back on would not restore it: the operator would find
    polling mysteriously off on accounts they had switched on. Honesty belongs
    in the READERS, which must apply the same gate the poller does
    (`platform_features.capabilities(platform)['polling']`, mirroring
    poller.py's FANSLY_POLLING_ENABLED check) rather than trusting the flag
    alone. See `polling_inert_platforms()` below.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        return False
    fields, params = [], []
    if enabled is not None:
        fields.append('polling_enabled = ?')
        params.append(1 if enabled else 0)
        # Turning polling ON is a fresh start: clear the consecutive-failure
        # counter and the last connection error so a replaced proxy (or a fixed
        # session) is not immediately re-paused by a stale failure count.
        if enabled:
            fields.append('polling_failure_count = 0')
            fields.append('last_connection_state = NULL')
            fields.append('last_connection_error_code = NULL')
            fields.append('last_connection_error_at = NULL')
    if interval_seconds is not None:
        fields.append('polling_interval_seconds = ?')
        params.append(int(interval_seconds))
    if allow_of_write_actions is not None:
        fields.append('allow_of_write_actions = ?')
        params.append(1 if allow_of_write_actions else 0)
    if not fields:
        return False
    params.extend([panel['id'], of_user_id])
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute(f"UPDATE of_accounts SET {', '.join(fields)} WHERE crm_panel_id = ? AND of_user_id = ?", params)
    conn.commit()
    ok = cursor.rowcount > 0
    conn.close()
    return ok


def save_polling_cursor(crm_id, of_user_id, cursor_data, success=True):
    """Persist the poller's cursor for an account."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    if success:
        cur.execute('''UPDATE of_accounts
                       SET polling_cursor = ?, last_polled_at = ?, polling_failure_count = 0
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (_json.dumps(cursor_data) if cursor_data is not None else None, now,
                     panel['id'], of_user_id))
    else:
        cur.execute('''UPDATE of_accounts
                       SET last_polled_at = ?, polling_failure_count = polling_failure_count + 1
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (now, panel['id'], of_user_id))
    conn.commit()
    conn.close()


def update_polling_cursor_fields(crm_id, of_user_id, **fields):
    """Merge keys into the polling_cursor JSON WITHOUT touching last_polled_at
    or the failure counter (save_polling_cursor updates those as a side
    effect). Used for out-of-band cursor metadata like ``last_harvest_at`` /
    ``last_fansly_tx_id`` written by syncs that aren't polls."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return False
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        cur.execute('SELECT polling_cursor FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
                    (panel['id'], of_user_id))
        row = cur.fetchone()
        if row is None:
            return False
        try:
            cursor_data = _json.loads(row[0]) if row[0] else {}
        except Exception:
            cursor_data = {}
        if not isinstance(cursor_data, dict):
            cursor_data = {}
        cursor_data.update(fields)
        cur.execute('UPDATE of_accounts SET polling_cursor = ? WHERE crm_panel_id = ? AND of_user_id = ?',
                    (_json.dumps(cursor_data), panel['id'], of_user_id))
        conn.commit()
        return True
    finally:
        conn.close()


def load_polling_cursor(crm_id, of_user_id):
    panel = get_crm_panel(crm_id)
    if not panel:
        return None
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('SELECT polling_cursor FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?',
                (panel['id'], of_user_id))
    row = cur.fetchone()
    conn.close()
    if not row or not row[0]:
        return None
    try:
        return _json.loads(row[0])
    except Exception:
        return None


# ---- events ----

def insert_event(crm_id, of_user_id, event_type, payload, source_event_id=None, occurred_at=None):
    """Insert event. Returns (event_id, is_new)."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cur.execute('''INSERT INTO account_events
                       (crm_id, of_user_id, event_type, source_event_id, payload, occurred_at, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)''',
                    (crm_id, of_user_id, event_type, str(source_event_id) if source_event_id is not None else None,
                     _json.dumps(payload), occurred_at or now, now))
        conn.commit()
        eid = cur.lastrowid
        conn.close()
        return eid, True
    except sqlite3.IntegrityError:
        conn.close()
        return None, False


def list_events(crm_id, types=None, of_user_id=None, since=None, until=None, limit=100):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # Same reasoning as list_fans: of_user_id is optional, so the Activity feed
    # would otherwise keep replaying a disconnected account's events until the
    # sweeper runs. Tombstoned accounts drop out of the feed straight away.
    query = ('SELECT * FROM account_events WHERE crm_id = ? '
             'AND NOT EXISTS (SELECT 1 FROM account_data_retention r '
             '                WHERE r.crm_id = account_events.crm_id '
             '                  AND r.of_user_id = account_events.of_user_id)')
    params = [crm_id]
    if types:
        placeholders = ','.join('?' * len(types))
        query += f' AND event_type IN ({placeholders})'
        params.extend(types)
    if of_user_id:
        query += ' AND of_user_id = ?'
        params.append(of_user_id)
    if since:
        query += ' AND created_at > ?'
        params.append(since)
    if until:
        query += ' AND created_at <= ?'
        params.append(until)
    query += ' ORDER BY id DESC LIMIT ?'
    params.append(int(limit))
    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    for r in rows:
        try:
            r['payload'] = _json.loads(r['payload']) if r.get('payload') else {}
        except Exception:
            pass
    return rows


# ---- webhooks ----

# Hardcoded allowlist — any webhook URL on one of these domains auto-approves
# because they're well-known event sinks that can't be weaponized via our
# server (Discord / Slack etc. don't accept arbitrary payloads as commands).
# Lives here rather than in crm_api so that update_webhook can consult it
# without importing the Flask app (which would start the scheduler).
WEBHOOK_DOMAIN_ALLOWLIST = frozenset({
    'discord.com',
    'discordapp.com',
    'hooks.slack.com',
    'api.telegram.org',
})


def webhook_host(url):
    from urllib.parse import urlparse
    return (urlparse(url or '').hostname or '').lower().strip('.')


def initial_webhook_status(crm_id, url):
    """Decide whether a webhook URL should be live or awaiting review.
    Allowlisted domains go straight to 'approved'; domains already approved for
    this CRM also auto-approve; everything else is 'pending'."""
    host = webhook_host(url)
    if not host:
        return 'pending'
    if host in WEBHOOK_DOMAIN_ALLOWLIST:
        return 'approved'
    if is_domain_approved(crm_id, host):
        return 'approved'
    return 'pending'


def create_webhook(crm_id, url, event_types, description=None, secret=None, status='approved'):
    if secret is None:
        secret = secrets.token_urlsafe(32)
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    cur.execute('''INSERT INTO webhooks (crm_id, url, secret, event_types, description, is_active, status, created_at)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?)''',
                (crm_id, url, secret, _json.dumps(event_types), description, status, now))
    conn.commit()
    wid = cur.lastrowid
    conn.close()
    return get_webhook(crm_id, wid)


def is_domain_approved(crm_id, domain):
    """Has an admin previously approved this (crm_id, domain) pair?"""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('SELECT 1 FROM webhook_approved_domains WHERE crm_id = ? AND domain = ? LIMIT 1',
                (crm_id, domain))
    row = cur.fetchone()
    conn.close()
    return row is not None


def approve_domain(crm_id, domain, approved_by=None):
    """Record a (crm_id, domain) approval. Idempotent."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    cur.execute('''INSERT OR IGNORE INTO webhook_approved_domains (crm_id, domain, approved_at, approved_by)
                   VALUES (?, ?, ?, ?)''',
                (crm_id, domain, now, approved_by))
    conn.commit()
    conn.close()


def set_webhook_status(webhook_id, status, reject_reason=None):
    """Admin-only state transition. Returns the updated webhook row (any CRM)."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    cur.execute('''UPDATE webhooks
                   SET status = ?, reject_reason = ?, reviewed_at = ?
                   WHERE id = ?''',
                (status, reject_reason, now, webhook_id))
    conn.commit()
    cur.execute('SELECT * FROM webhooks WHERE id = ?', (webhook_id,))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    r = dict(row)
    try:
        r['event_types'] = _json.loads(r['event_types'])
    except Exception:
        r['event_types'] = []
    return r


def list_pending_webhooks():
    """Admin dashboard feed: all webhooks awaiting review, across CRMs."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM webhooks WHERE status = 'pending' ORDER BY created_at ASC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    for r in rows:
        try:
            r['event_types'] = _json.loads(r['event_types'])
        except Exception:
            r['event_types'] = []
    return rows


def list_webhooks(crm_id):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM webhooks WHERE crm_id = ? ORDER BY id DESC', (crm_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    for r in rows:
        try:
            r['event_types'] = _json.loads(r['event_types'])
        except Exception:
            r['event_types'] = []
    return rows


def get_webhook(crm_id, webhook_id):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM webhooks WHERE crm_id = ? AND id = ?', (crm_id, webhook_id))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    r = dict(row)
    try:
        r['event_types'] = _json.loads(r['event_types'])
    except Exception:
        r['event_types'] = []
    return r


def update_webhook(crm_id, webhook_id, url=None, event_types=None, description=None, is_active=None):
    fields, params = [], []
    if url is not None:
        fields.append('url = ?'); params.append(url)
        # Repointing at a DIFFERENT host re-arms admin review. Without this, the
        # domain gate is trivially bypassed: create a webhook on an allowlisted
        # domain (auto-approved), then PATCH the url to any host you like and
        # keep status='approved'. Signed deliveries carrying fan PII would then
        # flow to a host no admin ever reviewed. A same-host path change is
        # left alone — re-reviewing that is pointless churn.
        current = get_webhook(crm_id, webhook_id)
        if current and webhook_host(current.get('url')) != webhook_host(url):
            fields.append('status = ?')
            params.append(initial_webhook_status(crm_id, url))
    if event_types is not None:
        fields.append('event_types = ?'); params.append(_json.dumps(event_types))
    if description is not None:
        fields.append('description = ?'); params.append(description)
    if is_active is not None:
        fields.append('is_active = ?'); params.append(1 if is_active else 0)
        if is_active:
            fields.append('consecutive_failures = 0')
    if not fields:
        return get_webhook(crm_id, webhook_id)
    params.extend([crm_id, webhook_id])
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute(f"UPDATE webhooks SET {', '.join(fields)} WHERE crm_id = ? AND id = ?", params)
    conn.commit()
    conn.close()
    return get_webhook(crm_id, webhook_id)


def delete_webhook(crm_id, webhook_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('DELETE FROM webhook_deliveries WHERE webhook_id = ?', (webhook_id,))
    cur.execute('DELETE FROM webhooks WHERE crm_id = ? AND id = ?', (crm_id, webhook_id))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def matching_webhooks(crm_id, event_type):
    for wh in list_webhooks(crm_id):
        if not wh.get('is_active'):
            continue
        # Only deliver to webhooks whose domain an admin has approved.
        # Rows created before this column existed default to 'approved' so
        # legacy webhooks aren't silently broken.
        if (wh.get('status') or 'approved') != 'approved':
            continue
        types = wh.get('event_types') or []
        if '*' in types or event_type in types:
            yield wh


def record_webhook_delivery(webhook_id, event_id, status, response_code=None, response_snippet=None,
                            attempt=1, next_retry_at=None, completed=False):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    cur.execute('''INSERT INTO webhook_deliveries
                   (webhook_id, event_id, attempt, status, response_code, response_snippet, next_retry_at, created_at, completed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (webhook_id, event_id, attempt, status, response_code,
                 (response_snippet or '')[:1000], next_retry_at, now, now if completed else None))
    conn.commit()
    did = cur.lastrowid
    if status == 'success':
        cur.execute('''UPDATE webhooks SET last_delivery_at = ?, last_status_code = ?, consecutive_failures = 0
                       WHERE id = ?''', (now, response_code, webhook_id))
    elif status == 'failed':
        cur.execute('''UPDATE webhooks SET last_delivery_at = ?, last_status_code = ?, consecutive_failures = consecutive_failures + 1
                       WHERE id = ?''', (now, response_code, webhook_id))
        cur.execute('UPDATE webhooks SET is_active = 0 WHERE id = ? AND consecutive_failures >= 5', (webhook_id,))
    conn.commit()
    conn.close()
    return did


def list_webhook_deliveries(crm_id, webhook_id, limit=50):
    if not get_webhook(crm_id, webhook_id):
        return []
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?',
                (webhook_id, int(limit)))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


# ---- panel-level Telegram channel ----
#
# Everything here is keyed on crm_id alone. The bot token (custom mode only) is
# Fernet-encrypted with the same helper that protects of_accounts passwords, and
# the ONLY function that ever returns it in clear is get_telegram_bot_token(),
# which exists for the sender and must never be reachable from a route.

def token_fingerprint(bot_token):
    """Stable, non-reversible id for a bot token (getUpdates offset key)."""
    if not bot_token:
        return ''
    return hashlib.sha256(bot_token.encode()).hexdigest()[:32]


def _telegram_row(row):
    if not row:
        return None
    r = dict(row)
    try:
        r['event_types'] = _json.loads(r['event_types'])
    except Exception:
        r['event_types'] = ['*']
    return r


def get_telegram_integration(crm_id):
    """Full row INCLUDING the ciphertext. Callers that serialize to HTTP must
    go through crm_api._telegram_public()."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM telegram_integrations WHERE crm_id = ?', (crm_id,))
    row = cur.fetchone()
    conn.close()
    return _telegram_row(row)


def get_telegram_bot_token(integration):
    """Clear-text token for an integration row, or None.

    Shared mode has no per-tenant token — it resolves to the platform token,
    which lives in config and is never written to the database.
    """
    if not integration:
        return None
    if (integration.get('bot_mode') or 'shared') == 'shared':
        return getattr(config, 'TELEGRAM_SHARED_BOT_TOKEN', None)
    return decrypt_password(integration.get('encrypted_bot_token'))


def upsert_telegram_integration(crm_id, bot_mode, bot_token=None,
                                bot_username=None, event_types=None):
    """Create or re-point a panel's Telegram integration.

    Changing the bot (mode or token) unpairs: the stored chat_id belongs to a
    conversation with the OLD bot and would either bounce or, worse, still
    deliver to a chat the tenant thinks they disconnected.
    """
    now = datetime.utcnow().isoformat()
    encrypted = encrypt_password(bot_token) if (bot_mode == 'custom' and bot_token) else None
    existing = get_telegram_integration(crm_id)
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        if not existing:
            cur.execute(
                '''INSERT INTO telegram_integrations
                   (crm_id, bot_mode, encrypted_bot_token, bot_username, event_types,
                    is_active, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 0, ?, ?)''',
                (crm_id, bot_mode, encrypted, bot_username,
                 _json.dumps(event_types or ['*']), now, now))
        else:
            rebinding = (bot_mode != existing.get('bot_mode')) or \
                        (bot_mode == 'custom' and encrypted is not None)
            if rebinding:
                cur.execute(
                    '''UPDATE telegram_integrations
                       SET bot_mode = ?, encrypted_bot_token = ?, bot_username = ?,
                           chat_id = NULL, chat_title = NULL, chat_type = NULL,
                           paired_at = NULL, is_active = 0, consecutive_failures = 0,
                           last_error = NULL, event_types = ?, updated_at = ?
                       WHERE crm_id = ?''',
                    (bot_mode,
                     encrypted if bot_mode == 'custom' else None,
                     bot_username,
                     _json.dumps(event_types or existing.get('event_types') or ['*']),
                     now, crm_id))
            else:
                cur.execute(
                    '''UPDATE telegram_integrations
                       SET bot_username = COALESCE(?, bot_username), event_types = ?,
                           updated_at = ?
                       WHERE crm_id = ?''',
                    (bot_username,
                     _json.dumps(event_types or existing.get('event_types') or ['*']),
                     now, crm_id))
        conn.commit()
    finally:
        conn.close()
    return get_telegram_integration(crm_id)


def update_telegram_integration(crm_id, event_types=None, is_active=None):
    """Tenant-editable fields only. There is deliberately no path here that
    writes chat_id or the token — those come from pairing, not from a PATCH."""
    fields, params = [], []
    if event_types is not None:
        fields.append('event_types = ?'); params.append(_json.dumps(event_types))
    if is_active is not None:
        fields.append('is_active = ?'); params.append(1 if is_active else 0)
        if is_active:
            # Re-enabling is the tenant saying "I fixed it" — same semantics as
            # update_webhook, otherwise one more failure instantly re-trips it.
            fields.append('consecutive_failures = 0')
            fields.append('last_error = NULL')
    if not fields:
        return get_telegram_integration(crm_id)
    fields.append('updated_at = ?'); params.append(datetime.utcnow().isoformat())
    params.append(crm_id)
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute(f"UPDATE telegram_integrations SET {', '.join(fields)} WHERE crm_id = ?",
                    params)
        conn.commit()
    finally:
        conn.close()
    return get_telegram_integration(crm_id)


def delete_telegram_integration(crm_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute('DELETE FROM telegram_pairing_codes WHERE crm_id = ?', (crm_id,))
        cur.execute('DELETE FROM telegram_integrations WHERE crm_id = ?', (crm_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def create_telegram_pairing_code(crm_id, ttl_seconds=None):
    """Issue a fresh single-use code and invalidate any earlier open one.

    Only one code can be outstanding per panel: leaving the previous one live
    would mean a code shown on a screen the tenant walked away from still works.
    """
    ttl = int(ttl_seconds or getattr(config, 'TELEGRAM_PAIRING_TTL_SECONDS', 600))
    now = datetime.utcnow()
    code = secrets.token_urlsafe(16)   # /start payload charset: [A-Za-z0-9_-]
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute('DELETE FROM telegram_pairing_codes WHERE crm_id = ? AND used_at IS NULL',
                    (crm_id,))
        cur.execute(
            '''INSERT INTO telegram_pairing_codes (code, crm_id, expires_at, created_at)
               VALUES (?, ?, ?, ?)''',
            (code, crm_id, (now + timedelta(seconds=ttl)).isoformat(), now.isoformat()))
        conn.commit()
    finally:
        conn.close()
    return {'code': code,
            'expires_at': (now + timedelta(seconds=ttl)).isoformat(),
            'ttl_seconds': ttl}


def peek_telegram_pairing_code(code):
    """Which panel a still-valid code belongs to, WITHOUT consuming it.

    Exists so an update arriving on the wrong bot can be refused before the
    single-use code is spent. Consuming first and checking afterwards would let
    anyone who learns a code burn it by replaying it into their own bot, which
    is a denial-of-service on the victim's pairing.
    """
    if not code:
        return None
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute('SELECT crm_id FROM telegram_pairing_codes '
                    'WHERE code = ? AND used_at IS NULL AND expires_at > ?', (code, now))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def redeem_telegram_pairing_code(code):
    """Consume a code. Returns its crm_id, or None if unknown/used/expired.

    The single UPDATE ... WHERE used_at IS NULL AND expires_at > now is the
    whole guarantee: two concurrent /start messages carrying the same code
    cannot both come back with a crm_id, because only one UPDATE can match.
    """
    if not code:
        return None
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    try:
        cur.execute(
            '''UPDATE telegram_pairing_codes SET used_at = ?
               WHERE code = ? AND used_at IS NULL AND expires_at > ?''',
            (now, code, now))
        conn.commit()
        if cur.rowcount != 1:
            return None
        cur.execute('SELECT crm_id FROM telegram_pairing_codes WHERE code = ?', (code,))
        row = cur.fetchone()
        return row['crm_id'] if row else None
    finally:
        conn.close()


def list_crms_with_open_telegram_pairings():
    """crm_ids with an unexpired, unused code — the set the intake sweep has a
    reason to poll a CUSTOM bot for. Bounded by the code TTL by construction."""
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute('SELECT DISTINCT crm_id FROM telegram_pairing_codes '
                    'WHERE used_at IS NULL AND expires_at > ?', (now,))
        return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


def purge_expired_telegram_pairing_codes():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute('DELETE FROM telegram_pairing_codes WHERE expires_at <= ?',
                    (datetime.utcnow().isoformat(),))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def bind_telegram_chat(crm_id, chat_id, chat_title=None, chat_type=None):
    """Attach a resolved Telegram chat to a panel and switch the channel on."""
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute(
            '''UPDATE telegram_integrations
               SET chat_id = ?, chat_title = ?, chat_type = ?, paired_at = ?,
                   is_active = 1, consecutive_failures = 0, last_error = NULL,
                   updated_at = ?
               WHERE crm_id = ?''',
            (str(chat_id), chat_title, chat_type, now, now, crm_id))
        conn.commit()
    finally:
        conn.close()
    return get_telegram_integration(crm_id)


def record_telegram_delivery(crm_id, success, error=None, max_failures=None):
    """Mirror of record_webhook_delivery's bookkeeping: reset the counter on
    success, increment on failure, auto-deactivate once it reaches the cap."""
    cap = int(max_failures or getattr(config, 'TELEGRAM_MAX_CONSECUTIVE_FAILURES', 5))
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        if success:
            cur.execute(
                '''UPDATE telegram_integrations
                   SET last_delivery_at = ?, consecutive_failures = 0, last_error = NULL,
                       updated_at = ?
                   WHERE crm_id = ?''', (now, now, crm_id))
        else:
            cur.execute(
                '''UPDATE telegram_integrations
                   SET last_delivery_at = ?, consecutive_failures = consecutive_failures + 1,
                       last_error = ?, updated_at = ?
                   WHERE crm_id = ?''', (now, (error or '')[:500], now, crm_id))
            cur.execute(
                'UPDATE telegram_integrations SET is_active = 0 '
                'WHERE crm_id = ? AND consecutive_failures >= ?', (crm_id, cap))
        conn.commit()
    finally:
        conn.close()
    return get_telegram_integration(crm_id)


def get_telegram_offset(fingerprint):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute('SELECT update_offset FROM telegram_bot_state WHERE token_fingerprint = ?',
                    (fingerprint,))
        row = cur.fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


def set_telegram_offset(fingerprint, offset, error=None):
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    try:
        cur.execute(
            '''INSERT INTO telegram_bot_state
                   (token_fingerprint, update_offset, last_polled_at, last_error)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(token_fingerprint) DO UPDATE SET
                   update_offset = excluded.update_offset,
                   last_polled_at = excluded.last_polled_at,
                   last_error = excluded.last_error''',
            (fingerprint, int(offset), now, (error or None)))
        conn.commit()
    finally:
        conn.close()


def matching_telegram_integration(crm_id, event_type):
    """The panel's channel if it should receive this event, else None.

    Same filter contract as matching_webhooks: '*' means everything.
    """
    integ = get_telegram_integration(crm_id)
    if not integ or not integ.get('is_active') or not integ.get('chat_id'):
        return None
    types = integ.get('event_types') or []
    if '*' in types or event_type in types:
        return integ
    return None


# ---- automations ----

def create_automation(crm_id, name, trigger_event, action_type, action_params,
                      of_user_id=None, conditions=None, is_active=True):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    cur.execute('''INSERT INTO automations
                   (crm_id, of_user_id, name, trigger_event, conditions, action_type, action_params, is_active, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (crm_id, of_user_id, name, trigger_event,
                 _json.dumps(conditions or []), action_type,
                 _json.dumps(action_params or {}), 1 if is_active else 0, now))
    conn.commit()
    aid = cur.lastrowid
    conn.close()
    return get_automation(crm_id, aid)


def list_automations(crm_id):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM automations WHERE crm_id = ? ORDER BY id DESC', (crm_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    for r in rows:
        try: r['conditions'] = _json.loads(r['conditions'] or '[]')
        except Exception: r['conditions'] = []
        try: r['action_params'] = _json.loads(r['action_params'] or '{}')
        except Exception: r['action_params'] = {}
    return rows


def get_automation(crm_id, automation_id):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM automations WHERE crm_id = ? AND id = ?', (crm_id, automation_id))
    row = cur.fetchone()
    conn.close()
    if not row:
        return None
    r = dict(row)
    try: r['conditions'] = _json.loads(r['conditions'] or '[]')
    except Exception: r['conditions'] = []
    try: r['action_params'] = _json.loads(r['action_params'] or '{}')
    except Exception: r['action_params'] = {}
    return r


def update_automation(crm_id, automation_id, **fields):
    allowed = {'name', 'trigger_event', 'conditions', 'action_type', 'action_params',
               'is_active', 'of_user_id'}
    updates, params = [], []
    for key, val in fields.items():
        if key not in allowed or val is None:
            continue
        if key in ('conditions', 'action_params'):
            val = _json.dumps(val)
        if key == 'is_active':
            val = 1 if val else 0
        updates.append(f'{key} = ?'); params.append(val)
    if not updates:
        return get_automation(crm_id, automation_id)
    params.extend([crm_id, automation_id])
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute(f"UPDATE automations SET {', '.join(updates)} WHERE crm_id = ? AND id = ?", params)
    conn.commit()
    conn.close()
    return get_automation(crm_id, automation_id)


def delete_automation(crm_id, automation_id):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('DELETE FROM automation_runs WHERE automation_id = ?', (automation_id,))
    cur.execute('DELETE FROM automations WHERE crm_id = ? AND id = ?', (crm_id, automation_id))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def matching_automations(crm_id, of_user_id, trigger_event):
    """Active automations for (crm_id, event_type) scoped to account or all."""
    for a in list_automations(crm_id):
        if not a.get('is_active'):
            continue
        if a.get('trigger_event') != trigger_event:
            continue
        target = a.get('of_user_id')
        if target and str(target) != str(of_user_id):
            continue
        yield a


def record_automation_run(automation_id, event_id, status, error_snippet=None):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    cur.execute('''INSERT INTO automation_runs
                   (automation_id, event_id, status, error_snippet, created_at)
                   VALUES (?, ?, ?, ?, ?)''',
                (automation_id, event_id, status, (error_snippet or '')[:500], now))
    if status == 'success':
        cur.execute('UPDATE automations SET last_run_at = ?, run_count = run_count + 1 WHERE id = ?',
                    (now, automation_id))
    conn.commit()
    conn.close()


def list_automation_runs(crm_id, automation_id, limit=50):
    if not get_automation(crm_id, automation_id):
        return []
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY id DESC LIMIT ?',
                (automation_id, int(limit)))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


# ---- fans ----

def upsert_fan(crm_id, of_user_id, fan_of_user_id, username=None, display_name=None, avatar=None):
    """Fans must be scoped to a specific account. Callers that don't have an
    account context (e.g. global automations run as samples) should pass None —
    we simply skip persistence instead of crashing."""
    if not fan_of_user_id or not of_user_id:
        return None
    fan_of_user_id = str(fan_of_user_id)
    of_user_id = str(of_user_id)
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        now = datetime.utcnow().isoformat()
        try:
            cur.execute('''INSERT INTO fans (crm_id, of_user_id, fan_of_user_id, username, display_name, avatar, first_seen_at, last_seen_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                        (crm_id, of_user_id, fan_of_user_id, username, display_name, avatar, now, now))
            fan_id = cur.lastrowid
        except sqlite3.IntegrityError:
            cur.execute('''UPDATE fans SET username = COALESCE(?, username),
                                           display_name = COALESCE(?, display_name),
                                           avatar = COALESCE(?, avatar),
                                           last_seen_at = ?
                           WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
                        (username, display_name, avatar, now, crm_id, of_user_id, fan_of_user_id))
            cur.execute('SELECT id FROM fans WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?',
                        (crm_id, of_user_id, fan_of_user_id))
            row = cur.fetchone()
            fan_id = row[0] if row else None
        conn.commit()
        return fan_id
    finally:
        conn.close()


def fans_username_index(crm_id, of_user_id):
    """{fan_of_user_id: {'username', 'display_name'}} for one account.

    Used to enrich Fansly wallet-transaction rows (which only carry
    correlationAccountId) with the identities harvested from chats/tips."""
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        cur.execute('''SELECT fan_of_user_id, username, display_name FROM fans
                       WHERE crm_id = ? AND of_user_id = ?''',
                    (crm_id, str(of_user_id)))
        return {str(r[0]): {'username': r[1], 'display_name': r[2]}
                for r in cur.fetchall() if r[0] is not None}
    finally:
        conn.close()


def list_fans(crm_id, of_user_id=None, limit=100, offset=0, with_stats=True,
              sort='last_seen', search=None, tag=None,
              since=None, until=None,
              dedupe_by_fan=False, with_total=False):
    """Return fans for a CRM, optionally joined with per-fan event aggregates.

    Stats (when with_stats=True) are computed from ``account_events`` by
    extracting ``payload.fan.id`` and summing amounts grouped per fan. One SQL
    query — fast enough for the expected volume (thousands of fans, tens of
    thousands of events).

    sort: one of last_seen | tips | spend | events | first_seen
    search: substring match on username / display_name
    tag:    exact tag name to filter by
    dedupe_by_fan: when True, collapse all (creator, fan) rows for the same
      fan_of_user_id into one. The aggregates (total_tips, total_spend,
      event_count) are SUMMED across creators, last_event_at is MAX, and
      a new `account_count` + `account_ids` (comma-joined of_user_ids)
      are added. Use this for "top spender across all my accounts" —
      without it, a fan subscribed to N creators appears N times.
    with_total: when True, returns (rows, total_unique_count) instead of
      just rows. `total` reflects the full filter set, NOT the page,
      so the caller can say "showing 10 of 81".
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    params = [crm_id]

    if with_stats:
        # The correlated subqueries keep the join small. Cast both sides of
        # the event→fan match to TEXT because json_extract may return numbers.
        base = """
            SELECT f.*,
                   GROUP_CONCAT(DISTINCT t.tag) AS tags,
                   -- Tips/spend prefer the authoritative subscribers_cache total
                   -- (OF's lifetime *Summ) but never under-report what we've
                   -- captured in events: take the larger of the two.
                   MAX(
                       COALESCE((
                           SELECT sc.spent_tips FROM subscribers_cache sc
                           WHERE sc.crm_id = f.crm_id
                             AND sc.of_user_id = f.of_user_id
                             AND sc.fan_of_user_id = f.fan_of_user_id
                       ), 0),
                       COALESCE((
                           SELECT SUM(CAST(json_extract(e.payload, '$.amount') AS REAL))
                           FROM account_events e
                           WHERE e.crm_id = f.crm_id
                             AND e.of_user_id = f.of_user_id
                             AND CAST(json_extract(e.payload, '$.fan.id') AS TEXT) = f.fan_of_user_id
                             AND e.event_type = 'new_tip'
                       ), 0)
                   ) AS total_tips,
                   MAX(
                       COALESCE((
                           SELECT sc.total_spent FROM subscribers_cache sc
                           WHERE sc.crm_id = f.crm_id
                             AND sc.of_user_id = f.of_user_id
                             AND sc.fan_of_user_id = f.fan_of_user_id
                       ), 0),
                       COALESCE((
                           SELECT SUM(CAST(json_extract(e.payload, '$.amount') AS REAL))
                           FROM account_events e
                           WHERE e.crm_id = f.crm_id
                             AND e.of_user_id = f.of_user_id
                             AND CAST(json_extract(e.payload, '$.fan.id') AS TEXT) = f.fan_of_user_id
                             AND e.event_type IN ('new_tip', 'new_purchase')
                       ), 0)
                   ) AS total_spend,
                   COALESCE((
                       SELECT COUNT(1)
                       FROM account_events e
                       WHERE e.crm_id = f.crm_id
                         AND e.of_user_id = f.of_user_id
                         AND CAST(json_extract(e.payload, '$.fan.id') AS TEXT) = f.fan_of_user_id
                   ), 0) AS event_count,
                   (
                       SELECT MAX(e.created_at)
                       FROM account_events e
                       WHERE e.crm_id = f.crm_id
                         AND e.of_user_id = f.of_user_id
                         AND CAST(json_extract(e.payload, '$.fan.id') AS TEXT) = f.fan_of_user_id
                   ) AS last_event_at,
                   (
                       SELECT sc.of_lists FROM subscribers_cache sc
                       WHERE sc.crm_id = f.crm_id
                         AND sc.of_user_id = f.of_user_id
                         AND sc.fan_of_user_id = f.fan_of_user_id
                   ) AS of_lists,
                   -- 1 when we actually have a spend source for this fan (a
                   -- cached subscriber row OR any captured spend event). When 0,
                   -- spend/tips are UNKNOWN (account not synced) — the UI shows
                   -- "—" rather than a misleading $0.
                   (CASE WHEN EXISTS(
                        SELECT 1 FROM subscribers_cache sc
                        WHERE sc.crm_id = f.crm_id
                          AND sc.of_user_id = f.of_user_id
                          AND sc.fan_of_user_id = f.fan_of_user_id
                    ) OR EXISTS(
                        SELECT 1 FROM account_events e
                        WHERE e.crm_id = f.crm_id
                          AND e.of_user_id = f.of_user_id
                          AND CAST(json_extract(e.payload, '$.fan.id') AS TEXT) = f.fan_of_user_id
                          AND e.event_type IN ('new_tip', 'new_purchase')
                    ) THEN 1 ELSE 0 END) AS spend_known
            FROM fans f
            LEFT JOIN fan_tags t ON t.fan_id = f.id
            WHERE f.crm_id = ?
        """
    else:
        base = '''SELECT f.*, GROUP_CONCAT(DISTINCT t.tag) AS tags
                  FROM fans f LEFT JOIN fan_tags t ON t.fan_id = f.id
                  WHERE f.crm_id = ?'''

    # of_user_id is optional here — omitting it lists the whole panel's fans, so
    # a disconnected account's fans would keep showing on the Fans page for the
    # entire retention window. Hide anything under an open tombstone; the row
    # count there is tiny (one per pending purge) so the subquery is free.
    base += ''' AND NOT EXISTS (SELECT 1 FROM account_data_retention r
                                WHERE r.crm_id = f.crm_id
                                  AND r.of_user_id = f.of_user_id)'''

    if of_user_id:
        base += ' AND f.of_user_id = ?'
        params.append(of_user_id)
    if search:
        base += ' AND (f.username LIKE ? OR f.display_name LIKE ? OR f.fan_of_user_id = ?)'
        needle = f'%{search}%'
        params.extend([needle, needle, search])
    if tag:
        # Match manual fan_tags OR auto-imported OF list memberships.
        base += ''' AND (
                        EXISTS (SELECT 1 FROM fan_tags t2
                                WHERE t2.fan_id = f.id AND t2.tag = ?)
                        OR EXISTS (
                            SELECT 1 FROM subscribers_cache sc3
                            WHERE sc3.crm_id = f.crm_id
                              AND sc3.of_user_id = f.of_user_id
                              AND sc3.fan_of_user_id = f.fan_of_user_id
                              AND sc3.of_lists IS NOT NULL
                              AND EXISTS (SELECT 1 FROM json_each(sc3.of_lists) je
                                          WHERE je.value = ?)
                        )
                    )'''
        params.append(tag)
        params.append(tag)
    # Date filtering — applied to `last_seen_at` (more useful than first_seen
    # for "who was active around date X?"). Both bounds are inclusive ISO-8601.
    if since:
        base += ' AND f.last_seen_at >= ?'
        params.append(since)
    if until:
        base += ' AND f.last_seen_at <= ?'
        params.append(until)

    base += ' GROUP BY f.id'

    # Inner sort column names. Outer (dedup) query re-aliases.
    sort_col_inner = {
        'last_seen': 'f.last_seen_at',
        'first_seen': 'f.first_seen_at',
        'tips': 'total_tips',
        'spend': 'total_spend',
        'events': 'event_count',
    }.get(sort, 'f.last_seen_at')
    if not with_stats and sort in ('tips', 'spend', 'events'):
        sort_col_inner = 'f.last_seen_at'

    if dedupe_by_fan:
        # Wrap the per-row query as a CTE and roll up by fan_of_user_id so
        # the same person under multiple creators becomes one row with
        # SUMMED spend/tips/events and account_count > 1.
        sort_col_outer = {
            'last_seen': 'last_seen_at',
            'first_seen': 'first_seen_at',
            'tips': 'total_tips',
            'spend': 'total_spend',
            'events': 'event_count',
        }.get(sort, 'last_seen_at')
        # Note: tags column is GROUP_CONCAT'd inside the CTE, and we
        # further GROUP_CONCAT it across rows of the same fan. Resulting
        # string can have duplicates if the same tag is on multiple creator
        # rows for the same fan — we de-dup in Python after fetch.
        full = f"""
            WITH per_row AS ({base})
            SELECT MIN(id) AS id,
                   NULL AS of_user_id,
                   fan_of_user_id,
                   MAX(username) AS username,
                   MAX(display_name) AS display_name,
                   MAX(avatar) AS avatar,
                   MIN(first_seen_at) AS first_seen_at,
                   MAX(last_seen_at) AS last_seen_at,
                   MAX(last_event_at) AS last_event_at,
                   COALESCE(SUM(total_tips), 0) AS total_tips,
                   COALESCE(SUM(total_spend), 0) AS total_spend,
                   COALESCE(SUM(event_count), 0) AS event_count,
                   COUNT(DISTINCT of_user_id) AS account_count,
                   GROUP_CONCAT(DISTINCT of_user_id) AS account_ids,
                   GROUP_CONCAT(DISTINCT tags) AS tags,
                   GROUP_CONCAT(DISTINCT of_lists) AS of_lists,
                   MAX(spend_known) AS spend_known
            FROM per_row
            GROUP BY fan_of_user_id
            ORDER BY {sort_col_outer} DESC NULLS LAST, MIN(id) DESC
            LIMIT ? OFFSET ?
        """
        rows_params = params + [int(limit), int(offset)]
    else:
        full = base + f' ORDER BY {sort_col_inner} DESC NULLS LAST, f.id DESC LIMIT ? OFFSET ?'
        rows_params = params + [int(limit), int(offset)]

    cur.execute(full, rows_params)
    rows = [dict(r) for r in cur.fetchall()]

    # Compute total when asked. Uses the same filters but ignores limit/offset.
    total = None
    if with_total:
        if dedupe_by_fan:
            count_sql = f"WITH per_row AS ({base}) SELECT COUNT(*) FROM per_row GROUP BY fan_of_user_id"
            cur.execute(count_sql, params)
            total = len(cur.fetchall())
        else:
            count_sql = f"SELECT COUNT(*) FROM ({base})"
            cur.execute(count_sql, params)
            total = int(cur.fetchone()[0])

    conn.close()

    # Tag post-processing. In dedup mode the GROUP_CONCAT-of-GROUP_CONCAT
    # can repeat tags; split + uniq.
    for r in rows:
        raw = r.get('tags') or ''
        if not raw:
            r['tags'] = []
        else:
            parts = [t for chunk in str(raw).split(',') for t in chunk.split(',')]
            seen = set()
            uniq = []
            for t in parts:
                t = t.strip()
                if t and t not in seen:
                    seen.add(t)
                    uniq.append(t)
            r['tags'] = uniq
        # OF auto-imported list names. Non-dedupe: one JSON array string.
        # Dedupe: several JSON arrays GROUP_CONCAT'd (e.g. ["a"],["b"]). Use
        # json.loads so escaped unicode (emoji in list names) decodes correctly;
        # the dedupe form becomes valid JSON once wrapped in brackets.
        raw_ol = r.get('of_lists')
        names = []
        if raw_ol:
            try:
                parsed = _json.loads(raw_ol)
                if isinstance(parsed, list):
                    names = parsed
            except Exception:
                try:
                    for sub in _json.loads('[' + str(raw_ol) + ']'):
                        if isinstance(sub, list):
                            names.extend(sub)
                        elif sub:
                            names.append(sub)
                except Exception:
                    names = []
        seen_ol = set()
        uniq_ol = []
        for n in names:
            n = str(n).strip()
            if n and n not in seen_ol:
                seen_ol.add(n)
                uniq_ol.append(n)
        r['of_lists'] = uniq_ol
        # account_ids comes back as a comma-joined string in dedup mode;
        # split it so the route can return it as a real array.
        if dedupe_by_fan and r.get('account_ids'):
            r['account_ids'] = [a for a in str(r['account_ids']).split(',') if a]

    if with_total:
        return rows, total
    return rows


def add_fan_tag(crm_id, of_user_id, fan_of_user_id, tag, added_by=None):
    fan_id = upsert_fan(crm_id, of_user_id, fan_of_user_id)
    if not fan_id:
        return False
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cur.execute('INSERT INTO fan_tags (fan_id, tag, added_at, added_by) VALUES (?, ?, ?, ?)',
                    (fan_id, tag, now, added_by))
        conn.commit()
        ok = True
    except sqlite3.IntegrityError:
        ok = True  # tag already exists — treat as success
    conn.close()
    return ok


def remove_fan_tag(crm_id, of_user_id, fan_of_user_id, tag):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('''DELETE FROM fan_tags WHERE tag = ? AND fan_id IN
                   (SELECT id FROM fans WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?)''',
                (tag, crm_id, of_user_id, str(fan_of_user_id)))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def set_fan_note(crm_id, of_user_id, fan_of_user_id, note):
    """Set (or clear, with note=None/'') the local private note for a fan.
    Mirrors OnlyFans' per-fan note — kept locally since OF doesn't expose it."""
    fan_id = upsert_fan(crm_id, of_user_id, fan_of_user_id)
    if not fan_id:
        return False
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('UPDATE fans SET note = ? WHERE id = ?', (note or None, fan_id))
    conn.commit()
    conn.close()
    return True


# ---- campaign tags ----
# Direct analog of the fan_tags helpers above. Campaigns have no local row, so
# tags are keyed by the (crm_id, of_user_id, campaign_id) tuple instead of a
# fan_id FK.

def add_campaign_tag(crm_id, of_user_id, campaign_id, tag, added_by=None):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cur.execute('''INSERT INTO campaign_tags
                       (crm_id, of_user_id, campaign_id, tag, added_at, added_by)
                       VALUES (?, ?, ?, ?, ?, ?)''',
                    (crm_id, str(of_user_id), str(campaign_id), tag, now, added_by))
        conn.commit()
        ok = True
    except sqlite3.IntegrityError:
        ok = True  # tag already exists — treat as success
    conn.close()
    return ok


def remove_campaign_tag(crm_id, of_user_id, campaign_id, tag):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('''DELETE FROM campaign_tags
                   WHERE crm_id = ? AND of_user_id = ? AND campaign_id = ? AND tag = ?''',
                (crm_id, str(of_user_id), str(campaign_id), tag))
    conn.commit()
    ok = cur.rowcount > 0
    conn.close()
    return ok


def get_campaign_tags(crm_id, of_user_id):
    """Return {campaign_id: [tag, ...]} for every tagged campaign on this
    account. One SELECT, grouped in Python — cheap enough to call on each
    campaigns-page load and merge into the live OF response."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT campaign_id, tag FROM campaign_tags
                   WHERE crm_id = ? AND of_user_id = ?
                   ORDER BY tag''',
                (crm_id, str(of_user_id)))
    out = {}
    for row in cur.fetchall():
        out.setdefault(str(row['campaign_id']), []).append(row['tag'])
    conn.close()
    return out


# ---- account tags ----
# Third instance of the fan_tags / campaign_tags pattern. Keyed by the
# (crm_id, of_user_id) tuple — see the account_tags DDL for why an of_accounts
# FK would leak rows on disconnect.

def add_account_tag(crm_id, of_user_id, tag, added_by=None):
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        now = datetime.utcnow().isoformat()
        try:
            cur.execute('''INSERT INTO account_tags
                           (crm_id, of_user_id, tag, added_at, added_by)
                           VALUES (?, ?, ?, ?, ?)''',
                        (crm_id, str(of_user_id), tag, now, added_by))
            conn.commit()
        except sqlite3.IntegrityError:
            pass  # tag already on this account — treat as success
        return True
    finally:
        conn.close()


def remove_account_tag(crm_id, of_user_id, tag):
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        cur.execute('''DELETE FROM account_tags
                       WHERE crm_id = ? AND of_user_id = ? AND tag = ?''',
                    (crm_id, str(of_user_id), tag))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def get_account_tags(crm_id, of_user_id=None):
    """Return {of_user_id: [tag, ...]} for this panel (or one account).

    ONE query for the whole panel — the accounts route merges it into the list
    response so 600 accounts still cost a single round trip. Uses the
    UNIQUE(crm_id, of_user_id, tag) auto-index.
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.cursor()
        if of_user_id is None:
            cur.execute('''SELECT of_user_id, tag FROM account_tags
                           WHERE crm_id = ? ORDER BY of_user_id, tag''',
                        (crm_id,))
        else:
            cur.execute('''SELECT of_user_id, tag FROM account_tags
                           WHERE crm_id = ? AND of_user_id = ? ORDER BY tag''',
                        (crm_id, str(of_user_id)))
        out = {}
        for row in cur.fetchall():
            out.setdefault(str(row['of_user_id']), []).append(row['tag'])
        return out
    finally:
        conn.close()


# ---- subscribers cache ----

def _latest_subscribe_action(fan_row):
    """'subscribe' | 'renewal' | 'return' | None for the most recent entry of an
    OF subscriber row's `subscribes[]` history (the rule poller.py uses to pick
    new_subscriber vs renewed_subscriber). Fansly rows carry no such history
    and return None (their subscribed_at never moves on renewal).

    subscribedOnData first — it is where `subscribed_at` is taken from in
    upsert_subscriber, and on live data it carries the history on ~90% of rows
    while subscribedByData.subscribes is mostly null."""
    for key in ('subscribedOnData', 'subscribedByData'):
        data = (fan_row or {}).get(key)
        subs = data.get('subscribes') if isinstance(data, dict) else None
        if isinstance(subs, list) and subs:
            last = subs[-1]
            action = last.get('action') if isinstance(last, dict) else None
            if isinstance(action, str) and action:
                return action.lower()
            return 'subscribe'
    return None


def upsert_subscriber(crm_id, of_user_id, fan_row):
    """Insert or update one subscriber row from an OF /subscribers payload.

    Field mapping (discovered empirically — took several scan iterations):

    - `subscribedByData` — present on every row but the Summ fields are
      always null on this creator. Safe source for subscribe timestamps +
      pricing (which it mirrors anyway).
    - `subscribedOnData` — **this is where the spend breakdown lives**:
        totalSumm, tipsSumm, messagesSumm, postsSumm, streamsSumm,
        subscribesSumm. Also carries subscribeAt / expiredAt / price.
      Typical distribution on a real 20k-sub creator: ~7% have
      `totalSumm > 0`, the rest are free-trial / low-engagement subs.

    A $0 `total_spent` is meaningful (free sub or inactive fan) — do NOT
    treat it as "unknown". Use NULL only when OF itself omits the field.

    Because NULL means "omitted", the re-upsert path preserves rather than
    overwrites for every field where that's true — see the per-column notes
    on the ON CONFLICT clause below.
    """
    if not fan_row or not fan_row.get('id'):
        return False
    sbd = fan_row.get('subscribedByData') or {}
    sod = fan_row.get('subscribedOnData') or {}

    # Prefer subscribedOnData for the spend aggregates; fall back to
    # subscribedByData if OF ever starts populating it there.
    def _pick(*keys):
        """First non-None across a sequence of (obj, key) pairs."""
        for obj, key in keys:
            v = obj.get(key) if isinstance(obj, dict) else None
            if v is not None:
                return v
        return None

    subscribed_at = _pick((sod, 'subscribeAt'), (sbd, 'subscribeAt')) or fan_row.get('subscribedOn')
    expired_at    = _pick((sod, 'expiredAt'),   (sbd, 'expiredAt'))   or fan_row.get('subscribedUntil')
    subscribe_price = _pick((sod, 'subscribePrice'), (sbd, 'subscribePrice'), (fan_row, 'subscribePrice'))

    # Spend breakdown — subscribedOnData.*Summ is the canonical server-side aggregate
    total_spent   = _pick((sod, 'totalSumm'),      (sbd, 'totalSumm'))
    spent_tips    = _pick((sod, 'tipsSumm'),       (sbd, 'tipsSumm'))
    spent_msgs    = _pick((sod, 'messagesSumm'),   (sbd, 'messagesSumm'))
    spent_posts   = _pick((sod, 'postsSumm'),      (sbd, 'postsSumm'))
    spent_streams = _pick((sod, 'streamsSumm'),    (sbd, 'streamsSumm'))
    spent_subs    = _pick((sod, 'subscribesSumm'), (sbd, 'subscribesSumm'))
    campaign_id   = _pick((sod, 'campaignId'),     (sbd, 'campaignId'))
    subscribe_action = _latest_subscribe_action(fan_row) if subscribed_at else None

    # `is_active` is NOT computed here any more — the INSERT below derives it
    # from the same `expired_at` it is writing, via _SUBSCRIPTION_ACTIVE_PARAM_SQL.
    # It used to be a Python datetime.fromisoformat() comparison, which is a
    # second implementation of the same rule: the moment it disagreed with the
    # SQL the read queries use (a timestamp format one side handled and the
    # other didn't), the stored column would stop being a superset of the
    # derived truth and the indexed `active` filter would start dropping live
    # fans. One expression, no drift.

    # Auto-import the creator's CUSTOM OF lists this fan belongs to (the
    # "whales"/"VIP"/… groups). System lists (fans, following, muted, …) are
    # ignored — only type='custom' with hasUser=true is a real assignment.
    of_lists = None
    try:
        names = sorted({
            (s.get('name') or '').strip()
            for s in (fan_row.get('listsStates') or [])
            if isinstance(s, dict)
            and s.get('type') == 'custom'
            and s.get('hasUser')
            and (s.get('name') or '').strip()
        })
        if names:
            of_lists = _json.dumps(names)
    except Exception:
        of_lists = None

    # last_synced_at format must match OF's tx.created_at so SQL `>` in
    # earnings_model.compute_current_spent orders correctly. See iso_utc_now().
    now = iso_utc_now()

    # On re-upsert, COALESCE(excluded.x, x) means "keep what we already know
    # when this payload didn't carry the field". It is NOT applied blanket —
    # for a few columns a NULL is the platform telling us something:
    #
    #   username / display_name / avatar — identity, guarded. On Fansly these
    #     come from a SEPARATE hydration call (_normalize_subscription reads
    #     them off the batched /account?ids= object), so a fan the hydration
    #     missed arrives with all three None; on OF the avatar is a signed CDN
    #     URL that some rows just omit. Unguarded, one such page blanked a good
    #     avatar permanently — the missing-profile-picture bug. A fan who
    #     genuinely deletes their avatar only keeps a URL that 404s, which the
    #     UI already falls back from: much the cheaper failure.
    #   subscribed_at — guarded. The row exists because a subscription happened,
    #     so NULL is never "no start date", only "not in this payload". It's
    #     also the delta walker's stop-signal (get_cached_subscriber_subscribe_at)
    #     — nulling it makes the next delta sync walk straight past its anchor.
    #   subscribe_price / total_spent / spent_* — guarded. Per the $0 note
    #     above, a free or non-spending sub reports 0, never NULL, so NULL only
    #     ever means omitted. earnings_model does `float(total_spent or 0)`, so
    #     nulling wiped a fan's whole lifetime spend and the campaign revenue
    #     that JOINs against it.
    #
    #   expired_at — NOT guarded. NULL is real here: it's how a renewed /
    #     open-ended sub reports "no end date". It also has to move in lockstep
    #     with is_active, which is derived from it in the same statement —
    #     guarding one and not the other would leave rows flagged active with a
    #     stale past expiry.
    #   is_active — NOT guarded; derived in-statement from the expired_at being
    #     written, always 0 or 1, never NULL.
    #   of_lists — NOT guarded. De-listing a fan is a normal transition and the
    #     Fans page renders these as tags, so a "whale" tag that can never be
    #     cleared is worse than one that reappears on the next sync. (Fansly
    #     rows carry no listsStates at all, but a cache row is only ever written
    #     by one platform's sync, so it can't cross-blank an OF row.)
    #   raw_json / last_synced_at — NOT guarded; always non-NULL here, and
    #     last_synced_at is the snapshot boundary earnings_model layers
    #     transactions on top of, so it must advance on every sync.
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute(f'''INSERT INTO subscribers_cache
                   (crm_id, of_user_id, fan_of_user_id, username, display_name, avatar,
                    subscribed_at, expired_at, subscribe_price,
                    total_spent, spent_tips, spent_messages, spent_posts,
                    spent_streams, spent_subscriptions,
                    is_active, campaign_id, of_lists, raw_json, last_synced_at,
                    subscribe_action)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                           CASE WHEN {_SUBSCRIPTION_ACTIVE_PARAM_SQL} THEN 1 ELSE 0 END,
                           ?, ?, ?, ?, ?)
                   ON CONFLICT(crm_id, of_user_id, fan_of_user_id) DO UPDATE SET
                       username = COALESCE(excluded.username, subscribers_cache.username),
                       display_name = COALESCE(excluded.display_name, subscribers_cache.display_name),
                       avatar = COALESCE(excluded.avatar, subscribers_cache.avatar),
                       subscribed_at = COALESCE(excluded.subscribed_at, subscribers_cache.subscribed_at),
                       expired_at = excluded.expired_at,
                       subscribe_price = COALESCE(excluded.subscribe_price, subscribers_cache.subscribe_price),
                       total_spent = COALESCE(excluded.total_spent, subscribers_cache.total_spent),
                       spent_tips = COALESCE(excluded.spent_tips, subscribers_cache.spent_tips),
                       spent_messages = COALESCE(excluded.spent_messages, subscribers_cache.spent_messages),
                       spent_posts = COALESCE(excluded.spent_posts, subscribers_cache.spent_posts),
                       spent_streams = COALESCE(excluded.spent_streams, subscribers_cache.spent_streams),
                       spent_subscriptions = COALESCE(excluded.spent_subscriptions, subscribers_cache.spent_subscriptions),
                       is_active = excluded.is_active,
                       campaign_id = COALESCE(excluded.campaign_id, subscribers_cache.campaign_id),
                       of_lists = excluded.of_lists,
                       raw_json = excluded.raw_json,
                       last_synced_at = excluded.last_synced_at,
                       -- Describes the event at subscribed_at, so it moves only
                       -- when subscribed_at is supplied (subscribed_at is
                       -- guarded above; keep the pair in step).
                       subscribe_action = CASE WHEN excluded.subscribed_at IS NULL
                                               THEN subscribers_cache.subscribe_action
                                               ELSE excluded.subscribe_action END''',
                (crm_id, str(of_user_id), str(fan_row['id']),
                 fan_row.get('username'), fan_row.get('name'), fan_row.get('avatar'),
                 subscribed_at, expired_at, subscribe_price,
                 total_spent, spent_tips, spent_msgs, spent_posts,
                 spent_streams, spent_subs,
                 expired_at,          # feeds the is_active CASE — same value as the column
                 campaign_id, of_lists,
                 _json.dumps(fan_row), now,
                 subscribe_action))
    conn.commit()
    conn.close()
    return True


def get_cached_subscriber_subscribe_at(crm_id, of_user_id, fan_of_user_id):
    """Return the stored `subscribed_at` for one fan, or None. Used as the
    stop-signal by the delta sync walker."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('''SELECT subscribed_at FROM subscribers_cache
                   WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
                (crm_id, str(of_user_id), str(fan_of_user_id)))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None


def list_cached_subscribers(crm_id, of_user_id, type_='all', limit=100, offset=0,
                              sort='subscribed_at', since=None, until=None):
    """Read subscribers out of the cache.

    type_ in {all, active, expired} — evaluated against wall-clock NOW, not
          against the stored snapshot, so a subscription that lapsed since the
          last sync reports as expired immediately (see below).
    sort  in {subscribed_at, total_spent, expired_at, username} — any other
          value collapses to `subscribed_at`. Always DESC (newest / highest
          first) since that's the sort the UI wants; if we ever need ASC we
          can add an explicit direction.
    since/until: optional inclusive bounds on ``subscribed_at`` (ISO-8601).
          The (crm_id, of_user_id, is_active, subscribed_at DESC) index
          covers both predicates.

    The returned rows carry the DERIVED `is_active`, not the stored column, so
    every caller that merely projects the field (/subscribers/cached,
    /subscribers/new, the export CSV) is consistent with the filter.
    """
    limit = max(1, min(int(limit or 100), 500))
    offset = max(0, int(offset or 0))
    where = "crm_id = ? AND of_user_id = ?"
    params = [crm_id, str(of_user_id)]
    # THE INVARIANT: stored is_active=1 is a SUPERSET of the truly-active set.
    #
    # The only writer of the column is upsert_subscriber, which derives it from
    # the very expired_at it writes in the same statement. So at write time
    # stored == derived, and the only thing that can change afterwards is the
    # clock — which only ever moves rows from live to lapsed. A stored 1 can
    # therefore decay into a false positive; a stored 0 can NEVER become a
    # false negative. (recompute_subscriber_activity re-checks both directions
    # anyway, so a future direct writer that broke this heals within a sweep.)
    #
    # That asymmetry is what lets us be exactly correct for free. `is_active=1`
    # seeks straight into idx_subs_cache_account and hands back rows already in
    # subscribed_at DESC order; the derived term then discards the decayed ones
    # while the index is doing the work. Measured on a synthetic 3M-row cache
    # (500 accounts, LIMIT 100):
    #
    #   is_active=1 alone (old, stale)          0.113 ms   index seek
    #   derived alone (naive fix)               2.151 ms   falls off the index
    #                                                      onto sqlite_autoindex
    #                                                      + TEMP B-TREE sort
    #   is_active=1 AND derived (this)          0.137 ms   same plan as before
    #
    # So: do NOT "simplify" this by deleting the is_active term. It is not
    # redundant — it is the index anchor, and the derived term alone is a 19x
    # regression that grows with the account's roster.
    if type_ == 'active':
        where += f" AND is_active = 1 AND {SUBSCRIPTION_ACTIVE_SQL}"
    elif type_ == 'expired':
        # No index anchor available on this side: truly-expired = "expiry in
        # the past", which includes the stale is_active=1 rows, so `is_active=0`
        # would under-report by exactly the bug we're fixing. Costs ~2.5ms at
        # 3M rows vs 0.115ms — accepted, this is the rarely-used filter and the
        # alternative is a whole second index paid for on every one of the 20k
        # upserts a full subs walk does.
        where += f" AND NOT ({SUBSCRIPTION_ACTIVE_SQL})"
    if since:
        where += " AND subscribed_at >= ?"
        params.append(since)
    if until:
        where += " AND subscribed_at <= ?"
        params.append(until)
    # Whitelist sort column to avoid SQL injection via the query string.
    sort_col = {
        'total_spent':   'COALESCE(total_spent, 0) DESC',
        'expired_at':    'expired_at DESC',
        'username':      'username COLLATE NOCASE ASC',
        'subscribed_at': 'subscribed_at DESC',
    }.get(sort, 'subscribed_at DESC')
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # Project the derived value over the stored one. Aliased and swapped in
    # Python rather than selected twice as `is_active`: duplicate column names
    # in a sqlite3.Row make dict() silently pick one, and which one is not
    # something we want this to depend on.
    cur.execute(f'''SELECT *,
                           CASE WHEN {SUBSCRIPTION_ACTIVE_SQL} THEN 1 ELSE 0 END
                             AS is_active_derived
                    FROM subscribers_cache WHERE {where}
                    ORDER BY {sort_col}
                    LIMIT ? OFFSET ?''', (*params, limit, offset))
    rows = []
    for r in cur.fetchall():
        row = dict(r)
        row['is_active'] = row.pop('is_active_derived')
        rows.append(row)
    # total count for pagination
    cur.execute(f'SELECT COUNT(*) FROM subscribers_cache WHERE {where}', params)
    total = cur.fetchone()[0]
    conn.close()
    return rows, total


# Bucket expressions, parameterised on the timestamp so the same rule can be
# applied to a stored `subscribed_at` (GROUP BY) and to a caller-supplied
# since/until bound (working out where the zero-filled axis starts and ends).
#
# The 'week' expression looks wrong and isn't: in SQLite `weekday 0` is SUNDAY,
# not Monday. 'weekday N' advances to the next date whose weekday is N, staying
# put if it is already that weekday — so a Mon–Sat date jumps forward to the
# Sunday that ENDS its Mon–Sun week and a Sunday stays on itself, after which
# '-6 days' lands every one of the seven on the same Monday. Verified against
# all seven weekdays. The obvious-looking "fix", date(t,'weekday 1','-7 days'),
# is the broken one: it sends Mondays back into the PREVIOUS week's bucket.
_BUCKET_EXPR = {
    'hour':  "strftime('%Y-%m-%dT%H:00:00Z', {t})",
    'day':   "strftime('%Y-%m-%d', {t})",
    'week':  "date({t}, 'weekday 0', '-6 days')",
    'month': "strftime('%Y-%m', {t})",
}
_BUCKET_FORMAT = {
    'hour':  '%Y-%m-%dT%H:00:00Z',
    'day':   '%Y-%m-%d',
    'week':  '%Y-%m-%d',
    'month': '%Y-%m',
}

# Ceiling on how many buckets we will zero-fill. Without one, `granularity=hour`
# with no since/until on a three-year-old account asks for ~26k buckets — a
# ~1MB JSON response built to describe a few hundred subscriptions. Past the
# cap we hand back the sparse series and say so (zero_filled=False) rather than
# truncating, because a silently short axis is a chart that lies.
MAX_TIMESERIES_BUCKETS = 1500


def _next_bucket(dt, granularity):
    """Advance one bucket. Month is special-cased — timedelta has no month."""
    if granularity == 'hour':
        return dt + timedelta(hours=1)
    if granularity == 'week':
        return dt + timedelta(days=7)
    if granularity == 'month':
        return dt.replace(year=dt.year + (dt.month == 12),
                          month=1 if dt.month == 12 else dt.month + 1, day=1)
    return dt + timedelta(days=1)


def new_subscribers_timeseries(crm_id, of_user_id, since=None, until=None,
                               granularity='day'):
    """Bucketed counts of incoming subscriptions by ``subscribed_at``.

    granularity in {hour, day, week, month} — anything else collapses to
    `day`. Week buckets are ISO Monday-start dates (see _BUCKET_EXPR for why
    the SQL says `weekday 0`). Timestamps with a UTC offset are normalized by
    SQLite's date functions, so mixed formats in the cache still land in the
    right bucket. Rows with NULL subscribed_at are excluded (they can't be
    placed on a timeline).

    Empty buckets are ZERO-FILLED server-side. This used to be the caller's
    job, which was the wrong split: reconstructing the axis needs the bucketing
    rule (including the Monday-start week trick), so every client had to
    reimplement it or draw a chart that quietly compresses a quiet week into
    nothing. Filling the series server-side keeps every client honest.

    The axis spans [since, until] when both are supplied — so an explicitly
    requested window comes back complete even if it contains no subscriptions
    at all — and otherwise falls back to the first/last bucket that has data,
    which keeps an unbounded query from generating history nobody asked for.

    Returns (buckets, total, zero_filled) where buckets is
    [{'bucket': str, 'count': int}] in ascending bucket order, total is the row
    count in the window, and zero_filled says whether the axis is contiguous —
    it is False when the span exceeded MAX_TIMESERIES_BUCKETS, and the caller
    is then back to filling gaps itself.
    """
    granularity = granularity if granularity in _BUCKET_EXPR else 'day'
    bucket_expr = _BUCKET_EXPR[granularity]
    where = "crm_id = ? AND of_user_id = ? AND subscribed_at IS NOT NULL"
    params = [crm_id, str(of_user_id)]
    if since:
        where += " AND subscribed_at >= ?"
        params.append(since)
    if until:
        where += " AND subscribed_at <= ?"
        params.append(until)
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        cur.execute(f'''SELECT {bucket_expr.format(t='subscribed_at')} AS bucket,
                               COUNT(*) AS count
                        FROM subscribers_cache WHERE {where}
                        GROUP BY bucket ORDER BY bucket ASC''', params)
        buckets = [{'bucket': b, 'count': c} for b, c in cur.fetchall() if b is not None]
        # Bound the axis. SQLite resolves the bounds, not Python, so the caller's
        # since/until go through the exact same bucketing rule as the rows do —
        # including the offset normalisation and the Monday-start week.
        lo = hi = None
        if since or until:
            expr = bucket_expr.format(t='?')
            row = cur.execute(f'SELECT {expr}, {expr}',
                              (since or until, until or since)).fetchone()
            lo, hi = (row[0] if since else None), (row[1] if until else None)
    finally:
        conn.close()
    total = sum(b['count'] for b in buckets)

    if buckets:
        lo = min(lo, buckets[0]['bucket']) if lo else buckets[0]['bucket']
        hi = max(hi, buckets[-1]['bucket']) if hi else buckets[-1]['bucket']
    if not lo or not hi or lo > hi:
        # Nothing to span: no data and no explicit window (or an inverted one).
        return buckets, total, True

    fmt = _BUCKET_FORMAT[granularity]
    counts = {b['bucket']: b['count'] for b in buckets}
    dense = []
    cursor_dt = datetime.strptime(lo, fmt)
    end_dt = datetime.strptime(hi, fmt)
    while cursor_dt <= end_dt:
        label = cursor_dt.strftime(fmt)
        dense.append({'bucket': label, 'count': counts.get(label, 0)})
        if len(dense) > MAX_TIMESERIES_BUCKETS:
            return buckets, total, False
        cursor_dt = _next_bucket(cursor_dt, granularity)
    return dense, total, True


def subscribers_cache_summary(crm_id, of_user_id):
    """Quick counts + spend aggregates + freshness for the /refresh/status
    endpoint. Uses the `subscribedOnData.*Summ` fields populated at upsert.

    active/expired are derived from expired_at (SUBSCRIPTION_ACTIVE_SQL), same
    as the /subscribers/cached filters — this summary is embedded in those very
    responses, so a stored-column count here would have contradicted the list
    it was attached to.

    Deriving is effectively free here even though it can't use the index
    anchor: the query already SUMs six spend columns that aren't in
    idx_subs_cache_account, so it was reading full rows regardless. Measured at
    3M rows: 2.947 ms stored → 2.978 ms derived.

    expired is written as the complement of active rather than its own CASE so
    the two can never disagree — every row lands in exactly one bucket and
    active + expired == total by construction.
    """
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(f'''SELECT
                     COUNT(*) AS total,
                     SUM(CASE WHEN {SUBSCRIPTION_ACTIVE_SQL} THEN 1 ELSE 0 END) AS active,
                     SUM(CASE WHEN {SUBSCRIPTION_ACTIVE_SQL} THEN 0 ELSE 1 END) AS expired,
                     SUM(CASE WHEN COALESCE(total_spent,0) > 0 THEN 1 ELSE 0 END) AS spenders,
                     COALESCE(SUM(total_spent), 0)         AS total_spent_sum,
                     COALESCE(SUM(spent_tips), 0)          AS tips_sum,
                     COALESCE(SUM(spent_messages), 0)      AS messages_sum,
                     COALESCE(SUM(spent_posts), 0)         AS posts_sum,
                     COALESCE(SUM(spent_streams), 0)       AS streams_sum,
                     COALESCE(SUM(spent_subscriptions), 0) AS subscriptions_sum,
                     MAX(last_synced_at) AS last_row_synced_at
                   FROM subscribers_cache
                   WHERE crm_id = ? AND of_user_id = ?''',
                (crm_id, str(of_user_id)))
    row = dict(cur.fetchone() or {})
    # refresh-level status lives on of_accounts
    panel = get_crm_panel(crm_id)
    account_meta = None
    if panel:
        cur.execute('''SELECT last_subscribers_refresh_at, subscribers_refresh_failure_count
                       FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (panel['id'], of_user_id))
        r = cur.fetchone()
        if r:
            account_meta = dict(r)
    conn.close()
    return {
        'total': row.get('total') or 0,
        'active': row.get('active') or 0,
        'expired': row.get('expired') or 0,
        'spenders': row.get('spenders') or 0,
        'total_spent_sum':     round(row.get('total_spent_sum') or 0.0, 2),
        'breakdown': {
            'tips':          round(row.get('tips_sum') or 0.0, 2),
            'messages':      round(row.get('messages_sum') or 0.0, 2),
            'posts':         round(row.get('posts_sum') or 0.0, 2),
            'streams':       round(row.get('streams_sum') or 0.0, 2),
            'subscriptions': round(row.get('subscriptions_sum') or 0.0, 2),
        },
        'last_row_synced_at': row.get('last_row_synced_at'),
        'last_refreshed_at': (account_meta or {}).get('last_subscribers_refresh_at'),
        'consecutive_failures': (account_meta or {}).get('subscribers_refresh_failure_count') or 0,
    }


def recompute_subscriber_activity(chunk_size=2000, max_rows=None):
    """Converge the stored `subscribers_cache.is_active` onto the derived truth.

    Reads do NOT need this — they apply SUBSCRIPTION_ACTIVE_SQL themselves and
    are exact to the second whether or not this ever runs. It exists for two
    other reasons:

      1. Index selectivity. The `active` filter seeks the is_active=1 bucket of
         idx_subs_cache_account and discards decayed rows as it goes. Left
         alone that bucket only grows — on the 7-day OF walk cadence it
         accumulates a week of lapses — so the seek has to read further and
         further past the page size to fill a LIMIT 100. Converging it keeps
         the bucket ≈ the real active set, which is what makes the derived
         term cost 0.02ms instead of mattering.
      2. Honesty for everything that reads the column outside these helpers:
         an ad-hoc query, a future JOIN, someone opening crm_data.db during an
         incident. A stored flag that is a week wrong is a trap.

    Panel-agnostic on purpose. Liveness is a per-row property of that row's own
    expired_at, so there is nothing tenant-specific to scope: no cross-tenant
    data is read, and the only thing written is each row's own derived flag.

    Chunked by rowid, one commit per chunk. A single statement over the whole
    table is a ~790ms write transaction at 3M rows (measured), and on this box
    everything else queues behind it — including every poller's cursor write,
    which is exactly the contention the split jobstore exists to avoid. 2000-row
    transactions keep each lock hold in the low milliseconds; the expensive part
    (scanning for candidates) happens in the SELECT, which takes no write lock.

    `max_rows` bounds one pass so a first run against a long-neglected cache
    can't hold a worker indefinitely — leftovers are picked up next sweep.

    Returns the number of rows changed.
    """
    # COALESCE guards a NULL is_active: `NULL <> 1` is NULL, not true, so an
    # unguarded comparison would skip such a row forever instead of healing it.
    derived = f"CASE WHEN {SUBSCRIPTION_ACTIVE_SQL} THEN 1 ELSE 0 END"
    changed = 0
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        last_rowid = 0
        while max_rows is None or changed < max_rows:
            take = chunk_size if max_rows is None else min(chunk_size, max_rows - changed)
            cur.execute(f'''SELECT rowid, {derived} FROM subscribers_cache
                            WHERE rowid > ? AND COALESCE(is_active, -1) <> {derived}
                            ORDER BY rowid LIMIT ?''', (last_rowid, take))
            batch = cur.fetchall()
            if not batch:
                break
            for value in (0, 1):
                ids = [r[0] for r in batch if r[1] == value]
                if ids:
                    cur.execute(
                        'UPDATE subscribers_cache SET is_active = ? WHERE rowid IN (%s)'
                        % ','.join('?' * len(ids)), (value, *ids))
            conn.commit()
            changed += len(batch)
            last_rowid = batch[-1][0]
    finally:
        conn.close()
    return changed


def mark_subscribers_refresh(crm_id, of_user_id, success):
    """Update of_accounts.last_subscribers_refresh_at and the failure counter."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return False
    now = iso_utc_now()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    if success:
        cur.execute('''UPDATE of_accounts
                       SET last_subscribers_refresh_at = ?,
                           subscribers_refresh_failure_count = 0
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (now, panel['id'], of_user_id))
    else:
        cur.execute('''UPDATE of_accounts
                       SET subscribers_refresh_failure_count =
                           COALESCE(subscribers_refresh_failure_count, 0) + 1
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (panel['id'], of_user_id))
    conn.commit()
    conn.close()
    return True


def apply_fansly_spend_from_tx_cache(crm_id, of_user_id):
    """Backfill subscribers_cache spend columns for a FANSLY account from the
    synced wallet ledger (fansly_sync → transactions_cache).

    Fansly /subscribers rows carry no spend aggregates (OF's *Summ fields), so
    the only per-fan spend signal is ledger rows whose fan_of_user_id was
    resolved from correlationAccountId. Amounts here are GROSS dollars
    (transactions_cache.amount — see fansly_normalize._tx_money), matching the
    OF convention where total_spent is what the fan PAID. Payout rows are
    excluded (money leaving the wallet is not fan spend). Streams stay NULL —
    no Fansly ledger type maps to them.

    Subscribers with no attributable ledger rows are left untouched (NULL =
    spend unknown), NOT zeroed — a Fansly $0 would be a claim we can't back.
    Pure local SQL; returns the number of subscriber rows updated.
    """
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        cur.execute('''
            SELECT fan_of_user_id,
                   ROUND(SUM(amount), 2),
                   ROUND(SUM(CASE WHEN tx_type = 'tip'          THEN amount ELSE 0 END), 2),
                   ROUND(SUM(CASE WHEN tx_type = 'message'      THEN amount ELSE 0 END), 2),
                   ROUND(SUM(CASE WHEN tx_type = 'post'         THEN amount ELSE 0 END), 2),
                   ROUND(SUM(CASE WHEN tx_type = 'subscription' THEN amount ELSE 0 END), 2)
            FROM transactions_cache
            WHERE crm_id = ? AND of_user_id = ?
              AND fan_of_user_id IS NOT NULL
              AND COALESCE(tx_type, '') NOT IN ('payout', 'transfer', 'chargeback')
            GROUP BY fan_of_user_id''', (crm_id, str(of_user_id)))
        updated = 0
        for fan_id, total, tips, msgs, posts, subs in cur.fetchall():
            cur.execute('''UPDATE subscribers_cache
                           SET total_spent = ?, spent_tips = ?, spent_messages = ?,
                               spent_posts = ?, spent_subscriptions = ?
                           WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
                        (total, tips, msgs, posts, subs,
                         crm_id, str(of_user_id), str(fan_id)))
            updated += cur.rowcount
        conn.commit()
        return updated
    finally:
        conn.close()


def list_accounts_needing_subs_refresh():
    """Return every of_account currently eligible for a scheduled subs refresh.
    Eligibility = polling_enabled=1 (we already have a working session/proxy)
    OR an explicit session exists — reusing polling_enabled keeps the job set
    aligned with what the scheduler already owns."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT a.of_user_id, a.proxy, a.last_subscribers_refresh_at, p.crm_id
                   FROM of_accounts a
                   JOIN crm_panels p ON a.crm_panel_id = p.id
                   WHERE a.polling_enabled = 1''')
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


# ---- transactions cache ----

# tx_type values a normalizer may assert directly (see _classify_tx).
_EXPLICIT_TX_TYPES = frozenset({
    'tip', 'message', 'subscription', 'renewal', 'post', 'stream', 'story',
    'referral', 'payout', 'transfer', 'chargeback',
})


def reclassify_fansly_tx_types(type_map, earnings_destination=2):
    """Bring stored tx_type for Fansly ledger rows in line with
    fansly_wallet.fansly_tx_type (mirrored here in SQL — keep in step):

        code is payout            → 'payout'
        destination != earnings   → 'transfer'   (money between own wallets)
        code known                → its label
        otherwise                 → untouched   (keyword classification stays)

    `raw_json` for these rows is the normalized dict, so the wallet row lives
    under `$.raw`. Reversed ('undo') rows keep 'chargeback'. Idempotent: only
    rows whose stored type differs are updated, so a re-run changes nothing.
    Per-fan spend is recomputed for any account whose rows changed, because
    spent_subscriptions / spent_tips key off tx_type. Returns rows updated.
    """
    if not type_map:
        return 0
    codes = sorted(int(c) for c in type_map)
    payout_codes = [c for c in codes if type_map[c] == 'payout']
    code_expr = ("(CASE WHEN json_valid(raw_json) THEN "
                 "CAST(json_extract(raw_json, '$.raw.type') AS INTEGER) END)")
    dest_expr = ("(CASE WHEN json_valid(raw_json) THEN "
                 "json_extract(raw_json, '$.raw.destination') END)")
    whens = []
    params = []
    if payout_codes:
        whens.append(f"WHEN {code_expr} IN ({','.join('?' * len(payout_codes))}) THEN 'payout'")
        params.extend(payout_codes)
    whens.append(f"WHEN {dest_expr} IS NOT NULL AND CAST({dest_expr} AS TEXT) != ? THEN 'transfer'")
    params.append(str(earnings_destination))
    for c in codes:
        if type_map[c] == 'payout':
            continue
        whens.append(f"WHEN {code_expr} = ? THEN ?")
        params.extend([c, type_map[c]])
    desired = f"(CASE {' '.join(whens)} END)"

    conn = sqlite3.connect(DB_FILE)
    try:
        accounts = conn.execute(
            '''SELECT p.crm_id, a.of_user_id FROM of_accounts a
               JOIN crm_panels p ON p.id = a.crm_panel_id
               WHERE COALESCE(a.platform, 'onlyfans') = 'fansly' ''').fetchall()
        changed_accounts = []
        total = 0
        for crm_id, of_user_id in accounts:
            cur = conn.execute(
                f'''UPDATE transactions_cache SET tx_type = {desired}
                    WHERE crm_id = ? AND of_user_id = ?
                      AND COALESCE(status, '') != 'undo'
                      AND {desired} IS NOT NULL
                      AND COALESCE(tx_type, '') != {desired}''',
                params + [crm_id, str(of_user_id)] + params + params)
            if cur.rowcount:
                total += cur.rowcount
                changed_accounts.append((crm_id, str(of_user_id)))
        conn.commit()
    finally:
        conn.close()
    for crm_id, of_user_id in changed_accounts:
        try:
            apply_fansly_spend_from_tx_cache(crm_id, of_user_id)
        except Exception as e:
            print(f'[db] fansly spend recompute failed for {crm_id}/{of_user_id}: {e}')
    if total:
        print(f'[db] reclassified {total} fansly ledger rows across '
              f'{len(changed_accounts)} account(s)')
    return total


def _classify_tx(tx):
    """Decide the `tx_type` label for a transaction row.

    Status wins over description: a row with `status='undo'` is a chargeback
    regardless of what the original description said (OF leaves the original
    description like "Payment for message…" even when it's been reversed).
    This keeps the natural-language filter "show me chargebacks" honest — a
    user searching for those expects undone rows, not rows whose description
    contains the word "chargeback".

    For non-undo rows we fall back to keyword matching on the OF description.
    Examples observed on live data:
        "Payment for message from <a>...</a>"       → message
        "Tip from <a>...</a>"                       → tip
        "Subscription by <a>...</a>"                → subscription
        "Subscription renewed by <a>...</a>"        → renewal
        "Payment for post from <a>...</a>"          → post
        "Payment for stream from <a>...</a>"        → stream
        "Referral"                                   → referral
    """
    if tx and tx.get('status') == 'undo':
        return 'chargeback'
    # An exact type supplied by the normalizer (Fansly: derived from the wallet
    # type code) beats keyword matching. Fansly descriptions are synthetic and
    # embed the fan's display name, so a fan called "Tipsy" or "Payout King"
    # would otherwise misfile a subscription as a tip or drop it from earnings
    # altogether. Raw OF /payouts/transactions rows carry no `tx_type` key, so
    # OnlyFans classification is unchanged.
    explicit = (tx or {}).get('tx_type')
    if isinstance(explicit, str) and explicit in _EXPLICIT_TX_TYPES:
        return explicit
    desc = (tx or {}).get('description') or ''
    d = desc.lower()
    if 'chargeback' in d or 'refund' in d or 'reversal' in d:
        return 'chargeback'
    # Fansly wallet withdrawals (synthetic description from fansly_normalize).
    # Must be classifiable so earnings math can exclude them.
    if 'payout' in d or 'withdrawal' in d:
        return 'payout'
    if 'referral' in d:
        return 'referral'
    if 'tip' in d:
        return 'tip'
    if 'message' in d:
        return 'message'
    if 'renewed' in d or 'renewal' in d:
        return 'renewal'
    if 'subscription' in d or 'subscribe' in d:
        return 'subscription'
    if 'post' in d:
        return 'post'
    if 'stream' in d:
        return 'stream'
    if 'story' in d:
        return 'story'
    return 'other' if desc else 'unknown'


def upsert_transaction(crm_id, of_user_id, tx):
    """Store one transaction from /payouts/transactions.

    Returns `True` if this was a NEW row (i.e. we hadn't seen this tx_id before),
    `False` if it was an update. The new-row signal is what the delta walker
    uses to decide whether to keep walking or stop."""
    if not tx or not tx.get('id'):
        return False
    user_obj = tx.get('user') or {}
    now = iso_utc_now()
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.cursor()
        # Detect prior existence so callers can distinguish new vs update
        cur.execute('SELECT 1 FROM transactions_cache WHERE crm_id = ? AND of_user_id = ? AND tx_id = ?',
                    (crm_id, str(of_user_id), str(tx['id'])))
        existed = cur.fetchone() is not None
        cur.execute('''INSERT INTO transactions_cache
                       (crm_id, of_user_id, tx_id, fan_of_user_id, fan_username,
                        amount, net, fee, vat_amount, tax_amount, media_tax_amount,
                        currency, description, tx_type, status, created_at,
                        raw_json, synced_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(crm_id, of_user_id, tx_id) DO UPDATE SET
                           fan_of_user_id = excluded.fan_of_user_id,
                           fan_username = excluded.fan_username,
                           amount = excluded.amount,
                           net = excluded.net,
                           fee = excluded.fee,
                           vat_amount = excluded.vat_amount,
                           tax_amount = excluded.tax_amount,
                           media_tax_amount = excluded.media_tax_amount,
                           currency = excluded.currency,
                           description = excluded.description,
                           tx_type = excluded.tx_type,
                           status = excluded.status,
                           created_at = excluded.created_at,
                           raw_json = excluded.raw_json,
                           synced_at = excluded.synced_at''',
                    (crm_id, str(of_user_id), str(tx['id']),
                     str(user_obj['id']) if user_obj.get('id') is not None else None,
                     user_obj.get('username'),
                     tx.get('amount'), tx.get('net'), tx.get('fee'),
                     tx.get('vatAmount'), tx.get('taxAmount'), tx.get('mediaTaxAmount'),
                     tx.get('currency'), tx.get('description'),
                     _classify_tx(tx),
                     tx.get('status'), tx.get('createdAt'),
                     _json.dumps(tx), now))
        conn.commit()
        return not existed
    finally:
        conn.close()


def has_transaction(crm_id, of_user_id, tx_id):
    """Quick delta-stop lookup used by the sync walker."""
    if not tx_id:
        return False
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('SELECT 1 FROM transactions_cache WHERE crm_id = ? AND of_user_id = ? AND tx_id = ? LIMIT 1',
                (crm_id, str(of_user_id), str(tx_id)))
    found = cur.fetchone() is not None
    conn.close()
    return found


def latest_transaction_created_at(crm_id, of_user_id):
    """Newest createdAt in cache; used as a cheap 'since' anchor."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('''SELECT created_at FROM transactions_cache
                   WHERE crm_id = ? AND of_user_id = ?
                   ORDER BY created_at DESC LIMIT 1''',
                (crm_id, str(of_user_id)))
    row = cur.fetchone()
    conn.close()
    return row[0] if row else None


def list_transactions_cache(crm_id, of_user_id, *, fan_of_user_id=None,
                             tx_type=None, since=None, until=None,
                             limit=100, offset=0):
    """Read from the tx ledger. All filters are optional.

    ``since`` / ``until`` are inclusive ISO-8601 strings compared against
    ``created_at`` (which is stored as the OF-returned ISO datetime).
    The (crm_id, of_user_id, created_at) index makes both filters cheap.
    """
    limit = max(1, min(int(limit or 100), 1000))
    offset = max(0, int(offset or 0))
    where = "crm_id = ? AND of_user_id = ?"
    params = [crm_id, str(of_user_id)]
    if fan_of_user_id:
        where += " AND fan_of_user_id = ?"
        params.append(str(fan_of_user_id))
    if tx_type:
        where += " AND tx_type = ?"
        params.append(tx_type)
    if since:
        where += " AND created_at >= ?"
        params.append(since)
    if until:
        where += " AND created_at <= ?"
        params.append(until)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(f'''SELECT * FROM transactions_cache WHERE {where}
                    ORDER BY created_at DESC
                    LIMIT ? OFFSET ?''', (*params, limit, offset))
    rows = [dict(r) for r in cur.fetchall()]
    cur.execute(f'SELECT COUNT(*) FROM transactions_cache WHERE {where}', params)
    total = cur.fetchone()[0]
    conn.close()
    return rows, total


def transactions_cache_summary(crm_id, of_user_id):
    """Counts + sums + freshness for the tx refresh/status endpoint."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT COUNT(*) AS total,
                          COALESCE(SUM(amount), 0) AS total_amount,
                          COALESCE(SUM(net), 0) AS total_net,
                          MIN(created_at) AS oldest,
                          MAX(created_at) AS newest
                   FROM transactions_cache
                   WHERE crm_id = ? AND of_user_id = ?''',
                (crm_id, str(of_user_id)))
    summary = dict(cur.fetchone() or {})
    # by type
    cur.execute('''SELECT tx_type, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt
                   FROM transactions_cache WHERE crm_id = ? AND of_user_id = ?
                   GROUP BY tx_type ORDER BY amt DESC''',
                (crm_id, str(of_user_id)))
    by_type = [dict(r) for r in cur.fetchall()]

    # refresh status on of_accounts
    panel = get_crm_panel(crm_id)
    account_meta = None
    if panel:
        cur.execute('''SELECT last_transactions_refresh_at, transactions_refresh_failure_count,
                              last_tx_marker
                       FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (panel['id'], of_user_id))
        r = cur.fetchone()
        if r:
            account_meta = dict(r)
    conn.close()
    return {
        'total': summary.get('total') or 0,
        'total_amount': summary.get('total_amount') or 0.0,
        'total_net': summary.get('total_net') or 0.0,
        'oldest': summary.get('oldest'),
        'newest': summary.get('newest'),
        'by_type': by_type,
        'last_refreshed_at': (account_meta or {}).get('last_transactions_refresh_at'),
        'consecutive_failures': (account_meta or {}).get('transactions_refresh_failure_count') or 0,
        'last_tx_marker': (account_meta or {}).get('last_tx_marker'),
    }


def mark_transactions_refresh(crm_id, of_user_id, success, latest_marker=None):
    """Update last_transactions_refresh_at, failure counter, and (optionally)
    the newest marker seen on this run."""
    panel = get_crm_panel(crm_id)
    if not panel:
        return False
    now = iso_utc_now()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    if success:
        if latest_marker is not None:
            cur.execute('''UPDATE of_accounts
                           SET last_transactions_refresh_at = ?,
                               transactions_refresh_failure_count = 0,
                               last_tx_marker = ?
                           WHERE crm_panel_id = ? AND of_user_id = ?''',
                        (now, str(latest_marker), panel['id'], of_user_id))
        else:
            cur.execute('''UPDATE of_accounts
                           SET last_transactions_refresh_at = ?,
                               transactions_refresh_failure_count = 0
                           WHERE crm_panel_id = ? AND of_user_id = ?''',
                        (now, panel['id'], of_user_id))
    else:
        cur.execute('''UPDATE of_accounts
                       SET transactions_refresh_failure_count =
                           COALESCE(transactions_refresh_failure_count, 0) + 1
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (panel['id'], of_user_id))
    conn.commit()
    conn.close()
    return True


# ---- campaign claimers cache ----

def upsert_campaign_claimer(crm_id, of_user_id, campaign_id, claimer_row):
    """Store one claimer returned by /campaigns/{cid}/claimers.

    Returns True if it was a new row, False if seen before. The delta walker
    uses the "already seen" signal the same way transactions does."""
    if not claimer_row or not claimer_row.get('id'):
        return False
    fan_id = str(claimer_row['id'])
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('''SELECT 1 FROM campaign_claimers_cache
                   WHERE crm_id=? AND of_user_id=? AND campaign_id=? AND fan_of_user_id=?''',
                (crm_id, str(of_user_id), str(campaign_id), fan_id))
    existed = cur.fetchone() is not None
    now = iso_utc_now()
    # OF's claimer rows don't carry a claim timestamp. Best we can do on first
    # insert is "now"; on re-insert we preserve whatever we had.
    claimed_at = (claimer_row.get('subscribedOnData') or {}).get('subscribeAt') or now
    cur.execute('''INSERT INTO campaign_claimers_cache
                   (crm_id, of_user_id, campaign_id, fan_of_user_id, fan_username,
                    claimed_at, raw_json, synced_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(crm_id, of_user_id, campaign_id, fan_of_user_id) DO UPDATE SET
                       fan_username = excluded.fan_username,
                       raw_json = excluded.raw_json,
                       synced_at = excluded.synced_at''',
                (crm_id, str(of_user_id), str(campaign_id), fan_id,
                 claimer_row.get('username'),
                 claimed_at, _json.dumps(claimer_row), now))
    conn.commit()
    conn.close()
    return not existed


def list_campaign_claimers(crm_id, of_user_id, campaign_id, *, limit=100, offset=0,
                            since=None, until=None):
    """Read claimers for one campaign. Left-joins against subscribers_cache so
    each row carries the fan's spending (if they're also in subs cache).

    ``since`` / ``until`` are inclusive ISO bounds on ``claimed_at`` —
    answers "who claimed this campaign last week?".
    """
    limit = max(1, min(int(limit or 100), 1000))
    offset = max(0, int(offset or 0))
    where_extra = ""
    extra_params: list = []
    if since:
        where_extra += " AND cc.claimed_at >= ?"
        extra_params.append(since)
    if until:
        where_extra += " AND cc.claimed_at <= ?"
        extra_params.append(until)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(f'''
        SELECT cc.fan_of_user_id, cc.fan_username, cc.claimed_at, cc.raw_json AS claimer_raw,
               sc.total_spent, sc.spent_tips, sc.spent_messages, sc.spent_posts,
               sc.spent_streams, sc.spent_subscriptions,
               sc.subscribe_price, sc.subscribed_at, sc.expired_at,
               -- Derived, not sc.is_active: the stored flag is a snapshot from
               -- the last subs walk (up to 7 days old), and a claimer list that
               -- says "active" about a fan the Subscribers page calls expired is
               -- the kind of contradiction people file bugs about. NULL stays
               -- NULL — a claimer with no subs row has unknown status, which is
               -- not the same as expired.
               CASE WHEN sc.fan_of_user_id IS NULL THEN NULL
                    WHEN COALESCE(datetime(sc.expired_at), '9999-12-31')
                         > datetime('now') THEN 1 ELSE 0 END AS is_active,
               sc.raw_json AS sub_raw
        FROM campaign_claimers_cache cc
        LEFT JOIN subscribers_cache sc
               ON sc.crm_id = cc.crm_id
              AND sc.of_user_id = cc.of_user_id
              AND sc.fan_of_user_id = cc.fan_of_user_id
        WHERE cc.crm_id = ? AND cc.of_user_id = ? AND cc.campaign_id = ?
              {where_extra}
        ORDER BY COALESCE(sc.total_spent, 0) DESC, cc.claimed_at DESC
        LIMIT ? OFFSET ?
    ''', (crm_id, str(of_user_id), str(campaign_id), *extra_params, limit, offset))
    rows = [dict(r) for r in cur.fetchall()]
    cur.execute(f'''SELECT COUNT(*) FROM campaign_claimers_cache cc
                   WHERE cc.crm_id = ? AND cc.of_user_id = ? AND cc.campaign_id = ?
                         {where_extra}''',
                (crm_id, str(of_user_id), str(campaign_id), *extra_params))
    total = cur.fetchone()[0]
    conn.close()
    # Also compute mapped-spent (from tx_cache) for these fans so the UI can
    # show "Total vs Mapped" side-by-side.
    if rows:
        fan_ids = [r['fan_of_user_id'] for r in rows]
        mapped = _fan_mapped_spend(crm_id, of_user_id, fan_ids)
        for r in rows:
            r['mapped_spent'] = mapped.get(r['fan_of_user_id'], 0.0)
    return rows, total


def _fan_mapped_spend(crm_id, of_user_id, fan_ids):
    """Per-fan signed-sum of cached transactions in NET terms (what the creator
    actually received after OF's 20% platform fee).

    Currency basis matters here: `subscribers_cache.total_spent` comes from
    `subscribedOnData.totalSumm` which is NET (creator earnings). If we summed
    `tx.amount` (gross — what the fan paid, pre-fee), Mapped would be ~1.25×
    Total on a fully-cached fan, which looks like a bug. Summing `tx.net`
    instead keeps both columns in the same units so they converge when the
    cache is complete.

    Matches earnings_model's POSITIVE_STATUSES (done, loading) and
    NEGATIVE_STATUSES (undo) rules."""
    if not fan_ids:
        return {}
    placeholders = ','.join('?' * len(fan_ids))
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute(f'''
        SELECT fan_of_user_id, COALESCE(SUM(CASE
            WHEN status = 'undo'              THEN -COALESCE(net, 0)
            WHEN status IN ('done','loading') THEN  COALESCE(net, 0)
            ELSE 0
        END), 0) AS signed
        FROM transactions_cache
        WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id IN ({placeholders})
        GROUP BY fan_of_user_id
    ''', (crm_id, str(of_user_id), *[str(f) for f in fan_ids]))
    out = {row[0]: float(row[1] or 0.0) for row in cur.fetchall()}
    conn.close()
    return out


# Transaction statuses that count toward (or against) spend. Kept in sync with
# earnings_model.POSITIVE_STATUSES / NEGATIVE_STATUSES: a fan's spend is the
# signed sum of transaction `net` — 'done'/'loading' add, 'undo' (chargeback)
# subtracts, anything else is ignored.
_TX_POSITIVE_STATUSES = ('done', 'loading')
_TX_NEGATIVE_STATUSES = ('undo',)


def get_fan_campaign_ids(crm_id, of_user_id, fan_of_user_id):
    """Return the campaign_ids (tracking links) a fan claimed, or [] if none.
    Used to attribute a real-time WS event (new sub / tip) to a tracking link
    so the dashboard can update the right link's numbers."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT DISTINCT campaign_id FROM campaign_claimers_cache
                   WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?''',
                (crm_id, str(of_user_id), str(fan_of_user_id)))
    ids = [r['campaign_id'] for r in cur.fetchall()]
    conn.close()
    return ids


def campaigns_earnings(crm_id, of_user_id):
    """One row per campaign with aggregated claimer/earnings stats.

    Returns: list of {campaign_id, claimers_count, mapped_claimers_count,
    total_spent, total_spent_canonical, coverage_pct} sorted by total_spent desc.

    HYBRID spend model — best of both sources, per claimer:
      per_claimer_spent = MAX(canonical subscriber total_spent, signed tx sum)
      - canonical (subscribers_cache.total_spent): OF's authoritative LIFETIME
        figure, includes history older than the tx window. Refreshed every 7d.
      - tx sum (transactions_cache): signed sum of `net` (done/loading +, undo -),
        only the last ~30 days, but refreshed every ~10 min.
    MAX (not sum) because canonical already includes old transactions; summing
    would double-count the recent window. So total_spent uses canonical as the
    baseline and rises the moment fresh tx push a claimer above their last
    canonical snapshot — giving both full history AND minute-level freshness.

    coverage_pct = fraction of claimers we have ANY spend signal for (canonical
    OR tx). Climbs toward 100% via the cheap tx refresh + periodic subs walk."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    pos_ph = ','.join('?' * len(_TX_POSITIVE_STATUSES))
    neg_ph = ','.join('?' * len(_TX_NEGATIVE_STATUSES))
    # Per-claimer: attach canonical subscriber spend (sc), signed tx spend (tx),
    # AND the per-type tx breakdown (tips/messages/posts/streams/subscriptions)
    # so the campaign-level `breakdown` reconciles with `total_spent`.
    cur.execute(f'''
        SELECT cc.campaign_id,
               cc.fan_of_user_id,
               sc.total_spent AS canonical_spent,
               COALESCE(sc.spent_tips, 0)          AS canon_tips,
               COALESCE(sc.spent_messages, 0)      AS canon_messages,
               COALESCE(sc.spent_posts, 0)         AS canon_posts,
               COALESCE(sc.spent_streams, 0)       AS canon_streams,
               COALESCE(sc.spent_subscriptions, 0) AS canon_subs,
               tx.spent       AS tx_spent,
               COALESCE(tx.tips, 0)     AS tx_tips,
               COALESCE(tx.messages, 0) AS tx_messages,
               COALESCE(tx.posts, 0)    AS tx_posts,
               COALESCE(tx.streams, 0)  AS tx_streams,
               COALESCE(tx.subs, 0)     AS tx_subs
        FROM campaign_claimers_cache cc
        LEFT JOIN (
            SELECT fan_of_user_id,
                   SUM(CASE WHEN status IN ({pos_ph}) THEN COALESCE(net, 0)
                            WHEN status IN ({neg_ph}) THEN -COALESCE(net, 0)
                            ELSE 0 END) AS spent,
                   SUM(CASE WHEN tx_type = 'tip' AND status IN ({pos_ph}) THEN COALESCE(net,0) ELSE 0 END) AS tips,
                   SUM(CASE WHEN tx_type = 'message' AND status IN ({pos_ph}) THEN COALESCE(net,0) ELSE 0 END) AS messages,
                   SUM(CASE WHEN tx_type = 'post' AND status IN ({pos_ph}) THEN COALESCE(net,0) ELSE 0 END) AS posts,
                   SUM(CASE WHEN tx_type = 'stream' AND status IN ({pos_ph}) THEN COALESCE(net,0) ELSE 0 END) AS streams,
                   SUM(CASE WHEN tx_type IN ('subscription','renewal') AND status IN ({pos_ph}) THEN COALESCE(net,0) ELSE 0 END) AS subs
            FROM transactions_cache
            WHERE crm_id = ? AND of_user_id = ?
            GROUP BY fan_of_user_id
        ) tx ON tx.fan_of_user_id = cc.fan_of_user_id
        LEFT JOIN subscribers_cache sc
               ON sc.crm_id = cc.crm_id
              AND sc.of_user_id = cc.of_user_id
              AND sc.fan_of_user_id = cc.fan_of_user_id
        WHERE cc.crm_id = ? AND cc.of_user_id = ?
    ''', (*_TX_POSITIVE_STATUSES, *_TX_NEGATIVE_STATUSES,
          *_TX_POSITIVE_STATUSES, *_TX_POSITIVE_STATUSES, *_TX_POSITIVE_STATUSES,
          *_TX_POSITIVE_STATUSES, *_TX_POSITIVE_STATUSES,
          crm_id, str(of_user_id), crm_id, str(of_user_id)))

    # Fold per-claimer rows into per-campaign aggregates.
    agg = {}
    for r in cur.fetchall():
        cid = r['campaign_id']
        a = agg.setdefault(cid, {
            'claimers': 0, 'mapped': 0, 'spenders': 0, 'total': 0.0, 'canonical': 0.0,
            'tips': 0.0, 'messages': 0.0, 'posts': 0.0, 'streams': 0.0, 'subscriptions': 0.0,
        })
        a['claimers'] += 1
        canon = float(r['canonical_spent'] or 0.0)
        tx = float(r['tx_spent'] or 0.0)
        if r['canonical_spent'] is not None or r['tx_spent'] is not None:
            a['mapped'] += 1
        # Real spenders: claimers whose hybrid spend is actually > $0 (free
        # subscribers sitting in subscribers_cache with total_spent=0 do NOT
        # count — that's the number the UI should show, not `mapped`).
        if max(canon, tx) > 0:
            a['spenders'] += 1
        # Per-claimer hybrid spend: the larger of canonical lifetime vs fresh tx.
        # The breakdown contribution comes from the SAME (winning) source, so
        # sum(breakdown) == total exactly AND each dollar is attributed to its
        # real type — no fake "surplus → subscriptions" lumping.
        if tx >= canon:
            a['total'] += tx
            a['tips'] += float(r['tx_tips'] or 0.0)
            a['messages'] += float(r['tx_messages'] or 0.0)
            a['posts'] += float(r['tx_posts'] or 0.0)
            a['streams'] += float(r['tx_streams'] or 0.0)
            a['subscriptions'] += float(r['tx_subs'] or 0.0)
        else:
            a['total'] += canon
            a['tips'] += float(r['canon_tips'] or 0.0)
            a['messages'] += float(r['canon_messages'] or 0.0)
            a['posts'] += float(r['canon_posts'] or 0.0)
            a['streams'] += float(r['canon_streams'] or 0.0)
            a['subscriptions'] += float(r['canon_subs'] or 0.0)
        a['canonical'] += canon
    conn.close()

    out = []
    for cid, a in agg.items():
        n = a['claimers']
        out.append({
            'campaign_id': cid,
            'claimers_count': n,
            'mapped_claimers_count': a['mapped'],
            'spenders_count': a['spenders'],
            'total_spent': round(a['total'], 2),
            'total_spent_canonical': round(a['canonical'], 2),
            'coverage_pct': round((a['mapped'] / n * 100) if n else 0, 1),
            'breakdown': {
                'tips': round(a['tips'], 2),
                'messages': round(a['messages'], 2),
                'posts': round(a['posts'], 2),
                'streams': round(a['streams'], 2),
                'subscriptions': round(a['subscriptions'], 2),
            },
        })
    out.sort(key=lambda x: x['total_spent'], reverse=True)
    return out


def campaigns_cache_summary(crm_id, of_user_id):
    """Top-line stats for the /campaigns/refresh/status endpoint + UI header."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('''SELECT COUNT(DISTINCT campaign_id) AS campaigns,
                          COUNT(*) AS claimers,
                          MAX(synced_at) AS last_row_synced_at
                   FROM campaign_claimers_cache
                   WHERE crm_id = ? AND of_user_id = ?''',
                (crm_id, str(of_user_id)))
    row = dict(cur.fetchone() or {})
    panel = get_crm_panel(crm_id)
    account_meta = {}
    if panel:
        cur.execute('''SELECT last_campaigns_refresh_at, campaigns_refresh_failure_count,
                              last_transactions_refresh_at
                       FROM of_accounts WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (panel['id'], of_user_id))
        r = cur.fetchone()
        if r:
            account_meta = dict(r)
    conn.close()
    return {
        'campaigns': row.get('campaigns') or 0,
        'claimers':  row.get('claimers') or 0,
        'last_row_synced_at': row.get('last_row_synced_at'),
        'last_refreshed_at': account_meta.get('last_campaigns_refresh_at'),
        # Spend freshness comes from the fast tx-refresh (~10 min), which is what
        # the UI "cached … ago" badge should reflect — not the 7-day claimer walk.
        'last_spend_refreshed_at': account_meta.get('last_transactions_refresh_at'),
        'consecutive_failures': account_meta.get('campaigns_refresh_failure_count') or 0,
    }


def mark_campaigns_refresh(crm_id, of_user_id, success):
    panel = get_crm_panel(crm_id)
    if not panel:
        return False
    now = iso_utc_now()
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    if success:
        cur.execute('''UPDATE of_accounts
                       SET last_campaigns_refresh_at = ?,
                           campaigns_refresh_failure_count = 0
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (now, panel['id'], of_user_id))
    else:
        cur.execute('''UPDATE of_accounts
                       SET campaigns_refresh_failure_count =
                           COALESCE(campaigns_refresh_failure_count, 0) + 1
                       WHERE crm_panel_id = ? AND of_user_id = ?''',
                    (panel['id'], of_user_id))
    conn.commit()
    conn.close()
    return True


_TX_TYPE_TO_CATEGORY = {
    "tip": "tips",
    "tips": "tips",
    "message": "messages",
    "messages": "messages",
    "subscribe": "subscriptions",
    "subscription": "subscriptions",
    "renewal": "subscriptions",
    "post": "posts",
    "posts": "posts",
    "stream": "streams",
    "streams": "streams",
    "referral": "referrals",
}


#: tx_type values that are NOT earnings and must never enter a revenue sum.
#:
#: `payout` is money leaving the wallet (Fansly withdrawals, synthesised by
#: fansly_normalize) — it was always excluded.
#:
#: `chargeback` is the one that was silently wrong. `_classify_tx` assigns it
#: from `status == 'undo'`, i.e. a REVERSED transaction, and OF leaves the
#: original description in place ("Tip from …"), so the row still carries a
#: POSITIVE `net`. The per-account path counted those as revenue and, because
#: 'chargeback' isn't in _TX_TYPE_TO_CATEGORY, dropped them into `tips` via the
#: dict default. Across this database that is ~6.2k of phantom income sitting
#: in the wrong bucket. The row is the original relabelled rather than a
#: separate reversing entry, so excluding it is the correct treatment — not
#: subtracting it, which would double-count the reversal.
#:
#: `transfer` is Fansly money moving between the creator's own wallets (a
#: non-payout row whose destination isn't the earnings wallet — see
#: fansly_wallet.fansly_tx_type). Observed live as a $5 pair that the sum
#: was counting as $10 of income.
_NON_EARNING_TX_TYPES = ('payout', 'chargeback', 'transfer')


def panel_earnings_from_cache(crm_id, start, end, prev_start, prev_end,
                              of_user_ids=None, *, with_platform=False,
                              prev_cut=None):
    """Earnings for an ENTIRE panel in one query, from transactions_cache.

    Replaces fanning `local_earnings_from_cache` out over accounts in Python.
    The old shape cost 4 live OF calls per account, serially, per cache miss:
    at 600 accounts that is ~2400 upstream calls taking 20-25 minutes against
    a 120s cache TTL, so the summary could never converge — it just started
    over. This does the same arithmetic in SQLite, which measured 56ms across
    1M rows.

    Returns the same 5-tuple as local_earnings_from_cache
    (curr_total, prev_total, chart_by_day, by_category, tx_count) so callers
    are interchangeable. With ``with_platform=True`` a sixth element is
    appended:

        {'by_platform': {platform: {total, prev_total, prev_total_to_date,
                                    uncategorized, transactions}},
         'by_category_platform': {category: {platform: amount}},
         'prev_total_to_date': float | None}

    ``prev_cut`` (a bound inside the previous period) additionally sums
    [prev_start, prev_cut) — "the previous period up to the same elapsed
    point", so a Wednesday can be compared with last Wednesday rather than with
    all of last week.

    Bounds are half-open [start, end) in both periods, matching the per-account
    version. Category comes from `tx_type`, which `_classify_tx` already
    derived from the OF description at write time.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        if with_platform:
            return 0.0, 0.0, {}, {}, 0, {'by_platform': {}, 'by_category_platform': {},
                                         'prev_total_to_date': 0.0 if prev_cut else None}
        return 0.0, 0.0, {}, {}, 0

    # Build the tx_type -> category mapping as a CASE so the grouping happens
    # in SQLite rather than by pulling every row into Python. Unknown types
    # fall to NULL and are dropped: the old dict-default sent them to `tips`,
    # which is how chargebacks ended up there.
    case = " ".join(
        f"WHEN '{k}' THEN '{v}'" for k, v in _TX_TYPE_TO_CATEGORY.items()
    )
    # `created_at` is stored ISO-8601 with a 'T' separator, while the period
    # bounds come from _period_range as "YYYY-MM-DD HH:MM:SS" with a space.
    # Compared as text those disagree at offset 10, and since 'T' > ' ' the
    # upper bound silently drops the final day of every period. Normalise the
    # column instead of the bounds so either storage format works.
    # Qualified: of_accounts has its own created_at, so a bare name is ambiguous.
    ts = "replace(t.created_at, 'T', ' ')"
    inner_filter = ''
    if of_user_ids:
        inner_filter = f" AND t.of_user_id IN ({','.join('?' * len(of_user_ids))})"

    # INNER JOIN of_accounts, not a bare crm_id filter. Disconnecting an account
    # leaves its cached rows behind (they are kept for the retention window so a
    # reconnect restores history), so a panel-wide sum keyed only on crm_id
    # counts revenue for creators who are no longer on the panel. Observed live:
    # a single account disconnected that morning added 171.02 to "this week".
    # The join also covers the pre-tombstone orphan backlog for free.
    # The to-date slice of the previous period rides in the same scan. Without a
    # cut it degenerates to 0 and is ignored.
    cut = prev_cut or prev_start
    sql = f"""
        SELECT
            CASE WHEN {ts} >= ? AND {ts} < ? THEN 'curr'
                 WHEN {ts} >= ? AND {ts} < ? THEN 'prev'
            END                                     AS bucket,
            substr(t.created_at, 1, 10)             AS day,
            CASE LOWER(COALESCE(t.tx_type, '')) {case} END AS category,
            COALESCE(a.platform, 'onlyfans')        AS platform,
            SUM(t.net)                              AS total,
            SUM(CASE WHEN {ts} >= ? AND {ts} < ? THEN t.net ELSE 0 END) AS prev_td,
            COUNT(*)                                AS n
        FROM transactions_cache t
        JOIN of_accounts a
          ON a.of_user_id = t.of_user_id AND a.crm_panel_id = ?
        WHERE t.crm_id = ?{inner_filter}
          AND LOWER(COALESCE(t.tx_type, '')) NOT IN ({','.join('?' * len(_NON_EARNING_TX_TYPES))})
          AND t.net IS NOT NULL AND t.net != 0
        GROUP BY bucket, day, category, platform
        HAVING bucket IS NOT NULL
    """
    ordered = [start, end, prev_start, prev_end, prev_start, cut,
               panel['id'], crm_id]
    if of_user_ids:
        ordered.extend(str(u) for u in of_user_ids)
    ordered.extend(_NON_EARNING_TX_TYPES)

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql, ordered).fetchall()
    finally:
        conn.close()

    curr_total = prev_total = prev_to_date = 0.0
    chart_by_day: dict = {}
    by_category: dict = {}
    by_platform: dict = {}
    by_category_platform: dict = {}
    tx_count = 0
    for r in rows:
        amount = float(r['total'] or 0)
        plat = r['platform'] or 'onlyfans'
        pstats = by_platform.setdefault(plat, {
            'total': 0.0, 'prev_total': 0.0, 'prev_total_to_date': 0.0,
            'uncategorized': 0.0, 'transactions': 0})
        if r['bucket'] == 'curr':
            curr_total += amount
            pstats['total'] += amount
            pstats['transactions'] += int(r['n'] or 0)
            if r['day']:
                chart_by_day[r['day']] = chart_by_day.get(r['day'], 0.0) + amount
            if r['category']:
                by_category[r['category']] = by_category.get(r['category'], 0.0) + amount
                cat_split = by_category_platform.setdefault(r['category'], {})
                cat_split[plat] = cat_split.get(plat, 0.0) + amount
            else:
                pstats['uncategorized'] += amount
            tx_count += int(r['n'] or 0)
        elif r['bucket'] == 'prev':
            prev_total += amount
            pstats['prev_total'] += amount
            td = float(r['prev_td'] or 0)
            prev_to_date += td
            pstats['prev_total_to_date'] += td
    if not with_platform:
        return curr_total, prev_total, chart_by_day, by_category, tx_count
    if not prev_cut:
        for pstats in by_platform.values():
            pstats['prev_total_to_date'] = None
    extras = {
        'by_platform': by_platform,
        'by_category_platform': by_category_platform,
        'prev_total_to_date': prev_to_date if prev_cut else None,
    }
    return curr_total, prev_total, chart_by_day, by_category, tx_count, extras


# What the event at subscribers_cache.subscribed_at was ('subscribe' |
# 'renewal' | 'return' | NULL). Prefers the stored column; rows written before
# it existed fall back to the last entry of the OF payload's subscribes[]
# history — subscribedOnData first, then subscribedByData, the same order as
# _latest_subscribe_action. Nested CASEs (SQLite evaluates CASE lazily) keep
# json_extract away from malformed JSON and from a '[-1]' path on an empty
# array, and avoid the '[#-1]' path syntax that older SQLite builds reject.
def _last_action_sql(obj):
    path = f"'$.{obj}.subscribes'"
    return (f"CASE WHEN COALESCE(json_array_length(s.raw_json, {path}), 0) > 0 "
            f"THEN json_extract(s.raw_json, '$.{obj}.subscribes[' "
            f"|| (json_array_length(s.raw_json, {path}) - 1) || '].action') END")


_SUB_ACTION_SQL = f"""COALESCE(s.subscribe_action,
    CASE WHEN s.raw_json IS NOT NULL AND json_valid(s.raw_json) THEN
        COALESCE({_last_action_sql('subscribedOnData')},
                 {_last_action_sql('subscribedByData')})
    END)"""


def panel_new_subscribers(crm_id, start, end, prev_start, prev_end):
    """Panel-wide NEW subscriber counts for [start, end) and [prev_start,
    prev_end), split by platform, from the local caches (zero upstream calls).

    New vs renewal:
      * OnlyFans moves `subscribed_at` forward on every renewal, so a row whose
        subscribed_at falls in the window is new UNLESS the event at that
        timestamp was a renewal (`_SUB_ACTION_SQL`).
      * Fansly's `subscribed_at` is the subscription's createdAt and does not
        move on renewal (confirmed against the live ledger), so a row in the
        window is always a new subscription (a lapsed fan re-subscribing gets a
        new createdAt, which is correct). Fansly renewals are counted from the
        wallet ledger instead: subscription payments in the window for fans
        whose current subscription started more than an hour before the
        payment (the first payment lands ~1s after createdAt).

    Timestamps are normalised with datetime(), which handles the "+00:00",
    "+02:00" and "Z" shapes the cache holds; the raw `subscribed_at >= ?`
    lower bound (a day of slack, every stored shape starts YYYY-MM-DD) is only
    there so idx_subs_cache_account can range-seek.

    Coverage is reported because the count is only as complete as the roster
    syncs behind it: an account whose subscribers were never synced
    contributes nothing.

    Returns {count, renewals, prev_count, prev_renewals, by_platform,
             accounts, accounts_tracked, accounts_never_synced, oldest_sync_at}.
    """
    result = {
        'count': 0, 'renewals': 0, 'prev_count': 0, 'prev_renewals': 0,
        'by_platform': {}, 'accounts': 0, 'accounts_tracked': 0,
        'accounts_never_synced': 0, 'oldest_sync_at': None,
    }
    panel = get_crm_panel(crm_id)
    if not panel:
        return result
    try:
        lo = (datetime.strptime(str(prev_start)[:10], '%Y-%m-%d')
              - timedelta(days=1)).strftime('%Y-%m-%d')
    except ValueError:
        lo = '0000-00-00'

    def _plat(p):
        return result['by_platform'].setdefault(p or 'onlyfans', {
            'count': 0, 'renewals': 0, 'prev_count': 0, 'prev_renewals': 0,
            'accounts': 0, 'accounts_tracked': 0, 'oldest_sync_at': None})

    ts = "datetime(s.subscribed_at)"
    subs_sql = f"""
        SELECT COALESCE(a.platform, 'onlyfans') AS platform,
               CASE WHEN {ts} >= datetime(?) AND {ts} < datetime(?) THEN 'curr'
                    WHEN {ts} >= datetime(?) AND {ts} < datetime(?) THEN 'prev'
               END AS bucket,
               CASE WHEN COALESCE(a.platform, 'onlyfans') != 'fansly'
                     AND LOWER(COALESCE({_SUB_ACTION_SQL}, '')) = 'renewal'
                    THEN 1 ELSE 0 END AS renewal,
               COUNT(*) AS n
        -- CROSS JOIN pins the loop order (SQLite never reorders it): walk the
        -- panel's accounts, then seek each one's subscribed_at range. Left to
        -- the planner, it scanned every subscriber row of the panel.
        FROM of_accounts a
        CROSS JOIN subscribers_cache s
          ON s.crm_id = ? AND s.of_user_id = a.of_user_id
         -- is_active is always 0/1 (upsert derives it in-statement); the IN
         -- lets idx_subs_cache_account seek past it to the subscribed_at range.
         AND s.is_active IN (0, 1)
         AND s.subscribed_at >= ?
        WHERE a.crm_panel_id = ?
        GROUP BY platform, bucket, renewal
        HAVING bucket IS NOT NULL
    """
    fansly_renewal_sql = """
        SELECT CASE WHEN datetime(t.created_at) >= datetime(?) AND datetime(t.created_at) < datetime(?) THEN 'curr'
                    WHEN datetime(t.created_at) >= datetime(?) AND datetime(t.created_at) < datetime(?) THEN 'prev'
               END AS bucket,
               COUNT(*) AS n
        FROM of_accounts a
        CROSS JOIN transactions_cache t
          ON t.crm_id = ? AND t.of_user_id = a.of_user_id
         AND t.created_at >= ?          -- raw bound → idx_tx_cache_account_time range
        CROSS JOIN subscribers_cache s
          ON s.crm_id = t.crm_id AND s.of_user_id = t.of_user_id
         AND s.fan_of_user_id = t.fan_of_user_id
        WHERE a.crm_panel_id = ?
          AND COALESCE(a.platform, 'onlyfans') = 'fansly'
          AND t.tx_type IN ('subscription', 'renewal')
          AND datetime(s.subscribed_at) < datetime(t.created_at, '-1 hour')
        GROUP BY bucket
        HAVING bucket IS NOT NULL
    """
    coverage_sql = """
        SELECT COALESCE(platform, 'onlyfans') AS platform,
               COUNT(*) AS accounts,
               SUM(CASE WHEN last_subscribers_refresh_at IS NOT NULL THEN 1 ELSE 0 END) AS tracked,
               MIN(last_subscribers_refresh_at) AS oldest
        FROM of_accounts WHERE crm_panel_id = ?
        GROUP BY 1
    """
    bounds = [start, end, prev_start, prev_end]
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        sub_rows = conn.execute(subs_sql, bounds + [crm_id, lo, panel['id']]).fetchall()
        ren_rows = conn.execute(fansly_renewal_sql,
                                bounds + [crm_id, lo, panel['id']]).fetchall()
        cov_rows = conn.execute(coverage_sql, (panel['id'],)).fetchall()
    finally:
        conn.close()

    for r in cov_rows:
        p = _plat(r['platform'])
        p['accounts'] = int(r['accounts'] or 0)
        p['accounts_tracked'] = int(r['tracked'] or 0)
        p['oldest_sync_at'] = r['oldest']
        result['accounts'] += p['accounts']
        result['accounts_tracked'] += p['accounts_tracked']
        if r['oldest'] and (result['oldest_sync_at'] is None
                            or str(r['oldest']) < str(result['oldest_sync_at'])):
            result['oldest_sync_at'] = r['oldest']
    result['accounts_never_synced'] = result['accounts'] - result['accounts_tracked']

    for r in sub_rows:
        p = _plat(r['platform'])
        n = int(r['n'] or 0)
        key = ('' if r['bucket'] == 'curr' else 'prev_') + \
              ('renewals' if r['renewal'] else 'count')
        p[key] += n
        result[key] += n
    for r in ren_rows:
        p = _plat('fansly')
        key = 'renewals' if r['bucket'] == 'curr' else 'prev_renewals'
        n = int(r['n'] or 0)
        p[key] += n
        result[key] += n
    return result


def panel_tx_freshness(crm_id):
    """Per-account transaction-cache staleness for a panel.

    The summary is only as current as the cache behind it, so the caller has
    to be able to say so rather than presenting a stale sum as live. Returns
    {of_user_id: last_transactions_refresh_at | None}; None means the account
    has never had a transactions sync at all.
    """
    panel = get_crm_panel(crm_id)
    if not panel:
        return {}
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            'SELECT of_user_id, last_transactions_refresh_at FROM of_accounts '
            'WHERE crm_panel_id = ?', (panel['id'],)
        ).fetchall()
    finally:
        conn.close()
    return {str(r['of_user_id']): r['last_transactions_refresh_at'] for r in rows}


def local_earnings_from_cache(crm_id, of_user_id, start, end, prev_start, prev_end):
    """Sum earnings from transactions_cache as a fallback when OF is
    unreachable. Returns (current_total_net, prev_total_net, chart_by_day,
    by_category, tx_count) — same shape as the OF-driven path.
    """
    def _parse(ts):
        """Best-effort ISO/space-separated → datetime."""
        if not ts:
            return None
        s = str(ts).replace("T", " ").replace("Z", "")
        # Drop sub-seconds and timezone offset for naive comparison.
        if "+" in s:
            s = s.split("+", 1)[0]
        if "-" in s[10:]:  # avoid the date dashes
            s = s[:10] + s[10:].split("-", 1)[0]
        s = s.strip()
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        return None

    start_dt = _parse(start)
    end_dt = _parse(end)
    prev_start_dt = _parse(prev_start)
    prev_end_dt = _parse(prev_end)
    if not (start_dt and end_dt and prev_start_dt and prev_end_dt):
        return 0.0, 0.0, {}, {}, 0

    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    try:
        cur.execute(
            """SELECT created_at, net, amount, tx_type, description
               FROM transactions_cache
               WHERE crm_id = ? AND of_user_id = ?""",
            (crm_id, of_user_id),
        )
        rows = cur.fetchall()
    finally:
        conn.close()

    curr_total = 0.0
    prev_total = 0.0
    chart_by_day = {}
    by_category = {}
    tx_count = 0
    for r in rows:
        # Payouts (Fansly wallet withdrawals) are money LEAVING the wallet —
        # never period earnings, and they have no category bucket. Same for
        # wallet-to-wallet transfers.
        if (r["tx_type"] or "") in ("payout", "transfer"):
            continue
        net = r["net"] if r["net"] is not None else r["amount"]
        try:
            net = float(net or 0)
        except (TypeError, ValueError):
            continue
        if net == 0:
            continue
        created_dt = _parse(r["created_at"])
        if not created_dt:
            continue
        if start_dt <= created_dt < end_dt:
            curr_total += net
            day = str(r["created_at"])[:10]
            chart_by_day[day] = chart_by_day.get(day, 0.0) + net
            cat = _TX_TYPE_TO_CATEGORY.get((r["tx_type"] or "").lower(), "tips")
            by_category[cat] = by_category.get(cat, 0.0) + net
            tx_count += 1
        elif prev_start_dt <= created_dt < prev_end_dt:
            prev_total += net
    return curr_total, prev_total, chart_by_day, by_category, tx_count


# ---------------------------------------------------------------------------
# Admin panel helpers
# ---------------------------------------------------------------------------
# All of the below are intended to be called only from /api/admin/* routes
# (i.e. behind _require_admin). They make cross-panel reads cheap and
# centralise the "give me an overview of the whole platform" queries so the
# admin UI doesn't need raw SQL knowledge.

def log_admin_audit(admin_email, action, target_kind=None, target_id=None,
                    payload=None, ip=None, user_agent=None):
    """Append an admin action to the audit log. Never raises — admin actions
    must succeed even if audit logging hits a transient SQLite error; the
    cost of a missing audit row is lower than blocking a valid admin op."""
    try:
        import json as _json
        conn = sqlite3.connect(DB_FILE)
        cur = conn.cursor()
        cur.execute(
            '''INSERT INTO admin_audit
               (ts, admin_email, action, target_kind, target_id, payload, ip, user_agent)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                iso_utc_now(),
                (admin_email or '').lower(),
                action,
                target_kind,
                str(target_id) if target_id is not None else None,
                _json.dumps(payload) if payload is not None else None,
                ip,
                (user_agent or '')[:500],  # cap so a hostile UA can't bloat the row
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f'[admin_audit] log failed: {e}')


def list_admin_audit(limit=100, offset=0, admin_email=None, action=None):
    """Newest-first audit log page. Filters are AND'd."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    where = []
    params = []
    if admin_email:
        where.append('admin_email = ?')
        params.append(admin_email.lower())
    if action:
        where.append('action = ?')
        params.append(action)
    where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''
    # Bound limit/offset to defeat absurd values from a hostile caller.
    limit = max(1, min(int(limit or 100), 500))
    offset = max(0, int(offset or 0))
    params.extend([limit, offset])
    cur.execute(
        f'SELECT id, ts, admin_email, action, target_kind, target_id, payload, ip, user_agent '
        f'FROM admin_audit {where_sql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?',
        params,
    )
    rows = [dict(r) for r in cur.fetchall()]
    cur.execute(f'SELECT COUNT(*) AS c FROM admin_audit {where_sql}',
                params[:-2] if where else [])
    total = cur.fetchone()['c']
    conn.close()
    return {'rows': rows, 'total': total, 'limit': limit, 'offset': offset}


def polling_inert_platforms():
    """Platforms whose accounts are never actually polled in this deployment.

    `of_accounts.polling_enabled` is a stored user setting; whether the poller
    acts on it is decided at runtime by config (poller.py skips Fansly outright
    unless FANSLY_POLLING_ENABLED). We keep the stored flag as-is — see
    update_account_polling() — so every reader that reports "polling accounts"
    must apply this gate, or it counts accounts the poller will never touch.

    Returns a list of platform names, usually empty.
    """
    try:
        import platform_features as pf
        return [p for p in pf.PLATFORM_FEATURES
                if not pf.capabilities(p).get('polling')]
    except Exception:
        # Never let a capability lookup break an admin metric.
        return []


def _pollable_platform_sql(alias=''):
    """(sql_fragment, params) restricting to accounts this deployment can poll.

    Returns ('', []) when nothing is gated, so the common case adds no SQL.
    NULL platform predates the column and means OnlyFans.
    """
    inert = polling_inert_platforms()
    if not inert:
        return '', []
    col = f"{alias}." if alias else ''
    placeholders = ','.join('?' for _ in inert)
    return (f" AND COALESCE({col}platform, 'onlyfans') NOT IN ({placeholders})",
            list(inert))


def admin_overview_stats():
    """Single round-trip of high-level KPIs for the admin overview dashboard."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    out = {}
    cur.execute('SELECT COUNT(*) AS c FROM crm_panels')
    out['panels'] = cur.fetchone()['c']
    cur.execute('SELECT COUNT(*) AS c FROM crm_users')
    out['users'] = cur.fetchone()['c']
    cur.execute('SELECT COUNT(*) AS c FROM crm_users WHERE is_admin = 1')
    out['admins'] = cur.fetchone()['c']
    cur.execute('SELECT COUNT(*) AS c FROM crm_users WHERE is_suspended = 1')
    out['suspended_users'] = cur.fetchone()['c']
    cur.execute('SELECT COUNT(*) AS c FROM of_accounts')
    out['of_accounts'] = cur.fetchone()['c']
    # "Polling accounts" must mean accounts that are actually polled. A Fansly
    # row can carry polling_enabled = 1 while this deployment's Fansly poller is
    # off, in which case counting it overstates what the system is doing.
    _gate, _gp = _pollable_platform_sql()
    cur.execute(
        'SELECT COUNT(*) AS c FROM of_accounts WHERE polling_enabled = 1' + _gate,
        _gp)
    out['polling_accounts'] = cur.fetchone()['c']
    # …and report the difference rather than dropping it silently, so nobody
    # reads the gated number as "their settings were lost".
    if _gate:
        cur.execute('SELECT COUNT(*) AS c FROM of_accounts WHERE polling_enabled = 1')
        out['polling_accounts_inert'] = cur.fetchone()['c'] - out['polling_accounts']
    else:
        out['polling_accounts_inert'] = 0
    cur.execute('SELECT COUNT(*) AS c FROM webhooks')
    out['webhooks_total'] = cur.fetchone()['c']
    cur.execute("SELECT COUNT(*) AS c FROM webhooks WHERE status = 'pending'")
    out['webhooks_pending'] = cur.fetchone()['c']
    cur.execute('SELECT COUNT(*) AS c FROM oauth_clients')
    out['oauth_clients'] = cur.fetchone()['c']
    # Active panels = panels with any event in the last 24h.
    cur.execute(
        "SELECT COUNT(DISTINCT crm_id) AS c FROM account_events "
        "WHERE created_at >= datetime('now', '-1 day')"
    )
    out['active_panels_24h'] = cur.fetchone()['c']
    # Webhook delivery health, last 24h.
    cur.execute(
        "SELECT "
        "SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok, "
        "SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed, "
        "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending "
        "FROM webhook_deliveries WHERE created_at >= datetime('now', '-1 day')"
    )
    row = cur.fetchone()
    out['webhook_deliveries_24h'] = {
        'success': row['ok'] or 0,
        'failed': row['failed'] or 0,
        'pending': row['pending'] or 0,
    }
    conn.close()
    return out


def list_panels_admin(search=None, limit=50, offset=0):
    """Paginated panels list with computed columns the admin UI needs.
    `search` filters by panel name OR owner email (case-insensitive substring)."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    where = ''
    params = []
    if search:
        where = (
            'WHERE LOWER(p.name) LIKE ? OR '
            '      p.crm_id IN (SELECT cp2.crm_id FROM crm_panels cp2 '
            '                   JOIN crm_users u2 ON u2.crm_panel_id = cp2.id '
            '                   WHERE LOWER(u2.email) LIKE ?)'
        )
        like = f'%{search.lower()}%'
        params.extend([like, like])
    # polling_count only counts accounts this deployment actually polls — a
    # Fansly row with the flag set while the Fansly poller is off is not a
    # polling account, whatever the column says.
    poll_gate, poll_params = _pollable_platform_sql('oa')
    # Placeholders bind positionally: the gate sits in the SELECT list, ahead
    # of {where}, so its params must lead.
    cur.execute(
        f'''SELECT p.crm_id, p.name, p.created_at,
                   (SELECT COUNT(*) FROM crm_users u WHERE u.crm_panel_id = p.id) AS user_count,
                   (SELECT COUNT(*) FROM of_accounts oa WHERE oa.crm_panel_id = p.id) AS of_account_count,
                   (SELECT COUNT(*) FROM of_accounts oa WHERE oa.crm_panel_id = p.id AND oa.polling_enabled = 1{poll_gate}) AS polling_count,
                   (SELECT email FROM crm_users u WHERE u.crm_panel_id = p.id ORDER BY id ASC LIMIT 1) AS owner_email,
                   (SELECT call_count FROM api_usage au WHERE au.crm_id = p.crm_id AND au.month = strftime('%Y-%m', 'now')) AS api_usage_month,
                   (SELECT MAX(created_at) FROM account_events ae WHERE ae.crm_id = p.crm_id) AS last_event_at
            FROM crm_panels p {where}
            ORDER BY p.created_at DESC
            LIMIT ? OFFSET ?''',
        poll_params + params + [limit, offset],
    )
    rows = [dict(r) for r in cur.fetchall()]
    cur.execute(f'SELECT COUNT(*) AS c FROM crm_panels p {where}',
                params if params else [])
    total = cur.fetchone()['c']
    conn.close()
    return {'rows': rows, 'total': total, 'limit': limit, 'offset': offset}


def panel_detail_admin(crm_id):
    """Single-panel drill-down: users + OF accounts + recent events + usage."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT id, crm_id, name, created_at FROM crm_panels WHERE crm_id = ?', (crm_id,))
    panel = cur.fetchone()
    if not panel:
        conn.close()
        return None
    panel_id = panel['id']
    cur.execute(
        'SELECT id, email, name, is_admin, is_suspended, created_at '
        'FROM crm_users WHERE crm_panel_id = ? ORDER BY id ASC',
        (panel_id,),
    )
    users = [dict(r) for r in cur.fetchall()]
    cur.execute(
        'SELECT of_user_id, email, username, polling_enabled, last_login, '
        'last_polled_at, polling_failure_count, avatar '
        'FROM of_accounts WHERE crm_panel_id = ? ORDER BY id ASC',
        (panel_id,),
    )
    of_accounts = [dict(r) for r in cur.fetchall()]
    cur.execute(
        'SELECT id, of_user_id, event_type, occurred_at, created_at '
        'FROM account_events WHERE crm_id = ? ORDER BY id DESC LIMIT 20',
        (crm_id,),
    )
    events = [dict(r) for r in cur.fetchall()]
    cur.execute(
        "SELECT month, call_count FROM api_usage WHERE crm_id = ? "
        "ORDER BY month DESC LIMIT 6",
        (crm_id,),
    )
    usage = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {
        'panel': dict(panel),
        'users': users,
        'of_accounts': of_accounts,
        'recent_events': events,
        'usage': usage,
    }


def list_all_users_admin(search=None, limit=50, offset=0):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    where = ''
    params = []
    if search:
        where = 'WHERE LOWER(u.email) LIKE ? OR LOWER(COALESCE(u.name, \'\')) LIKE ?'
        like = f'%{search.lower()}%'
        params.extend([like, like])
    cur.execute(
        f'''SELECT u.id, u.email, u.name, u.is_admin, u.is_suspended, u.created_at,
                   p.crm_id, p.name AS panel_name
            FROM crm_users u
            LEFT JOIN crm_panels p ON p.id = u.crm_panel_id
            {where}
            ORDER BY u.id DESC
            LIMIT ? OFFSET ?''',
        params + [limit, offset],
    )
    rows = [dict(r) for r in cur.fetchall()]
    cur.execute(f'SELECT COUNT(*) AS c FROM crm_users u {where}',
                params if params else [])
    total = cur.fetchone()['c']
    conn.close()
    return {'rows': rows, 'total': total, 'limit': limit, 'offset': offset}


def set_user_suspended(email, suspended=True):
    """Toggle is_suspended on a user. Returns True if a row was updated."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('UPDATE crm_users SET is_suspended = ? WHERE LOWER(email) = LOWER(?)',
                (1 if suspended else 0, email))
    changed = cur.rowcount
    conn.commit()
    conn.close()
    return changed > 0


def is_user_suspended(email):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute('SELECT is_suspended FROM crm_users WHERE LOWER(email) = LOWER(?)', (email,))
    row = cur.fetchone()
    conn.close()
    return bool(row and row['is_suspended'])


def list_oauth_clients_admin():
    """All DCR/admin/cimd OAuth clients with consent counts."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        '''SELECT c.client_id, c.client_name, c.client_uri, c.redirect_uris,
                  c.token_endpoint_auth_method, c.scope, c.created_at, c.created_via,
                  (SELECT COUNT(*) FROM oauth_consents oc WHERE oc.client_id = c.client_id) AS consent_count
           FROM oauth_clients c
           ORDER BY c.created_at DESC'''
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def revoke_oauth_client(client_id):
    """Hard-delete a client + its consents + its outstanding codes. Returns True if found."""
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute('DELETE FROM oauth_consents WHERE client_id = ?', (client_id,))
    cur.execute('DELETE FROM oauth_codes WHERE client_id = ?', (client_id,))
    cur.execute('DELETE FROM oauth_clients WHERE client_id = ?', (client_id,))
    changed = cur.rowcount
    conn.commit()
    conn.close()
    return changed > 0


def system_health_admin():
    """Snapshot of background-engine health."""
    import os as _os
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    out = {}
    # The APScheduler jobstore lives in its own SQLite file (see
    # scheduler.JOBSTORE_PATH), so this cannot read the local `apscheduler_jobs`
    # table — after the split that table is an abandoned snapshot and reporting
    # from it would show a frozen job count that looks plausible and is wrong.
    # Import lazily: crm_database must not depend on scheduler at module scope
    # (scheduler imports crm_database).
    try:
        import scheduler as _sched
        _jobs = (_sched.get_scheduler() or None)
        if _jobs is not None:
            _all = _jobs.get_jobs()
            out['scheduler_jobs'] = len(_all)
            out['scheduler_next'] = [
                {'id': j.id,
                 'next_run_time': j.next_run_time.isoformat() if j.next_run_time else None}
                for j in sorted(
                    _all,
                    key=lambda j: (j.next_run_time is None, j.next_run_time))[:10]
            ]
        else:
            out['scheduler_jobs'] = 0
            out['scheduler_next'] = []
    except Exception as _e:
        out['scheduler_jobs'] = -1
        out['scheduler_next'] = []
        out['scheduler_error'] = str(_e)
    # AUTO-PAUSED = the poller gave up on it, which means polling_enabled is 0.
    # This used to read `polling_enabled = 1 AND polling_failure_count >= 5`,
    # which is unsatisfiable in practice: poller.py:336-337 flips
    # polling_enabled to 0 in the same breath as the count reaching 5, so no
    # reader in another process ever observes both at once. The metric that
    # exists to say "accounts have died" reported 0 no matter how many had.
    #
    # `polling_failure_count >= 5` is what separates auto-paused from an
    # operator simply switching polling off.
    cur.execute(
        "SELECT COUNT(*) AS c FROM of_accounts "
        "WHERE COALESCE(polling_enabled, 0) = 0 AND polling_failure_count >= 5"
    )
    out['poller_paused_accounts'] = cur.fetchone()['c']
    # LAGGING = polling is on and the poller has fallen behind. Accounts on a
    # platform this deployment does not poll can never advance last_polled_at,
    # so without this gate every such row is permanently "lagging" — an alarm
    # the operator has no way to clear, drowning the real ones.
    _gate, _gp = _pollable_platform_sql()
    cur.execute(
        "SELECT COUNT(*) AS c FROM of_accounts "
        "WHERE polling_enabled = 1 AND (last_polled_at IS NULL OR last_polled_at < datetime('now', '-10 minutes'))"
        + _gate,
        _gp
    )
    out['poller_lagging_accounts'] = cur.fetchone()['c']
    cur.execute(
        "SELECT COUNT(*) AS c FROM webhook_deliveries "
        "WHERE status = 'pending' AND next_retry_at <= datetime('now')"
    )
    out['webhook_retries_due'] = cur.fetchone()['c']
    cur.execute(
        "SELECT id, webhook_id, status, response_code, created_at "
        "FROM webhook_deliveries ORDER BY id DESC LIMIT 20"
    )
    out['recent_deliveries'] = [dict(r) for r in cur.fetchall()]
    try:
        out['db_size_bytes'] = _os.path.getsize(DB_FILE)
    except OSError:
        out['db_size_bytes'] = None
    conn.close()
    return out


# ============================================================================
# Data-export jobs ("Download your data")
# ============================================================================

# Columns the caller is allowed to merge-update via update_export_job. Guards
# against accidental/injected column names since we interpolate into SQL.
_EXPORT_UPDATABLE = {
    'status', 'phase', 'counts', 'warnings', 'file_path', 'file_name',
    'file_size', 'error', 'started_at', 'completed_at', 'expires_at',
}


def create_export_job(crm_id, of_user_id, job_id, *, platform=None,
                      data_types=None, since=None, until=None,
                      include_media=False, requested_by=None):
    """Insert a queued export job. `data_types` is a list -> stored as JSON.
    Returns the job_id."""
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            '''INSERT INTO export_jobs
               (job_id, crm_id, of_user_id, platform, status, data_types,
                since, until, include_media, created_at)
               VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)''',
            (job_id, crm_id, str(of_user_id), platform,
             json.dumps(data_types or []), since, until,
             1 if include_media else 0, iso_utc_now()),
        )
        conn.commit()
        return job_id
    finally:
        conn.close()


def _export_row_to_dict(row):
    """Hydrate a sqlite Row into a friendly dict (JSON fields decoded)."""
    if row is None:
        return None
    d = dict(row)
    for k in ('data_types', 'counts', 'warnings'):
        if d.get(k):
            try:
                d[k] = json.loads(d[k])
            except (ValueError, TypeError):
                pass
    d['include_media'] = bool(d.get('include_media'))
    return d


def get_export_job(crm_id, job_id):
    """Fetch one export job scoped to its CRM. The `crm_id` filter IS the
    access-control boundary — a job_id alone never crosses tenants."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            'SELECT * FROM export_jobs WHERE crm_id = ? AND job_id = ?',
            (crm_id, job_id),
        ).fetchone()
        return _export_row_to_dict(row)
    finally:
        conn.close()


def get_export_job_unscoped(job_id):
    """Fetch a job by id without a CRM filter. ONLY for the background worker,
    which is trusted and addresses jobs by their server-generated id."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            'SELECT * FROM export_jobs WHERE job_id = ?', (job_id,)
        ).fetchone()
        return _export_row_to_dict(row)
    finally:
        conn.close()


def update_export_job(job_id, **fields):
    """Merge-update an export job. dict/list values for counts/warnings are
    JSON-encoded automatically. Unknown columns are ignored."""
    sets, params = [], []
    for k, v in fields.items():
        if k not in _EXPORT_UPDATABLE:
            continue
        if k in ('counts', 'warnings') and not isinstance(v, (str, type(None))):
            v = json.dumps(v)
        sets.append(f'{k} = ?')
        params.append(v)
    if not sets:
        return
    params.append(job_id)
    conn = sqlite3.connect(DB_FILE)
    try:
        conn.execute(
            f'UPDATE export_jobs SET {", ".join(sets)} WHERE job_id = ?', params
        )
        conn.commit()
    finally:
        conn.close()


def list_export_jobs(crm_id, of_user_id=None, limit=50, offset=0):
    """Return (rows, total) of export jobs for a CRM, newest first.
    Optionally scoped to one account."""
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    where = 'crm_id = ?'
    params = [crm_id]
    if of_user_id:
        where += ' AND of_user_id = ?'
        params.append(str(of_user_id))
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = [
            _export_row_to_dict(r)
            for r in conn.execute(
                f'''SELECT * FROM export_jobs WHERE {where}
                    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?''',
                (*params, limit, offset),
            ).fetchall()
        ]
        total = conn.execute(
            f'SELECT COUNT(*) FROM export_jobs WHERE {where}', params
        ).fetchone()[0]
        return rows, total
    finally:
        conn.close()


def count_active_exports(crm_id, of_user_id):
    """How many exports for this account are queued or running. Used to refuse
    a duplicate concurrent export."""
    conn = sqlite3.connect(DB_FILE)
    try:
        return conn.execute(
            '''SELECT COUNT(*) FROM export_jobs
               WHERE crm_id = ? AND of_user_id = ?
                 AND status IN ('queued', 'running')''',
            (crm_id, str(of_user_id)),
        ).fetchone()[0]
    finally:
        conn.close()


def get_active_export(crm_id, of_user_id):
    """Return the most recent queued/running export for an account, or None."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            '''SELECT * FROM export_jobs
               WHERE crm_id = ? AND of_user_id = ?
                 AND status IN ('queued', 'running')
               ORDER BY created_at DESC LIMIT 1''',
            (crm_id, str(of_user_id)),
        ).fetchone()
        return _export_row_to_dict(row)
    finally:
        conn.close()


def list_expired_exports(now_iso):
    """Completed exports whose retention window has passed (file still on disk).
    Used by the cleanup cron."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            '''SELECT * FROM export_jobs
               WHERE status = 'complete' AND expires_at IS NOT NULL
                 AND expires_at <= ? AND file_path IS NOT NULL''',
            (now_iso,),
        ).fetchall()
        return [_export_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def list_stale_running_exports(boot_iso):
    """Jobs left 'queued'/'running' before the given cutoff — orphaned by a
    process restart (their APScheduler date-job is gone). Used at startup to
    fail them instead of leaving zombie rows."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            '''SELECT * FROM export_jobs
               WHERE status IN ('queued', 'running')
                 AND created_at <= ?''',
            (boot_iso,),
        ).fetchall()
        return [_export_row_to_dict(r) for r in rows]
    finally:
        conn.close()


def delete_export_job(crm_id, job_id):
    """Remove an export job row (CRM-scoped). Returns True if a row was deleted.
    Caller is responsible for deleting the ZIP file first."""
    conn = sqlite3.connect(DB_FILE)
    try:
        cur = conn.execute(
            'DELETE FROM export_jobs WHERE crm_id = ? AND job_id = ?',
            (crm_id, job_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ============================================================================
# Bulk account import
# ============================================================================

# Row states. `pending` is the queue; `running` is claimed-and-in-flight;
# everything in TERMINAL_ROW_STATES is done and has had its secrets destroyed.
#
# The two `needs_2fa*` states are deliberately OUTSIDE that set. They are
# "waiting on a human", not "finished": the row still holds the credential
# because the operator is expected to come back — possibly after closing the
# importer entirely, which is why GET /import/pending-2fa exists. The hard
# ceiling on that is config.IMPORT_CREDENTIAL_TTL_HOURS, enforced by
# import_runner.sweep_pending_2fa().
ROW_STATES = (
    'pending', 'running', 'success', 'needs_2fa', 'needs_2fa_expired',
    'failed', 'canceled', 'invalid', 'skipped', 'slot_exhausted',
)
TERMINAL_ROW_STATES = (
    'success', 'failed', 'canceled', 'invalid', 'skipped', 'slot_exhausted',
)
ACTIVE_ROW_STATES = ('pending', 'running')

_IMPORT_JOB_UPDATABLE = {
    'status', 'counts', 'error', 'started_at', 'completed_at', 'heartbeat_at',
    'total_rows',
}

# Columns update_import_row may write. Interpolated into SQL, so it is an
# allowlist, not a filter.
_IMPORT_ROW_UPDATABLE = {
    'status', 'lane', 'platform', 'email', 'label', 'proxy',
    'encrypted_password', 'encrypted_totp_secret', 'encrypted_cookies',
    'otp_state', 'x_bc', 'x_hash', 'encrypted_2fa_cookies', 'two_fa_expires_at',
    'of_user_id', 'username', 'error', 'error_reason', 'permanent', 'attempts',
    'claim_token', 'claimed_at', 'started_at', 'finished_at',
}

# Everything a terminal row must forget. Kept as one list so "what counts as a
# secret" has exactly one definition; tests assert against this same tuple.
_IMPORT_ROW_SECRET_COLUMNS = (
    'encrypted_password', 'encrypted_totp_secret', 'encrypted_cookies',
    'encrypted_2fa_cookies', 'otp_state', 'x_bc', 'x_hash',
)


# Every other helper in this file opens `sqlite3.connect(DB_FILE)` bare, which
# takes Python's 5-second default busy timeout. That has always been fine
# because the writers were Flask request handlers and a handful of scheduler
# jobs — effectively serial.
#
# The importer is the first thing in the system to write from 16 threads at
# once, and under that load 5 seconds is reachable: a claim's BEGIN IMMEDIATE
# can sit behind a queue of row updates, session writes and usage-meter bumps.
# When it expires the row does not slow down, it FAILS — a perfectly good
# account marked failed because SQLite was busy. Hence a dedicated connector
# with a 30s timeout, matching the busy_timeout init_database() sets (which is
# per-connection, so it never reached these helpers).
_IMPORT_DB_TIMEOUT = 30.0


def _import_conn(row_factory=False):
    conn = sqlite3.connect(DB_FILE, timeout=_IMPORT_DB_TIMEOUT)
    if row_factory:
        conn.row_factory = sqlite3.Row
    return conn


def _import_job_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    if d.get('counts'):
        try:
            d['counts'] = json.loads(d['counts'])
        except (ValueError, TypeError):
            pass
    d['has_header'] = bool(d.get('has_header'))
    return d


def create_import_job(crm_id, job_id, *, source=None, default_platform='onlyfans',
                      fmt=None, delimiter=None, has_header=False,
                      total_rows=0, requested_by=None):
    """Insert a queued import job. Rows are added separately by add_import_rows
    so the job + its rows land in one transaction from the caller's side."""
    conn = _import_conn()
    try:
        conn.execute(
            '''INSERT INTO import_jobs
               (job_id, crm_id, status, source, default_platform, format,
                delimiter, has_header, total_rows, created_at)
               VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)''',
            (job_id, crm_id, source, default_platform, fmt, delimiter,
             1 if has_header else 0, int(total_rows or 0), iso_utc_now()),
        )
        if requested_by:
            conn.execute('UPDATE import_jobs SET requested_by = ? WHERE job_id = ?',
                         (requested_by, job_id))
        conn.commit()
        return job_id
    finally:
        conn.close()


def add_import_rows(crm_id, job_id, rows):
    """Bulk-insert parsed rows for a job, encrypting every secret on the way in.

    `rows` are import_parser output dicts. A row that arrived `valid=False`
    lands as `invalid` with its errors and NO credential stored — it will never
    be attempted, so keeping the password would be pure liability.

    One executemany inside one transaction: 600 rows is one commit, and a job
    can never exist with a partial row set.
    """
    now = iso_utc_now()
    payload = []
    for r in rows:
        valid = bool(r.get('valid'))
        cookies = r.get('cookies') or None
        payload.append((
            job_id, crm_id, int(r.get('row_index', 0)), r.get('line'),
            r.get('lane') or 'password', r.get('platform') or 'onlyfans',
            r.get('email'), r.get('label'), r.get('proxy'),
            'pending' if valid else 'invalid',
            encrypt_password(r.get('password')) if (valid and r.get('password')) else None,
            encrypt_password(r.get('totp_secret')) if (valid and r.get('totp_secret')) else None,
            encrypt_password(json.dumps(cookies)) if (valid and cookies) else None,
            None if valid else '; '.join(r.get('errors') or ['invalid row'])[:500],
            None if valid else 'invalid_row',
            0 if valid else 1,
            None if valid else now,
            now, now,
        ))
    conn = _import_conn()
    try:
        conn.executemany(
            '''INSERT INTO import_job_rows
               (job_id, crm_id, row_index, source_line, lane, platform, email,
                label, proxy, status, encrypted_password, encrypted_totp_secret,
                encrypted_cookies, error, error_reason, permanent, finished_at,
                created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            payload)
        conn.commit()
        return len(payload)
    finally:
        conn.close()


def get_import_job(crm_id, job_id):
    """One job, CRM-scoped. The crm_id filter IS the access-control boundary."""
    conn = _import_conn(row_factory=True)
    try:
        return _import_job_to_dict(conn.execute(
            'SELECT * FROM import_jobs WHERE crm_id = ? AND job_id = ?',
            (crm_id, job_id)).fetchone())
    finally:
        conn.close()


def get_import_job_unscoped(job_id):
    """Job by id with no CRM filter. ONLY for the background worker, which is
    trusted and addresses jobs by their server-generated id."""
    conn = _import_conn(row_factory=True)
    try:
        return _import_job_to_dict(conn.execute(
            'SELECT * FROM import_jobs WHERE job_id = ?', (job_id,)).fetchone())
    finally:
        conn.close()


def update_import_job(job_id, **fields):
    """Merge-update a job. Unknown columns ignored; counts dict JSON-encoded."""
    sets, params = [], []
    for k, v in fields.items():
        if k not in _IMPORT_JOB_UPDATABLE:
            continue
        if k == 'counts' and not isinstance(v, (str, type(None))):
            v = json.dumps(v)
        sets.append(f'{k} = ?')
        params.append(v)
    if not sets:
        return
    params.append(job_id)
    conn = _import_conn()
    try:
        conn.execute(f'UPDATE import_jobs SET {", ".join(sets)} WHERE job_id = ?',
                     params)
        conn.commit()
    finally:
        conn.close()


def list_import_jobs(crm_id, limit=50, offset=0):
    """(jobs, total) for a panel, newest first, each with its status counts."""
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    conn = _import_conn(row_factory=True)
    try:
        jobs = [_import_job_to_dict(r) for r in conn.execute(
            '''SELECT * FROM import_jobs WHERE crm_id = ?
               ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?''',
            (crm_id, limit, offset)).fetchall()]
        total = conn.execute('SELECT COUNT(*) FROM import_jobs WHERE crm_id = ?',
                             (crm_id,)).fetchone()[0]
        for j in jobs:
            j['counts'] = _count_rows(conn, j['job_id'])
        return jobs, total
    finally:
        conn.close()


def _count_rows(conn, job_id):
    """{state: n} for every state present, plus a zero-filled full key set so
    the UI never has to guess whether a missing key means 0 or 'unknown'."""
    out = {s: 0 for s in ROW_STATES}
    for state, n in conn.execute(
            'SELECT status, COUNT(*) FROM import_job_rows WHERE job_id = ? '
            'GROUP BY status', (job_id,)).fetchall():
        out[state] = n
    out['total'] = sum(out[s] for s in ROW_STATES)
    out['done'] = sum(out[s] for s in TERMINAL_ROW_STATES)
    return out


def count_import_rows(job_id):
    conn = _import_conn()
    try:
        return _count_rows(conn, job_id)
    finally:
        conn.close()


def _import_row_to_dict(row, *, include_secrets=False):
    """Hydrate a row. Secrets are decrypted ONLY when a caller explicitly asks
    (the worker does; no route ever does), and the ciphertext columns are
    dropped either way so they cannot leak through a jsonify()."""
    if row is None:
        return None
    d = dict(row)
    if include_secrets:
        d['password'] = decrypt_password(d.get('encrypted_password'))
        d['totp_secret'] = decrypt_password(d.get('encrypted_totp_secret'))
        raw_cookies = decrypt_password(d.get('encrypted_cookies'))
        d['cookies'] = json.loads(raw_cookies) if raw_cookies else None
        raw_2fa = decrypt_password(d.get('encrypted_2fa_cookies'))
        d['two_fa_cookies'] = json.loads(raw_2fa) if raw_2fa else None
    else:
        d['has_password'] = bool(d.get('encrypted_password'))
        d['has_totp_secret'] = bool(d.get('encrypted_totp_secret'))
        d.pop('otp_state', None)
        d.pop('x_bc', None)
        d.pop('x_hash', None)
        # Worker-internal batch-claim token. Not a credential, but it is the
        # handle a claim is addressed by; nothing outside the runner has any
        # use for it, so it does not go over the wire.
        d.pop('claim_token', None)
    for col in ('encrypted_password', 'encrypted_totp_secret',
                'encrypted_cookies', 'encrypted_2fa_cookies'):
        d.pop(col, None)
    d['permanent'] = bool(d.get('permanent'))
    return d


def list_import_rows(crm_id, job_id, *, status=None, limit=1000, offset=0):
    """(rows, total) for one job, ordered by row_index. Never returns secrets."""
    limit = max(1, min(int(limit or 1000), config.IMPORT_MAX_ROWS))
    offset = max(0, int(offset or 0))
    where = 'crm_id = ? AND job_id = ?'
    params = [crm_id, job_id]
    if status:
        where += ' AND status = ?'
        params.append(status)
    conn = _import_conn(row_factory=True)
    try:
        rows = [_import_row_to_dict(r) for r in conn.execute(
            f'SELECT * FROM import_job_rows WHERE {where} '
            f'ORDER BY row_index LIMIT ? OFFSET ?', (*params, limit, offset)
        ).fetchall()]
        total = conn.execute(
            f'SELECT COUNT(*) FROM import_job_rows WHERE {where}', params
        ).fetchone()[0]
        return rows, total
    finally:
        conn.close()


def get_import_row(crm_id, job_id, row_id, *, include_secrets=False):
    conn = _import_conn(row_factory=True)
    try:
        return _import_row_to_dict(conn.execute(
            'SELECT * FROM import_job_rows WHERE crm_id = ? AND job_id = ? AND id = ?',
            (crm_id, job_id, int(row_id))).fetchone(),
            include_secrets=include_secrets)
    finally:
        conn.close()


def get_import_row_unscoped(row_id, *, include_secrets=False):
    """Worker-only row read (trusted caller, server-generated id)."""
    conn = _import_conn(row_factory=True)
    try:
        return _import_row_to_dict(conn.execute(
            'SELECT * FROM import_job_rows WHERE id = ?', (int(row_id),)).fetchone(),
            include_secrets=include_secrets)
    finally:
        conn.close()


def update_import_row(row_id, **fields):
    """Merge-update one row. Always stamps updated_at."""
    sets, params = [], []
    for k, v in fields.items():
        if k not in _IMPORT_ROW_UPDATABLE:
            continue
        sets.append(f'{k} = ?')
        params.append(v)
    if not sets:
        return
    sets.append('updated_at = ?')
    params.append(iso_utc_now())
    params.append(int(row_id))
    conn = _import_conn()
    try:
        conn.execute(
            f'UPDATE import_job_rows SET {", ".join(sets)} WHERE id = ?', params)
        conn.commit()
    finally:
        conn.close()


def zero_import_row_secrets(row_id):
    """Destroy every credential on one row. Idempotent.

    Called the instant a row reaches a terminal state. This is the difference
    between "the import finished" and "600 OnlyFans passwords are now sitting
    in a SQLite file on this box".
    """
    sets = ', '.join(f'{c} = NULL' for c in _IMPORT_ROW_SECRET_COLUMNS)
    conn = _import_conn()
    try:
        conn.execute(
            f'UPDATE import_job_rows SET {sets}, updated_at = ? WHERE id = ?',
            (iso_utc_now(), int(row_id)))
        conn.commit()
    finally:
        conn.close()


def claim_import_rows(job_id, lane, claim_token, limit):
    """Atomically claim up to `limit` pending rows of one lane.

    ONE UPDATE, then a read of what it took. This is the whole resumability
    story: the worker holds no list, so a process that dies mid-job leaves
    nothing but `running` rows that reconcile_stale_imports() flips back to
    `pending`. A second worker (or a second process) racing on the same job
    simply claims a disjoint set.

    `UPDATE ... WHERE id IN (SELECT ... LIMIT ?)` is used rather than
    `UPDATE ... LIMIT`, which needs a compile-time SQLite option we cannot rely
    on being present.
    """
    now = iso_utc_now()
    conn = _import_conn(row_factory=True)
    try:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute(
            '''UPDATE import_job_rows
                  SET status = 'running', claim_token = ?, claimed_at = ?,
                      started_at = COALESCE(started_at, ?),
                      attempts = attempts + 1, updated_at = ?
                WHERE id IN (SELECT id FROM import_job_rows
                              WHERE job_id = ? AND lane = ? AND status = 'pending'
                              ORDER BY row_index LIMIT ?)''',
            (claim_token, now, now, now, job_id, lane, int(limit)))
        rows = [_import_row_to_dict(r, include_secrets=True) for r in conn.execute(
            'SELECT * FROM import_job_rows WHERE job_id = ? AND claim_token = ? '
            'AND status = ? ORDER BY row_index', (job_id, claim_token, 'running')
        ).fetchall()]
        conn.commit()
        return rows
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def release_stale_import_rows(job_id=None):
    """Flip `running` rows back to `pending` so they get re-attempted.

    Used by reconcile_stale_imports() at startup: a `running` row in a process
    that just booted has no worker behind it — its thread died with the old
    process. Rows past IMPORT_MAX_ATTEMPTS are failed instead of looped, so a
    row that reliably crashes the worker cannot resurrect itself forever.

    Returns (requeued, exhausted).
    """
    now = iso_utc_now()
    where = "status = 'running'"
    params = []
    if job_id:
        where += ' AND job_id = ?'
        params.append(job_id)
    conn = _import_conn()
    try:
        cur = conn.execute(
            f'''UPDATE import_job_rows
                   SET status = 'failed', permanent = 1,
                       error = 'gave up after {config.IMPORT_MAX_ATTEMPTS} interrupted attempts',
                       error_reason = 'attempts_exhausted', finished_at = ?,
                       claim_token = NULL, updated_at = ?
                 WHERE {where} AND attempts >= ?''',
            (now, now, *params, config.IMPORT_MAX_ATTEMPTS))
        exhausted = cur.rowcount
        cur = conn.execute(
            f'''UPDATE import_job_rows
                   SET status = 'pending', claim_token = NULL, claimed_at = NULL,
                       updated_at = ?
                 WHERE {where}''',
            (now, *params))
        requeued = cur.rowcount
        conn.commit()
    finally:
        conn.close()
    # Anything failed above had its credential kept until now; destroy it.
    if exhausted:
        _zero_secrets_for_terminal_rows(job_id)
    return requeued, exhausted


def _zero_secrets_for_terminal_rows(job_id=None):
    """Sweep: NULL secrets on every terminal row that still carries any.

    A belt-and-braces backstop for the per-row zeroing — a crash between
    "mark terminal" and "zero" would otherwise leave a credential behind.
    """
    sets = ', '.join(f'{c} = NULL' for c in _IMPORT_ROW_SECRET_COLUMNS)
    holds = ' OR '.join(f'{c} IS NOT NULL' for c in _IMPORT_ROW_SECRET_COLUMNS)
    marks = ','.join('?' * len(TERMINAL_ROW_STATES))
    where = f'status IN ({marks}) AND ({holds})'
    params = list(TERMINAL_ROW_STATES)
    if job_id:
        where += ' AND job_id = ?'
        params.append(job_id)
    conn = _import_conn()
    try:
        cur = conn.execute(
            f'UPDATE import_job_rows SET {sets}, updated_at = ? WHERE {where}',
            (iso_utc_now(), *params))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def list_resumable_import_jobs(boot_iso):
    """Jobs left queued/running by a process that is no longer alive.

    Unlike exports (cheap to redo, so they are simply failed on restart), an
    import that got 400 of 600 accounts in is expensive and half-applied — the
    only correct move is to pick it back up. Returns full job dicts.
    """
    conn = _import_conn(row_factory=True)
    try:
        return [_import_job_to_dict(r) for r in conn.execute(
            '''SELECT * FROM import_jobs
                WHERE status IN ('queued', 'running') AND created_at <= ?
                ORDER BY created_at''', (boot_iso,)).fetchall()]
    finally:
        conn.close()


def cancel_import_job(crm_id, job_id):
    """Mark a job canceled and stop every row that has not started.

    Cooperative for in-flight rows: a `running` row finishes its platform call
    (we cannot un-send a login) and the worker records the real outcome — but
    nothing new is claimed. Returns the number of rows canceled.
    """
    now = iso_utc_now()
    conn = _import_conn()
    try:
        cur = conn.execute(
            '''UPDATE import_job_rows SET status = 'canceled', finished_at = ?,
                      updated_at = ?
                WHERE crm_id = ? AND job_id = ? AND status = 'pending' ''',
            (now, now, crm_id, job_id))
        canceled = cur.rowcount
        conn.execute(
            '''UPDATE import_jobs SET status = 'canceled', completed_at = ?
                WHERE crm_id = ? AND job_id = ? AND status IN ('queued', 'running')''',
            (now, crm_id, job_id))
        conn.commit()
    finally:
        conn.close()
    _zero_secrets_for_terminal_rows(job_id)
    return canceled


def has_active_import_rows(job_id):
    """True while any row of this job is still pending or running."""
    conn = _import_conn()
    try:
        marks = ','.join('?' * len(ACTIVE_ROW_STATES))
        return conn.execute(
            f'SELECT COUNT(*) FROM import_job_rows WHERE job_id = ? '
            f'AND status IN ({marks})', (job_id, *ACTIVE_ROW_STATES)
        ).fetchone()[0] > 0
    finally:
        conn.close()


def list_pending_2fa_rows(crm_id, *, limit=200):
    """Every parked 2FA row on a panel, across ALL jobs, newest job first.

    Panel-wide on purpose: the operator closes the importer and the dashboard
    still has to be able to say "9 accounts need a 2FA code". A per-job query
    could not answer that.
    """
    limit = max(1, min(int(limit or 200), config.IMPORT_MAX_ROWS))
    conn = _import_conn(row_factory=True)
    try:
        return [_import_row_to_dict(r) for r in conn.execute(
            '''SELECT * FROM import_job_rows
                WHERE crm_id = ? AND status IN ('needs_2fa', 'needs_2fa_expired')
                ORDER BY (status = 'needs_2fa') DESC, two_fa_expires_at ASC,
                         job_id, row_index
                LIMIT ?''', (crm_id, limit)).fetchall()]
    finally:
        conn.close()


def list_expired_2fa_rows(now_iso):
    """Parked rows whose window has closed. Worker-scoped (all tenants)."""
    conn = _import_conn(row_factory=True)
    try:
        return [_import_row_to_dict(r) for r in conn.execute(
            '''SELECT * FROM import_job_rows
                WHERE status = 'needs_2fa' AND two_fa_expires_at IS NOT NULL
                  AND two_fa_expires_at <= ?''', (now_iso,)).fetchall()]
    finally:
        conn.close()


def list_stale_credential_rows(cutoff_iso):
    """Rows still holding a credential in a non-terminal 2FA state past the
    hard TTL. These get failed and scrubbed — a password may not live in this
    file indefinitely just because nobody ever typed a code."""
    conn = _import_conn(row_factory=True)
    try:
        return [_import_row_to_dict(r) for r in conn.execute(
            '''SELECT * FROM import_job_rows
                WHERE status IN ('needs_2fa', 'needs_2fa_expired')
                  AND created_at <= ?''', (cutoff_iso,)).fetchall()]
    finally:
        conn.close()


def find_of_account_by_email(crm_id, email, platform=None):
    """The connected account for this panel with this login email, or None.

    Used by the importer to mark a row `skipped` instead of re-logging-in an
    account the panel already has — a duplicate login is a wasted captcha and
    one more authentication event against an account OF is already watching.
    """
    if not email:
        return None
    sql = ('''SELECT a.of_user_id FROM of_accounts a
              JOIN crm_panels p ON a.crm_panel_id = p.id
              WHERE p.crm_id = ? AND LOWER(a.email) = LOWER(?)''')
    params = [crm_id, email]
    if platform:
        sql += ' AND COALESCE(a.platform, "onlyfans") = ?'
        params.append(platform)
    conn = _import_conn()
    try:
        row = conn.execute(sql, params).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


# Initialize database on import
init_database()
