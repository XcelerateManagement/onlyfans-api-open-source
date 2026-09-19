#!/usr/bin/env python3
"""Slack incoming-webhook integration."""

from __future__ import annotations

import requests

from .discord import _default_message


def send(params: dict, event: dict) -> None:
    url = params.get('url')
    if not url:
        raise ValueError('Slack action requires url')
    text = params.get('message') or _default_message(event)
    resp = requests.post(url, json={'text': text[:3000]}, timeout=5)
    if not (200 <= resp.status_code < 300):
        raise RuntimeError(f'Slack webhook returned {resp.status_code}: {resp.text[:200]}')
