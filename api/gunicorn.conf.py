"""Gunicorn configuration for the CRM API.

Replaces `app.run(threaded=True)` — the Flask development server, which is
single-process and was measured saturating at ~28-64 req/s server-wide with p95
climbing to 32s at 200 concurrent, on a 32-core box that stayed idle.

## Why exactly one worker

This is the load-bearing constraint of this file, not a tuning choice. Several
pieces of the app hold authoritative state *in the process*:

  - `scheduler` — APScheduler starts at import (crm_api.py). N workers would
    start N schedulers, so every poll, every refresh and every webhook retry
    would run N times against the same accounts.
  - `refresh_state` — the in-process progress store behind /refresh/active and
    the duplicate-start guard. Split across workers, a refresh started on one
    worker is invisible to the others.
  - `sse_hub` — per-crm_id subscriber queues. A worker can only broadcast to
    the browsers connected to *itself*, so events would reach a fraction of
    open dashboards.
  - `flask_limiter` — configured with `storage_uri="memory://"`, so N workers
    means every rate limit is silently N times looser than configured
    (flagged in SECURITY-FINDINGS.md).

Scaling out therefore requires externalising all four (Redis or DB), which is a
real project. Until then the throughput win comes from threads, not processes,
and that is the correct trade here: this workload is almost entirely blocked on
upstream HTTP, so threads sidestep the GIL for the part that matters.

`workers > 1` raises at startup rather than booting into that broken state —
the failure would otherwise be silent, intermittent and extremely hard to
attribute.
"""

import os

# ── Socket ────────────────────────────────────────────────────────────────
bind = f"{os.environ.get('HOST', '0.0.0.0')}:{os.environ.get('PORT', '5020')}"

# ── Workers ───────────────────────────────────────────────────────────────
# See the module docstring. Do not raise this without externalising scheduler /
# refresh_state / sse_hub / limiter state first.
workers = int(os.environ.get('GUNICORN_WORKERS', 1))

# gthread: real threads inside one process. `sync` would serialise every
# request, which is strictly worse than what the dev server already did.
worker_class = 'gthread'

# Concurrency comes from here. Requests are ~all socket wait (an OF round-trip
# is 0.5-1.6s measured), so threads are cheap and the count can be generous.
threads = int(os.environ.get('GUNICORN_THREADS', 32))

# ── Timeouts ──────────────────────────────────────────────────────────────
# `timeout` is the arbiter's worker-liveness check, not a per-request budget:
# with gthread the main loop keeps heart-beating while requests run on worker
# threads. It is set well above the default 30s anyway, because this app has
# genuinely long endpoints — a fresh /accounts/login runs a Cloudflare init
# plus a Turnstile solve and takes 20-30s, and SSE streams stay open for hours.
timeout = int(os.environ.get('GUNICORN_TIMEOUT', 300))

# Let in-flight work finish on restart instead of severing it mid-sync.
graceful_timeout = int(os.environ.get('GUNICORN_GRACEFUL_TIMEOUT', 60))

# SSE connections are long-lived by design; never reap them for being idle.
keepalive = int(os.environ.get('GUNICORN_KEEPALIVE', 65))

# ── App loading ───────────────────────────────────────────────────────────
# MUST stay False. With preload_app the app is imported in the master *before*
# forking, so the scheduler's threads would be created pre-fork and not survive
# into the worker — the jobs would appear registered and never run.
preload_app = False

# ── Logging ───────────────────────────────────────────────────────────────
# To stdout/stderr, so journald owns it (the unit already routes there).
accesslog = os.environ.get('GUNICORN_ACCESSLOG', '-')
errorlog = '-'
loglevel = os.environ.get('GUNICORN_LOGLEVEL', 'info')
# Health checks would otherwise dominate the log at one line per probe.
access_log_format = '%(h)s "%(r)s" %(s)s %(b)s %(D)sus'


def on_starting(server):
    """Refuse to boot multi-worker rather than corrupt state silently."""
    if workers != 1:
        raise RuntimeError(
            f"GUNICORN_WORKERS={workers} but this app holds scheduler, "
            f"refresh_state, sse_hub and rate-limiter state in-process. "
            f"Running >1 worker duplicates every scheduled job and splits SSE "
            f"and refresh state across processes. Externalise that state "
            f"first; see the docstring in gunicorn.conf.py."
        )
    server.log.info(
        "CRM API: 1 worker x %d threads (in-process scheduler + SSE hub)", threads)
