#!/usr/bin/env python3
"""Generic outbound webhook integration for the automation engine.

This is distinct from the first-party `/api/crm/<crm>/webhooks` resource
(which is signed and retried by `webhook_delivery.py`). This handler is for
ad-hoc per-automation HTTP POSTs — fire once, no retries.

Expected params:
    url: the target URL (http(s)://)
    method: GET/POST/PUT/PATCH/DELETE — default POST
    headers: optional dict of additional headers
    body: optional JSON-serializable body. Templated by automation_engine
          before this is called, so {payload.amount}-style tokens are
          already rendered when we receive them.
"""

from __future__ import annotations

import json
import requests

from outbound_guard import is_safe_outbound_url


def send(params: dict, event: dict) -> None:
    url = params.get('url')
    if not url:
        raise ValueError('Webhook action requires url')
    if not (url.startswith('http://') or url.startswith('https://')):
        raise ValueError('Webhook url must start with http:// or https://')

    # SSRF guard — without this, any tenant can create an automation whose
    # action POSTs to 127.0.0.1, 169.254.169.254 (cloud metadata), or any
    # RFC1918 internal service. Unlike the first-party webhook surface there
    # is no admin approval gate here, so the check has to live at send time.
    safe, reason = is_safe_outbound_url(url)
    if not safe:
        raise ValueError(f'Webhook url blocked: {reason}')

    method = (params.get('method') or 'POST').upper()
    headers = {'Content-Type': 'application/json', 'User-Agent': 'theonlyapi-automation/1.0'}
    if isinstance(params.get('headers'), dict):
        headers.update({str(k): str(v) for k, v in params['headers'].items()})

    body = params.get('body')
    if body is None:
        body = {
            'event_type': event.get('event_type'),
            'crm_id': event.get('crm_id'),
            'of_user_id': event.get('of_user_id'),
            'occurred_at': event.get('occurred_at'),
            'payload': event.get('payload') or {},
        }
    if not isinstance(body, (str, bytes)):
        body = json.dumps(body, default=str)

    resp = requests.request(method, url, data=body, headers=headers, timeout=5)
    if not (200 <= resp.status_code < 300):
        raise RuntimeError(f'Webhook {method} {url} returned {resp.status_code}: {resp.text[:200]}')
