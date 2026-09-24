#!/usr/bin/env python3
"""APScheduler bootstrapping and per-account job management.

The scheduler lives in-process with Flask. Jobs are persisted in the same
SQLite file so they survive restarts. We only spawn the scheduler from the
Werkzeug main worker (never the reloader fork in dev) to avoid duplicate jobs.
"""

from __future__ import annotations

import atexit
import logging
import runtime_readiness
import os
import threading
import uuid as _uuid
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.executors.pool import ThreadPoolExecutor
from apscheduler.events import (
    EVENT_JOB_ERROR,
    EVENT_JOB_EXECUTED,
    EVENT_JOB_MAX_INSTANCES,
    EVENT_JOB_MISSED,
)

import config
import crm_database as db
import poller
import subscribers_sync
import transactions_sync
import campaigns_sync
import refresh_state
import webhook_delivery
import ws_listener

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None
_lock = threading.Lock()

def _parse_ws_enabled_accounts(raw: str) -> set[tuple[str, str]]:
    """Parse comma-separated ``crm_id:platform_account_id`` pairs.

    Account identifiers are deployment data, so the public source must never
    contain a built-in rollout allowlist. Malformed entries are ignored without
    logging their contents, which could itself disclose sensitive identifiers.
    """
    accounts: set[tuple[str, str]] = set()
    for entry in raw.split(","):
        crm_id, separator, platform_account_id = entry.strip().partition(":")
        crm_id = crm_id.strip()
        platform_account_id = platform_account_id.strip()
        if separator and crm_id and platform_account_id:
            accounts.add((crm_id, platform_account_id))
    return accounts


# Real-time OnlyFans WebSocket listeners — one persistent connection per
# account, run in a daemon thread (asyncio isolated inside). Disabled by
# default; operators may configure an allowlist at deployment time.
WS_ENABLED_ACCOUNTS = _parse_ws_enabled_accounts(
    os.environ.get("WS_ENABLED_ACCOUNTS", "")
)
_ws_listeners: dict[tuple[str, str], "ws_listener.AccountWSListener"] = {}
_ws_threads: dict[tuple[str, str], threading.Thread] = {}
_ws_lock = threading.Lock()


def _ws_enabled(crm_id: str, of_user_id: str) -> bool:
    return (crm_id, str(of_user_id)) in WS_ENABLED_ACCOUNTS


def start_ws_listener(crm_id: str, of_user_id: str) -> None:
    """Start a persistent WS listener daemon thread for one account (idempotent).
    No-op unless the account is in WS_ENABLED_ACCOUNTS."""
    of_user_id = str(of_user_id)
    if not _ws_enabled(crm_id, of_user_id):
        return
    key = (crm_id, of_user_id)
    with _ws_lock:
        t = _ws_threads.get(key)
        if t and t.is_alive():
            return  # already running
        listener = ws_listener.AccountWSListener(crm_id, of_user_id)
        thread = threading.Thread(
            target=listener.run, name=f"ws:{crm_id}:{of_user_id}", daemon=True)
        _ws_listeners[key] = listener
        _ws_threads[key] = thread
        thread.start()
        logger.info("Started WS listener thread for %s/%s", crm_id, of_user_id)


def stop_ws_listener(crm_id: str, of_user_id: str) -> None:
    of_user_id = str(of_user_id)
    key = (crm_id, of_user_id)
    with _ws_lock:
        listener = _ws_listeners.pop(key, None)
        _ws_threads.pop(key, None)
    if listener:
        listener.stop()
        logger.info("Stopped WS listener for %s/%s", crm_id, of_user_id)


# ── Fansly real-time WS listeners ──────────────────────────────────────────
# Parallel registry to the OF one. Gated by config.FANSLY_WS_ENABLED + the
# account actually being a Fansly account (so OF accounts never spin one up).
_fansly_ws_listeners: dict[tuple[str, str], object] = {}
_fansly_ws_threads: dict[tuple[str, str], threading.Thread] = {}


def start_fansly_ws_listener(crm_id: str, account_id: str) -> None:
    """Start a persistent Fansly WS listener daemon thread (idempotent).
    No-op unless FANSLY_WS_ENABLED and the account is a Fansly account."""
    import config
    if not getattr(config, 'FANSLY_WS_ENABLED', False):
        return
    account_id = str(account_id)
    try:
        acct = db.get_of_account(crm_id, account_id)
        if not acct or (acct.get('platform') or 'onlyfans') != 'fansly':
            return
    except Exception:
        return
    key = (crm_id, account_id)
    with _ws_lock:
        t = _fansly_ws_threads.get(key)
        if t and t.is_alive():
            return
        import fansly_ws_listener
        listener = fansly_ws_listener.FanslyAccountWSListener(crm_id, account_id)
        thread = threading.Thread(
            target=listener.run, name=f"fansly-ws:{crm_id}:{account_id}", daemon=True)
        _fansly_ws_listeners[key] = listener
        _fansly_ws_threads[key] = thread
        thread.start()
        logger.info("Started Fansly WS listener thread for %s/%s", crm_id, account_id)


def stop_fansly_ws_listener(crm_id: str, account_id: str) -> None:
    account_id = str(account_id)
    key = (crm_id, account_id)
    with _ws_lock:
        listener = _fansly_ws_listeners.pop(key, None)
        _fansly_ws_threads.pop(key, None)
    if listener:
        listener.stop()
        logger.info("Stopped Fansly WS listener for %s/%s", crm_id, account_id)

# The jobstore lives in its OWN SQLite file, deliberately not in crm_data.db.
#
# Every interval job rewrites its `next_run_time` row each time it fires. At a
# few hundred accounts that is several writes per second of pure bookkeeping,
# and pointing it at the ~1.5 GB file that also serves API reads and every
# poll's cursor write puts the two in permanent lock contention — WAL and the
# 30s busy-timeout only soften it.
#
# Splitting is free: nothing here is a source of truth. `reconcile_accounts()`
# rebuilds every per-account job from `of_accounts` at boot, and the internal
# jobs below are all registered with `replace_existing=True`. So an empty or
# missing jobstore self-heals on the next start, which is also why switching
# files needs no migration — the old `apscheduler_jobs` table in crm_data.db is
# simply abandoned (left in place, harmless, and useful if this is reverted).
JOBSTORE_PATH = os.environ.get(
    'SCHEDULER_JOBSTORE_PATH',
    os.path.join(os.path.dirname(os.path.abspath(db.DB_FILE)), 'scheduler_jobs.db'),
)
JOBSTORE_URL = f"sqlite:///{JOBSTORE_PATH}"
WEBHOOK_RETRY_JOB_ID = 'internal.webhook_retry'
AVATAR_REFRESH_JOB_ID = 'internal.avatar_refresh'
EXPORT_CLEANUP_JOB_ID = 'internal.export_cleanup'
ACCOUNT_PURGE_JOB_ID = 'internal.account_purge'
SUBS_ACTIVITY_JOB_ID = 'internal.subs_activity_sweep'
TELEGRAM_INTAKE_JOB_ID = 'internal.telegram_intake'
METRICS_FLUSH_JOB_ID = 'internal.metrics_flush'
METRICS_SWEEP_JOB_ID = 'internal.metrics_sweep'
ERROR_LOG_SWEEP_JOB_ID = 'internal.error_log_sweep'
TWO_FA_SWEEP_JOB_ID = 'internal.two_fa_sweep'
IMPORT_2FA_SWEEP_JOB_ID = 'internal.import_2fa_sweep'

# Parked 2FA challenges (two_fa_sessions) die on OnlyFans' side within minutes
# and each row holds an encrypted password, so their sweep runs on a minutes
# cadence — not the hours cadence the retention sweeps use. get_2fa_session
# already self-heals on read; this is for the rows nobody reads again.
#
# internal.import_2fa_sweep is the importer's own, separate pass: it expires
# PARKED IMPORT ROWS (needs_2fa -> needs_2fa_expired) so the UI countdown and
# the row state agree. Both exist because they clean different tables.
TWO_FA_SWEEP_MINUTES = int(os.environ.get('TWO_FA_SWEEP_MINUTES', 10))

# Request-outcome metrics accumulate in-process (api_metrics) and are written
# here, so the request path never touches SQLite. The interval is the maximum
# amount of counter data a hard kill can lose, and also the staleness floor of
# the dashboard chart — 60s is well inside both tolerances, and one flush is a
# single executemany of at most a few hundred small rows.
METRICS_FLUSH_SECONDS = int(os.environ.get('API_METRICS_FLUSH_SECONDS', 60))
# The metrics table is the only one here that grows purely with traffic, so it
# needs its own bounded sweep. Cadence matches the other retention sweeps: the
# deadline is measured in days, so being hours late is irrelevant.
METRICS_SWEEP_INTERVAL_HOURS = 6

# How often to sweep expired "download your data" archives off disk.
EXPORT_CLEANUP_INTERVAL_HOURS = 6

# How often to expire parked bulk-import 2FA rows. Must be well under
# config.TWO_FA_SESSION_EXPIRY (600s) or a row would keep advertising time
# remaining that has already run out — the UI counts down from what this job
# writes. 60s gives ten checks inside one window.
IMPORT_2FA_SWEEP_SECONDS = 60

# How often to look for disconnected accounts whose retention window has
# elapsed. Same cadence as the export sweep — the deadline is measured in days
# (config.ACCOUNT_DATA_RETENTION_DAYS), so being a few hours late is irrelevant
# and a rarer job would just make a restart-heavy box skip passes.
ACCOUNT_PURGE_INTERVAL_HOURS = 6

