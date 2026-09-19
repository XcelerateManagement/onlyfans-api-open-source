#!/usr/bin/env python3
"""Scenario suite for earnings_model.compute_current_spent.

These tests use a temp sqlite file (not the real crm_data.db) so they can write
fresh fixtures for each scenario without touching any real session data.

Invariants under test (from earnings_model.py):
    I1  no double-counting (strict `>` against snapshot_at)
    I2  chargebacks (status='undo') subtract
    I3  pending clears (status='loading') count
    I4  unknown statuses are ignored
    I5  orphan tx (no subs row) still sum
    I6  timestamp comparison works on canonical format

Each scenario is a standalone function. On failure the script exits non-zero
and prints the offending assertion. Run:

    cd onlyfans-api && python3 tests/test_earnings_scenarios.py
"""

from __future__ import annotations

import os
import sys
import sqlite3
import tempfile
import traceback
from datetime import datetime, timezone, timedelta

# Point crm_database at a scratch DB before importing. crm_database.init_database
# runs on import and creates tables; we want that to land in our temp file.
TMPDIR = tempfile.mkdtemp(prefix="earnings_tests_")
SCRATCH_DB = os.path.join(TMPDIR, "scratch.db")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database  # noqa: E402

# Rebind DB_FILE BEFORE init runs against the real one. Already ran on import,
# so re-init against our scratch path:
crm_database.DB_FILE = SCRATCH_DB
crm_database.init_database()

import earnings_model  # noqa: E402
# earnings_model uses crm_database.DB_FILE, which we've rebound. Good.


# ---- fixture helpers ------------------------------------------------------

CRM = "crm_test"
ACCOUNT = "100"

def _panel_and_account():
    """Give us one panel + one of_account so mark_subscribers_refresh works."""
    now = crm_database.iso_utc_now()
    conn = sqlite3.connect(SCRATCH_DB); cur = conn.cursor()
    cur.execute("INSERT OR IGNORE INTO crm_panels(crm_id, name, api_key, created_at) VALUES(?,?,?,?)",
                (CRM, "test", "k", now))
    cur.execute("SELECT id FROM crm_panels WHERE crm_id=?", (CRM,))
    panel_id = cur.fetchone()[0]
    cur.execute("""INSERT OR IGNORE INTO of_accounts(crm_panel_id, of_user_id, email, created_at)
                   VALUES(?,?,?,?)""", (panel_id, ACCOUNT, "e@e", now))
    # The "leak" scenario needs a row for the sibling account too
    cur.execute("""INSERT OR IGNORE INTO of_accounts(crm_panel_id, of_user_id, email, created_at)
                   VALUES(?,?,?,?)""", (panel_id, "999", "leak@e", now))
    conn.commit(); conn.close()

def _reset():
    """Wipe the per-test caches so scenarios don't bleed into each other."""
    conn = sqlite3.connect(SCRATCH_DB); cur = conn.cursor()
    for t in ("subscribers_cache", "transactions_cache"):
        cur.execute(f"DELETE FROM {t} WHERE crm_id=?", (CRM,))
    cur.execute("UPDATE of_accounts SET last_subscribers_refresh_at=NULL, "
                "last_transactions_refresh_at=NULL, last_tx_marker=NULL")
    conn.commit(); conn.close()

def _force_snapshot_at(fan_id: str, iso: str):
    """Override last_synced_at for a fan. Used to simulate a stale subs sync."""
    conn = sqlite3.connect(SCRATCH_DB)
    conn.execute("""UPDATE subscribers_cache SET last_synced_at=?
                    WHERE crm_id=? AND of_user_id=? AND fan_of_user_id=?""",
                 (iso, CRM, ACCOUNT, str(fan_id)))
    conn.commit(); conn.close()

