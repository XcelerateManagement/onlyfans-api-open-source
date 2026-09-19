#!/usr/bin/env python3
"""Fansly earnings-wallet figures and exact ledger typing.

Kept out of ``fansly_normalize`` / ``fansly_data`` on purpose: production runs
newer builds of those two modules (vault, lists, media) than this repository
holds, so shipping them would roll those features back. Everything the
dashboard's wallet row and the ledger classification need lives here and is
called from modules that can be released on their own.

Wallet semantics — CONFIRMED LIVE (graciesmalls, 2026-09-17):
  GET /api/v1/account/me             earningsWallet.balance  = WITHDRAWABLE
  GET /api/v1/account/wallets/earnings pendingBalance        = on hold, NOT
                                                               inside balance
balance=73696 ($73.70) and pendingBalance=447920 ($447.92) at the same moment,
and the latest payout (16012, $1,310.00) left the wallet at newBalance=96 — a
payout can only take what is withdrawable. Row-level newBalance is "available
at credit time + this credit", not a running total.
"""
from __future__ import annotations

import logging

import fansly_normalize as fnorm   # pure mapping helpers, no I/O

# fansly_client is imported inside the functions that call Fansly: crm_database
# imports this module while it is still initialising (the ledger
# reclassification), and the client imports crm_database back.

logger = logging.getLogger(__name__)

PENDING_BALANCE_PATH = '/api/v1/account/wallets/earnings'

# See the module docstring.
WALLET_BALANCE_INCLUDES_PENDING = False

# Wallet-transaction `type` codes → transactions_cache.tx_type. The first five
# match fansly_normalize.FANSLY_TX_TYPE (identified on the live tgirl_elli
# ledger); 32101 is INFERRED from the live graciesmalls ledger: one fan, five
# $3-$5 credits inside 35 minutes, 20% fee, into the earnings wallet — the
# shape of live-stream tips.
TX_TYPE_BY_CODE = {
    2110: 'post',
    2116: 'message',
    7101: 'tip',
    15001: 'subscription',
    16012: 'payout',
    32101: 'stream',
}

# Wallet row `destination`: 2 is the creator's EARNINGS wallet (every fan
# credit observed live). A non-payout row that lands anywhere else is money
# moving between the creator's own wallets — seen live as a 6002/58000 $5 pair
# (senderId=self, no fee, same correlationId) — never income.
EARNINGS_WALLET_DESTINATION = 2

_UNKNOWN_CODES_LOGGED: set = set()


# ── ledger typing ──────────────────────────────────────────────────────────

def fansly_tx_type(code, destination=None):
    """Exact tx_type for a wallet row, or None for an unknown code (the caller
    then keeps keyword classification, which lands on 'other': counted in
    totals, no category). crm_database.reclassify_fansly_tx_types mirrors this
    rule in SQL — keep the two in step."""
    try:
        code = int(code) if code is not None else None
    except (ValueError, TypeError):
        pass
    label = TX_TYPE_BY_CODE.get(code)
    if label == 'payout':
        return label
    if destination is not None and str(destination) != str(EARNINGS_WALLET_DESTINATION):
        return 'transfer'
    return label


def annotate_tx(norm: dict, raw: dict) -> dict:
    """Add the exact ``tx_type`` (and ``platform``) to a row produced by
    ``fansly_normalize._normalize_tx``, before it is upserted.

    The normalizer's synthetic description embeds the fan's display name, and
    crm_database._classify_tx used to keyword-match it — a fan called "Tipsy"
    turned a subscription into a tip, "Payout King" dropped it from earnings.
    _classify_tx honours an explicit tx_type, so this makes the stored category
    follow the wallet type code instead."""
    if not isinstance(norm, dict) or not isinstance(raw, dict):
        return norm
    code = raw.get('type')
    destination = raw.get('destination')
    tx_type = fansly_tx_type(code, destination)
    norm['platform'] = 'fansly'
    if tx_type:
        norm['tx_type'] = tx_type
    generic = str(norm.get('description') or '').startswith('Fansly transaction (type')
    if tx_type == 'transfer' and generic:
        norm['description'] = f'Fansly wallet transfer (type {code})'
    elif tx_type == 'stream' and generic:
        who = ((norm.get('user') or {}).get('name')
               or (norm.get('user') or {}).get('username') or 'a fan')
        norm['description'] = f'Payment for stream from {who}'
    if tx_type is None and code not in _UNKNOWN_CODES_LOGGED:
        _UNKNOWN_CODES_LOGGED.add(code)
        logger.warning('fansly: unmapped wallet transaction type %r (destination=%r) '
                       '— counted in totals, no category', code, destination)
    return norm


# ── wallet figures ─────────────────────────────────────────────────────────

def wallet_figures(balance, pending):
    """(current, available, pending) in dollars.

    current   = everything in the earnings wallet, on hold or not
    available = withdrawable right now
    pending   = on hold (None when unknown — then current == available, which
                understates current rather than inventing a number)
    """
    if balance is None:
        return None, None, pending
    bal = float(balance)
    if pending is None:
        return round(bal, 2), round(bal, 2), None
    pend = max(0.0, float(pending))
    if WALLET_BALANCE_INCLUDES_PENDING:
        return round(bal, 2), round(max(0.0, bal - pend), 2), round(pend, 2)
    return round(bal + pend, 2), round(bal, 2), round(pend, 2)


