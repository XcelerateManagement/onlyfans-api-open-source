#!/usr/bin/env python3
"""
Real-time OnlyFans WebSocket listener (per account).

OnlyFans exposes a realtime socket (`wss://ws2.onlyfans.com/ws3/<shard>`). When
a fan subscribes through a tracking link or sends a tip, the event arrives here
in seconds — far faster than the polling cycle. This module maintains ONE
persistent connection per account and maps the events we care about onto the
existing `event_bus.emit()` so everything downstream (SSE → dashboard chime,
webhooks, automations) fires unchanged.

Protocol (reverse-engineered + verified live — see memory theonlyapi-of-websocket):
  1. GET /api2/v2/users/ws-auth  -> {wsUrl, wsAuthToken}  (token JWT, ~24h)
  2. websockets.connect(wsUrl, Origin: https://onlyfans.com, Chrome UA), DIRECT.
     (curl_cffi does NOT work for the WS upgrade — use the `websockets` lib.)
  3. send {"act":"connect","token":<token>} -> server: {"connected":true,...}
  4. keepalive {"act":"get_onlines","ids":[]} every ~20s.
  Inbound new-subscriber: {"subscribed":{"user":{id,username,name,avatar},"timestamp":<unix>}}
  Inbound tip:            {"api2_chat_message":{isTip:true, price:<n>, fromUser:{...}, id, createdAt}}

Threading: the `websockets` lib is asyncio, the rest of the backend is
sync/threaded. We isolate the event loop inside one daemon thread per account
(scheduler spawns it). The only crossing point is `event_bus.emit()`, which is
thread-safe (SSE hub uses a Queue).
"""
from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone

import of_client
import crm_database as db
import event_bus

try:
    import websockets
except ImportError:  # pragma: no cover - lib is in the venv
    websockets = None

logger = logging.getLogger(__name__)

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36")
_KEEPALIVE_SECONDS = 20
_RECONNECT_MIN = 3
_RECONNECT_MAX = 120
# A fresh ws-auth token lasts ~24h; refresh well before that on each reconnect,
# and force a reconnect every TOKEN_TTL to rotate it proactively.
_TOKEN_TTL_SECONDS = 18 * 3600


def _unix_to_iso(ts) -> str:
    try:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    except (ValueError, TypeError, OSError):
        return datetime.now(tz=timezone.utc).isoformat()


