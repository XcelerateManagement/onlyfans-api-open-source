#!/usr/bin/env python3
"""Panel-level Telegram delivery.

One channel per CRM panel (``telegram_integrations``, UNIQUE on crm_id), fed
from ``event_bus.emit`` alongside SSE / webhooks / automations. This is the
"send my panel's notifications to Telegram" path; the per-automation
``telegram`` action still exists and is unaffected.

Three properties this module is responsible for:

1. **The token never goes through a template evaluator.** The automation path
   runs the whole ``action_params`` dict — bot token included — through
   ``automation_engine._render_deep``. Here the message is rendered from the
   event by ``format_event`` and the token is fetched separately, straight from
   the encrypted column, at send time. There is no code path where the two meet.

2. **A Telegram outage can never break event emission.** ``notify_event``
   catches everything. An event that fails to reach Telegram is still persisted,
   still broadcast on SSE, still delivered to webhooks, and the HTTP request or
   poll cycle that produced it still succeeds.

3. **Repeated failure disables the channel** rather than burning a request per
   event forever — the same 5-strikes rule webhooks use
   (``crm_database.record_webhook_delivery``). Re-enabling from the dashboard
   resets the counter.
"""

from __future__ import annotations

import logging

import config
import crm_database as db
from integrations.telegram import TelegramError, send_message

logger = logging.getLogger(__name__)

_EVENT_LABELS = {
    'new_subscriber':     ('🎉', 'New subscriber'),
    'renewed_subscriber': ('🔁', 'Subscription renewed'),
    'expired_subscriber': ('👋', 'Subscriber expired'),
    'new_tip':            ('💸', 'New tip'),
    'new_message':        ('💬', 'New message'),
    'new_purchase':       ('🛒', 'New purchase'),
    'balance_increased':  ('📈', 'Balance increased'),
    'payout_completed':   ('🏦', 'Payout completed'),
    'polling_paused':     ('⚠️', 'Polling paused'),
}


def format_event(event: dict) -> str:
    """Render a Telegram message for an event.

    Deliberately hand-built from known fields instead of reusing the automation
    templating: values here come from the platform (a fan can set their display
    name to anything) and templating attacker-controlled strings is exactly the
    class of bug ``_render_template`` was hardened against. Nothing in this
    function interprets the payload — it only reads named keys.
    """
    etype = event.get('event_type') or 'event'
    payload = event.get('payload') or {}
    icon, label = _EVENT_LABELS.get(etype, ('🔔', etype))

    lines = [f'{icon} {label}']

    fan = payload.get('fan') or {}
    fan_label = fan.get('username') or fan.get('display_name')
    if fan_label:
        lines.append(f'Fan: {fan_label}')

    amount = payload.get('amount')
    if amount not in (None, ''):
        lines.append(f'Amount: ${amount}')

    for key, human in (('previous_balance', 'Was'), ('new_balance', 'Now'),
                       ('delta', 'Change'), ('reason', 'Reason')):
        if payload.get(key) not in (None, ''):
            lines.append(f'{human}: {payload[key]}')

    text = payload.get('text')
    if isinstance(text, str) and text.strip():
        lines.append(text.strip()[:500])

    if event.get('of_user_id'):
        lines.append(f'Account: {event["of_user_id"]}')

    return '\n'.join(lines)


def deliver(integration: dict, text: str) -> None:
    """Send one message on a panel's channel. Raises on failure."""
    token = db.get_telegram_bot_token(integration)
    if not token:
        mode = integration.get('bot_mode') or 'shared'
        raise TelegramError(
            'Shared Telegram bot is not configured on this deployment '
            '(TELEGRAM_SHARED_BOT_TOKEN)' if mode == 'shared'
            else 'Stored bot token could not be decrypted')
    chat_id = integration.get('chat_id')
    if not chat_id:
        raise TelegramError('Telegram channel is not paired to a chat yet')
    send_message(token, chat_id, text)


def notify_event(event: dict) -> bool:
    """Fan one event out to the panel's Telegram channel, if it has one.

    Returns True when a message was sent. Never raises — see property 2 in the
    module docstring.
    """
    crm_id = event.get('crm_id')
    if not crm_id:
        return False
    try:
        integration = db.matching_telegram_integration(crm_id, event.get('event_type'))
    except Exception:
        logger.exception('telegram: could not load integration for %s', crm_id)
        return False
    if not integration:
        return False

    try:
        deliver(integration, format_event(event))
    except Exception as e:
        try:
            after = db.record_telegram_delivery(
                crm_id, success=False, error=str(e),
                max_failures=config.TELEGRAM_MAX_CONSECUTIVE_FAILURES)
            if after and not after.get('is_active'):
                logger.error('telegram: channel for %s auto-deactivated after %s '
                             'consecutive failures (last: %s)',
                             crm_id, after.get('consecutive_failures'), e)
            else:
                logger.warning('telegram: delivery to %s failed: %s', crm_id, e)
        except Exception:
            logger.exception('telegram: could not record failure for %s', crm_id)
        return False

    try:
        db.record_telegram_delivery(crm_id, success=True)
    except Exception:
        logger.exception('telegram: could not record success for %s', crm_id)
    return True


def send_test(crm_id: str) -> dict:
    """"Send a test message" from the dashboard.

    Uses the same deliver()/bookkeeping path as a real event so a green result
    here actually proves the live path works, not a parallel one.
    """
    integration = db.get_telegram_integration(crm_id)
    if not integration:
        return {'success': False, 'error': 'No Telegram integration configured'}
    if not integration.get('chat_id'):
        return {'success': False, 'error': 'Not paired to a Telegram chat yet'}
    try:
        deliver(integration, '✅ Test message from your CRM panel.\n'
                             'Notifications are wired up correctly.')
    except Exception as e:
        db.record_telegram_delivery(crm_id, success=False, error=str(e),
                                    max_failures=config.TELEGRAM_MAX_CONSECUTIVE_FAILURES)
        return {'success': False, 'error': str(e)}
    db.record_telegram_delivery(crm_id, success=True)
    return {'success': True}
