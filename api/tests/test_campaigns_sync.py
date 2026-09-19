#!/usr/bin/env python3
"""Scenario suite for campaign_claimers_cache + campaigns_earnings JOIN.

Controlled fixtures, not live OF. Verifies:
  - upsert new / existing / across-campaigns
  - campaigns_earnings SUM matches per-fan total_spent
  - fans claiming but not in subs_cache → coverage_pct reflects the gap
  - cross-account isolation
  - mapped_spent (from tx_cache) matches earnings_model's signed sum
"""

from __future__ import annotations

import os
import sys
import sqlite3
import tempfile
import traceback

TMPDIR = tempfile.mkdtemp(prefix="campaigns_tests_")
SCRATCH_DB = os.path.join(TMPDIR, "scratch.db")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crm_database  # noqa: E402
crm_database.DB_FILE = SCRATCH_DB
crm_database.init_database()

CRM = "crm_campaign_test"
ACCOUNT = "500"

def _panel_and_account():
    now = crm_database.iso_utc_now()
    conn = sqlite3.connect(SCRATCH_DB); cur = conn.cursor()
    cur.execute("INSERT OR IGNORE INTO crm_panels(crm_id, name, api_key, created_at) VALUES(?,?,?,?)",
                (CRM, "test", "k", now))
    cur.execute("SELECT id FROM crm_panels WHERE crm_id=?", (CRM,))
    panel_id = cur.fetchone()[0]
    for uid in (ACCOUNT, "999"):
        cur.execute("""INSERT OR IGNORE INTO of_accounts(crm_panel_id, of_user_id, email, created_at)
                       VALUES(?,?,?,?)""", (panel_id, uid, f"{uid}@e", now))
    conn.commit(); conn.close()

def _reset():
    conn = sqlite3.connect(SCRATCH_DB); cur = conn.cursor()
    for t in ("campaign_claimers_cache", "subscribers_cache", "transactions_cache"):
        cur.execute(f"DELETE FROM {t} WHERE crm_id=?", (CRM,))
    conn.commit(); conn.close()

def _claimer(fid, username=None):
    return {"id": fid, "username": username or f"u{fid}", "name": f"Fan {fid}"}

def _fan(fid, *, total=0, tips=0, msgs=0, posts=0, streams=0, subs=0,
          subscribeAt="2026-01-01T00:00:00+00:00"):
    return {
        "id": fid,
        "username": f"u{fid}",
        "name": f"Fan {fid}",
        "subscribedOnData": {
            "subscribeAt": subscribeAt,
            "expiredAt": "2036-01-01T00:00:00+00:00",
            "subscribePrice": 5,
            "totalSumm": total,
            "tipsSumm": tips,
            "messagesSumm": msgs,
            "postsSumm": posts,
            "streamsSumm": streams,
            "subscribesSumm": subs,
        },
    }

def _tx(tx_id, fan_id, amount, *, status="done", created_at="2026-04-10T00:00:00+00:00",
         description="Payment for message from <a>x</a>", net=None):
    """Same fixture as test_earnings_scenarios: defaults net=amount (fee=0) so
    each scenario reasons about one number. Earnings math sums NET — see the
    "Currency basis" note in earnings_model.py."""
    if net is None:
        net = amount
    fee = amount - net
    return {
        "id": tx_id, "amount": amount, "net": net, "fee": fee,
        "vatAmount": 0, "taxAmount": 0, "mediaTaxAmount": 0,
        "currency": "USD", "description": description,
        "status": status, "createdAt": created_at,
        "user": {"id": fan_id, "username": f"u{fan_id}", "isDeleted": False},
    }


_failures = []
def scenario(fn):
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
def s01_upsert_new_vs_existing():
    """upsert_campaign_claimer returns True on first insert, False on update."""
    assert crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(1)) is True
    assert crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(1)) is False
    # Same fan, different campaign → new row
    assert crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C2", _claimer(1)) is True


@scenario
def s02_earnings_sum_matches_subs_cache():
    """campaigns_earnings should sum subs_cache.total_spent for each campaign's claimers."""
    # Claimers
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(1))
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(2))
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(3))
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C2", _claimer(4))
    # Subs cache — fan1=$100, fan2=$50, fan3=$25 (total C1=$175); fan4=$200 (C2)
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(1, total=100, msgs=100))
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(2, total=50, tips=50))
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(3, total=25, posts=25))
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(4, total=200, msgs=200))

    earnings = {r['campaign_id']: r for r in crm_database.campaigns_earnings(CRM, ACCOUNT)}
    assert earnings['C1']['total_spent'] == 175.0, earnings['C1']
    assert earnings['C1']['claimers_count'] == 3
    assert earnings['C1']['mapped_claimers_count'] == 3
    assert earnings['C1']['coverage_pct'] == 100.0

    assert earnings['C2']['total_spent'] == 200.0
    assert earnings['C2']['claimers_count'] == 1


