#!/usr/bin/env python3
"""
Configuration for OnlyFans CRM Flask API
All sensitive values must be provided via environment variables.
"""

import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
BASE_DIR = Path(__file__).parent.absolute()
load_dotenv(BASE_DIR / '.env')

# Database
# Optional env override so pen-test / sandbox runs can point at a throwaway
# copy of the DB (cp crm_data.db /tmp/sandbox.db && DATABASE_PATH=/tmp/sandbox.db).
_db_override = os.environ.get('DATABASE_PATH')
DATABASE_PATH = Path(_db_override) if _db_override else (BASE_DIR / 'database.db')
SQLALCHEMY_DATABASE_URI = f'sqlite:///{DATABASE_PATH}'
SQLALCHEMY_TRACK_MODIFICATIONS = False


def get_required_env(var_name, min_length=16):
    """Get a required environment variable or raise an error."""
    value = os.environ.get(var_name)
    if not value:
        raise ValueError(
            f"Environment variable {var_name} is required. "
            f"Please set it before starting the application."
        )
    if len(value) < min_length:
        raise ValueError(
            f"Environment variable {var_name} must be at least {min_length} characters long."
        )
    return value


def generate_secret():
    """Generate a cryptographically secure secret."""
    return secrets.token_urlsafe(32)


# Security - These MUST be set via environment variables
SECRET_KEY = get_required_env('SECRET_KEY', min_length=32)
ENCRYPTION_KEY = get_required_env('ENCRYPTION_KEY', min_length=32)

# Bootstrap registration is intentionally open on a fresh install. Operators
# must set this to the exact string "false" after creating the owner account.
# Both the dashboard proxy and Flask enforce it so publishing port 5000 cannot
# bypass the closed-registration setting.
ALLOW_PUBLIC_REGISTRATION = (
    os.environ.get('ALLOW_PUBLIC_REGISTRATION', '').strip().lower() != 'false'
)

# Captcha provider key. OPTIONAL at startup, required before any OnlyFans
# account can log in.
#
# Deliberately not required at import: the stack should come up and the panel
# should be usable so you can look around, create your account and paste a key
# into Settings. A key set here is the default for every panel; a panel can
# override it with its own from Settings, and spends against its own balance.
#
# With neither set, connecting an OnlyFans account fails with a message saying
# exactly that. Everything else works.
TWOCAPTCHA_API_KEY = os.environ.get('TWOCAPTCHA_API_KEY', '').strip()

# Cloudflare Turnstile
TURNSTILE_SITEKEY = os.environ.get('TURNSTILE_SITEKEY', '0x4AAAAAAAxTqMnJc6h5lGQ5')
TURNSTILE_SITEKEY_MANAGED = os.environ.get('TURNSTILE_SITEKEY_MANAGED', '0x4AAAAAAAxTpmbMvo7Qj6zy')
TURNSTILE_ACTION = os.environ.get('TURNSTILE_ACTION', 'login')

# User Agent
USER_AGENT = os.environ.get(
    'USER_AGENT',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
)

# Proxy configuration - Optional, no default
DEFAULT_PROXY = os.environ.get('PROXY_URL')

# OnlyFans API
OF_BASE_URL = 'https://onlyfans.com'
OF_API_BASE = f'{OF_BASE_URL}/api2/v2'

# Static OnlyFans headers (these rarely change)
X_OF_REV = os.environ.get('X_OF_REV', '202602231439-dbfa2fc0ae')
APP_TOKEN = os.environ.get('APP_TOKEN', '33d57ade8c02dbc5a333db99ff9ae26a')

