"""Cloudflare Turnstile verification for OUR OWN signup widget.

Not to be confused with `captcha_solver.py` / `config.TURNSTILE_SITEKEY*`, which
*solve* OnlyFans' Turnstile during an account login. This module goes the other
way: it validates a token a human produced in the dashboard before we create an
account for them.

Why it exists
-------------
`POST /api/auth/register` and `POST /api/crm/register` are unauthenticated and
each one mints a CRM panel with `quota_override=1` (unlimited monthly API calls)
and a baseline of 10 account slots. The website's signup form is Turnstile-gated,
but the Flask endpoints behind it were not — so the captcha could be skipped
entirely by calling Flask directly, at the login-tier rate limit, from any IP.

Design note: a Turnstile token is single-use. The Next.js signup route already
redeems the token to show the user a friendly error, so it cannot forward that
same token here — Cloudflare would answer `timeout-or-duplicate`. That is why
`crm_api._require_human_or_service()` accepts *either* a valid service token
(proving the call came from our own frontend, which did the captcha) *or* a fresh
Turnstile token from a direct caller.

Env:
    TURNSTILE_SECRET_KEY  — server-side verification secret. Shared with the
                            Next app, so one Cloudflare widget backs both.
    CAPTCHA_BYPASS_TOKEN  — optional single magic token for dev/CI. Empty by
                            default, so the bypass is impossible unless set.
                            NEVER set this in production.
"""

from __future__ import annotations

import hmac
import logging
import os

import requests

VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
TIMEOUT_SECONDS = 10

logger = logging.getLogger(__name__)


def is_configured() -> bool:
    return bool(os.environ.get('TURNSTILE_SECRET_KEY'))


def verify(token: str | None, remote_ip: str | None = None) -> tuple[bool, str]:
    """Validate a Turnstile token.

    Returns (ok, reason). `reason` is a short machine-ish string for logging and
    for the API error body — never the raw Cloudflare payload, which can contain
    secrets in the error path.

    Mirrors the Next helper's behaviour deliberately, including failing **open**
    when no secret is configured: an unconfigured box (a fresh clone, CI, a
    worktree) must not have its signup flow silently bricked. Production sets the
    key, and then verification is strict.
    """
    secret = os.environ.get('TURNSTILE_SECRET_KEY')
    if not secret:
        logger.warning(
            'TURNSTILE_SECRET_KEY not set — skipping captcha verification. '
            'Set it in onlyfans-api/.env so registration is actually gated.'
        )
        return True, 'no_key_configured'

    # Dev/CI escape hatch. Constant-time compare so the value cannot be guessed
    # a byte at a time.
    bypass = os.environ.get('CAPTCHA_BYPASS_TOKEN')
    if bypass and token and hmac.compare_digest(str(token), bypass):
        logger.warning('captcha bypass token used — must never happen in production')
        return True, 'bypass'

    if not token:
        return False, 'missing_token'

    payload = {'secret': secret, 'response': token}
    if remote_ip:
        payload['remoteip'] = remote_ip

    try:
        resp = requests.post(VERIFY_URL, data=payload, timeout=TIMEOUT_SECONDS)
        data = resp.json()
    except Exception as exc:  # network, JSON, anything
        # Fail CLOSED. An attacker who can make Cloudflare unreachable should not
        # thereby gain unauthenticated account creation. Legitimate signups still
        # have the service-token path, which does not touch the network.
        logger.error('Turnstile verification failed to complete: %s', exc)
        return False, 'verification_unavailable'

    if data.get('success'):
        return True, 'ok'

    codes = data.get('error-codes') or []
    logger.info('Turnstile rejected a token: %s', codes)
    # `timeout-or-duplicate` means the token was already redeemed — the most
    # likely cause is a caller replaying a token the frontend already used.
    return False, ','.join(str(c) for c in codes) or 'rejected'
