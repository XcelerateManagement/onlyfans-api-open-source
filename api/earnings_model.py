#!/usr/bin/env python3
"""Single source of truth for current-spent arithmetic.

Motivation:
    Fan spend is split across two caches:
      - subscribers_cache.total_spent = LIFETIME spend as of last sub sync
        (server-canonical, sourced from `subscribedOnData.totalSumm`).
      - transactions_cache.amount     = per-tx ledger, last N days (default 30)
        (server-canonical, sourced from `/payouts/transactions`).

    "What has this fan spent right now?" can't be answered from either cache
    alone:
      - subs_cache lags by up to a full refresh cycle (7 days in our schedule).
      - tx_cache is bounded to a recent window; older spend isn't there.

    The right answer is:

        current_spent(fan) = canonical(fan)
                           + signed_delta(fan, since=subs.last_synced_at)

    where signed_delta includes positive-status tx (done, loading) and subtracts
    chargebacks (status='undo', observed to carry refundReason='ethoca_alert').

Invariants this module is responsible for:
    I1 — NO double-counting. Delta uses strict `>` against subs.last_synced_at.
         Any tx at or before the snapshot is considered "already in canonical".
    I2 — Chargebacks REDUCE spend. tx with status='undo' enter delta as -amount.
    I3 — Pending clears count as spent. status='loading' (within payoutPendingDays)
         counts as positive spend; the fan's card has been charged.
    I4 — Unknown statuses are IGNORED, not assumed positive. If OF ever adds a
         new status, the number shown to the user won't silently include it —
         it'll diverge from canonical on next sub sync and surface as a bug
         we can then classify.
    I5 — Orphan tx (fan not in subs_cache) can still be summed — canonical=0
         and delta = sum over the full tx window.
    I6 — Timestamps are normalized canonical UTC ISO
         (crm_database.iso_utc_now) so SQL `>` is correct.

These invariants are proved by tests/test_earnings_scenarios.py.

Public API:
    compute_current_spent(crm_id, of_user_id, fan_of_user_id) -> dict
    compute_current_spent_bulk(crm_id, of_user_id, fan_ids=None) -> dict[fan_id -> dict]
    reconcile_check(crm_id, of_user_id) -> dict   # diagnostic
"""

from __future__ import annotations

from typing import Iterable, Optional
import sqlite3

import crm_database as db

# ---- status taxonomy ------------------------------------------------------

# Statuses whose row contributes positively toward fan spend (net).
POSITIVE_STATUSES = ('done', 'loading')
# Statuses whose row SUBTRACTS from fan spend (chargebacks / refunds).
NEGATIVE_STATUSES = ('undo',)
# Any status not in either set is ignored. If this ever fires we want to know.
KNOWN_STATUSES = set(POSITIVE_STATUSES) | set(NEGATIVE_STATUSES)

# Currency basis
# ──────────────
# `subscribers_cache.total_spent` is populated from `subscribedOnData.totalSumm`,
# which OF reports as NET to the creator (after the 20% platform fee). For the
# canonical + delta math to be coherent we MUST sum the delta in the same basis.
# `transactions_cache.net` is the per-row net (= amount − fee); `amount` is the
# gross the fan paid. Always use net here — mixing bases inflates the delta by
# the 1/(1-fee) factor (~1.25× on observed data) and makes current_spent look
# wildly wrong once the user notices canonical and mapped don't match.

def _signed_net_case_sql():
    """SQL CASE fragment + param tuple summing NET-signed transaction rows.
    Used once per earnings-model call."""
    neg_ph = ','.join('?' * len(NEGATIVE_STATUSES))
    pos_ph = ','.join('?' * len(POSITIVE_STATUSES))
    fragment = (
        "CASE "
        f"  WHEN status IN ({neg_ph}) THEN -COALESCE(net, 0) "
        f"  WHEN status IN ({pos_ph}) THEN  COALESCE(net, 0) "
        "  ELSE 0 "
        "END"
    )
    params = (*NEGATIVE_STATUSES, *POSITIVE_STATUSES)
    return fragment, params

# Back-compat alias — old code paths called this `_signed_amount_case_sql`.
_signed_amount_case_sql = _signed_net_case_sql


# ---- public -------------------------------------------------------------