# Fansly API
# Like OF, the base is the bare host and request paths carry the `/api/v1`
# prefix (mirrors how OF paths carry `/api2/v2`). The client-check digest is
# computed over the full pathname, so paths MUST include `/api/v1/...`.
FANSLY_BASE_URL = os.environ.get('FANSLY_BASE_URL', 'https://apiv3.fansly.com')
FANSLY_API_BASE = f'{FANSLY_BASE_URL}/api/v1'
# Constant salt baked into the Fansly SPA bundle, assembled from three string
# pushes ("necvac" + "govry3" + "tybkYz") to defeat flat string search. Feeds
# the non-cryptographic cyrb53 client-check digest.
FANSLY_CLIENT_CHECK_SALT = os.environ.get('FANSLY_CLIENT_CHECK_SALT', 'necvac-govry3-tybkYz')
# curl_cffi applies NO default timeout — a stalled proxy or a hung Fansly
# response blocks the calling thread forever (the OF side hit a ~12h worker
# hang from exactly this, fixed via multi_tenant_auth.REQUEST_TIMEOUT). Since
# APScheduler shares one 10-worker pool across every tenant on both platforms,
# a few no-timeout hangs can starve polling/webhooks platform-wide. (connect,
# read) seconds; env-overridable.
_FANSLY_CONNECT_TIMEOUT = float(os.environ.get('FANSLY_CONNECT_TIMEOUT', 15))
_FANSLY_READ_TIMEOUT = float(os.environ.get('FANSLY_READ_TIMEOUT', 90))
FANSLY_REQUEST_TIMEOUT = (_FANSLY_CONNECT_TIMEOUT, _FANSLY_READ_TIMEOUT)
# Gate Fansly background polling until the per-platform poller paths are
# validated. OF polling is unaffected by this flag.
FANSLY_POLLING_ENABLED = os.environ.get('FANSLY_POLLING_ENABLED', 'false').lower() == 'true'
# Gate the Fansly real-time WebSocket listener (wss://wsv3.fansly.com). Off by
# default until validated against a live account.
FANSLY_WS_ENABLED = os.environ.get('FANSLY_WS_ENABLED', 'false').lower() == 'true'
FANSLY_WS_URL = os.environ.get('FANSLY_WS_URL', 'wss://wsv3.fansly.com/?v=3')
# Browser-ish UA the Fansly SPA presents (the bundle ships a Chrome/macOS UA).
FANSLY_USER_AGENT = os.environ.get(
    'FANSLY_USER_AGENT',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
)

# Session settings
SESSION_REFRESH_INTERVAL = int(os.environ.get('SESSION_REFRESH_INTERVAL', 1800))  # 30 minutes
SESSION_MAX_AGE = int(os.environ.get('SESSION_MAX_AGE', 864000))  # 10 days

# Request logging
LOG_API_REQUESTS = os.environ.get('LOG_API_REQUESTS', 'True').lower() == 'true'
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

# Flask settings - DEBUG defaults to False for security
DEBUG = os.environ.get('FLASK_DEBUG', 'False').lower() == 'true'
HOST = os.environ.get('FLASK_HOST', '0.0.0.0')
PORT = int(os.environ.get('FLASK_PORT', 5000))

# CORS settings - Restrict to specific origins in production
CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:3000,http://localhost:3181').split(',')

# Rate limiting
# Raised in v2 for MCP traffic — the MCP server fans many tool calls per
# turn through this limiter. These per-minute limits are flood protection, not
# a cost control — the real spend guard is your captcha balance and your proxies.
RATE_LIMIT_DEFAULT = os.environ.get('RATE_LIMIT_DEFAULT', '1000 per minute')
RATE_LIMIT_LOGIN = os.environ.get('RATE_LIMIT_LOGIN', '20 per minute')
RATE_LIMIT_SENSITIVE = os.environ.get('RATE_LIMIT_SENSITIVE', '100 per minute')
# Admin panel — reads keep a live dashboard responsive; writes are tight
# because the only legitimate caller is a human clicking buttons. Anything
# faster than 30/min on a write is almost certainly automation gone wrong.
RATE_LIMIT_ADMIN_READ = os.environ.get('RATE_LIMIT_ADMIN_READ', '120 per minute')
RATE_LIMIT_ADMIN_WRITE = os.environ.get('RATE_LIMIT_ADMIN_WRITE', '30 per minute')

# Security headers
SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
}

# 2FA session expiration (seconds)
TWO_FA_SESSION_EXPIRY = int(os.environ.get('TWO_FA_SESSION_EXPIRY', 600))  # 10 minutes

