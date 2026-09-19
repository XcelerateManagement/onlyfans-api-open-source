"""Cross-worker account/proxy pacing for signed OnlyFans requests.

The state files contain only hashed budget keys and timestamps. Linux file
locks make the budget common to Gunicorn workers and the scheduler process;
the in-process lock fallback keeps development platforms deterministic.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from contextlib import contextmanager
from email.utils import parsedate_to_datetime
from pathlib import Path

try:  # pragma: no cover - production path is Linux
    import fcntl
except ImportError:  # pragma: no cover - Windows development fallback
    fcntl = None


MIN_INTERVAL_SECONDS = float(os.environ.get("OF_RATE_MIN_INTERVAL_SECONDS", "1.0"))
STATE_DIR = Path(os.environ.get("OF_RATE_STATE_DIR", "/tmp/the-only-api-rate-budgets"))
MAX_RETRY_AFTER_SECONDS = float(os.environ.get("OF_RATE_MAX_RETRY_AFTER_SECONDS", "900"))
_registry_guard = threading.Lock()
_thread_locks: dict[str, threading.Lock] = {}


def _digest(namespace: str, value: object) -> str:
    raw = f"{namespace}:{value}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _paths(session_data: dict) -> list[Path]:
    account = f"{session_data.get('crm_id', '')}:{session_data.get('user_id', '')}"
    proxy = session_data.get("proxy") or "direct"
    return sorted([
        STATE_DIR / f"account-{_digest('account', account)}.json",
        STATE_DIR / f"proxy-{_digest('proxy', proxy)}.json",
    ], key=str)


def _thread_lock(path: Path) -> threading.Lock:
    key = str(path)
    with _registry_guard:
        return _thread_locks.setdefault(key, threading.Lock())


def _read_next(handle) -> float:
    handle.seek(0)
    try:
        payload = json.loads(handle.read() or "{}")
        return max(0.0, float(payload.get("next_allowed_at", 0.0)))
    except (TypeError, ValueError, json.JSONDecodeError):
        return 0.0


def _write_next(handle, value: float) -> None:
    handle.seek(0)
    handle.truncate()
    json.dump({"next_allowed_at": round(value, 3)}, handle)
    handle.flush()
    os.fsync(handle.fileno())


def _retry_after_seconds(response) -> float:
    if getattr(response, "status_code", None) != 429:
        return 0.0
    raw = (getattr(response, "headers", {}) or {}).get("Retry-After")
    if raw is None:
        return MIN_INTERVAL_SECONDS
    try:
        seconds = float(raw)
    except (TypeError, ValueError):
        try:
            seconds = parsedate_to_datetime(str(raw)).timestamp() - time.time()
        except (TypeError, ValueError, OverflowError):
            seconds = MIN_INTERVAL_SECONDS
    return max(MIN_INTERVAL_SECONDS, min(MAX_RETRY_AFTER_SECONDS, seconds))


class _Lease:
    def __init__(self, handles: list):
        self._handles = handles

    def observe(self, response) -> None:
        retry_after = _retry_after_seconds(response)
        if retry_after <= 0:
            return
        blocked_until = time.time() + retry_after
        for handle in self._handles:
            _write_next(handle, max(_read_next(handle), blocked_until))


@contextmanager
def limit(session_data: dict):
    """Serialize and pace one account and its egress proxy.

    Locks are held for the request duration. This gives bounded concurrency per
    identity/proxy and prevents another worker from entering during a 429
    update. Call ``lease.observe(response)`` before leaving the context.
    """
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(STATE_DIR, 0o700)
    except OSError:
        pass

    handles = []
    local_locks = []
    try:
        for path in _paths(session_data):
            lock = _thread_lock(path)
            lock.acquire()
            local_locks.append(lock)
            handle = open(path, "a+", encoding="utf-8")
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handles.append(handle)

        wait_until = max((_read_next(handle) for handle in handles), default=0.0)
        delay = wait_until - time.time()
        if delay > 0:
            time.sleep(delay)
        next_allowed = time.time() + max(0.0, MIN_INTERVAL_SECONDS)
        for handle in handles:
            _write_next(handle, next_allowed)
        yield _Lease(handles)
    finally:
        for handle in reversed(handles):
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            handle.close()
        for lock in reversed(local_locks):
            lock.release()
