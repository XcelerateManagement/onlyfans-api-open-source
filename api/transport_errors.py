#!/usr/bin/env python3
"""Shared transport/proxy exception classifier for the platform clients.

``of_client`` and ``fansly_client`` are deliberate mirrors, and both have the
same job here: turn a raw curl_cffi exception into a clean, classifiable error
instead of letting it reach the global 500 handler. An operator staring at
"500 Internal Server Error" cannot tell a dead proxy from a real API bug, and
the caller cannot tell a transient network fault from a genuine API rejection.

Only the *matching rules* live in this module — the wording does not. The two
platforms name different sites, and Fansly's proxy is optional where OF's
effectively is not, so each client owns its own message table. Keeping the one
list of curl failure strings here is what stops the two classifiers from
silently drifting apart as new failure modes turn up in production.

``classify`` returns a stable ``kind``, or None when the exception does not
look transport-related at all — the caller must then re-raise, so that a
genuine bug is never mislabelled as a network fault.
"""

# Ordered most-specific first. The checks deliberately overlap — curl's "(56)"
# appears both in "CONNECT tunnel failed, response 407" and in a plain
# connection reset — so first match wins and this ORDER IS LOAD-BEARING.
# Reordering it silently reclassifies live errors.
_RULES = (
    # 407 Proxy Authentication Required. curl surfaces this as
    # "(56) CONNECT tunnel failed, response 407" — almost always a wrong proxy
    # username/password, so it must be tested before the generic (56) reset.
    ('auth', ('407', 'proxy authentication', 'connect tunnel failed')),
    ('reset', ('connection reset', 'recv failure', 'send failure', '(56)')),
    ('timeout', ('timed out', 'timeout', 'operation too slow', '(28)')),
    ('dns', ('could not resolve', "couldn't resolve", 'getaddrinfo',
             'name or service not known', '(6)')),
    ('connection', ('refused', "couldn't connect", 'could not connect',
                    'failed to connect', '(7)')),
    ('tls', ('ssl', 'certificate', 'tls')),
    # Unknown but still transport-ish (some other curl/proxy failure). Last so
    # it never shadows a specific kind; exists so the raw curl string is never
    # echoed back to the user.
    ('generic', ('failed to perform', 'curl:', 'proxy')),
)

KINDS = tuple(kind for kind, _needles in _RULES)


def classify(exc):
    """Map a transport exception to one of ``KINDS``.

    Returns None when nothing matches — meaning "this is not a transport
    failure", which callers treat as "re-raise and let the 500 handler own it".
    """
    low = str(exc).lower()
    for kind, needles in _RULES:
        if any(needle in low for needle in needles):
            return kind
    return None
