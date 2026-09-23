# Open-source production acceptance runbook

This runbook is the release gate for `XceleratorCRM/onlyfans-api-open-source`. It tests a
fresh clone as a customer would receive it, then validates the public repository
and marketing launch without writing to a real creator account.

Passing unit tests alone is not a release. The release candidate passes only
after two fresh-volume Docker runs, one authorised real account connection and
read-only sync, an MCP handshake plus safe tool call, and a verified rollback.

## Non-negotiable safety boundary

- Use a dedicated creator test account, a dedicated proxy and a funded captcha
  account. Never use a customer account or customer data.
- Acceptance is read-only after connection. Do not send messages, create posts,
  upload media, request payouts, change prices, trigger automations, test
  webhooks against third parties or delete platform data.
- Keep the source repository private and the website launch flag off until all
  blocking gates pass.
- Never prune all Docker data. Never delete an unrelated volume. Teardown must
  name the disposable Compose project and verify its labels first.
- Exactly one API container and one gunicorn worker may run.
- Never print `.env`, bearer tokens, session cookies, proxy passwords or creator
  identifiers into the evidence log.

## Current release blocker: MCP is not in Compose

At the time this runbook was written, `docker compose config --services` lists
only `api` and `web` (plus optional profile-gated `caddy`). The `mcp/` source is
present and runnable with Node 20, but a customer who runs
`docker compose up -d` does not get MCP.

This does not block testing the panel and API. It does block any public claim
that the complete API + panel + MCP system launches in one Docker command. Pick
one outcome before publication:

1. add an MCP image/service, healthcheck, internal URL and reverse-proxy route
   to Compose and repeat this entire runbook; or
2. describe MCP everywhere as an optional separately supervised Node service.

Do not silently waive this gate.

## Evidence record

Create a private release record. Record values, not secrets:

```text
Candidate commit:
Test host / Docker versions:
Host free space before build:
Run 1 project and volume:
Run 1 start/end UTC:
Run 2 project and volume:
Run 2 start/end UTC:
OnlyFans test account alias:
Fansly test account alias (if tested):
Proxy alias / expected country:
Captcha provider and starting/ending balance:
MCP server version / tool count:
CI run links:
Outbound capture file/hash:
Result and blocking defects:
Rollback target:
Approver:
```

Screenshots and logs must redact emails, IDs, API keys, cookies, tokens and proxy
credentials.

## Phase 0: source and host preflight

On Windows PowerShell with Docker Desktop:

```powershell
docker version
docker compose version
docker info --format '{{json .ServerVersion}}'
Get-PSDrive C | Select-Object Name,Free,Used
docker system df -v
```

Blocking conditions:

- Docker client cannot reach the engine.
- The host filesystem holding Docker has less than 30 GiB free. Reclaimable
  space inside Docker's VM does not count as host free space.
- A container named `onlyfans-api`, `onlyfans-api-web` or
  `onlyfans-api-caddy` already exists. Compose uses fixed container names, so
  this test cannot run beside another copy without an override.
- An existing production installation is using ports 3000 or 5000.

Do not remove a conflicting production installation. Move the acceptance test
to a separate host or create and review a Compose override that changes its
container names, ports, image names and volume names.

Verify the candidate remotely, then clone it instead of testing a working tree:

```powershell
$RunId = Get-Date -Format 'yyyyMMddHHmmss'
$RunRoot = Join-Path $env:TEMP "onlyfans-api-acceptance-$RunId"
$Project = "toaaccept$RunId".ToLowerInvariant()
New-Item -ItemType Directory -Path $RunRoot | Out-Null
gh repo clone XceleratorCRM/onlyfans-api-open-source "$RunRoot\repo" -- --branch main --single-branch
Set-Location "$RunRoot\repo"
git status --short
git rev-parse HEAD
git rev-parse origin/main
```

The working tree must be empty and the two SHAs must match the approved
candidate. Record the SHA. Do not test the dirty private monorepo.

## Phase 1: static release gates

Run the same no-phone-home assertions as CI:

```powershell
git grep -n -E 'count_api_call|check_and_reserve_slot|api_limits|usage_tracker' -- '*.py' '*.ts' '*.tsx' '*.js'
git grep -n -E 'theonlyapi\.com|xcelerator\.agency|xcelerator\.run|ofdashboard' -- '*.py' '*.ts' '*.tsx' '*.js'
git grep -n 'GUNICORN_WORKERS' -- api/gunicorn.conf.py
```

