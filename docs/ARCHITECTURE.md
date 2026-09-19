# Architecture

Deep-dive reference for the Flask backend, which lives in `api/`. The dashboard
lives in `web/` and the deployment files (`Dockerfile`, `docker-compose.yml`,
`.env.example`, `Caddyfile`, `install.sh`) sit at the repository root. See
[AGENTS.md](../AGENTS.md) for the shortest path to a running install and
[SELF-HOSTING.md](../SELF-HOSTING.md) for deployment.

All file paths below are relative to `api/` unless stated otherwise.

**There is no billing, metering or plan layer in this build.** No plans, no
account slots, no monthly API-call quota, no subscriptions, no payment
processor. If you are porting something from a build that had one, it does not
belong here — CI (`.github/workflows/no-phone-home.yml`) fails the build if
`count_api_call`, `api_limits` or `usage_tracker` reappear in source.

## File map

### Core

| File | Role |
|---|---|
| `crm_api.py` | All Flask routes. `X-API-Key` auth, input validation, rate limits, security headers. Scheduler kicks off at module import time |
| `crm_database.py` | SQLite schema, helpers, idempotent migrations (`_ensure_column`) |
| `multi_tenant_auth.py` | Per-CRM session persistence (`saved_sessions/{crm_id}/{of_user_id}.json`), curl-cffi Chrome 136 impersonation |
| `of_client.py` | **Shared** `handle_of_request` / `attempt_relogin` / `is_access_denied`. Used by both Flask routes AND the poller — always go through this, never call `multi_tenant_auth.make_authenticated_request` directly from new code |
| `login.py` | Full OF login (CF init → hash fetch → Turnstile → sign → login) |
| `header_generator.py` | Calls `onlyfans-sign-generator.js` via subprocess for `sign`/`time`/`app-token` |
| `captcha_solver.py` | 2captcha integration. The key is read per panel from `crm_panels` first, falling back to `config.TWOCAPTCHA_API_KEY` |
| `config.py` | Env-driven constants. `SECRET_KEY` and `ENCRYPTION_KEY` are required at import (32+ chars); `TWOCAPTCHA_API_KEY` is **optional** and defaults to `''` |
| `api_metrics.py` | Request **outcomes** (status code, latency, route pattern, tenant). In-process accumulator + periodic flush; the only thing in the system that can tell a 500 from a 200 |

### Event engine

| File | Role |
|---|---|
| `scheduler.py` | APScheduler `BackgroundScheduler` with `SQLAlchemyJobStore` pointed at `SCHEDULER_JOBSTORE_PATH` (a separate `scheduler_jobs.db`, `/data/scheduler_jobs.db` in the image). `start()` is idempotent + guarded against Werkzeug double-fork. Schedules one job per polling-enabled account plus a global `webhook_retry` job every 10s |
| `poller.py` | `poll_account(crm_id, of_user_id)`: fetches `/users/notifications`, then delta-walks the subscribers and transactions caches, plus `/subscriptions/subscribers/count` on every 10th poll. **It does not read `/payouts/balances`** — the money signal comes from the transaction ledger. Diffs against cursor (persisted in `of_accounts.polling_cursor` JSON). Emits typed events for new items. Auto-pauses polling after 5 consecutive failures |
| `fansly_poller.py` | The Fansly equivalent. This is the **only** thing that emits `balance_increased`, from the earnings-wallet balance delta |
| `event_bus.py` | `emit(crm_id, of_user_id, event_type, payload, ...)` — persists to `account_events` (with dedup), broadcasts via SSE hub, enqueues webhooks, evaluates automations |
| `sse_hub.py` | In-process `SSEHub` — per-`crm_id` queue registry. `stream(crm_id)` is a generator for Flask `Response(..., mimetype='text/event-stream')` |
| `webhook_delivery.py` | HMAC-SHA256 signing, retries at `[5s, 30s, 5m, 30m, 2h]`. `deliver_due()` scans for pending deliveries past their `next_retry_at`. Auto-deactivates webhooks after 5 consecutive failures |
| `automation_engine.py` | `evaluate_event(event)` runs matching automations. Condition ops: `eq / neq / gt / gte / lt / lte / contains / startswith / in`. Mustache-lite templating on string action params (`{payload.fan.username}`). `run_with_sample()` is what the UI "Run now" button uses |
| `integrations/` | Action handlers: `discord.py`, `slack.py`, `telegram.py`, `of_dm.py` (gated behind per-account `allow_of_write_actions` toggle). `telegram.py` also holds the low-level Bot API client used by the panel channel |
| `telegram_notify.py` | **Panel-level** Telegram channel (one per `crm_id`). Hooked into `event_bus.emit`. Builds the message from named payload fields — never through the automation templater — and reads the token from the encrypted column at send time. 5 consecutive failures auto-deactivate |
| `telegram_updates.py` | Telegram update intake (`getUpdates` short poll) + `/start <code>` pairing resolution. **Read its module docstring before touching it** — it is the single consumer of the shared bot's update stream, and that only works because gunicorn enforces `workers = 1` |

