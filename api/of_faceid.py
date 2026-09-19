#!/usr/bin/env python3
"""OnlyFans face (selfie) verification — start it, then wait for it to clear.

Why this exists
---------------
OnlyFans can park an account behind a *face* factor. Once it does, every
account-scoped `/api2/v2` call answers::

    HTTP 400 {"error":{"code":101,"payload":{"otpState":{
        "faceOtp":true,"forceFaceOtp":true,"email":true, ...}}}}

The session is not broken — the same cookies still get a 200 out of
`/api2/v2/users/list`. What is refused is everything tied to the account
identity. No typed code opens it: the webapp's own `modals/setOtpState`
mutation throws the email/sms/app options away whenever `forceFaceOtp` is set
(see of_client.parse_otp_challenge for the quoted source).

The flow, read off the live bundle (build 202608071337-eb45c33904)
------------------------------------------------------------------
1. ``POST /api2/v2/face-id/start {"source": "regular"}`` → ``{"redirectUrl": …}``
   (app.js module 202600 exports it as ``hp``; the FaceId.vue button in
   ``profile-9e548fa8.js`` calls it with exactly that body and opens the URL.)
2. A human opens ``redirectUrl`` in a **browser** and does the liveness check
   at OF's identity provider.
3. OF pushes a frame on ``wss://ws2.onlyfans.com/ws2/``; the SPA reacts by
   re-running the request that was blocked.
4. The gate is now open and normal calls return 200 again.

Step 3 is the only part of the protocol we cannot pin down from static JS. The
socket bus (app.js module 638322) fans a frame out by its *top-level key* —
``for (const [k, v] of Object.entries(frame))`` — so the confirm arrives as
some ``{"<key>": …}`` we have not observed, and the two `SOCKETS::*_SECURITY_CHECK`
constants are re-emitted from that key by a mapper we could not locate.

So this module does **not** bet the flow on a guessed frame shape. The
authority for "verification passed" is a live ``/api2/v2/users/me`` returning
200 — the same signal the account is usable again. The WebSocket runs
alongside purely as a latency shortcut and as a recorder: every frame seen
while a check is pending is appended to ``of-scripts/faceid_ws_frames.jsonl``,
which is what will let the next revision cut the poll loop out entirely.

Threading: one watcher thread per account, registered in `_watchers`. Starting
a second check for an account that already has a live watcher returns the
existing one instead of racing it.
"""

import json
import os
import threading
import time
from datetime import datetime

import crm_database as db
import of_client
import multi_tenant_auth as mt_auth

# Body accepted by /face-id/start. 'regular' is the FaceId component's default;
# 'banking' is used by the payout-details flow. Anything else is rejected by
# the route rather than passed through — an unknown source is a typo, and OF
# answers it with an opaque 400.
FACE_ID_SOURCES = ('regular', 'banking')

WS_URL = 'wss://ws2.onlyfans.com/ws2/'
WS_ORIGIN = 'https://onlyfans.com'

# How long a started check stays watchable. The identity provider's flow is a
# few minutes of a human holding up a phone; 20 minutes is generous without
# leaving threads parked all day.
WATCH_TIMEOUT_SECONDS = 20 * 60
# Poll /users/me this often. Tight at first (the check usually resolves in
# 1-3 min), then relaxed, so a forgotten tab does not sit at 5s forever.
_POLL_FAST_SECONDS = 5
_POLL_SLOW_SECONDS = 20
_POLL_FAST_WINDOW_SECONDS = 180

_FRAME_DUMP = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           'of-scripts', 'faceid_ws_frames.jsonl')

_registry_guard = threading.Lock()
_watchers = {}  # "crm_id:of_user_id" -> _Watcher


def _now():
    return datetime.utcnow().isoformat()


def _key(crm_id, of_user_id):
    return f'{crm_id}:{of_user_id}'


# ── HTTP side ──────────────────────────────────────────────────────────────

def start_verification(crm_id, of_user_id, source='regular', proxy=None):
    """POST /face-id/start. Returns (ok, data_or_error, status).

    `data` carries OF's `redirectUrl` — the URL a human has to open. Note this
    call goes through handle_of_request like everything else, which means it is
    signed and proxied identically to the calls that are being refused; if OF
    ever gates /face-id/start itself, the caller sees the same 403 contract.
    """
    if source not in FACE_ID_SOURCES:
        return False, {'error': f'Unknown face-id source: {source}'}, 400
    ok, data, status, _relogin = of_client.handle_of_request(
        crm_id, of_user_id, '/api2/v2/face-id/start', method='POST',
        body={'source': source}, proxy=proxy)
    return ok, data, status


def postpone_verification(crm_id, of_user_id, proxy=None):
    """POST /face-id/postpone — OF's "remind me later". Only meaningful while
    the check is still optional; a forced check ignores it."""
    ok, data, status, _relogin = of_client.handle_of_request(
        crm_id, of_user_id, '/api2/v2/face-id/postpone', method='POST',
        proxy=proxy)
    return ok, data, status


