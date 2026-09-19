#!/usr/bin/env python3
"""In-memory cache for the earnings summary endpoint.

Aggregating earnings across many accounts is expensive (N * 3 HTTP calls to
OF per period change). We cache the computed summary keyed on
(crm_id, period) with period-specific TTLs — "today" can reasonably be
refreshed often, "month" data barely moves.

Invalidation: ``invalidate(crm_id)`` drops every period for that CRM. Called
by ``event_bus`` when an event that changes a reported number is emitted
(``new_tip``, ``new_purchase``, ``balance_increased``, ``new_subscriber``,
``renewed_subscriber``), and by ``fansly_sync.run_fansly_scheduled_refresh``
when a Fansly ledger/wallet refresh changed something (it emits no events).
"""

from __future__ import annotations

import threading
import time
from typing import Any

_CACHE: dict[tuple[str, str], dict[str, Any]] = {}
_LOCK = threading.Lock()

# Period → TTL seconds. Today refreshes every 2min, week 5min, month 15min.
_TTL = {
    "today": 120,
    "week": 300,
    "month": 900,
}
_DEFAULT_TTL = 300


def get(crm_id: str, period: str) -> dict | None:
    key = (crm_id, period)
    with _LOCK:
        entry = _CACHE.get(key)
    if not entry:
        return None
    if entry["expires_at"] <= time.time():
        with _LOCK:
            _CACHE.pop(key, None)
        return None
    return entry["data"]


def put(crm_id: str, period: str, data: dict) -> None:
    ttl = _TTL.get(period, _DEFAULT_TTL)
    entry = {
        "data": data,
        "created_at": time.time(),
        "expires_at": time.time() + ttl,
        "ttl": ttl,
    }
    with _LOCK:
        _CACHE[(crm_id, period)] = entry


def invalidate(crm_id: str) -> int:
    """Drop every cached period for this CRM. Returns the number of entries
    removed. Safe to call from any thread (e.g. from event_bus emit)."""
    removed = 0
    with _LOCK:
        for key in list(_CACHE.keys()):
            if key[0] == crm_id:
                _CACHE.pop(key, None)
                removed += 1
    return removed


def stats() -> dict:
    """Snapshot of the cache — useful for debugging."""
    with _LOCK:
        return {
            "entries": len(_CACHE),
            "keys": [
                {
                    "crm_id": k[0],
                    "period": k[1],
                    "age_seconds": round(time.time() - v["created_at"], 1),
                    "ttl_remaining": round(v["expires_at"] - time.time(), 1),
                }
                for k, v in _CACHE.items()
            ],
        }