### Bulk account import

| File | Role |
|---|---|
| `import_parser.py` | Forgiving paste parser. Auto-detects `,` `;` TAB `|` **and** bare `email:password`; header optional; column aliases; BOM/quotes/comments. **Pure** — no DB, no network, no disk, which is what makes `/import/preview` side-effect free. Also owns `check_credential_password` (the bounds-only rule `crm_api.validate_credential_password` wraps) |
| `import_runner.py` | The worker. One heavy-pool slot per JOB (never one per row), two private `ThreadPoolExecutor` lanes (cookie 10 / password 6), a 30-logins/min token bucket, a per-proxy-host gate, 2FA parking + expiry, and `reconcile_stale_imports()` which **resumes** on startup |
| `account_connect.py` | Headless connect primitives (`of_password_login`, `of_cookie_connect`, `of_verify_otp`, the Fansly equivalents, `persist`) plus `classify_failure`. Used only by the importer; the four login routes still carry their own copies |

Read `import_runner`'s module docstring before changing concurrency — every
number in it is a defence against looking like credential stuffing to OnlyFans.

## Database schema

Tables created by `init_database()` on module import (all idempotent).

**Core:**
- `crm_panels(id, crm_id UNIQUE, name, api_key UNIQUE, created_at)` — one row per tenant
- `crm_users(id, email UNIQUE, password_hash, name, crm_panel_id, created_at)` — dashboard users
- `of_accounts(id, crm_panel_id, of_user_id, email, username, x_bc, x_hash, proxy, encrypted_password, created_at, last_login, polling_enabled, polling_interval_seconds, last_polled_at, polling_cursor, polling_failure_count, allow_of_write_actions)` — connected OF accounts. UNIQUE`(crm_panel_id, of_user_id)`
- `two_fa_sessions(id, crm_id, email, otp_state, x_bc, x_hash, cookies, proxy, encrypted_password, created_at)` — transient 2FA state
- `account_data_retention(id, crm_id, of_user_id, disconnected_at, purge_after)` — tombstone for a disconnected account. UNIQUE`(crm_id, of_user_id)`. Written by `delete_of_account`, cleared by `add_of_account` on reconnect, swept by the `internal.account_purge` job after `config.ACCOUNT_DATA_RETENTION_DAYS`. `list_fans` / `list_events` exclude tombstoned accounts so leftovers never show in panel-wide reads

### Deleting an account

`delete_of_account(crm_id, of_user_id, purge_now=False)` is the single entry point (the `DELETE /accounts/<id>` route is its only caller). In one transaction it removes the `of_accounts` row + the matching `two_fa_sessions` row and writes a tombstone; the cached data is hard-deleted later by the sweeper, or immediately with `purge_now=True` (`?purge=true` on the route). Every table keyed on `(crm_id, of_user_id)` is enumerated in `_ACCOUNT_SCOPED_PURGES` in `crm_database.py` — **add new account-scoped tables there** or their rows outlive the account forever. `s12_purge_list_covers_every_account_scoped_table` in `tests/test_account_deletion.py` fails if you forget.

Each sweeper pass first runs `adopt_orphaned_accounts()`, which tombstones cached data whose `of_accounts` row is already gone — the backlog left by the pre-tombstone delete. Adoption only tombstones (full retention window still applies) and is disabled with `ACCOUNT_ORPHAN_ADOPTION=0`.

