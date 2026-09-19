#!/usr/bin/env python3
"""Scenario suite for refresh_state + on_progress wiring.

Does NOT hit OF — uses an in-memory SSE hub stub to capture broadcasts.
Run:

    cd onlyfans-api && python3 tests/test_refresh_state.py
"""

from __future__ import annotations

import os
import sys
import time
import threading
import traceback
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# refresh_state reads its staleness threshold from `config`, which hard-requires
# these at import time. Seed them the same way the HTTP tests in this suite do,
# so the file still runs against a clean checkout with no .env.
os.environ.setdefault('SECRET_KEY', 'x' * 40)
os.environ.setdefault('ENCRYPTION_KEY', 'y' * 40)
os.environ.setdefault('TWOCAPTCHA_API_KEY', 'z' * 16)

# Replace the hub's broadcast with a capturing stub BEFORE importing refresh_state.
# refresh_state imports `from sse_hub import hub` so we patch on the module-level
# object and every subsequent broadcast call routes through our capture.
import sse_hub  # noqa: E402

_captured: list[tuple[str, dict]] = []


def _capture(crm_id, event):
    _captured.append((crm_id, event))


sse_hub.hub.broadcast = _capture  # type: ignore[assignment]

import refresh_state  # noqa: E402 — must come AFTER the patch


_failures: list[tuple[str, str]] = []


def scenario(fn):
    def run():
        _captured.clear()
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


def _progress_events():
    return [e for _, e in _captured if e['event_type'] == 'refresh.progress']


def _complete_events():
    return [e for _, e in _captured if e['event_type'] == 'refresh.complete']


def _backdate(key, seconds, *, started_at=True, updated_at=True):
    """Rewind a live entry's timestamps to simulate elapsed wall-clock time.

    `started_at` and `updated_at` are rewound independently on purpose — the
    difference between them is exactly what separates a healthy long-running
    sync from a dead one.
    """
    s = refresh_state._store._by_key[key]
    stamp = (datetime.now(timezone.utc)
             - timedelta(seconds=seconds)).strftime('%Y-%m-%dT%H:%M:%S+00:00')
    if started_at:
        s.started_at = stamp
    if updated_at:
        s.updated_at = stamp


@scenario
def s01_start_record_finish_basic_shape():
    s = refresh_state.start('crm1', 'acc1', 'tx', pages_est=5)
    assert s.phase == 'fetching', s.phase
    assert s.pages_est == 5
    assert s.rows_inserted == 0
    # start emits one progress event
    assert len(_progress_events()) == 1
    evt = _progress_events()[0]
    assert evt['event_type'] == 'refresh.progress'
    assert evt['payload']['of_user_id'] == 'acc1'
    assert evt['payload']['kind'] == 'tx'
    assert 'crm_id' not in evt['payload']   # scoped out of the payload

    refresh_state.record('crm1', 'acc1', 'tx', pages_done=2, rows_inserted=87)
    refresh_state.record('crm1', 'acc1', 'tx', pages_done=3, rows_inserted=160)
    assert len(_progress_events()) == 3          # start + 2 records

    refresh_state.finish('crm1', 'acc1', 'tx', success=True, pages_done=3,
                         rows_inserted=160, stopped_reason='caught_up')
    completes = _complete_events()
    assert len(completes) == 1
    p = completes[0]['payload']
    assert p['success'] is True
    assert p['stopped_reason'] == 'caught_up'
    assert p['phase'] == 'complete'
    assert p['duration_seconds'] is not None
    refresh_state._store._by_key.pop(('crm1', 'acc1', 'tx'), None)  # teardown


@scenario
def s02_initial_phase_is_fetching():
    """Subs no longer does a pre-count (pages are variable-sized so any
    estimate is wrong). Initial phase is 'fetching' straight away; UI renders
    an indeterminate bar + live row counter."""
    s = refresh_state.start('c', 'a', 'subs')
    assert s.phase == 'fetching'
    assert s.pages_est is None
    refresh_state._store._by_key.pop(('c', 'a', 'subs'), None)


