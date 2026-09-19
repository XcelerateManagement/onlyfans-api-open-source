#!/usr/bin/env python3
"""Cached transaction (ledger) sync for each connected OF account.

Why this exists:
    /subscribers/latest only tells us who subscribes/renews. A fan's `spentTotal`
    on the subscriber row is a server-side aggregate that we refresh every 20h
    via subscribers_sync, but we ALSO want a granular per-transaction ledger so
    we can attribute spending to campaigns, posts, messages, streams, and time
    windows — joins that require rows, not aggregates.

    OF's /payouts/transactions is exactly that ledger — every tip, subscription,
    renewal, message, post and stream payment the creator has earned on, one row
    per line item, with a stable hex `id` (ideal for delta-stop) and an embedded
    `user` object (ideal for per-fan attribution).

Design constraints:
    1. NEVER do an unbounded initial backfill. Creators with millions of
       transactions exist — pulling a full history would take hours and burn
       huge chunks of the monthly API quota. The first sync is BOUNDED to
       `INITIAL_WINDOW_DAYS` (default 30) OR `INITIAL_MAX_PAGES` (default 30),
       whichever hits first.
    2. After the bounded first sync, every run is a delta walk. We stop as soon
       as we see a `tx.id` already in the cache — that's the "we caught up"
       signal. Typical daily delta for a 7-tx/day creator is 1 page.
    3. Page size is capped server-side at 100 regardless of what `limit` we
       send. No point pushing higher.
    4. All requests go through of_client.handle_of_request which signs + uses
       the account's stored proxy + auto-relogins on session expiry.

Entry points:
    delta_sync_transactions(crm_id, of_user_id, proxy=None, **overrides)
        — the cheap path. Runs initial bounded walk on empty cache, otherwise
          delta. Use this from the scheduler and from the manual "Refresh" UI.
    initial_sync_transactions(crm_id, of_user_id, proxy=None, days=30, max_pages=30)
        — explicit bounded first-sync; used internally by delta_sync when cache
          is empty, but also callable directly if you want a custom window.

Both return:
    {
      'success': bool,
      'mode': 'initial' | 'delta',
      'pages_fetched': int,
      'rows_inserted': int,      # NEW tx rows (what the delta walker cares about)
      'rows_updated': int,       # seen-before rows re-upserted
      'stopped_reason': 'caught_up' | 'window_exhausted' | 'page_cap' | 'no_more' | 'error',
      'oldest_created_at': str | None,
      'newest_created_at': str | None,
      'error': str | None,
    }
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

import crm_database as db
from of_client import handle_of_request

logger = logging.getLogger(__name__)

# Server enforces 100/page on /payouts/transactions regardless of `?limit=`.
PAGE_SIZE = 100

# First-sync bounds. These are the main safety rails against running into a
# creator with a multi-year history. If both are hit we stop cleanly.
INITIAL_WINDOW_DAYS = 30
INITIAL_MAX_PAGES = 30

# Hard safety cap for delta runs. If the delta walker ever fails to find a
# known tx (e.g. cache corruption, or we were offline for a month), we stop
# at this many pages rather than run away. Tuned so a gap of a few weeks still
# resolves automatically; longer gaps require a manual `initial` re-sync.
DELTA_MAX_PAGES = 200


def _path(marker: Optional[str]) -> str:
    q = f"limit={PAGE_SIZE}"
    if marker:
        q += f"&marker={marker}"
    return f"/api2/v2/payouts/transactions?{q}"


def _fetch_page(crm_id, of_user_id, marker, proxy):
    return handle_of_request(crm_id, of_user_id, _path(marker), method='GET', proxy=proxy)


def _page_times(page):
    """Return (newest, oldest) createdAt from a page, for logging + bounds."""
    if not page:
        return None, None
    return page[0].get('createdAt'), page[-1].get('createdAt')


def _parse_iso(ts):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except Exception:
        return None


def _walk(crm_id, of_user_id, proxy, *, mode, max_pages, since_dt=None,
          delta_stop=False, on_progress: Optional[Callable[..., None]] = None,
          pages_est: Optional[int] = None,
          on_new_row: Optional[Callable[[dict], None]] = None):
    """Core walker used by both initial and delta modes.

    - `since_dt`: if set, stop once the oldest row on a page is < since_dt.
    - `delta_stop`: if True, we're in delta mode. The walker finishes the
      CURRENT page (refreshing statuses of every tx on it — `loading` → `done`
      transitions happen out-of-band on OF's side and would drift otherwise),
      and stops at the first page whose upserts produced **zero new inserts**.
      That's the "caught up" signal: a full page of already-cached tx means we
      definitely aren't going to find any new ones below. Typical delta run
      walks 1-2 pages: the first page catches new tx at the top, the second
      confirms we're done. Contrast with the earlier version which broke on
      the very first known tx and never updated pending-status rows.
    - `on_progress`: optional callback(**kwargs) invoked after every page with
      {pages_done, pages_est, rows_inserted, rows_updated, phase}.
    - `pages_est`: estimate for determinate progress bar. For `initial` mode we
      pass max_pages as a hard ceiling; for `delta` mode we pass None (typical
      delta is 1-2 pages, so an estimate would be misleading).
    """
    if on_progress:
        on_progress(phase='fetching', pages_done=0, pages_est=pages_est,
                    rows_inserted=0, rows_updated=0)

    marker = None
    pages = 0
    inserted = 0
    updated = 0
    newest_seen = None
    oldest_seen = None
    stopped_reason = 'no_more'

    while pages < max_pages:
        success, data, status, _ = _fetch_page(crm_id, of_user_id, marker, proxy)
        pages += 1
        if not success:
            payload = data if isinstance(data, dict) else {}
            state = payload.get('connection_state')
            reason = str(payload.get('reason') or '')
            # A failed ledger request must be visible to readiness/operations.
            # Previously this returned an error to the in-memory refresh state
            # but left the persistent counter at zero, making scheduled failures
            # look like healthy empty accounts after a restart.
            # An explicit operator/dependency pause is not an account failure
            # and must not poison counters or auto-pause healthy customers.
            if reason != 'sync_blocked':
                db.mark_transactions_refresh(crm_id, of_user_id, success=False)
            # A freshly authenticated session may still be denied only on the
            # payout ledger.  That is a partial, retryable sync failure—not an
            # invalid password.  Keep the state until this exact surface
            # succeeds; ordinary /users/me polls must not paint it green.
            if (state not in {'login_failed', 'verification_required'}
                    and reason != 'sync_blocked'
                    and not reason.startswith('proxy_')
                    and reason != 'rate_limited'):
                db.set_connection_error(
                    crm_id, of_user_id, 'temporary_error',
                    'transactions_unavailable',
                )
            if on_progress:
                on_progress(phase='error', pages_done=pages,
                            rows_inserted=inserted, rows_updated=updated)
            return {
                'success': False, 'mode': mode,
                'pages_fetched': pages, 'rows_inserted': inserted, 'rows_updated': updated,
                'stopped_reason': 'error',
                'oldest_created_at': oldest_seen, 'newest_created_at': newest_seen,
                'pages_est': pages_est,
                'error': (data or {}).get('error') if isinstance(data, dict) else f'HTTP {status}',
            }

        page = (data or {}).get('list') or []
        if not page:
            break
        page_newest, page_oldest = _page_times(page)
        if pages == 1:
            newest_seen = page_newest
        oldest_seen = page_oldest

        page_inserts = 0
        hit_window = False
        for tx in page:
            # since-filter: any row older than the window stops the walk
            if since_dt is not None:
                created_dt = _parse_iso(tx.get('createdAt'))
                if created_dt and created_dt < since_dt:
                    stopped_reason = 'window_exhausted'
                    hit_window = True
                    break
            is_new = db.upsert_transaction(crm_id, of_user_id, tx)
            if is_new:
                inserted += 1
                page_inserts += 1
                if on_new_row:
                    try:
                        on_new_row(tx)
                    except Exception:
                        logger.exception("on_new_row callback failed for tx %s", tx.get('id'))
            else:
                updated += 1

        if on_progress:
            on_progress(phase='fetching', pages_done=pages, pages_est=pages_est,
                        rows_inserted=inserted, rows_updated=updated)

        if hit_window:
            break
        # Delta mode: stop after the first *full* page with zero new inserts.
        # That means every tx we just looked at was already in cache, which is
        # the definitive "caught up" signal. This still lets us UPDATE statuses
        # on the page we just walked (loading → done transitions), which the
        # earlier break-on-first-known approach never did.
        if delta_stop and page_inserts == 0:
            stopped_reason = 'caught_up'
            break
        if not (data or {}).get('hasMore'):
            break
        marker = (data or {}).get('nextMarker')
        if not marker:
            break
    else:
        stopped_reason = 'page_cap'

    db.mark_transactions_refresh(crm_id, of_user_id, success=True, latest_marker=newest_seen)
    return {
        'success': True, 'mode': mode,
        'pages_fetched': pages, 'rows_inserted': inserted, 'rows_updated': updated,
        'stopped_reason': stopped_reason,
        'oldest_created_at': oldest_seen, 'newest_created_at': newest_seen,
        'pages_est': pages_est,
        'error': None,
    }


def delta_sync_transactions(crm_id, of_user_id, proxy=None,
                             initial_days=INITIAL_WINDOW_DAYS,
                             initial_max_pages=INITIAL_MAX_PAGES,
                             on_progress: Optional[Callable[..., None]] = None,
                             on_new_row: Optional[Callable[[dict], None]] = None,
                             max_pages: Optional[int] = None,
                             promote_to_initial_on_empty: bool = True):
    """Forward-delta walk. If cache is empty, delegates to initial_sync.

    `on_new_row(tx)` — optional callback invoked once per truly-new transaction.
    The fast-interval poller uses this to emit `new_tip`/`new_purchase` events
    as tx cross into the ledger, so the activity feed is driven by the actual
    money ledger rather than the notifications subtype map.

    `max_pages` — override the DELTA_MAX_PAGES cap. The poller passes 10 so a
    120s-interval walk stays bounded even during a burst.

    `promote_to_initial_on_empty=False` — poller-safe flag; skips the
    30-day initial walk when cache is empty (the scheduled 24h job handles
    that). Avoids a minutes-long first-sync inside a 2-min poll loop."""
    summary = db.transactions_cache_summary(crm_id, of_user_id)
    if (summary.get('total') or 0) == 0:
        if not promote_to_initial_on_empty:
            return {'success': True, 'mode': 'delta', 'pages_fetched': 0,
                    'rows_inserted': 0, 'rows_updated': 0,
                    'stopped_reason': 'no_more',
                    'oldest_created_at': None, 'newest_created_at': None,
                    'pages_est': None, 'error': None, 'skipped_empty': True}
        logger.info("tx_sync: empty cache for %s/%s — running bounded initial",
                    crm_id, of_user_id)
        return initial_sync_transactions(crm_id, of_user_id, proxy=proxy,
                                         days=initial_days,
                                         max_pages=initial_max_pages,
                                         on_progress=on_progress,
                                         on_new_row=on_new_row)

    logger.info("tx_sync (delta): %s/%s", crm_id, of_user_id)
    result = _walk(crm_id, of_user_id, proxy,
                   mode='delta',
                   max_pages=max_pages if max_pages is not None else DELTA_MAX_PAGES,
                   delta_stop=True, on_progress=on_progress, pages_est=None,
                   on_new_row=on_new_row)
    logger.info("tx_sync (delta) done: %s/%s %s", crm_id, of_user_id, result)
    return result


def initial_sync_transactions(crm_id, of_user_id, proxy=None,
                               days=INITIAL_WINDOW_DAYS,
                               max_pages=INITIAL_MAX_PAGES,
                               on_progress: Optional[Callable[..., None]] = None,
                               on_new_row: Optional[Callable[[dict], None]] = None):
    """Bounded first-sync for an account we've never ingested before.

    Walks newest→oldest and stops at the first of:
      - `days` days of history reached
      - `max_pages` pages fetched
      - no more pages
    """
    since_dt = datetime.now(timezone.utc) - timedelta(days=int(days))
    logger.info("tx_sync (initial): %s/%s, window=%sd, max_pages=%s",
                crm_id, of_user_id, days, max_pages)
    result = _walk(crm_id, of_user_id, proxy,
                   mode='initial', max_pages=max_pages, since_dt=since_dt,
                   on_progress=on_progress, pages_est=max_pages,
                   on_new_row=on_new_row)
    logger.info("tx_sync (initial) done: %s/%s %s", crm_id, of_user_id, result)
    return result