**Event engine:**
- `account_events(id, crm_id, of_user_id, event_type, source_event_id, payload, occurred_at, created_at)` — event log. UNIQUE`(crm_id, of_user_id, event_type, source_event_id)` for dedup
- `webhooks(id, crm_id, url, secret, event_types JSON, description, is_active, consecutive_failures, last_delivery_at, last_status_code, created_at)`
- `webhook_deliveries(id, webhook_id, event_id, attempt, status, response_code, response_snippet, next_retry_at, created_at, completed_at)` — one row per attempt. `status='pending'` + `next_retry_at<=now` means the retry worker will pick it up
- `automations(id, crm_id, of_user_id NULL, name, trigger_event, conditions JSON, action_type, action_params JSON, is_active, last_run_at, run_count, created_at)` — `of_user_id=NULL` means "all accounts"
- `automation_runs(id, automation_id, event_id, status, error_snippet, created_at)`
- `fans(id, crm_id, of_user_id, fan_of_user_id, username, display_name, avatar, first_seen_at, last_seen_at)`. UNIQUE`(crm_id, of_user_id, fan_of_user_id)`. of_user_id is NOT NULL — fans are always account-scoped
- `fan_tags(id, fan_id, tag, added_at, added_by)` — UNIQUE`(fan_id, tag)`
- `telegram_integrations(id, crm_id UNIQUE, bot_mode, encrypted_bot_token, bot_username, chat_id, chat_title, chat_type, event_types JSON, is_active, consecutive_failures, last_delivery_at, last_error, paired_at, created_at, updated_at)` — **panel-scoped, deliberately NOT in `_ACCOUNT_SCOPED_PURGES`** (no `of_user_id` column; disconnecting one account must not kill the panel's channel). `encrypted_bot_token` is Fernet (custom mode only) and is never returned by any route
- `telegram_pairing_codes(id, code UNIQUE, crm_id, expires_at, used_at, created_at)` — single-use, short-lived deep-link codes
- `telegram_bot_state(token_fingerprint PK, update_offset, last_polled_at, last_error)` — `getUpdates` cursor, keyed on a sha256 fingerprint so this table is never a second plaintext copy of a token

**Bulk import:**
- `import_jobs(job_id UNIQUE, crm_id, status, source, default_platform, format, delimiter, has_header, total_rows, counts, error, requested_by, created_at, started_at, completed_at, heartbeat_at)` — panel-scoped, so deliberately absent from `_ACCOUNT_SCOPED_PURGES`
- `import_job_rows(job_id, crm_id, row_index, source_line, lane, platform, email, label, proxy, status, encrypted_*, otp_state, x_bc, x_hash, two_fa_expires_at, of_user_id, username, error, error_reason, permanent, attempts, claim_token, …)` — UNIQUE`(job_id, row_index)`. **This table is the queue**: the worker claims a batch with one `UPDATE … WHERE id IN (SELECT … LIMIT ?)` and never holds the list in memory, which is what makes an import resumable
  - Row states: `pending → running → success | needs_2fa | failed | canceled`, plus `invalid` (never attempted), `skipped` (already connected), `slot_exhausted`, `needs_2fa_expired`
  - Every credential column is Fernet ciphertext and is NULLed by `zero_import_row_secrets()` the moment a row reaches a state in `TERMINAL_ROW_STATES`. `needs_2fa*` is deliberately NOT terminal — it still holds a credential because a human is expected to return — and `config.IMPORT_CREDENTIAL_TTL_HOURS` (24) is the hard ceiling on that
  - It IS in `_ACCOUNT_SCOPED_PURGES`, as the only rule that **scrubs instead of deletes**: the row is a line of a job's audit trail (deleting it would rewrite that job's history) but it carries the account's `of_user_id`/email/label, so the purge nulls those instead. Read the comment on the rule before changing it

**Observability:**
- `api_request_metrics(bucket_start, crm_id, route, method, status_code, req_count, latency_ms_sum, latency_ms_max, slow_count)` — `WITHOUT ROWID`, PK is the whole natural key. One row per 5-minute bucket per (tenant, route pattern, method, status code). Written by `api_metrics.flush()` (scheduler job `internal.metrics_flush`, 60s), swept by `internal.metrics_sweep` after `API_METRICS_RETENTION_DAYS` (30). Panel-scoped, so deliberately NOT in `_ACCOUNT_SCOPED_PURGES`

### Request metrics

`crm_api` has a `before_request` timer + an `after_request` hook (registered above the other hooks so they run *after* them) that fold every finished request into `api_metrics`. Rules:

- **Route pattern only** — `request.url_rule.rule`, never `request.path`. The concrete path would make the key set unbounded and put tenant ids in a metrics table
- **Authenticated tenant only** — attribution comes from `g.metrics_crm_id`, set by `verify_api_key()`. Using `view_args['crm_id']` would let anyone inflate another panel's error rate. Failed/absent auth lands under `''`
- **`/events/stream` is excluded** (`api_metrics.EXCLUDED_ROUTES`) — a connection held open for minutes is not a request and poisons every latency number. `s21_excluded_routes_match_real_rules` in `tests/test_api_metrics.py` fails if the route is renamed without updating the set
- **Fail-open** — `record()` never raises; a flush failure requeues the batch instead of losing it
- **Coverage** — the hook observes 100% of routes. It is pure observability: nothing here counts toward a limit, because there is no limit to count toward

Read routes (same JSON shape, zero-filled series, chart-ready):
`GET /api/admin/metrics/requests` (admin, all tenants, optional `?crm_id=`) and
`GET /api/crm/<crm_id>/metrics/requests` (own panel). Params: `?hours=` (1–2160), `?granularity=5m|15m|1h|6h|1d`, `?limit=` (top-N lists).

## Event flow

```
  APScheduler interval (per account)
           │
           ▼
  poller.poll_account(crm_id, of_user_id)
           │
           ├─ of_client.handle_of_request("/users/notifications?limit=100")
           ├─ subscribers_sync  delta walk  (→ new_subscriber / renewed_subscriber)
           ├─ transactions_sync delta walk  (→ new_tip / new_purchase)
           └─ every 10th poll: "/subscriptions/subscribers/count"  (→ expired_subscriber)
           │
           ▼  diff against polling_cursor
  event_bus.emit(crm_id, of_user_id, event_type, payload, source_event_id=...)
           │
           ├─ db.insert_event()              ←→ dedup by source_event_id
           ├─ sse_hub.hub.broadcast()         →  browsers with open EventSource
           ├─ webhook_delivery.enqueue_event →  matching webhooks get HMAC-signed POST
           └─ automation_engine.evaluate_event →  condition check → action dispatch
```

A new `event_bus.emit` is the only way events should enter the system. Do not call `db.insert_event` directly — you'll lose the fan-out.

## Event taxonomy (emitted)

Defined in `ALLOWED_EVENT_TYPES` at `crm_api.py`:
`new_subscriber`, `renewed_subscriber`, `expired_subscriber`, `new_tip`, `new_message`, `new_purchase`, `balance_increased`, `payout_completed`, `polling_paused`, `*` (wildcard for webhook subscriptions only)

`balance_increased` is emitted only by `fansly_poller.py`; the OnlyFans poller
takes its money signal from the transaction ledger instead. `payout_completed`
is reserved and not currently emitted by anything.

**`INTERNAL_EVENT_TYPES`** is a second, separate list: `export.progress`,
`export.complete`, `refresh.progress`, `refresh.complete`, `import.progress`,
`import.complete`, `verification.required`, `verification.approved`,
`verification.failed`. These are server-generated UI progress events — they carry
no platform data and are never persisted to `account_events`. They ride the
same SSE hub, and `/events/stream?types=` validates against
`STREAMABLE_EVENT_TYPES` (= both lists) so a client can subscribe to just
`import.progress`. Webhooks and automations still validate against
`ALLOWED_EVENT_TYPES` alone. **Add a progress event to the internal list, never
to the public one** — widening `ALLOWED_EVENT_TYPES` would also make it a legal
webhook subscription and automation trigger.

Progress events must be **coalesced**: `sse_hub` gives each subscriber a
`Queue(maxsize=200)` that silently drops on overflow, so a 600-row import
emitting per row would evict the very events the UI is waiting for. See
`import_runner.ProgressEmitter` (≤1/sec + a bounded tail, counts always a full
snapshot).

## Automation action types

Defined in `ALLOWED_ACTION_TYPES`: `webhook`, `discord`, `slack`, `telegram`, `send_dm`, `tag_fan`. See [EVENTS.md](EVENTS.md) for param shapes.

## Scheduler lifecycle

- Starts when `crm_api` module is imported (module-level `_scheduler.start()` in `crm_api.py`)
- Guarded by `os.environ.get("WERKZEUG_RUN_MAIN") == "false"` to skip the Flask reloader parent process
- In production (`use_reloader=False`) it starts directly
- Jobs survive restarts via `SQLAlchemyJobStore(url=f"sqlite:///{SCHEDULER_JOBSTORE_PATH}")` — a different file from the application database
- `reconcile_accounts()` runs on startup and re-registers polling jobs for every `of_accounts.polling_enabled=1` row
- `atexit.register(shutdown)` ensures clean teardown