@scenario
def s03_list_active_isolates_by_crm():
    refresh_state.start('crmA', 'u1', 'tx')
    refresh_state.start('crmA', 'u2', 'subs')
    refresh_state.start('crmB', 'u1', 'tx')
    a = refresh_state.list_active('crmA')
    b = refresh_state.list_active('crmB')
    assert len(a) == 2, [s.of_user_id for s in a]
    assert len(b) == 1
    assert {s.of_user_id for s in a} == {'u1', 'u2'}
    for crm, uid, k in [('crmA', 'u1', 'tx'), ('crmA', 'u2', 'subs'), ('crmB', 'u1', 'tx')]:
        refresh_state._store._by_key.pop((crm, uid, k), None)


@scenario
def s04_concurrent_updates_no_interleave():
    """Two threads hammering record() on different keys must not drop or
    corrupt either job's counters."""
    refresh_state.start('c', 'fanA', 'tx', pages_est=10)
    refresh_state.start('c', 'fanB', 'tx', pages_est=10)

    def bump(uid, n):
        for i in range(1, n + 1):
            refresh_state.record('c', uid, 'tx', pages_done=i, rows_inserted=i * 10)

    t1 = threading.Thread(target=bump, args=('fanA', 50))
    t2 = threading.Thread(target=bump, args=('fanB', 50))
    t1.start(); t2.start(); t1.join(); t2.join()

    a = refresh_state.get('c', 'fanA', 'tx')
    b = refresh_state.get('c', 'fanB', 'tx')
    assert a.pages_done == 50 and a.rows_inserted == 500, a
    assert b.pages_done == 50 and b.rows_inserted == 500, b
    refresh_state._store._by_key.pop(('c', 'fanA', 'tx'), None)
    refresh_state._store._by_key.pop(('c', 'fanB', 'tx'), None)


@scenario
def s05_completed_ttl_sweeps_row():
    """finish() schedules a sweep after COMPLETED_TTL_SECONDS. Verify it's
    gone from list_active after that grace window."""
    refresh_state.start('sweep', 'a', 'tx', pages_est=1)
    refresh_state.finish('sweep', 'a', 'tx', success=True,
                          pages_done=1, stopped_reason='no_more')
    # Still visible for the TTL window (so a mounting client can catch it)
    assert len(refresh_state.list_active('sweep')) == 1
    time.sleep(refresh_state.COMPLETED_TTL_SECONDS + 0.5)
    assert len(refresh_state.list_active('sweep')) == 0


@scenario
def s06_make_on_progress_forwards_kwargs():
    """The helper that sync modules use as their on_progress must forward
    kwargs into record() verbatim."""
    refresh_state.start('c', 'u', 'subs', pages_est=3)
    cb = refresh_state.make_on_progress('c', 'u', 'subs')
    cb(phase='fetching', pages_done=1, rows_inserted=100)
    cb(phase='fetching', pages_done=2, rows_inserted=200, rows_updated=5)
    got = refresh_state.get('c', 'u', 'subs')
    assert got.pages_done == 2
    assert got.rows_inserted == 200
    assert got.rows_updated == 5
    refresh_state._store._by_key.pop(('c', 'u', 'subs'), None)


@scenario
def s07_finish_before_start_is_noop():
    """finish() on an unknown key returns None without crashing."""
    r = refresh_state.finish('ghost', 'nobody', 'tx', success=False,
                              stopped_reason='error')
    assert r is None


@scenario
def s08_record_before_start_is_noop():
    r = refresh_state.record('ghost', 'nobody', 'tx', pages_done=1)
    assert r is None


@scenario
def s09_error_finish_shape():
    refresh_state.start('c', 'u', 'tx', pages_est=1)
    refresh_state.finish('c', 'u', 'tx', success=False,
                         stopped_reason='error', error='session expired')
    evt = _complete_events()[0]['payload']
    assert evt['success'] is False
    assert evt['error'] == 'session expired'
    assert evt['stopped_reason'] == 'error'
    refresh_state._store._by_key.pop(('c', 'u', 'tx'), None)