# Avatar/about refresh. Avatar URLs on BOTH platforms are CDN-signed and expire
# (OF within days, Fansly ~8-10), so a cached avatar decays into a broken image
# on its own; some accounts also report an empty avatar on login. This job
# re-fetches the account's own profile and updates the cached fields.
#
# It runs as a rolling sweep rather than one big daily pass. The old shape —
# "every polling-enabled account, once a day, in a single run" — had two
# problems: accounts with polling OFF were never refreshed at all (their avatar
# broke permanently), and widening it to every account would mean one heavy
# worker held for accounts × THROTTLE (600 accounts ≈ 11 min, and growing
# linearly). Instead each sweep takes the OLDEST-swept accounts that are past
# INTERVAL and stops at MAX_PER_RUN, so the worker hold is capped no matter how
# many accounts exist while every account still comes round about once a day:
# MAX_PER_RUN × (24 / SWEEP_HOURS) = 3000 refreshes/day of capacity.
AVATAR_REFRESH_INTERVAL_HOURS = 24   # target age of a cached avatar
AVATAR_REFRESH_SWEEP_HOURS = 2       # how often the sweep wakes up
AVATAR_REFRESH_MAX_PER_RUN = 250     # ≈4.6 min of throttled work per sweep
AVATAR_REFRESH_THROTTLE_MS = 1100    # ~1 req/sec, room for jitter

# Cadences diverged once the earnings model split lifecycle (subs) from spend
# (tx). Full subs walk is ~36 min for a 20k-sub creator, which we don't want
# to pay daily — lifecycle rarely moves faster than that anyway. Transactions
# carry the day-to-day freshness and are cheap to delta-walk.
#
# The subs refresh is what keeps canonical total_spent accurate; between runs,
# earnings_model layers tx on top. See EARNINGS_MODEL.md for why 7d + 24h are
# the right cadences for the accuracy/cost tradeoff.
SUBS_REFRESH_INTERVAL_HOURS = 168   # 7 days — heavy walk, lifecycle only
TX_REFRESH_INTERVAL_HOURS   = 24    # 1 day  — legacy default, see below

# Local convergence pass over subscribers_cache.is_active. Costs ZERO platform
# requests — it only re-evaluates each row's own expired_at against the clock,
# which is why it can run 168x more often than the walk that writes those rows.
#
# It is NOT what makes "active subscribers" correct: every read derives
# liveness itself (db.SUBSCRIPTION_ACTIVE_SQL) and is exact whether or not this
# job has ever run. Its job is to stop the is_active=1 index bucket silently
# filling with lapsed rows between the 7-day walks, which is what keeps the hot
# subscriber query an index seek. An hour of drift in that bucket is invisible;
# a week of it is measurable.
SUBS_ACTIVITY_SWEEP_HOURS = 1
# One pass is bounded so a long-neglected cache can't hold a heavy worker: the
# remainder is picked up next hour, and the steady state is far below this
# (a 3M-row cache drifts ~21k rows per week ≈ 125/hour).
SUBS_ACTIVITY_MAX_PER_RUN = 100_000

# Transactions are the ledger that links spend → fans → campaigns, so they're
# what makes tracking-link spending "live". For active (polling-enabled)
# accounts we delta-walk them every few minutes instead of daily so the
# campaigns/earnings JOIN reflects new tips/PPV quickly. A delta walk is cheap
# (typically 1–2 pages) but it IS the only real OF call in this loop, so the
# floor stays at 5 min to avoid OF rate-limit pressure.
TX_REFRESH_FAST_MINUTES = 10        # active-account spend freshness
TX_REFRESH_MIN_MINUTES  = 5         # hard floor — never poll OF faster than this

# Accounts with polling switched OFF still need their transactions cache kept
# warm, because the panel earnings summary now sums that cache instead of
# asking OF once per account. Without this they would silently under-report.
# They get a much slower cadence than active accounts: nobody is watching them
# live, and at 600 connected accounts the difference between 10 minutes and 6
# hours is the difference between ~1 upstream walk/second and ~1 per 36s.
TX_REFRESH_IDLE_MINUTES = int(os.environ.get('TX_REFRESH_IDLE_MINUTES', 360))

# Fansly accounts reuse the tx_refresh / subs_refresh job ids, but the job body
# is fansly_sync.run_fansly_scheduled_refresh (wallet-ledger delta + wallet
# snapshot incl. the on-hold amount) and the roster walk. They run whatever
# the account's polling state, because the dashboard summary reads these caches
# for every account. Cadence:
#   * polling on, but the Fansly poller is not running (flag off) → FAST —
#     the job is the only thing keeping the ledger live;
#   * poller running → IDLE — the poll cycle already delta-syncs the ledger and
#     stamps the balance; the job adds the pending figure and a safety net;
#   * polling off → IDLE.
# A refresh is ~3 Fansly GETs (ledger page, /account/me, /wallets/earnings).
FANSLY_REFRESH_FAST_MINUTES = int(os.environ.get('FANSLY_REFRESH_FAST_MINUTES', 10))
FANSLY_REFRESH_IDLE_MINUTES = int(os.environ.get('FANSLY_REFRESH_IDLE_MINUTES', 60))
# The Fansly roster is a full walk (~2 GETs per 100 subscribers — there is no
# proven recency order to delta against), and it is what the dashboard's New
# Subs count reads, so it runs far more often than OF's 7-day walk.
FANSLY_SUBS_REFRESH_HOURS = int(os.environ.get('FANSLY_SUBS_REFRESH_HOURS', 2))

# When an account has a tracked-campaigns allowlist (e.g. ["somecreator"]), the
# claimer walk is tiny (one small campaign), so we can refresh it every few
# minutes — that's what makes the new-subscriber chime in the dashboard fire
# promptly. Without an allowlist the walk could be huge, so it stays on the
# heavy 7-day cadence (SUBS_REFRESH_INTERVAL_HOURS).
CAMPAIGNS_FAST_MINUTES = 5

# ---- executor sizing ------------------------------------------------------
#
# Every job here is I/O-bound: it spends ~all its wall-clock waiting on an OF
# HTTP round-trip, not on CPU. So the pool has to be sized against *concurrent
# in-flight requests*, not against core count. Measured on this box, one poll
# cycle costs ~3.8s (notifications ~3.0s + balances ~0.8s), which makes the
# steady-state thread demand:
#
#     threads ≈ (accounts / POLL_INTERVAL) * poll_cost
#             + (accounts / TX_REFRESH)    * tx_cost
#             ≈ accounts / 26
#
# APScheduler's default pool is 10 workers. That covers ~200 accounts and then
# falls off a cliff: at 500 accounts demand is ~18 threads, jobs queue past
# their misfire grace, and APScheduler DROPS them — silently, which shows up as
# "some accounts just stopped updating" rather than as an error.
#
# Idle threads are nearly free (a stack allocation, no CPU), so we size with
# real headroom rather than trying to run hot. FAST_WORKERS=64 carries ~1600
# accounts of poll demand.
SCHEDULER_FAST_WORKERS = int(os.environ.get('SCHEDULER_FAST_WORKERS', 64))

# Heavy jobs get their OWN pool. A full subscriber walk is ~36min for a 20k-sub
# creator; a handful of those landing together would occupy the whole shared
# pool and starve every 2-minute poll behind them for half an hour. Isolating
# them means a slow backfill can never stall live event polling.
SCHEDULER_HEAVY_WORKERS = int(os.environ.get('SCHEDULER_HEAVY_WORKERS', 12))

# Threads-per-account used to warn when the configured pool can no longer cover
# the registered account count (see _check_capacity).
ACCOUNTS_PER_FAST_WORKER = 26

# Misfire grace. APScheduler discards a run that can't start within this many
# seconds of its scheduled time. The old value (60s) was shorter than a single
# poll cycle under load, so a momentarily busy pool meant dropped polls and
# gaps in the data. Every job here is idempotent and cursor-based, so running
# late is always better than not running: grace is now generous, and `coalesce`
# still collapses a backlog into one run instead of replaying each missed slot.
POLL_MISFIRE_GRACE_SECONDS = int(os.environ.get('POLL_MISFIRE_GRACE_SECONDS', 900))
REFRESH_MISFIRE_GRACE_SECONDS = int(os.environ.get('REFRESH_MISFIRE_GRACE_SECONDS', 3600))

# Rolling counters so starvation is observable instead of inferred. Surfaced by
# stats() and the admin health endpoint.
_job_stats = {
    'executed': 0,
    'missed': 0,
    'errored': 0,
    'max_instances_hit': 0,
    'last_missed_job': None,
    'last_missed_at': None,
    'last_error_job': None,
    'last_error_at': None,
}
_job_stats_lock = threading.Lock()


def _on_job_event(event):
    """Track job outcomes so a saturated pool is visible, not silent.

    A `missed` event is the signature of executor starvation: the run was due
    but no worker was free within its misfire grace, so APScheduler dropped it.
    `max_instances` means the previous run of that same job was still going."""
    with _job_stats_lock:
        if event.code == EVENT_JOB_MISSED:
            _job_stats['missed'] += 1
            _job_stats['last_missed_job'] = event.job_id
            _job_stats['last_missed_at'] = _dt.now().isoformat()
            logger.warning(
                "Job %s MISSED its run window (executor saturated or process "
                "paused). missed_total=%d — consider raising SCHEDULER_FAST_WORKERS.",
                event.job_id, _job_stats['missed'])
        elif event.code == EVENT_JOB_ERROR:
            _job_stats['errored'] += 1
            _job_stats['last_error_job'] = event.job_id
            _job_stats['last_error_at'] = _dt.now().isoformat()
            logger.error("Job %s raised: %s", event.job_id, event.exception)
        elif event.code == EVENT_JOB_MAX_INSTANCES:
            _job_stats['max_instances_hit'] += 1
            logger.warning(
                "Job %s skipped: previous run still in flight (run is taking "
                "longer than its interval). max_instances_total=%d",
                event.job_id, _job_stats['max_instances_hit'])
        else:
            _job_stats['executed'] += 1


