# Security policy

## Reporting a vulnerability

**Do not open a public issue.**

Use GitHub's
[private vulnerability reporting](https://github.com/XcelerateManagement/onlyfans-api-open-source/security/advisories/new)
on this repository. This creates a private report visible only to the reporter and
repository administrators. Do not send vulnerability details through Telegram,
the public contact form, an issue, or a pull request.

Include a reproduction and the release or commit you tested. We acknowledge within 3
working days and aim to ship a fix within 30 days for anything we rate high or
critical, coordinating disclosure with you.

There is no bug bounty — saying so plainly, because silence implies one. We will credit
you in the advisory and the release notes unless you would rather we did not.

## Supported versions

The latest release only. Security fixes ship as a new release on `main`, never as a
backport to an older tag.

## In scope

The code in this repository — the API, the dashboard, the packaging and the install
script.

Findings we treat as high or critical by default:

- **Cross-tenant data access** — any path where one `crm_id` can read another's data.
- **Authentication bypass** on the API-key, NextAuth or OAuth surfaces.
- Anything causing a stored platform session, `ENCRYPTION_KEY`, or a decrypted account
  password to leave the process by an unintended route.
- **Remote code execution**, including through the Node signer subprocess.
- **Webhook HMAC forgery.**

## Out of scope

- **That this software automates a platform which would rather it did not.** That is
  the product, not a vulnerability.
- Attacks requiring `ENCRYPTION_KEY`, `SECRET_KEY` or root on the host. If the attacker
  has those, the game was already over.
- Rate-limit bypass on an install you control. Flask-Limiter uses in-process memory
  storage by design — see the single-instance constraint in
  [SELF-HOSTING.md](SELF-HOSTING.md#the-single-instance-constraint). Documented, not
  accidental.
- Missing security headers on `/health` or `/ready`.
- Self-XSS, clickjacking on unauthenticated pages, and scanner output with no
  demonstrated impact.
- Third-party services you configure: your captcha provider, your proxy vendor, your
  host.

This policy covers the code in this repository. A finding that only affects one
operator's own deployment — their proxy, their host, their configuration — is
theirs to fix, not a vulnerability in the project.

## Testing rules

Do not test against creator accounts you do not own or manage, and do not test against
our production infrastructure. We will not pursue anyone acting in good faith within
the scope above, and we would much rather hear about a problem awkwardly than not at
all.

## Hardening your own install

See [SELF-HOSTING.md](SELF-HOSTING.md) and
[docs/SECURITY-HARDENING.md](docs/SECURITY-HARDENING.md). Two things matter more than
everything else combined:

1. **Close public registration** once your owner account exists — set
   `ALLOW_PUBLIC_REGISTRATION=false` and restart `web`. Registration is
   email-and-password with no confirmation step, so until you close it anyone
   who can reach the dashboard can mint themselves a panel.
2. **Keep `ENCRYPTION_KEY` backed up somewhere that is not the server it runs on.**
   There is no recovery path.
