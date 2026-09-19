#!/usr/bin/env python3
"""Cached campaign-claimer sync.

Populates `campaign_claimers_cache` so per-campaign earnings can be computed
in local SQL instead of calling OF per claimer.

Why we don't store spending in the claimer cache:
    OF's /campaigns/{cid}/claimers returns minimal user rows — no
    subscribedOnData, no Summ fields. The per-fan spending lives in
    /users/{id} or in the already-cached subscribers_cache row for that fan
    (they subscribed to the creator via the campaign, so they ARE in
    subscribers_cache after the next subs refresh).

    That means earnings = JOIN(claimers, subscribers_cache) — free local SQL.
    No extra OF call per claimer. See crm_database.campaigns_earnings.

Entry points:
    sync_campaign_claimers(crm, uid, campaign_id, proxy=None, on_progress=None)
    sync_all_campaigns_claimers(crm, uid, proxy=None, on_progress=None)

Both return:
    {
      'success': bool,
      'campaigns_touched': int,
      'pages_fetched': int,
      'rows_inserted': int,
      'rows_updated': int,
      'error': str | None,
    }
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

import crm_database as db
from of_client import handle_of_request

logger = logging.getLogger(__name__)

PAGE_SIZE = 100  # server-enforced ceiling
MAX_PAGES_PER_CAMPAIGN = 200  # 20k claimers — well above anything observed


def _campaigns_list_path(offset: int) -> str:
    return f"/api2/v2/campaigns?limit=100&offset={offset}&with_deleted=1&stats=1"


def _claimers_path(campaign_id, offset: int) -> str:
    return f"/api2/v2/campaigns/{campaign_id}/claimers?limit={PAGE_SIZE}&offset={offset}&more=true"


def _list_campaigns(crm_id, of_user_id, proxy) -> list[dict]:
    """Enumerate every campaign for this account (including deleted + zero-
    conversion ones — we filter client-side). Pagination: offset-based."""
    out: list[dict] = []
    offset = 0
    while offset < 10_000:  # sanity cap
        ok, data, _, _ = handle_of_request(
            crm_id, of_user_id, _campaigns_list_path(offset),
            method='GET', proxy=proxy,
        )
        if not ok:
            break
        page = data if isinstance(data, list) else (data.get('list') or [])
        if not page:
            break
        out.extend(page)
        if len(page) < 100:
            break
        offset += 100
    return out


def sync_campaign_claimers(crm_id, of_user_id, campaign_id,
                            proxy: Optional[str] = None,
                            on_progress: Optional[Callable[..., None]] = None) -> dict:
    """Walk every claimer page for one campaign and upsert into the cache.
    Does NOT early-stop on known rows — claimers are idempotent upserts, and
    we want the synced_at timestamp refreshed even for unchanged rows."""
    offset = 0
    pages = 0
    inserted = 0
    updated = 0
    while pages < MAX_PAGES_PER_CAMPAIGN:
        ok, data, status, _ = handle_of_request(
            crm_id, of_user_id, _claimers_path(campaign_id, offset),
            method='GET', proxy=proxy,
        )
        pages += 1
        if not ok:
            return {
                'success': False, 'campaigns_touched': 1,
                'pages_fetched': pages, 'rows_inserted': inserted, 'rows_updated': updated,
                'error': (data or {}).get('error') if isinstance(data, dict) else f'HTTP {status}',
            }
        page = data.get('list') if isinstance(data, dict) else (data if isinstance(data, list) else [])
        if not page:
            break
        for claimer in page:
            if db.upsert_campaign_claimer(crm_id, of_user_id, campaign_id, claimer):
                inserted += 1
            else:
                updated += 1
        if on_progress:
            on_progress(phase='fetching', pages_done=pages,
                        rows_inserted=inserted, rows_updated=updated)
        # hasMore is on the dict variant; list variant has no pagination signal
        if isinstance(data, dict) and not data.get('hasMore'):
            break
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return {
        'success': True, 'campaigns_touched': 1,
        'pages_fetched': pages, 'rows_inserted': inserted, 'rows_updated': updated,
        'error': None,
    }


# Default ceiling on how many subscribers a campaign may have before the
# bulk/scheduled sync skips it. Walking claimers is one OF page per 100 subs,
# so a 21k-sub tracking link is ~210 requests — far too expensive to run on a
# schedule. Big links are still syncable on demand via an explicit allowlist or
# the per-campaign sync. None on a caller means "no cap".
DEFAULT_MAX_SUBSCRIBERS = 2000


def _campaign_label(c: dict) -> str:
    """Lower-cased human handle for a campaign — matches what the user types
    into the tracked-campaigns allowlist (e.g. "szvrils" or its code "48")."""
    return str(c.get('campaignName') or c.get('name') or '').strip().lower()


def sync_all_campaigns_claimers(crm_id, of_user_id,
                                  proxy: Optional[str] = None,
                                  on_progress: Optional[Callable[..., None]] = None,
                                  only_names: Optional[list] = None,
                                  max_subscribers: Optional[int] = DEFAULT_MAX_SUBSCRIBERS) -> dict:
    """Walk non-empty campaigns' claimers, with two ways to bound the work:

    - `only_names`: an allowlist of campaign names/codes. When given, ONLY these
      campaigns are synced (case-insensitive on name or code), regardless of
      size. This is the "just track szvrils" path the dashboard uses.
    - `max_subscribers`: when no allowlist is given, skip campaigns above this
      subscriber count so a scheduled run never walks a 20k-sub link. Pass None
      to disable the cap (full walk).

    Always skips campaigns with `countSubscribers == 0` (no conversions = no
    claimers to fetch).
    """
    campaigns = _list_campaigns(crm_id, of_user_id, proxy)
    non_empty = [c for c in campaigns if (c.get('countSubscribers') or 0) > 0]

    if only_names:
        wanted = {str(n).strip().lower() for n in only_names if str(n).strip()}
        to_sync = [
            c for c in non_empty
            if _campaign_label(c) in wanted or str(c.get('campaignCode') or '').lower() in wanted
        ]
        skipped_reason = f"not in allowlist {sorted(wanted)}"
    elif max_subscribers is not None:
        to_sync = [c for c in non_empty if (c.get('countSubscribers') or 0) <= max_subscribers]
        skipped_reason = f"> {max_subscribers} subscribers"
    else:
        to_sync = non_empty
        skipped_reason = None

    if skipped_reason and len(to_sync) < len(non_empty):
        logger.info("campaigns_sync: %s/%s skipping %d campaign(s) (%s)",
                    crm_id, of_user_id, len(non_empty) - len(to_sync), skipped_reason)
    logger.info("campaigns_sync: %s/%s %d campaigns, %d to sync",
                crm_id, of_user_id, len(campaigns), len(to_sync))

    if on_progress:
        on_progress(phase='fetching', pages_done=0, rows_inserted=0, rows_updated=0)

    total_pages = 0
    total_inserted = 0
    total_updated = 0
    for idx, c in enumerate(to_sync, start=1):
        cid = c.get('id')
        if cid is None:
            continue
        # Per-campaign progress (surfaces as pages_done = campaigns-finished)
        def _sub_progress(**kw):
            # forward into the outer on_progress but aggregate counters across campaigns
            if on_progress is None:
                return
            on_progress(phase='fetching',
                        pages_done=total_pages + kw.get('pages_done', 0),
                        rows_inserted=total_inserted + kw.get('rows_inserted', 0),
                        rows_updated=total_updated + kw.get('rows_updated', 0))
        result = sync_campaign_claimers(crm_id, of_user_id, cid, proxy=proxy,
                                         on_progress=_sub_progress)
        total_pages += result.get('pages_fetched', 0)
        total_inserted += result.get('rows_inserted', 0)
        total_updated += result.get('rows_updated', 0)
        if not result.get('success'):
            db.mark_campaigns_refresh(crm_id, of_user_id, success=False)
            return {
                'success': False, 'campaigns_touched': idx,
                'pages_fetched': total_pages,
                'rows_inserted': total_inserted, 'rows_updated': total_updated,
                'error': f"campaign {cid}: {result.get('error')}",
            }
    db.mark_campaigns_refresh(crm_id, of_user_id, success=True)
    return {
        'success': True,
        'campaigns_touched': len(to_sync),
        'pages_fetched': total_pages,
        'rows_inserted': total_inserted,
        'rows_updated': total_updated,
        'error': None,
    }
