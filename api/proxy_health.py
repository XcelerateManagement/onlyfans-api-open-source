"""Is this proxy actually dead? A quick liveness probe used by the poller.

When polling for an account keeps failing, we don't want to blindly pause it —
the failure might be a transient platform hiccup, a rate limit, or a genuinely
dead proxy. This module answers only the last question: can the proxy reach the
internet at all? If it can't, the poller stops polling that account and tells
the operator to replace the proxy. If it can, the failure is something else and
polling is left alone (up to the generic safety threshold).

Deliberately a plain internet-reachability check (api.ipify.org), NOT a
platform check: a proxy that reaches the internet but is blocked by OnlyFans'
Cloudflare is NOT "dead" — that is a different problem with a different fix, and
pausing on it would be wrong.
"""

from __future__ import annotations

import time

try:
    import requests
except Exception:  # pragma: no cover - requests is a hard dep in prod
    requests = None

PROBE_URL = 'https://api.ipify.org?format=json'
DEFAULT_TIMEOUT = 8


def probe(proxy, timeout=DEFAULT_TIMEOUT):
    """Return {'alive': True|False|None, 'reason': str, 'latency_ms': int|None}.

    alive is None when we cannot even attempt the test (no proxy configured, or
    requests unavailable) — the caller must NOT treat None as dead.
    """
    if not proxy:
        return {'alive': None, 'reason': 'no_proxy', 'latency_ms': None}
    if requests is None:
        return {'alive': None, 'reason': 'no_http_client', 'latency_ms': None}
    t0 = time.time()
    try:
        r = requests.get(PROBE_URL, proxies={'http': proxy, 'https': proxy},
                         timeout=timeout)
        latency = int((time.time() - t0) * 1000)
        if r.status_code == 200:
            return {'alive': True, 'reason': 'ok', 'latency_ms': latency}
        # The proxy answered but the destination did not come back 200. The
        # proxy itself is reachable, so it is not "dead".
        return {'alive': True, 'reason': f'http_{r.status_code}', 'latency_ms': latency}
    except Exception as exc:  # noqa: BLE001 - any transport failure = suspect
        low = str(exc).lower()
        if '407' in low or 'proxy authentication' in low or 'unauthorized' in low:
            reason = 'auth'
        elif 'timed out' in low or 'timeout' in low:
            reason = 'timeout'
        elif 'refused' in low or "couldn't connect" in low or 'could not connect' in low:
            reason = 'refused'
        elif 'could not resolve' in low or 'getaddrinfo' in low or 'name or service' in low:
            reason = 'dns'
        else:
            reason = 'unreachable'
        return {'alive': False, 'reason': reason, 'latency_ms': None}