@scenario
def s10_to_payload_excludes_crm_id():
    """Payloads go out over the SSE channel which is already scoped to one CRM;
    leaking the CRM id into the event body would be pointless noise."""
    s = refresh_state.start('leaky', 'x', 'tx')
    p = s.to_payload()
    assert 'crm_id' not in p
    assert p['of_user_id'] == 'x'
    assert p['kind'] == 'tx'
    refresh_state._store._by_key.pop(('leaky', 'x', 'tx'), None)


@scenario
def s11_stale_entry_is_superseded():
    """The "stuck on refreshing forever" bug: the one-shot job never ran, so
    nothing ever called finish() and the entry sat at phase='fetching'. The
    guard must treat it as dead, not as running."""
    key = ('c', 'stale1', 'subs')
    refresh_state.start('c', 'stale1', 'subs')
    _backdate(key, refresh_state.STALE_AFTER_SECONDS + 60)
    assert refresh_state.get(*key).is_stale() is True

    # Not reported as running -> the caller is free to start a fresh refresh.
    assert refresh_state.supersede_if_stale('c', 'stale1', 'subs') is None

    # ...and the dead entry was resolved, so a connected UI stops spinning.
    done = refresh_state.get(*key)
    assert done.phase == 'complete', done.phase
    assert done.success is False
    assert done.stopped_reason == 'superseded', done.stopped_reason
    assert 'superseded: no progress' in (done.error or ''), done.error
    evt = _complete_events()[-1]['payload']
    assert evt['stopped_reason'] == 'superseded'
    refresh_state._store._by_key.pop(key, None)


@scenario
def s12_active_progress_is_not_superseded():
    """A long *legitimate* refresh looks identical to a stuck one from the
    outside — an initial 60-page wallet walk can hold phase='fetching' for ages
    (FANSLY_READ_TIMEOUT alone is 90s per page). Staleness is therefore measured
    against LAST PROGRESS, not start time: a job that started hours ago but
    recorded a page a moment ago is healthy and must survive."""
    key = ('c', 'slow', 'tx')
    refresh_state.start('c', 'slow', 'tx', pages_est=60)
    # Started far outside the staleness window...
    _backdate(key, refresh_state.STALE_AFTER_SECONDS * 5)
    # ...but a page just landed, which re-stamps updated_at.
    refresh_state.record('c', 'slow', 'tx', pages_done=41)

    got = refresh_state.get(*key)
    assert got.is_stale() is False, got.seconds_since_progress()
    assert got.seconds_since_progress() < 5
    # Age since start is irrelevant and must not be what we measure.
    assert (datetime.now(timezone.utc)
            - datetime.fromisoformat(got.started_at)).total_seconds() \
        > refresh_state.STALE_AFTER_SECONDS

    live = refresh_state.supersede_if_stale('c', 'slow', 'tx')
    assert live is not None, 'healthy long-running sync was killed'
    assert live.phase == 'fetching'
    assert live.pages_done == 41
    assert not _complete_events(), 'healthy sync must not be finished'
    refresh_state._store._by_key.pop(key, None)


@scenario
def s13_fresh_job_still_blocks_duplicate_start():
    """The guard must keep doing its original job: a genuinely concurrent
    refresh still returns already_running, or we'd double-walk the account."""
    refresh_state.start('c', 'busy', 'subs')
    refresh_state.record('c', 'busy', 'subs', pages_done=1)

    blocking = refresh_state.supersede_if_stale('c', 'busy', 'subs')
    assert blocking is not None, 'concurrent refresh was not blocked'
    assert blocking.phase == 'fetching'
    assert not _complete_events(), 'a live job must not be superseded'

    # A completed job, by contrast, must not block the next one.
    refresh_state.finish('c', 'busy', 'subs', success=True, stopped_reason='no_more')
    assert refresh_state.supersede_if_stale('c', 'busy', 'subs') is None
    refresh_state._store._by_key.pop(('c', 'busy', 'subs'), None)