def ws_auth(crm_id, of_user_id, proxy=None):
    """GET /users/ws-auth → {'wsUrl', 'wsAuthToken'} or None."""
    ok, data, _status, _relogin = of_client.handle_of_request(
        crm_id, of_user_id, '/api2/v2/users/ws-auth', method='GET', proxy=proxy)
    return data if ok and isinstance(data, dict) else None


def is_gate_open(crm_id, of_user_id, proxy=None):
    """One authoritative probe: does OF answer for this account again?

    /users/me is the cheapest call that is both account-scoped (so it is
    subject to the gate) and side-effect free. A 200 here is also what clears
    the DB flag, via handle_of_request."""
    ok, data, status, _relogin = of_client.handle_of_request(
        crm_id, of_user_id, '/api2/v2/users/me', method='GET', proxy=proxy)
    if ok:
        return True, data
    return False, data if isinstance(data, dict) else {'error': str(data)[:300]}


# ── WebSocket side (fast path + protocol recorder) ─────────────────────────

def _record_frame(crm_id, of_user_id, text):
    """Append a frame to the dump. Best-effort; a full disk must not take the
    watcher down."""
    try:
        os.makedirs(os.path.dirname(_FRAME_DUMP), exist_ok=True)
        with open(_FRAME_DUMP, 'a') as fh:
            fh.write(json.dumps({'ts': time.time(), 'crm_id': crm_id,
                                 'of_user_id': str(of_user_id),
                                 'raw': text[:4000]}) + '\n')
    except Exception:
        pass


# Frames that arrive constantly on an idle socket. Recording them would bury
# the one frame this module exists to identify.
_NOISE_KEYS = {'online', 'onlines', 'connected', 'v', 'typing',
               'chat_messages', 'count_priority_chat', 'unread_tips'}

# Substrings that mark a frame as *possibly* the security-check confirm. Used
# only to shortcut the poll loop into an immediate probe — never to declare
# success on its own, because a false positive here would report a still-locked
# account as verified.
_CONFIRM_HINTS = ('face_id', 'faceid', 'security_check', 'securitycheck',
                  'otp', 'iv_status', 'ivstatus', 'login_requires_iv')


def _looks_like_confirm(obj):
    if not isinstance(obj, dict):
        return False
    for key in obj:
        low = str(key).lower()
        if low in _NOISE_KEYS:
            continue
        if any(hint in low for hint in _CONFIRM_HINTS):
            return True
    return False