class AccountWSListener:
    """One persistent OF websocket connection for a single account."""

    def __init__(self, crm_id: str, of_user_id: str):
        self.crm_id = crm_id
        self.of_user_id = str(of_user_id)
        self._stop = threading.Event()
        # In-memory dedup so the triple-frame subscribe (subscribed +
        # new_message + toasts) only emits once, and a recent event isn't
        # re-emitted across a reconnect. Keyed by source_event_id, time-bounded.
        self._seen: dict[str, float] = {}

    def stop(self) -> None:
        self._stop.set()

    # ---- dedup ----------------------------------------------------------
    def _is_dupe(self, key: str) -> bool:
        now = time.time()
        # prune entries older than 10 min
        if len(self._seen) > 500:
            for k, t in list(self._seen.items()):
                if now - t > 600:
                    self._seen.pop(k, None)
        if key in self._seen and now - self._seen[key] < 600:
            return True
        self._seen[key] = now
        return False

    # ---- event mapping --------------------------------------------------
    def _on_subscribed(self, obj: dict) -> None:
        """Map a `subscribed` frame -> new_subscriber event (poller-compatible)."""
        user = (obj.get("subscribed") or {}).get("user") or {}
        fan_id = user.get("id")
        if not fan_id:
            return
        ts_iso = _unix_to_iso((obj.get("subscribed") or {}).get("timestamp"))
        sid = f"sub:{fan_id}:{ts_iso}"
        # Dedup on fan_id alone (within the 10-min window) — a single subscribe
        # arrives as 3 frames (subscribed / new_message / toasts) whose
        # timestamps can differ by a second, so keying on ts would let dupes
        # through. One sub per fan per window is the right granularity here.
        if self._is_dupe(f"sub:{fan_id}"):
            return
        try:
            db.upsert_fan(
                self.crm_id, self.of_user_id, fan_id,
                username=user.get("username"),
                display_name=user.get("name") or user.get("displayName"),
                avatar=user.get("avatar"),
            )
        except Exception:
            logger.exception("ws upsert_fan failed %s/%s", self.crm_id, self.of_user_id)
        try:
            campaign_ids = db.get_fan_campaign_ids(self.crm_id, self.of_user_id, fan_id)
        except Exception:
            campaign_ids = []
        payload = {
            "fan": {
                "id": fan_id,
                "username": user.get("username"),
                "display_name": user.get("name") or user.get("displayName"),
                "avatar": user.get("avatar"),
            },
            "price": None,
            "regular_price": None,
            "subscribed_at": ts_iso,
            "expire_at": None,
            "action": "subscribe",
            "campaign_ids": campaign_ids,
            "source": "ws",
        }
        event_bus.emit(
            self.crm_id, self.of_user_id, "new_subscriber", payload,
            source_event_id=sid, occurred_at=ts_iso,
        )
        logger.info("WS new_subscriber %s/%s fan=%s @%s",
                    self.crm_id, self.of_user_id, fan_id, user.get("username"))

    def _on_chat_message(self, obj: dict) -> None:
        """Map a tip (api2_chat_message with isTip) -> new_tip event."""
        m = obj.get("api2_chat_message") or {}
        if not m.get("isTip"):
            return
        msg_id = m.get("id")
        fu = m.get("fromUser") or {}
        fan_id = fu.get("id")
        if not msg_id or not fan_id:
            return
        sid = f"ws-tip:{msg_id}"
        if self._is_dupe(sid):
            return
        amount = m.get("price")
        created = m.get("createdAt") or datetime.now(tz=timezone.utc).isoformat()
        try:
            db.upsert_fan(
                self.crm_id, self.of_user_id, fan_id,
                username=fu.get("username"),
                display_name=fu.get("name") or fu.get("displayName"),
                avatar=fu.get("avatar"),
            )
        except Exception:
            pass
        try:
            campaign_ids = db.get_fan_campaign_ids(self.crm_id, self.of_user_id, fan_id)
        except Exception:
            campaign_ids = []
        payload = {
            "fan": {
                "id": fan_id,
                "username": fu.get("username"),
                "display_name": fu.get("name") or fu.get("displayName"),
                "avatar": fu.get("avatar"),
            },
            "amount": amount,
            "net": None,        # WS doesn't carry net; tx-poll supplies the real net
            "currency": "USD",
            "tx_type": "tip",
            "status": "ws",     # not a confirmed ledger row — flags WS origin
            "created_at": created,
            "campaign_ids": campaign_ids,
            "source": "ws",
        }
        event_bus.emit(
            self.crm_id, self.of_user_id, "new_tip", payload,
            source_event_id=sid, occurred_at=created,
        )
        logger.info("WS new_tip %s/%s fan=%s amount=%s",
                    self.crm_id, self.of_user_id, fan_id, amount)

    def _dispatch(self, raw: str) -> None:
        try:
            obj = json.loads(raw)
        except (ValueError, TypeError):
            return
        if not isinstance(obj, dict):
            return
        if "subscribed" in obj:
            self._on_subscribed(obj)
        elif "api2_chat_message" in obj:
            self._on_chat_message(obj)
        elif "new_message" in obj and (obj.get("new_message") or {}).get("type") == "subscribed":
            # alternate subscribe frame — reuse the same path via the user blob
            nm = obj["new_message"]
            user = nm.get("user") or {}
            if user.get("id"):
                self._on_subscribed({"subscribed": {"user": user,
                                                    "timestamp": int(time.time())}})

    # ---- connection -----------------------------------------------------
    async def _connect_once(self) -> None:
        """One connect → listen cycle. Returns when the socket closes/errors."""
        ok, data, status, _ = of_client.handle_of_request(
            self.crm_id, self.of_user_id, "/api2/v2/users/ws-auth", method="GET")
        if not ok or not isinstance(data, dict) or not data.get("wsUrl"):
            logger.warning("ws-auth failed %s/%s status=%s",
                           self.crm_id, self.of_user_id, status)
            raise RuntimeError("ws-auth failed")
        url, token = data["wsUrl"], data["wsAuthToken"]
        async with websockets.connect(
            url,
            additional_headers={"Origin": "https://onlyfans.com", "User-Agent": _UA},
            open_timeout=20, ping_interval=20, ping_timeout=20, close_timeout=5,
        ) as ws:
            await ws.send(json.dumps({"act": "connect", "token": token}))
            logger.info("WS connected %s/%s (%s)", self.crm_id, self.of_user_id, url)
            last_ka = time.time()
            session_start = time.time()
            while not self._stop.is_set():
                # rotate token / reconnect proactively before it expires
                if time.time() - session_start > _TOKEN_TTL_SECONDS:
                    logger.info("WS token rotation %s/%s", self.crm_id, self.of_user_id)
                    return
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    raw = None
                except Exception:
                    return  # socket closed/errored → outer loop reconnects
                if raw:
                    self._dispatch(raw if isinstance(raw, str)
                                   else raw.decode("utf-8", "replace"))
                if time.time() - last_ka > _KEEPALIVE_SECONDS:
                    try:
                        await ws.send(json.dumps({"act": "get_onlines", "ids": []}))
                        last_ka = time.time()
                    except Exception:
                        return

    async def _run_async(self) -> None:
        backoff = _RECONNECT_MIN
        while not self._stop.is_set():
            try:
                await self._connect_once()
                backoff = _RECONNECT_MIN  # clean return (token rotation) → reconnect fast
            except Exception as e:
                logger.warning("WS cycle failed %s/%s: %s — retry in %ss",
                               self.crm_id, self.of_user_id, e, backoff)
                # interruptible sleep
                for _ in range(backoff):
                    if self._stop.is_set():
                        break
                    await asyncio.sleep(1)
                backoff = min(_RECONNECT_MAX, backoff * 2)
        logger.info("WS listener stopped %s/%s", self.crm_id, self.of_user_id)

    def run(self) -> None:
        """Blocking entry point — run inside a daemon thread."""
        if websockets is None:
            logger.error("websockets lib not installed; WS listener disabled")
            return
        try:
            asyncio.run(self._run_async())
        except Exception:
            logger.exception("WS listener crashed %s/%s", self.crm_id, self.of_user_id)
