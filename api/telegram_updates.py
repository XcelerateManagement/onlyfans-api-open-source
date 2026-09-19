#!/usr/bin/env python3
"""Telegram update intake — how a `/start <code>` gets back to us.

## The single-consumer problem

Telegram allows exactly ONE consumer of a bot's updates: either a registered
webhook, or a `getUpdates` poller. They are mutually exclusive (getUpdates
returns HTTP 409 while a webhook is set), and two pollers on one token steal
each other's updates non-deterministically, because `offset` acknowledges
updates globally for the bot rather than per-connection.

For the **shared platform bot** there is exactly one token for the whole
deployment, so this has to be answered at the process level. It is answerable
here, and the answer is load-bearing on a constraint that already exists:

  * `gunicorn.conf.py` sets `workers = 1` and its `on_starting` hook *raises*
    if `GUNICORN_WORKERS != 1`. The app cannot boot multi-process.
  * `preload_app = False`, so the scheduler that `crm_api` starts at import time
    lives in that one worker.
  * APScheduler's `job_defaults` set `max_instances: 1`, so this job never
    overlaps itself even if a poll runs long.

One process × one scheduler × one non-overlapping job = exactly one consumer.
That is not an assumption we are making, it is a constraint the deployment
already enforces for the scheduler, SSE hub, refresh_state and the rate limiter.
If that constraint is ever lifted, this poller has to move behind the same
external coordination as the other four — the docstring in gunicorn.conf.py is
the right place to find that out.

Two consequences we handle explicitly rather than hope about:

  * **A webhook registered on the shared bot** would 409 every poll forever, and
    the symptom is "pairing silently never completes". `claim_shared_bot()`
    calls deleteWebhook once at startup, and a 409 afterwards is logged as an
    error and stored on `telegram_bot_state.last_error`.
  * **A second process on the same token** (e.g. a dev box with the production
    `TELEGRAM_SHARED_BOT_TOKEN` in its .env) genuinely does steal updates, and
    no in-process mechanism can detect it. The shared bot is therefore opt-in
    via env and off by default; a deployment that has not set the token refuses
    shared-mode pairing with an explicit error instead of pretending to work.

## Custom bots

A tenant's own bot is a different token per panel, so a permanent poller each
would not scale and — worse — would fight whatever the tenant runs against
their own bot. So custom bots are polled ONLY while that panel has an
unexpired, unused pairing code outstanding (`list_crms_with_open_telegram_pairings`),
which is bounded by TELEGRAM_PAIRING_TTL_SECONDS. Outside the pairing window we
never touch their updates.

Short poll, not long poll: `getUpdates` is called with `timeout=0`, so the
scheduler thread is held for one round-trip rather than parked for 25s at a
time. The only updates we care about are `/start` pairings, where a couple of
seconds of latency is invisible.
"""

from __future__ import annotations

import logging

import config
import crm_database as db
from integrations.telegram import (
    TelegramError,
    delete_webhook,
    get_updates,
    send_message,
)

logger = logging.getLogger(__name__)

_shared_claimed = False


def shared_token() -> str | None:
    return getattr(config, 'TELEGRAM_SHARED_BOT_TOKEN', None)


def shared_username() -> str | None:
    return getattr(config, 'TELEGRAM_SHARED_BOT_USERNAME', None)


def is_shared_token(candidate: str | None) -> bool:
    """Constant-time-ish check used to refuse the platform token wherever a
    tenant can supply one of their own. A tenant holding the shared token could
    otherwise read every other tenant's pairing traffic."""
    import hmac
    tok = shared_token()
    if not tok or not candidate:
        return False
    return hmac.compare_digest(tok, candidate.strip())


def deep_link(bot_username: str, code: str) -> str:
    return f'https://t.me/{bot_username}?start={code}'


def claim_shared_bot() -> None:
    """Take ownership of the shared bot's update channel. Idempotent, best
    effort, runs once per process at scheduler start."""
    global _shared_claimed
    token = shared_token()
    if not token or _shared_claimed:
        return
    _shared_claimed = True
    try:
        delete_webhook(token)
        logger.info('telegram: claimed getUpdates on the shared bot')
    except Exception as e:
        logger.warning('telegram: could not clear a webhook on the shared bot '
                       '(pairing may not work): %s', e)


def _parse_start_command(update: dict) -> tuple[str, dict] | None:
    """Extract (code, chat) from a `/start <code>` message, or None."""
    msg = update.get('message') or update.get('channel_post') or {}
    text = (msg.get('text') or '').strip()
    if not text.startswith('/start'):
        return None
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return None
    # "/start@MyBot code" is what Telegram delivers in groups.
    code = parts[1].strip().split()[0]
    chat = msg.get('chat') or {}
    if not code or chat.get('id') is None:
        return None
    return code, chat


