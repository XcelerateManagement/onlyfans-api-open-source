#!/usr/bin/env python3
"""Discord webhook integration.

Expected params:
    url: the Discord incoming-webhook URL
    message: the message body (supports {event.payload.X} tokens — pre-rendered
             by automation_engine)
    username: optional override
"""

from __future__ import annotations

import requests


def send(params: dict, event: dict) -> None:
    url = params.get('url')
    if not url:
        raise ValueError('Discord action requires url')

    message = params.get('message') or _default_message(event)
    payload = {'content': message[:1900]}
    if params.get('username'):
        payload['username'] = params['username']

    resp = requests.post(url, json=payload, timeout=5)
    if not (200 <= resp.status_code < 300):
        raise RuntimeError(f'Discord webhook returned {resp.status_code}: {resp.text[:200]}')


def _default_message(event: dict) -> str:
    etype = event.get('event_type')
    p = event.get('payload') or {}
    fan = p.get('fan') or {}
    fan_label = fan.get('username') or fan.get('display_name') or 'someone'
    if etype == 'new_tip':
        amount = p.get('amount')
        return f"💸 New tip from `{fan_label}`" + (f" — ${amount}" if amount else "")
    if etype == 'new_subscriber':
        return f"🎉 New subscriber: `{fan_label}`"
    if etype == 'renewed_subscriber':
        return f"🔁 `{fan_label}` renewed"
    if etype == 'new_purchase':
        amount = p.get('amount')
        return f"🛒 Purchase from `{fan_label}`" + (f" — ${amount}" if amount else "")
    if etype == 'new_message':
        return f"💬 New message from `{fan_label}`"
    return f"Event `{etype}`"
