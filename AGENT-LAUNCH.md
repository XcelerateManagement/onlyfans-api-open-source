# Launch The Only API for an operator

This is the installation runbook for an AI coding agent. Follow it in order.
Do not expose the panel to the internet until the owner account exists and
public registration has been closed.

The application is a self-hosted OnlyFans/Fansly CRM with three source
components:

- `api`: Flask, SQLite, APScheduler, platform sessions and the REST API.
- `web`: the Next.js panel.
- `mcp`: the authenticated Model Context Protocol server for AI clients.

The supported customer Docker stack starts `api`, `web`, and `mcp`. MCP is
published on host loopback port 8181 by default; expose it remotely only
through a TLS reverse proxy.

## 1. Interview the operator

Record these answers before changing a host:

1. How many creator accounts will be connected now and in six months?
2. Which platform(s): OnlyFans, Fansly, or both?
3. Is there a dedicated residential or mobile proxy for each OnlyFans account?
4. Is there a funded captcha-provider account for OnlyFans login?
5. Is there a domain, and who controls its DNS?
6. Where will the `ENCRYPTION_KEY` and backups be stored off-host?
7. Does the operator need MCP, and which client: Claude, ChatGPT, Cursor, or
   another Streamable HTTP client?

For fewer than roughly five accounts, explain that the hosted product may cost
less after proxy, captcha and server costs. Continue only when the operator
still wants self-hosting.

## 2. Choose a host

Prefer a plain Ubuntu VPS with Docker Engine and the Compose plugin. A sensible
starting point is 2 vCPU, 4 GB RAM, 40 GB SSD, a persistent public IP and daily
snapshots. Use more RAM and disk when the operator has many accounts or keeps
large exports.

Coolify or Dokploy on the operator's own VPS is acceptable. Render, Fly.io and
Railway are acceptable only when a persistent disk, one always-on API replica,
long-lived SSE and a request timeout of at least 300 seconds are configured.

Do not deploy to Vercel, Netlify, Cloudflare Workers, Lambda or any platform
that sleeps the process or provides only ephemeral storage.

## 3. Preflight the host

Run:

```bash
docker version
docker compose version
df -h /
free -h
```

Require Docker to be healthy, at least 30 GiB free during the first build, and
enough memory that the host is not swapping continuously. Never delete existing
Docker volumes to make room unless the operator identifies each one and
explicitly authorises its deletion.

Check ports 80 and 443 before enabling the bundled Caddy profile:

```bash
sudo ss -ltnp | grep -E ':(80|443)\b' || true
```

If another reverse proxy owns those ports, leave the `tls` profile disabled
and route that proxy to the web service on port 3000.

## 4. Clone and pin the release

```bash
git clone https://github.com/XcelerateManagement/onlyfans-api-open-source.git
cd onlyfans-api
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

The status output must be empty. Record the commit SHA in the handover notes.
Do not install from an arbitrary fork, unreviewed pull request or moving branch
other than `main`.

## 5. Create configuration and secrets

```bash
cp .env.example .env
python3 - <<'PY'
from pathlib import Path
import secrets

p = Path('.env')
text = p.read_text()
for name in ('SECRET_KEY', 'ENCRYPTION_KEY', 'INTER_SERVICE_TOKEN', 'NEXTAUTH_SECRET'):
    text = text.replace(f'{name}=', f'{name}={secrets.token_urlsafe(48)}', 1)
p.write_text(text)
PY
chmod 600 .env
```

Set these deployment-specific values in `.env`:

```dotenv
NEXTAUTH_URL=https://crm.example.com
NEXT_PUBLIC_SITE_URL=https://crm.example.com
NEXT_PUBLIC_APP_URL=https://crm.example.com
NEXT_PUBLIC_API_URL=https://crm.example.com
APP_DOMAIN=crm.example.com
ALLOW_PUBLIC_REGISTRATION=true
```

Use the real domain. If the API has a separate public hostname, set
`API_DOMAIN` and use it for `NEXT_PUBLIC_API_URL`. Keep `BACKEND_URL` as
`http://api:5000`; it is the private Compose-network address.

Copy the exact `ENCRYPTION_KEY` into the operator's password manager before an
account is connected. Losing it makes stored creator credentials unreadable.

The captcha key is optional at startup. It is required before an OnlyFans
login, and can be added later at **Settings -> Captcha provider**. Fansly token
connection does not use the OnlyFans captcha solver.

## 6. Validate and start the panel

Build each image separately so a failure identifies the component:

```bash
docker compose config --quiet
docker compose build api
docker compose build web
docker compose build mcp
docker image inspect onlyfans-api:latest >/dev/null
docker image inspect onlyfans-api-web:latest >/dev/null
docker image inspect onlyfans-api-mcp:latest >/dev/null
docker compose up -d
docker compose ps
```

Do not scale `api`. Exactly one API process must own the scheduler, polling,
rate limiter and SSE hub.

Wait for readiness and inspect logs:

```bash
until curl -fsS http://127.0.0.1:5000/health; do sleep 2; done
curl -fsS http://127.0.0.1:5000/ready
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8181/health
docker compose logs --tail=200 api web mcp
```

Expected results:

- API `/health` returns HTTP 200.
- API `/ready` returns HTTP 200 and does not name a failed dependency.
- web `/api/health` returns `{"ok":true,"service":"web",...}`.
- MCP `/health` returns HTTP 200.
- `docker compose ps` shows all three services running and healthy.
- API logs contain one `Scheduler started` message for this boot, not two.

For the bundled TLS profile, point the domain's A/AAAA records at the host and
then run:

```bash
docker compose --profile tls up -d
curl -fsS https://crm.example.com/api/health
```