class _Watcher(threading.Thread):
    """Waits for one account's face check to clear.

    State is readable at any time via `snapshot()`; the route layer polls it
    and the SSE hub gets the transitions.
    """

    def __init__(self, crm_id, of_user_id, proxy=None,
                 timeout=WATCH_TIMEOUT_SECONDS):
        super().__init__(daemon=True, name=f'faceid-{crm_id}-{of_user_id}')
        self.crm_id = crm_id
        self.of_user_id = str(of_user_id)
        self.proxy = proxy
        self.timeout = timeout
        self.started_at = time.time()
        self.status = 'pending'   # pending | approved | timeout | error
        self.detail = None
        self.redirect_url = None
        self._nudge = threading.Event()
        self._stop = threading.Event()

    # -- public -----------------------------------------------------------
    def snapshot(self):
        elapsed = time.time() - self.started_at
        return {
            'of_user_id': self.of_user_id,
            'status': self.status,
            'detail': self.detail,
            'redirect_url': self.redirect_url,
            'elapsed_seconds': int(elapsed),
            'expires_in_seconds': max(0, int(self.timeout - elapsed)),
        }

    def stop(self):
        self._stop.set()
        self._nudge.set()

    # -- internals --------------------------------------------------------
    def run(self):
        ws_thread = threading.Thread(target=self._listen, daemon=True,
                                     name=f'faceid-ws-{self.of_user_id}')
        ws_thread.start()
        try:
            self._poll_until_open()
        except Exception as exc:            # pragma: no cover - defensive
            self.status, self.detail = 'error', f'{type(exc).__name__}: {exc}'
        finally:
            self._stop.set()
            self._broadcast()
            with _registry_guard:
                if _watchers.get(_key(self.crm_id, self.of_user_id)) is self:
                    _watchers.pop(_key(self.crm_id, self.of_user_id), None)

    def _poll_until_open(self):
        deadline = self.started_at + self.timeout
        while not self._stop.is_set() and time.time() < deadline:
            elapsed = time.time() - self.started_at
            interval = (_POLL_FAST_SECONDS
                        if elapsed < _POLL_FAST_WINDOW_SECONDS
                        else _POLL_SLOW_SECONDS)
            # A WS hint wakes the wait early; otherwise this is the poll clock.
            self._nudge.wait(interval)
            self._nudge.clear()
            if self._stop.is_set():
                return
            open_, data = is_gate_open(self.crm_id, self.of_user_id, self.proxy)
            if open_:
                self.status = 'approved'
                self.detail = 'OnlyFans is answering for this account again.'
                self._on_approved(data)
                return
            reason = (data or {}).get('reason')
            if reason and reason not in ('face_id_required', 'otp_required'):
                # Proxy died, session died, something else entirely — say so
                # rather than sitting here until the timeout.
                self.status = 'error'
                self.detail = (data or {}).get('error') or reason
                return
        if self.status == 'pending':
            self.status = 'timeout'
            self.detail = ('The verification window expired without OnlyFans '
                           'lifting the check.')

    def _on_approved(self, me_data):
        """Backfill what the connect flow could not read while the gate was
        shut — username/avatar were NULL for exactly this reason."""
        try:
            db.clear_verification_required(self.crm_id, self.of_user_id)
        except Exception:
            pass
        if not isinstance(me_data, dict):
            return
        try:
            db.update_of_account_profile(
                self.crm_id, self.of_user_id,
                username=me_data.get('username'),
                avatar=me_data.get('avatar'),
                about=me_data.get('about'))
        except Exception:
            pass

    def _listen(self):
        """Open the OF socket and watch for anything that smells like the
        confirm. Purely advisory — see the module docstring."""
        try:
            from curl_cffi.requests import WebSocket
        except Exception:
            return
        auth = ws_auth(self.crm_id, self.of_user_id, self.proxy)
        if not auth:
            # Expected while the gate is shut: /users/ws-auth is account-scoped
            # too, so it is refused alongside everything else. The poll loop is
            # the real mechanism; this just means no shortcut.
            return
        session = mt_auth.load_session(self.crm_id, self.of_user_id,
                                       proxy=self.proxy) or {}
        cookies = session.get('cookies') or {}
        url = auth.get('wsUrl') or WS_URL
        token = auth.get('wsAuthToken')
        ws = WebSocket()
        try:
            ws.connect(url, cookies=cookies, proxy=self.proxy,
                       impersonate='chrome',
                       headers={'Origin': WS_ORIGIN,
                                'Cookie': '; '.join(f'{k}={v}'
                                                    for k, v in cookies.items())},
                       timeout=20)
            if token:
                ws.send_str(json.dumps({'act': 'connect', 'token': token}))
        except Exception:
            return
        last_ka = time.time()
        try:
            while not self._stop.is_set():
                try:
                    frame = ws.recv()
                except Exception:
                    return
                text = _frame_text(frame)
                if text:
                    try:
                        obj = json.loads(text)
                    except Exception:
                        obj = None
                    if obj is not None and not _is_noise(obj):
                        _record_frame(self.crm_id, self.of_user_id, text)
                    if _looks_like_confirm(obj):
                        # Don't trust it — just stop waiting out the interval
                        # and let the poll confirm against /users/me.
                        self._nudge.set()
                if time.time() - last_ka > 25:
                    try:
                        ws.send_str(json.dumps({'act': 'get_onlines', 'ids': []}))
                        last_ka = time.time()
                    except Exception:
                        return
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def _broadcast(self):
        try:
            from sse_hub import hub
            event = {'approved': 'verification.approved'}.get(
                self.status, 'verification.failed')
            hub.broadcast(self.crm_id, {
                'event_type': event,
                'payload': self.snapshot(),
            })
        except Exception:
            pass


def _frame_text(frame):
    if isinstance(frame, tuple):
        frame = frame[0]
    if isinstance(frame, (bytes, bytearray)):
        return frame.decode('utf-8', 'replace')
    return frame if isinstance(frame, str) else None


def _is_noise(obj):
    return isinstance(obj, dict) and bool(obj) and set(obj).issubset(_NOISE_KEYS)


# ── Registry ───────────────────────────────────────────────────────────────

def watch(crm_id, of_user_id, proxy=None, redirect_url=None,
          timeout=WATCH_TIMEOUT_SECONDS):
    """Start (or return) the watcher for this account.

    Idempotent on purpose: the dashboard's "start verification" button is the
    kind of thing an impatient operator clicks four times, and each extra
    watcher would be another poll loop against OF."""
    key = _key(crm_id, of_user_id)
    with _registry_guard:
        existing = _watchers.get(key)
        if existing and existing.is_alive() and existing.status == 'pending':
            if redirect_url:
                existing.redirect_url = redirect_url
            return existing
        watcher = _Watcher(crm_id, of_user_id, proxy=proxy, timeout=timeout)
        watcher.redirect_url = redirect_url
        _watchers[key] = watcher
    watcher.start()
    return watcher


def get_watcher(crm_id, of_user_id):
    with _registry_guard:
        return _watchers.get(_key(crm_id, of_user_id))


def status(crm_id, of_user_id):
    """What the status route serves. Falls back to the DB flag when no watcher
    is running (e.g. after a restart, or when the check was never started from
    here)."""
    watcher = get_watcher(crm_id, of_user_id)
    if watcher:
        return watcher.snapshot()
    account = db.get_of_account(crm_id, of_user_id) or {}
    required_at = account.get('verification_required_at')
    otp_state = account.get('verification_otp_state')
    if isinstance(otp_state, str):
        try:
            otp_state = json.loads(otp_state)
        except Exception:
            otp_state = None
    return {
        'of_user_id': str(of_user_id),
        'status': 'required' if required_at else 'clear',
        'detail': account.get('verification_reason'),
        'required_since': required_at,
        'otp_state': otp_state,
        'redirect_url': None,
    }