def _chat_label(chat: dict) -> str:
    return (chat.get('title') or chat.get('username')
            or ' '.join(x for x in (chat.get('first_name'), chat.get('last_name')) if x)
            or str(chat.get('id')))


def _handle_update(update: dict, token: str, only_crm_id: str | None = None) -> bool:
    """Resolve one update. Returns True if it completed a pairing."""
    parsed = _parse_start_command(update)
    if not parsed:
        return False
    code, chat = parsed

    # Ownership check BEFORE consuming. The code is single-use, so redeeming
    # first and validating after would mean anyone who learns a code can burn
    # it by replaying it into a bot they control — a denial of service on the
    # legitimate pairing, from a message we were never going to accept anyway.
    owner = db.peek_telegram_pairing_code(code)
    if owner and only_crm_id and owner != only_crm_id:
        # A code issued for a different panel arrived on this panel's own bot.
        # Cannot happen through the UI; refuse rather than cross-wire two
        # tenants' notifications, and leave the code intact for its real owner.
        logger.warning('telegram: pairing code for %s arrived on %s\'s bot — refused',
                       owner, only_crm_id)
        return False

    crm_id = db.redeem_telegram_pairing_code(code)
    if not crm_id:
        # Unknown, already-used or expired code. Tell the human — a silent
        # no-op here is indistinguishable from a broken integration.
        try:
            send_message(token, chat['id'],
                         '⚠️ That pairing link is no longer valid. Generate a new '
                         'one from your dashboard under Settings → Telegram.')
        except Exception:
            pass
        return False

    integration = db.get_telegram_integration(crm_id)
    if not integration:
        logger.warning('telegram: pairing code redeemed for %s but no integration row', crm_id)
        return False

    db.bind_telegram_chat(crm_id, chat['id'],
                          chat_title=_chat_label(chat), chat_type=chat.get('type'))
    logger.info('telegram: paired panel %s to chat %s', crm_id, chat['id'])
    try:
        send_message(token, chat['id'],
                     '✅ Connected. This chat will now receive your CRM panel '
                     'notifications.')
    except Exception:
        logger.warning('telegram: paired %s but the confirmation message failed', crm_id)
    return True


def poll_token(token: str, *, only_crm_id: str | None = None) -> int:
    """Drain pending updates for one bot token. Returns pairings completed.

    The offset is persisted per token fingerprint BEFORE handling, so a crash
    mid-batch loses at most that batch instead of replaying it forever.
    """
    fingerprint = db.token_fingerprint(token)
    offset = db.get_telegram_offset(fingerprint)
    try:
        updates = get_updates(token, offset=offset, limit=100, long_poll_seconds=0)
    except TelegramError as e:
        db.set_telegram_offset(fingerprint, offset, error=str(e))
        if e.conflict:
            logger.error(
                'telegram: getUpdates returned 409 — another consumer owns this '
                'bot (a webhook is registered, or a second poller is running). '
                'Pairing cannot complete until that is resolved.')
        else:
            logger.warning('telegram: getUpdates failed: %s', e)
        return 0
    except Exception as e:
        db.set_telegram_offset(fingerprint, offset, error=str(e))
        logger.exception('telegram: getUpdates raised')
        return 0

    if not updates:
        db.set_telegram_offset(fingerprint, offset)
        return 0

    highest = max(int(u.get('update_id', 0)) for u in updates)
    db.set_telegram_offset(fingerprint, highest + 1)

    paired = 0
    for update in updates:
        try:
            if _handle_update(update, token, only_crm_id=only_crm_id):
                paired += 1
        except Exception:
            logger.exception('telegram: failed to handle update %s', update.get('update_id'))
    return paired


def poll_custom_bots() -> int:
    """Poll the custom bots of panels with an open pairing code."""
    paired = 0
    try:
        crm_ids = db.list_crms_with_open_telegram_pairings()
    except Exception:
        logger.exception('telegram: could not list open pairings')
        return 0
    for crm_id in crm_ids:
        try:
            integration = db.get_telegram_integration(crm_id)
            if not integration or (integration.get('bot_mode') or 'shared') != 'custom':
                continue   # shared-mode pairings are covered by the shared poll
            token = db.get_telegram_bot_token(integration)
            if not token:
                continue
            paired += poll_token(token, only_crm_id=crm_id)
        except Exception:
            logger.exception('telegram: custom-bot poll failed for %s', crm_id)
    return paired


def drain() -> int:
    """Scheduler entry point. Cheap no-op when there is nothing to consume."""
    paired = 0
    token = shared_token()
    open_pairings = []
    try:
        open_pairings = db.list_crms_with_open_telegram_pairings()
    except Exception:
        logger.exception('telegram: could not list open pairings')

    if not token and not open_pairings:
        return 0

    if token:
        claim_shared_bot()
        paired += poll_token(token)
    if open_pairings:
        paired += poll_custom_bots()
    return paired
