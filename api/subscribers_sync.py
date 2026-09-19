#!/usr/bin/env python3
"""Cached subscriber sync for each connected account (OF + Fansly).

Fansly accounts are dispatched to ``_fansly_full_sync`` (GET /api/v1/subscribers
paging + batched identity hydration) by both entry points; everything below the
dispatch is the original OnlyFans walker, untouched.

Why this exists:
    /api2/v2/subscriptions/subscribers/latest is offset-paginated at 100/page.
    For a 20k-subscriber account that's 200 requests per full refresh, all
    counting against the CRM's monthly api_usage quota. Doing that daily is
    painful and it's not even what we need — the only thing that *actually*
    changes between runs is the tail (new subs + renewals).

What this does:
    `/subscribers/latest` is sorted by most-recent subscribe/renewal, so we walk
    pages top-down and stop as soon as we hit a (fan_of_user_id, subscribed_at)
    pair already in the cache. Typical daily diff is 1-2 pages.

Entry points:
    delta_sync_subscribers(crm_id, of_user_id, proxy=None, on_progress=None)
        — the cheap path. Use this from the scheduler.
    full_sync_subscribers(crm_id, of_user_id, proxy=None, on_progress=None)
        — forced full walk. Use this on the first sync for an account, or as
          a weekly reconciliation to catch anything the delta path missed.

`on_progress` is an optional callable invoked after every page with kwargs
{pages_done, rows_inserted, rows_updated, phase}. The default None makes this
module side-effect-free for tests / scheduler callers that don't care about
live UI updates. No pages_est — /subscribers/latest returns variable page
sizes (75-92 per `limit=100` page, post-filtered server-side) so any estimate
would be wrong. The UI shows an indeterminate bar with a live row counter.

Both return a dict:
    {
      'success': bool,
      'mode': 'delta' | 'full',
      'pages_fetched': int,
      'rows_upserted': int,
      'stopped_at_known': bool,    # only meaningful in delta mode
      'error': str | None,
    }
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

import crm_database as db
from of_client import handle_of_request

logger = logging.getLogger(__name__)

PAGE_SIZE = 100
# Safety cap — if something goes wrong we never want to spin for thousands of
# pages. 500 pages × 100 rows = 50k subscribers, well above any real account.
MAX_PAGES = 500
# /subscriptions/subscribers/latest never reports hasMore=false and keeps
# returning rows at any offset (same unbounded behaviour as /chats). Active
# subscribers are front-loaded; the tail is an effectively infinite run of
# expired ones. So a full walk must (a) survive a transient page drop rather
# than truncate the whole roster, and (b) stop once it reaches the fully-expired
# tail instead of grinding all the way to MAX_PAGES.
SUBS_FETCH_RETRIES = 3           # re-fetch a dropped page before giving up
SUBS_EXPIRED_TAIL_PAGES = 5      # this many consecutive all-expired pages => stop

# Fansly page size: the endpoint accepted limit=25 live; larger limits may be
# clamped server-side, which is fine — the walker advances by rows actually
# returned, not by the requested limit.
FANSLY_PAGE_SIZE = 100


def _platform(crm_id: str, of_user_id: str) -> str:
    return ((db.get_of_account(crm_id, of_user_id) or {}).get('platform')
            or 'onlyfans')


def _fansly_full_sync(
    crm_id: str,
    of_user_id: str,
    proxy: Optional[str],
    *,
    mode: str = 'full',
    on_progress: Optional[Callable[..., None]] = None,
    on_new_row: Optional[Callable[[dict], None]] = None,
    max_pages: Optional[int] = None,
) -> dict:
    """Fansly subscriber sync — pages GET /api/v1/subscribers (via
    fansly_data.fetch_subscribers_page, which also hydrates identities with one
    batched /account?ids= call per page and upserts them into ``fans``).

    Always a FULL walk: /api/v1/subscribers has no proven recency ordering
    (page 1 was all-active live, deep offsets all-expired) so there is no safe
    delta stop-signal — and it doesn't need one: the whole roster is
    total/PAGE_SIZE pages + as many hydration calls (a 127-sub account is 4
    GETs), unlike OF's per-100 walk. ``mode`` is echoed for result parity.

    After the walk, spend columns are backfilled from the synced wallet ledger
    (transactions_cache, keyed by correlationAccountId) — Fansly rows carry no
    subscribedOnData.*Summ aggregates, so ledger attribution is the only spend
    signal. Rows with no attributable ledger rows keep NULL (= unknown).
    """
    import fansly_data

    if on_progress:
        on_progress(phase='fetching', pages_done=0,
                    rows_inserted=0, rows_updated=0)

    offset = 0
    pages = 0
    inserted = 0
    updated = 0
    # /api/v1/subscribers can list the same fan twice — a lapsed subscription
    # (status 5, deep offset) and the current one. The cache keeps one row per
    # fan, so whichever came LAST used to win, and an old expired row could
    # drag subscribed_at backwards and flip a live fan to expired. Keep the
    # newest subscription seen in this walk (Fansly ISO strings share one
    # format, so they compare lexicographically).
    newest_seen: dict = {}
    page_cap = max_pages if max_pages is not None else MAX_PAGES
    while pages < page_cap:
        status, body = fansly_data.fetch_subscribers_page(
            crm_id, of_user_id, limit=FANSLY_PAGE_SIZE, offset=offset,
            proxy=proxy, type_='all')
        pages += 1
        if status != 200 or not (body or {}).get('success'):
            db.mark_subscribers_refresh(crm_id, of_user_id, success=False)
            if on_progress:
                on_progress(phase='error', pages_done=pages,
                            rows_inserted=inserted, rows_updated=updated)
            return {
                'success': False, 'mode': mode,
                'pages_fetched': pages, 'rows_upserted': inserted + updated,
                'rows_inserted': inserted, 'rows_updated': updated,
                'stopped_at_known': False,
                'error': (body or {}).get('error') or f'HTTP {status}',
            }

        rows = (body or {}).get('list') or []
        if not rows:
            break
        for fan in rows:
            if not fan.get('id'):
                continue
            fan_key = str(fan['id'])
            sub_at = fan.get('subscribedOn') or ''
            if fan_key in newest_seen and sub_at < newest_seen[fan_key]:
                continue
            newest_seen[fan_key] = sub_at
            known_at = db.get_cached_subscriber_subscribe_at(
                crm_id, of_user_id, fan['id'])
            db.upsert_subscriber(crm_id, of_user_id, fan)
            if known_at:
                updated += 1
            else:
                inserted += 1
                if on_new_row:
                    try:
                        on_new_row(fan)
                    except Exception:
                        logger.exception("on_new_row callback failed for fan %s",
                                         fan.get('id'))
        if on_progress:
            on_progress(phase='fetching', pages_done=pages,
                        rows_inserted=inserted, rows_updated=updated)

        if not body.get('hasMore'):
            break
        # Advance by RAW rows consumed (nextOffset), never len(list) — the
        # server may clamp the requested limit.
        next_offset = body.get('nextOffset')
        if not isinstance(next_offset, int) or next_offset <= offset:
            break
        offset = next_offset

    # Spend backfill from the wallet ledger (best-effort, pure local SQL).
    try:
        db.apply_fansly_spend_from_tx_cache(crm_id, of_user_id)
    except Exception:
        logger.exception("fansly subs_sync: spend backfill failed %s/%s",
                         crm_id, of_user_id)

    db.mark_subscribers_refresh(crm_id, of_user_id, success=True)
    logger.info("fansly subs_sync: %s/%s pages=%d inserted=%d updated=%d",
                crm_id, of_user_id, pages, inserted, updated)
    return {
        'success': True, 'mode': mode,
        'pages_fetched': pages,
        'rows_upserted': inserted + updated,
        'rows_inserted': inserted,
        'rows_updated': updated,
        'stopped_at_known': False,
        'error': None,
    }


def _paged_path(offset: int) -> str:
    return (
        f"/api2/v2/subscriptions/subscribers/latest"
        f"?limit={PAGE_SIZE}&offset={offset}&format=infinite"
        f"&filter[total_spent]=1&more=true"
    )


def _fetch_page(crm_id: str, of_user_id: str, offset: int, proxy: Optional[str]):
    return handle_of_request(crm_id, of_user_id, _paged_path(offset), method='GET', proxy=proxy)


def _subscribed_at(fan_row: dict) -> Optional[str]:
    sbd = fan_row.get('subscribedByData') or {}
    return sbd.get('subscribeAt') or fan_row.get('subscribedOn')


def _walk(
    crm_id: str,
    of_user_id: str,
    proxy: Optional[str],
    *,
    mode: str,                                      # 'delta' | 'full'
    on_progress: Optional[Callable[..., None]] = None,
    on_new_row: Optional[Callable[[dict], None]] = None,
    max_pages: Optional[int] = None,
) -> dict:
    """Shared paginator for delta + full modes.

    Walks /subscribers/latest until the API says `hasMore: false` (or returns
    an empty page). We do NOT pre-compute a pages estimate — OF returns
    variable-size pages (75-92 rows per `limit=100` call, post-filtered
    server-side) so any pages_est based on `/count` would be wrong, and the
    number of rows we'll see is only knowable by actually walking. The UI
    renders an indeterminate bar with a running "N subscribers synced" counter.

    Delta stops on the first (fan, subscribed_at) match already in cache.
    Full walks every page.
    """
    stop_on_known = (mode == 'delta')

    if on_progress:
        on_progress(phase='fetching', pages_done=0,
                    rows_inserted=0, rows_updated=0)

    offset = 0
    pages = 0
    inserted = 0           # genuinely new subscriber rows
    updated = 0            # re-upserts of known subs (lifecycle refresh)
    stopped_at_known = False
    expired_streak = 0     # consecutive pages with no active subscriber

    page_cap = max_pages if max_pages is not None else MAX_PAGES
    while pages < page_cap:
        # Retry a dropped page before giving up — without this, one transient
        # proxy blip aborts the whole walk mid-roster (it truncated a 46k-sub
        # account at ~32k).
        success, data, status = False, None, None
        for _attempt in range(SUBS_FETCH_RETRIES):
            success, data, status, _ = _fetch_page(crm_id, of_user_id, offset, proxy)
            if success:
                break
        pages += 1
        if not success:
            reason = data.get('reason') if isinstance(data, dict) else None
            if reason != 'sync_blocked':
                db.mark_subscribers_refresh(crm_id, of_user_id, success=False)
            if on_progress:
                on_progress(phase='error', pages_done=pages,
                            rows_inserted=inserted, rows_updated=updated)
            return {
                'success': False, 'mode': mode,
                'pages_fetched': pages, 'rows_upserted': inserted + updated,
                'rows_inserted': inserted, 'rows_updated': updated,
                'stopped_at_known': False,
                'error': (data or {}).get('error') if isinstance(data, dict) else f'HTTP {status}',
            }

        page = (data or {}).get('users') or (data or {}).get('list') or []
        if not page:
            break

        page_has_active = False
        for fan in page:
            if fan.get('subscribedBy') is True:
                page_has_active = True
            known_at = db.get_cached_subscriber_subscribe_at(crm_id, of_user_id, fan.get('id'))
            if stop_on_known:
                incoming_at = _subscribed_at(fan)
                if known_at and incoming_at and known_at == incoming_at:
                    stopped_at_known = True
                    break
            db.upsert_subscriber(crm_id, of_user_id, fan)
            if known_at:
                updated += 1
            else:
                inserted += 1
                if on_new_row:
                    try:
                        on_new_row(fan)
                    except Exception:
                        # Callback failure shouldn't abort the walk — the row is
                        # already cached, caller will notice the next time.
                        logger.exception("on_new_row callback failed for fan %s", fan.get('id'))

        if on_progress:
            on_progress(phase='fetching', pages_done=pages,
                        rows_inserted=inserted, rows_updated=updated)

        if stopped_at_known:
            break
        # Active subs are front-loaded; a run of fully-expired pages means we've
        # reached the unbounded dead tail — stop instead of grinding to the cap
        # (this endpoint never returns hasMore=false for big accounts).
        expired_streak = 0 if page_has_active else expired_streak + 1
        if expired_streak >= SUBS_EXPIRED_TAIL_PAGES:
            break
        if not (data or {}).get('hasMore'):
            break
        offset += PAGE_SIZE

    db.mark_subscribers_refresh(crm_id, of_user_id, success=True)
    logger.info("subs_sync (%s): %s/%s pages=%d inserted=%d updated=%d stopped_at_known=%s",
                mode, crm_id, of_user_id, pages, inserted, updated, stopped_at_known)
    return {
        'success': True, 'mode': mode,
        'pages_fetched': pages,
        'rows_upserted': inserted + updated,
        'rows_inserted': inserted,
        'rows_updated': updated,
        'stopped_at_known': stopped_at_known,
        'error': None,
    }


def delta_sync_subscribers(crm_id: str, of_user_id: str,
                            proxy: Optional[str] = None,
                            on_progress: Optional[Callable[..., None]] = None,
                            on_new_row: Optional[Callable[[dict], None]] = None,
                            max_pages: Optional[int] = None,
                            promote_to_full_on_empty: bool = True) -> dict:
    """Walk /subscribers/latest top-down; stop when we hit a known (fan, subscribe_at).

    Empty cache: by default we promote to a full walk (first-time populate).
    The fast-interval poller passes `promote_to_full_on_empty=False` so a
    never-synced account doesn't trigger a minutes-long walk in the 120s poll;
    the weekly scheduled full refresh handles that instead.

    `on_new_row(fan)` — optional callback invoked exactly once per row where
    the fan's subscribe_at wasn't previously in cache. Used by the poller to
    emit `new_subscriber` / `renewed_subscriber` events at insert-time.

    `max_pages` — override the MAX_PAGES safety cap. Poller passes a small
    value (e.g. 10) to keep fast-loop work bounded.

    Fansly accounts route to the full-walk fansly sync (no recency ordering →
    no delta stop-signal; the walk is a handful of GETs anyway)."""
    if _platform(crm_id, of_user_id) == 'fansly':
        return _fansly_full_sync(crm_id, of_user_id, proxy, mode='delta',
                                 on_progress=on_progress, on_new_row=on_new_row,
                                 max_pages=max_pages)
    summary = db.subscribers_cache_summary(crm_id, of_user_id)
    if (summary.get('total') or 0) == 0:
        if not promote_to_full_on_empty:
            return {'success': True, 'mode': 'delta', 'pages_fetched': 0,
                    'rows_upserted': 0, 'rows_inserted': 0, 'rows_updated': 0,
                    'stopped_at_known': False, 'error': None, 'skipped_empty': True}
        logger.info("subs_sync: empty cache for %s/%s — promoting to full sync",
                    crm_id, of_user_id)
        return full_sync_subscribers(crm_id, of_user_id, proxy=proxy,
                                      on_progress=on_progress, on_new_row=on_new_row,
                                      max_pages=max_pages)
    return _walk(crm_id, of_user_id, proxy, mode='delta',
                  on_progress=on_progress, on_new_row=on_new_row,
                  max_pages=max_pages)


def full_sync_subscribers(crm_id: str, of_user_id: str,
                           proxy: Optional[str] = None,
                           on_progress: Optional[Callable[..., None]] = None,
                           on_new_row: Optional[Callable[[dict], None]] = None,
                           max_pages: Optional[int] = None) -> dict:
    """Walk every page and upsert every subscriber. Does not early-stop."""
    if _platform(crm_id, of_user_id) == 'fansly':
        return _fansly_full_sync(crm_id, of_user_id, proxy, mode='full',
                                 on_progress=on_progress, on_new_row=on_new_row,
                                 max_pages=max_pages)
    return _walk(crm_id, of_user_id, proxy, mode='full',
                  on_progress=on_progress, on_new_row=on_new_row,
                  max_pages=max_pages)
