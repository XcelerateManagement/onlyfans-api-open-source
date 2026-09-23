"""Small encrypted-at-rest helpers for persisted authentication material.

The application database already derives a Fernet key from ENCRYPTION_KEY.
Session files use the same derivation, with an explicit format prefix so older
plaintext JSON files remain readable and are migrated on their next write.
"""

import base64
import hashlib
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

import config


_PREFIX = "fernet:v1:"


def _fernet():
    digest = hashlib.sha256(config.ENCRYPTION_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def dumps_encrypted(value):
    payload = json.dumps(value, separators=(",", ":")).encode()
    return _PREFIX + _fernet().encrypt(payload).decode()


def loads_encrypted_or_legacy(raw):
    """Decrypt current files and accept legacy plaintext JSON for migration."""
    if raw.startswith(_PREFIX):
        try:
            raw = _fernet().decrypt(raw[len(_PREFIX):].encode()).decode()
        except InvalidToken as exc:
            raise ValueError("session file cannot be decrypted") from exc
    return json.loads(raw)


def migrate_legacy_session_tree(root="saved_sessions"):
    """Encrypt legacy plaintext session JSON files in place.

    Returns ``(migrated, failed)`` without exposing tenant/account filenames.
    A same-directory temporary file plus ``os.replace`` prevents a crash from
    leaving a partially written authentication file.
    """
    migrated = failed = 0
    root_path = Path(root)
    if not root_path.exists():
        return migrated, failed

    for path in root_path.rglob("*.json"):
        tmp = path.with_name(path.name + ".migrating")
        try:
            raw = path.read_text(encoding="utf-8")
            if raw.startswith(_PREFIX):
                continue
            value = loads_encrypted_or_legacy(raw)
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(dumps_encrypted(value))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
            os.chmod(path, 0o600)
            migrated += 1
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            failed += 1
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
    return migrated, failed
