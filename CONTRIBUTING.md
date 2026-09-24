# Contributing

Thanks for considering it. This project is maintained by a small team who also run the
hosted service, so the most useful thing you can do is be specific.

Pull requests are limited to project collaborators. If you are not already a
collaborator, open an issue first with the proposed change and why it is needed. A
maintainer can invite you when the scope has been agreed. Unsolicited patches sent by
other channels will not be reviewed.

## Before you open anything

| You have | Go here |
|---|---|
| A deployment that will not start | [Telegram](https://t.me/+SCLucm_6IEcwOGYx), or [SELF-HOSTING.md § Troubleshooting](SELF-HOSTING.md#troubleshooting) — much faster than an issue |
| A login or sync that broke today | [Platform change](https://github.com/xcelerate-management/onlyfans-api-open-source/issues/new?template=platform_breakage.yml) — the highest-value report here |
| A reproducible bug | [Bug report](https://github.com/xcelerate-management/onlyfans-api-open-source/issues/new?template=bug_report.yml) |
| A security vulnerability | **Not an issue.** See [SECURITY.md](SECURITY.md) |
| "Will you support Vercel / serverless?" | Read [SELF-HOSTING.md § Will not work](SELF-HOSTING.md#will-not-work--and-why) first |

## Never paste real data

No creator usernames, `crm_id` values, platform user IDs, fan identifiers, message
bodies, API keys or session blobs — in issues, pull requests, commit messages, test
fixtures or logs. Redact before you paste. We will edit or delete posts containing them
without waiting to ask, and doing it deliberately is an immediate ban.

`docker compose logs api --tail=200` is usually enough context once redacted.

## Sign your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/), the
same mechanism the Linux kernel uses. There is **no CLA and no copyright assignment**.
You keep the copyright in your contribution; you are certifying you have the right to
submit it under AGPL-3.0.

```bash
git commit -s -m "Add CapSolver adapter"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use a real name and an address you read. Forgot on an existing commit?
`git commit --amend -s`, or for a branch, `git rebase --signoff main`. CI checks this on
every pull request.

Because we cannot relicense your work without your permission, we also cannot quietly
close this project later. That constraint is deliberate.

## What we will merge

Platform fixes, new deploy targets, documentation, tests, dashboard UX, new event types,
automation connectors, and anything that makes a first install less painful.

## What we will not merge

- Anything adding a network call to a maintainer-controlled host, a licence
  check, or any analytics or telemetry endpoint. A self-hosted install must
  never phone home. CI enforces this in
  `.github/workflows/no-phone-home.yml`.
- Anything reintroducing metering, slot counting, plan tiers or usage tracking.
  There is no billing layer in this project and there will not be one; the same
  workflow fails the build if `count_api_call`, `api_limits` or `usage_tracker`
  reappear in source.
- Multi-worker "scaling" patches. `gunicorn.conf.py` raising on `GUNICORN_WORKERS != 1`
  is deliberate — the scheduler, the refresh store, the SSE hub and the rate limiter all
  hold authoritative in-process state. Externalising them into Redis or the database is
  a real project; open an issue and let's design it rather than sending a patch.
- Postgres patches covering only some of the SQLite-specific queries.
- Vendored copies of platform bundles or deobfuscated platform JavaScript.
- Bulk-signup or account-farming tooling, and anything that touches accounts the
  operator does not own or manage.

## Development setup

The backend is `api/`, the dashboard is `web/`, and the deployment files
(`Dockerfile`, `docker-compose.yml`, `.env.example`, `Caddyfile`, `install.sh`)
are at the repository root.

```bash
git clone https://github.com/xcelerate-management/onlyfans-api-open-source.git
cd onlyfans-api-open-source
cp .env.example .env          # fill in SECRET_KEY and ENCRYPTION_KEY (32+ chars each)

python -m venv .venv && . .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r api/requirements.txt
pip install ruff

ruff check api/               # lint
```

`TWOCAPTCHA_API_KEY` is optional — the stack starts without it and you only need
a key to connect a real OnlyFans account. The tests never call a captcha
provider.

Node 20 must be on `PATH` — `header_generator.py` shells out to
`onlyfans-sign-generator.js` for every signed request, and without it every signed call
fails.

### Running the tests

**The files in `api/tests/` are standalone scripts, not pytest modules.** Each
asserts as it imports and calls `sys.exit(1)` on failure. There is nothing for a
collector to discover, pytest is not a dependency, and `pytest tests/` will not
do what you want. Run them directly:

```bash
cd api
python tests/test_polling_default.py                                # one file
for t in tests/test_*.py; do python "$t" || echo "FAIL $t"; done    # all of them
```

On Windows, set `PYTHONIOENCODING=utf-8` first — the scripts print non-ASCII
status characters that the default console codepage cannot encode.

Minimum environment for a test run (any placeholder values will do; nothing
leaves the machine):

```bash
export SECRET_KEY=test-secret-key-at-least-32-characters-long
export ENCRYPTION_KEY=test-encryption-key-at-least-32-chars-long
export PYTHONIOENCODING=utf-8
```

`.github/workflows/tests.yml` runs every file the same way on each pull
request, collecting failures rather than stopping at the first.

For the dashboard:

```bash
cd web && npm install && npm run dev
npx tsc --noEmit              # type-check
```

## Review criteria worth knowing

- **One logical change per pull request.** A refactor bundled with a fix takes far
  longer to review than the two separately.
- **No module-level mutable state**, and never assume more than one API worker.
- **Tests for anything with a payload shape** — event types, webhook bodies, parsers.
- Imperative subject lines under ~72 characters, matching existing history
  (*"Restrict admin sign-in to allowlisted locations"*). No emoji prefixes.

## AI-assisted contributions

Allowed, and increasingly normal. The condition is that you have read every line and
can defend it in review. A pull request whose author cannot explain their own diff gets
closed.

## Response times

We aim to triage within a week. We are a small team and the hosted service pays for the
time. If a pull request goes quiet, ping the
[Telegram group](https://t.me/+SCLucm_6IEcwOGYx) — that is not rude, it is useful.