@scenario
def s03_coverage_reflects_missing_subs():
    """Fan claims a campaign but isn't in subs_cache yet → coverage < 100%."""
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(1))
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(2))  # not in subs
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(1, total=100, msgs=100))

    r = {x['campaign_id']: x for x in crm_database.campaigns_earnings(CRM, ACCOUNT)}['C1']
    assert r['claimers_count'] == 2
    assert r['mapped_claimers_count'] == 1
    assert r['coverage_pct'] == 50.0
    assert r['total_spent'] == 100.0  # only the mapped fan contributes


@scenario
def s04_cross_account_isolation():
    """Claimers under a different of_user_id must not leak into this one's earnings."""
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(1))
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(1, total=100, msgs=100))
    # different account, same fan, different campaign
    crm_database.upsert_campaign_claimer(CRM, "999", "C2", _claimer(1))
    crm_database.upsert_subscriber(CRM, "999", _fan(1, total=999, msgs=999))

    a = {x['campaign_id']: x for x in crm_database.campaigns_earnings(CRM, ACCOUNT)}
    b = {x['campaign_id']: x for x in crm_database.campaigns_earnings(CRM, "999")}
    assert a['C1']['total_spent'] == 100.0 and 'C2' not in a
    assert b['C2']['total_spent'] == 999.0 and 'C1' not in b


@scenario
def s05_list_claimers_joins_spending_and_mapped():
    """list_campaign_claimers rows carry both canonical total_spent (subs_cache)
    and mapped_spent (tx_cache signed sum, chargebacks subtracted)."""
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(1))
    crm_database.upsert_subscriber(CRM, ACCOUNT, _fan(1, total=100, msgs=100))
    # Tx: $60 done + $20 chargeback = $40 net mapped
    crm_database.upsert_transaction(CRM, ACCOUNT, _tx("t1", 1, 60, status="done"))
    crm_database.upsert_transaction(CRM, ACCOUNT, _tx("t2", 1, 20, status="undo"))

    rows, total = crm_database.list_campaign_claimers(CRM, ACCOUNT, "C1")
    assert total == 1
    r = rows[0]
    assert r['total_spent'] == 100.0
    assert r['mapped_spent'] == 40.0, r  # 60 − 20 chargeback


@scenario
def s06_claimer_not_in_subs_still_listed():
    """Orphan claimer (in cache but subs_cache join is null) must still appear
    in list_campaign_claimers with total_spent=None (not crash, not dropped)."""
    crm_database.upsert_campaign_claimer(CRM, ACCOUNT, "C1", _claimer(77))
    rows, total = crm_database.list_campaign_claimers(CRM, ACCOUNT, "C1")
    assert total == 1
    assert rows[0]['fan_of_user_id'] == '77'
    assert rows[0]['total_spent'] is None
    # tx_cache also empty → mapped_spent = 0
    assert rows[0]['mapped_spent'] == 0.0


@scenario
def s07_mark_refresh_updates_status_column():
    crm_database.mark_campaigns_refresh(CRM, ACCOUNT, success=True)
    summary = crm_database.campaigns_cache_summary(CRM, ACCOUNT)
    assert summary['last_refreshed_at'] is not None
    assert summary['consecutive_failures'] == 0
    crm_database.mark_campaigns_refresh(CRM, ACCOUNT, success=False)
    summary = crm_database.campaigns_cache_summary(CRM, ACCOUNT)
    assert summary['consecutive_failures'] == 1


def main():
    _panel_and_account()
    scenarios = [
        s01_upsert_new_vs_existing,
        s02_earnings_sum_matches_subs_cache,
        s03_coverage_reflects_missing_subs,
        s04_cross_account_isolation,
        s05_list_claimers_joins_spending_and_mapped,
        s06_claimer_not_in_subs_still_listed,
        s07_mark_refresh_updates_status_column,
    ]
    print(f"Running {len(scenarios)} campaigns-sync scenarios")
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
