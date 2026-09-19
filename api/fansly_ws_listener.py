#!/usr/bin/env python3
"""Real-time Fansly WebSocket listener (per account) — the Fansly analogue of
``ws_listener.py``.

Fansly exposes a realtime socket at ``wss://wsv3.fansly.com/?v=3``. Holding it
open also keeps the account marked "online". When a fan sends a DM the event
arrives here in seconds; we map it onto ``event_bus.emit`` so SSE, webhooks and
automations fire exactly as they do for OnlyFans.

Protocol (verified against the reference clients _wsraw.py / _online.py):
  1. websocket.create_connection("wss://wsv3.fansly.com/?v=3", browser headers +
     Cookie: f-d=<device>; fansly-d=<device>; <session cookies>)
  2. send  {"t":1,"d":"{\\"token\\":<auth_token>,\\"v\\":3}"}   (verify session)
     server replies with a frame containing "session" on success.
  3. keepalive: send the text "p" every ~5s.
  4. inbound message events are PROTOBUF (schema in
     assets/protos/websocket_events.txt → EventWrapper / ServiceEvent /
     EventContainerMessage / MessagesCreated / MessageMessage).

⚠️ VALIDATION STATUS: the connect/auth/keepalive lifecycle is confirmed by the
reference clients. The exact framing of *inbound* event payloads (raw binary
protobuf vs. base64 inside a JSON ``{t,d}`` envelope, and the wrapper nesting)
is NOT yet confirmed against live traffic — even the reference clients only
verify the session and hold the socket open without decoding events. The
decoder below is schema-driven and tolerant: it deep-scans any protobuf payload
for MessageMessage-shaped records, so it should survive the most likely framings,
but the dispatch path is gated behind FANSLY_WS_ENABLED and must be confirmed
once a real account is connected. Search for "VALIDATE" below.

Threading: ``websocket-client`` is synchronous; each listener owns one daemon
thread (the scheduler spawns it), mirroring the OF listener's lifecycle.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import config
import crm_database as db
import event_bus
import fansly_auth

try:
    import websocket  # websocket-client (sync)
except ImportError:  # pragma: no cover
    websocket = None

logger = logging.getLogger(__name__)

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36")
_PING_SECONDS = 5
_RECONNECT_MIN = 3
_RECONNECT_MAX = 120


def _ms_to_iso(ms) -> str:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).strftime(
            '%Y-%m-%dT%H:%M:%S+00:00')
    except (ValueError, TypeError, OSError, OverflowError):
        return datetime.now(tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')


# ───────────────────────── minimal protobuf reader ─────────────────────────
# Just enough wire-format parsing to walk the WebsocketEvents schema. No
# dependency on the protobuf runtime (the schema is tiny and stable).

def _read_varint(buf, pos):
    result = 0
    shift = 0
    while pos < len(buf):
        b = buf[pos]
        result |= (b & 0x7F) << shift
        pos += 1
        if not (b & 0x80):
            return result, pos
        shift += 7
    raise ValueError('truncated varint')


def _parse_fields(buf):
    """Parse a protobuf message into {field_number: [raw_value, ...]}.

    raw_value is an int for varint/fixed fields, or a `bytes` for
    length-delimited fields (string / embedded message / packed). Tolerant:
    returns whatever it parsed if it hits a malformed tail.
    """
    fields = {}
    pos = 0
    n = len(buf)
    while pos < n:
        try:
            tag, pos = _read_varint(buf, pos)
        except ValueError:
            break
        field_no = tag >> 3
        wire = tag & 0x07
        try:
            if wire == 0:          # varint
                val, pos = _read_varint(buf, pos)
            elif wire == 2:        # length-delimited
                length, pos = _read_varint(buf, pos)
                val = buf[pos:pos + length]
                pos += length
            elif wire == 1:        # 64-bit
                val = buf[pos:pos + 8]
                pos += 8
            elif wire == 5:        # 32-bit
                val = buf[pos:pos + 4]
                pos += 4
            else:                  # unknown wire type — stop
                break
        except (IndexError, ValueError):
            break
        fields.setdefault(field_no, []).append(val)
    return fields


def _as_text(val):
    if isinstance(val, (bytes, bytearray)):
        try:
            return val.decode('utf-8')
        except UnicodeDecodeError:
            return None
    return None


def _looks_like_message(fields):
    """Heuristic: a MessageMessage has a string `content` (field 5) and a
    numeric `senderId` (field 4). Used by the deep scan to recognise message
    records regardless of how the server wraps them."""
    content = fields.get(5)
    sender = fields.get(4)
    if not content or not sender:
        return False
    return _as_text(content[0]) is not None and isinstance(sender[0], int)


def _decode_message(fields):
    """Decode a MessageMessage field-map into a plain dict."""
    def _first_int(fno):
        v = fields.get(fno)
        return v[0] if v and isinstance(v[0], int) else None

    def _first_str(fno):
        v = fields.get(fno)
        return _as_text(v[0]) if v else None

    return {
        'id': _first_int(1),
        'groupId': _first_int(2),
        'type': _first_int(3),
        'senderId': _first_int(4),
        'content': _first_str(5),
        'createdAt': _first_int(7),
    }


def extract_messages(payload):
    """Deep-scan a protobuf payload (bytes) for MessageMessage-shaped records.

    Resilient to the exact wrapper nesting (EventWrapper → ServiceEvent →
    EventContainerMessage → MessagesCreated → MessageMessage). Recurses into
    every length-delimited sub-field and collects anything that looks like a
    message. Returns a list of decoded message dicts.
    """
    found = []
    seen_depth = 0

    def _walk(buf, depth):
        nonlocal seen_depth
        if depth > 8 or not buf:
            return
        seen_depth = max(seen_depth, depth)
        try:
            fields = _parse_fields(buf)
        except Exception:
            return
        if _looks_like_message(fields):
            found.append(_decode_message(fields))
        for vals in fields.values():
            for v in vals:
                if isinstance(v, (bytes, bytearray)) and len(v) >= 2:
                    _walk(v, depth + 1)

    if isinstance(payload, (bytes, bytearray)):
        _walk(payload, 0)
    return found


class FanslyAccountWSListener:
    """One persistent Fansly websocket connection for a single account."""

    def __init__(self, crm_id: str, account_id: str):
        self.crm_id = crm_id
        self.account_id = str(account_id)
        self._stop = threading.Event()
        self._seen: dict[str, float] = {}

    def stop(self) -> None:
        self._stop.set()

    # ---- dedup (10-min window, mirrors the OF listener) -----------------
    def _is_dupe(self, key: str) -> bool:
        now = time.time()
        if len(self._seen) > 500:
            for k, t in list(self._seen.items()):
                if now - t > 600:
                    self._seen.pop(k, None)
        if key in self._seen and now - self._seen[key] < 600:
            return True
        self._seen[key] = now
        return False

    # ---- event mapping --------------------------------------------------
    def _emit_message(self, msg: dict) -> None:
        """Map a decoded Fansly MessageMessage → new_message event.

        Skips messages the creator sent themselves (senderId == own account)."""
        sender_id = msg.get('senderId')
        if sender_id is None:
            return
        if str(sender_id) == self.account_id:
            return  # our own outbound message
        mid = msg.get('id')
        sid = f'fansly-msg:{mid}' if mid is not None else f'fansly-msg:{sender_id}:{msg.get("createdAt")}'
        if self._is_dupe(sid):
            return
        created = _ms_to_iso(msg.get('createdAt'))
        fan = {
            'id': str(sender_id),
            'username': None,   # WS frame carries only ids; enrich on next poll
            'display_name': None,
            'avatar': None,
        }
        try:
            db.upsert_fan(self.crm_id, self.account_id, str(sender_id))
        except Exception:
            pass
        payload = {
            'fan': fan,
            'text': msg.get('content') or '',
            'amount': None,
            'raw_type': 'message',
            'raw_subtype': 'new_message',
            'created_at': created,
            'group_id': str(msg.get('groupId')) if msg.get('groupId') is not None else None,
            'source': 'ws',
        }
        event_bus.emit(
            self.crm_id, self.account_id, 'new_message', payload,
            source_event_id=sid, occurred_at=created,
        )
        logger.info('Fansly WS new_message %s/%s from=%s',
                    self.crm_id, self.account_id, sender_id)

    def _dispatch(self, raw) -> None:
        """Handle one inbound frame (str control frame or bytes protobuf)."""
        # JSON control frames: session-verified / pong / error.
        if isinstance(raw, str):
            s = raw.strip()
            if not s or s == 'p':  # pong echo
                return
            try:
                obj = json.loads(s)
            except (ValueError, TypeError):
                return
            if isinstance(obj, dict):
                # {"t":<type>,"d":<payload>} — t==1 is the session frame; an
                # event payload may ride in `d` as base64 protobuf. VALIDATE.
                d = obj.get('d')
                if isinstance(d, str) and 'session' not in s:
                    try:
                        import base64
                        decoded = base64.b64decode(d, validate=False)
                        for m in extract_messages(decoded):
                            self._emit_message(m)
                    except Exception:
                        pass
            return
        # Binary protobuf frame.
        if isinstance(raw, (bytes, bytearray)):
            for m in extract_messages(bytes(raw)):
                self._emit_message(m)

    # ---- connection -----------------------------------------------------
    def _build_conn_args(self, session):
        """Build (url, header_list, proxy_kwargs) from a loaded Fansly session."""
        device_id = session.get('fansly_client_id') or ''
        cookies = session.get('session_cookies') or {}
        cookie_parts = [f'{k}={v}' for k, v in cookies.items()]
        cookie_parts += [f'f-d={device_id}', f'fansly-d={device_id}']
        headers = [
            'Origin: https://fansly.com',
            f'Cookie: {"; ".join(cookie_parts)}',
            f'User-Agent: {_UA}',
            'Accept-Language: en-US,en;q=0.9',
        ]
        proxy_kwargs = {}
        proxy = session.get('proxy')
        if proxy:
            p = urlparse(proxy if '://' in proxy else f'http://{proxy}')
            if p.hostname and p.port:
                # websocket-client accepts http/socks4/socks5/socks5h here
                # (socks needs the optional python_socks package).
                scheme = (p.scheme or 'http').lower()
                proxy_kwargs = {
                    'http_proxy_host': p.hostname,
                    'http_proxy_port': int(p.port),
                    'proxy_type': scheme if scheme.startswith('socks') else 'http',
                }
                if p.username and p.password:
                    proxy_kwargs['http_proxy_auth'] = (p.username, p.password)
        return config.FANSLY_WS_URL, headers, proxy_kwargs

    def _connect_once(self) -> None:
        session = fansly_auth.load_session(self.crm_id, self.account_id)
        if not session or not session.get('auth_token'):
            raise RuntimeError('no Fansly session/token for WS')

        url, headers, proxy_kwargs = self._build_conn_args(session)
        ws = websocket.create_connection(url, header=headers, timeout=20, **proxy_kwargs)
        try:
            # Verify the session.
            ws.send(json.dumps({'t': 1, 'd': json.dumps(
                {'token': session['auth_token'], 'v': 3})}))
            first = ws.recv()
            if 'session' not in str(first):
                logger.warning('Fansly WS verify did not return a session %s/%s: %.120s',
                               self.crm_id, self.account_id, str(first))
            else:
                logger.info('Fansly WS online %s/%s', self.crm_id, self.account_id)

            ws.settimeout(2)
            last_ping = time.time()
            while not self._stop.is_set():
                if time.time() - last_ping > _PING_SECONDS:
                    try:
                        ws.send('p')
                        last_ping = time.time()
                    except Exception:
                        return
                try:
                    frame = ws.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                except Exception:
                    return  # closed/errored → outer loop reconnects
                if frame:
                    try:
                        self._dispatch(frame)
                    except Exception:
                        logger.exception('Fansly WS dispatch error %s/%s',
                                         self.crm_id, self.account_id)
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def run(self) -> None:
        """Blocking entry point — run inside a daemon thread."""
        if websocket is None:
            logger.error('websocket-client not installed; Fansly WS disabled')
            return
        backoff = _RECONNECT_MIN
        while not self._stop.is_set():
            try:
                self._connect_once()
                backoff = _RECONNECT_MIN
            except Exception as e:
                logger.warning('Fansly WS cycle failed %s/%s: %s — retry in %ss',
                               self.crm_id, self.account_id, e, backoff)
                for _ in range(backoff):
                    if self._stop.is_set():
                        break
                    time.sleep(1)
                backoff = min(_RECONNECT_MAX, backoff * 2)
        logger.info('Fansly WS listener stopped %s/%s', self.crm_id, self.account_id)


if __name__ == '__main__':
    # Offline self-test of the protobuf decoder: hand-encode a MessageMessage
    # (id=1, groupId=2, senderId=4=99, content=5="hi", createdAt=7) and confirm
    # the deep-scan recovers it through a couple of wrapper layers.
    def _varint(n):
        out = bytearray()
        while True:
            b = n & 0x7F
            n >>= 7
            if n:
                out.append(b | 0x80)
            else:
                out.append(b)
                return bytes(out)

    def _tag(fno, wire):
        return _varint((fno << 3) | wire)

    def _ld(fno, data):
        return _tag(fno, 2) + _varint(len(data)) + data

    def _vi(fno, n):
        return _tag(fno, 0) + _varint(n)

    msg = _vi(1, 1) + _vi(2, 2) + _vi(4, 99) + _ld(5, b'hi') + _vi(7, 1765000000000)
    messages_created = _ld(1, msg)                      # MessagesCreated.messages
    container = _vi(1, 0) + _ld(2, messages_created)    # EventContainerMessage
    wrapper = _vi(1, 10000) + _ld(2, container)         # EventWrapper(type,data)
    out = extract_messages(wrapper)
    print('decoded messages:', out)
    assert len(out) == 1 and out[0]['content'] == 'hi' and out[0]['senderId'] == 99
    print('protobuf deep-scan self-test PASSED')
