#!/usr/bin/env python3
"""Background worker for bulk account import.

``run_import(crm_id, job_id)`` is dispatched ONCE via
``scheduler.run_in_background(...)`` and occupies exactly ONE heavy-pool slot
for the life of the job, no matter how many rows it holds.

Why one slot
------------
The obvious design — one APScheduler job per row — is a trap. The heavy pool is
16 workers and also carries every subscriber walk, transaction backfill and
campaign sync on the box. Six hundred one-shot jobs would evict all of them and
the panel would appear to stop refreshing for the length of the import. So the
job holds one slot and fans out internally through two private
``ThreadPoolExecutor``s.

Two lanes
---------
============  ============  =========  ==================================
lane          per row       default    why
============  ============  =========  ==================================
``cookie``    ~4s           10 workers one authenticated GET, no captcha
``password``  ~30s + solve   6 workers full login, costs a captcha solve
============  ============  =========  ==================================

Mixing them into one pool means the cheap rows queue behind the expensive ones
and a list of 500 cookie rows takes as long as 500 password rows.

Three throttles sit on top, and all three exist because of what OnlyFans does
to an IP that looks like it is credential-stuffing:

  * a **token bucket** over LOGINS (``IMPORT_LOGIN_RATE_PER_MIN``, 30/min).
    Cookie validation is not gated by it: a single authenticated GET
    /users/me is indistinguishable from ordinary panel traffic, and putting it
    under the login budget would erase the entire point of a second lane.
  * a **per-proxy-host gate** (``IMPORT_PER_PROXY_CONCURRENCY``, 1 == serialize).
    Rows with no proxy share the ``:direct`` key, because they genuinely do
    share one egress IP — the server's. A list with no proxies therefore
    imports serially. That is the correct posture, not a bug; supply per-row
    proxies to get parallelism.
  * **permanent-vs-transient classification** (``account_connect``). A wrongly
    "transient" credential rejection spends ``IMPORT_MAX_ATTEMPTS`` logins
    against an account the platform already refused.

Resumability
------------
The worker never holds the row list. It claims a batch with one UPDATE
(``db.claim_import_rows``), processes it, and claims again. A process that dies
mid-job leaves ``running`` rows and nothing else; ``reconcile_stale_imports()``
flips those back to ``pending`` and re-dispatches the job. Unlike exports —
cheap to redo, so they are simply failed on restart — an import that got 400 of
600 accounts connected must be *resumed*.

Polling is NOT enabled
----------------------
``of_accounts.polling_enabled`` defaults to 0 and nothing here changes it, so
importing 600 accounts registers zero poll jobs. This is deliberate. Flipping
polling off→on triggers a 7-day backfill pinned to the 16-worker heavy pool;
600 of those would starve every other scheduled job on the box for hours.
Enabling polling is a separate, per-account decision the operator makes on the
Accounts page.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import account_connect
import config
import crm_database as db
from sse_hub import hub

logger = logging.getLogger(__name__)


def _now_iso():
    return db.iso_utc_now()


def _iso_in(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)
            ).strftime('%Y-%m-%dT%H:%M:%S+00:00')


def _parse_iso(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def remaining_seconds(expires_at):
    """Seconds left on a parked 2FA row, floored at 0, or None if unbounded.

    Surfaced on every row the API returns so the UI can render a countdown
    without having to agree with the server about clock skew or timestamp
    format.
    """
    dt = _parse_iso(expires_at)
    if dt is None:
        return None
    return max(0, int((dt - datetime.now(timezone.utc)).total_seconds()))


# ---------------------------------------------------------------------------
# Throttles
# ---------------------------------------------------------------------------

class TokenBucket:
    """Classic token bucket, process-wide, thread-safe, blocking.

    Sized in logins-per-minute. Capacity equals one minute of tokens so a fresh
    import may burst briefly and then settles onto the sustained rate — which
    matches what a human operator connecting accounts by hand looks like far
    better than a perfectly even drip would.
    """

    def __init__(self, rate_per_minute, capacity=None):
        self.rate = max(float(rate_per_minute), 0.001) / 60.0  # tokens/second
        self.capacity = float(capacity if capacity is not None else rate_per_minute)
        self._tokens = self.capacity
        self._updated = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self):
        now = time.monotonic()
        self._tokens = min(self.capacity, self._tokens + (now - self._updated) * self.rate)
        self._updated = now

    def acquire(self, tokens=1, timeout=None):
        """Block until `tokens` are available. Returns True, or False on timeout."""
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= tokens:
                    self._tokens -= tokens
                    return True
                wait = (tokens - self._tokens) / self.rate
            if deadline is not None:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                wait = min(wait, left)
            time.sleep(min(max(wait, 0.01), 5.0))


class HostGate:
    """Per-key semaphore registry — serializes work sharing one egress IP."""

    def __init__(self, per_key):
        self._per_key = max(1, int(per_key))
        self._guard = threading.Lock()
        self._gates = {}

    def gate(self, key):
        with self._guard:
            g = self._gates.get(key)
            if g is None:
                g = self._gates[key] = threading.Semaphore(self._per_key)
            return g


def proxy_key(proxy):
    """Group rows by the egress they share: the proxy HOST, or ':direct'.

    Credentials in the proxy URL are stripped, so two rows pointing at the same
    gateway with different usernames still serialize against each other — they
    still leave the box from the same address, which is the thing OnlyFans
    counts.
    """
    if not proxy:
        return ':direct'
    try:
        rest = str(proxy).split('://', 1)[-1]
        hostport = rest.rsplit('@', 1)[-1]
        return hostport.split('/', 1)[0].lower()
    except Exception:
        return ':direct'


# Process-wide, shared by every concurrent import job. Two jobs running at once
# must not each get their own 30 logins/min.
_login_bucket = TokenBucket(config.IMPORT_LOGIN_RATE_PER_MIN)
_host_gate = HostGate(config.IMPORT_PER_PROXY_CONCURRENCY)


# ---------------------------------------------------------------------------
# Coalesced progress
# ---------------------------------------------------------------------------

class ProgressEmitter:
    """At most one ``import.progress`` per job per interval, plus a tail.

    ``sse_hub`` gives each subscriber a ``Queue(maxsize=200)`` and DROPS on
    overflow. A 600-row import emitting per row would overflow that queue and
    the events lost would be precisely the late ones — the completion the UI is
    waiting for. So transitions are accumulated and flushed on a timer, and the
    payload carries full counts (a snapshot, not a delta) so a client that
    misses a frame is still correct after the next one.
    """

    def __init__(self, crm_id, job_id, total):
        self.crm_id = crm_id
        self.job_id = job_id
        self.total = total
        self._lock = threading.Lock()
        self._tail = deque(maxlen=config.IMPORT_PROGRESS_TAIL)
        self._last = 0.0
        self._dirty = False

    def note(self, row_id, row_index, email, status, error=None):
        with self._lock:
            self._tail.append({
                'row_id': row_id, 'row_index': row_index, 'email': email,
                'status': status, 'error': (error or None),
                'at': _now_iso(),
            })
            self._dirty = True

    def flush(self, *, force=False, status='running', event='import.progress',
              **extra):
        with self._lock:
            now = time.monotonic()
            if not force:
                if not self._dirty:
                    return
                if now - self._last < config.IMPORT_PROGRESS_INTERVAL_SECONDS:
                    return
            self._last = now
            self._dirty = False
            tail = list(self._tail)

        counts = db.count_import_rows(self.job_id)
        try:
            db.update_import_job(self.job_id, counts=counts, heartbeat_at=_now_iso())
        except Exception:
            logger.exception('import %s: counts write failed', self.job_id)
        payload = {
            'job_id': self.job_id,
            'status': status,
            'counts': counts,
            'total': self.total,
            'recent': tail,
            'updated_at': _now_iso(),
        }
        payload.update(extra)
        try:
            hub.broadcast(self.crm_id, {'event_type': event, 'payload': payload})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Row outcomes
# ---------------------------------------------------------------------------

def _finish_row(row_id, status, *, error=None, reason=None, permanent=False,
                of_user_id=None, username=None):
    """Move a row to a terminal state AND destroy its credentials.

    The two halves are one operation on purpose. Every terminal transition in
    this module goes through here, so there is no path that marks a row done
    without scrubbing it.
    """
    db.update_import_row(
        row_id, status=status, error=(str(error)[:500] if error else None),
        error_reason=reason, permanent=1 if permanent else 0,
        of_user_id=of_user_id, username=username,
        finished_at=_now_iso(), claim_token=None)
    db.zero_import_row_secrets(row_id)


def _park_2fa(row_id, challenge, *, error=None):
    """Store the partial session and park the row for a human.

    NOT terminal, and the credential deliberately survives: the operator may
    close the importer entirely and come back — which is the whole reason
    GET /import/pending-2fa exists — and a `needs_2fa_expired` retry has to be
    able to re-run the login from scratch. config.IMPORT_CREDENTIAL_TTL_HOURS
    is the hard ceiling on that, enforced by sweep_pending_2fa().
    """
    cookies = challenge.get('cookies') or None
    db.update_import_row(
        row_id, status='needs_2fa',
        otp_state=challenge.get('otp_state'),
        x_bc=challenge.get('x_bc'), x_hash=challenge.get('x_hash'),
        encrypted_2fa_cookies=(db.encrypt_password(_json_dumps(cookies))
                               if cookies else None),
        two_fa_expires_at=_iso_in(config.TWO_FA_SESSION_EXPIRY),
        error=(str(error)[:500] if error else None),
        error_reason='needs_2fa', claim_token=None)


def _json_dumps(obj):
    import json
    return json.dumps(obj)


def _json_loads(text):
    import json
    return json.loads(text)


# ---------------------------------------------------------------------------
# One row
# ---------------------------------------------------------------------------

def _process_row(crm_id, job_id, row, emitter):
    """Connect one account. Never raises — every outcome lands in the row."""
    row_id = row['id']
    email = row.get('email')
    platform = row.get('platform') or 'onlyfans'
    proxy = row.get('proxy')
    lane = row.get('lane') or 'password'

    try:
        # A cancel that landed while this row sat in the executor queue.
        job = db.get_import_job_unscoped(job_id)
        if not job or job.get('status') == 'canceled':
            _finish_row(row_id, 'canceled', reason='canceled')
            emitter.note(row_id, row['row_index'], email, 'canceled')
            return

        # Already connected → don't spend a login (or a captcha) proving it.
        if email:
            existing = db.find_of_account_by_email(crm_id, email, platform)
            if existing:
                _finish_row(row_id, 'skipped', reason='already_connected',
                            error='this account is already connected to the panel',
                            of_user_id=existing)
                emitter.note(row_id, row['row_index'], email, 'skipped')
                return

        gate = _host_gate.gate(proxy_key(proxy))
        with gate:
            result = _attempt_connect(crm_id, row, lane, platform, proxy)

        _apply_result(crm_id, job_id, row, result, emitter)
    except Exception as e:
        logger.exception('import %s row %s failed unexpectedly', job_id, row_id)
        _finish_row(row_id, 'failed', error=str(e), reason='worker_error',
                    permanent=False)
        emitter.note(row_id, row['row_index'], email, 'failed', str(e))


def _attempt_connect(crm_id, row, lane, platform, proxy):
    """Do the platform call for one row. Returns an account_connect result."""
    email = row.get('email')
    cookies = row.get('cookies') or {}

    if lane == 'cookie':
        # Not gated by the login bucket — see the module docstring.
        _count_platform_call(crm_id)
        if platform == 'fansly':
            return account_connect.fansly_token_connect(
                cookies.get('auth_token'), cookies.get('fansly_session_id'),
                cookies.get('fansly_client_id'), proxy=proxy)
        return account_connect.of_cookie_connect(
            cookies.get('sess'), cookies.get('auth_id'), cookies.get('fp'),
            proxy=proxy)

    # Password lane — this is what the 30/min budget is for.
    _login_bucket.acquire()
    _count_platform_call(crm_id)
    if platform == 'fansly':
        result = account_connect.fansly_password_login(
            email, row.get('password'), proxy=proxy)
    else:
        result = account_connect.of_password_login(
            email, row.get('password'), proxy=proxy)

    # A row that brought its own TOTP secret answers its own challenge and
    # never parks — which is what lets a 600-account import run unattended.
    if result.get('status') == 'needs_2fa' and row.get('totp_secret'):
        code = generate_totp(row['totp_secret'])
        if code:
            _login_bucket.acquire()
            _count_platform_call(crm_id)
            if platform == 'fansly':
                return account_connect.fansly_verify_otp(
                    result.get('otp_state'), code, result.get('x_bc'),
                    cookies=result.get('cookies'), proxy=proxy)
            return account_connect.of_verify_otp(
                email, code, result.get('x_bc'), result.get('x_hash'),
                result.get('cookies'), proxy=proxy)
    return result


def _apply_result(crm_id, job_id, row, result, emitter):
    """Turn an account_connect result into a row transition."""
    row_id = row['id']
    email = row.get('email')
    platform = row.get('platform') or 'onlyfans'
    status = (result or {}).get('status')

    if status == 'authenticated':
        try:
            of_user_id, username = account_connect.persist(
                crm_id, platform, result['session'], email=email,
                password=row.get('password'), proxy=row.get('proxy'),
                me=result.get('me'))
        except Exception as e:
            logger.exception('import %s row %s: persist failed', job_id, row_id)
            _finish_row(row_id, 'failed', error=f'connected but could not be saved: {e}',
                        reason='persist_error', permanent=False)
            emitter.note(row_id, row['row_index'], email, 'failed', str(e))
            return
        _finish_row(row_id, 'success', of_user_id=of_user_id, username=username)
        account_connect.notify_slot(crm_id, of_user_id)
        emitter.note(row_id, row['row_index'], email, 'success')
        return

    if status == 'needs_2fa':
        _park_2fa(row_id, result, error=result.get('error'))
        emitter.note(row_id, row['row_index'], email, 'needs_2fa')
        return

    # Failure. Permanent -> terminal now. Transient -> back on the queue while
    # attempts remain, because a dead proxy is not the account's fault.
    error = (result or {}).get('error') or 'connect failed'
    reason = (result or {}).get('reason') or 'error'
    permanent = bool((result or {}).get('permanent'))
    attempts = int(row.get('attempts') or 1)
    if not permanent and attempts < config.IMPORT_MAX_ATTEMPTS:
        db.update_import_row(row_id, status='pending', claim_token=None,
                             claimed_at=None, error=str(error)[:500],
                             error_reason=reason)
        emitter.note(row_id, row['row_index'], email, 'pending', error)
        return
    if not permanent:
        error = f'{error} (gave up after {attempts} attempts)'
    _finish_row(row_id, 'failed', error=error, reason=reason, permanent=permanent)
    emitter.note(row_id, row['row_index'], email, 'failed', error)


def _count_platform_call(crm_id, n=1):
    """No-op. The hosted build billed live platform requests against a monthly
    meter here; this build does no call counting. Kept so call sites read the
    same in both."""
    return


def generate_totp(secret):
    """6-digit TOTP for a stored base32 secret, or None if pyotp is missing.

    Import is lazy so a deployment that has not yet installed pyotp degrades to
    "rows park for a human code" instead of failing to import this module and
    taking the whole scheduler down with it.
    """
    if not secret:
        return None
    try:
        import pyotp
    except ImportError:
        logger.warning('import: pyotp is not installed — rows with a totp_secret '
                       'will park for a manual code')
        return None
    try:
        return pyotp.TOTP(secret).now()
    except Exception as e:
        logger.warning('import: could not generate TOTP: %s', e)
        return None


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_import(crm_id, job_id):
    """Run an import job to completion. Picklable; one heavy-pool slot.

    Never raises — every failure lands in the job row.
    """
    job = db.get_import_job_unscoped(job_id)
    if not job:
        logger.warning('import %s: job row missing', job_id)
        return
    if job.get('status') not in ('queued', 'running'):
        logger.info('import %s: status=%s — nothing to do', job_id, job.get('status'))
        return

    total = int(job.get('total_rows') or 0)
    emitter = ProgressEmitter(crm_id, job_id, total)
    db.update_import_job(job_id, status='running',
                         started_at=job.get('started_at') or _now_iso(),
                         heartbeat_at=_now_iso())
    emitter.flush(force=True)
    logger.info('import %s: starting (%s rows)', job_id, total)

    pools = {
        'cookie': ThreadPoolExecutor(
            max_workers=config.IMPORT_COOKIE_CONCURRENCY,
            thread_name_prefix=f'imp-c-{job_id[:8]}'),
        'password': ThreadPoolExecutor(
            max_workers=config.IMPORT_PASSWORD_CONCURRENCY,
            thread_name_prefix=f'imp-p-{job_id[:8]}'),
    }
    try:
        _drain(crm_id, job_id, pools, emitter)
    except Exception as e:
        logger.exception('import %s: run failed', job_id)
        db.update_import_job(job_id, status='failed', error=str(e)[:500],
                             completed_at=_now_iso())
        emitter.flush(force=True, status='failed', event='import.complete',
                      error=str(e)[:500])
        return
    finally:
        for pool in pools.values():
            pool.shutdown(wait=True)

    job = db.get_import_job_unscoped(job_id) or {}
    final = 'canceled' if job.get('status') == 'canceled' else 'complete'
    counts = db.count_import_rows(job_id)
    db.update_import_job(job_id, status=final, counts=counts,
                         completed_at=_now_iso(), heartbeat_at=_now_iso())
    emitter.flush(force=True, status=final, event='import.complete')
    logger.info('import %s: %s %s', job_id, final, counts)


def _drain(crm_id, job_id, pools, emitter):
    """Claim → submit → wait, until no claimable rows remain.

    Both lanes are claimed each pass so a job that is 90% cookie rows still
    keeps its 6 password workers busy. `futures` is bounded by the batch size,
    never by the job size — the point of claiming is that the row list lives in
    SQLite, not in this process.
    """
    idle_passes = 0
    while True:
        job = db.get_import_job_unscoped(job_id)
        if not job or job.get('status') == 'canceled':
            logger.info('import %s: canceled — stopping claims', job_id)
            break

        futures = []
        for lane, pool in pools.items():
            token = uuid.uuid4().hex
            claimed = db.claim_import_rows(
                job_id, lane, token, config.IMPORT_BATCH_SIZE)
            for row in claimed:
                futures.append(pool.submit(_process_row, crm_id, job_id, row, emitter))

        if not futures:
            # No claimable rows. There may still be in-flight rows from an
            # earlier pass (there are not, since we wait below) or rows another
            # process holds; one confirming pass then stop.
            if not db.has_active_import_rows(job_id) or idle_passes >= 1:
                break
            idle_passes += 1
            time.sleep(0.2)
            continue

        idle_passes = 0
        for f in futures:
            try:
                f.result()
            except Exception:
                logger.exception('import %s: row task raised', job_id)
            emitter.flush()
        emitter.flush(force=True)


# ---------------------------------------------------------------------------
# Operator actions (called from routes; fast, synchronous)
# ---------------------------------------------------------------------------

def submit_otp(crm_id, job_id, row_id, code):
    """Complete one parked row with a human-supplied 2FA code.

    Synchronous: the operator is watching, it is one platform call, and doing
    it inline means the response carries the real outcome instead of "queued".
    Returns (payload_dict, http_status).
    """
    row = db.get_import_row(crm_id, job_id, row_id, include_secrets=True)
    if not row:
        return {'success': False, 'error': 'import row not found'}, 404
    if row['status'] == 'needs_2fa_expired':
        return {'success': False, 'error':
                'the 2FA window for this row has expired — retry it to start a '
                'fresh login', 'status': row['status']}, 409
    if row['status'] != 'needs_2fa':
        return {'success': False,
                'error': f"row is not waiting for a code (status={row['status']})",
                'status': row['status']}, 409

    # Expired between the GET and this POST.
    if remaining_seconds(row.get('two_fa_expires_at')) == 0:
        _expire_row(row)
        return {'success': False, 'error':
                'the 2FA window for this row has just expired — retry it to '
                'start a fresh login', 'status': 'needs_2fa_expired'}, 409

    platform = row.get('platform') or 'onlyfans'
    proxy = row.get('proxy')
    cookies = row.get('two_fa_cookies') or {}
    _count_platform_call(crm_id)
    if platform == 'fansly':
        result = account_connect.fansly_verify_otp(
            row.get('otp_state'), code, row.get('x_bc'), cookies=cookies,
            proxy=proxy)
    else:
        result = account_connect.of_verify_otp(
            row.get('email'), code, row.get('x_bc'), row.get('x_hash'),
            cookies, proxy=proxy)

    emitter = ProgressEmitter(crm_id, job_id, 0)
    if result.get('status') == 'needs_2fa':
        # verify_otp is unavailable on this build — keep the row parked and say
        # so plainly rather than burning it.
        return {'success': False, 'error': result.get('error'),
                'reason': result.get('reason'), 'status': 'needs_2fa'}, 503

    _apply_result(crm_id, job_id, row, result, emitter)
    emitter.flush(force=True)
    fresh = db.get_import_row(crm_id, job_id, row_id)
    ok = fresh and fresh.get('status') == 'success'
    return ({'success': bool(ok), 'row': _decorate(fresh)},
            200 if ok else 400)


def retry_row(crm_id, job_id, row_id):
    """Put a finished/parked row back on the queue.

    A `needs_2fa_expired` row retries as a FULL login from scratch — the parked
    challenge is dead, so reusing it would only produce another rejection.
    Returns (payload_dict, http_status).
    """
    row = db.get_import_row(crm_id, job_id, row_id)
    if not row:
        return {'success': False, 'error': 'import row not found'}, 404
    if row['status'] in ('pending', 'running'):
        return {'success': False, 'error': 'row is already queued'}, 409
    if row['status'] == 'invalid':
        return {'success': False, 'error':
                'this row never parsed — fix the input and import it again'}, 409
    if row['status'] == 'success':
        return {'success': False, 'error': 'row already connected'}, 409
    if not row.get('has_password') and row['lane'] == 'password':
        return {'success': False, 'error':
                'the credential for this row has been destroyed (it reached a '
                'terminal state or aged out) — re-import it'}, 409

    db.update_import_row(
        row_id, status='pending', attempts=0, error=None, error_reason=None,
        permanent=0, claim_token=None, claimed_at=None, finished_at=None,
        otp_state=None, x_bc=None, x_hash=None, encrypted_2fa_cookies=None,
        two_fa_expires_at=None)
    db.update_import_job(job_id, status='running', completed_at=None)

    import scheduler as scheduler_mod
    scheduler_mod.run_in_background(run_import, crm_id, job_id,
                                    job_id_prefix='import')
    return {'success': True, 'row': _decorate(db.get_import_row(crm_id, job_id, row_id))}, 202


def _decorate(row):
    """Add the derived fields every API response carries."""
    if not row:
        return None
    row = dict(row)
    if row.get('status') in ('needs_2fa', 'needs_2fa_expired'):
        row['two_fa_remaining_seconds'] = remaining_seconds(row.get('two_fa_expires_at'))
    else:
        row['two_fa_remaining_seconds'] = None
    return row


def decorate_rows(rows):
    return [_decorate(r) for r in rows]


# ---------------------------------------------------------------------------
# Maintenance (scheduler)
# ---------------------------------------------------------------------------

def _expire_row(row):
    """needs_2fa → needs_2fa_expired.

    The 2FA challenge blob is destroyed (it is worthless once the window
    closes) but the PASSWORD survives, because the documented behaviour of
    retrying an expired row is "re-run the login from scratch" and that is
    impossible without it. sweep_pending_2fa's TTL pass is what eventually
    takes the password too.
    """
    db.update_import_row(
        row['id'], status='needs_2fa_expired',
        otp_state=None, x_bc=None, x_hash=None, encrypted_2fa_cookies=None,
        error='the 2FA code was not entered in time',
        error_reason='needs_2fa_expired')


def sweep_pending_2fa():
    """Expire parked rows and destroy credentials that have aged out.

    Two passes:
      1. `needs_2fa` past its window → `needs_2fa_expired` (retryable).
      2. Any 2FA-parked row older than IMPORT_CREDENTIAL_TTL_HOURS → `failed`,
         credential destroyed. A password may not live in this file forever
         just because nobody ever typed a code.

    Registered as a periodic scheduler job. Returns (expired, scrubbed).
    """
    expired = scrubbed = 0
    try:
        for row in db.list_expired_2fa_rows(_now_iso()):
            _expire_row(row)
            expired += 1
            try:
                hub.broadcast(row['crm_id'], {
                    'event_type': 'import.progress',
                    'payload': {'job_id': row['job_id'], 'status': 'running',
                                'counts': db.count_import_rows(row['job_id']),
                                'recent': [{'row_id': row['id'],
                                            'row_index': row['row_index'],
                                            'email': row.get('email'),
                                            'status': 'needs_2fa_expired',
                                            'at': _now_iso()}],
                                'updated_at': _now_iso()}})
            except Exception:
                pass
    except Exception:
        logger.exception('sweep_pending_2fa: expiry pass failed')

    try:
        cutoff = (datetime.now(timezone.utc)
                  - timedelta(hours=config.IMPORT_CREDENTIAL_TTL_HOURS)
                  ).strftime('%Y-%m-%dT%H:%M:%S+00:00')
        for row in db.list_stale_credential_rows(cutoff):
            _finish_row(row['id'], 'failed',
                        error=f'no 2FA code was entered within '
                              f'{config.IMPORT_CREDENTIAL_TTL_HOURS}h — the stored '
                              f'credential has been destroyed',
                        reason='credential_ttl', permanent=True)
            scrubbed += 1
    except Exception:
        logger.exception('sweep_pending_2fa: TTL pass failed')

    if expired or scrubbed:
        logger.info('import 2FA sweep: %s expired, %s credentials destroyed',
                    expired, scrubbed)
    return expired, scrubbed


def reconcile_stale_imports(dispatch=True):
    """RESUME every import orphaned by a restart. Call once at startup.

    Exports are failed on restart because regenerating a ZIP is cheap. An
    import is not: half of it already happened, and the half that did is 300
    live sessions and 300 rows in of_accounts. So `running` rows go back to
    `pending` (their worker thread died with the old process) and the job is
    re-dispatched to pick up exactly where it stopped. Rows that already
    reached a terminal state are never touched, so no account is connected
    twice.

    Returns the number of jobs resumed.
    """
    boot = _now_iso()
    resumed = 0
    try:
        jobs = db.list_resumable_import_jobs(boot)
    except Exception:
        logger.exception('reconcile_stale_imports: could not list jobs')
        return 0

    for job in jobs:
        job_id = job['job_id']
        try:
            requeued, exhausted = db.release_stale_import_rows(job_id)
            if not db.has_active_import_rows(job_id):
                # Everything already finished; just close the job out.
                db.update_import_job(job_id, status='complete',
                                     counts=db.count_import_rows(job_id),
                                     completed_at=_now_iso())
                continue
            db.update_import_job(job_id, status='queued', error=None)
            logger.info('import %s: resuming (%s row(s) requeued, %s exhausted)',
                        job_id, requeued, exhausted)
            if dispatch:
                import scheduler as scheduler_mod
                scheduler_mod.run_in_background(
                    run_import, job['crm_id'], job_id, job_id_prefix='import')
            resumed += 1
        except Exception:
            logger.exception('reconcile_stale_imports: could not resume %s', job_id)
    if resumed:
        logger.info('import reconcile: resumed %s job(s)', resumed)
    return resumed
