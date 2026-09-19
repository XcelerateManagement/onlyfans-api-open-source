#!/usr/bin/env python3
"""HMAC-signed webhook delivery with retry.

Events are dispatched synchronously to matching webhooks. Failures schedule
retries on a schedule: [5s, 30s, 5m, 30m, 2h]. After 5 consecutive failures
for a given webhook, it is auto-deactivated so it stops wasting requests.

A periodic ``deliver_due`` call is scheduled by ``scheduler.py`` to pick up
pending deliveries whose ``next_retry_at`` has arrived.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets as _secrets
import sqlite3
import time
import traceback
from datetime import datetime, timedelta

import requests  # stdlib-shim: uses `requests` library (already transitively available via flask-cors deps)

import crm_database as db
from outbound_guard import is_safe_outbound_url

RETRY_SCHEDULE_SECONDS = [5, 30, 300, 1800, 7200]
MAX_ATTEMPTS = len(RETRY_SCHEDULE_SECONDS) + 1  # 6 total attempts
DELIVERY_TIMEOUT = 5  # seconds


def _sign(secret: str, timestamp: str, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    digest = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _build_payload(event: dict) -> dict:
    return {
        'id': event['id'],
        'event_type': event['event_type'],
        'crm_id': event['crm_id'],
        'of_user_id': event.get('of_user_id'),
        'occurred_at': event.get('occurred_at'),
        'payload': event.get('payload', {}),
    }


def deliver_one(webhook: dict, event: dict, attempt: int = 1) -> bool:
    """Send a single delivery. Returns True on 2xx, False otherwise.
    Schedules retry on failure via the deliveries table."""
    payload = _build_payload(event)
    body = json.dumps(payload, separators=(',', ':'), default=str).encode()
    timestamp = str(int(time.time()))
    signature = _sign(webhook['secret'], timestamp, body)
    delivery_id = _secrets.token_hex(8)
    headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'TheOnlyAPI-Webhook/1.0',
        'X-OnlyAPI-Signature': signature,
        'X-OnlyAPI-Timestamp': timestamp,
        'X-OnlyAPI-Event': event['event_type'],
        'X-OnlyAPI-Delivery-Id': delivery_id,
    }

    status = 'failed'
    response_code = None
    snippet = ''
    terminal_fail = False  # set True for failures we shouldn't retry (e.g. redirects)

    # SSRF guard — never deliver to loopback/private/link-local/etc. Even with
    # admin approval, an attacker who escalates could otherwise pivot to
    # internal services (Redis, metadata, RFC1918 hosts). Mark the delivery
    # failed terminally so we don't retry into the same disallowed target.
    safe, reason = is_safe_outbound_url(webhook['url'])
    if not safe:
        db.record_webhook_delivery(
            webhook_id=webhook['id'],
            event_id=event.get('id'),
            status='failed',
            response_code=None,
            response_snippet=f'blocked: {reason}'[:1000],
            attempt=attempt,
            completed=True,
        )
        return False

    try:
        # allow_redirects=False — the guard at line 75 only validates the
        # original URL. A 30x from an attacker-controlled host (passing the
        # guard) could otherwise redirect into 127.0.0.1, the AWS metadata
        # service, or any internal target, with the signed payload in tow.
        resp = requests.post(
            webhook['url'], data=body, headers=headers,
            timeout=DELIVERY_TIMEOUT, allow_redirects=False,
        )
        response_code = resp.status_code
        snippet = (resp.text or '')[:1000]
        if 200 <= resp.status_code < 300:
            status = 'success'
        elif 300 <= resp.status_code < 400:
            # Treat redirects as terminal failure — don't retry into the
            # Location, because that may be an SSRF pivot.
            location = resp.headers.get('Location', '')[:200]
            snippet = f"redirect refused: status={resp.status_code} location={location}"
            terminal_fail = True
    except requests.exceptions.RequestException as e:
        snippet = f"request error: {e}"[:1000]
    except Exception as e:
        snippet = f"unexpected error: {e}"[:1000]

    if status == 'success':
        db.record_webhook_delivery(
            webhook_id=webhook['id'],
            event_id=event.get('id'),
            status='success',
            response_code=response_code,
            response_snippet=snippet,
            attempt=attempt,
            completed=True,
        )
        return True

    # Schedule retry if we still have attempts left AND the failure is not
    # terminal (terminal_fail means we deliberately refuse to retry — e.g.,
    # webhook target tried to redirect us, which is an SSRF risk).
    next_retry_at = None
    if attempt < MAX_ATTEMPTS and not terminal_fail:
        delay = RETRY_SCHEDULE_SECONDS[min(attempt - 1, len(RETRY_SCHEDULE_SECONDS) - 1)]
        next_retry_at = (datetime.utcnow() + timedelta(seconds=delay)).isoformat()
        db.record_webhook_delivery(
            webhook_id=webhook['id'],
            event_id=event.get('id'),
            status='pending',
            response_code=response_code,
            response_snippet=snippet,
            attempt=attempt,
            next_retry_at=next_retry_at,
            completed=False,
        )
    else:
        db.record_webhook_delivery(
            webhook_id=webhook['id'],
            event_id=event.get('id'),
            status='failed',
            response_code=response_code,
            response_snippet=snippet,
            attempt=attempt,
            completed=True,
        )
    return False


def enqueue_event(event: dict) -> int:
    """Fan out an event to every matching active webhook. Deliveries are sent
    synchronously on the first attempt; failures enqueue retries."""
    sent = 0
    for webhook in db.matching_webhooks(event['crm_id'], event['event_type']):
        try:
            deliver_one(webhook, event, attempt=1)
            sent += 1
        except Exception:
            traceback.print_exc()
    return sent


def deliver_due():
    """Pick up pending deliveries whose retry time has passed and re-attempt."""
    now_iso = datetime.utcnow().isoformat()
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    # w.status is aliased — d.* already has a `status` column and dict(Row)
    # would silently let the webhook's value shadow the delivery's.
    cur.execute('''SELECT d.*, w.url, w.secret, w.crm_id AS webhook_crm_id,
                          w.is_active, w.status AS webhook_status
                   FROM webhook_deliveries d
                   JOIN webhooks w ON w.id = d.webhook_id
                   WHERE d.status = 'pending' AND d.next_retry_at <= ?
                   ORDER BY d.id ASC LIMIT 50''', (now_iso,))
    due = [dict(r) for r in cur.fetchall()]
    conn.close()

    for row in due:
        # `is_active` covers auto-deactivation; `status` covers admin review.
        # Checking only the former meant a webhook an admin had just REJECTED
        # kept draining its queued retries for up to 2h down the ladder, even
        # though matching_webhooks() was already refusing it new events.
        approved = (row.get('webhook_status') or 'approved') == 'approved'
        if not row.get('is_active') or not approved:
            # Webhook was deactivated or is not admin-approved — mark failed
            conn = sqlite3.connect(db.DB_FILE)
            cur = conn.cursor()
            cur.execute('UPDATE webhook_deliveries SET status = ?, completed_at = ? WHERE id = ?',
                        ('failed', now_iso, row['id']))
            conn.commit()
            conn.close()
            continue

        # Rebuild event from stored event_id
        event_row = None
        if row.get('event_id'):
            conn = sqlite3.connect(db.DB_FILE)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute('SELECT * FROM account_events WHERE id = ?', (row['event_id'],))
            er = cur.fetchone()
            conn.close()
            if er:
                event_row = dict(er)
                try:
                    event_row['payload'] = json.loads(event_row['payload']) if event_row.get('payload') else {}
                except Exception:
                    event_row['payload'] = {}

        if not event_row:
            # Event vanished — mark failed, move on
            conn = sqlite3.connect(db.DB_FILE)
            cur = conn.cursor()
            cur.execute('UPDATE webhook_deliveries SET status = ?, completed_at = ? WHERE id = ?',
                        ('failed', now_iso, row['id']))
            conn.commit()
            conn.close()
            continue

        # Close the old pending row then re-attempt with attempt+1
        conn = sqlite3.connect(db.DB_FILE)
        cur = conn.cursor()
        cur.execute('UPDATE webhook_deliveries SET status = ?, completed_at = ? WHERE id = ?',
                    ('superseded', now_iso, row['id']))
        conn.commit()
        conn.close()

        webhook = db.get_webhook(row['webhook_crm_id'], row['webhook_id'])
        if not webhook:
            continue
        try:
            deliver_one(webhook, event_row, attempt=int(row['attempt']) + 1)
        except Exception:
            traceback.print_exc()