## Rate limiting

`flask-limiter` with per-API-key keys, in-memory store (swap to Redis for prod scale). Three tiers:
- `RATE_LIMIT_DEFAULT` (1000/min) — most reads
- `RATE_LIMIT_SENSITIVE` (100/min) — CRUD writes
- `RATE_LIMIT_LOGIN` (20/min) — login/2FA

These are the defaults in `config.py`, and they are also what `.env.example`
sets. Keep the two in agreement — if you change one, change both. A mismatch
between the code fallback and the deployed `.env` is genuinely hard to debug,
because the symptom is a limit that is quietly looser or tighter than the one
you think you configured.

The in-memory store is deliberate and pairs with the single-worker constraint;
see [SELF-HOSTING.md](../SELF-HOSTING.md#the-single-instance-constraint). Do not
swap it for Redis without externalising the scheduler, the refresh store and the
SSE hub at the same time.

SSE endpoint is `@limiter.exempt` (otherwise one long-lived connection would instantly exhaust the limit).

Per-tenant bypass: `crm_panels.rate_limit_exempt = 1` skips ALL flask-limiter caps (default + per-route) for that panel's API keys, via a `@limiter.request_filter` in `crm_api.py` (30s TTL cache, so a toggle takes ≤30s to propagate). Set it directly in SQLite. Anonymous/invalid-key traffic is never exempt.

(`crm_panels.quota_override` still exists as a column and defaults to `1`, but
nothing reads it: the monthly-call cap it used to bypass was removed along with
the rest of the metering layer. It is a vestigial column, not a feature.)

## API Key auth rules

`verify_api_key()` reads ONLY from the `X-API-Key` header — never query params (to avoid log leakage). Every route that uses it must be called from a handler that has `crm_id` in `view_args`.

## Writing new features

1. Does it touch OF? → always go through `of_client.handle_of_request` (gives you auto-relogin + proxy fallback)
2. New event type? → add to `ALLOWED_EVENT_TYPES` in `crm_api.py` AND `NOTIFICATION_TYPE_MAP` or categorization logic in `poller.py`
3. New action type? → add to `ALLOWED_ACTION_TYPES` AND a `_dispatch_action` branch in `automation_engine.py`
4. New table? → add to `init_database()` with `CREATE TABLE IF NOT EXISTS`. For new columns on existing tables, use `_ensure_column` (SQLite can't drop NOT NULL). If it's keyed on `(crm_id, of_user_id)`, also add it to `_ACCOUNT_SCOPED_PURGES` or disconnecting an account leaks its rows forever
5. New route? → wire rate-limit + `verify_api_key()` + `sanitize_string/validate_*` input validators. Follow the existing code style

## Testing

The files in `api/tests/` are **standalone scripts, not pytest modules.** Each
one asserts as it imports and calls `sys.exit(1)` on failure, so it is run
directly and there is no collector to discover it. `pytest tests/` is wrong and
pytest is not a dependency.

```bash
cd api
python tests/test_polling_default.py            # one file
for t in tests/test_*.py; do python "$t" || echo "FAIL $t"; done   # the whole suite
```

On Windows set `PYTHONIOENCODING=utf-8` first — the scripts print non-ASCII
status characters and the default console codepage will raise on them.

The suite must pass before merging any event-engine change.
`.github/workflows/tests.yml` runs every file the same way on each pull
request, collecting failures rather than stopping at the first, and also runs
`ruff check api/`.

## Common gotchas

- **"database is locked"** — SQLite connection not closed on exception. Always use `try/finally conn.close()`
- **Scheduler double-runs jobs** — `WERKZEUG_RUN_MAIN` guard must be respected
- **SSE not receiving events** — check the Next.js proxy at `web/app/api/events/stream/route.ts` is forwarding the `X-API-Key` header
- **Webhook never retries** — check `webhook_deliveries.next_retry_at` is in the past AND `webhooks.is_active=1`
- **Automation silently skipped** — inspect `automation_runs` for the `error_snippet` or `'conditions not met'` status
- **NULL comparison in SQL** — `col = NULL` matches nothing; use `col IS NULL` or skip the row entirely (we use the latter for fans without an `of_user_id`)
