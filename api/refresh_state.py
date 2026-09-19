#!/usr/bin/env python3
"""In-process progress state + SSE broadcast for subs/tx refresh jobs.

Why in-process (not a DB table):
    "Active refresh jobs" are inherently ephemeral — if Flask restarts, the
    threads running them are gone and the state is no longer accurate anyway.
    Persisting to SQLite would just add I/O and a risk of zombie rows. If we
    later want history ("last 10 refresh runs per account") that's a separate
    concern and deserves its own table.

Public API:
    start(crm_id, of_user_id, kind, pages_est=None)         -> RefreshJobState
    record(crm_id, of_user_id, kind, **progress_fields)
    finish(crm_id, of_user_id, kind, success, **result_fields)
    get(crm_id, of_user_id, kind)                            -> RefreshJobState | None
    list_active(crm_id)                                      -> list[RefreshJobState]
    supersede_if_stale(crm_id, of_user_id, kind)             -> RefreshJobState | None
    clear(crm_id, of_user_id, kind, reason=None)             -> RefreshJobState | None
    reap_stale(crm_id=None)                                  -> int

Every mutation ALSO broadcasts over the SSE hub so connected clients update
live without polling. Events:
    refresh.progress — fired on every `record`
    refresh.complete — fired on every `finish`

Concurrency: a single Lock guards the dict. The critical sections are short
(dict mutation + snapshot of one value for broadcast), so no contention issue
at the scale we care about (<1 refresh per account per minute).
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from typing import Literal, Optional

import config
from sse_hub import hub

Kind = Literal["subs", "tx", "campaigns"]
Phase = Literal["counting", "fetching", "upserting", "caught_up",
                "window_exhausted", "no_more", "page_cap", "error", "complete"]

# How long a completed job stays visible in list_active before being swept.
# Long enough for the frontend to catch refresh.complete + show the final
# state for a beat, short enough that stale entries don't linger.
COMPLETED_TTL_SECONDS = 3

# Phases that mean "this job is over and a new one may start".
#
# `finish()` is the only thing that ends a job and it always writes 'complete',
# regardless of success — so 'complete' is the single authoritative terminal
# phase. The sync modules DO report phase='error' through on_progress
# (subscribers_sync, transactions_sync, fansly_sync all do), but they always
# fall through to finish() immediately afterwards, so 'error' is transient and
# is deliberately NOT terminal here: keeping this tuple to just 'complete'
# preserves the pre-existing guard semantics in crm_api exactly. An 'error'
# entry that never reaches finish() is caught by the staleness check below
# instead, which is the safer of the two ways to get it wrong.
TERMINAL_PHASES: tuple[str, ...] = ("complete",)

# A non-terminal entry that has recorded no progress for this long is presumed
# dead — its worker is gone — rather than running. See config for why this is
# measured against last progress rather than start time.
STALE_AFTER_SECONDS = config.REFRESH_STALE_MINUTES * 60


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')


@dataclass
class RefreshJobState:
    job_id: str
    crm_id: str
    of_user_id: str
    kind: Kind
    phase: Phase
    pages_done: int
    # pages_est is retained on the dataclass for TX-initial mode (which has a
    # hard INITIAL_MAX_PAGES ceiling) but is None for subs — subs just walks
    # until the API says no more. OF returns variable page sizes for subs
    # (75-92 per `limit=100` call, post-filtered server-side), so any estimate
    # based on "/count / 100" would be wrong. The UI shows an indeterminate
    # bar + running rows-inserted counter when pages_est is None.
    pages_est: Optional[int]
    rows_inserted: int
    rows_updated: int
    started_at: str
    updated_at: str
    completed_at: Optional[str] = None
    success: Optional[bool] = None
    stopped_reason: Optional[str] = None
    error: Optional[str] = None
    duration_seconds: Optional[float] = None

    def to_payload(self) -> dict:
        """Outer-world shape (frontend + SSE). `crm_id` is intentionally NOT
        included — the SSE channel already scopes to one CRM."""
        d = asdict(self)
        d.pop('crm_id', None)
        return d

    def seconds_since_progress(self, *, now: Optional[datetime] = None) -> float:
        """Age of the newest sign of life from this job.

        `updated_at` is stamped by start() and re-stamped by EVERY record() —
        i.e. by every on_progress page callback — so this measures LIVENESS,
        not runtime. A 60-page wallet walk that legitimately runs for an hour
        keeps resetting this to ~0 after each page; only a job whose worker has
        actually stopped touching it lets the number grow.
        """
        ref = now or datetime.now(timezone.utc)
        try:
            ts = datetime.fromisoformat(self.updated_at)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        except Exception:
            # Unparseable timestamp is our bug, not a dead worker — report the
            # job as freshly alive so we never kill a healthy sync over it.
            return 0.0
        return (ref - ts).total_seconds()

    def is_stale(self, *, now: Optional[datetime] = None) -> bool:
        """True when this entry is non-terminal but has gone quiet long enough
        that the worker which owned it is presumed dead."""
        if self.phase in TERMINAL_PHASES:
            return False
        return self.seconds_since_progress(now=now) >= STALE_AFTER_SECONDS


class _Store:
    def __init__(self):
        self._lock = threading.Lock()
        self._by_key: dict[tuple[str, str, str], RefreshJobState] = {}

    @staticmethod
    def _key(crm_id: str, of_user_id: str, kind: str):
        return (crm_id, str(of_user_id), kind)

    def start(self, crm_id: str, of_user_id: str, kind: Kind,
              pages_est: Optional[int] = None,
              job_id: Optional[str] = None) -> RefreshJobState:
        job_id = job_id or uuid.uuid4().hex[:12]
        now = _iso_now()
        state = RefreshJobState(
            job_id=job_id,
            crm_id=crm_id,
            of_user_id=str(of_user_id),
            kind=kind,
            phase="fetching",
            pages_done=0,
            pages_est=pages_est,
            rows_inserted=0,
            rows_updated=0,
            started_at=now,
            updated_at=now,
        )
        with self._lock:
            self._by_key[self._key(crm_id, of_user_id, kind)] = state
        _broadcast(state, event_type="refresh.progress")
        return state

    def record(self, crm_id: str, of_user_id: str, kind: Kind,
               *, pages_done: Optional[int] = None,
               pages_est: Optional[int] = None,
               rows_inserted: Optional[int] = None,
               rows_updated: Optional[int] = None,
               phase: Optional[Phase] = None) -> Optional[RefreshJobState]:
        """Merge-update the row and broadcast. Only non-None fields overwrite."""
        key = self._key(crm_id, of_user_id, kind)
        with self._lock:
            s = self._by_key.get(key)
            if s is None:
                return None
            if pages_done    is not None: s.pages_done    = pages_done
            if pages_est     is not None: s.pages_est     = pages_est
            if rows_inserted is not None: s.rows_inserted = rows_inserted
            if rows_updated  is not None: s.rows_updated  = rows_updated
            if phase         is not None: s.phase         = phase
            s.updated_at = _iso_now()
            snapshot = _clone(s)
        _broadcast(snapshot, event_type="refresh.progress")
        return snapshot

    def finish(self, crm_id: str, of_user_id: str, kind: Kind,
               *, success: bool,
               pages_done: Optional[int] = None,
               rows_inserted: Optional[int] = None,
               rows_updated: Optional[int] = None,
               stopped_reason: Optional[str] = None,
               error: Optional[str] = None,
               only_job_id: Optional[str] = None) -> Optional[RefreshJobState]:
        """`only_job_id` makes the write conditional: if the entry under this
        key is no longer the job the caller meant to end, do nothing. Used by
        the supersede/reap paths, which decide a job is dead outside the lock
        and must not clobber a replacement that started in the meantime (same
        guard `_sweep` already applies)."""
        key = self._key(crm_id, of_user_id, kind)
        with self._lock:
            s = self._by_key.get(key)
            if s is None:
                return None
            if only_job_id is not None and s.job_id != only_job_id:
                return None
            if pages_done    is not None: s.pages_done    = pages_done
            if rows_inserted is not None: s.rows_inserted = rows_inserted
            if rows_updated  is not None: s.rows_updated  = rows_updated
            s.phase           = "complete"
            s.success         = success
            s.stopped_reason  = stopped_reason
            s.error           = error
            s.completed_at    = _iso_now()
            s.updated_at      = s.completed_at
            try:
                started = datetime.fromisoformat(s.started_at.replace('+00:00', '+00:00'))
                done    = datetime.fromisoformat(s.completed_at.replace('+00:00', '+00:00'))
                s.duration_seconds = round((done - started).total_seconds(), 2)
            except Exception:
                s.duration_seconds = None
            snapshot = _clone(s)
            # Schedule sweep: keep the row visible for a grace window so
            # `list_active` on a late-mounting client still shows the final
            # state, then remove it.
            t = threading.Timer(COMPLETED_TTL_SECONDS, self._sweep, args=[key, s.job_id])
            t.daemon = True
            t.start()
        _broadcast(snapshot, event_type="refresh.complete")
        return snapshot

    def _sweep(self, key, job_id):
        with self._lock:
            cur = self._by_key.get(key)
            if cur is not None and cur.job_id == job_id:
                self._by_key.pop(key, None)

    def get(self, crm_id: str, of_user_id: str, kind: Kind) -> Optional[RefreshJobState]:
        with self._lock:
            s = self._by_key.get(self._key(crm_id, of_user_id, kind))
            return _clone(s) if s is not None else None

    def list_active(self, crm_id: str) -> list[RefreshJobState]:
        # Reap first so a dashboard that merely polls this endpoint self-heals:
        # the dead job resolves to a failed refresh.complete and the spinner
        # clears without the operator having to do anything.
        self.reap_stale(crm_id)
        with self._lock:
            return [_clone(s) for (c, _, _), s in self._by_key.items() if c == crm_id]

    # ---- staleness / recovery -------------------------------------------

    def supersede_if_stale(self, crm_id: str, of_user_id: str,
                           kind: Kind) -> Optional[RefreshJobState]:
        """Guard helper for the refresh routes. Mirrors how create_export_route
        supersedes a wedged export job.

        Returns the entry ONLY when a refresh is genuinely still in flight —
        that, and only that, is grounds for answering `already_running`.
        Returns None when there is no entry, when it already completed, or when
        it was non-terminal but dead. In the dead case the entry is first
        finished as failed (so any connected UI stops showing a spinner) and the
        caller is then free to start a fresh run.
        """
        with self._lock:
            s = self._by_key.get(self._key(crm_id, of_user_id, kind))
            if s is None or s.phase in TERMINAL_PHASES:
                return None
            if not s.is_stale():
                return _clone(s)
            job_id, quiet_for = s.job_id, int(s.seconds_since_progress())
        # finish() re-takes the lock, so it must be called from outside.
        self.finish(crm_id, of_user_id, kind, success=False,
                    stopped_reason='superseded',
                    error=f'superseded: no progress for {quiet_for}s '
                          f'(limit {int(STALE_AFTER_SECONDS)}s)',
                    only_job_id=job_id)
        return None

    def reap_stale(self, crm_id: Optional[str] = None) -> int:
        """Finish every dead entry (optionally scoped to one CRM) as failed.
        Returns how many were reaped."""
        with self._lock:
            dead = [(k, s.job_id, int(s.seconds_since_progress()))
                    for k, s in self._by_key.items()
                    if (crm_id is None or k[0] == crm_id) and s.is_stale()]
        reaped = 0
        for (c, uid, kind), job_id, quiet_for in dead:
            if self.finish(c, uid, kind, success=False,
                           stopped_reason='superseded',
                           error=f'superseded: no progress for {quiet_for}s '
                                 f'(limit {int(STALE_AFTER_SECONDS)}s)',
                           only_job_id=job_id):
                reaped += 1
        return reaped

    def clear(self, crm_id: str, of_user_id: str, kind: Kind,
              reason: Optional[str] = None) -> Optional[RefreshJobState]:
        """Operator escape hatch: force a refresh entry to terminal state right
        now, without waiting out STALE_AFTER_SECONDS. Returns the final state,
        or None if there was nothing to clear.

        This exists because the max-age is a *timer* and a timer cannot help
        with a job that keeps recording progress while making none (a sync
        looping on the same cursor re-stamps updated_at forever and never looks
        stale). Restarting Flask is the only other remedy and it drops every
        other tenant's in-flight work.
        """
        return self.finish(crm_id, of_user_id, kind, success=False,
                           stopped_reason='cleared',
                           error=reason or 'cleared by operator')


def _clone(s: RefreshJobState) -> RefreshJobState:
    """Cheap deep-copy for snapshots we release outside the lock."""
    return RefreshJobState(**asdict(s))


def _broadcast(state: RefreshJobState, *, event_type: str) -> None:
    hub.broadcast(state.crm_id, {
        'event_type': event_type,
        'payload': state.to_payload(),
    })


# Module-level singleton — same pattern as sse_hub.hub.
_store = _Store()

# Public accessors
start              = _store.start
record             = _store.record
finish             = _store.finish
get                = _store.get
list_active        = _store.list_active
supersede_if_stale = _store.supersede_if_stale
reap_stale         = _store.reap_stale
clear              = _store.clear


# ---- progress callback helper ------------------------------------------

def make_on_progress(crm_id: str, of_user_id: str, kind: Kind):
    """Convenience: return a callable the sync modules can pass as `on_progress`.
    Forwards **kwargs to `record(...)`."""
    def _cb(**kwargs):
        record(crm_id, of_user_id, kind, **kwargs)
    return _cb
