#!/usr/bin/env python3
"""Scenario suite for the panel earnings source switch + idle tx-refresh.

`/earnings/summary` used to loop over accounts making 3-7 LIVE OnlyFans calls
each. It now sums transactions_cache in one query. That switch is only safe if
the cache is actually kept warm for EVERY account, and before this change only
polling-enabled accounts had a tx-refresh job at all — measured on production,
3 of 43 accounts (7%). The other 93% would have reported stale-or-zero numbers.

So the two halves are tested together here: scheduling coverage and the route.

Does NOT hit OF and does NOT touch the real DB — points DATABASE_PATH at a
throwaway file before importing anything that opens SQLite.

Run:

    cd onlyfans-api && python3 tests/test_earnings_panel_source.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import traceback
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="earnsrc_test_"), "earn.db")
os.environ["DATABASE_PATH"] = _TMP_DB
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-earnings-source-suite")

import crm_database as db      # noqa: E402
import scheduler               # noqa: E402
import crm_api                 # noqa: E402

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
    run.__name__ = fn.__name__
    return run


# ── Fixtures ───────────────────────────────────────────────────────────────
PANEL = db.create_crm_panel("Earnings Source Test Panel")
CRM = PANEL["crm_id"]
KEY = PANEL["api_key"]

POLLED = "900000000000000001"      # OF, polling ON        → fast cadence
IDLE = "900000000000000002"        # OF, polling OFF       → idle cadence
NEVER = "900000000000000003"       # OF, polling OFF, never synced
BLOCKED = "900000000000000004"     # OF, polling OFF, relogin-blocked → excluded
FANSLY = "900000000000000005"      # fansly, polling OFF   → own wallet/roster jobs
FANSLY_BLOCKED = "900000000000000006"  # fansly, relogin-blocked → no jobs
FANSLY2 = "900000000000000007"     # fansly, legacy balance sample (no current/pending)

for uid, plat in ((POLLED, None), (IDLE, None), (NEVER, None),
                  (BLOCKED, None), (FANSLY, "fansly"),
                  (FANSLY_BLOCKED, "fansly"), (FANSLY2, "fansly")):
    kwargs = dict(crm_id=CRM, of_user_id=uid, email=f"{uid}@t.com",
                  password=None, username=f"u{uid[-1]}")
    if plat:
        kwargs["platform"] = plat
    db.add_of_account(**kwargs)

db.update_account_polling(CRM, POLLED, enabled=True, interval_seconds=120)
db.set_relogin_block(CRM, BLOCKED, "session dead")
db.set_relogin_block(CRM, FANSLY_BLOCKED, "session dead")


def _stamp_tx_refresh(of_user_id, when):
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        conn.execute(
            "UPDATE of_accounts SET last_transactions_refresh_at = ? "
            "WHERE of_user_id = ?", (when, str(of_user_id)))
        conn.commit()
    finally:
        conn.close()


NOW = datetime.utcnow()
_stamp_tx_refresh(POLLED, NOW.strftime("%Y-%m-%d %H:%M:%S"))
# Deliberately the ISO-with-offset form the production DB actually holds, so
# the freshness parser is tested against real stored data, not a tidy fixture.
_stamp_tx_refresh(IDLE, (NOW - timedelta(days=4)).isoformat() + "+00:00")


def _add_tx(of_user_id, created_at, net, tx_type="tip", fan=None):
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        conn.execute(
            "INSERT INTO transactions_cache (crm_id, of_user_id, tx_id, "
            "fan_of_user_id, created_at, net, amount, tx_type, synced_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (CRM, str(of_user_id), f"tx-{of_user_id}-{created_at}-{net}-{tx_type}",
             fan, created_at, net, net, tx_type,
             datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")))
        conn.commit()
    finally:
        conn.close()


def _today_start():
    return NOW_FN().replace(hour=0, minute=0, second=0, microsecond=0)


def NOW_FN():
    return datetime.utcnow()


def _mid_today(offset_days=0):
    """A timestamp halfway through the elapsed part of today (UTC), optionally
    shifted by whole days. Halfway through yesterday's same span is inside the
    'same point last period' cut; any fixed clock time (T09:00) is in the
    future for part of the day."""
    start = _today_start()
    mid = start + (NOW_FN() - start) / 2 + timedelta(days=offset_days)
    return mid.replace(microsecond=0)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S+00:00")


# ── Scheduling coverage ────────────────────────────────────────────────────

@scenario
def s01_idle_accounts_are_tx_syncable():
    ids = {str(r["of_user_id"]) for r in db.list_tx_syncable_accounts()}
    assert IDLE in ids, f"polling-disabled OF account missing: {ids}"
    assert NEVER in ids, f"never-synced OF account missing: {ids}"


@scenario
def s02_polling_enabled_excluded_from_idle_pass():
    ids = {str(r["of_user_id"]) for r in db.list_tx_syncable_accounts()}
    assert POLLED not in ids, "polled account would get BOTH jobs (idle demotes it)"


@scenario
def s03_fansly_excluded():
    # The OF idle pass must not pick Fansly up: Fansly accounts get their own
    # wallet/roster jobs from list_fansly_refreshable_accounts (see s16/s08).
    ids = {str(r["of_user_id"]) for r in db.list_tx_syncable_accounts()}
    assert FANSLY not in ids, "fansly account must not get an OF tx-refresh job"


@scenario
def s04_relogin_blocked_excluded():
    # The circuit breaker already refused to re-log-in. A recurring upstream
    # walk would burn quota and re-trip it on a cadence.
    ids = {str(r["of_user_id"]) for r in db.list_tx_syncable_accounts()}
    assert BLOCKED not in ids, "relogin-blocked account must not be scheduled"


@scenario
def s05_blocked_account_returns_after_reconnect():
    # There is no standalone clear helper — reconnecting via add_of_account is
    # what nulls the block in production, so mirror just that column write.
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        conn.execute("UPDATE of_accounts SET relogin_blocked_at = NULL "
                     "WHERE of_user_id = ?", (BLOCKED,))
        conn.commit()
    finally:
        conn.close()
    try:
        ids = {str(r["of_user_id"]) for r in db.list_tx_syncable_accounts()}
        assert BLOCKED in ids, "clearing the block must re-admit the account"
    finally:
        db.set_relogin_block(CRM, BLOCKED, "session dead")


@scenario
def s06_reconcile_registers_idle_jobs_at_idle_cadence():
    scheduler.start()
    scheduler.reconcile_accounts()
    idle_job = scheduler._scheduler.get_job(scheduler._tx_refresh_job_id(CRM, IDLE))
    assert idle_job is not None, "no tx-refresh job for the polling-disabled account"
    secs = idle_job.trigger.interval.total_seconds()
    assert secs == scheduler.TX_REFRESH_IDLE_MINUTES * 60, \
        f"idle cadence expected {scheduler.TX_REFRESH_IDLE_MINUTES*60}s, got {secs}"

    fast_job = scheduler._scheduler.get_job(scheduler._tx_refresh_job_id(CRM, POLLED))
    assert fast_job is not None, "polled account lost its tx-refresh job"
    fsecs = fast_job.trigger.interval.total_seconds()
    assert fsecs == scheduler.TX_REFRESH_FAST_MINUTES * 60, \
        f"fast cadence expected {scheduler.TX_REFRESH_FAST_MINUTES*60}s, got {fsecs}"


@scenario
def s07_never_synced_gets_a_prompt_first_run():
    job = scheduler._scheduler.get_job(scheduler._tx_refresh_job_id(CRM, NEVER))
    assert job is not None, "never-synced account got no job"
    delay = (job.next_run_time.replace(tzinfo=None)
             - datetime.now()).total_seconds()
    # Must NOT wait out a jitter across the full 6h idle interval: with an empty
    # cache the summary reports zero for this account until the first run.
    assert delay < 600, f"first run in {delay:.0f}s — too far out for an empty cache"


@scenario
def s08_fansly_gets_wallet_and_roster_jobs_blocked_accounts_none():
    # Fansly with polling OFF used to have no refresh at all — its ledger froze
    # after the one-time backfill (observed live: a month stale).
    tx_job = scheduler._scheduler.get_job(scheduler._tx_refresh_job_id(CRM, FANSLY))
    assert tx_job is not None, "polling-off fansly account has no wallet refresh job"
    assert tx_job.trigger.interval.total_seconds() == \
        scheduler.FANSLY_REFRESH_IDLE_MINUTES * 60, tx_job.trigger.interval
    subs_job = scheduler._scheduler.get_job(scheduler._subs_refresh_job_id(CRM, FANSLY))
    assert subs_job is not None, "polling-off fansly account has no roster job"
    assert subs_job.trigger.interval.total_seconds() == \
        scheduler.FANSLY_SUBS_REFRESH_HOURS * 3600, subs_job.trigger.interval
    for uid, why in ((BLOCKED, "relogin-blocked OF"),
                     (FANSLY_BLOCKED, "relogin-blocked fansly")):
        for jid in (scheduler._tx_refresh_job_id(CRM, uid),
                    scheduler._subs_refresh_job_id(CRM, uid)):
            assert scheduler._scheduler.get_job(jid) is None, \
                f"{why} account has job {jid}"


@scenario
def s09_turning_polling_off_demotes_the_job_to_idle():
    db.update_account_polling(CRM, POLLED, enabled=False, interval_seconds=120)
    try:
        scheduler.reconcile_accounts()
        job = scheduler._scheduler.get_job(scheduler._tx_refresh_job_id(CRM, POLLED))
        assert job is not None, "job vanished when polling was switched off"
        secs = job.trigger.interval.total_seconds()
        assert secs == scheduler.TX_REFRESH_IDLE_MINUTES * 60, \
            f"still on the fast cadence after polling off: {secs}s — 36x the " \
            "upstream cost for data nobody is watching live"
    finally:
        db.update_account_polling(CRM, POLLED, enabled=True, interval_seconds=120)
        scheduler.reconcile_accounts()


# ── The route ──────────────────────────────────────────────────────────────

@scenario
def s10_summary_sums_the_cache_without_touching_of():
    # Use elapsed time rather than fixed morning hours: CI can run before
    # 10:00 UTC, in which case a fixed 09:00/10:00 fixture belongs to the
    # future and should correctly be excluded by the production query.
    first = _mid_today()
    second = first + timedelta(seconds=1)
    _add_tx(IDLE, _iso(first), 25.50, "tip")
    _add_tx(NEVER, _iso(second), 10.25, "message")

    called = []
    orig = crm_api.handle_of_request
    crm_api.handle_of_request = lambda *a, **k: (
        called.append(a) or (False, {}, 0, False))
    try:
        crm_api.earnings_cache.invalidate(CRM)
        res = crm_api._compute_earnings_summary(CRM, "today")
    finally:
        crm_api.handle_of_request = orig

    assert not called, f"summary made {len(called)} live OF calls — must be zero"
    assert abs(res["total"] - 35.75) < 0.01, f"total={res['total']} expected 35.75"
    assert res["source"] == "cache", res.get("source")


@scenario
def s11_disconnected_account_rows_are_not_counted():
    # transactions_cache rows outlive a disconnected account for the retention
    # window, so a sum keyed only on crm_id counts creators who left the panel.
    today = datetime.utcnow().strftime("%Y-%m-%d")
    ghost = "900000000000000099"
    _add_tx(ghost, f"{today}T11:00:00", 171.02, "tip")   # never in of_accounts
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    assert abs(res["total"] - 35.75) < 0.01, \
        f"total={res['total']} — orphaned rows leaked into the panel sum"


@scenario
def s12_last_day_of_the_period_is_not_dropped():
    # created_at is stored with a 'T'; the period bounds use a space. Compared
    # as text they diverge at offset 10 and 'T' > ' ', so an unnormalised upper
    # bound silently drops the final day of every period.
    today = datetime.utcnow().strftime("%Y-%m-%d")
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    assert res["total"] > 0, \
        f"today's rows vanished — T-vs-space bound comparison regressed ({today})"


@scenario
def s13_chart_is_zero_filled_and_labelled():
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "month")
    days = res["chart_days"]
    assert len(res["chart"]) == len(days), \
        f"chart {len(res['chart'])} vs chart_days {len(days)} — axis misaligned"
    expected = datetime.utcnow().day
    assert len(days) == expected, \
        f"{len(days)} buckets for a {expected}-day month — gaps shift every " \
        "later point left and misdate the series"
    assert days == sorted(days), "chart_days out of order"


@scenario
def s14_freshness_is_reported_not_hidden():
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    # IDLE was stamped 4 days ago (ISO + '+00:00'), NEVER has no stamp at all.
    assert res["accounts_stale"] >= 1, \
        f"4-day-old cache not reported stale: {res}"
    assert res["accounts_never_synced"] >= 1, \
        f"never-synced account not reported: {res}"
    assert res["oldest_sync_at"], "oldest_sync_at missing — parser failed on '+00:00'"


@scenario
def s15_transactions_are_no_longer_capped():
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    assert res["transactions_capped"] is False, \
        "the cache query has no 500-row-per-account truncation"


# ── Fansly refresh jobs ────────────────────────────────────────────────────

@scenario
def s16_fansly_refreshable_list_ignores_polling_state():
    ids = {str(r["of_user_id"]) for r in db.list_fansly_refreshable_accounts()}
    assert FANSLY in ids and FANSLY2 in ids, f"polling-off fansly accounts missing: {ids}"
    assert FANSLY_BLOCKED not in ids, "relogin-blocked fansly account listed"
    assert IDLE not in ids and POLLED not in ids, "OF accounts leaked into the fansly list"


@scenario
def s17_fansly_cadence_follows_polling_and_poller_flag():
    import config
    saved = config.FANSLY_POLLING_ENABLED
    jid = scheduler._tx_refresh_job_id(CRM, FANSLY)
    db.update_account_polling(CRM, FANSLY, enabled=True, interval_seconds=300)
    try:
        # Polling on but the Fansly poller is off deployment-wide: the job is
        # the only thing keeping the ledger live → fast.
        config.FANSLY_POLLING_ENABLED = False
        scheduler.reconcile_accounts()
        secs = scheduler._scheduler.get_job(jid).trigger.interval.total_seconds()
        assert secs == scheduler.FANSLY_REFRESH_FAST_MINUTES * 60, secs
        # Poller running: it delta-syncs every cycle → the job idles.
        config.FANSLY_POLLING_ENABLED = True
        scheduler.reconcile_accounts()
        secs = scheduler._scheduler.get_job(jid).trigger.interval.total_seconds()
        assert secs == scheduler.FANSLY_REFRESH_IDLE_MINUTES * 60, secs
    finally:
        config.FANSLY_POLLING_ENABLED = saved
        db.update_account_polling(CRM, FANSLY, enabled=False)
        scheduler.unschedule_account(CRM, FANSLY)
        scheduler.reconcile_accounts()
    assert scheduler._scheduler.get_job(jid) is not None, \
        "polling OFF + reconcile lost the fansly wallet job"


@scenario
def s18_fansly_jobs_bypass_the_of_signer_breaker():
    import runtime_readiness
    import fansly_sync
    calls = []
    orig_ready = runtime_readiness.signed_jobs_ready
    orig_fansly = fansly_sync.run_fansly_scheduled_refresh
    orig_of = scheduler.run_tx_refresh_with_progress
    runtime_readiness.signed_jobs_ready = lambda: False
    fansly_sync.run_fansly_scheduled_refresh = lambda c, u: calls.append(("fansly", u))
    scheduler.run_tx_refresh_with_progress = lambda c, u, **k: calls.append(("of", u))
    try:
        scheduler._run_tx_refresh(CRM, FANSLY)
        scheduler._run_tx_refresh(CRM, IDLE)
    finally:
        runtime_readiness.signed_jobs_ready = orig_ready
        fansly_sync.run_fansly_scheduled_refresh = orig_fansly
        scheduler.run_tx_refresh_with_progress = orig_of
    assert calls == [("fansly", FANSLY)], \
        f"OF signer outage must skip OF only and never block Fansly: {calls}"


@scenario
def s19_ensure_account_refresh_jobs():
    saved = scheduler._scheduler
    scheduler._scheduler = None
    try:
        scheduler.ensure_account_refresh_jobs(CRM, FANSLY)   # must not boot one
        assert scheduler._scheduler is None, "ensure_account_refresh_jobs started a scheduler"
    finally:
        scheduler._scheduler = saved

    ids = (scheduler._tx_refresh_job_id(CRM, FANSLY),
           scheduler._subs_refresh_job_id(CRM, FANSLY),
           scheduler._tx_refresh_job_id(CRM, IDLE))
    for jid in ids:
        try:
            scheduler._scheduler.remove_job(jid)
        except Exception:
            pass
    scheduler.ensure_account_refresh_jobs(CRM, FANSLY)
    scheduler.ensure_account_refresh_jobs(CRM, IDLE)
    for jid in ids:
        assert scheduler._scheduler.get_job(jid) is not None, f"{jid} not restored"
    idle = scheduler._scheduler.get_job(scheduler._tx_refresh_job_id(CRM, IDLE))
    assert idle.trigger.interval.total_seconds() == scheduler.TX_REFRESH_IDLE_MINUTES * 60
    scheduler.ensure_account_refresh_jobs(CRM, FANSLY_BLOCKED)
    assert scheduler._scheduler.get_job(
        scheduler._tx_refresh_job_id(CRM, FANSLY_BLOCKED)) is None, \
        "blocked fansly account got a job"


# ── Summary additions ──────────────────────────────────────────────────────

@scenario
def s20_fansly_freshness_uses_the_ledger_stamp():
    crm_api.earnings_cache.invalidate(CRM)
    before = crm_api._compute_earnings_summary(CRM, "today")["by_platform"]["fansly"]
    assert before["never_synced"] == 3, before
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        # last_polled_at advances even when every call in a poll failed, so it
        # must not count as "synced"; the ledger stamp must.
        conn.execute("UPDATE of_accounts SET last_polled_at = ? WHERE of_user_id = ?",
                     (datetime.utcnow().isoformat(), FANSLY2))
        conn.execute("UPDATE of_accounts SET last_transactions_refresh_at = ?, "
                     "last_polled_at = NULL WHERE of_user_id = ?",
                     (_iso(datetime.utcnow()), FANSLY))
        conn.commit()
    finally:
        conn.close()
    after = crm_api._compute_earnings_summary(CRM, "today")["by_platform"]["fansly"]
    assert after["never_synced"] == 2, after
    assert after["stale"] == 0 and after["oldest_sync_at"], after


@scenario
def s21_platform_splits_add_up():
    _add_tx(FANSLY, _iso(_mid_today()), 8.0, "subscription")
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    plat_sum = sum(p["total"] for p in res["by_platform"].values())
    assert abs(plat_sum - res["total"]) < 0.01, (plat_sum, res["total"])
    for cat, amount in res["by_category"].items():
        split = sum(res["by_category_platform"][cat].values())
        assert abs(split - amount) < 0.01, (cat, split, amount)
    subs = res["by_category_platform"]["subscriptions"]
    assert abs(subs.get("fansly", 0) - 8.0) < 0.01, subs
    assert abs(res["by_platform"]["fansly"]["total"] - 8.0) < 0.01, res["by_platform"]


@scenario
def s22_previous_period_to_date():
    start = _today_start()
    late_yesterday = start - timedelta(seconds=2)
    _add_tx(IDLE, _iso(_mid_today(-1)), 5.0, "tip")      # inside the cut
    _add_tx(IDLE, _iso(late_yesterday), 7.0, "tip")      # after the cut
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    assert abs(res["prev_total"] - 12.0) < 0.01, res["prev_total"]
    # Only if "now" is before 23:59:58 does the late row fall outside the cut —
    # true for all but the last two seconds of the day.
    if (NOW_FN() - start).total_seconds() < 86398:
        assert abs(res["prev_total_to_date"] - 5.0) < 0.01, res["prev_total_to_date"]
        assert abs(res["by_platform"]["onlyfans"]["prev_total_to_date"] - 5.0) < 0.01


@scenario
def s23_fansly_wallet_figures():
    import fansly_wallet
    db.record_account_balance(CRM, FANSLY, 73.70, 447.92, "USD", current=521.62)
    db.record_account_balance(CRM, FANSLY2, 10.0, None, "USD")   # legacy sample
    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    fb = res["fansly_balance"]
    assert abs(fb["current"] - 531.62) < 0.01, fb      # legacy falls back to available
    assert abs(fb["available"] - 83.70) < 0.01, fb
    assert abs(fb["pending"] - 447.92) < 0.01, fb
    assert (fb["accounts"], fb["sampled"], fb["pending_sampled"]) == (3, 2, 1), fb
    assert fb["newest_sample_at"], fb
    assert abs(res["fansly_balance_floor"] - 83.70) < 0.01, "floor must alias available"
    # The wallet is a snapshot, never period earnings.
    assert abs(res["total"] - (35.75 + 8.0)) < 0.01, res["total"]

    # A poll cycle only knows the withdrawable figure: the stored pending must
    # survive it (it used to be written back as NULL on every poll).
    fansly_wallet.record_wallet_sample(CRM, FANSLY, 80.0, None, pending_known=False)
    acc = db.get_of_account(CRM, FANSLY)
    assert abs(acc["last_balance_pending"] - 447.92) < 0.01, acc["last_balance_pending"]
    assert abs(acc["last_balance_current"] - 527.92) < 0.01, acc["last_balance_current"]
    assert abs(acc["last_balance_available"] - 80.0) < 0.01


def _of_fan(fan_id, subscribed_at, actions, on_actions=None):
    """OF subscriber row. `actions` → subscribedByData.subscribes; `on_actions`
    → subscribedOnData.subscribes (where live OF rows mostly carry it)."""
    row = {
        "id": fan_id, "username": f"u{fan_id}", "name": f"Fan {fan_id}",
        "subscribedByData": {
            "subscribeAt": subscribed_at,
            "expiredAt": _iso(datetime.utcnow() + timedelta(days=30)),
            "subscribes": [{"action": a} for a in actions],
        },
    }
    if on_actions is not None:
        row["subscribedOnData"] = {
            "subscribeAt": subscribed_at,
            "expiredAt": _iso(datetime.utcnow() + timedelta(days=30)),
            "subscribes": [{"action": a} for a in on_actions],
        }
    return row


def _fansly_fan(fan_id, created):
    import fansly_normalize
    ms = int((created - datetime(1970, 1, 1)).total_seconds() * 1000)   # naive UTC
    ends = ms + 30 * 86400 * 1000
    return fansly_normalize._normalize_subscription(
        {"subscriberId": fan_id, "createdAt": ms, "endsAt": ends,
         "status": 3, "price": 5000})


@scenario
def s24_new_subscribers():
    mid = _mid_today()
    start = _today_start()
    elapsed = (NOW_FN() - start).total_seconds()
    # OnlyFans
    db.upsert_subscriber(CRM, IDLE, _of_fan("fA", _iso(mid), ["subscribe"]))
    db.upsert_subscriber(CRM, IDLE, _of_fan("fB", _iso(mid), ["subscribe", "renewal"]))
    db.upsert_subscriber(CRM, IDLE, _of_fan("fC", _iso(mid), ["subscribe", "renewal"]))
    db.upsert_subscriber(CRM, IDLE, _of_fan("fD", _iso(mid), []))
    shifted = (start + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S+02:00")
    db.upsert_subscriber(CRM, IDLE, _of_fan("fE", shifted, ["subscribe"]))   # UTC: yesterday 23:00
    db.upsert_subscriber(CRM, IDLE, _of_fan("fF", _iso(_mid_today(-1)), ["subscribe"]))
    db.upsert_subscriber(CRM, IDLE, _of_fan("fG", _iso(mid), ["subscribe"]))
    # Live OF shape: history under subscribedOnData, subscribedByData's null.
    db.upsert_subscriber(CRM, IDLE, _of_fan("fK", _iso(mid), [], ["subscribe", "renewal"]))
    # Both present and disagreeing: subscribedOnData (the subscribed_at source) wins.
    db.upsert_subscriber(CRM, IDLE, _of_fan("fL", _iso(mid), ["subscribe"], ["renewal"]))
    # A returning fan (lapsed, came back) is a new sub for the period.
    db.upsert_subscriber(CRM, IDLE, _of_fan("fM", _iso(mid), [], ["subscribe", "return"]))
    conn = db.sqlite3.connect(db.DB_FILE)
    try:
        # fC / fK: rows written before subscribe_action existed → raw_json fallback.
        conn.execute("UPDATE subscribers_cache SET subscribe_action = NULL "
                     "WHERE fan_of_user_id IN ('fC', 'fK')")
        # fG: malformed payload and no stored action → counted as new, no crash.
        conn.execute("UPDATE subscribers_cache SET subscribe_action = NULL, "
                     "raw_json = '{not json' WHERE fan_of_user_id = 'fG'")
        # A disconnected account's leftovers never count.
        conn.execute(
            "INSERT INTO subscribers_cache (crm_id, of_user_id, fan_of_user_id, "
            "subscribed_at, is_active, last_synced_at) VALUES (?,?,?,?,1,?)",
            (CRM, "900000000000000099", "ghost", _iso(mid), _iso(mid)))
        conn.commit()
    finally:
        conn.close()
    # Fansly: fH new today; fI subscribed 40 days ago and renewed today (ledger);
    # fJ new today with its first payment a second later (NOT a renewal).
    db.upsert_subscriber(CRM, FANSLY, _fansly_fan("fH", mid))
    db.upsert_subscriber(CRM, FANSLY, _fansly_fan("fI", mid - timedelta(days=40)))
    db.upsert_subscriber(CRM, FANSLY, _fansly_fan("fJ", mid))
    _add_tx(FANSLY, _iso(mid), 4.0, "subscription", fan="fI")
    _add_tx(FANSLY, _iso(mid + timedelta(seconds=1)), 4.0, "subscription", fan="fJ")
    db.mark_subscribers_refresh(CRM, IDLE, success=True)

    crm_api.earnings_cache.invalidate(CRM)
    res = crm_api._compute_earnings_summary(CRM, "today")
    ns = res["new_subs"]
    assert ns["count"] == 6, ns                 # fA fD fG fM + fH fJ
    assert ns["renewals"] == 5, ns              # fB fC fK fL + fI
    expected_prev = 1 + (1 if elapsed > 23 * 3600 else 0)   # fF (+fE late in the day)
    assert ns["prev_count"] == expected_prev, (ns, elapsed)
    of_, fa = ns["by_platform"]["onlyfans"], ns["by_platform"]["fansly"]
    assert (of_["count"], of_["renewals"]) == (4, 4), of_
    assert (fa["count"], fa["renewals"]) == (2, 1), fa
    assert ns["accounts"] == 7 and ns["accounts_tracked"] == 1, ns
    assert ns["accounts_never_synced"] == 6, ns

    stored = db.get_cached_subscriber_subscribe_at(CRM, IDLE, "fB")
    assert stored, "subscribed_at not stored"


@scenario
def s25_subscriber_events_invalidate_the_summary_cache():
    import event_bus
    crm_api.earnings_cache.put(CRM, "week", {"total": 1})
    event_bus.emit(CRM, IDLE, "new_subscriber",
                   {"fan": {"id": "fZ"}, "action": "subscribe"},
                   source_event_id="test:new-sub:fZ")
    assert crm_api.earnings_cache.get(CRM, "week") is None, \
        "a new subscriber left the cached New Subs count in place"


@scenario
def s26_custom_range_carries_new_subs():
    today = datetime.utcnow().strftime("%Y-%m-%d")
    res = crm_api._compute_earnings_summary(CRM, "custom", start_iso=today, end_iso=today)
    assert "new_subs" in res and res["new_subs"] is not None, res.keys()
    assert res["prev_total_to_date"] is None, res["prev_total_to_date"]
    assert res["computed_at"].endswith("+00:00"), res["computed_at"]


if __name__ == "__main__":
    print("\nearnings panel source + idle tx-refresh")
    for name, fn in sorted(globals().items()):
        if name.startswith("s") and callable(fn) and name[1:3].isdigit():
            fn()
    try:
        scheduler.shutdown()
    except Exception:
        pass
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for n, e in _failures:
            print(f"  - {n}: {e}")
        sys.exit(1)
    print("ALL PASS")
