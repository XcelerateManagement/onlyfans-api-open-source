#!/usr/bin/env python3
"""Fansly request-header generation — the pure-Python analogue of OnlyFans'
``header_generator.py``.

Unlike OF (whose ``sign`` requires a Node.js subprocess running a deobfuscated
script), Fansly's anti-bot header is a non-cryptographic ``cyrb53`` digest over
a constant salt, the request pathname, and the device id. It can be reproduced
in Python with no JS runtime.

Reverse-engineered from the SPA bundle's ``IJ`` HttpInterceptor. See
``fansly/HEADERS.md`` in the API writedown for the full derivation. The five
headers every authenticated request carries:

    fansly-client-id     persistent device GUID (32 hex chars)
    fansly-session-id    session id from the login/register response
    fansly-client-ts     jittered, monotonic, server-skew-corrected unix ms
    fansly-client-check  cyrb53(salt + "_" + pathname + "_" + deviceId) as hex
    authorization        bearer-style session token
"""

import json
import time
import random
import threading
import uuid
from collections import OrderedDict
from email.utils import parsedate_to_datetime

import config

MASK32 = 0xFFFFFFFF


def imul(a, b):
    """Emulate JS ``Math.imul`` (32-bit integer multiply with overflow wrap)."""
    a &= MASK32
    b &= MASK32
    lo = (a & 0xFFFF) * (b & 0xFFFF)
    hi = (((a >> 16) & 0xFFFF) * (b & 0xFFFF) + (a & 0xFFFF) * ((b >> 16) & 0xFFFF)) & 0xFFFF
    return (lo + (hi << 16)) & MASK32


def cyrb53(s, seed=0):
    """53-bit non-cryptographic hash (Bryc's cyrb53), verbatim from the bundle.

    Constants: 0xdeadbeef / 0x41c6ce57 seeds; the same magic multipliers the
    SPA ships. Returns an int in [0, 2**53).
    """
    h1 = (0xDEADBEEF ^ seed) & MASK32
    h2 = (0x41C6CE57 ^ seed) & MASK32
    for ch in s:
        code = ord(ch)
        h1 = imul(h1 ^ code, 2654435761)
        h2 = imul(h2 ^ code, 1597334677)
    h1 = imul(h1 ^ (h1 >> 16), 2246822507)
    h1 ^= imul(h2 ^ (h2 >> 13), 3266489909)
    h2 = imul(h2 ^ (h2 >> 16), 2246822507)
    h2 ^= imul(h1 ^ (h1 >> 13), 3266489909)
    return 4294967296 * (2097151 & h2) + (h1 & MASK32)


# --- client-check digest, cached per (pathname, device) like the SPA's hashCache_ ---
_CHECK_CACHE_MAX = 100
_check_cache = OrderedDict()
_check_cache_lock = threading.Lock()


def generate_client_check(pathname, device_id):
    """``cyrb53(salt + "_" + pathname + "_" + deviceId).toString(16)`` with LRU cache.

    ``pathname`` is the URL path only — no query, no fragment, and it MUST
    include the ``/api/v1`` prefix (the SPA hashes the full pathname).
    """
    key = (pathname, device_id)
    with _check_cache_lock:
        cached = _check_cache.get(key)
        if cached is not None:
            _check_cache.move_to_end(key)
            return cached

    digest = format(cyrb53(f'{config.FANSLY_CLIENT_CHECK_SALT}_{pathname}_{device_id}'), 'x')

    with _check_cache_lock:
        _check_cache[key] = digest
        _check_cache.move_to_end(key)
        while len(_check_cache) > _CHECK_CACHE_MAX:
            _check_cache.popitem(last=False)
    return digest


def generate_device_id():
    """Fresh SPA-shaped device id: a UUID4 with dashes stripped (32 hex chars)."""
    return uuid.uuid4().hex


# --- server-time drift correction (mirrors backendServerDateMsOffset_) ---
# One offset per device id; only applied when |drift| exceeds the SPA's 30s gate.
_server_offset_ms = {}
_server_offset_lock = threading.Lock()
_DRIFT_THRESHOLD_MS = 30_000