def _fan_payload(fan_id, *, total=0, tips=0, msgs=0, posts=0, streams=0, subs=0,
                 subscribeAt="2026-01-01T00:00:00+00:00"):
    """Build a realistic /subscribers/latest user object."""
    return {
        "id": fan_id,
        "username": f"u{fan_id}",
        "name": f"Fan {fan_id}",
        "subscribedByData": {"subscribeAt": subscribeAt, "expiredAt": "2036-01-01T00:00:00+00:00",
                             "subscribePrice": 5},
        "subscribedOnData": {"subscribeAt": subscribeAt, "expiredAt": "2036-01-01T00:00:00+00:00",
                             "subscribePrice": 5,
                             "totalSumm": total,
                             "tipsSumm": tips,
                             "messagesSumm": msgs,
                             "postsSumm": posts,
                             "streamsSumm": streams,
                             "subscribesSumm": subs},
    }

def _tx(tx_id, fan_id, amount, *, created_at, status="done",
        description="Payment for message from <a>x</a>", net=None, fee=None):
    """Build a realistic /payouts/transactions entry.

    Defaults `net == amount` (fee=0) so scenarios can reason about a single
    number. Earnings math runs against NET (see the "Currency basis" note in
    earnings_model.py); s15 separately pins the "net vs amount" semantics with
    a realistic 20% fee to guard against regressions."""
    if net is None:
        net = amount
        fee = 0
    if fee is None:
        fee = amount - net
    return {
        "id": tx_id,
        "amount": amount,
        "net": net,
        "fee": fee,
        "vatAmount": 0,
        "taxAmount": 0,
        "mediaTaxAmount": 0,
        "currency": "USD",
        "description": description,
        "status": status,
        "createdAt": created_at,
        "user": {"id": fan_id, "username": f"u{fan_id}", "isDeleted": False},
    }


# ---- scenarios ----------------------------------------------------------

_failures = []

def scenario(fn):
    """Decorator: run the scenario with a clean slate, capture failures."""
    def run():
        _reset()
        try:
            fn()
            print(f"  ✓ {fn.__name__}")
        except AssertionError as e:
            _failures.append((fn.__name__, str(e)))
            print(f"  ✗ {fn.__name__}: {e}")
        except Exception:
            _failures.append((fn.__name__, traceback.format_exc()))
            print(f"  ✗ {fn.__name__} raised:\n{traceback.format_exc()}")
    return run


@scenario
def s01_fresh_snapshot_no_tx():
    """Canonical=$100, no tx → current=$100, delta=0."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100, msgs=100))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['canonical'] == 100.0, r
    assert r['delta_signed'] == 0.0, r
    assert r['current_spent'] == 100.0, r
    assert r['source'] == 'canonical+delta', r


@scenario
def s02_stale_snapshot_new_tip_counts():
    """Canonical=$100 synced 7d ago, $50 tip since → current=$150."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100, msgs=100))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("tx1", 1, 50, created_at="2026-04-05T00:00:00+00:00", status="done",
            description="Tip from <a>x</a>"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['canonical'] == 100.0, r
    assert r['delta_signed'] == 50.0, r
    assert r['current_spent'] == 150.0, r


@scenario
def s03_chargeback_subtracts():
    """Canonical=$100, $50 tip + $20 chargeback after snapshot → current=$130."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100, msgs=100))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("paid", 1, 50, created_at="2026-04-05T00:00:00+00:00", status="done"))
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("cb",   1, 20, created_at="2026-04-06T00:00:00+00:00", status="undo",
            description="Refund: chargeback via ethoca_alert"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['canonical'] == 100.0, r
    assert r['delta_positive'] == 50.0, r
    assert r['delta_negative'] == 20.0, r
    assert r['delta_signed']   == 30.0, r       # 50 - 20
    assert r['current_spent']  == 130.0, r      # 100 + 30


@scenario
def s04_loading_counts_as_spent():
    """status=loading (payoutPendingDays hold) still = real spend."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=0))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("t", 1, 40, created_at="2026-04-17T00:00:00+00:00", status="loading"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['current_spent'] == 40.0, r


