"""Readiness and circuit-breaking for the local OnlyFans signing runtime."""

from __future__ import annotations

import os
import shutil
import sqlite3
import subprocess
import threading
import time


SIGNER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'onlyfans-sign-generator.js')
SIGNED_JOBS_PAUSE_FILE = os.environ.get(
    'OF_SIGNED_JOBS_PAUSE_FILE',
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 '.signed-jobs-paused'),
)
READINESS_CACHE_SECONDS = 15
_cache_lock = threading.Lock()
_cached_at = 0.0
_cached_signer = None


class SignerUnavailableError(RuntimeError):
    """Raised when a signed request cannot safely be attempted."""


class SignedJobsPausedError(SignerUnavailableError):
    """Raised for an intentional operator stop, distinct from dependency loss."""


def _probe_signer():
    if not os.path.isfile(SIGNER_PATH):
        return False, 'signer_missing'
    if shutil.which('node') is None:
        return False, 'node_missing'
    try:
        result = subprocess.run(
            ['node', SIGNER_PATH, '/api2/v2/users/me', '0', '--timestamp=1700000000000'],
            cwd=os.path.dirname(SIGNER_PATH), capture_output=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False, 'signer_probe_failed'
    if result.returncode != 0:
        return False, 'signer_probe_failed'
    return True, None


def signer_status(force=False):
    global _cached_at, _cached_signer
    now = time.monotonic()
    with _cache_lock:
        if (not force and _cached_signer is not None
                and now - _cached_at < READINESS_CACHE_SECONDS):
            return dict(_cached_signer)
        ok, reason = _probe_signer()
        _cached_at = now
        _cached_signer = {'ready': ok, 'reason': reason}
        return dict(_cached_signer)


def signed_jobs_ready():
    return (not os.path.exists(SIGNED_JOBS_PAUSE_FILE)
            and bool(signer_status().get('ready')))


def ensure_signer_ready():
    if os.path.exists(SIGNED_JOBS_PAUSE_FILE):
        raise SignedJobsPausedError(
            'OnlyFans synchronization is temporarily paused by an operator.'
        )
    status = signer_status()
    if not status['ready']:
        raise SignerUnavailableError(
            'OnlyFans synchronization is temporarily unavailable: '
            + (status.get('reason') or 'signer_unavailable'))


def _database_ready(path):
    if not path or not os.path.isfile(path):
        return False
    try:
        conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=2)
        try:
            conn.execute('SELECT 1').fetchone()
        finally:
            conn.close()
        return True
    except sqlite3.Error:
        return False


def service_readiness(database_path, scheduler_running):
    signer = signer_status(force=True)
    operator_paused = os.path.exists(SIGNED_JOBS_PAUSE_FILE)
    checks = {
        'signer': bool(signer['ready']),
        'database': _database_ready(database_path),
        'scheduler': bool(scheduler_running),
        'operator_pause': not operator_paused,
    }
    return {
        'ready': all(checks.values()),
        'checks': checks,
        'reason': ('operator_paused' if operator_paused else
                   (signer.get('reason') if not signer['ready'] else None)),
    }
