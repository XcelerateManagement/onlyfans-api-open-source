#!/usr/bin/env python3
"""Rule-based automation engine.

An automation binds (trigger_event, conditions) to an action. When an event is
emitted, we find matching active automations, check that every condition
passes against the event payload, then dispatch to the corresponding action
handler.

Condition format (list of AND'd rules):
    [{"field": "payload.amount", "op": "gt", "value": 5}, ...]

Supported operators: eq, neq, gt, gte, lt, lte, contains, in, startswith.
"""

from __future__ import annotations

import traceback
from typing import Any

import crm_database as db
from integrations.discord import send as send_discord
from integrations.slack import send as send_slack
from integrations.telegram import send as send_telegram
from integrations.of_dm import send as send_of_dm
from integrations.webhook import send as send_webhook


def _get_field(obj: Any, path: str):
    cur = obj
    for part in path.split('.'):
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def _check_condition(cond: dict, event: dict) -> bool:
    field = cond.get('field')
    op = cond.get('op', 'eq')
    expected = cond.get('value')
    actual = _get_field(event, field) if field else None
    try:
        if op == 'eq':
            return actual == expected
        if op == 'neq':
            return actual != expected
        if op == 'gt':
            return actual is not None and actual > expected
        if op == 'gte':
            return actual is not None and actual >= expected
        if op == 'lt':
            return actual is not None and actual < expected
        if op == 'lte':
            return actual is not None and actual <= expected
        if op == 'contains':
            return expected in (actual or '')
        if op == 'startswith':
            return isinstance(actual, str) and actual.startswith(str(expected))
        if op == 'in':
            return actual in (expected or [])
    except Exception:
        return False
    return False


def _evaluate_conditions(conditions, event) -> bool:
    if not conditions:
        return True
    return all(_check_condition(c, event) for c in conditions)


def _render_template(text: str, event: dict) -> str:
    """Minimal ``{event.payload.foo}`` style interpolation.

    Builds the result piecewise (rather than mutating ``result`` in place) so
    a rendered value containing ``{...}`` is NOT re-scanned as another token.
    Without this guard, an attacker-controlled string in the event payload
    (e.g. an OF fan's display name set to ``{payload.crm_id}``) would expand
    server-side."""
    if not text or not isinstance(text, str):
        return text or ''
    parts: list[str] = []
    i = 0
    while i < len(text):
        start = text.find('{', i)
        if start < 0:
            parts.append(text[i:])
            break
        end = text.find('}', start)
        if end < 0:
            parts.append(text[i:])
            break
        parts.append(text[i:start])
        token = text[start + 1:end].strip()
        value = _get_field(event, token)
        parts.append('' if value is None else str(value))
        i = end + 1
    return ''.join(parts)


def _render_deep(value, event):
    """Apply mustache-lite templating recursively through dicts/lists/strings."""
    if isinstance(value, str):
        return _render_template(value, event)
    if isinstance(value, dict):
        return {k: _render_deep(v, event) for k, v in value.items()}
    if isinstance(value, list):
        return [_render_deep(v, event) for v in value]
    return value


# Action-param keys that hold a credential. These are passed through verbatim:
# a secret must never reach a template evaluator, because `{...}` inside one
# would be substituted (silently mangling it) and, more importantly, because
# "rendered" is one refactor away from "logged with its render trace". The
# panel-level Telegram channel avoids the problem structurally — its token is
# read from the encrypted column at send time and never lives in a params dict
# — but this path predates it and still carries tokens.
_SECRET_PARAM_KEYS = frozenset({'bot_token', 'secret', 'token', 'api_key', 'password'})


def _dispatch_action(automation: dict, event: dict) -> None:
    action = automation.get('action_type')
    raw_params = dict(automation.get('action_params') or {})
    secrets_held = {k: raw_params.pop(k) for k in list(raw_params)
                    if k in _SECRET_PARAM_KEYS}
    params = _render_deep(raw_params, event)
    params.update(secrets_held)

    if action == 'webhook':
        send_webhook(params, event)
    elif action == 'discord':
        send_discord(params, event)
    elif action == 'slack':
        send_slack(params, event)
    elif action == 'telegram':
        send_telegram(params, event)
    elif action == 'send_dm':
        send_of_dm(automation['crm_id'], automation.get('of_user_id') or event.get('of_user_id'),
                   params, event)
    elif action == 'tag_fan':
        tag = params.get('tag')
        fan_id = event.get('payload', {}).get('fan', {}).get('id') or params.get('fan_of_user_id')
        if tag and fan_id:
            db.add_fan_tag(
                automation['crm_id'],
                automation.get('of_user_id') or event.get('of_user_id'),
                fan_id, tag, added_by=f'automation:{automation["id"]}'
            )
    else:
        raise ValueError(f'Unknown action type: {action}')


def evaluate_event(event: dict) -> None:
    """Run all matching automations for an event. Failures are logged but
    never raised."""
    for automation in db.matching_automations(event['crm_id'], event.get('of_user_id'), event['event_type']):
        try:
            if not _evaluate_conditions(automation.get('conditions'), event):
                db.record_automation_run(automation['id'], event.get('id'), 'skipped',
                                         error_snippet='conditions not met')
                continue
            _dispatch_action(automation, event)
            db.record_automation_run(automation['id'], event.get('id'), 'success')
        except Exception as e:
            traceback.print_exc()
            db.record_automation_run(automation['id'], event.get('id'), 'failed',
                                     error_snippet=str(e))


def run_with_sample(crm_id: str, automation_id: int, sample_payload: dict | None = None) -> dict:
    """Feed a synthetic event through an automation for testing from the UI."""
    automation = db.get_automation(crm_id, automation_id)
    if not automation:
        raise ValueError('Automation not found')
    event = {
        'id': None,
        'crm_id': crm_id,
        'of_user_id': automation.get('of_user_id'),
        'event_type': automation['trigger_event'],
        'source_event_id': 'sample',
        'payload': sample_payload or {},
        'occurred_at': None,
    }
    if not _evaluate_conditions(automation.get('conditions'), event):
        db.record_automation_run(automation_id, None, 'skipped', 'conditions not met (sample)')
        return {'status': 'skipped', 'reason': 'conditions not met'}
    try:
        _dispatch_action(automation, event)
        db.record_automation_run(automation_id, None, 'success', 'sample run')
        return {'status': 'success'}
    except Exception as e:
        db.record_automation_run(automation_id, None, 'failed', str(e))
        return {'status': 'failed', 'error': str(e)}