@scenario
def s05_unknown_status_is_ignored():
    """I4: a made-up status doesn't enter positive or negative buckets."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=10))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("bad", 1, 9999, created_at="2026-04-05T00:00:00+00:00", status="mysteryXYZ"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['delta_signed']  == 0.0, r
    assert r['current_spent'] == 10.0, r


@scenario
def s06_tx_at_exact_snapshot_second_is_canonical():
    """I1: tx.created_at == subs.last_synced_at → excluded from delta, stays in canonical."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100))
    _force_snapshot_at(1, "2026-04-10T12:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("t", 1, 999, created_at="2026-04-10T12:00:00+00:00", status="done"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['delta_signed']  == 0.0, r
    assert r['current_spent'] == 100.0, r


@scenario
def s07_tx_one_second_after_snapshot_is_delta():
    """I6: strict `>` on canonical timestamps works."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100))
    _force_snapshot_at(1, "2026-04-10T12:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("t", 1, 5, created_at="2026-04-10T12:00:01+00:00", status="done"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['delta_signed']  == 5.0, r
    assert r['current_spent'] == 105.0, r


@scenario
def s08_orphan_tx_no_subs_row():
    """I5: fan has tx but no subs row (sample effect or just-joined). tx-only."""
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("t", 77, 25, created_at="2026-04-05T00:00:00+00:00", status="done"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 77)
    assert r['source']        == 'tx-only', r
    assert r['canonical']     == 0.0, r
    assert r['current_spent'] == 25.0, r


@scenario
def s09_subs_only_no_tx():
    """Only a subs row, no tx. Canonical is the whole answer."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(5, total=77, tips=77))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 5)
    assert r['current_spent'] == 77.0, r
    assert r['delta_signed']  == 0.0, r


@scenario
def s10_multi_sync_cycle():
    """Simulates 3 sync cycles:
         T0: subs sync, canonical=$100, no tx.
         T1 (t+1d): $40 tip lands in tx cache. current=$140.
         T2 (t+2d): subs sync fires, canonical is refreshed by OF to $140.
                    That same $40 tx is now 'baked in' on the canonical side.
                    Our delta must collapse to 0 — no double count.
    """
    # T0
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    # T1
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("tip", 1, 40, created_at="2026-04-02T00:00:00+00:00", status="done"))
    r1 = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r1['current_spent'] == 140.0, r1
    # T2 — subs sync happens: OF returns fresh totalSumm=140 and we rewrite
    # last_synced_at to now (after the tx). Our tx row is still in the cache.
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=140))
    _force_snapshot_at(1, "2026-04-03T00:00:00+00:00")  # after the tx
    r2 = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r2['canonical']     == 140.0, r2
    assert r2['delta_signed']  == 0.0,  r2       # no double-count
    assert r2['current_spent'] == 140.0, r2


@scenario
def s11_cross_account_isolation():
    """A tx under a different of_user_id must NOT leak into this one's sum."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    # tx under a DIFFERENT of_user_id
    crm_database.upsert_transaction(CRM, "999",
        _tx("leak", 1, 9999, created_at="2026-04-05T00:00:00+00:00", status="done"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['delta_signed']  == 0.0, r
    assert r['current_spent'] == 100.0, r


@scenario
def s12_bulk_matches_per_fan():
    """compute_current_spent_bulk must equal per-fan calls."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100))
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(2, total=50))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    _force_snapshot_at(2, "2026-04-01T00:00:00+00:00")
    crm_database.upsert_transaction(CRM, ACCOUNT, _tx("a", 1, 10, created_at="2026-04-05T00:00:00+00:00"))
    crm_database.upsert_transaction(CRM, ACCOUNT, _tx("b", 2, 20, created_at="2026-04-05T00:00:00+00:00"))
    crm_database.upsert_transaction(CRM, ACCOUNT, _tx("c", 3, 30, created_at="2026-04-05T00:00:00+00:00"))  # orphan
    bulk = earnings_model.compute_current_spent_bulk(CRM, ACCOUNT)
    assert bulk['1']['current_spent'] == 110.0
    assert bulk['2']['current_spent'] == 70.0
    assert bulk['3']['current_spent'] == 30.0
    assert bulk['3']['source'] == 'tx-only'