# Background polling
POLL_INTERVAL_DEFAULT = int(os.environ.get('POLL_INTERVAL_DEFAULT', 120))  # 2 minutes
POLL_INTERVAL_MIN = int(os.environ.get('POLL_INTERVAL_MIN', 60))
POLL_INTERVAL_MAX = int(os.environ.get('POLL_INTERVAL_MAX', 3600))
# Interval used when polling is auto-enabled for a paid-plan account on connect
# (see crm_api login success branches). 5 minutes: near-real-time earnings/subs
# at ~2.5x fewer upstream OF calls than the 2-minute manual default, which is
# the gentler default when polling is on for every account. Operators can still
# set a faster per-account interval down to POLL_INTERVAL_MIN.
DEFAULT_PAID_POLL_INTERVAL = int(os.environ.get('DEFAULT_PAID_POLL_INTERVAL', 300))

# SSE
SSE_HEARTBEAT_SECONDS = int(os.environ.get('SSE_HEARTBEAT_SECONDS', 15))

# ---- Disconnected-account data retention -----------------------------------
# How long the cached rows of a disconnected account survive before the sweeper
# hard-deletes them (see delete_of_account / purge_account_data). Not zero,
# because a chunk of what we hold is NOT re-fetchable from the platform: fan
# tags, campaign tags, fan notes and the local `account_events` log exist only
# here, and the transactions backfill is bounded to a window, so anything older
# than that never comes back either. A misclicked "Disconnect" would destroy all
# of it with no undo. Reconnecting the same account to the same panel inside
# this window restores everything (add_of_account clears the tombstone), because
# every cache table is keyed on (crm_id, of_user_id) and simply lines up again.
ACCOUNT_DATA_RETENTION_DAYS = int(os.environ.get('ACCOUNT_DATA_RETENTION_DAYS', 30))

# Ceiling on a single media upload (raw bytes, and the server-side fetch behind
# `source_url`). The whole file is held in memory while it is sliced into 5 MiB
# S3 parts, so this is a memory guard as much as an abuse guard.
MEDIA_UPLOAD_MAX_BYTES = int(os.environ.get('MEDIA_UPLOAD_MAX_BYTES', 512 * 1024 * 1024))

# Whether the sweeper also adopts orphans left by deletes that ran BEFORE the
# tombstone existed (the old delete_of_account removed only the account row).
# Production was carrying ~1.5k such rows at the time this shipped, and nothing
# else will ever reclaim them. Adoption only *tombstones* them, so they still
# get the full retention window — and reconnecting the account cancels it. Set
# to 0 if you'd rather clean that backlog up by hand.
ACCOUNT_ORPHAN_ADOPTION = os.environ.get('ACCOUNT_ORPHAN_ADOPTION', '1') not in ('0', 'false', 'no')

# ---- Locally-bound proxy endpoints (SSRF guard escape hatch) ---------------
# validate_proxy runs every saved proxy through outbound_guard, which rejects
# loopback/private addresses — a tenant setting proxy=http://127.0.0.1:6379
# would otherwise turn this server into their port scanner.
#
# One legitimate case needs a loopback proxy: a reverse SSH tunnel that lands
# an operator's home/office connection on this box, e.g.
#
#     ssh -N -R 1080 ubuntu@this-server        # from the operator's laptop
#     PROXY_ALLOW_ENDPOINTS=127.0.0.1:1080
#
# so an account's OnlyFans traffic egresses from that laptop's IP. That is the
# only way to complete an OnlyFans face check, which OF binds to the session's
# IP (see of_faceid.py).
#
# Exact `host:port` matches only, comma-separated, empty by default. An entry
# here is an operator decision about one specific listener — it does NOT open
# loopback generally, so a tenant cannot pivot to another local port.
PROXY_ALLOW_ENDPOINTS = tuple(
    entry.strip() for entry in
    os.environ.get('PROXY_ALLOW_ENDPOINTS', '').split(',')
    if entry.strip()
)

