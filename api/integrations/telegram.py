#!/usr/bin/env python3
"""Telegram Bot API client.

Two callers with different shapes live on top of this module:

* the per-automation ``telegram`` action — ``send(params, event)``, where the
  tenant pastes a bot token into the automation's ``action_params``;
* the panel-level notification channel — ``telegram_notify`` /
  ``telegram_updates``, which use the lower-level helpers below and keep the
  token in ``telegram_integrations.encrypted_bot_token`` instead.

Everything here takes the token as an argument and never reads or logs it. The
only place a token is allowed to appear in a string is the request URL, which is
how the Bot API is designed; errors raised from here carry the API's
``description``, never the URL.
"""

from __future__ import annotations

import requests

import config

from .discord import _default_message

API_ROOT = 'https://api.telegram.org'


def _timeout(extra: float = 0.0) -> float:
    return float(getattr(config, 'TELEGRAM_TIMEOUT_SECONDS', 5)) + extra


class TelegramError(RuntimeError):
    """A call to api.telegram.org failed or was rejected.

    ``conflict`` is True for HTTP 409, which the Bot API returns when another
    consumer already owns this bot's updates (a webhook is registered, or a
    second getUpdates poller is running). That case is not retryable and needs
    an operator, so it is distinguishable rather than folded into the generic
    error — see the module docstring in telegram_updates.py.
    """

    def __init__(self, message: str, *, status: int | None = None,
                 conflict: bool = False):
        super().__init__(message)
        self.status = status
        self.conflict = conflict


def api_call(bot_token: str, method: str, params: dict | None = None,
             *, http_method: str = 'post', timeout_extra: float = 0.0) -> dict:
    """Call one Bot API method and return its ``result``.

    Raises TelegramError on transport failure, non-2xx, or ``ok: false``.
    """
    if not bot_token:
        raise TelegramError('No bot token configured')
    url = f'{API_ROOT}/bot{bot_token}/{method}'
    try:
        if http_method == 'get':
            resp = requests.get(url, params=params or {}, timeout=_timeout(timeout_extra))
        else:
            resp = requests.post(url, json=params or {}, timeout=_timeout(timeout_extra))
    except requests.exceptions.RequestException as e:
        raise TelegramError(f'Telegram request failed: {e}') from e

    try:
        body = resp.json()
    except Exception:
        body = {}

    if not (200 <= resp.status_code < 300) or not body.get('ok'):
        description = body.get('description') or (resp.text or '')[:200]
        raise TelegramError(
            f'Telegram {method} failed ({resp.status_code}): {description}',
            status=resp.status_code,
            conflict=resp.status_code == 409,
        )
    return body.get('result')


def get_me(bot_token: str) -> dict:
    """Validate a token and learn the bot's @username (needed for deep links)."""
    return api_call(bot_token, 'getMe', http_method='get') or {}


def send_message(bot_token: str, chat_id, text: str) -> dict:
    return api_call(bot_token, 'sendMessage', {
        'chat_id': chat_id,
        'text': (text or '')[:3500],
        'disable_web_page_preview': True,
    }) or {}


def get_updates(bot_token: str, offset: int = 0, limit: int = 100,
                long_poll_seconds: int = 0) -> list[dict]:
    """Short-poll by default (``long_poll_seconds=0`` returns immediately).

    ``offset`` doubles as the acknowledgement of everything below it — passing
    ``last_update_id + 1`` is what stops Telegram re-serving updates we have
    already handled, and is why the offset has to be persisted.
    """
    params: dict = {'limit': int(limit), 'timeout': int(long_poll_seconds)}
    if offset:
        params['offset'] = int(offset)
    result = api_call(bot_token, 'getUpdates', params,
                      timeout_extra=float(long_poll_seconds))
    return result or []


def delete_webhook(bot_token: str, drop_pending_updates: bool = False) -> None:
    """Claim getUpdates for ourselves.

    A registered webhook makes every getUpdates call return 409 forever, and the
    symptom is "pairing just never completes" with nothing in our logs. Calling
    this once when we take ownership of a bot converts that silent dead-end into
    a working poller.
    """
    api_call(bot_token, 'deleteWebhook',
             {'drop_pending_updates': bool(drop_pending_updates)})


def send(params: dict, event: dict) -> None:
    """Automation action handler. See EVENTS.md for the params shape."""
    token = params.get('bot_token')
    chat_id = params.get('chat_id')
    if not token or not chat_id:
        raise ValueError('Telegram action requires bot_token and chat_id')
    text = params.get('message') or _default_message(event)
    send_message(token, chat_id, text)


def list_groups(bot_token: str) -> list[dict]:
    """Fetch chats the bot has seen recently via getUpdates.

    Telegram bots can only see chats where they've received a message — there's
    no enumeration API. Returns unique {id, title, type} entries.

    NOTE: this consumes nothing (no offset is passed, so nothing is
    acknowledged), but it still competes for the same single-consumer channel.
    It must never be pointed at the shared platform bot — crm_api rejects that.
    """
    updates = get_updates(bot_token, offset=0, limit=100)
    seen: dict[int, dict] = {}
    for upd in updates:
        msg = upd.get('message') or upd.get('channel_post') or upd.get('edited_message') or {}
        chat = msg.get('chat') or {}
        cid = chat.get('id')
        if cid is None or cid in seen:
            continue
        seen[cid] = {
            'id': cid,
            'type': chat.get('type'),
            'title': chat.get('title') or chat.get('username') or chat.get('first_name') or str(cid),
        }
    return list(seen.values())