def _desired_job_policy(job_id: str, job=None):
    """(executor, misfire_grace_time) a job of this kind should be running with.

    Returns (None, None) for kinds we don't manage (one-shots)."""
    kind = str(job_id).split(':', 1)[0]
    if kind == 'account':
        # Grace scales with THIS account's poll interval, read off its own
        # trigger so a 10-minute-interval account isn't held to a 2-minute one.
        interval = 0
        try:
            iv = getattr(getattr(job, 'trigger', None), 'interval', None)
            interval = int(iv.total_seconds()) if iv is not None else 0
        except Exception:
            interval = 0
        return 'default', max(POLL_MISFIRE_GRACE_SECONDS, interval * 3)
    if kind == 'tx_refresh':
        return 'default', REFRESH_MISFIRE_GRACE_SECONDS
    if kind == 'subs_refresh':
        return 'heavy', REFRESH_MISFIRE_GRACE_SECONDS
    if kind == 'campaigns_refresh':
        # Fast cadence (allowlisted) belongs on the fast pool; the 7-day full
        # walk does not. Infer from the interval rather than re-reading the DB.
        return None, REFRESH_MISFIRE_GRACE_SECONDS
    if kind == AVATAR_REFRESH_JOB_ID or kind == EXPORT_CLEANUP_JOB_ID:
        return 'heavy', 3600
    if kind == SUBS_ACTIVITY_JOB_ID:
        return 'heavy', SUBS_ACTIVITY_SWEEP_HOURS * 3600
    if kind == WEBHOOK_RETRY_JOB_ID:
        return 'default', 30
    if kind == TELEGRAM_INTAKE_JOB_ID:
        return 'default', 30
    if kind == METRICS_FLUSH_JOB_ID:
        return 'default', max(30, METRICS_FLUSH_SECONDS * 2)
    if kind == METRICS_SWEEP_JOB_ID:
        return 'heavy', 3600
    if kind == ERROR_LOG_SWEEP_JOB_ID:
        # Same cadence and pool as the metrics sweep: bounded deletes, deadline
        # measured in days, so being hours late costs nothing.
        return 'heavy', 3600
    if kind == IMPORT_2FA_SWEEP_JOB_ID:
        # Two indexed UPDATEs. Fast pool: it must stay punctual (the UI counts
        # down from what it writes) and it can never be slow.
        return 'default', max(30, IMPORT_2FA_SWEEP_SECONDS * 2)
    if kind == TWO_FA_SWEEP_JOB_ID:
        # One indexed DELETE, no urgency — but it MUST be listed here. A job
        # missing from this table is invisible to migrate_job_policies(), and
        # jobs restored from the persistent jobstore keep whatever executor and
        # grace they were first registered with. That is the exact failure this
        # table was added to fix (50e96d6): a policy change would then apply to
        # new deployments only, silently.
        return 'heavy', 600
    return None, None


def migrate_job_policies() -> int:
    """Bring already-persisted jobs onto the current executor/grace policy.

    Jobs live in a SQLAlchemy jobstore and survive restarts, and reconcile only
    creates jobs that are MISSING — so without this, every account registered
    before this change would keep running on the old single pool with the old
    60s grace forever, and the fix would silently apply to new accounts only.
    Returns the number of jobs updated."""
    if not _scheduler:
        return 0
    updated = 0
    for job in _scheduler.get_jobs():
        want_ex, want_grace = _desired_job_policy(job.id, job)
        if want_ex is None and want_grace is None:
            continue
        changes = {}
        if want_ex is not None and job.executor != want_ex:
            changes['executor'] = want_ex
        if want_grace is not None and job.misfire_grace_time != want_grace:
            changes['misfire_grace_time'] = want_grace
        # campaigns_refresh: pool depends on cadence, which we read off the trigger.
        if str(job.id).startswith('campaigns_refresh:'):
            try:
                iv = getattr(job.trigger, 'interval', None)
                fast = iv is not None and iv.total_seconds() <= CAMPAIGNS_FAST_MINUTES * 60
                want = 'default' if fast else 'heavy'
                if job.executor != want:
                    changes['executor'] = want
            except Exception:
                pass
        if not changes:
            continue
        try:
            _scheduler.modify_job(job.id, **changes)
            updated += 1
            logger.info("Migrated job policy %s -> %s", job.id, changes)
        except Exception:
            logger.exception("could not migrate job policy for %s", job.id)
    if updated:
        logger.info("Migrated %d pre-existing job(s) onto the current pool/grace policy", updated)
    return updated