The first two commands must print nothing. The last must show the single-worker
guard. The GitHub `no-phone-home` workflow must also pass on `main`.

Run a secret scanner with redaction. Gitleaks is the reference command:

```powershell
gitleaks detect --source . --redact --no-banner
```

Any verified credential is blocking. False positives must be documented; do
not add a blanket allowlist merely to turn the run green.

Run local equivalents of CI:

```powershell
docker run --rm -v "${PWD}:/src" -w /src/api python:3.11 `
  sh -lc "pip install -q -r requirements.txt ruff && ruff check --select E9,F63,F7,F82 ."
npm --prefix mcp ci
npm --prefix mcp run build
npm --prefix mcp run typecheck
npm --prefix mcp audit --omit=dev
docker compose config --quiet
```

The production dependency audit must report zero known vulnerabilities. Review
dev-only findings separately; no high or critical dev finding may be waived
without an applicability note and owner. Do not use `npm audit fix --force`
immediately before release because it can cross declared version ranges.

The full Python test matrix and Docker image build must pass in GitHub Actions.
Do not copy CI secrets into the local shell.

## Phase 2: create a test-only environment

Copy `.env.example` to `.env` in the disposable clone and generate four new,
independent secrets. Do not reuse development or production values:

```powershell
Copy-Item .env.example .env
$Names = 'SECRET_KEY','ENCRYPTION_KEY','INTER_SERVICE_TOKEN','NEXTAUTH_SECRET'
$Text = Get-Content .env -Raw
foreach ($Name in $Names) {
  $Secret = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
  $Text = [regex]::Replace($Text, "(?m)^$Name=.*$", "$Name=$Secret", 1)
}
$Text = [regex]::Replace($Text, '(?m)^ALLOW_PUBLIC_REGISTRATION=.*$', 'ALLOW_PUBLIC_REGISTRATION=true', 1)
[IO.File]::WriteAllText((Resolve-Path .env), $Text)
Remove-Variable Text,Secret
```

Keep local URLs for this run. Do not put real platform credentials, cookies or
proxy details in `.env`; enter them through the encrypted panel flow.

Validate configuration without displaying resolved environment values:

```powershell
docker compose -p $Project config --quiet
docker compose -p $Project config --services
```

Expected customer services are `api` and `web`. Record whether the selected
MCP publication outcome has changed this expectation.

## Phase 3: build and start Docker run 1

Build separately, then inspect the result:

```powershell
docker compose -p $Project build api
docker image inspect onlyfans-api:latest --format '{{.Id}} {{.Size}}'
docker compose -p $Project build web
docker image inspect onlyfans-api-web:latest --format '{{.Id}} {{.Size}}'
docker compose -p $Project up -d
docker compose -p $Project ps
```

Wait up to five minutes for the first boot, then require all four checks:

```powershell
curl.exe --fail --silent --show-error http://127.0.0.1:5000/health
curl.exe --fail --silent --show-error http://127.0.0.1:5000/ready
curl.exe --fail --silent --show-error http://127.0.0.1:3000/api/health
curl.exe --fail --silent --show-error --output NUL http://127.0.0.1:3000/login
```

Inspect, but do not publish, logs:

```powershell
docker compose -p $Project logs --no-color --since 10m api web
```

Pass conditions:

- API is healthy and ready; web returns HTTP 200.
- no restart loop, traceback, missing-secret warning or remote-backend fallback;
- exactly one API container is running;
- exactly one `Scheduler started` log line appears for this API boot;
- `docker inspect onlyfans-api-web` shows it joined the same Compose network as
  `onlyfans-api`, and dashboard calls do not target a hosted company URL.

## Phase 4: panel and authentication acceptance

Use a clean browser profile and record screenshots with personal data hidden.

1. Open `/register`, create a unique test owner, and reach the dashboard.
2. Sign out; sign in with one wrong password and confirm it is rejected without
   leaking whether unrelated users exist.
3. Sign in correctly and load Overview, Accounts, API Docs, API Keys, MCP and
   Settings.
4. Confirm `/api/openapi.json` renders and the panel's API examples use the
   local test URL, not production.
5. Change `ALLOW_PUBLIC_REGISTRATION=false`, recreate web, and confirm a new
   private browser session cannot create a second owner.
6. Create a dedicated API key for acceptance. Save it only in the test
   password manager/secret variable, never the evidence file.
7. Call `/api/whoami` with that key and one tenant-scoped read endpoint; confirm
   no unauthenticated or cross-tenant access succeeds.

## Phase 5: real account connection and read-only API journey

Before connecting, confirm in writing that the creator test account and proxy
are designated for this test. Note the expected platform username only as a
redacted alias.

### OnlyFans journey

1. In Settings, save the funded captcha key and confirm its validation succeeds.
2. In Accounts, select OnlyFans, paste the dedicated proxy, and run **Test
   proxy**. Confirm exit country and IP are expected.
3. Connect with session cookies where practical; otherwise use credentials.
4. Complete OTP or face verification if requested. A challenge is not a test
   failure; a loop, lost parked challenge or leaked secret is.
5. Require the account to show **Connected**, correct platform, masked proxy
   and a recent connection time.
6. Use the API key to read account list, cached subscribers/fans, balance and
   earnings. Compare representative totals with the panel.
7. Run one bounded read-only refresh/sync, wait for completion and verify a
   corresponding event. Do not invoke any send, payout, price, post, upload,
   automation, webhook-test or delete route.

### Fansly journey

Fansly is part of the public product claim, so test it before launch or remove
untested Fansly launch claims. Connect a dedicated Fansly test account with
username/password or the documented auth-token header method. Require Connected
state, then repeat account list, cached subscribers/fans, balance/earnings and
one bounded read-only sync. Features marked unsupported by
`api/platform_features.py` must return the documented platform-not-supported
response, not a 500 and not an accidental OnlyFans request.

## Phase 6: persistence and scheduler acceptance

Record a non-sensitive fingerprint of the test state (account count, event
count and polling state), then:

```powershell
docker compose -p $Project restart
docker compose -p $Project ps
curl.exe --fail --silent --show-error http://127.0.0.1:5000/ready
```

Pass conditions after restart:

- owner login and dedicated API key still work;
- connected-account state, encrypted credentials/session, proxy and cached
  rows persist;
- polling setting and scheduled jobs persist;
- one scheduler starts and one account poll occurs—no duplicate events or
  duplicate captcha spend;
- dashboard SSE reconnects and receives a new event.

## Phase 7: MCP acceptance

Until MCP is a Compose service, run it from the disposable clone in a separate
PowerShell window with Node 20:

```powershell
Set-Location "$RunRoot\repo\mcp"
$env:BACKEND_URL='http://127.0.0.1:5000'
$env:PUBLIC_URL='http://127.0.0.1:8181/mcp'
$env:HOST='127.0.0.1'
$env:PORT='8181'
$env:INTER_SERVICE_TOKEN=(Get-Content ..\.env | Where-Object { $_ -like 'INTER_SERVICE_TOKEN=*' } | ForEach-Object { $_.Substring(20) })
npm ci
npm run build
npm start
```

The secret assignment stays in process memory; do not print it. In the original
window:

```powershell
curl.exe --fail --silent --show-error http://127.0.0.1:8181/health
curl.exe -i -X POST http://127.0.0.1:8181/mcp `
  -H 'Content-Type: application/json' `
  -H 'Accept: application/json, text/event-stream' `
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"unauthenticated-gate","version":"1"}}}'
```

The unauthenticated MCP request must be `401` with a `WWW-Authenticate`
challenge. Then use **Dashboard -> MCP -> Test connection** while signed in.
Require HTTP 200, a server identity and a tool count matching the committed MCP
coverage document.

Connect one real MCP client with the dedicated acceptance API key. Invoke:

1. `of_list_accounts`;
2. one cached read tool, such as cached subscribers or transactions;
3. a write-capable tool with `confirm=false`, and verify it returns a preview
   without changing state.

Leave the unsafe proxy toggle off. Review the MCP audit log and verify bearer
tokens and user-controlled text are redacted/marked as designed. Revoke the
dedicated MCP key and require the next request to fail after cache invalidation.

For ChatGPT/OAuth acceptance, additionally verify authorization-server
metadata, JWKS, protected-resource metadata, dynamic client registration, PKCE,
consent, issuer, audience and `of:read` scope using [mcp/OAUTH.md](mcp/OAUTH.md).

## Phase 8: outbound/no-phone-home acceptance

The static guard is necessary but not sufficient. Capture network activity
from a clean boot through registration, connection, sync and MCP reads.

Classify every outbound destination. Expected categories are:

- package registries and base-image registries during build only;
- OnlyFans and/or Fansly during the designated account journey;
- the designated proxy endpoint;
- the configured captcha provider during OnlyFans login;
- DNS/NTP and operator-configured webhook/integration destinations, if enabled.

After images are built, there must be no runtime request to
`theonlyapi.com`, `*.xcelerator.agency`, Stripe, analytics/telemetry collectors,
licence servers or any undeclared company infrastructure. Save the capture and
its SHA-256 hash privately. An unexplained destination blocks release.

## Phase 9: teardown run 1 safely

Identify the exact project-owned resources before deleting anything:

```powershell
docker ps -a --filter "label=com.docker.compose.project=$Project"
docker volume ls --filter "label=com.docker.compose.project=$Project"
```

The list must contain only this acceptance run. Then:

```powershell
docker compose -p $Project down --volumes --remove-orphans
docker ps -a --filter "label=com.docker.compose.project=$Project"
docker volume ls --filter "label=com.docker.compose.project=$Project"
```

Do not use `docker system prune --volumes`. Keep the redacted evidence outside
the disposable clone.

## Phase 10: clean-volume run 2

Create a second disposable directory, a new project name, new secrets and a new
owner account. Rebuild from the same approved commit; do not reuse run 1 images
without at least verifying their IDs and build provenance. Repeat Phases 2–9.

Run 2 must prove that success did not depend on a warm build cache, old SQLite
schema, saved platform session, pre-existing OAuth key or npm install. Record
the new named volume before connection and prove it did not exist beforehand.

## Phase 11: repository publication gate

Only after both runs pass:

1. verify `main` is the canonical/default branch and CI is green;
2. retain `master` until post-launch verification completes;
3. make `XceleratorCRM/onlyfans-api-open-source` public;
4. from a signed-out browser, verify README, LICENSE, CONTRIBUTING,
   `docker-compose.yml`, `.env.example`, `install.sh`, `AGENT-LAUNCH.md`, raw
   agent files, Issues and clone URLs resolve from `main`;
5. clone anonymously into a third empty directory and run the configuration
   preflight;
6. seed issue templates and only claims that were actually tested.

Do not include test evidence containing creator or infrastructure secrets in
the public repository.

## Phase 12: website staged release and rollback

Keep `NEXT_PUBLIC_OSS_PUBLIC=false` during staging. Build the reviewed website
release in a new timestamped server directory, using the current production
release as the base and overlaying only the reviewed open-source changes. Smoke
test it on an unused local port.

Before switching traffic, record:

- current `of-page.service` working directory and executable command;
- current systemd drop-in contents;
- previous staging-directory path;
- one-command rollback procedure and the person authorised to run it.

Once the GitHub repo is public and all URLs return 200, rebuild the site with:

```dotenv
NEXT_PUBLIC_OSS_PUBLIC=true
```

Apply the same build-time variable to the production service environment,
switch `of-page.service` to the new staging directory, reload systemd, restart
and verify:

- `/open-source` is visible and indexable;
- navbar and footer links work, including the 1280 px desktop navbar;
- pricing shows the self-hosted column and matching FAQs/JSON-LD;
- sitemap includes `/open-source`;
- SoftwareSourceCode JSON-LD points at the public `main` repository;
- `llms.txt` includes the self-hosting block;
- robots behavior allows crawling while page metadata permits indexing;
- every GitHub, raw agent, docs and community link resolves;
- the public clone command produces the approved commit lineage.

If a blocking check fails, restore the previous service directory and drop-in,
restart, and confirm the prior site is healthy. Do not improvise a partial live
fix while launch traffic is arriving.

## Final sign-off

All boxes are required unless the corresponding product claim is removed:

- [ ] CI tests, image build, no-phone-home guard, secret scan and production
      dependency audit pass on `main`.
- [ ] Docker run 1 passes from a fresh clone and fresh volume.
- [ ] Docker run 2 passes from a second fresh clone and fresh volume.
- [ ] OnlyFans real connection and bounded read-only sync pass.
- [ ] Fansly real connection and bounded read-only sync pass, or launch claims
      explicitly exclude it until tested.
- [ ] persistence, SSE and exactly-one-scheduler checks pass after restart.
- [ ] MCP handshake, tool list, safe read, dry-run write and key revocation pass.
- [ ] runtime outbound capture contains no phone-home/telemetry destination.
- [ ] public GitHub repository uses `main` and anonymous links/cloning work.
- [ ] staged website passes every gated-surface check.
- [ ] rollback is written down and exercised before announcement.

The release is live only after all required boxes have an evidence reference
and a named approver.
