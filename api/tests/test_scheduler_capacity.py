#!/usr/bin/env python3
"""Scenario suite for scheduler executor pools, job policy + capacity checks.

Does NOT hit OF and does NOT touch the real DB — points DATABASE_PATH at a
throwaway file before importing anything that opens SQLite.

Covers the failure mode that made accounts silently stop updating at scale:
long-running refresh walks and 2-minute polls shared one 10-thread pool, so a
saturated pool skipped poll runs (max_instances) instead of queueing them.

Run:

    cd onlyfans-api && python3 tests/test_scheduler_capacity.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import threading
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Throwaway DB — must be set before crm_database is imported anywhere.
_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="sched_test_"), "sched.db")
os.environ["DATABASE_PATH"] = _TMP_DB

import scheduler  # noqa: E402

_failures: list[tuple[str, str]] = []

# Job callables must be module-level: the SQLAlchemy jobstore pickles jobs, so
# a closure would fail to serialize (same rule as scheduler.run_in_background).
_FAST_RAN = threading.Event()
_RELEASE = threading.Event()


def _block_heavy(_i):
    """Occupies a heavy worker until the test releases it."""
    _RELEASE.wait(timeout=20)


def _mark_fast():
    _FAST_RAN.set()


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
    return run


# ---------------------------------------------------------------- policy ----

@scenario
def s00_websocket_allowlist_is_deployment_configuration():
    assert scheduler.WS_ENABLED_ACCOUNTS == set(), scheduler.WS_ENABLED_ACCOUNTS
    parsed = scheduler._parse_ws_enabled_accounts(
        " crm_example:account_1,crm_second:account_2,invalid,missing: "
    )
    assert parsed == {
        ("crm_example", "account_1"),
        ("crm_second", "account_2"),
    }, parsed


@scenario
def s01_poll_jobs_go_to_the_fast_pool():
    ex, grace = scheduler._desired_job_policy("account:crm_x:123")
    assert ex == "default", ex
    # Grace must comfortably exceed a single poll cycle so a busy pool delays
    # the run rather than discarding it.
    assert grace >= scheduler.POLL_MISFIRE_GRACE_SECONDS, grace
    assert grace >= 300, f"poll grace {grace}s is too tight to survive load"


@scenario
def s02_heavy_walks_are_isolated_from_polls():
    subs_ex, _ = scheduler._desired_job_policy("subs_refresh:crm_x:123")
    poll_ex, _ = scheduler._desired_job_policy("account:crm_x:123")
    assert subs_ex == "heavy", subs_ex
    assert subs_ex != poll_ex, "a full subs walk must not share the poll pool"


@scenario
def s03_tx_delta_walk_stays_on_the_fast_pool():
    ex, grace = scheduler._desired_job_policy("tx_refresh:crm_x:123")
    assert ex == "default", ex
    assert grace == scheduler.REFRESH_MISFIRE_GRACE_SECONDS, grace


@scenario
def s04_poll_grace_scales_with_the_accounts_own_interval():
    class _Trig:
        interval = __import__("datetime").timedelta(seconds=600)

    class _Job:
        trigger = _Trig()

    _, grace = scheduler._desired_job_policy("account:crm_x:123", _Job())
    # A 10-minute-interval account gets proportionally more slack, never less.
    assert grace >= 1800, grace


@scenario
def s05_unmanaged_job_kinds_are_left_alone():
    ex, grace = scheduler._desired_job_policy("oneshot:abc123")
    assert ex is None and grace is None, (ex, grace)


# ------------------------------------------------------------- capacity ----

@scenario
def s06_capacity_math_covers_hundreds_of_accounts():
    # The shipped default must carry a 500-account panel, which is the load
    # this whole change exists to survive.
    supported = scheduler.SCHEDULER_FAST_WORKERS * scheduler.ACCOUNTS_PER_FAST_WORKER
    assert supported >= 500, (
        f"default pool supports only {supported} accounts; "
        f"raise SCHEDULER_FAST_WORKERS")


@scenario
def s07_stats_reports_pool_sizes_and_counters():
    st = scheduler.stats()
    for key in ("running", "missed", "errored", "max_instances_hit"):
        assert key in st, f"stats() missing {key}"


# ------------------------------------------------- live scheduler wiring ----

@scenario
def s08_started_scheduler_exposes_both_pools():
    scheduler.start()
    try:
        st = scheduler.stats()
        assert st["running"] is True
        assert st.get("default_max_workers") == scheduler.SCHEDULER_FAST_WORKERS, st
        assert st.get("heavy_max_workers") == scheduler.SCHEDULER_HEAVY_WORKERS, st
    finally:
        scheduler.shutdown()


@scenario
def s09_migration_upgrades_a_stale_job_policy():
    scheduler.start()
    try:
        sched = scheduler.get_scheduler()
        # Simulate a job persisted before the two-pool split: old grace, and
        # a heavy walk sitting on the fast pool.
        sched.add_job(
            scheduler._run_subs_refresh, trigger="interval", seconds=3600,
            args=["crm_stale", "999"], id="subs_refresh:crm_stale:999",
            replace_existing=True, executor="default", misfire_grace_time=60,
        )
        stale = sched.get_job("subs_refresh:crm_stale:999")
        assert stale.executor == "default" and stale.misfire_grace_time == 60

        changed = scheduler.migrate_job_policies()
        assert changed >= 1, "migration reported no changes"

        fixed = sched.get_job("subs_refresh:crm_stale:999")
        assert fixed.executor == "heavy", fixed.executor
        assert fixed.misfire_grace_time == scheduler.REFRESH_MISFIRE_GRACE_SECONDS, \
            fixed.misfire_grace_time
        # Idempotent: a second pass has nothing left to change for this job.
        scheduler.migrate_job_policies()
        again = sched.get_job("subs_refresh:crm_stale:999")
        assert again.executor == "heavy"
        sched.remove_job("subs_refresh:crm_stale:999")
    finally:
        scheduler.shutdown()


@scenario
def s10_heavy_saturation_does_not_block_fast_jobs():
    """The regression that motivated the split: fill the heavy pool completely
    and assert fast jobs still run promptly."""
    scheduler.start()
    try:
        sched = scheduler.get_scheduler()
        _FAST_RAN.clear()
        _RELEASE.clear()

        # Occupy every heavy worker, plus a queue behind them.
        from datetime import datetime, timedelta
        for i in range(scheduler.SCHEDULER_HEAVY_WORKERS + 4):
            sched.add_job(_block_heavy, "date", args=[i], id=f"blk{i}",
                          executor="heavy",
                          run_date=datetime.now() + timedelta(seconds=0.05),
                          misfire_grace_time=60)
        time.sleep(1.0)
        sched.add_job(_mark_fast, "date", id="fastjob", executor="default",
                      run_date=datetime.now() + timedelta(seconds=0.05),
                      misfire_grace_time=60)

        ok = _FAST_RAN.wait(timeout=8)
        _RELEASE.set()
        assert ok, "fast job was starved while the heavy pool was saturated"
    finally:
        _RELEASE.set()
        scheduler.shutdown()


if __name__ == "__main__":
    print("scheduler capacity / pool-isolation suite")
    for name in sorted(k for k in dir() if k.startswith("s") and k[1:3].isdigit()):
        globals()[name]()
    print()
    if _failures:
        print(f"{len(_failures)} FAILED")
        for n, err in _failures:
            print(f"  - {n}: {err}")
        sys.exit(1)
    print("all scenarios passed")
