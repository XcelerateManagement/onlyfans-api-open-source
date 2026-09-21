# Self-hosting The Only API

Running the API and dashboard on your own infrastructure. Nothing here talks to a
billing service, a licence server, or any hosted component.

New here? Start with the [README](README.md) — particularly
[Where it runs](README.md#where-it-runs), which is honest about the hosts that
cannot run this at all.

---

## The deployment files

| File | What it is |
|---|---|
| `Dockerfile` | Backend image: Python 3.11 **and** Node 20 in one image, run by gunicorn |
| `Dockerfile.web` | Dashboard image: Next.js build + `next start` |
| `docker-compose.yml` | The canonical stack. Also what Coolify and Dokploy consume |
| `.env.example` | Every environment variable the two projects read, grouped and commented |
| `Caddyfile` | Reverse proxy with automatic TLS, tuned for SSE and 30-second logins |
| `install.sh` | One-command bootstrap for a bare Ubuntu 22.04/24.04 VPS |
| `render.yaml` | Render blueprint (persistent disk, single instance) |
| `fly.toml` / `fly.web.toml` | Fly.io app configs (volume, single machine) |

---

## Before you start

The stack itself needs only `SECRET_KEY`, `ENCRYPTION_KEY` and
`NEXTAUTH_SECRET`. Two further things the software cannot provide for you are
needed before you can **connect an account** — not before you can boot.

**A 2captcha API key.** OnlyFans gates login behind a Cloudflare Turnstile
challenge, and the login flow pays for a solve every single time.
`TWOCAPTCHA_API_KEY` is **optional at startup** — `config.py` reads it with a
default of `''` and never raises — so the API and the dashboard come up
without one and you can create your account and look around. Add the key
afterwards in the panel under **Settings → Captcha provider** (per panel,
spending against that panel's own balance), or set `TWOCAPTCHA_API_KEY` in
`.env` as the server-wide default for every panel. With neither set, an
OnlyFans login fails with a message saying exactly that and nothing else
breaks. CapSolver and anti-captcha are functional competitors, but the client
in `captcha_solver.py` speaks the 2captcha API.

**One proxy per connected account**, realistically residential or mobile.
Platform traffic egresses through whatever you configure; a datacentre IP
shared across many accounts is the fastest way to get them all flagged.

And **somewhere off this server to keep `ENCRYPTION_KEY`** — see the warning
below. That one matters from the first boot.

---

## Quick start — local

```bash
git clone https://github.com/XceleratorCRM/onlyfans-api.git
cd onlyfans-api
cp .env.example .env

# Fill in the three secrets at the top of .env:
openssl rand -base64 48 | tr -d '\n='   # -> SECRET_KEY
openssl rand -base64 48 | tr -d '\n='   # -> ENCRYPTION_KEY
openssl rand -base64 48 | tr -d '\n='   # -> NEXTAUTH_SECRET

docker compose up -d --build
```

That is everything the stack needs to boot. `TWOCAPTCHA_API_KEY` is optional
and can stay blank until you connect an account.

Dashboard on <http://localhost:3000>, API on <http://localhost:5000>. Register
at `/register` — email and password, no confirmation email — and you are in.

```bash
curl -fsS http://localhost:5000/health    # liveness
curl -fsS http://localhost:5000/ready     # dependency readiness (signer, scheduler, db)
```

The first build takes a while — it compiles the whole Next.js app.

---

## Quick start — a bare VPS with TLS

Target: a fresh Hetzner CX23 (2 vCPU / 4 GB / 40 GB). Anything
comparable works: Netcup, OVH, Contabo, DigitalOcean, Vultr, Linode.

Point an A record at the server first — Caddy cannot issue a certificate until
DNS resolves there. Then:

```bash
git clone https://github.com/XceleratorCRM/onlyfans-api.git && cd onlyfans-api
sudo ./install.sh
```

It will:

1. Check the OS, architecture and memory
2. Add a 4 GB swapfile if the box has under ~6 GB of RAM — `next build`
   gets OOM-killed on a 4 GB box without one, and the failure shows up as a
   bare `exit code 137`
3. Install Docker Engine and the compose plugin, if absent
4. Ask for your domain and your 2captcha key. **Note:** unlike the
   application, `install.sh` still insists on a 2captcha key of at least 10
   characters and aborts without one. Pass any placeholder of that length if
   you want to defer it, and set the real key later in the panel under
   Settings → Captcha provider
5. Generate `SECRET_KEY`, `ENCRYPTION_KEY` and `NEXTAUTH_SECRET`
6. Write `.env` at mode 600 — and **refuse** to touch one that already exists
7. Open 80/443 if `ufw` is active
8. Build and start `api`, `web` and Caddy

Re-running it is safe. Unattended:

```bash
sudo APP_DOMAIN=crm.example.com TWOCAPTCHA_API_KEY=xxxx ./install.sh
```

---

## ⚠️ `ENCRYPTION_KEY` has no recovery path

Account passwords and custom bot tokens are stored Fernet-encrypted. The key is
derived by SHA-256 over `ENCRYPTION_KEY` (`crm_database.get_encryption_key`),
so that exact string is the only thing in the universe that decrypts them.

There is no reset flow, no escrow, and no way to derive it back from the
ciphertext. Lose it or change it and every connected account has to be
re-entered by hand.

Back up `.env` somewhere that is not the server it runs on, and treat rotating
`ENCRYPTION_KEY` as a data migration rather than a config change.

---

## The single-instance constraint

**Run exactly one API process. Not one per CPU — one, total.**

`gunicorn.conf.py` does not merely default to this; it raises a `RuntimeError`
at startup if `GUNICORN_WORKERS` is anything but 1, because four things hold
authoritative state inside the process:

| | What breaks with N processes |
|---|---|
| **APScheduler** | Starts at import. N schedulers means every poll, every refresh and every webhook retry runs N times against the same OnlyFans accounts — N times the upstream calls, N times the captcha spend, and duplicate events |
| **`refresh_state`** | The in-process progress store behind `/refresh/active` and the duplicate-start guard. Split across processes, a refresh started on one is invisible to the others |
| **`sse_hub`** | Per-`crm_id` subscriber queues. A process can only broadcast to browsers connected to *itself*, so live events reach a fraction of open dashboards |
| **Flask-Limiter** | Configured with `storage_uri="memory://"`. N processes makes every rate limit silently N times looser than configured |

Concurrency comes from **threads**, not processes: `worker_class = 'gthread'`
with 32 threads. That is the right trade here, because the workload is almost
entirely blocked on upstream HTTP — an OnlyFans round trip measures 0.5–1.6s.

Scaling horizontally would mean externalising all four into Redis or the
database. That is a real project, not a config change.

The dashboard (`web`) is stateless and *could* be scaled. There is no reason to.

---

## Why Python and Node live in the same image

`header_generator.py` shells out to `node onlyfans-sign-generator.js` for every
signed OnlyFans request:

```python
cmd = ['node', generator_script, path]
...
except FileNotFoundError:
    raise runtime_readiness.SignerUnavailableError(
        'Header generation failed: `node` not found on PATH')
```

No Node on `PATH` means every signed call fails and the product does nothing.
This rules out any Python-only base image or buildpack. The signer itself needs
no npm packages — it only requires Node builtins — so there is no `npm install`
in the backend image.

---

## Where the data lives

The backend container runs with `/data` as its **working directory**, and that
is deliberate. `multi_tenant_auth.py` builds session paths as the *relative*
string `saved_sessions/<crm_id>/<of_user_id>.json`. There is no environment
variable for it, so it resolves against the process CWD — which makes the CWD
the persistence root. Everything else is pointed at `/data` explicitly:

```
/data/crm_data.db          SQLite: accounts, fans, events, automations, webhooks
/data/scheduler_jobs.db    APScheduler jobstore (jobs survive restarts)
/data/saved_sessions/      One JSON session file per connected account
/data/oauth_keys/          OAuth 2.1 signing keys
/data/exports/             Generated "download your data" ZIPs
/data/rate-budgets/        Upstream rate-limit state
```

One named volume, `api_data`, covers all of it. Compose prefixes it with the project
directory name, so confirm the real name rather than assuming it:

```bash
docker volume ls | grep api_data     # e.g. onlyfans-api_api_data
```

Then back it up:

```bash
docker run --rm -v onlyfans-api_api_data:/data -v "$PWD:/backup" \
    alpine tar czf /backup/onlyapi-backup-$(date +%F).tar.gz -C /data .
```

---

## Reverse proxy notes

Two things will bite you with any proxy in front of this stack.

**Do not buffer Server-Sent Events.** The dashboard opens one SSE connection
and holds it for the life of the tab. With buffering anywhere in the path the
browser receives nothing until the buffer fills, which for a low-volume event
stream can be never — the UI just stops updating, with no error anywhere. The
shipped `Caddyfile` sets `flush_interval -1` and unlimited body read/write
timeouts. For nginx the equivalent is `proxy_buffering off;` plus
`proxy_read_timeout 0;`.

**Allow long requests.** A fresh `/accounts/login` runs a Cloudflare init plus
a paid Turnstile solve and measures 20–30 seconds. gunicorn allows 300s; the
proxy must not give up first.

**`/api/*` on the dashboard hostname belongs to Next.js, not Flask.** This is
the mistake that looks most reasonable and breaks the most. The browser never
talks to Flask directly — `/api/auth/*` is NextAuth, `/api/crm/[...path]` and
`/api/events/stream` are server-side proxies that attach the `X-API-Key` from
the signed JWT (an `EventSource` cannot set headers, which is the whole reason
the SSE proxy exists). Route `/api/*` to Flask and login silently stops
working. The `Caddyfile` exposes Flask at `{$API_DOMAIN}` or at
`{$APP_DOMAIN}/flask/*` instead, and explains this at length.

---

## Deploying to a platform

### Coolify / Dokploy / CapRover — recommended if you want buttons

Self-hosted PaaS panels on your own VPS. Point one at this repository and it
consumes `docker-compose.yml` directly: Git-push deploys, a web UI, automatic
Let's Encrypt — and the box, the disk and the database all stay yours.

Leave the `tls` compose profile disabled; these panels front the stack with
their own proxy. Confirm that proxy does not buffer SSE.

### Render

`render.yaml` is a ready blueprint. Two hard requirements are encoded in it:

- **A persistent disk is mandatory.** Render's filesystem is otherwise wiped on
  every deploy and restart, which would destroy the database and every saved
  session. Disks require a paid instance type.
- **`numInstances: 1`.** Render also refuses to scale a service that has a disk
  attached, which enforces it for you.

The free tier cannot run this at all — it spins services down when idle, and an
idle service runs no scheduler.

One unverified caveat is flagged in the file: `NEXT_PUBLIC_*` values are inlined
at `next build` time, and the blueprint spec has no explicit build-args
mechanism. If the deployed dashboard shows the wrong API URL, set the value as
a literal `ENV` default in `Dockerfile.web`.

### Fly.io

`fly.toml` (backend) and `fly.web.toml` (dashboard). The deploy commands are in
the header comments of each.

Beyond the in-process state problem, Fly adds a second reason to stay at one
machine: **a volume attaches to exactly one machine**. A second machine gets its
own empty volume, and therefore its own empty database — two divergent copies
of your CRM with no reconciliation. `auto_stop_machines` is `false` for the same
family of reasons: a suspended machine runs no scheduler, so polling, webhook
retries and automations just stop while nobody is watching.

### Railway, Koyeb

Both keep a real process alive with a mounted volume, so both work. No template
is committed here, because an untested deploy button is worse than none.

### A note on all managed platforms

A managed platform means a third party holds your disk, which partly undoes the
reason you are self-hosting in the first place. Check each provider's
acceptable-use policy too — several are unfriendly to adult-industry tooling and
can terminate an account without much warning. A plain VPS carries far less of
that risk, and it is the better privacy story.

---

## Will not work — and why

Please read this before opening an issue. These are not missing features; they
are architectural impossibilities.

The app needs **one long-running process that never sleeps**, a **persistent
disk**, **Python and Node in the same container**, **long-lived HTTP** for SSE,
and **300 seconds of request tolerance** for a login. Anything missing one of
those is off the list.

### Vercel

The dashboard alone would deploy. The backend cannot. There is no persistent
process for APScheduler, no writable disk for SQLite, and function timeouts are
far below both a 20–30s login and an hours-long SSE stream. `sse_hub` and
`refresh_state` hold in-memory state that a function invocation cannot carry.

### Netlify

Same as Vercel, for the same reasons.

### Cloudflare Workers / Pages

No persistent process, no filesystem, no Python runtime for this application,
no way to spawn the Node signer as a subprocess, and CPU-time limits that a
signed OnlyFans login blows through immediately.

### AWS Lambda (and any serverless runtime)

No background scheduler between invocations, no durable local disk (`/tmp` is
per-invocation and vanishes), and a 15-minute ceiling that does not accommodate
an SSE stream meant to stay open for hours. Every poll would have to be
re-architected as an EventBridge trigger against an external database — a
different product, not a deployment.

### Heroku

The dyno filesystem is **ephemeral**. It is wiped on every restart, every
deploy, and on Heroku's own daily dyno cycling. SQLite lives on that
filesystem, so your database — plus every saved OnlyFans session and your OAuth
keys — would be destroyed roughly every 24 hours whether or not you touched
anything. Heroku Postgres does not help: the application is SQLite-specific.

### Shared / cPanel hosting

No Docker, usually no Node, no long-running processes, no control over
timeouts.

---

## Upgrading

```bash
cd onlyfans-api
git pull
docker compose build
docker compose up -d
```

The volume is untouched. Schema changes are additive and applied by
`_ensure_column` in `init_database()` on startup. Back up the volume first
anyway.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| API container exits immediately | A missing or too-short `SECRET_KEY` (32+) or `ENCRYPTION_KEY` (32+). `config.py` raises at import, before Flask binds a port. `docker compose logs api` shows which one. `TWOCAPTCHA_API_KEY` is **not** one of these — it is optional and never blocks startup |
| "No captcha provider key is configured" on login | No key in **Settings → Captcha provider** for this panel and none in `TWOCAPTCHA_API_KEY`. Nothing else is affected |
| `RuntimeError: GUNICORN_WORKERS=…` at startup | You raised the worker count. Don't — see the single-instance section |
| Dashboard loads but live counters never move | SSE is being buffered by something in front of the stack, or the container was suspended by a platform's scale-to-zero |
| Login hangs then fails | Proxy timeout below 300s, or a 2captcha balance of zero |
| `/ready` returns 503 | The signer or the scheduler is unavailable. The response body names which. `/health` still answers — that split is deliberate, so a degraded container is not restart-looped out from under you |
| `exit code 137` during the web build | Out of memory. Add swap; `install.sh` does this automatically |
| Wrong API URL shown in the dashboard | `NEXT_PUBLIC_*` values are compiled into the browser bundle. Change them, then `docker compose build web` — editing `.env` alone does nothing |

---

## Not affiliated with OnlyFans

This project is not affiliated with, endorsed by, or connected to OnlyFans or
Fenix International Limited.