# ---- Panel-level Telegram notifications ------------------------------------
# Two bot modes, both panel-scoped (one integration per crm_id):
#
#   shared — the tenant creates nothing; they open a t.me deep link and press
#            Start on OUR bot. Requires the two vars below to be set. If they
#            are not set the shared path is refused with an explicit error
#            rather than silently never pairing.
#   custom — the tenant supplies their own bot token. Stored Fernet-encrypted
#            (crm_database.encrypt_password) and never returned by any route.
#
# TELEGRAM_SHARED_BOT_USERNAME is the @name WITHOUT the '@' — it is what the
# deep link is built from (https://t.me/<username>?start=<code>). We could read
# it from getMe, but that is a network call on every pairing request and the
# value never changes, so it is configuration.
TELEGRAM_SHARED_BOT_TOKEN = os.environ.get('TELEGRAM_SHARED_BOT_TOKEN') or None
TELEGRAM_SHARED_BOT_USERNAME = (
    os.environ.get('TELEGRAM_SHARED_BOT_USERNAME') or '').lstrip('@') or None

# Pairing codes are single-use and short-lived: the code is the entire proof
# that the Telegram user pressing Start is the person holding the dashboard
# session, so a long-lived one is a standing account-takeover primitive for the
# notification channel.
TELEGRAM_PAIRING_TTL_SECONDS = int(os.environ.get('TELEGRAM_PAIRING_TTL_SECONDS', 600))

# How often the intake job asks Telegram for new updates. This is a SHORT poll
# (getUpdates with timeout=0), not a long poll — see telegram_updates.py for why
# that matters for the scheduler thread pool.
TELEGRAM_POLL_SECONDS = int(os.environ.get('TELEGRAM_POLL_SECONDS', 3))

# Consecutive send failures before a panel's Telegram channel auto-deactivates.
# Same number as webhooks (crm_database.record_webhook_delivery) on purpose.
TELEGRAM_MAX_CONSECUTIVE_FAILURES = int(
    os.environ.get('TELEGRAM_MAX_CONSECUTIVE_FAILURES', 5))

# Timeout on every call to api.telegram.org. Matches the webhook delivery
# budget — a wedged Telegram must never hold an event-emitting thread.
TELEGRAM_TIMEOUT_SECONDS = float(os.environ.get('TELEGRAM_TIMEOUT_SECONDS', 5))


# ---- Data export ("Download your data") ------------------------------------
# Where generated export ZIPs live. Per-tenant subdirs (exports/<crm_id>/...).
# gitignored. Kept under the API dir so it travels with the deployment.
EXPORTS_DIR = os.environ.get('EXPORTS_DIR', str(BASE_DIR / 'exports'))
# How long a finished export is downloadable before the cleanup cron sweeps it.
EXPORT_RETENTION_DAYS = int(os.environ.get('EXPORT_RETENTION_DAYS', 7))
# Data types the export API will accept (media is a separate boolean toggle,
# not a data type). Order here is the order phases run in the worker.
EXPORT_DATA_TYPES = [
    'account', 'subscribers', 'transactions', 'fans', 'earnings', 'messages',
]
# Safety caps for the live message walk + media download (the expensive parts).
# The since/until window is the primary natural limiter; these are backstops so
# a huge account can't run forever or fill the disk.
EXPORT_MAX_CHATS = int(os.environ.get('EXPORT_MAX_CHATS', 2000))
EXPORT_MAX_MESSAGES_PER_CHAT = int(os.environ.get('EXPORT_MAX_MESSAGES_PER_CHAT', 5000))
EXPORT_MAX_MEDIA_FILES = int(os.environ.get('EXPORT_MAX_MEDIA_FILES', 5000))
EXPORT_MAX_MEDIA_BYTES = int(os.environ.get('EXPORT_MAX_MEDIA_BYTES', 5 * 1024 * 1024 * 1024))  # 5 GiB
# Wall-clock budget for the live message walk. OnlyFans returns hasMore=true even
# on tiny/empty pages and spam-magnet accounts can have thousands of junk chats,
# so an unbounded walk can run for hours. When the budget is hit the walk stops
# with a warning and the export still packages what it has (partial > wedged).
EXPORT_MAX_RUNTIME_SECONDS = int(os.environ.get('EXPORT_MAX_RUNTIME_SECONDS', 1200))  # 20 min
# A queued/running export older than this is treated as dead: a new export
# request supersedes it (fails the old row) instead of returning already_running.
EXPORT_STALE_MINUTES = int(os.environ.get('EXPORT_STALE_MINUTES', 30))