For an external reverse proxy, route normal traffic to `web:3000`. Do not
route the panel's `/api/*` paths directly to Flask: those are Next.js routes
that add authentication server-side. Disable response buffering and allow
long-lived connections for SSE.

## 7. Claim the owner account and close registration

Open `https://crm.example.com/register`, create the owner account, sign out and
back in, then verify the dashboard, API docs and Settings pages render.

Immediately change `.env`:

```dotenv
ALLOW_PUBLIC_REGISTRATION=false
```

Apply and verify it:

```bash
docker compose up -d --force-recreate web
```

Open a private browser window and confirm a second registration is refused.
Do not rely on obscurity or the lack of a navigation link.

## 8. Configure and connect a test creator account

Use only an account the operator owns or is explicitly authorised to manage.
For launch validation, use a dedicated test creator account with no customer
data and perform read-only operations.

For OnlyFans:

1. Add and validate a funded captcha key under **Settings -> Captcha provider**.
2. Go to **Accounts -> Add account -> OnlyFans**.
3. Supply one dedicated residential/mobile proxy in the account's usual
   country, and use **Test proxy** before connecting.
4. Prefer current session cookies when available; otherwise use email and
   password. Complete OTP or face verification if the platform requests it.
5. Wait for the account state to show **Connected**.

For Fansly:

1. Go to **Accounts -> Add account -> Fansly**.
2. Choose username/password, or choose token and copy `authorization`,
   `fansly-session-id` and, when present, `fansly-client-id` from a request to
   `apiv3.fansly.com` in the logged-in browser's developer tools.
3. A proxy is optional in the form but should be stable and geographically
   appropriate when used.
4. Wait for **Connected**. If Fansly requires email verification, complete it
   or use the token method.

For either platform, verify the account appears in the dashboard, then run only
read operations: account listing, cached subscribers/fans, balances and
earnings. Do not send messages, change prices, request payouts, run
automations, upload media or delete anything during acceptance.

## 9. Prove persistence and polling

Enable polling for the test account, observe one successful sync/event, and
then restart the stack:

```bash
docker compose restart
docker compose ps
curl -fsS http://127.0.0.1:5000/ready
```

Sign back in and confirm that the owner login, connected account, proxy setting,
session, cached data and polling setting remain. Check that the API log again
contains one scheduler start for the new boot and no duplicate pollers.

## 10. MCP acceptance

MCP starts with the rest of the Compose stack. Keep its host mapping on
`127.0.0.1:8181`; for remote clients, route only `/mcp` through a TLS reverse
proxy, keep `/health` and `/internal/*` private, preserve SSE, disable proxy
buffering and use an hours-long read timeout. Set `NEXT_PUBLIC_MCP_URL` to that
public HTTPS endpoint and rebuild `web` whenever it changes.

Create a dedicated API key at **Dashboard -> API Keys** for each MCP client.
In **Dashboard -> MCP**, paste/use the displayed endpoint and press the
connection test. It must report the server identity and a non-zero tool count.
Also test a real client with `of_list_accounts`, followed by one cached read
tool. Keep the unsafe write proxy disabled and never pass `confirm=true` during
acceptance.

ChatGPT requires the OAuth setup in [mcp/OAUTH.md](mcp/OAUTH.md); Claude
Desktop, Claude Code and Cursor can use a static bearer API key as described in
[mcp/README.md](mcp/README.md).

## 11. Backups, updates and handover

The named volume `onlyfans-api_api_data` contains the database, scheduler
jobstore, saved platform sessions, exports and OAuth keys. Back it up together
with the exact `.env`, encrypt the backup, and test a restore before calling
the deployment complete. Never copy a live SQLite file without first stopping
the API or using SQLite's backup mechanism.

Hand over:

- public panel URL and API URL;
- installed commit SHA;
- where `.env`, `ENCRYPTION_KEY` and backups are stored;
- proxy and captcha ownership/costs;
- how registration is closed;
- how to inspect `docker compose ps` and logs;
- MCP URL and per-client key revocation, if installed;
- update and rollback instructions from [SELF-HOSTING.md](SELF-HOSTING.md).

## Failure table

| Symptom | Likely cause | Action |
|---|---|---|
| API exits before binding | Required secret missing or shorter than 32 characters | Read `docker compose logs api`; set all four independent secrets |
| web cannot reach API | `BACKEND_URL` changed from `http://api:5000` | Restore the Compose-network URL and recreate web |
| login/register loops | Wrong `NEXTAUTH_URL` or `NEXTAUTH_SECRET` changed | Correct the public URL; restore the original secret |
| OnlyFans login fails before OTP | Missing captcha credit, blocked proxy or wrong proxy country | Validate captcha balance; test/replace the dedicated proxy |
| Fansly asks for email verification | Platform challenge | Complete verification or reconnect with browser auth headers |
| data disappears after recreate | `/data` is not on the named volume | Stop and restore the volume/backup before reconnecting |
| duplicate syncs or captcha spend | More than one API worker/replica | Reduce to exactly one and inspect scheduler logs |
| dashboard events do not arrive | SSE buffered or timed out by the reverse proxy | Disable buffering and raise the read timeout |
| MCP dashboard test gets 502 | MCP process is not running or `/mcp` is routed incorrectly | Check the Node service, `MCP_SERVER_URL` and reverse-proxy route |
| MCP returns 401 | Wrong/revoked API key or OAuth issuer/audience mismatch | Mint a dedicated key or re-check OAuth metadata |

For a release-candidate test rather than a customer installation, follow
[PRODUCTION-ACCEPTANCE.md](PRODUCTION-ACCEPTANCE.md). It intentionally uses a
disposable clone and volume and requires two clean runs.