def update_server_offset(device_id, response):
    """Update the per-device clock offset from a response's ``Date`` header
    (or a ``response.serverTime`` body field). No-op below the 30s threshold."""
    server_time_ms = None

    date_hdr = response.headers.get('date') or response.headers.get('Date')
    if date_hdr:
        try:
            server_time_ms = int(parsedate_to_datetime(date_hdr).timestamp() * 1000)
        except Exception:
            pass

    if server_time_ms is None:
        try:
            body = response.json()
            if isinstance(body, dict):
                st = (body.get('response') or {}).get('serverTime')
                if isinstance(st, (int, float)):
                    server_time_ms = int(st)
        except Exception:
            pass

    if server_time_ms is None:
        return

    drift = server_time_ms - int(time.time() * 1000)
    if abs(drift) > _DRIFT_THRESHOLD_MS:
        with _server_offset_lock:
            _server_offset_ms[device_id] = drift


def _get_server_offset(device_id):
    with _server_offset_lock:
        return _server_offset_ms.get(device_id, 0)


def generate_fansly_headers(path, auth_token=None, device_id=None, session_id=None, method='GET'):
    """Build the full header dict for a Fansly API request.

    Args:
        path (str): Request pathname including the ``/api/v1`` prefix, e.g.
            ``/api/v1/account/me``. Used both for the URL and the client-check.
        auth_token (str, optional): Bearer session token. Omitted when absent
            (e.g. pre-login register / email-verification calls).
        device_id (str, optional): ``fansly-client-id``. A fresh one is minted
            when not supplied.
        session_id (str, optional): ``fansly-session-id``. Omitted when absent.
        method (str): HTTP method (only affects whether content-type is set).

    Returns:
        (headers, device_id): the header dict and the device id actually used
        (so callers can persist a freshly-minted one).
    """
    if not device_id:
        device_id = generate_device_id()

    # Jittered, monotonic-ish, server-corrected timestamp (ms).
    jitter = 5000 - int(10000 * random.random())
    ts = str(int(time.time() * 1000) + jitter + _get_server_offset(device_id))

    client_check = generate_client_check(path, device_id)

    # Cookie mirror of the version/device/timestamp the SPA carries. f-s-c is
    # the same client-check digest the bundle stores in a cookie.
    fansly_ts_info = json.dumps(
        {'tso': 0, 'sts': int(time.time() * 1000), 'cts': int(time.time() * 1000)},
        separators=(',', ':'),
    )
    cookie = (
        f'f-d={device_id}; fansly-d={device_id}; '
        f'fansly-ts-info={fansly_ts_info}; f-s-c={client_check}'
    )

    headers = {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'fansly-client-check': client_check,
        'fansly-client-id': device_id,
        'fansly-client-ts': ts,
        'origin': 'https://fansly.com',
        'pragma': 'no-cache',
        'priority': 'u=1, i',
        'referer': 'https://fansly.com/',
        'sec-ch-ua': '"Not_A Brand";v="99", "Chromium";v="142"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': config.FANSLY_USER_AGENT,
        'Cookie': cookie,
    }

    if auth_token:
        headers['authorization'] = auth_token
    if session_id:
        headers['fansly-session-id'] = session_id
    if method.upper() in ('POST', 'PATCH', 'PUT'):
        headers['content-type'] = 'application/json'

    return headers, device_id


if __name__ == '__main__':
    # Quick smoke check — deterministic for a fixed (path, device) pair.
    dev = 'deadbeefdeadbeefdeadbeefdeadbeef'
    print('cyrb53("hello") =', cyrb53('hello'))
    print('client_check     =', generate_client_check('/api/v1/account/me', dev))
    hdrs, used = generate_fansly_headers('/api/v1/account/me', auth_token='tok', device_id=dev, session_id='sid')
    print('device used      =', used)
    print(json.dumps(hdrs, indent=2))