@scenario
def s14_list_active_reaps_stale():
    """A dashboard that only polls /refresh/active should self-heal, without
    the operator having to click refresh again to trigger the supersede."""
    key = ('reap', 'a', 'subs')
    refresh_state.start('reap', 'a', 'subs')
    _backdate(key, refresh_state.STALE_AFTER_SECONDS + 1)

    jobs = refresh_state.list_active('reap')
    assert len(jobs) == 1, jobs
    assert jobs[0].phase == 'complete'
    assert jobs[0].stopped_reason == 'superseded'
    refresh_state._store._by_key.pop(key, None)


@scenario
def s15_clear_is_immediate_escape_hatch():
    """clear() must not wait out the staleness timer. A job that keeps
    recording progress while making none never looks stale, so the timer can
    never free it — that is precisely what the escape hatch is for."""
    refresh_state.start('c', 'wedged', 'tx')
    refresh_state.record('c', 'wedged', 'tx', pages_done=7)
    assert refresh_state.get('c', 'wedged', 'tx').is_stale() is False

    out = refresh_state.clear('c', 'wedged', 'tx', reason='cleared via API')
    assert out is not None
    assert out.phase == 'complete'
    assert out.success is False
    assert out.stopped_reason == 'cleared', out.stopped_reason
    assert out.error == 'cleared via API'
    # The guard no longer blocks, so a fresh refresh can start immediately.
    assert refresh_state.supersede_if_stale('c', 'wedged', 'tx') is None
    refresh_state._store._by_key.pop(('c', 'wedged', 'tx'), None)

    # Clearing a key that was never there is a safe no-op.
    assert refresh_state.clear('c', 'never-existed', 'tx') is None


@scenario
def s16_supersede_never_clobbers_a_replacement():
    """The staleness verdict is reached outside the lock, so a replacement job
    can take the slot before the supersede write lands. finish(only_job_id=...)
    makes that write conditional so the dead job's failure never overwrites the
    live one's state."""
    key = ('c', 'raced', 'subs')
    refresh_state.start('c', 'raced', 'subs')
    dead_job_id = refresh_state.get(*key).job_id
    _backdate(key, refresh_state.STALE_AFTER_SECONDS + 30)

    # A fresh job wins the slot first.
    replacement = refresh_state.start('c', 'raced', 'subs')
    assert replacement.job_id != dead_job_id

    # The late supersede write, aimed at the OLD job, must be a no-op.
    assert refresh_state.finish('c', 'raced', 'subs', success=False,
                                stopped_reason='superseded',
                                only_job_id=dead_job_id) is None
    still = refresh_state.get(*key)
    assert still.job_id == replacement.job_id
    assert still.phase == 'fetching', still.phase
    refresh_state._store._by_key.pop(key, None)


def main():
    scenarios = [
        s01_start_record_finish_basic_shape,
        s02_initial_phase_is_fetching,
        s03_list_active_isolates_by_crm,
        s04_concurrent_updates_no_interleave,
        s05_completed_ttl_sweeps_row,
        s06_make_on_progress_forwards_kwargs,
        s07_finish_before_start_is_noop,
        s08_record_before_start_is_noop,
        s09_error_finish_shape,
        s10_to_payload_excludes_crm_id,
        s11_stale_entry_is_superseded,
        s12_active_progress_is_not_superseded,
        s13_fresh_job_still_blocks_duplicate_start,
        s14_list_active_reaps_stale,
        s15_clear_is_immediate_escape_hatch,
        s16_supersede_never_clobbers_a_replacement,
    ]
    print(f"Running {len(scenarios)} refresh_state scenarios")
    for s in scenarios:
        s()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for name, msg in _failures:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    print(f"All {len(scenarios)} scenarios passed.")


if __name__ == "__main__":
    main()
