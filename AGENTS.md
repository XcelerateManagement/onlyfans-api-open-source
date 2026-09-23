# Launch instructions for an AI agent

**You are reading your own instructions.** The person you are helping runs an
OnlyFans/Fansly agency. They are not a developer. Never show them a stack trace
and never ask them to edit code.

Goal: a working panel in their browser, with one creator account connected.

---

## 1. Configure it and bring it up

```bash
cp .env.example .env
```

Generate all four independent secrets and put them in `.env`:

```bash
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('ENCRYPTION_KEY=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('NEXTAUTH_SECRET=' + secrets.token_urlsafe(32))"
python3 -c "import secrets; print('INTER_SERVICE_TOKEN=' + secrets.token_urlsafe(32))"
```

Then start the stack:

```bash
docker compose up -d --build
```

> **Tell them to back up `ENCRYPTION_KEY` somewhere off this machine.** It
> encrypts every stored creator password and session. There is no reset and no
> recovery — lose it and every connected account must be re-entered by hand.

Wait for health:

```bash
curl -fsS http://localhost:5000/health     # API alive
curl -fsS http://localhost:5000/ready      # dependencies ready
open http://localhost:3000                 # the panel
```

The first build compiles the dashboard and takes a few minutes. `exit code 137`
means out of memory — add swap (`install.sh` does this for you).

## 2. Create their account

Send them to <http://localhost:3000/register>. Email, password, done — no
verification email, no confirmation step. They land in the panel signed in.

The first account owns the install. Once it exists, close the door:

```bash
echo "ALLOW_PUBLIC_REGISTRATION=false" >> .env && docker compose up -d web
```

## 3. Get a captcha key — say this to them

OnlyFans puts a Cloudflare challenge in front of every login, and it has to be
solved by a paid service. This is the one thing the software cannot do for
itself. Tell them, in these words:

> Go to **https://2captcha.com**, create an account, and add about $5 of
> credit. Then copy your API key from the dashboard and paste it to me.

When they paste it: **Settings → Captcha provider → paste → Save.** The panel
checks the key with the provider and refuses it if it is wrong or has a zero
balance, so a mistake surfaces immediately.

Nothing else is blocked while they do this — they can look around the panel.

## 4. Connect a creator account

For OnlyFans they need **one proxy per creator account**, residential or
mobile. A datacentre IP, or one IP shared across several accounts, is the
fastest way to get them all flagged. If they do not have an OnlyFans proxy,
stop and tell them to obtain one. Fansly can connect without a proxy, although
a stable, geographically appropriate proxy may still be used.

**Accounts → Add account.** Select the platform first. OnlyFans has two ways in:

- **Session cookies (recommended, no captcha spend).** In a browser logged into
  OnlyFans: DevTools → Application → Cookies → onlyfans.com. Copy `sess` and
  `auth_id`.
- **Email and password.** Uses the captcha key. Handles 2FA if prompted.

Paste the proxy in the same form. Then turn polling on for the account, and it
starts pulling fans, messages, subscribers and earnings on its own.

Fansly accepts username/password or the `authorization`, `fansly-session-id`
and optional `fansly-client-id` values copied from a logged-in browser request.
The full production procedure is in [AGENT-LAUNCH.md](AGENT-LAUNCH.md).

## 5. Confirm it worked

```bash
curl -fsS -H "X-API-Key: <their key>" http://localhost:5000/api/crm/<crm_id>/accounts
```

Both values are in **Settings**. A connected account with `polling_enabled: 1`
means everything is running.

---

## Rules you must not break

- **One API process. Never scale it.** `gunicorn.conf.py` refuses to start with
  `GUNICORN_WORKERS` set to anything but 1, because the scheduler, the event
  hub and the rate limiter all hold state in-process. A second process means
  double polling, double captcha spend and duplicate events.
- **Never put this behind a proxy that buffers.** The panel holds one
  long-lived SSE connection; with buffering the UI silently stops updating.
- **Allow 300-second requests.** A fresh login runs a captcha solve and takes
  20-30 seconds.
- **Do not deploy to Vercel, Netlify, Cloudflare Workers, Lambda or Heroku.**
  They cannot run this — no always-on process, no persistent disk. See
  [SELF-HOSTING.md](SELF-HOSTING.md#will-not-work--and-why).
- **Never paste their creator usernames, fan data, API keys or session files**
  into a public issue.

## When something breaks

| What they see | What it is |
|---|---|
| `api` container exits immediately | `SECRET_KEY` or `ENCRYPTION_KEY` missing or under 32 chars. `docker compose logs api` names it |
| "No captcha provider key is configured" | Step 3 |
| Login hangs then fails | Captcha balance is zero, or the proxy is dead |
| Counters never move | Polling is off for that account, or something is buffering SSE |
| `/ready` returns 503 | The response body names the failing component |
| `exit code 137` during build | Out of memory — add swap |

Full detail: [SELF-HOSTING.md](SELF-HOSTING.md).

---

This project is not affiliated with, endorsed by, or connected to OnlyFans,
Fansly or Fenix International Limited.