def earnings_wallet_balance(envelope):
    """Raw earningsWallet.balance (dollars) from an /account/me envelope — or
    from a normalized balances body's ``raw`` block — or None."""
    r = fnorm._response(envelope) or {}
    if not isinstance(r, dict):
        return None
    acc = r.get('account') if isinstance(r.get('account'), dict) else r
    ew = acc.get('earningsWallet') if isinstance(acc.get('earningsWallet'), dict) else {}
    return fnorm._cents(fnorm._first(ew, 'balance', 'balance64'))


def pending_balance(envelope):
    """pendingBalance (dollars) from a /wallets/earnings envelope, or None."""
    if envelope is None:
        return None
    r = fnorm._response(envelope)
    return fnorm._cents(r.get('pendingBalance')) if isinstance(r, dict) else None


def fetch_pending_envelope(crm_id, account_id, proxy=None):
    """Best-effort GET of the on-hold amount. The raw envelope, or None on any
    failure — a missing pending figure must never fail a balance read."""
    try:
        import fansly_client
        ok, data, _status, _relogin = fansly_client.handle_fansly_request(
            crm_id, account_id, PENDING_BALANCE_PATH, method='GET', proxy=proxy)
    except Exception:
        return None
    if not ok or not isinstance(data, dict):
        return None
    resp = data.get('response')
    if not isinstance(resp, dict) or resp.get('pendingBalance') is None:
        return None
    return data


def apply_pending(body: dict, pending_envelope) -> dict:
    """Rewrite a normalized Fansly ``balances`` body (fansly_data.fetch) with
    all three figures. The base normalizer only knows /account/me, so it puts
    the withdrawable balance under both currentBalance and payoutAvailable."""
    bal = (body or {}).get('balances') if isinstance(body, dict) else None
    if not isinstance(bal, dict):
        return body
    raw = bal.get('raw') if isinstance(bal.get('raw'), dict) else {}
    balance = earnings_wallet_balance({'account': {'earningsWallet': raw.get('earningsWallet') or {}}})
    pending_raw = None
    if pending_envelope is not None:
        r = fnorm._response(pending_envelope)
        pending_raw = r.get('pendingBalance') if isinstance(r, dict) else None
    current, available, pending = wallet_figures(balance, fnorm._cents(pending_raw))
    if current is None:
        return body
    bal['currentBalance'] = current
    bal['payoutAvailable'] = available
    bal['pendingBalance'] = pending
    bal['payoutPending'] = pending
    raw['pendingBalance'] = pending_raw
    bal['raw'] = raw
    return body


def record_wallet_sample(crm_id, account_id, balance, pending, pending_known=True):
    """Persist one wallet sample (dollars) with current/available/pending.

    ``balance`` is earningsWallet.balance. When the caller did not fetch
    pending (``pending_known=False`` — the poller only reads /account/me) the
    stored pending figure is reused instead of wiped, so a poll cycle doesn't
    erase what the scheduled snapshot learned. Returns True when the stored
    current balance changed. Never raises."""
    import crm_database as db
    try:
        if balance is None:
            return False
        prev = db.get_of_account(crm_id, account_id) or {}
        if not pending_known:
            pending = prev.get('last_balance_pending')
        current, available, pending = wallet_figures(balance, pending)
        db.record_account_balance(crm_id, account_id, available, pending, 'USD',
                                  current=current)
        before = prev.get('last_balance_current')
        if before is None:
            before = prev.get('last_balance_available')
        try:
            return before is None or abs(float(before) - float(current)) > 0.004
        except (TypeError, ValueError):
            return True
    except Exception:
        logger.exception('fansly wallet sample failed %s/%s', crm_id, account_id)
        return False


def record_balances_body(crm_id, account_id, body):
    """Stamp the sample carried by a balances body that went through
    ``apply_pending`` (reads the raw integers, not the derived figures)."""
    bal = (body or {}).get('balances') or {}
    raw = bal.get('raw') or {}
    balance = earnings_wallet_balance({'account': {'earningsWallet': raw.get('earningsWallet') or {}}})
    pending_raw = raw.get('pendingBalance')
    return record_wallet_sample(crm_id, account_id, balance, fnorm._cents(pending_raw),
                                pending_known=pending_raw is not None)


def snapshot_wallet(crm_id, account_id, proxy=None):
    """Live snapshot: /account/me + /account/wallets/earnings, stamped via
    record_wallet_sample. Returns (ok, changed)."""
    import fansly_client
    ok, data, _status, _relogin = fansly_client.handle_fansly_request(
        crm_id, account_id, '/api/v1/account/me', method='GET', proxy=proxy)
    if not ok:
        return False, False
    balance = earnings_wallet_balance(data)
    if balance is None:
        return False, False
    pending_env = fetch_pending_envelope(crm_id, account_id, proxy=proxy)
    changed = record_wallet_sample(crm_id, account_id, balance,
                                   pending_balance(pending_env),
                                   pending_known=pending_env is not None)
    return True, changed