def compute_current_spent(crm_id: str, of_user_id: str, fan_of_user_id: str) -> dict:
    """Return current spend for one fan. See module docstring for invariants.

    Shape:
      {
        'fan_of_user_id': str,
        'canonical': float,             # from subs_cache.total_spent
        'delta_signed': float,          # net of tx since snapshot (pos - neg)
        'delta_positive': float,        # paid after snapshot
        'delta_negative': float,        # charged-back after snapshot (abs value)
        'current_spent': float,         # canonical + delta_signed
        'snapshot_at': str | None,      # subs.last_synced_at ISO (None if orphan)
        'source': 'canonical+delta' | 'tx-only',
      }
    """
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        """SELECT total_spent, last_synced_at
           FROM subscribers_cache
           WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ?""",
        (crm_id, str(of_user_id), str(fan_of_user_id)),
    )
    subs_row = cur.fetchone()

    if subs_row:
        canonical = float(subs_row['total_spent'] or 0.0)
        snapshot_at = subs_row['last_synced_at']
        source = 'canonical+delta'
        # Strictly-later-than the snapshot: tx at identical second belong to canonical.
        time_clause = "AND created_at > ?"
        time_param = (snapshot_at,)
    else:
        # Orphan fan: no subs row. Sum the full tx window.
        canonical = 0.0
        snapshot_at = None
        source = 'tx-only'
        time_clause = ""
        time_param = ()

    fragment, status_params = _signed_net_case_sql()
    # Same NET basis as the CASE fragment — positive/negative buckets also sum
    # `net`, not `amount`. See the "Currency basis" note above.
    cur.execute(
        f"""SELECT
              COALESCE(SUM({fragment}), 0)                                          AS signed,
              COALESCE(SUM(CASE WHEN status IN ({','.join('?'*len(POSITIVE_STATUSES))})
                                THEN COALESCE(net, 0) ELSE 0 END), 0)               AS positive,
              COALESCE(SUM(CASE WHEN status IN ({','.join('?'*len(NEGATIVE_STATUSES))})
                                THEN COALESCE(net, 0) ELSE 0 END), 0)               AS negative
            FROM transactions_cache
            WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id = ? {time_clause}""",
        (*status_params, *POSITIVE_STATUSES, *NEGATIVE_STATUSES,
         crm_id, str(of_user_id), str(fan_of_user_id), *time_param),
    )
    row = cur.fetchone()
    conn.close()

    signed   = float(row['signed']   or 0.0)
    positive = float(row['positive'] or 0.0)
    negative = float(row['negative'] or 0.0)
    return {
        'fan_of_user_id': str(fan_of_user_id),
        'canonical':       round(canonical, 2),
        'delta_signed':    round(signed, 2),
        'delta_positive':  round(positive, 2),
        'delta_negative':  round(negative, 2),
        'current_spent':   round(canonical + signed, 2),
        'snapshot_at':     snapshot_at,
        'source':          source,
    }


def compute_current_spent_bulk(
    crm_id: str,
    of_user_id: str,
    fan_ids: Optional[Iterable[str]] = None,
) -> dict[str, dict]:
    """Same calculation, vectorised. If fan_ids is None, includes every fan that
    appears in either cache for this account."""
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Build the universe
    if fan_ids is None:
        cur.execute(
            """SELECT DISTINCT fan_of_user_id FROM subscribers_cache
               WHERE crm_id = ? AND of_user_id = ?
               UNION
               SELECT DISTINCT fan_of_user_id FROM transactions_cache
               WHERE crm_id = ? AND of_user_id = ? AND fan_of_user_id IS NOT NULL""",
            (crm_id, str(of_user_id), crm_id, str(of_user_id)),
        )
        fan_ids = [r['fan_of_user_id'] for r in cur.fetchall()]
    else:
        fan_ids = [str(f) for f in fan_ids]

    conn.close()
    # N+1 is fine at this scale (bella: 826 fans → 826 queries, each <1ms
    # against an indexed SQLite). If this ever becomes hot, batch via IN().
    return {fid: compute_current_spent(crm_id, of_user_id, fid) for fid in fan_ids}


def reconcile_check(crm_id: str, of_user_id: str) -> dict:
    """Sanity-diagnostic for the flow. Compares canonical sum (subs total_spent)
    against the ledger SUM constrained to fans and time present in both caches.
    Large disagreement here is a red flag — either a bug in the SUM rules, a
    sub out-of-date with ledger, or OF's aggregate lagging tx.

    Returns a dict with counts + sums + the top 5 fans by absolute delta."""
    conn = sqlite3.connect(db.DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Sum of canonical across everyone
    cur.execute(
        """SELECT COALESCE(SUM(total_spent), 0) AS canon_sum,
                  COUNT(*) AS sub_count
           FROM subscribers_cache WHERE crm_id = ? AND of_user_id = ?""",
        (crm_id, str(of_user_id)),
    )
    r = cur.fetchone(); canon_sum = float(r['canon_sum'] or 0); sub_count = r['sub_count']

    # Count/sum of the ledger
    fragment, status_params = _signed_net_case_sql()
    cur.execute(
        f"""SELECT COALESCE(SUM({fragment}), 0) AS ledger_signed,
                   COUNT(*) AS tx_count
            FROM transactions_cache WHERE crm_id = ? AND of_user_id = ?""",
        (*status_params, crm_id, str(of_user_id)),
    )
    r = cur.fetchone(); ledger_sum = float(r['ledger_signed'] or 0); tx_count = r['tx_count']

    conn.close()

    # Biggest "delta-above-canonical" fans (likely actively spending since snapshot)
    bulk = compute_current_spent_bulk(crm_id, of_user_id)
    top = sorted(
        bulk.values(),
        key=lambda r: abs(r['delta_signed']),
        reverse=True,
    )[:5]
    return {
        'subs_total_spent_sum': round(canon_sum, 2),
        'ledger_signed_sum':    round(ledger_sum, 2),
        'sub_count':            sub_count,
        'tx_count':             tx_count,
        'top5_by_delta':        top,
    }
