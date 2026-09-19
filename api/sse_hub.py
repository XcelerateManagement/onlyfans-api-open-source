#!/usr/bin/env python3
"""In-process SSE subscriber registry.

Each subscriber gets its own Queue keyed by crm_id. ``broadcast`` fans out a
serialized event to every subscriber of that CRM. ``stream`` is a generator
suitable for returning as a Flask ``Response`` with mimetype
``text/event-stream``; it sends a keep-alive comment every ``HEARTBEAT_SECONDS``
so proxies and browsers don't drop the connection.
"""

from __future__ import annotations

import json
import queue
import threading
import time
from typing import Dict, Set

HEARTBEAT_SECONDS = 15


class SSEHub:
    def __init__(self):
        self._lock = threading.Lock()
        self._subscribers: Dict[str, Set[queue.Queue]] = {}

    def subscribe(self, crm_id: str) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self._lock:
            self._subscribers.setdefault(crm_id, set()).add(q)
        return q

    def unsubscribe(self, crm_id: str, q: queue.Queue) -> None:
        with self._lock:
            subs = self._subscribers.get(crm_id)
            if subs and q in subs:
                subs.remove(q)
                if not subs:
                    self._subscribers.pop(crm_id, None)

    def broadcast(self, crm_id: str, event: dict) -> None:
        with self._lock:
            subs = list(self._subscribers.get(crm_id, ()))
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                # Drop events for slow consumers — they'll just miss updates
                pass

    def stream(self, crm_id: str, types=None):
        """Generator that yields SSE-formatted bytes for one subscriber.

        types: optional set/list of event_type strings — events outside the
        set are dropped server-side (heartbeats still flow). None = all."""
        type_filter = set(types) if types else None
        q = self.subscribe(crm_id)
        try:
            # Initial handshake comment so client knows stream is live
            yield b": connected\n\n"
            last_heartbeat = time.time()
            while True:
                try:
                    event = q.get(timeout=1.0)
                except queue.Empty:
                    event = None
                if event is not None and type_filter is not None \
                        and event.get('event_type') not in type_filter:
                    event = None
                if event is not None:
                    etype = event.get('event_type', 'message')
                    data = json.dumps(event, default=str)
                    eid = event.get('id') or ''
                    chunk = f"event: {etype}\n".encode() + \
                            (f"id: {eid}\n".encode() if eid else b"") + \
                            f"data: {data}\n\n".encode()
                    yield chunk
                if time.time() - last_heartbeat >= HEARTBEAT_SECONDS:
                    yield b": keep-alive\n\n"
                    last_heartbeat = time.time()
        finally:
            self.unsubscribe(crm_id, q)


hub = SSEHub()
