#!/usr/bin/env python3
"""Fansly wallet-ledger sync into ``transactions_cache`` — the Fansly analogue
of ``transactions_sync`` (which is OF-only: it walks /api2/v2 via of_client).

Why: nothing used to write Fansly money into the local ledger, so every
cache-reading surface (GET /transactions/cached, fan mapped_spend, the
/earnings/summary local fallback, exports) showed $0 while the live wallet had
hundreds of rows. This module pages GET /api/v1/account/wallets/transactions
(proven live: 354 rows on the reference account) through
``fansly_client.handle_fansly_request``, normalizes each row with the enriched
``fansly_normalize._normalize_tx`` mapper (dollars everywhere, string type,
synthetic description, fan enrichment via correlationAccountId), and upserts
into the EXISTING OF transactions_cache schema — no new columns.

Cursor: wallet transactionIds are monotonic snowflakes. After a successful walk
the newest id is persisted as ``polling_cursor.last_fansly_tx_id`` (via
``update_polling_cursor_fields`` so poll metadata is untouched), and delta runs
stop as soon as a page row's id <= cursor. ``fansly_poller`` delta-walks each
poll cycle with a small page cap.

Paging uses the endpoint's ``before=<transactionId>`` cursor (confirmed live)
rather than offset, so a delta walk can't skew when new rows land mid-walk.

Entry points (module-level so scheduler.run_in_background can pickle them):
    sync_fansly_transactions(...)            — the walker; returns the same
        result shape as transactions_sync (mode/pages/rows/stopped_reason).
    run_fansly_tx_refresh_with_progress(...) — refresh_state 'tx' wrapper; the
        POST /transactions/refresh route dispatches this for fansly accounts.
    run_fansly_backfill_with_progress(...)   — full wallet walk + harvest_fans;
        dispatched by POST /backfill and the polling OFF→ON transition.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

import crm_database as db
import fansly_client
import fansly_normalize as fnorm
import fansly_wallet
import refresh_state

logger = logging.getLogger(__name__)

PAGE_SIZE = 100

# A full wallet history walk is cheap compared to OF (one creator-side ledger,
# no per-fan fan-out), but cap it so a whale account can't run away.
INITIAL_MAX_PAGES = 60
DELTA_MAX_PAGES = 20
# The per-poll delta walk must stay tiny — it runs every poll interval.
POLL_DELTA_MAX_PAGES = 5


def _id_le(a, b) -> bool:
    """a <= b for Fansly snowflake ids (numeric when possible, else string)."""
    try:
        return int(a) <= int(b)
    except (ValueError, TypeError):
        return str(a) <= str(b)


def _id_max(cur, candidate):
    if cur is None:
        return candidate
    try:
        return candidate if int(candidate) > int(cur) else cur
    except (ValueError, TypeError):
        return candidate if str(candidate) > str(cur) else cur


def sync_fansly_transactions(crm_id: str, account_id: str, proxy=None, *,
                             mode: str = 'delta',
                             max_pages: Optional[int] = None,
                             on_progress: Optional[Callable[..., None]] = None,
                             skip_if_uninitialized: bool = False):
    """Walk the Fansly wallet ledger into transactions_cache.

    ``mode='delta'`` stops at the first row whose snowflake id <= the stored
    ``last_fansly_tx_id`` cursor; with no cursor it behaves like 'initial'.
    ``mode='initial'`` ignores the cursor and walks the full history (bounded
    by ``max_pages``).
    ``skip_if_uninitialized`` — poller-safe flag: skip the full first walk
    inside a poll cycle (the backfill / manual refresh owns that).
    """
    account_id = str(account_id)
    if not proxy:
        account = db.get_of_account(crm_id, account_id)
        if account:
            proxy = account.get('proxy')

    cursor = db.load_polling_cursor(crm_id, account_id) or {}
    last_id = cursor.get('last_fansly_tx_id') if mode == 'delta' else None

    if skip_if_uninitialized and last_id is None:
        summary = db.transactions_cache_summary(crm_id, account_id)
        if (summary.get('total') or 0) == 0:
            return {'success': True, 'mode': mode, 'pages_fetched': 0,
                    'rows_inserted': 0, 'rows_updated': 0,
                    'stopped_reason': 'no_more',
                    'oldest_created_at': None, 'newest_created_at': None,
                    'pages_est': None, 'error': None, 'skipped_empty': True}

    if max_pages is None:
        max_pages = DELTA_MAX_PAGES if (mode == 'delta' and last_id is not None) \
            else INITIAL_MAX_PAGES

    try:
        fan_idx = db.fans_username_index(crm_id, account_id)
    except Exception:
        fan_idx = None

    if on_progress:
        on_progress(phase='fetching', pages_done=0, pages_est=None,
                    rows_inserted=0, rows_updated=0)

    before = None
    pages = 0
    inserted = 0
    updated = 0
    newest_id = None
    newest_created = None
    oldest_created = None
    stopped_reason = 'no_more'

    while pages < max_pages:
        path = f'/api/v1/account/wallets/transactions?limit={PAGE_SIZE}'
        if before:
            path += f'&before={before}'
        ok, data, status, _relogin = fansly_client.handle_fansly_request(
            crm_id, account_id, path, method='GET', proxy=proxy)
        pages += 1
        if not ok:
            db.mark_transactions_refresh(crm_id, account_id, success=False)
            if on_progress:
                on_progress(phase='error', pages_done=pages,
                            rows_inserted=inserted, rows_updated=updated)
            err = data.get('error') if isinstance(data, dict) else str(data)[:200]
            return {'success': False, 'mode': mode,
                    'pages_fetched': pages, 'rows_inserted': inserted,
                    'rows_updated': updated, 'stopped_reason': 'error',
                    'oldest_created_at': oldest_created,
                    'newest_created_at': newest_created,
                    'pages_est': None,
                    'error': err or f'HTTP {status}'}

        resp = data.get('response') if isinstance(data, dict) else None
        rows = (resp or {}).get('data') or []
        if not rows:
            break

        hit_cursor = False
        page_last_id = None
        for tx in rows:
            if not isinstance(tx, dict):
                continue
            tid = tx.get('transactionId') or tx.get('id')
            if tid is None:
                continue
            tid = str(tid)
            page_last_id = tid
            newest_id = _id_max(newest_id, tid)
            if last_id is not None and _id_le(tid, last_id):
                hit_cursor = True
                break
            norm = fnorm._normalize_tx(tx, self_account_id=account_id,
                                       fan_idx=fan_idx)
            if not norm.get('id'):
                continue
            # Store the category the wallet type code says, not the one a
            # keyword match on the fan's display name would guess.
            fansly_wallet.annotate_tx(norm, tx)
            created = norm.get('createdAt')
            if created:
                if newest_created is None or created > newest_created:
                    newest_created = created
                if oldest_created is None or created < oldest_created:
                    oldest_created = created
            if db.upsert_transaction(crm_id, account_id, norm):
                inserted += 1
            else:
                updated += 1

        if on_progress:
            on_progress(phase='fetching', pages_done=pages, pages_est=None,
                        rows_inserted=inserted, rows_updated=updated)

        if hit_cursor:
            stopped_reason = 'caught_up'
            break
        if len(rows) < PAGE_SIZE or page_last_id is None:
            break
        before = page_last_id
    else:
        stopped_reason = 'page_cap'

    if newest_id is not None:
        try:
            db.update_polling_cursor_fields(crm_id, account_id,
                                            last_fansly_tx_id=str(newest_id))
        except Exception:
            logger.exception('fansly_sync: could not persist tx cursor %s/%s',
                             crm_id, account_id)
    db.mark_transactions_refresh(crm_id, account_id, success=True,
                                 latest_marker=newest_id)
    # Keep per-fan spend aggregates (subscribers_cache.total_spent/spent_*) in
    # lockstep with the ledger. Without this, spend only refreshes on the weekly
    # subs sync and lags the 2-min-fresh transactions_cache by up to 7 days.
    # Cheap local SQL; only run it when the walk actually changed rows.
    if inserted or updated:
        try:
            db.apply_fansly_spend_from_tx_cache(crm_id, account_id)
        except Exception:
            logger.exception('fansly_sync: spend backfill failed %s/%s',
                             crm_id, account_id)
    result = {'success': True, 'mode': mode,
              'pages_fetched': pages, 'rows_inserted': inserted,
              'rows_updated': updated, 'stopped_reason': stopped_reason,
              'oldest_created_at': oldest_created,
              'newest_created_at': newest_created,
              'pages_est': None, 'error': None}
    logger.info('fansly tx_sync (%s) done: %s/%s %s', mode, crm_id, account_id, result)
    return result


def poll_delta_sync(crm_id: str, account_id: str, proxy=None):
    """Tiny bounded delta walk for the per-poll cycle. Never raises."""
    try:
        return sync_fansly_transactions(crm_id, account_id, proxy=proxy,
                                        mode='delta',
                                        max_pages=POLL_DELTA_MAX_PAGES,
                                        skip_if_uninitialized=True)
    except Exception:
        logger.exception('fansly poll tx delta failed %s/%s', crm_id, account_id)
        return None


# ---- progress-aware entry points (refresh_state + SSE) --------------------

def run_fansly_tx_refresh_with_progress(crm_id: str, account_id: str,
                                        mode: str = 'delta',
                                        proxy=None):
    """Same contract as scheduler.run_tx_refresh_with_progress, but walks the
    Fansly wallet. Emits the same refresh.progress/refresh.complete SSE events
    (kind='tx') so the dashboard progress bars work unchanged. Returns the
    walker result (None if it raised)."""
    result = None
    try:
        refresh_state.start(crm_id, account_id, 'tx')
        on_progress = refresh_state.make_on_progress(crm_id, account_id, 'tx')
        result = sync_fansly_transactions(
            crm_id, account_id, proxy=proxy,
            mode=('initial' if mode == 'initial' else 'delta'),
            on_progress=on_progress)
        refresh_state.finish(
            crm_id, account_id, 'tx',
            success=bool(result.get('success')),
            pages_done=result.get('pages_fetched'),
            rows_inserted=result.get('rows_inserted'),
            rows_updated=result.get('rows_updated'),
            stopped_reason=result.get('stopped_reason'),
            error=result.get('error'),
        )
    except Exception as e:
        logger.exception('run_fansly_tx_refresh_with_progress failed %s/%s',
                         crm_id, account_id)
        refresh_state.finish(crm_id, account_id, 'tx', success=False,
                             stopped_reason='error', error=str(e))
    return result


# A Fansly account whose last call failed on transport (dead proxy, upstream
# hiccup) is retried on an exponential schedule instead of every cadence tick:
# 10 min, 20, 40 … capped at 6h. A reconnect / proxy fix clears the connection
# state (update_account_polling / clear_connection_error) and the next tick
# runs normally. Session-dead accounts never get here — they are
# relogin-blocked and have no job at all.
SCHEDULED_BACKOFF_BASE_SECONDS = 10 * 60
SCHEDULED_BACKOFF_CAP_SECONDS = 6 * 3600
_BACKOFF_STATES = ('proxy_error', 'temporary_error', 'rate_limited')


def _in_failure_backoff(account: dict) -> bool:
    from datetime import datetime, timezone
    if (account or {}).get('last_connection_state') not in _BACKOFF_STATES:
        return False
    failures = int(account.get('transactions_refresh_failure_count') or 0)
    if failures <= 0:
        return False
    raw = str(account.get('last_connection_error_at') or '')
    try:
        failed_at = datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        return False
    if failed_at.tzinfo is None:
        failed_at = failed_at.replace(tzinfo=timezone.utc)
    delay = min(SCHEDULED_BACKOFF_CAP_SECONDS,
                SCHEDULED_BACKOFF_BASE_SECONDS * (2 ** min(failures, 6)))
    return (datetime.now(timezone.utc) - failed_at).total_seconds() < delay


def run_fansly_scheduled_refresh(crm_id: str, account_id: str) -> dict:
    """The scheduled Fansly refresh (scheduler's tx_refresh job dispatches here
    for Fansly accounts), independent of polling and FANSLY_POLLING_ENABLED:

      1. wallet ledger delta → transactions_cache. With no stored cursor this
         is the full initial walk, which is what fills an account that was
         connected while polling was off and so never got its backfill.
      2. wallet snapshot → current / available / pending on of_accounts.
      3. earnings summary cache dropped if either changed, so the dashboard
         shows the new numbers on its next read instead of after the TTL.

    Emits no events: `balance_increased` stays owned by the poller, so an
    account that is also being polled never double-fans-out. Never raises.
    """
    account_id = str(account_id)
    out = {'ran': False, 'rows_inserted': 0, 'wallet_ok': False,
           'wallet_changed': False, 'skipped': None}
    try:
        account = db.get_of_account(crm_id, account_id)
        if not account:
            out['skipped'] = 'missing'
            return out
        if (account.get('platform') or 'onlyfans') != 'fansly':
            out['skipped'] = 'not_fansly'
            return out
        if account.get('relogin_blocked_at'):
            out['skipped'] = 'relogin_blocked'
            return out
        if _in_failure_backoff(account):
            out['skipped'] = 'backoff'
            logger.info('fansly scheduled refresh backing off %s/%s (%s)',
                        crm_id, account_id, account.get('last_connection_state'))
            return out
        proxy = account.get('proxy')
        out['ran'] = True
        result = run_fansly_tx_refresh_with_progress(
            crm_id, account_id, mode='delta', proxy=proxy) or {}
        out['rows_inserted'] = int(result.get('rows_inserted') or 0)
        try:
            out['wallet_ok'], out['wallet_changed'] = fansly_wallet.snapshot_wallet(
                crm_id, account_id, proxy=proxy)
        except Exception:
            logger.exception('fansly wallet snapshot failed %s/%s', crm_id, account_id)
        if out['rows_inserted'] or out['wallet_changed']:
            try:
                import earnings_cache
                earnings_cache.invalidate(crm_id)
            except Exception:
                pass
    except Exception:
        logger.exception('run_fansly_scheduled_refresh failed %s/%s', crm_id, account_id)
    return out


def run_fansly_subs_refresh_with_progress(crm_id: str, account_id: str,
                                          proxy=None) -> None:
    """refresh_state 'subs' wrapper around the fansly subscriber full walk
    (subscribers_sync dispatches fansly accounts to /api/v1/subscribers).
    Same SSE progress contract as scheduler.run_subs_refresh_with_progress —
    kept here so the backfill can run it without importing scheduler."""
    import subscribers_sync
    try:
        refresh_state.start(crm_id, account_id, 'subs')
        on_progress = refresh_state.make_on_progress(crm_id, account_id, 'subs')
        result = subscribers_sync.full_sync_subscribers(
            crm_id, account_id, proxy=proxy, on_progress=on_progress)
        refresh_state.finish(
            crm_id, account_id, 'subs',
            success=bool(result.get('success')),
            pages_done=result.get('pages_fetched'),
            rows_inserted=result.get('rows_inserted'),
            rows_updated=result.get('rows_updated'),
            stopped_reason=('no_more' if result.get('success') else 'error'),
            error=result.get('error'),
        )
    except Exception as e:
        logger.exception('run_fansly_subs_refresh_with_progress failed %s/%s',
                         crm_id, account_id)
        refresh_state.finish(crm_id, account_id, 'subs', success=False,
                             stopped_reason='error', error=str(e))


def run_fansly_backfill_with_progress(crm_id: str, account_id: str,
                                      proxy=None, days: int = 0) -> None:
    """Fansly-specific backfill: full wallet-ledger walk (with tx progress
    events) + subscriber roster walk (subs progress events) + a fans harvest.
    NEVER runs the OF-only tx-initial / campaigns steps — those walk /api2/v2
    via of_client and are guaranteed to fail for an account with no OF session.

    Order matters: the tx walk runs FIRST so the subs walk's ledger-based
    spend backfill has rows to attribute.

    ``days`` is accepted for signature parity with the OF backfill but ignored:
    the wallet walk is full-history (page-capped), which is what makes cached
    earnings/exports match the live ledger."""
    logger.info('Fansly backfill start %s/%s', crm_id, account_id)
    try:
        run_fansly_tx_refresh_with_progress(crm_id, account_id, mode='initial',
                                            proxy=proxy)
    except Exception:
        logger.exception('fansly backfill: tx step failed %s/%s', crm_id, account_id)
    try:
        run_fansly_subs_refresh_with_progress(crm_id, account_id, proxy=proxy)
    except Exception:
        logger.exception('fansly backfill: subs step failed %s/%s',
                         crm_id, account_id)
    try:
        import fansly_data
        fansly_data.harvest_fans(crm_id, account_id, proxy=proxy)
    except Exception:
        logger.exception('fansly backfill: harvest step failed %s/%s',
                         crm_id, account_id)
    logger.info('Fansly backfill done %s/%s', crm_id, account_id)
