"""OAuth 2.1 authorization server — RS256 key management + JWT sign/verify.

This is the signing layer for the access tokens issued at /oauth/token. The
keys live on disk under ``OAUTH_KEYS_DIR`` (default: ``./oauth_keys/``) so
they survive restarts. A single active key is used at any time, identified
by a deterministic ``kid`` (sha256 prefix of the public key DER).

To rotate: drop a new keypair in the directory and restart. JWKS will then
serve both, and tokens signed with the old kid keep verifying until the old
private key is removed.

This module deliberately does **not** import from ``crm_database``; it's
pure crypto + filesystem so it can be unit-tested in isolation.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import jwt
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey, RSAPublicKey


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

KEYS_DIR = Path(os.environ.get("OAUTH_KEYS_DIR", "oauth_keys"))
ISSUER = os.environ.get("OAUTH_ISSUER", "http://127.0.0.1:5000").rstrip("/")
# Access tokens are short-lived per OAuth 2.1 BCP. 1 hour matches OpenAI's
# guidance for ChatGPT connectors and keeps the blast radius of a leak small.
ACCESS_TOKEN_TTL_SECONDS = int(os.environ.get("OAUTH_ACCESS_TTL_SEC", "3600"))


@dataclass(frozen=True)
class KeyPair:
    """A single signing keypair plus its JWKS identity."""

    kid: str
    private_key: RSAPrivateKey
    public_key: RSAPublicKey

    def public_jwk(self) -> dict[str, Any]:
        """Return the public key as a JWK dict (per RFC 7517)."""
        numbers = self.public_key.public_numbers()
        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": self.kid,
            "n": _b64u_uint(numbers.n),
            "e": _b64u_uint(numbers.e),
        }


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_uint(value: int) -> str:
    # JWK requires the unsigned big-endian byte representation of the integer.
    length = (value.bit_length() + 7) // 8
    return _b64u(value.to_bytes(length, "big"))


def _kid_for(public_key: RSAPublicKey) -> str:
    der = public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return hashlib.sha256(der).hexdigest()[:16]


def _load_or_create_active_key() -> KeyPair:
    """Load the active keypair from disk, generating one if none exists.

    On first run we generate a 2048-bit RSA key and write it under
    ``KEYS_DIR/active.pem`` with mode 0600. The file format is PEM
    PKCS8 (unencrypted). If you need encrypted-at-rest keys, wrap this
    file with KMS or filesystem encryption — we don't ship a passphrase
    flow because the operational burden is greater than the gain.
    """
    KEYS_DIR.mkdir(parents=True, exist_ok=True)
    pem_path = KEYS_DIR / "active.pem"

    if pem_path.exists():
        with pem_path.open("rb") as f:
            private = serialization.load_pem_private_key(
                f.read(), password=None, backend=default_backend()
            )
        if not isinstance(private, RSAPrivateKey):
            raise RuntimeError(f"{pem_path} is not an RSA private key")
    else:
        private = rsa.generate_private_key(
            public_exponent=65537, key_size=2048, backend=default_backend()
        )
        pem = private.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        # Write with restrictive perms before flushing the bytes — otherwise
        # there's a (tiny) window where the file is world-readable.
        fd = os.open(pem_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(fd, pem)
        finally:
            os.close(fd)

    public = private.public_key()
    return KeyPair(kid=_kid_for(public), private_key=private, public_key=public)


# Module-level cache. Loaded lazily so importing this module on systems
# without write access to KEYS_DIR doesn't crash — only the first call does.
_active: KeyPair | None = None


def active_key() -> KeyPair:
    global _active
    if _active is None:
        _active = _load_or_create_active_key()
    return _active


# ---------------------------------------------------------------------------
# JWT sign + verify
# ---------------------------------------------------------------------------

def sign_access_token(
    *,
    subject: str,
    audience: str,
    scope: str,
    client_id: str,
    extra_claims: dict[str, Any] | None = None,
    ttl_seconds: int | None = None,
) -> str:
    """Mint a short-lived RS256 access token.

    Parameters mirror RFC 9068 (JWT profile for OAuth 2.0 access tokens):
    - ``subject``  → ``sub`` (the user identity — for us, ``crm_id``)
    - ``audience`` → ``aud`` (the resource URL the client asked for)
    - ``scope``    → ``scope`` (space-separated OAuth scopes)
    - ``client_id``→ ``client_id`` (the registered OAuth client)
    """
    key = active_key()
    now = int(time.time())
    ttl = ttl_seconds if ttl_seconds is not None else ACCESS_TOKEN_TTL_SECONDS
    payload: dict[str, Any] = {
        "iss": ISSUER,
        "sub": subject,
        "aud": audience,
        "scope": scope,
        "client_id": client_id,
        "iat": now,
        "nbf": now,
        "exp": now + ttl,
        "jti": secrets.token_urlsafe(16),
        # `typ` claim from RFC 9068 — explicit signal that this is an access
        # token (not an id_token, not a refresh, not a re-purposed session
        # cookie). Verifiers should reject anything else.
        "token_type": "access_token",
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(
        payload,
        key.private_key,
        algorithm="RS256",
        headers={"kid": key.kid, "typ": "at+jwt"},
    )


def jwks_document() -> dict[str, Any]:
    """JWKS body to serve from /.well-known/jwks.json."""
    return {"keys": [active_key().public_jwk()]}
