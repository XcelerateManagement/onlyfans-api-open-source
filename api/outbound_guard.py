"""Shared SSRF / outbound-URL safety guard.

Used by `webhook_delivery.py` (first-party signed webhooks) and
`integrations/webhook.py` (per-automation ad-hoc HTTP action) to reject any
URL that resolves to a loopback, link-local, RFC1918, multicast, or reserved
IP range — closing the SSRF hole where a tenant who creates a webhook or
automation pointing at ``http://127.0.0.1:6379/`` (Redis), the AWS metadata
service at ``169.254.169.254``, or another internal service would have those
requests issued by this server with whatever blast radius the network allows.

Returns ``(ok: bool, reason: str|None)``. Callers raise / log as appropriate.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse


_ALLOWED_SCHEMES = ('http', 'https')


def is_safe_outbound_url(
    url: str,
    allowed_schemes: tuple[str, ...] = _ALLOWED_SCHEMES,
) -> tuple[bool, str | None]:
    """Return (True, None) if it's safe to issue an outbound request to `url`,
    or (False, reason) otherwise.

    ``allowed_schemes`` defaults to http/https (webhooks, integrations).
    Proxy validation passes a wider tuple that includes socks5/socks5h —
    the host/IP checks below apply identically regardless of scheme.
    """
    if not url or not isinstance(url, str):
        return False, 'empty url'

    try:
        parsed = urlparse(url)
    except Exception:
        return False, 'malformed url'

    scheme = (parsed.scheme or '').lower()
    if scheme not in allowed_schemes:
        return False, f'scheme {scheme!r} not allowed'

    host = parsed.hostname
    if not host:
        return False, 'missing host'

    # If the host is already an IP literal, check it directly.
    candidates: list[str] = []
    try:
        ipaddress.ip_address(host)
        candidates.append(host)
    except ValueError:
        # It's a hostname — resolve every A/AAAA so an attacker can't bypass
        # the check with a DNS record like internal.example.com → 127.0.0.1.
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            # Fail closed: if we can't resolve, we can't validate. Letting
            # the request through here meant a DNS rebinding / transient
            # NXDOMAIN attacker could bypass the guard entirely (NXDOMAIN
            # now, A-record-to-127.0.0.1 at the actual request time).
            return False, 'DNS resolution failed'
        seen: set[str] = set()
        for info in infos:
            ip = info[4][0]
            if ip and ip not in seen:
                seen.add(ip)
                candidates.append(ip)

    for cand in candidates:
        try:
            ip = ipaddress.ip_address(cand)
        except ValueError:
            continue
        if (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False, f'host {host} resolves to disallowed address {ip}'

    return True, None
