#!/usr/bin/env python3
"""End-to-end regression suite for the webhook delivery path.

This is a REGRESSION GUARD, not a feature spec: it pins down what the webhook
system does today so a future change cannot silently alter it.

Does NOT touch the real DB and does NOT make a single outbound request. Two
mechanisms make that true:

1. ``DATABASE_PATH`` is pointed at a throwaway file (deleted on start) before
   ``crm_database`` is imported anywhere, so the suite is fully re-runnable.
2. The only HTTP target is a ``ThreadingHTTPServer`` bound to 127.0.0.1 on an
   ephemeral port, started by this file. Because ``webhook_delivery`` correctly
   refuses to deliver to loopback (SSRF guard in ``outbound_guard.py``), the
   guard is narrowly patched to permit 127.0.0.1 ONLY — every non-loopback URL
   still goes through the real guard, so the guard's own behaviour is not
   faked away (s13 proves the guard still fires).

Using a real socket rather than a mocked ``requests.post`` is deliberate: the
signature scenario (s01) has to verify the HMAC against the bytes that actually
went out on the wire, not against whatever object was handed to the client
library.

Run:

    cd onlyfans-api && python3 tests/test_webhook_e2e.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import queue
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Throwaway DB — must be set before crm_database is imported anywhere.
# Honour an externally supplied DATABASE_PATH (the harness sets one), but always
# start from an empty file so the suite is re-runnable, unlike several of its
# siblings which assume a virgin database.
_TMP_DIR = tempfile.mkdtemp(prefix="webhook_e2e_")
_DB_PATH = os.environ.get("DATABASE_PATH") or os.path.join(_TMP_DIR, "webhook_e2e.db")
if os.path.exists(_DB_PATH):
    os.remove(_DB_PATH)
os.environ["DATABASE_PATH"] = _DB_PATH

# config.py hard-requires these at import time.
os.environ.setdefault("SECRET_KEY", "x" * 40)
os.environ.setdefault("ENCRYPTION_KEY", "y" * 40)
os.environ.setdefault("TWOCAPTCHA_API_KEY", "z" * 16)

import crm_database as db          # noqa: E402
import event_bus                   # noqa: E402
import webhook_delivery as wd      # noqa: E402
import outbound_guard              # noqa: E402
from sse_hub import hub            # noqa: E402

_failures: list[tuple[str, str]] = []


# --------------------------------------------------------------------------
# Loopback sink — the only HTTP target in this suite.
# --------------------------------------------------------------------------

class _Received:
    __slots__ = ("path", "headers", "body")

    def __init__(self, path, headers, body):
        self.path = path
        self.headers = headers
        self.body = body


_received: list[_Received] = []
_received_lock = threading.Lock()
_hang_seconds = 3.0


class _SinkHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        with _received_lock:
            _received.append(_Received(self.path, dict(self.headers), body))

        if self.path.startswith("/hang"):
            time.sleep(_hang_seconds)
        code = 200
        if self.path.startswith("/fail"):
            code = 500
        elif self.path.startswith("/redirect"):
            code = 302
        try:
            self.send_response(code)
            if code == 302:
                self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
        except Exception:
            pass  # client already timed out and hung up

    def log_message(self, *_args):
        pass


_server = ThreadingHTTPServer(("127.0.0.1", 0), _SinkHandler)
_server.daemon_threads = True
SINK_PORT = _server.server_address[1]
threading.Thread(target=_server.serve_forever, daemon=True).start()


def _url(path: str) -> str:
    return f"http://127.0.0.1:{SINK_PORT}{path}"


# The SSRF guard legitimately blocks loopback. Permit 127.0.0.1 only, and send
# everything else through the real implementation so the guard is still under
# test (see s13).
_real_guard = outbound_guard.is_safe_outbound_url


def _guard_allowing_loopback(url, *a, **kw):
    if url.startswith(f"http://127.0.0.1:{SINK_PORT}"):
        return True, None
    return _real_guard(url, *a, **kw)


wd.is_safe_outbound_url = _guard_allowing_loopback  # type: ignore[assignment]

# Keep the hang scenario quick; the containment property under test is
# "a timeout is swallowed", which is independent of the timeout's length.
wd.DELIVERY_TIMEOUT = 1


# --------------------------------------------------------------------------
# Controllable clock.
#
# `deliver_one` computes next_retry_at as `datetime.utcnow() + timedelta(delay)`
# and `deliver_due` selects rows with `next_retry_at <= datetime.utcnow()`.
# Both read the `datetime` name bound in the webhook_delivery module, so
# swapping that one name gives complete control of the module's notion of
# "now" without touching how the ladder is computed. Advancing the clock and
# re-invoking deliver_due() is therefore exactly what the 10s scheduler job
# does in production, only faster -- no sleeping, and the assertions are exact
# rather than tolerance-based.
#
# The base instant has microsecond=0 so every derived timestamp renders as a
# fixed-width isoformat string; deliver_due compares those strings, and mixed
# widths would make the lexicographic comparison unsound.
# --------------------------------------------------------------------------

T0 = datetime(2026, 1, 1, 0, 0, 0)


class _Clock:
    now = T0

    @classmethod
    def utcnow(cls):
        return cls.now


class _clock_control:
    """Context manager installing the fake clock into webhook_delivery."""

    def __enter__(self):
        _Clock.now = T0
        self._real = wd.datetime
        wd.datetime = _Clock  # type: ignore[assignment]
        return _Clock

    def __exit__(self, *exc):
        wd.datetime = self._real  # type: ignore[assignment]
        return False


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def scenario(fn):
    def run():
        with _received_lock:
            _received.clear()
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
        except AssertionError as e:
            _failures.append((fn.__name__, str(e)))
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception:
            _failures.append((fn.__name__, traceback.format_exc()))
            print(f"  ✗ {fn.__name__} raised:\n{traceback.format_exc()}")
    run.__name__ = fn.__name__
    return run


def _sql(query, params=()):
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(query, params)
    rows = [dict(r) for r in cur.fetchall()]
    conn.commit()
    conn.close()
    return rows


def _reset_deliveries():
    """deliver_due() is global -- it picks up every pending row in the table,
    not just this scenario's. Wiping between scenarios keeps them independent
    and makes the whole file re-runnable."""
    _sql("DELETE FROM webhook_deliveries")


def _deliveries(webhook_id):
    return _sql("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id",
                (webhook_id,))


def _pending(webhook_id):
    return [d for d in _deliveries(webhook_id) if d["status"] == "pending"]


def _wh(webhook_id):
    rows = _sql("SELECT * FROM webhooks WHERE id = ?", (webhook_id,))
    return rows[0] if rows else None


def _hits(path_prefix=None):
    with _received_lock:
        got = list(_received)
    if path_prefix:
        got = [r for r in got if r.path.startswith(path_prefix)]
    return got


def _mk_webhook(crm_id, path, types, status="approved"):
    return db.create_webhook(crm_id, _url(path), types,
                             description="e2e", status=status)


def _event(crm_id="crm_e2e_a", of_user_id="777", event_type="new_tip", eid=1):
    return {
        "id": eid,
        "crm_id": crm_id,
        "of_user_id": of_user_id,
        "event_type": event_type,
        "source_event_id": f"src-{eid}",
        "payload": {"fan": {"id": "9", "username": "somefan"}, "amount": 10.0},
        "occurred_at": "2026-01-01T00:00:00",
    }


# --------------------------------------------------------------------------
# 1. Signature correctness
# --------------------------------------------------------------------------

@scenario
def s01_signature_is_hmac_over_exact_wire_bytes():
    """The HMAC must verify against the bytes that actually left the socket.

    A signature computed over a re-serialized dict would pass a naive test and
    fail in production the moment key order or separators differed, so the body
    here is the raw payload read off the wire by the sink.
    """
    wh = _mk_webhook("crm_sig", "/ok", ["new_tip"])
    ok = wd.deliver_one(wh, _event(crm_id="crm_sig", eid=101), attempt=1)
    assert ok is True, "delivery to the 200 sink did not succeed"

    hits = _hits("/ok")
    assert len(hits) == 1, f"expected 1 POST, got {len(hits)}"
    hit = hits[0]

    # --- header names + presence (as documented in EVENTS.md) ---
    for header in ("X-OnlyAPI-Signature", "X-OnlyAPI-Timestamp",
                   "X-OnlyAPI-Event", "X-OnlyAPI-Delivery-Id"):
        assert header in hit.headers, f"missing documented header {header}"
    assert hit.headers["Content-Type"] == "application/json"
    assert hit.headers["User-Agent"] == "TheOnlyAPI-Webhook/1.0"
    assert hit.headers["X-OnlyAPI-Event"] == "new_tip"

    sig = hit.headers["X-OnlyAPI-Signature"]
    ts = hit.headers["X-OnlyAPI-Timestamp"]

    # --- encoding: 'sha256=' + lowercase hex, NOT base64 ---
    assert sig.startswith("sha256="), f"signature prefix wrong: {sig!r}"
    digest = sig.split("=", 1)[1]
    assert len(digest) == 64, f"expected 64 hex chars (sha256), got {len(digest)}"
    int(digest, 16)  # raises if not hex -> proves hex, not base64
    assert digest == digest.lower(), "hex digest should be lowercase"
    assert ts.isdigit(), f"timestamp should be unix seconds, got {ts!r}"

    # --- the verifier published in EVENTS.md must accept it verbatim ---
    expected = "sha256=" + hmac.new(
        wh["secret"].encode(),
        f"{ts}.".encode() + hit.body,
        hashlib.sha256,
    ).hexdigest()
    assert hmac.compare_digest(expected, sig), (
        "EVENTS.md's documented verify() does not reproduce the sent signature")

    # --- delivery id is random hex, as documented ---
    did = hit.headers["X-OnlyAPI-Delivery-Id"]
    int(did, 16)
    assert len(did) == 16, f"delivery id length {len(did)}"

    # --- the signature is bound to the body: a single flipped byte breaks it ---
    tampered = bytearray(hit.body)
    tampered[-2] ^= 0x01
    bad = "sha256=" + hmac.new(wh["secret"].encode(),
                               f"{ts}.".encode() + bytes(tampered),
                               hashlib.sha256).hexdigest()
    assert bad != sig, "signature does not depend on the body"

    # --- and bound to the timestamp ---
    bad_ts = "sha256=" + hmac.new(wh["secret"].encode(),
                                  f"{int(ts) + 1}.".encode() + hit.body,
                                  hashlib.sha256).hexdigest()
    assert bad_ts != sig, "signature does not depend on the timestamp"

    # --- the sent bytes are compact-separator JSON; a default-separator
    #     re-serialization is a DIFFERENT byte string. This is the exact trap
    #     the scenario exists to catch: verifying against json.dumps(parsed)
    #     would be signing something other than what was sent.
    parsed = json.loads(hit.body)
    naive = json.dumps(parsed, default=str).encode()
    assert naive != hit.body, (
        "re-serialization happens to match; this test would not catch a "
        "sign-string-send-different-bytes bug")
    assert hit.body == json.dumps(parsed, separators=(",", ":"),
                                  default=str).encode()


@scenario
def s02_payload_shape_matches_events_md():
    """Body keys are exactly the six documented in EVENTS.md."""
    wh = _mk_webhook("crm_shape", "/ok", ["*"])
    ev = _event(crm_id="crm_shape", eid=202)
    wd.deliver_one(wh, ev, attempt=1)
    body = json.loads(_hits("/ok")[0].body)
    assert set(body) == {"id", "event_type", "crm_id", "of_user_id",
                         "occurred_at", "payload"}, sorted(body)
    assert body["id"] == 202
    assert body["event_type"] == "new_tip"
    assert body["crm_id"] == "crm_shape"
    assert body["of_user_id"] == "777"
    assert body["payload"]["amount"] == 10.0
    # source_event_id is internal and deliberately not exposed.
    assert "source_event_id" not in body


# --------------------------------------------------------------------------
# 2. Event-type filtering
# --------------------------------------------------------------------------

@scenario
def s03_event_type_filter_is_exact():
    """A webhook subscribed to new_tip must never see new_message."""
    crm = "crm_filter"
    tip_only = _mk_webhook(crm, "/ok?w=tip", ["new_tip"])
    star = _mk_webhook(crm, "/ok?w=star", ["*"])
    multi = _mk_webhook(crm, "/ok?w=multi", ["new_message", "new_subscriber"])

    matched = lambda et: {w["id"] for w in db.matching_webhooks(crm, et)}  # noqa: E731

    assert matched("new_tip") == {tip_only["id"], star["id"]}, matched("new_tip")
    assert tip_only["id"] not in matched("new_message"), \
        "new_tip-only webhook matched a new_message event"
    assert matched("new_message") == {star["id"], multi["id"]}
    assert matched("new_subscriber") == {star["id"], multi["id"]}
    assert matched("balance_increased") == {star["id"]}

    # And end-to-end through emit(), not just the matcher.
    _reset_deliveries()
    event_bus.emit(crm, "777", "new_message", {"text": "hi"}, source_event_id="f1")
    assert _deliveries(tip_only["id"]) == [], \
        "new_tip-only webhook received a delivery for new_message"
    assert len(_deliveries(star["id"])) == 1
    assert len(_deliveries(multi["id"])) == 1


@scenario
def s04_wildcard_scope_and_internal_events():
    """What '*' actually means.

    '*' is matched literally in db.matching_webhooks against whatever event_type
    reaches event_bus.emit() -- it is NOT restricted to crm_api's
    ALLOWED_EVENT_TYPES (that list is only enforced when a webhook is created
    over HTTP). So a '*' subscriber receives every emitted type, including
    polling_paused.

    Internal UI events (refresh.progress / refresh.complete / export.progress /
    export.complete) are broadcast straight to the SSE hub by refresh_state.py
    and export_runner.py and never pass through event_bus.emit, so they are
    structurally unreachable from webhooks. That is the invariant pinned here:
    a '*' webhook is a firehose of *emitted* events, not of SSE traffic.
    """
    crm = "crm_star"
    star = _mk_webhook(crm, "/ok?w=allstar", ["*"])
    _reset_deliveries()

    event_bus.emit(crm, "777", "polling_paused",
                   {"reason": "auth", "failures": 5}, source_event_id="p1")
    assert len(_deliveries(star["id"])) == 1, "'*' did not receive polling_paused"

    # An event type outside ALLOWED_EVENT_TYPES still matches '*' at this layer.
    event_bus.emit(crm, "777", "some_future_type", {}, source_event_id="p2")
    assert len(_deliveries(star["id"])) == 2, \
        "'*' is unexpectedly restricted to a fixed taxonomy at the matcher"

    # Internal events go direct to the hub and must not produce a delivery.
    before = len(_deliveries(star["id"]))
    hub.broadcast(crm, {"event_type": "refresh.progress", "payload": {}})
    hub.broadcast(crm, {"event_type": "export.complete", "payload": {}})
    assert len(_deliveries(star["id"])) == before, \
        "an internal SSE-only event reached a webhook"


# --------------------------------------------------------------------------
# 3. Retry ladder
# --------------------------------------------------------------------------

@scenario
def s05_retry_ladder_is_exactly_5s_30s_5m_30m_2h():
    """Walk the whole ladder with a controlled clock -- no sleeping.

    Each step asserts the gap between the clock and the freshly written
    next_retry_at, so the intervals are checked exactly (not within a
    tolerance) and in sequence.
    """
    crm = "crm_ladder"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()
    ev = _event(crm_id=crm, eid=None)

    # deliver_due rebuilds the event from account_events, so it must exist.
    eid, is_new = db.insert_event(crm, "777", "new_tip", {"amount": 1},
                                  source_event_id="ladder-1")
    assert is_new
    ev["id"] = eid

    expected = [5, 30, 300, 1800, 7200]
    observed = []

    with _clock_control() as clock:
        ok = wd.deliver_one(wh, ev, attempt=1)
        assert ok is False, "the /fail sink returned 500 but delivery reported success"

        for step in range(len(expected)):
            pend = _pending(wh["id"])
            assert len(pend) == 1, \
                f"step {step}: expected exactly 1 pending row, got {len(pend)}"
            row = pend[0]
            assert row["attempt"] == step + 1, \
                f"step {step}: attempt should be {step + 1}, got {row['attempt']}"
            assert row["response_code"] == 500, row["response_code"]

            gap = datetime.fromisoformat(row["next_retry_at"]) - clock.now
            observed.append(int(gap.total_seconds()))

            # Advance to exactly the scheduled instant and let the retry worker run.
            clock.now = datetime.fromisoformat(row["next_retry_at"])
            wd.deliver_due()

    assert observed == expected, f"retry ladder is {observed}, expected {expected}"

    rows = _deliveries(wh["id"])
    attempts = [r["attempt"] for r in rows]
    assert attempts == [1, 2, 3, 4, 5, 6], attempts
    assert len(_hits("/fail")) == 6, \
        f"expected 6 POSTs (1 initial + 5 retries), got {len(_hits('/fail'))}"

    # The first five rows were superseded by their retry; the last is terminal.
    assert [r["status"] for r in rows] == ["superseded"] * 5 + ["failed"], \
        [r["status"] for r in rows]
    assert rows[-1]["next_retry_at"] is None, "a 6th retry was scheduled"
    assert _pending(wh["id"]) == [], "ladder left a pending row behind"

    # An exhausted ladder counts as ONE consecutive failure, not six: only
    # status='failed' increments the counter (status='pending' does not).
    assert _wh(wh["id"])["consecutive_failures"] == 1, \
        _wh(wh["id"])["consecutive_failures"]
    assert wd.MAX_ATTEMPTS == 6
    assert wd.RETRY_SCHEDULE_SECONDS == expected


@scenario
def s06_deliver_due_ignores_rows_before_their_time():
    """The worker must not fire a retry early."""
    crm = "crm_early"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()
    eid, _ = db.insert_event(crm, "777", "new_tip", {}, source_event_id="early-1")
    ev = _event(crm_id=crm, eid=eid)

    with _clock_control() as clock:
        wd.deliver_one(wh, ev, attempt=1)
        assert len(_hits("/fail")) == 1
        # One second short of the 5s retry.
        clock.now = T0 + timedelta(seconds=4)
        wd.deliver_due()
        assert len(_hits("/fail")) == 1, "retry fired before next_retry_at"
        clock.now = T0 + timedelta(seconds=5)
        wd.deliver_due()
        assert len(_hits("/fail")) == 2, "retry did not fire at next_retry_at"


# --------------------------------------------------------------------------
# 4 + 5. Auto-deactivation and recovery
# --------------------------------------------------------------------------

@scenario
def s07_auto_deactivates_at_exactly_five_failures():
    """4 terminal failures leave it active; the 5th deactivates it.

    NOTE the unit: the counter advances once per *terminal* failure
    (record_webhook_delivery only increments on status='failed'), and a
    retryable failure writes status='pending'. So this is 5 exhausted delivery
    chains, not 5 HTTP errors.
    """
    crm = "crm_deact"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()

    for i in range(4):
        db.record_webhook_delivery(webhook_id=wh["id"], event_id=None,
                                   status="failed", response_code=500,
                                   attempt=wd.MAX_ATTEMPTS, completed=True)
        cur = _wh(wh["id"])
        assert cur["consecutive_failures"] == i + 1, cur["consecutive_failures"]
        assert cur["is_active"] == 1, \
            f"deactivated after only {i + 1} consecutive failures"

    db.record_webhook_delivery(webhook_id=wh["id"], event_id=None,
                               status="failed", response_code=500,
                               attempt=wd.MAX_ATTEMPTS, completed=True)
    cur = _wh(wh["id"])
    assert cur["consecutive_failures"] == 5, cur["consecutive_failures"]
    assert cur["is_active"] == 0, "5 consecutive failures did not deactivate"

    # A deactivated webhook drops out of the matcher entirely.
    assert wh["id"] not in {w["id"] for w in db.matching_webhooks(crm, "new_tip")}


@scenario
def s08_pending_retries_do_not_advance_the_failure_counter():
    """Guards the unit distinction s07 relies on."""
    crm = "crm_pendcount"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()
    eid, _ = db.insert_event(crm, "777", "new_tip", {}, source_event_id="pc-1")
    with _clock_control():
        wd.deliver_one(wh, _event(crm_id=crm, eid=eid), attempt=1)
    assert _pending(wh["id"]), "expected a pending retry row"
    assert _wh(wh["id"])["consecutive_failures"] == 0, \
        "a retryable failure incremented consecutive_failures"
    assert _wh(wh["id"])["is_active"] == 1


@scenario
def s09_success_resets_consecutive_failures():
    """Recovery: a webhook that eventually succeeds is fully rehabilitated."""
    crm = "crm_recover"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()

    for _ in range(4):
        db.record_webhook_delivery(webhook_id=wh["id"], event_id=None,
                                   status="failed", response_code=500,
                                   attempt=wd.MAX_ATTEMPTS, completed=True)
    assert _wh(wh["id"])["consecutive_failures"] == 4
    assert _wh(wh["id"])["is_active"] == 1

    # Repoint at the 200 sink and deliver for real.
    db.update_webhook(crm, wh["id"], url=_url("/ok"))
    live = db.get_webhook(crm, wh["id"])
    eid, _ = db.insert_event(crm, "777", "new_tip", {}, source_event_id="rec-1")
    ok = wd.deliver_one(live, _event(crm_id=crm, eid=eid), attempt=1)
    assert ok is True, "delivery to the 200 sink failed"

    after = _wh(wh["id"])
    assert after["consecutive_failures"] == 0, \
        f"success did not reset consecutive_failures (={after['consecutive_failures']})"
    assert after["is_active"] == 1
    assert after["last_status_code"] == 200, after["last_status_code"]
    assert after["last_delivery_at"] is not None

    # The counter is a *consecutive* run: the next failure restarts from 1.
    db.record_webhook_delivery(webhook_id=wh["id"], event_id=None,
                               status="failed", response_code=500,
                               attempt=wd.MAX_ATTEMPTS, completed=True)
    assert _wh(wh["id"])["consecutive_failures"] == 1


@scenario
def s10_recovery_mid_ladder_resets_and_stops_retrying():
    """A retry that succeeds ends the chain and clears the counter."""
    crm = "crm_midladder"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()
    eid, _ = db.insert_event(crm, "777", "new_tip", {}, source_event_id="ml-1")

    with _clock_control() as clock:
        wd.deliver_one(wh, _event(crm_id=crm, eid=eid), attempt=1)
        assert len(_pending(wh["id"])) == 1
        # Target comes back up before the retry lands.
        db.update_webhook(crm, wh["id"], url=_url("/ok"))
        clock.now = T0 + timedelta(seconds=5)
        wd.deliver_due()

    rows = _deliveries(wh["id"])
    assert rows[-1]["status"] == "success", [r["status"] for r in rows]
    assert rows[-1]["attempt"] == 2
    assert _pending(wh["id"]) == [], "chain kept retrying after a success"
    assert _wh(wh["id"])["consecutive_failures"] == 0


# --------------------------------------------------------------------------
# 6. Dedup interaction
# --------------------------------------------------------------------------

@scenario
def s11_duplicate_event_does_not_enqueue_a_second_delivery():
    """account_events is UNIQUE(crm_id, of_user_id, event_type, source_event_id);
    emit() returns None on the dupe and must short-circuit the whole fan-out."""
    crm = "crm_dedup"
    wh = _mk_webhook(crm, "/ok", ["new_tip"])
    _reset_deliveries()

    first = event_bus.emit(crm, "777", "new_tip", {"amount": 5},
                           source_event_id="dup-1")
    assert first is not None, "first emit was deduplicated"
    assert len(_deliveries(wh["id"])) == 1
    assert len(_hits("/ok")) == 1

    second = event_bus.emit(crm, "777", "new_tip", {"amount": 5},
                            source_event_id="dup-1")
    assert second is None, "duplicate emit was treated as new"
    assert len(_deliveries(wh["id"])) == 1, \
        "a duplicate event enqueued a second webhook delivery"
    assert len(_hits("/ok")) == 1, "a duplicate event produced a second POST"

    # The uniqueness key includes event_type and of_user_id, so those still fan out.
    event_bus.emit(crm, "777", "new_tip", {"amount": 5}, source_event_id="dup-2")
    assert len(_deliveries(wh["id"])) == 2
    rows = _sql("SELECT COUNT(*) c FROM account_events WHERE crm_id = ?", (crm,))
    assert rows[0]["c"] == 2, rows[0]["c"]


# --------------------------------------------------------------------------
# 7. Multi-tenant isolation
# --------------------------------------------------------------------------

@scenario
def s12_webhooks_never_cross_tenant_boundaries():
    """The product's core invariant: crm A's webhook must never see crm B's
    events, even when both subscribe to '*'."""
    a, b = "crm_iso_a", "crm_iso_b"
    wh_a = _mk_webhook(a, "/ok?t=a", ["*"])
    wh_b = _mk_webhook(b, "/ok?t=b", ["*"])
    _reset_deliveries()

    assert {w["id"] for w in db.matching_webhooks(a, "new_tip")} == {wh_a["id"]}
    assert {w["id"] for w in db.matching_webhooks(b, "new_tip")} == {wh_b["id"]}

    event_bus.emit(a, "777", "new_tip", {"amount": 1}, source_event_id="iso-a")
    assert len(_deliveries(wh_a["id"])) == 1
    assert _deliveries(wh_b["id"]) == [], "crm B's webhook received crm A's event"

    event_bus.emit(b, "888", "new_tip", {"amount": 2}, source_event_id="iso-b")
    assert len(_deliveries(wh_a["id"])) == 1, "crm A's webhook received crm B's event"
    assert len(_deliveries(wh_b["id"])) == 1

    # Bodies carry the right tenant, and each landed on its own path.
    for hit in _hits("/ok"):
        body = json.loads(hit.body)
        expected = a if "t=a" in hit.path else b
        assert body["crm_id"] == expected, f"{hit.path} got crm_id={body['crm_id']}"

    # Cross-tenant reads are scoped too: A cannot fetch or list B's webhook.
    assert db.get_webhook(a, wh_b["id"]) is None, "cross-tenant get_webhook leak"
    assert db.list_webhook_deliveries(a, wh_b["id"]) == [], \
        "cross-tenant delivery-log leak"
    assert wh_b["id"] not in {w["id"] for w in db.list_webhooks(a)}
    # ...and A cannot delete B's webhook.
    assert db.delete_webhook(a, wh_b["id"]) is False, "cross-tenant delete succeeded"
    assert db.get_webhook(b, wh_b["id"]) is not None


@scenario
def s13_ssrf_guard_still_blocks_non_loopback_internal_targets():
    """The loopback allowance in this file is scoped to the sink port only --
    the real guard is still in force for everything else."""
    crm = "crm_ssrf"
    wh = db.create_webhook(crm, "http://169.254.169.254/latest/meta-data/",
                           ["new_tip"], status="approved")
    _reset_deliveries()
    ok = wd.deliver_one(wh, _event(crm_id=crm, eid=1), attempt=1)
    assert ok is False
    rows = _deliveries(wh["id"])
    assert len(rows) == 1
    assert rows[0]["status"] == "failed", rows[0]["status"]
    assert "blocked:" in (rows[0]["response_snippet"] or ""), rows[0]["response_snippet"]
    assert rows[0]["next_retry_at"] is None, "a blocked target was scheduled for retry"


# --------------------------------------------------------------------------
# 8. Failure containment
# --------------------------------------------------------------------------

@scenario
def s14_failing_webhook_does_not_break_emit_or_sse():
    """A 500, a hang, and a connection-refused target must not stop emit() from
    returning, must not stop the SSE broadcast, and must not stop a healthy
    sibling webhook from being delivered."""
    crm = "crm_contain"
    bad500 = _mk_webhook(crm, "/fail", ["*"])
    hanger = _mk_webhook(crm, "/hang", ["*"])
    # Nothing is listening on this port -> ConnectionRefused inside requests.
    dead = db.create_webhook(crm, f"http://127.0.0.1:{SINK_PORT}", ["*"],
                             status="approved")
    _sql("UPDATE webhooks SET url = ? WHERE id = ?",
         (f"http://127.0.0.1:{SINK_PORT}/ok", dead["id"]))
    good = _mk_webhook(crm, "/ok?w=good", ["*"])
    _reset_deliveries()

    q = hub.subscribe(crm)
    try:
        out = event_bus.emit(crm, "777", "new_tip", {"amount": 3},
                             source_event_id="contain-1")
    finally:
        hub.unsubscribe(crm, q)

    assert out is not None, "emit() returned None despite a brand-new event"
    assert out["event_type"] == "new_tip"

    # SSE broadcast happened for this exact event.
    got = []
    while True:
        try:
            got.append(q.get_nowait())
        except queue.Empty:
            break
    assert len(got) == 1, f"expected 1 SSE broadcast, got {len(got)}"
    assert got[0]["source_event_id"] == "contain-1", got[0]
    assert got[0]["id"] == out["id"]

    # Every webhook got its attempt recorded; the healthy one succeeded.
    assert len(_deliveries(good["id"])) == 1
    assert _deliveries(good["id"])[0]["status"] == "success", \
        "a healthy webhook was starved by its failing siblings"
    assert len(_deliveries(bad500["id"])) == 1
    assert _deliveries(bad500["id"])[0]["status"] == "pending"
    assert len(_deliveries(hanger["id"])) == 1
    hang_row = _deliveries(hanger["id"])[0]
    assert hang_row["status"] == "pending", hang_row["status"]
    assert hang_row["response_code"] is None, "a timeout produced a status code"
    assert "error" in (hang_row["response_snippet"] or "").lower(), \
        hang_row["response_snippet"]

    # The event is persisted exactly once regardless of webhook outcomes.
    rows = _sql("SELECT COUNT(*) c FROM account_events WHERE crm_id = ?", (crm,))
    assert rows[0]["c"] == 1, rows[0]["c"]


@scenario
def s15_deliver_due_drops_retries_for_deactivated_webhooks():
    """Once auto-deactivated, queued retries stop rather than draining."""
    crm = "crm_dropped"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()
    eid, _ = db.insert_event(crm, "777", "new_tip", {}, source_event_id="drop-1")

    with _clock_control() as clock:
        wd.deliver_one(wh, _event(crm_id=crm, eid=eid), attempt=1)
        assert len(_hits("/fail")) == 1
        db.update_webhook(crm, wh["id"], is_active=False)
        clock.now = T0 + timedelta(seconds=5)
        wd.deliver_due()

    assert len(_hits("/fail")) == 1, "a deactivated webhook was still retried"
    assert _pending(wh["id"]) == []
    assert _deliveries(wh["id"])[-1]["status"] == "failed"


@scenario
def s16_reactivating_clears_the_failure_counter():
    """PATCH is_active=true is the documented way back; it must reset the run
    or the webhook would deactivate again on its very next failure."""
    crm = "crm_reactivate"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    for _ in range(5):
        db.record_webhook_delivery(webhook_id=wh["id"], event_id=None,
                                   status="failed", response_code=500,
                                   attempt=wd.MAX_ATTEMPTS, completed=True)
    assert _wh(wh["id"])["is_active"] == 0
    db.update_webhook(crm, wh["id"], is_active=True)
    after = _wh(wh["id"])
    assert after["is_active"] == 1
    assert after["consecutive_failures"] == 0, after["consecutive_failures"]


# --------------------------------------------------------------------------
# Bugs found while writing this suite. Both scenarios below assert the FIXED
# behaviour; see the report / git diff for the fixes.
# --------------------------------------------------------------------------

@scenario
def s17_repointing_an_approved_webhook_requires_re_approval():
    """BUG (approval bypass): db.update_webhook() changed `url` without
    touching `status`, so the admin domain-review gate could be walked around:
    create a webhook on an auto-approved allowlisted domain (discord.com),
    then PATCH the url to any attacker-controlled host and keep status
    'approved'. Deliveries -- signed with the tenant's secret and carrying fan
    PII -- would then flow to a host no admin ever reviewed.

    Fixed: changing the url to a different host re-arms review unless the new
    host is itself already approved.
    """
    crm = "crm_repoint"
    wh = db.create_webhook(crm, "https://discord.com/api/webhooks/1/abc",
                           ["new_tip"], status="approved")
    assert wh["status"] == "approved"

    moved = db.update_webhook(crm, wh["id"], url="https://evil.example.com/collect")
    assert moved["status"] == "pending", (
        "repointing an approved webhook at a new host kept status='approved' "
        "-- admin domain review bypassed")
    assert wh["id"] not in {w["id"] for w in db.matching_webhooks(crm, "new_tip")}, \
        "a repointed, unreviewed webhook is still receiving deliveries"

    # Same host, different path -> no re-review (that would be pointless churn).
    back = db.update_webhook(crm, wh["id"], url="https://discord.com/api/webhooks/1/abc")
    assert back["status"] == "approved", back["status"]
    same_host = db.update_webhook(crm, wh["id"],
                                  url="https://discord.com/api/webhooks/2/xyz")
    assert same_host["status"] == "approved", \
        "a same-host path change needlessly re-armed review"

    # Non-url edits must never disturb status.
    edited = db.update_webhook(crm, wh["id"], description="renamed")
    assert edited["status"] == "approved"


@scenario
def s18_rejected_webhook_stops_receiving_queued_retries():
    """BUG (rejected webhook keeps delivering): admin reject sets
    status='rejected' but leaves is_active=1, and deliver_due() only ever
    checked is_active. Any retry already queued therefore kept firing at a host
    an admin had explicitly just refused -- for up to 2h down the ladder.
    matching_webhooks() blocks NEW events, so this was the retry path only.

    Fixed: deliver_due() now honours status the same way matching_webhooks does.
    """
    crm = "crm_rejected"
    wh = _mk_webhook(crm, "/fail", ["new_tip"])
    _reset_deliveries()
    eid, _ = db.insert_event(crm, "777", "new_tip", {}, source_event_id="rej-1")

    with _clock_control() as clock:
        wd.deliver_one(wh, _event(crm_id=crm, eid=eid), attempt=1)
        assert len(_hits("/fail")) == 1
        assert len(_pending(wh["id"])) == 1

        # Admin rejects it mid-ladder.
        db.set_webhook_status(wh["id"], "rejected", reject_reason="nope")
        assert _wh(wh["id"])["status"] == "rejected"

        clock.now = T0 + timedelta(seconds=5)
        wd.deliver_due()

    assert len(_hits("/fail")) == 1, (
        "a webhook the admin rejected still received its queued retry")
    assert _pending(wh["id"]) == [], "rejected webhook still has a live retry queued"
    assert _deliveries(wh["id"])[-1]["status"] == "failed"

    # New events were already blocked by the matcher -- confirm that too.
    _reset_deliveries()
    event_bus.emit(crm, "777", "new_tip", {}, source_event_id="rej-2")
    assert _deliveries(wh["id"]) == [], "a rejected webhook received a new event"


def main():
    scenarios = [
        s01_signature_is_hmac_over_exact_wire_bytes,
        s02_payload_shape_matches_events_md,
        s03_event_type_filter_is_exact,
        s04_wildcard_scope_and_internal_events,
        s05_retry_ladder_is_exactly_5s_30s_5m_30m_2h,
        s06_deliver_due_ignores_rows_before_their_time,
        s07_auto_deactivates_at_exactly_five_failures,
        s08_pending_retries_do_not_advance_the_failure_counter,
        s09_success_resets_consecutive_failures,
        s10_recovery_mid_ladder_resets_and_stops_retrying,
        s11_duplicate_event_does_not_enqueue_a_second_delivery,
        s12_webhooks_never_cross_tenant_boundaries,
        s13_ssrf_guard_still_blocks_non_loopback_internal_targets,
        s14_failing_webhook_does_not_break_emit_or_sse,
        s15_deliver_due_drops_retries_for_deactivated_webhooks,
        s16_reactivating_clears_the_failure_counter,
        s17_repointing_an_approved_webhook_requires_re_approval,
        s18_rejected_webhook_stops_receiving_queued_retries,
    ]
    print(f"webhook end-to-end suite ({len(scenarios)} scenarios, "
          f"sink on 127.0.0.1:{SINK_PORT})")
    try:
        for s in scenarios:
            s()
    finally:
        _server.shutdown()
        shutil.rmtree(_TMP_DIR, ignore_errors=True)
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for name, msg in _failures:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    print(f"All {len(scenarios)} scenarios passed.")


if __name__ == "__main__":
    main()