@scenario
def s13_chargeback_of_pre_snapshot_tx():
    """A chargeback that happens AFTER snapshot for a tx that happened BEFORE
    snapshot: the original spend is baked into canonical; our delta only
    subtracts the chargeback. Result: canonical - chargeback.

    This is the "chargeback applied between sub syncs" case — canonical over-
    counts, delta undercounts by -chargeback, and they meet at the right number."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=100))
    _force_snapshot_at(1, "2026-04-05T00:00:00+00:00")
    # Chargeback landed AFTER the snapshot (the original spend is inside canonical,
    # not in the ledger slice we're summing)
    crm_database.upsert_transaction(CRM, ACCOUNT,
        _tx("cb", 1, 30, created_at="2026-04-07T00:00:00+00:00", status="undo",
            description="Refund: chargeback"))
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['canonical']      == 100.0, r
    assert r['delta_negative'] == 30.0, r
    assert r['delta_signed']   == -30.0, r
    assert r['current_spent']  == 70.0, r


@scenario
def s15_delta_uses_net_not_amount():
    """Earnings model MUST sum tx.net, not tx.amount.

    subs.total_spent comes from subscribedOnData.totalSumm which is NET to
    creator (after the 20% OF fee). If the delta walker summed gross amounts,
    current_spent and canonical would diverge by 1/(1-fee) (~1.25×) on a fully-
    cached fan, making the UI's Total vs Mapped columns look wildly wrong.

    Fan subscribes with totalSumm=$80 (net). A $50-gross / $40-net tip lands
    after the snapshot. current_spent must be canonical($80) + net-delta($40)
    = $120. If someone breaks this back to summing gross, we'd see $130."""
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan_payload(1, total=80, msgs=80))
    _force_snapshot_at(1, "2026-04-01T00:00:00+00:00")
    crm_database.upsert_transaction(
        CRM, ACCOUNT,
        _tx("tip", 1, 50, created_at="2026-04-05T00:00:00+00:00",
            net=40, fee=10, status="done"),
    )
    r = earnings_model.compute_current_spent(CRM, ACCOUNT, 1)
    assert r['canonical']      == 80.0, r
    assert r['delta_positive'] == 40.0, r   # net, NOT the $50 gross
    assert r['delta_signed']   == 40.0, r
    assert r['current_spent']  == 120.0, r  # 80 + 40 = 120 (would be 130 if buggy)


@scenario
def s14_breakdown_populated_from_subscribedOnData():
    """Breakdown fields (tips/messages/...) pull from subscribedOnData.*Summ."""
    crm_database.upsert_subscriber(CRM, ACCOUNT,
        _fan_payload(1, total=200, tips=20, msgs=150, posts=30, streams=0, subs=0))
    conn = sqlite3.connect(SCRATCH_DB); conn.row_factory = sqlite3.Row
    row = dict(conn.execute("SELECT * FROM subscribers_cache WHERE fan_of_user_id='1'").fetchone())
    conn.close()
    assert row['total_spent']   == 200
    assert row['spent_tips']    == 20
    assert row['spent_messages']== 150
    assert row['spent_posts']   == 30


# ---- run ----------------------------------------------------------------

def main():
    _panel_and_account()
    scenarios = [
        s01_fresh_snapshot_no_tx,
        s02_stale_snapshot_new_tip_counts,
        s03_chargeback_subtracts,
        s04_loading_counts_as_spent,
        s05_unknown_status_is_ignored,
        s06_tx_at_exact_snapshot_second_is_canonical,
        s07_tx_one_second_after_snapshot_is_delta,
        s08_orphan_tx_no_subs_row,
        s09_subs_only_no_tx,
        s10_multi_sync_cycle,
        s11_cross_account_isolation,
        s12_bulk_matches_per_fan,
        s13_chargeback_of_pre_snapshot_tx,
        s14_breakdown_populated_from_subscribedOnData,
        s15_delta_uses_net_not_amount,
    ]
    print(f"Running {len(scenarios)} scenarios against {SCRATCH_DB}")
    for s in scenarios:
        s()
    print()
    if _failures:
        print(f"FAILED: {len(_failures)}")
        for name, msg in _failures:
            print(f"  - {name}: {msg}")
        sys.exit(1)
    print(f"All {len(scenarios)} scenarios passed.")

if __name__ == "__main__":
    main()