def _check_capacity() -> dict:
    """Compare registered account load against configured pool size.

    Called after reconcile so an operator sees the problem at startup rather
    than discovering it as missing data days later."""
    try:
        accounts = len(db.list_pollable_accounts())
    except Exception:
        return {}
    supported = SCHEDULER_FAST_WORKERS * ACCOUNTS_PER_FAST_WORKER
    info = {
        'pollable_accounts': accounts,
        'fast_workers': SCHEDULER_FAST_WORKERS,
        'heavy_workers': SCHEDULER_HEAVY_WORKERS,
        'supported_accounts': supported,
        'saturated': accounts > supported,
    }
    if info['saturated']:
        needed = -(-accounts // ACCOUNTS_PER_FAST_WORKER)  # ceil
        logger.error(
            "Scheduler UNDER-PROVISIONED: %d polling accounts need ~%d fast "
            "workers but only %d are configured. Polls will be dropped. "
            "Set SCHEDULER_FAST_WORKERS=%d (or higher) and restart.",
            accounts, needed, SCHEDULER_FAST_WORKERS, needed)
    else:
        logger.info(
            "Scheduler capacity OK: %d polling accounts / ~%d supported "
            "(fast=%d, heavy=%d workers)",
            accounts, supported, SCHEDULER_FAST_WORKERS, SCHEDULER_HEAVY_WORKERS)
    return info


def stats() -> dict:
    """Scheduler health snapshot — pool saturation + job outcome counters."""
    with _job_stats_lock:
        counters = dict(_job_stats)
    out = {'running': is_running(), **counters}
    if _scheduler is None:
        return out
    try:
        jobs = _scheduler.get_jobs()
        by_kind: dict[str, int] = {}
        for j in jobs:
            by_kind[str(j.id).split(':', 1)[0]] = by_kind.get(str(j.id).split(':', 1)[0], 0) + 1
        out['jobs_total'] = len(jobs)
        out['jobs_by_kind'] = by_kind
    except Exception:
        pass
    for name in ('default', 'heavy'):
        try:
            ex = _scheduler._lookup_executor(name)
            pool = getattr(ex, '_pool', None)
            out[f'{name}_max_workers'] = getattr(pool, '_max_workers', None)
            # Threads actually spawned so far — a proxy for peak concurrency.
            out[f'{name}_threads_live'] = len(getattr(pool, '_threads', ()) or ())
        except Exception:
            pass
    out.update(_check_capacity())
    return out


def _account_job_id(crm_id: str, of_user_id: str) -> str:
    return f"account:{crm_id}:{of_user_id}"


def _subs_refresh_job_id(crm_id: str, of_user_id: str) -> str:
    return f"subs_refresh:{crm_id}:{of_user_id}"


def _tx_refresh_job_id(crm_id: str, of_user_id: str) -> str:
    return f"tx_refresh:{crm_id}:{of_user_id}"


def _campaigns_refresh_job_id(crm_id: str, of_user_id: str) -> str:
    return f"campaigns_refresh:{crm_id}:{of_user_id}"


def _run_poll(crm_id: str, of_user_id: str):
    # DEBUG, not INFO: this fires once per account per interval, so at 500
    # accounts on a 2min cadence it is ~250 lines/min of pure noise. Poll
    # outcomes that matter (failures, pauses) are logged by the poller itself.
    if not runtime_readiness.signed_jobs_ready():
        logger.error("Signed-job circuit breaker open; skipped poll for %s/%s",
                     crm_id, of_user_id)
        return
    logger.debug("Polling account %s/%s", crm_id, of_user_id)
    poller.poll_account(crm_id, of_user_id)


def _fansly_account(crm_id: str, of_user_id: str) -> dict | None:
    """The account row if it is a Fansly account, else None."""
    account = db.get_of_account(crm_id, of_user_id) or {}
    return account if (account.get('platform') or 'onlyfans') == 'fansly' else None


def _run_subs_refresh(crm_id: str, of_user_id: str):
    """Cron-triggered subs refresh. Uses the progress/SSE channel so users on
    the dashboard see the cron work happen in real time."""
    # Fansly first: the signed-job breaker guards the OnlyFans signer, which a
    # Fansly walk never touches.
    fansly = _fansly_account(crm_id, of_user_id)
    if fansly is not None:
        import fansly_sync
        if fansly.get('relogin_blocked_at') or fansly_sync._in_failure_backoff(fansly):
            logger.info("Fansly subscriber sync skipped for %s/%s (blocked/backoff)",
                        crm_id, of_user_id)
            return
        logger.info("Fansly subscriber sync %s/%s (scheduled)", crm_id, of_user_id)
        run_subs_refresh_with_progress(crm_id, of_user_id, mode='delta')
        return
    if not runtime_readiness.signed_jobs_ready():
        logger.error("Signed-job circuit breaker open; skipped subscriber sync for %s/%s",
                     crm_id, of_user_id)
        return
    logger.info("Subscriber delta-sync %s/%s (scheduled)", crm_id, of_user_id)
    run_subs_refresh_with_progress(crm_id, of_user_id, mode='delta')


def _run_tx_refresh(crm_id: str, of_user_id: str):
    """Cron-triggered tx refresh (same rationale as _run_subs_refresh)."""
    account = db.get_of_account(crm_id, of_user_id) or {}
    if (account.get('platform') or 'onlyfans') == 'fansly':
        # Wallet ledger + wallet snapshot. Dispatched before the OF signer
        # breaker and the OF transactions_unavailable backoff — neither applies
        # to Fansly (it has its own transport backoff inside).
        import fansly_sync
        fansly_sync.run_fansly_scheduled_refresh(crm_id, of_user_id)
        return
    if not runtime_readiness.signed_jobs_ready():
        logger.error("Signed-job circuit breaker open; skipped transaction sync for %s/%s",
                     crm_id, of_user_id)
        return
    if (account.get('last_connection_state') == 'temporary_error'
            and account.get('last_connection_error_code') == 'transactions_unavailable'):
        failures = max(1, int(account.get('transactions_refresh_failure_count') or 1))
        try:
            failed_at = _dt.fromisoformat(
                str(account.get('last_connection_error_at') or '').replace('Z', '+00:00')
            )
            if failed_at.tzinfo is None:
                failed_at = failed_at.replace(tzinfo=_tz.utc)
            # Ten minutes, then 20/40/80 minutes, capped at six hours. The
            # scheduler continues to wake cheaply, but it does not keep buying
            # captchas/relogins against an endpoint that a fresh session cannot
            # access. A manual operator refresh can still probe immediately.
            delay = min(6 * 3600, TX_REFRESH_FAST_MINUTES * 60 * (2 ** min(failures, 6)))
            remaining = delay - (_dt.now(_tz.utc) - failed_at).total_seconds()
            if remaining > 0:
                logger.warning(
                    "Transaction sync backoff active for %s/%s (~%ss remaining)",
                    crm_id, of_user_id, int(remaining),
                )
                return
        except (TypeError, ValueError):
            pass
    logger.info("Transaction delta-sync %s/%s (scheduled)", crm_id, of_user_id)
    run_tx_refresh_with_progress(crm_id, of_user_id, mode='delta')


def _run_campaigns_refresh(crm_id: str, of_user_id: str):
    """Cron-triggered campaigns-claimer refresh. Cadence-matches subs: the
    lifecycle data (who's subscribed via which link) only changes at
    subscribe-time, and we already get those via new_subscriber SSE events."""
    if not runtime_readiness.signed_jobs_ready():
        logger.error("Signed-job circuit breaker open; skipped campaign sync for %s/%s",
                     crm_id, of_user_id)
        return
    logger.info("Campaigns claimer sync %s/%s (scheduled)", crm_id, of_user_id)
    run_campaigns_refresh_with_progress(crm_id, of_user_id)


# ---- progress-aware entry points ----------------------------------------

# These are the ONLY things the Flask route handlers should kick off via
# run_in_background. They:
#   1. Create a refresh_state entry (phase=counting/fetching)
#   2. Run the sync with `on_progress` wired into refresh_state.record
#   3. Call refresh_state.finish with the final result
#
# Kept at module level (not inside the route handler) so APScheduler's
# SQLAlchemy jobstore can pickle them.

def run_subs_refresh_with_progress(crm_id: str, of_user_id: str,
                                    mode: str = 'delta',
                                    proxy=None) -> None:
    try:
        refresh_state.start(crm_id, of_user_id, 'subs')
        on_progress = refresh_state.make_on_progress(crm_id, of_user_id, 'subs')
        if mode == 'full':
            result = subscribers_sync.full_sync_subscribers(
                crm_id, of_user_id, proxy=proxy, on_progress=on_progress)
        else:
            result = subscribers_sync.delta_sync_subscribers(
                crm_id, of_user_id, proxy=proxy, on_progress=on_progress)
        refresh_state.finish(
            crm_id, of_user_id, 'subs',
            success=bool(result.get('success')),
            pages_done=result.get('pages_fetched'),
            rows_inserted=result.get('rows_inserted'),
            rows_updated=result.get('rows_updated'),
            stopped_reason=('caught_up' if result.get('stopped_at_known') else
                            ('no_more' if result.get('success') else 'error')),
            error=result.get('error'),
        )
    except Exception as e:
        logger.exception("run_subs_refresh_with_progress failed %s/%s", crm_id, of_user_id)
        refresh_state.finish(crm_id, of_user_id, 'subs', success=False,
                             stopped_reason='error', error=str(e))


def run_campaigns_refresh_with_progress(crm_id: str, of_user_id: str, proxy=None) -> None:
    try:
        refresh_state.start(crm_id, of_user_id, 'campaigns')
        on_progress = refresh_state.make_on_progress(crm_id, of_user_id, 'campaigns')
        # Honour the per-account tracked-campaign allowlist if set (e.g.
        # ["somecreator"]) so scheduled/backfill runs walk only those links and
        # never a 20k-sub one. No allowlist → campaigns_sync applies its
        # subscriber-count cap instead.
        only_names = db.get_tracked_campaigns(crm_id, of_user_id)
        result = campaigns_sync.sync_all_campaigns_claimers(
            crm_id, of_user_id, proxy=proxy, on_progress=on_progress,
            only_names=only_names)
        refresh_state.finish(
            crm_id, of_user_id, 'campaigns',
            success=bool(result.get('success')),
            pages_done=result.get('pages_fetched'),
            rows_inserted=result.get('rows_inserted'),
            rows_updated=result.get('rows_updated'),
            stopped_reason=('no_more' if result.get('success') else 'error'),
            error=result.get('error'),
        )
    except Exception as e:
        logger.exception("run_campaigns_refresh_with_progress failed %s/%s", crm_id, of_user_id)
        refresh_state.finish(crm_id, of_user_id, 'campaigns', success=False,
                             stopped_reason='error', error=str(e))


def run_tx_refresh_with_progress(crm_id: str, of_user_id: str,
                                  mode: str = 'delta',
                                  proxy=None,
                                  days: int = transactions_sync.INITIAL_WINDOW_DAYS,
                                  max_pages: int = transactions_sync.INITIAL_MAX_PAGES) -> None:
    # transactions_sync walks /api2/v2 through of_client — guaranteed to fail
    # for a Fansly account. Route to the wallet walker instead.
    if _fansly_account(crm_id, of_user_id) is not None:
        import fansly_sync
        fansly_sync.run_fansly_tx_refresh_with_progress(
            crm_id, of_user_id,
            mode=('initial' if mode == 'initial' else 'delta'), proxy=proxy)
        return
    try:
        refresh_state.start(crm_id, of_user_id, 'tx')
        on_progress = refresh_state.make_on_progress(crm_id, of_user_id, 'tx')
        if mode == 'initial':
            result = transactions_sync.initial_sync_transactions(
                crm_id, of_user_id, proxy=proxy,
                days=days, max_pages=max_pages,
                on_progress=on_progress)
        else:
            result = transactions_sync.delta_sync_transactions(
                crm_id, of_user_id, proxy=proxy,
                initial_days=days, initial_max_pages=max_pages,
                on_progress=on_progress)
        refresh_state.finish(
            crm_id, of_user_id, 'tx',
            success=bool(result.get('success')),
            pages_done=result.get('pages_fetched'),
            rows_inserted=result.get('rows_inserted'),
            rows_updated=result.get('rows_updated'),
            stopped_reason=result.get('stopped_reason'),
            error=result.get('error'),
        )
    except Exception as e:
        logger.exception("run_tx_refresh_with_progress failed %s/%s", crm_id, of_user_id)
        refresh_state.finish(crm_id, of_user_id, 'tx', success=False,
                             stopped_reason='error', error=str(e))


def run_backfill_with_progress(crm_id: str, of_user_id: str,
                                proxy=None, days: int = 7) -> None:
    """One-shot "catch up the last N days" backfill, run when an account is
    connected / polling is first enabled, so tracking-link spending shows up
    immediately instead of trickling in over the next scheduled cycles.

    Runs three syncs in sequence (each reuses its own progress/SSE channel):
      1. transactions (initial, bounded to `days`) — the spend ledger
      2. subscribers (delta)                       — canonical total_spent
      3. campaigns claimers                        — fills campaign_claimers_cache

    Order matters: the campaigns/earnings JOIN needs BOTH the claimer rows and
    the subscriber spend rows, so we populate those before the UI reads them.
    Each step is isolated — a failure in one is logged and does not abort the
    rest, so a partial backfill still surfaces whatever data it got.

    Module-level (not a closure) so APScheduler's SQLAlchemy jobstore can
    pickle it when dispatched via run_in_background.
    """
    logger.info("Backfill start %s/%s (last %sd)", crm_id, of_user_id, days)
    try:
        run_tx_refresh_with_progress(
            crm_id, of_user_id, mode='initial', proxy=proxy,
            days=int(days), max_pages=transactions_sync.INITIAL_MAX_PAGES)
    except Exception:
        logger.exception("backfill: tx step failed %s/%s", crm_id, of_user_id)
    try:
        run_subs_refresh_with_progress(crm_id, of_user_id, mode='delta', proxy=proxy)
    except Exception:
        logger.exception("backfill: subs step failed %s/%s", crm_id, of_user_id)
    try:
        run_campaigns_refresh_with_progress(crm_id, of_user_id, proxy=proxy)
    except Exception:
        logger.exception("backfill: campaigns step failed %s/%s", crm_id, of_user_id)
    logger.info("Backfill done %s/%s", crm_id, of_user_id)


def _run_webhook_retry():
    try:
        webhook_delivery.deliver_due()
    except Exception:
        logger.exception("webhook retry worker failed")


def _run_telegram_intake():
    """Consume Telegram updates so `/start <code>` deep links resolve.

    THIS JOB IS THE SINGLE CONSUMER of the shared bot's update stream — see the
    module docstring in telegram_updates.py for why one process (gunicorn
    workers=1, enforced) plus max_instances=1 is what makes that true. Do not
    add a second caller of telegram_updates.poll_token for the shared token.
    """
    try:
        import telegram_updates
        telegram_updates.drain()
    except Exception:
        logger.exception("telegram intake worker failed")


def _run_export_cleanup():
    """Periodic sweep of expired data-export archives. Module-level so the
    SQLAlchemy jobstore can pickle it."""
    try:
        import export_runner
        export_runner.cleanup_expired()
    except Exception:
        logger.exception("export cleanup worker failed")


def _run_import_2fa_sweep():
    """Expire parked bulk-import 2FA rows and destroy aged-out credentials.
    Module-level so the SQLAlchemy jobstore can pickle it. Purely local — no
    platform calls, so it costs no quota and touches no session."""
    try:
        import import_runner
        import_runner.sweep_pending_2fa()
    except Exception:
        logger.exception("import 2FA sweep failed")


def _run_metrics_flush():
    """Persist the in-process request-outcome counters. Module-level so the
    SQLAlchemy jobstore can pickle it. Purely local — no platform calls."""
    try:
        import api_metrics
        api_metrics.flush()
    except Exception:
        logger.exception("api metrics flush failed")


def _run_metrics_sweep():
    """Bounded retention for api_request_metrics. Module-level for pickling."""
    try:
        import api_metrics
        api_metrics.sweep()
    except Exception:
        logger.exception("api metrics retention sweep failed")


def _run_error_log_sweep():
    """Bounded retention for api_error_log. Module-level for pickling."""
    try:
        import api_errors
        removed = api_errors.sweep()
        if removed:
            logger.info("api error log sweep removed %d rows", removed)
    except Exception:
        logger.exception("api error log retention sweep failed")


def _run_two_fa_sweep():
    """Drop 2FA challenges past config.TWO_FA_SESSION_EXPIRY. Module-level so
    the SQLAlchemy jobstore can pickle it. Purely local — no platform calls."""
    try:
        deleted = db.sweep_expired_2fa_sessions()
        if deleted:
            logger.info("2FA sweep: dropped %s expired pending challenge(s)", deleted)
    except Exception:
        logger.exception("2FA session sweep failed")


def _run_subs_activity_sweep():
    """Converge subscribers_cache.is_active onto the derived truth. Module-level
    so the SQLAlchemy jobstore can pickle it. Purely local — no OF/Fansly calls,
    so it never touches an account's quota or session."""
    try:
        changed = db.recompute_subscriber_activity(max_rows=SUBS_ACTIVITY_MAX_PER_RUN)
        if changed:
            logger.info("subs activity sweep: %s cached subscriber(s) crossed "
                        "their expiry since the last pass", changed)
    except Exception:
        logger.exception("subs activity sweep failed")


def _fetch_profile_fields(crm_id, of_user_id, platform, proxy):
    """One profile fetch for the avatar sweep → (ok, avatar, about, detail).

    Split per platform because the two clients share no transport: a Fansly
    account has no OF session at all, so pointing `/api2/v2/users/me` at one
    can only ever 404 ("No session found") — which is exactly what the sweep
    used to do, once a day, for every Fansly account on the panel.

    `detail` is a short human-readable reason on failure; the caller logs it so
    a dead proxy or an expired session is visible in the logs instead of just
    incrementing a counter.
    """
    if platform == 'fansly':
        import fansly_data
        # Same call the dashboard's profile view makes; the normalized body
        # carries a freshly-signed CDN avatar URL.
        status, body = fansly_data.fetch(crm_id, of_user_id, 'profile', {}, proxy=proxy)
        if status != 200 or not isinstance(body, dict):
            detail = (body or {}).get('error') if isinstance(body, dict) else None
            return False, None, None, (detail or f'HTTP {status}')
        profile = body.get('profile') or {}
        return True, profile.get('avatar'), profile.get('about'), None

    import of_client
    ok, data, status_code, _relogin = of_client.handle_of_request(
        crm_id, of_user_id, '/api2/v2/users/me', method='GET', proxy=proxy,
    )
    if not ok or status_code != 200 or not isinstance(data, dict):
        detail = data.get('error') if isinstance(data, dict) else None
        return False, None, None, (detail or f'HTTP {status_code}')
    return True, data.get('avatar'), data.get('about'), None
def _run_account_purge():
    """Hard-delete the cached data of accounts whose retention window has run
    out. Module-level so the SQLAlchemy jobstore can pickle it.

    One tombstone at a time with its own transaction: a tenant with a big
    subscriber/transaction history can be a lot of rows, and we'd rather sweep
    nine accounts and log the tenth's failure than roll the whole pass back.
    """
    swept = 0
    if config.ACCOUNT_ORPHAN_ADOPTION:
        # Pick up data stranded by deletes that predate the tombstone. They get
        # the full retention window from here, not immediate deletion.
        try:
            adopted = db.adopt_orphaned_accounts()
            if adopted:
                logger.info("Adopted %s orphaned account(s) into the retention "
                            "flow (pre-tombstone leftovers)", adopted)
        except Exception:
            logger.exception("orphan adoption failed")
    try:
        due = db.list_due_account_purges()
    except Exception:
        logger.exception("account purge worker could not list due purges")
        return 0
    for row in due:
        try:
            counts = db.purge_account_data(row['crm_id'], row['of_user_id'])
            swept += 1
            logger.info("Purged data for %s/%s (disconnected %s): %s",
                        row['crm_id'], row['of_user_id'],
                        row['disconnected_at'], counts or 'nothing left')
        except Exception:
            # Leave the tombstone in place — the next pass retries it.
            logger.exception("account purge failed for %s/%s",
                             row['crm_id'], row['of_user_id'])
    return swept


def _run_avatar_refresh():
    """
    Rolling refresh of avatar + about across ALL connected accounts.

    Picks the AVATAR_REFRESH_MAX_PER_RUN least-recently-swept accounts that are
    past AVATAR_REFRESH_INTERVAL_HOURS and refreshes those, oldest first. Two
    reasons for the bounded queue rather than "select everything":

      - polling_enabled is not a proxy for "wants a working avatar". The old
        filter meant an account with polling off kept its expired CDN URL
        forever, i.e. a permanently broken profile picture in the dashboard.
      - the sweep runs on the `heavy` pool and sleeps THROTTLE_MS between
        accounts, so an unbounded pass would hold a worker for accounts × 1.1s.
        The cap keeps that near-constant as the panel grows.

    `last_avatar_refresh_at` is stamped on every ATTEMPT, not just on success.
    Stamping only successes would park a permanently-failing account (dead
    session, dead proxy) at the head of the oldest-first queue and let it eat
    the same slot in every sweep, starving healthy accounts behind it.

    Failures per account are logged with their reason but never abort the job.
    """
    import sqlite3
    import time

    # Same format db.iso_utc_now() writes, so the SQL `<` is a valid string compare.
    cutoff = (_dt.now(_tz.utc) - _td(hours=AVATAR_REFRESH_INTERVAL_HOURS)).strftime(
        '%Y-%m-%dT%H:%M:%S+00:00')

    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT a.id, a.of_user_id, a.avatar, a.about, a.proxy,
                   COALESCE(a.platform, 'onlyfans') AS platform, p.crm_id
            FROM of_accounts a
            JOIN crm_panels p ON a.crm_panel_id = p.id
            WHERE a.last_avatar_refresh_at IS NULL
               OR a.last_avatar_refresh_at < ?
            ORDER BY a.last_avatar_refresh_at ASC   -- SQLite sorts NULL (never swept) first
            LIMIT ?
        ''', (cutoff, AVATAR_REFRESH_MAX_PER_RUN))
        rows = cursor.fetchall()
    finally:
        conn.close()

    logger.info("avatar_refresh: sweeping %d due accounts (cap %d)",
                len(rows), AVATAR_REFRESH_MAX_PER_RUN)
    updated = 0
    failed = 0

    for row in rows:
        crm_id = row['crm_id']
        of_user_id = row['of_user_id']
        new_avatar = new_about = None
        try:
            ok, new_avatar, new_about, detail = _fetch_profile_fields(
                crm_id, of_user_id, row['platform'], row['proxy'])
            if not ok:
                failed += 1
                logger.warning("avatar_refresh: %s/%s (%s) failed — %s",
                               crm_id, of_user_id, row['platform'], detail)
            # Count what the COALESCE below will actually change: a platform
            # that answers with a null avatar leaves the row as it was.
            elif ((new_avatar is not None and new_avatar != row['avatar'])
                    or (new_about is not None and new_about != row['about'])):
                updated += 1
        except Exception:
            logger.exception("avatar_refresh failed for %s/%s", crm_id, of_user_id)
            failed += 1

        # One write per account either way: COALESCE means a failed fetch keeps
        # the old values, and the stamp has to land regardless so the queue
        # advances. A single tiny local write is nothing next to the HTTP call
        # we just paid for.
        conn = sqlite3.connect(db.DB_FILE)
        try:
            conn.execute(
                'UPDATE of_accounts SET avatar = COALESCE(?, avatar), '
                'about = COALESCE(?, about), last_avatar_refresh_at = ? WHERE id = ?',
                (new_avatar, new_about, db.iso_utc_now(), row['id']),
            )
            conn.commit()
        finally:
            conn.close()

        # Throttle to keep average load under ~1 req/sec.
        time.sleep(AVATAR_REFRESH_THROTTLE_MS / 1000.0)

    logger.info("avatar_refresh: done — swept=%d updated=%d failed=%d",
                len(rows), updated, failed)


def get_scheduler() -> BackgroundScheduler | None:
    return _scheduler


def is_running() -> bool:
    return _scheduler is not None and _scheduler.running


def start():
    """Start the scheduler exactly once per process. Safe to call repeatedly."""
    global _scheduler

    # Skip in Flask reloader parent — only the child has WERKZEUG_RUN_MAIN=true
    if os.environ.get("WERKZEUG_RUN_MAIN") == "false":
        return

    with _lock:
        if _scheduler is not None:
            return
        # 30s busy-timeout so a contended jobstore write WAITS for the lock
        # instead of raising "database is locked" (the DB is WAL mode + shared
        # with the API; see crm_database.init_database). Pairs with WAL, which
        # already stops readers from blocking these writes.
        jobstores = {'default': SQLAlchemyJobStore(
            url=JOBSTORE_URL,
            engine_options={'connect_args': {'timeout': 30}},
        )}
        # Two pools, so a slow walk can never starve a fast poll. Jobs pick
        # their pool via executor='default' (fast) or executor='heavy'.
        executors = {
            'default': ThreadPoolExecutor(max_workers=SCHEDULER_FAST_WORKERS),
            'heavy': ThreadPoolExecutor(max_workers=SCHEDULER_HEAVY_WORKERS),
        }
        scheduler = BackgroundScheduler(
            jobstores=jobstores,
            executors=executors,
            job_defaults={'coalesce': True, 'max_instances': 1,
                          'misfire_grace_time': POLL_MISFIRE_GRACE_SECONDS},
        )
        scheduler.add_listener(
            _on_job_event,
            EVENT_JOB_EXECUTED | EVENT_JOB_ERROR | EVENT_JOB_MISSED | EVENT_JOB_MAX_INSTANCES,
        )
        scheduler.start()
        _scheduler = scheduler
        logger.info(
            "Scheduler started (jobstore=%s, fast_workers=%d, heavy_workers=%d)",
            JOBSTORE_URL, SCHEDULER_FAST_WORKERS, SCHEDULER_HEAVY_WORKERS)

    # Webhook retry worker every 10s
    try:
        _scheduler.add_job(
            _run_webhook_retry,
            trigger='interval',
            seconds=10,
            id=WEBHOOK_RETRY_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='default',  # short DB scan + a few POSTs
            # On a 10s cadence a missed tick is genuinely disposable — the next
            # one picks up the same due deliveries. Keep the grace tight so we
            # don't queue a pile of redundant sweeps after a pause.
            misfire_grace_time=30,
        )
    except Exception:
        logger.exception("could not register webhook retry job")

    # Telegram update intake. Short poll (getUpdates timeout=0), so one run is a
    # single round-trip rather than a parked thread; max_instances=1 from
    # job_defaults keeps it the only in-flight consumer. The body no-ops when no
    # shared bot is configured and no pairing is open, so this costs one indexed
    # SELECT per tick on a deployment that doesn't use the feature.
    try:
        _scheduler.add_job(
            _run_telegram_intake,
            trigger='interval',
            seconds=max(1, int(getattr(config, 'TELEGRAM_POLL_SECONDS', 3))),
            id=TELEGRAM_INTAKE_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='default',
            # Same reasoning as the webhook retry job: on a seconds cadence a
            # missed tick is disposable, the next one drains the same updates.
            misfire_grace_time=30,
        )
    except Exception:
        logger.exception("could not register telegram intake job")

    # Rolling avatar/about sweep across every connected account (both platforms).
    try:
        _scheduler.add_job(
            _run_avatar_refresh,
            trigger='interval',
            hours=AVATAR_REFRESH_SWEEP_HOURS,
            id=AVATAR_REFRESH_JOB_ID,
            replace_existing=True,
            jobstore='default',
            # Bounded at AVATAR_REFRESH_MAX_PER_RUN accounts behind a ~1.1s
            # throttle, so one run holds a thread for ≤~5min regardless of panel
            # size. Still the heavy pool — minutes is minutes. replace_existing
            # rewrites the old 24h trigger on the next boot.
            executor='heavy',
            misfire_grace_time=3600,  # if we miss the slot, run within the hour
        )
    except Exception:
        logger.exception("could not register avatar refresh job")

    # Expired data-export sweep (every few hours).
    try:
        _scheduler.add_job(
            _run_export_cleanup,
            trigger='interval',
            hours=EXPORT_CLEANUP_INTERVAL_HOURS,
            id=EXPORT_CLEANUP_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='heavy',  # disk sweep, no urgency
            misfire_grace_time=3600,
        )
    except Exception:
        logger.exception("could not register export cleanup job")

    # Expire parked bulk-import 2FA rows (every minute).
    try:
        _scheduler.add_job(
            _run_import_2fa_sweep,
            trigger='interval',
            seconds=IMPORT_2FA_SWEEP_SECONDS,
            id=IMPORT_2FA_SWEEP_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='default',  # two indexed UPDATEs; must stay punctual
            misfire_grace_time=max(30, IMPORT_2FA_SWEEP_SECONDS * 2),
        )
    except Exception:
        logger.exception("could not register import 2FA sweep job")

    # Hard-delete cached data of accounts past their retention window.
    try:
        _scheduler.add_job(
            _run_account_purge,
            trigger='interval',
            hours=ACCOUNT_PURGE_INTERVAL_HOURS,
            id=ACCOUNT_PURGE_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='heavy',  # can be a lot of DELETEs, no urgency
            misfire_grace_time=3600,
        )
    except Exception:
        logger.exception("could not register account purge job")

    # Keep the cached is_active flag from drifting a week behind the clock.
    try:
        _scheduler.add_job(
            _run_subs_activity_sweep,
            trigger='interval',
            hours=SUBS_ACTIVITY_SWEEP_HOURS,
            id=SUBS_ACTIVITY_JOB_ID,
            replace_existing=True,
            jobstore='default',
            # Heavy pool: it's a table scan for candidates, and nothing waits on
            # it — reads are already correct without it. Grace of one full
            # interval because a skipped pass is harmless, and coalesce (from
            # job_defaults) means a long pause doesn't queue a pile of them.
            executor='heavy',
            misfire_grace_time=SUBS_ACTIVITY_SWEEP_HOURS * 3600,
        )
    except Exception:
        logger.exception("could not register subscriber activity sweep job")

    # Persist request-outcome counters accumulated in-process since the last tick.
    try:
        _scheduler.add_job(
            _run_metrics_flush,
            trigger='interval',
            seconds=METRICS_FLUSH_SECONDS,
            id=METRICS_FLUSH_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='default',  # one small executemany, milliseconds
            # A missed tick is disposable: the counters stay in the accumulator
            # and the next flush writes them. Tight grace so a pause doesn't
            # queue a pile of redundant no-op flushes.
            misfire_grace_time=max(30, METRICS_FLUSH_SECONDS * 2),
        )
    except Exception:
        logger.exception("could not register api metrics flush job")

    # Keep api_request_metrics bounded — it is the one table that grows purely
    # with request volume.
    try:
        _scheduler.add_job(
            _run_metrics_sweep,
            trigger='interval',
            hours=METRICS_SWEEP_INTERVAL_HOURS,
            id=METRICS_SWEEP_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='heavy',  # one indexed DELETE, no urgency
            misfire_grace_time=3600,
        )
    except Exception:
        logger.exception("could not register api metrics sweep job")

    # Same for api_error_log — it grows with FAILURE volume, which is spikier
    # than request volume and is exactly what a broken integration produces.
    try:
        _scheduler.add_job(
            _run_error_log_sweep,
            trigger='interval',
            hours=METRICS_SWEEP_INTERVAL_HOURS,
            id=ERROR_LOG_SWEEP_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='heavy',
            misfire_grace_time=3600,
        )
    except Exception:
        logger.exception("could not register api error log sweep job")

    # Expire parked 2FA challenges. Short cadence: the rows are short-lived by
    # definition and each one holds an encrypted password.
    try:
        _scheduler.add_job(
            _run_two_fa_sweep,
            trigger='interval',
            minutes=TWO_FA_SWEEP_MINUTES,
            id=TWO_FA_SWEEP_JOB_ID,
            replace_existing=True,
            jobstore='default',
            executor='heavy',  # one indexed DELETE, no urgency
            misfire_grace_time=600,
        )
    except Exception:
        logger.exception("could not register 2FA session sweep job")

    # Fail any export orphaned by a restart (its one-shot job is gone).
    try:
        import export_runner
        export_runner.reconcile_stale_exports()
    except Exception:
        logger.exception("could not reconcile stale exports")

    # RESUME any bulk import orphaned by a restart. Deliberately different from
    # the export line above: an export is cheap to regenerate, so a stale one is
    # simply failed. An import that got 400 of 600 accounts connected is neither
    # cheap nor discardable — it is half-applied, so it gets picked back up
    # exactly where it stopped.
    try:
        import import_runner
        import_runner.reconcile_stale_imports()
    except Exception:
        logger.exception("could not resume stale imports")

    # Reload all accounts that were polling before shutdown
    reconcile_accounts()

    atexit.register(shutdown)


def shutdown():
    global _scheduler
    # Stop all WS listeners first (signal their threads to exit).
    with _ws_lock:
        listeners = list(_ws_listeners.values()) + list(_fansly_ws_listeners.values())
        _ws_listeners.clear()
        _ws_threads.clear()
        _fansly_ws_listeners.clear()
        _fansly_ws_threads.clear()
    for lst in listeners:
        try:
            lst.stop()
        except Exception:
            pass
    with _lock:
        if _scheduler is not None:
            try:
                _scheduler.shutdown(wait=False)
            except Exception:
                pass
            _scheduler = None


def schedule_account(crm_id: str, of_user_id: str, interval_seconds: int):
    if not _scheduler:
        start()
    interval = max(60, int(interval_seconds))
    first_run = poller.jitter_seconds(interval)
    _scheduler.add_job(
        _run_poll,
        trigger='interval',
        seconds=interval,
        args=[crm_id, str(of_user_id)],
        id=_account_job_id(crm_id, of_user_id),
        next_run_time=None,  # wait the initial interval to avoid thundering herd
        replace_existing=True,
        jobstore='default',
        executor='default',
        # A late poll still collects everything (the cursor decides what's new),
        # so tolerate a busy pool rather than dropping the cycle outright.
        misfire_grace_time=max(POLL_MISFIRE_GRACE_SECONDS, interval * 3),
    )
    # Schedule a first run after a jittered short delay
    try:
        _scheduler.modify_job(
            _account_job_id(crm_id, of_user_id),
            next_run_time=_dt.now() + _td(seconds=first_run),
        )
    except Exception:
        pass
    logger.info("Scheduled account %s/%s every %ss (first run in %ss)",
                crm_id, of_user_id, interval, first_run)


def unschedule_account(crm_id: str, of_user_id: str):
    if _scheduler:
        for jid in (_account_job_id(crm_id, of_user_id),
                    _subs_refresh_job_id(crm_id, of_user_id),
                    _tx_refresh_job_id(crm_id, of_user_id),
                    _campaigns_refresh_job_id(crm_id, of_user_id)):
            try:
                _scheduler.remove_job(jid)
                logger.info("Unscheduled %s", jid)
            except Exception:
                pass
    # Tear down the real-time WS listeners too, if any. Both stops are cheap
    # no-ops when no listener is registered, so no platform check is needed —
    # and they run even when the scheduler itself never started.
    stop_ws_listener(crm_id, of_user_id)
    stop_fansly_ws_listener(crm_id, of_user_id)


def schedule_subs_refresh(crm_id: str, of_user_id: str,
                          interval_hours: int = SUBS_REFRESH_INTERVAL_HOURS):
    """Register the 20h background delta-sync for one account.

    First run is jittered across the next `interval_hours` window so a restart
    doesn't hammer every account in the same minute. Subsequent runs fire on
    the `interval_hours` cadence."""
    if not _scheduler:
        start()
    jid = _subs_refresh_job_id(crm_id, of_user_id)
    interval_seconds = max(3600, int(interval_hours) * 3600)
    first_run = poller.jitter_seconds(interval_seconds)
    _scheduler.add_job(
        _run_subs_refresh,
        trigger='interval',
        seconds=interval_seconds,
        args=[crm_id, str(of_user_id)],
        id=jid,
        next_run_time=None,
        replace_existing=True,
        jobstore='default',
        executor='heavy',  # full walk — must not occupy the poll pool
        misfire_grace_time=REFRESH_MISFIRE_GRACE_SECONDS,
    )
    try:
        _scheduler.modify_job(jid, next_run_time=_dt.now() + _td(seconds=first_run))
    except Exception:
        pass
    logger.info("Scheduled subs-refresh %s every %sh (first run in ~%ss)",
                jid, interval_hours, first_run)


def trigger_subs_refresh_now(crm_id: str, of_user_id: str):
    """Kick the next firing of the subs-refresh job to run immediately.

    If no job is registered yet (e.g. polling not enabled), register one first
    so subsequent 20h cadence runs without the user having to toggle polling."""
    if not _scheduler:
        start()
    jid = _subs_refresh_job_id(crm_id, of_user_id)
    if not _scheduler.get_job(jid):
        schedule_subs_refresh(crm_id, of_user_id)
    try:
        _scheduler.modify_job(jid, next_run_time=_dt.now())
        logger.info("Forced immediate run for %s", jid)
        return True
    except Exception:
        logger.exception("Could not force immediate run for %s", jid)
        return False


def schedule_tx_refresh(crm_id: str, of_user_id: str,
                         interval_minutes: int = TX_REFRESH_FAST_MINUTES,
                         first_run_seconds: int | None = None):
    """Register the background transaction delta-sync for one account.

    Runs every `interval_minutes` (default = TX_REFRESH_FAST_MINUTES) so
    tracking-link spending stays fresh — the campaigns/earnings JOIN picks up
    new tips/PPV within minutes. Floored at TX_REFRESH_MIN_MINUTES to stay
    within OF rate limits (a delta walk is the only real OF call here).

    First sync is bounded (see transactions_sync.INITIAL_WINDOW_DAYS / MAX_PAGES)
    so we never run an unbounded backfill against a multi-million-tx creator.

    `first_run_seconds` overrides when the first run happens. Default is a
    jitter across the whole interval, which is right for a steady cadence but
    wrong for an account that has never synced at all — on the 6h idle cadence
    that would leave it reporting zero earnings for up to six hours."""
    if not _scheduler:
        start()
    jid = _tx_refresh_job_id(crm_id, of_user_id)
    interval_seconds = max(TX_REFRESH_MIN_MINUTES * 60, int(interval_minutes) * 60)
    first_run = (int(first_run_seconds) if first_run_seconds is not None
                 else poller.jitter_seconds(interval_seconds))
    _scheduler.add_job(
        _run_tx_refresh,
        trigger='interval',
        seconds=interval_seconds,
        args=[crm_id, str(of_user_id)],
        id=jid,
        next_run_time=None,
        replace_existing=True,
        jobstore='default',
        executor='default',  # delta walk is 1-2 pages — cheap enough for the fast pool
        misfire_grace_time=REFRESH_MISFIRE_GRACE_SECONDS,
    )
    try:
        _scheduler.modify_job(jid, next_run_time=_dt.now() + _td(seconds=first_run))
    except Exception:
        pass
    logger.info("Scheduled tx-refresh %s every %smin (first run in ~%ss)",
                jid, interval_seconds // 60, first_run)


def run_in_background(fn, *args, job_id_prefix: str = 'oneshot') -> str:
    """Schedule `fn(*args)` to run in the APScheduler threadpool immediately.

    Used by the Flask refresh routes so they can return 202 right away while a
    sync runs. Piggybacks on the already-running BackgroundScheduler rather
    than spawning raw threads — gets us structured error handling, lifecycle
    logging, and co-existence with the rest of the job registry for free.

    Returns the generated APScheduler job id (the caller usually doesn't need
    it — progress is tracked by the refresh_state store by (crm_id, uid, kind)
    — but returning it makes this function composable with other job-inspection
    helpers if we ever need to cancel mid-flight).

    Note: `fn` MUST be a module-level importable function, not a lambda or
    closure. The default jobstore is SQLAlchemy-backed and pickles the job
    record. In practice that's fine because real callers pass
    _run_subs_refresh / _run_tx_refresh / similar — all module-level.
    """
    if not _scheduler:
        start()
    jid = f"{job_id_prefix}:{_uuid.uuid4().hex[:10]}"
    # APScheduler interprets naive datetimes against its own scheduler timezone
    # (which is local tz by default on this process). `datetime.now()` lives
    # in local tz too, so they agree. Using `utcnow()` here would put the
    # trigger in the past on any machine not on UTC and the job would be
    # marked as missed + silently dropped.
    _scheduler.add_job(
        fn,
        trigger='date',
        next_run_time=_dt.now() + _td(seconds=0.05),  # tiny delay so the HTTP handler returns first
        args=list(args),
        id=jid,
        replace_existing=False,
        # Callers are the user-triggered subs/tx/campaigns/backfill walks — the
        # same long jobs the cron path sends to the heavy pool. Routing them
        # here too means a user spamming "Refresh" can never starve polling.
        executor='heavy',
        # A one-shot that waited behind a full heavy pool is still worth
        # running; the default grace would discard it after 15min.
        misfire_grace_time=REFRESH_MISFIRE_GRACE_SECONDS,
        # NB: one-shots live in the same SQLAlchemy jobstore as the interval
        # jobs. That's fine because `date` triggers self-remove after firing.
    )
    return jid


def schedule_campaigns_refresh(crm_id: str, of_user_id: str,
                                 interval_hours: int = SUBS_REFRESH_INTERVAL_HOURS):
    """Register the campaigns-claimer sync job.

    Cadence is adaptive: if this account has a tracked-campaigns allowlist the
    walk is small, so we refresh every CAMPAIGNS_FAST_MINUTES (drives the
    new-subscriber chime). Otherwise it stays on the heavy `interval_hours`
    (7-day) cadence so we never walk every campaign on a short timer."""
    if not _scheduler:
        start()
    jid = _campaigns_refresh_job_id(crm_id, of_user_id)
    has_allowlist = False
    try:
        has_allowlist = bool(db.get_tracked_campaigns(crm_id, of_user_id))
    except Exception:
        pass
    if has_allowlist:
        interval_seconds = CAMPAIGNS_FAST_MINUTES * 60
        cadence_desc = f"{CAMPAIGNS_FAST_MINUTES}min (tracked allowlist)"
    else:
        interval_seconds = max(3600, int(interval_hours) * 3600)
        cadence_desc = f"{interval_hours}h"
    first_run = poller.jitter_seconds(interval_seconds)
    _scheduler.add_job(
        _run_campaigns_refresh,
        trigger='interval',
        seconds=interval_seconds,
        args=[crm_id, str(of_user_id)],
        id=jid,
        next_run_time=None,
        replace_existing=True,
        jobstore='default',
        # An allowlisted walk is small and time-sensitive (drives the chime);
        # a full claimer walk is not, so it belongs off the fast pool.
        executor='default' if has_allowlist else 'heavy',
        misfire_grace_time=REFRESH_MISFIRE_GRACE_SECONDS,
    )
    try:
        _scheduler.modify_job(jid, next_run_time=_dt.now() + _td(seconds=first_run))
    except Exception:
        pass
    logger.info("Scheduled campaigns-refresh %s every %s (first run in ~%ss)",
                jid, cadence_desc, first_run)


def trigger_campaigns_refresh_now(crm_id: str, of_user_id: str):
    if not _scheduler:
        start()
    jid = _campaigns_refresh_job_id(crm_id, of_user_id)
    if not _scheduler.get_job(jid):
        schedule_campaigns_refresh(crm_id, of_user_id)
    try:
        _scheduler.modify_job(jid, next_run_time=_dt.now())
        logger.info("Forced immediate run for %s", jid)
        return True
    except Exception:
        logger.exception("Could not force immediate run for %s", jid)
        return False


def trigger_tx_refresh_now(crm_id: str, of_user_id: str):
    if not _scheduler:
        start()
    jid = _tx_refresh_job_id(crm_id, of_user_id)
    if not _scheduler.get_job(jid):
        schedule_tx_refresh(crm_id, of_user_id)
    try:
        _scheduler.modify_job(jid, next_run_time=_dt.now())
        logger.info("Forced immediate run for %s", jid)
        return True
    except Exception:
        logger.exception("Could not force immediate run for %s", jid)
        return False


def _job_interval_seconds(job) -> float | None:
    interval = getattr(getattr(job, 'trigger', None), 'interval', None)
    return interval.total_seconds() if interval is not None else None


def _fansly_refresh_minutes(polling_enabled) -> int:
    """Wallet-refresh cadence for a Fansly account (see FANSLY_REFRESH_*)."""
    poller_running = bool(polling_enabled) and \
        bool(getattr(config, 'FANSLY_POLLING_ENABLED', False))
    if polling_enabled and not poller_running:
        return FANSLY_REFRESH_FAST_MINUTES
    return FANSLY_REFRESH_IDLE_MINUTES


def _ensure_fansly_jobs(row: dict, stagger_idx: int = 0) -> tuple[str, str]:
    """Register (or re-cadence) one Fansly account's wallet + roster jobs.
    ``row`` needs crm_id, of_user_id, polling_enabled and, optionally,
    last_transactions_refresh_at / last_balance_current. Returns the two job
    ids so reconcile can keep them off its removal list."""
    crm_id, uid = row['crm_id'], str(row['of_user_id'])
    tx_jid = _tx_refresh_job_id(crm_id, uid)
    want_min = _fansly_refresh_minutes(row.get('polling_enabled'))
    want_s = max(TX_REFRESH_MIN_MINUTES * 60, want_min * 60)
    job = _scheduler.get_job(tx_jid)
    if job is None or _job_interval_seconds(job) != want_s:
        # Never synced, or never snapshotted with the pending figure: run soon
        # (staggered) instead of waiting out a jittered interval.
        first_run = None
        if not row.get('last_transactions_refresh_at') or \
                row.get('last_balance_current') is None:
            first_run = 30 + stagger_idx * 5
        schedule_tx_refresh(crm_id, uid, interval_minutes=want_min,
                            first_run_seconds=first_run)
    subs_jid = _subs_refresh_job_id(crm_id, uid)
    want_subs_s = max(3600, FANSLY_SUBS_REFRESH_HOURS * 3600)
    sjob = _scheduler.get_job(subs_jid)
    if sjob is None or _job_interval_seconds(sjob) != want_subs_s:
        schedule_subs_refresh(crm_id, uid, interval_hours=FANSLY_SUBS_REFRESH_HOURS)
    return tx_jid, subs_jid


def ensure_account_refresh_jobs(crm_id: str, of_user_id: str) -> None:
    """Bring one account's cache-refresh jobs in line with its current state,
    without waiting for the next restart's reconcile_accounts().

    Called after connect and after a polling toggle. The OFF toggle runs
    unschedule_account, which also removes the tx_refresh job — so before this
    an OF account switched off had no ledger refresh at all until a restart,
    and a Fansly account never had one.

    A no-op when the scheduler isn't running (tests, tooling): this must never
    be the thing that boots it.
    """
    if _scheduler is None:
        return
    try:
        acct = db.get_of_account(crm_id, of_user_id)
        if not acct or acct.get('relogin_blocked_at'):
            return
        if (acct.get('platform') or 'onlyfans') == 'fansly':
            _ensure_fansly_jobs({
                'crm_id': crm_id, 'of_user_id': str(of_user_id),
                'polling_enabled': acct.get('polling_enabled'),
                'last_transactions_refresh_at': acct.get('last_transactions_refresh_at'),
                'last_balance_current': acct.get('last_balance_current'),
            })
            return
        if not acct.get('polling_enabled') and \
                not _scheduler.get_job(_tx_refresh_job_id(crm_id, of_user_id)):
            schedule_tx_refresh(
                crm_id, str(of_user_id), interval_minutes=TX_REFRESH_IDLE_MINUTES,
                first_run_seconds=(30 if not acct.get('last_transactions_refresh_at')
                                   else None))
    except Exception:
        logger.exception("ensure_account_refresh_jobs failed for %s/%s",
                         crm_id, of_user_id)


def reconcile_accounts():
    """Ensure every polling-enabled account has a poll / subs / tx / campaigns
    job, and no stale ones for accounts that have stopped polling."""
    if not _scheduler:
        return
    desired_poll_ids = set()
    desired_subs_ids = set()
    desired_tx_ids = set()
    desired_campaigns_ids = set()
    for row in db.list_pollable_accounts():
        crm_id, of_uid = row['crm_id'], row['of_user_id']
        desired_poll_ids.add(_account_job_id(crm_id, of_uid))
        if not _scheduler.get_job(_account_job_id(crm_id, of_uid)):
            schedule_account(crm_id, of_uid, row['polling_interval_seconds'])

        # Fansly accounts: the poll job dispatches to fansly_poller and the
        # Fansly WS is gated by its flag. Their tx_refresh / subs_refresh jobs
        # are owned by the Fansly pass below (polling state only picks the
        # cadence there); campaigns claimers are OF-only.
        if ((db.get_of_account(crm_id, of_uid) or {}).get('platform') or 'onlyfans') == 'fansly':
            start_fansly_ws_listener(crm_id, of_uid)
            continue

        desired_subs_ids.add(_subs_refresh_job_id(crm_id, of_uid))
        desired_tx_ids.add(_tx_refresh_job_id(crm_id, of_uid))
        desired_campaigns_ids.add(_campaigns_refresh_job_id(crm_id, of_uid))
        if not _scheduler.get_job(_subs_refresh_job_id(crm_id, of_uid)):
            schedule_subs_refresh(crm_id, of_uid)
        tx_job = _scheduler.get_job(_tx_refresh_job_id(crm_id, of_uid))
        if not tx_job:
            schedule_tx_refresh(crm_id, of_uid)
        else:
            # Migrate any legacy tx-refresh job still on the old hourly cadence
            # (interval > the fast floor) down to the fast minutes-based cadence
            # so existing accounts get live spend freshness without a reset.
            try:
                interval = getattr(tx_job.trigger, 'interval', None)
                if interval is not None and \
                        interval.total_seconds() > TX_REFRESH_FAST_MINUTES * 60:
                    schedule_tx_refresh(crm_id, of_uid)
                    logger.info("Migrated tx-refresh %s to fast cadence",
                                _tx_refresh_job_id(crm_id, of_uid))
            except Exception:
                pass
        camp_job = _scheduler.get_job(_campaigns_refresh_job_id(crm_id, of_uid))
        if not camp_job:
            schedule_campaigns_refresh(crm_id, of_uid)
        else:
            # If this account has a tracked-campaigns allowlist but its claimer
            # job is still on the slow 7-day cadence, switch it to the fast one
            # (so the new-subscriber chime works). schedule_* picks the cadence
            # from the allowlist, so we just re-register when it's mismatched.
            try:
                has_allowlist = bool(db.get_tracked_campaigns(crm_id, of_uid))
                interval = getattr(camp_job.trigger, 'interval', None)
                is_fast = interval is not None and \
                    interval.total_seconds() <= CAMPAIGNS_FAST_MINUTES * 60
                if has_allowlist and not is_fast:
                    schedule_campaigns_refresh(crm_id, of_uid)
                    logger.info("Migrated campaigns-refresh %s to fast cadence",
                                _campaigns_refresh_job_id(crm_id, of_uid))
            except Exception:
                pass
        # Real-time WS listener (allowlisted accounts only; idempotent).
        if _ws_enabled(crm_id, of_uid):
            start_ws_listener(crm_id, of_uid)
        # Fansly real-time WS (gated by FANSLY_WS_ENABLED + platform; idempotent).
        start_fansly_ws_listener(crm_id, of_uid)

    # Transactions-only pass: accounts with polling switched OFF.
    #
    # Everything above is keyed on list_pollable_accounts(), so before this an
    # account with polling disabled had NO tx-refresh job at all and its
    # transactions_cache froze at the last manual sync. That was invisible while
    # the earnings summary asked OnlyFans per account; now that the panel-wide
    # summary reads the cache, a frozen cache under-reports real revenue. These
    # accounts get the same job on a much slower cadence — no poll, no subs, no
    # campaigns, no WS: just enough to keep the ledger honest.
    never_synced = 0
    for row in db.list_tx_syncable_accounts():
        crm_id, of_uid = row['crm_id'], str(row['of_user_id'])
        jid = _tx_refresh_job_id(crm_id, of_uid)
        desired_tx_ids.add(jid)
        existing = _scheduler.get_job(jid)
        if not existing:
            # An account that has never synced has an EMPTY cache, so until it
            # runs once the summary reports zero for it. Don't make that wait
            # out a 6h jitter — but don't fire 600 of them at once either, so
            # they're fanned across a few minutes in registration order.
            first_run = None
            if not row.get('last_transactions_refresh_at'):
                first_run = 30 + (never_synced * 5)
                never_synced += 1
            schedule_tx_refresh(crm_id, of_uid,
                                interval_minutes=TX_REFRESH_IDLE_MINUTES,
                                first_run_seconds=first_run)
            continue
        # An account that was polling and got switched off keeps its 10-minute
        # job otherwise, which is 36x the upstream cost for data nobody is
        # watching live. Demote it. (The reverse promotion is handled by the
        # pollable pass above, which re-registers at the fast cadence.)
        try:
            interval = getattr(existing.trigger, 'interval', None)
            if interval is not None and \
                    interval.total_seconds() < TX_REFRESH_IDLE_MINUTES * 60:
                schedule_tx_refresh(crm_id, of_uid,
                                    interval_minutes=TX_REFRESH_IDLE_MINUTES)
                logger.info("Demoted tx-refresh %s to idle cadence", jid)
        except Exception:
            pass

    # Fansly pass: every non-blocked Fansly account, polling on or off, gets a
    # wallet refresh (tx_refresh id) and a roster refresh (subs_refresh id).
    # Before this they only refreshed inside the flag-gated poll cycle, so a
    # Fansly account with polling off — or one connected while polling was off,
    # which never got its backfill — reported a frozen or empty ledger.
    for i, row in enumerate(db.list_fansly_refreshable_accounts()):
        tx_jid, subs_jid = _ensure_fansly_jobs(row, stagger_idx=i)
        desired_tx_ids.add(tx_jid)
        desired_subs_ids.add(subs_jid)

    # Stop WS listeners for accounts that are no longer polling-enabled.
    with _ws_lock:
        active_ws = list(_ws_threads.keys())
        active_fansly_ws = list(_fansly_ws_threads.keys())
    pollable = {(r['crm_id'], str(r['of_user_id'])) for r in db.list_pollable_accounts()}
    for key in active_ws:
        if key not in pollable:
            stop_ws_listener(*key)
    for key in active_fansly_ws:
        if key not in pollable:
            stop_fansly_ws_listener(*key)

    # Remove stale jobs
    for job in _scheduler.get_jobs():
        jid = job.id
        if jid.startswith('account:') and jid not in desired_poll_ids:
            try:
                _scheduler.remove_job(jid); logger.info("Removed stale poll job: %s", jid)
            except Exception:
                pass
        elif jid.startswith('subs_refresh:') and jid not in desired_subs_ids:
            try:
                _scheduler.remove_job(jid); logger.info("Removed stale subs-refresh job: %s", jid)
            except Exception:
                pass
        elif jid.startswith('tx_refresh:') and jid not in desired_tx_ids:
            try:
                _scheduler.remove_job(jid); logger.info("Removed stale tx-refresh job: %s", jid)
            except Exception:
                pass
        elif jid.startswith('campaigns_refresh:') and jid not in desired_campaigns_ids:
            try:
                _scheduler.remove_job(jid); logger.info("Removed stale campaigns-refresh job: %s", jid)
            except Exception:
                pass

    # Jobs restored from the persistent jobstore carry whatever executor/grace
    # they were created with. Re-point them at the current policy so accounts
    # registered before the two-pool split don't stay on the old single pool.
    migrate_job_policies()
    _check_capacity()
