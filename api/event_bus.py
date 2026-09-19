#!/usr/bin/env python3
"""Event dispatcher: persist, deliver to webhooks, evaluate automations, broadcast via SSE."""

from __future__ import annotations

import traceback
from datetime import datetime

import crm_database as db
from sse_hub import hub


def emit(crm_id, of_user_id, event_type, payload, source_event_id=None, occurred_at=None):
    """Persist an event and fan it out. Returns the inserted event dict or None
    if deduplicated (same source_event_id already seen)."""
    event_id, is_new = db.insert_event(
        crm_id=crm_id,
        of_user_id=str(of_user_id) if of_user_id is not None else None,
        event_type=event_type,
        payload=payload or {},
        source_event_id=source_event_id,
        occurred_at=occurred_at,
    )
    if not is_new:
        return None

    event_obj = {
        'id': event_id,
        'crm_id': crm_id,
        'of_user_id': of_user_id,
        'event_type': event_type,
        'source_event_id': source_event_id,
        'payload': payload or {},
        'occurred_at': occurred_at or datetime.utcnow().isoformat(),
        'created_at': datetime.utcnow().isoformat(),
    }

    # Invalidate the earnings summary cache so the next dashboard load sees
    # the fresh number. Only for event types that move a number it reports:
    # money, and — since the summary carries the New Subs count — subscribers.
    # (The dashboard refetches on the subscriber events too; without this it
    # would just get the cached copy back.)
    if event_type in ("new_tip", "new_purchase", "balance_increased",
                      "new_subscriber", "renewed_subscriber"):
        try:
            import earnings_cache
            earnings_cache.invalidate(crm_id)
        except Exception:
            traceback.print_exc()

    # SSE broadcast first — cheap, non-blocking
    try:
        hub.broadcast(crm_id, event_obj)
    except Exception:
        traceback.print_exc()

    # Webhook fanout
    try:
        from webhook_delivery import enqueue_event
        enqueue_event(event_obj)
    except Exception:
        traceback.print_exc()

    # Panel-level Telegram channel. Same contract as the three above: it is one
    # more consumer of this single fan-out point, it honours its own event-type
    # filter (including the '*' wildcard webhooks use), and a Telegram outage
    # can only ever cost us this block — the event is already persisted and
    # broadcast by the time we get here.
    try:
        from telegram_notify import notify_event
        notify_event(event_obj)
    except Exception:
        traceback.print_exc()

    # Automations
    try:
        from automation_engine import evaluate_event
        evaluate_event(event_obj)
    except Exception:
        traceback.print_exc()

    return event_obj
