#!/usr/bin/env python3
"""Send a direct message as an automation action (OnlyFans or Fansly).

Gated behind the ``allow_of_write_actions`` per-account toggle — if not set,
this raises and the automation logs a skipped run. OF sends ride the same
signed request path as the transparent proxy; Fansly sends resolve the fan's
messaging group (Fansly's send endpoint keys on groupId, not the fan's
account id) and go through fansly_data's send_message.

Expected params:
    message: text template (pre-rendered by the engine)
    to_fan_id: optional; defaults to event.payload.fan.id
"""

from __future__ import annotations

import crm_database as db
from of_client import handle_of_request


def _resolve_fansly_group_id(crm_id: str, account_id: str, fan_id: str,
                             proxy=None) -> str:
    """Find the messaging groupId for a fan via GET /api/v1/messaging/groups."""
    import fansly_client
    ok, data, status, _ = fansly_client.handle_fansly_request(
        crm_id, account_id, '/api/v1/messaging/groups', method='GET', proxy=proxy)
    if not ok:
        raise RuntimeError(
            f'Fansly DM failed: could not list messaging groups (HTTP {status}): '
            f'{str(data)[:200]}')
    resp = data.get('response') if isinstance(data, dict) else None
    for conv in ((resp or {}).get('data') or []):
        if not isinstance(conv, dict):
            continue
        partner = conv.get('partnerAccountId') or conv.get('accountId')
        if partner is not None and str(partner) == str(fan_id):
            group_id = conv.get('groupId') or conv.get('id')
            if group_id is not None:
                return str(group_id)
    raise RuntimeError(
        f'Fansly DM failed: no messaging group found for fan {fan_id} '
        '(the fan has no conversation with this account yet)')


def _send_fansly(crm_id: str, account_id: str, fan_id: str, message: str) -> None:
    import fansly_data
    account = db.get_of_account(crm_id, account_id)
    proxy = (account or {}).get('proxy')
    group_id = _resolve_fansly_group_id(crm_id, account_id, fan_id, proxy=proxy)
    status, body = fansly_data.fetch(crm_id, account_id, 'send_message', {
        'groupId': group_id,
        'text': message,
    }, proxy=proxy)
    if status != 200 or not (isinstance(body, dict) and body.get('success')):
        raise RuntimeError(f'Fansly DM failed (HTTP {status}): {str(body)[:200]}')


def send(crm_id: str, of_user_id: str, params: dict, event: dict) -> None:
    if not crm_id or not of_user_id:
        raise ValueError('send_dm requires crm_id and of_user_id')

    polling = db.get_account_polling(crm_id, of_user_id)
    if not polling or not polling.get('allow_of_write_actions'):
        raise PermissionError(
            'send_dm blocked: account has allow_of_write_actions=false. '
            'Enable it on the account before using DM automations.'
        )

    message = params.get('message')
    if not message:
        raise ValueError('send_dm requires message')

    fan_id = params.get('to_fan_id') or (event.get('payload') or {}).get('fan', {}).get('id')
    if not fan_id:
        raise ValueError('send_dm requires a fan id (via to_fan_id or event.payload.fan.id)')

    # Platform branch: a Fansly account has no OF session — the OF path below
    # would fail 'No session found' forever. Same write-gate applies to both.
    account = db.get_of_account(crm_id, of_user_id)
    if (account or {}).get('platform') == 'fansly':
        _send_fansly(crm_id, str(of_user_id), str(fan_id), message)
        return

    path = f'/api2/v2/chats/{fan_id}/messages'
    body = {'text': message, 'lockedText': False, 'price': 0, 'mediaFiles': []}
    ok, data, status, _ = handle_of_request(crm_id, of_user_id, path, method='POST', body=body)
    if not ok:
        raise RuntimeError(f'OF DM failed (HTTP {status}): {str(data)[:200]}')
