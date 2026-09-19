"""Outbound alerts to OUR operations channel — not to a tenant's.

Distinct from `telegram_notify`, which delivers a panel's own events to a chat
that panel paired. This is the other direction: a tenant telling us something
is broken. Different bot, different chat, different trust boundary — a tenant
must never be able to aim this at an arbitrary chat, so the destination comes
only from the environment.

The transport is deliberately the same shape canary_tokens.py already uses
(stdlib urllib, short timeout, failures swallowed and logged). Alerting must
never be able to break or slow the request that triggered it.
"""

from __future__ import annotations

import json
import os
import urllib.request

TIMEOUT_SECONDS = float(os.environ.get('OPS_ALERT_TIMEOUT_SECONDS', 5))


def _config():
    token = os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = (
        os.environ.get('TELEGRAM_OPS_CHAT_ID')
        or os.environ.get('TELEGRAM_STATUS_CHAT_ID')
        or os.environ.get('TELEGRAM_HONEYPOT_CHAT_ID')
    )
    return token, chat_id


def available() -> bool:
    """Whether a report can actually be delivered.

    Checked before offering the button: a 'Report to admin' control that
    silently does nothing is worse than not having one."""
    token, chat_id = _config()
    return bool(token and chat_id)


def _escape(s) -> str:
    return (str(s or '')
            .replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def send(text: str) -> bool:
    token, chat_id = _config()
    if not token or not chat_id:
        print('[ops_alerts] no bot token / chat id configured; dropping alert',
              flush=True)
        return False
    try:
        body = json.dumps({
            'chat_id': chat_id,
            'text': text[:3900],
            'parse_mode': 'HTML',
            'disable_web_page_preview': True,
        }).encode('utf-8')
        req = urllib.request.Request(
            f'https://api.telegram.org/bot{token}/sendMessage',
            data=body, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        print(f'[ops_alerts] send failed: {e}', flush=True)
        return False


def report_error(*, crm_id, panel_name, reporter, error, note=None) -> bool:
    """Format and deliver a user-submitted error report."""
    lines = [
        '🐞 <b>User reported an API error</b>',
        '',
        f'<b>Panel:</b> {_escape(panel_name or "—")} '
        f'(<code>{_escape(crm_id)}</code>)',
        f'<b>Reported by:</b> {_escape(reporter or "unknown")}',
        '',
        f'<b>{_escape(error.get("method"))} {_escape(error.get("route"))}</b>',
        f'<b>Status:</b> {_escape(error.get("status_code"))}'
        + (f' · <code>{_escape(error.get("error_code"))}</code>'
           if error.get('error_code') else ''),
        f'<b>When:</b> {_escape(error.get("occurred_at"))} UTC',
    ]
    if error.get('latency_ms') is not None:
        lines.append(f'<b>Took:</b> {_escape(error.get("latency_ms"))} ms')
    if error.get('of_user_id'):
        lines.append(f'<b>Account:</b> <code>{_escape(error.get("of_user_id"))}</code>')
    if error.get('message'):
        lines += ['', f'<b>Message:</b> {_escape(error.get("message"))}']
    if note:
        lines += ['', f'<b>User note:</b> {_escape(note)}']
    body = error.get('body')
    if body:
        # The body is the part an engineer actually reads, so it gets the room
        # that is left rather than a token preview.
        lines += ['', '<pre>' + _escape(body[:1200]) + '</pre>']
    return send('\n'.join(lines))