# ---- Bulk account import ----------------------------------------------------
# Paste/upload limits. Both are REJECTIONS, never truncations: silently dropping
# row 1001 of a 1200-account list is how an operator ends up believing 1200
# creators are connected when 200 were never attempted.
IMPORT_MAX_ROWS = int(os.environ.get('IMPORT_MAX_ROWS', 1000))
IMPORT_MAX_BYTES = int(os.environ.get('IMPORT_MAX_BYTES', 2 * 1024 * 1024))  # 2 MiB
# Bounds for a credential we merely PASS THROUGH to the platform. Deliberately
# permissive: this is somebody else's existing password, not one we are setting,
# so the only wrong answers are "not a string" and "absurd length".
IMPORT_PASSWORD_MIN = int(os.environ.get('IMPORT_PASSWORD_MIN', 1))
IMPORT_PASSWORD_MAX = int(os.environ.get('IMPORT_PASSWORD_MAX', 256))

# Two lanes inside ONE heavy-pool slot (see import_runner). Cookie rows are a
# single authenticated GET (~4s, no captcha); password rows are a full login
# (~30s + a paid captcha solve), so they get their own, much smaller pool.
IMPORT_COOKIE_CONCURRENCY = int(os.environ.get('IMPORT_COOKIE_CONCURRENCY', 10))
IMPORT_PASSWORD_CONCURRENCY = int(os.environ.get('IMPORT_PASSWORD_CONCURRENCY', 6))
# Global ceiling on *logins* per minute across the whole process. A burst of
# logins from one egress IP is the exact shape of credential stuffing.
IMPORT_LOGIN_RATE_PER_MIN = float(os.environ.get('IMPORT_LOGIN_RATE_PER_MIN', 30))
# Concurrent platform calls allowed per proxy host (1 == serialize). Rows with
# no proxy share the ':direct' key — they really do share one egress IP.
IMPORT_PER_PROXY_CONCURRENCY = int(os.environ.get('IMPORT_PER_PROXY_CONCURRENCY', 1))
# How many rows one claim-batch grabs. Small enough that a restart re-does very
# little, large enough that the claim UPDATE isn't the bottleneck.
IMPORT_BATCH_SIZE = int(os.environ.get('IMPORT_BATCH_SIZE', 25))
# Attempts per row before a TRANSIENT failure becomes terminal. Permanent
# failures (OF said "wrong email or password") never consume more than one.
IMPORT_MAX_ATTEMPTS = int(os.environ.get('IMPORT_MAX_ATTEMPTS', 3))
# SSE coalescing: at most one import.progress per job per this many seconds,
# carrying the counts plus a tail of the most recent row transitions. sse_hub
# queues are maxsize=200 and DROP on overflow, so 600 per-row events would
# evict exactly the ones the UI needs.
IMPORT_PROGRESS_INTERVAL_SECONDS = float(os.environ.get('IMPORT_PROGRESS_INTERVAL_SECONDS', 1.0))
IMPORT_PROGRESS_TAIL = int(os.environ.get('IMPORT_PROGRESS_TAIL', 20))
# Hard ceiling on how long a row may hold a credential while parked waiting for
# a human 2FA code. Past this the credential is destroyed and the row fails.
IMPORT_CREDENTIAL_TTL_HOURS = float(os.environ.get('IMPORT_CREDENTIAL_TTL_HOURS', 24))

# ---- Subs/tx/campaigns refresh liveness ------------------------------------
# A refresh_state entry that is still non-terminal but has recorded no progress
# for this long is treated as dead: the next refresh request supersedes it
# instead of returning already_running forever (which is what wedged the Fansly
# panel on "refreshing" — the one-shot job never ran, so nothing ever called
# finish()).
#
# Measured against LAST PROGRESS, never against start time. A legitimate
# 60-page initial wallet walk can hold phase='fetching' for a very long time,
# but it fires on_progress after every page, so a healthy sync keeps resetting
# the clock and never looks stale. The gap that actually matters is a single
# page fetch: FANSLY_READ_TIMEOUT is 90s and a page can additionally eat a
# relogin, so 10 min leaves several multiples of headroom.
REFRESH_STALE_MINUTES = float(os.environ.get('REFRESH_STALE_MINUTES', 10))
