#!/usr/bin/env python3
"""Per-account OnlyFans poller.

Called by APScheduler on a per-account schedule (default 120s). Drives both
the live event stream AND keeps the caches converged with reality.

Traffic profile per poll (fast path, nothing new):
  - /users/notifications?limit=100   (1 req, for free messages + non-monetary)
  - /subscribers/latest              (~1-2 reqs via delta walker, capped 10)
  - /payouts/transactions            (~1 req via delta walker, capped 10)
Total: ~3-5 requests per 2 min on a quiet account.

Catch-up path (activity burst since last poll):
  - Each delta walker keeps going until caught up OR 10 pages — so up to
    ~2k new rows per kind per poll. Beyond that, the next poll picks up
    where this one left off.

Event sources of truth (after the cache-merge refactor):
  - new_tip / new_purchase   → transactions_cache walker (money ledger is
                                authoritative; tip notifications can lag by
                                seconds vs the tx row clearing)
  - new_message (FREE)       → /users/notifications (not in tx ledger)
  - new_subscriber /
    renewed_subscriber       → subscribers_cache walker
  - expired_subscriber       → /subscribers/count delta (every 10th poll)
"""

from __future__ import annotations

import logging
import os
import random
import re
import traceback
from datetime import datetime

import crm_database as db
import event_bus
import subscribers_sync
import transactions_sync
import runtime_readiness
import proxy_health
from of_client import handle_of_request

logger = logging.getLogger(__name__)


# How deep each delta walker may go on a single 120s poll. 10 pages of 100 rows
# is 1000 new items per kind — handles any realistic burst. If a real creator
# ever exceeds this in a 2-min window the next poll just continues the walk.
POLLER_MAX_PAGES = 10


# Notification subtypes → internal event type.
# After the cache-merge refactor, the MONETARY subtypes (tips, purchases) are
# intentionally NOT in this map — they come from the tx_cache walker with a
# stable source_event_id = tx.id, so event_bus dedup keeps them clean. The
# notifications fetch now only provides signals that aren't in the tx ledger:
# free DMs and (TODO) comments/likes/engagement if we add them later.
SUBTYPE_MAP = {
    "new_message": "new_message",
}


# Map from transactions_cache.tx_type → internal event type. Used by the
# tx walker's on_new_row callback in poll_account.
TX_TYPE_TO_EVENT = {
    "tip":          "new_tip",
    "message":      "new_purchase",
    "post":         "new_purchase",
    "stream":       "new_purchase",
    "chargeback":   "new_purchase",  # emit as purchase so UI sees the reversal
    # subscription + renewal are covered by subs walker; not emitted here
}


def _nid_gt(a: str, b: str) -> bool:
    """Is notification id `a` newer than `b`?

    OnlyFans ids are numeric strings, but not guaranteed to be — compare as
    integers when both parse, and fall back to string order otherwise. This is
    the same rule the cursor-advance below uses; it lives here so the seeding
    pass and the emit pass cannot drift apart.
    """
    try:
        return int(a) > int(b)
    except (TypeError, ValueError):
        return str(a) > str(b)


def _strip_html(s: str | None) -> str:
    if not s:
        return ""
    return re.sub(r"<[^>]+>", "", s).strip()


def _parse_amount(notif: dict) -> float | None:
    """Pull a dollar amount out of a notification.

    OF renders amounts as strings inside ``replacePairs`` — e.g.
    ``{AMOUNT}`` → ``"$25.00"`` for tips and ``"$69.00"`` for paid messages.
    Also falls back to ``price`` / ``tipAmount`` keys on older shapes.
    """
    rp = notif.get("replacePairs") or {}
    amt_str = rp.get("{AMOUNT}") or rp.get("{PRICE}") or ""
    m = re.match(r"^\$?([\d,]+\.?\d*)", str(amt_str))
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    for k in ("price", "tipAmount", "amount"):
        v = notif.get(k)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                pass
    return None


def _extract_fan(notif: dict) -> dict:
    """Build a normalised fan dict from a notification.

    Requires the request to NOT include ``skip_users=all`` — with it, OF omits
    the ``user`` object entirely and we'd have nothing to extract.
    """
    u = notif.get("user") or notif.get("fromUser") or {}
    return {
        "id": u.get("id"),
        "username": u.get("username"),
        "display_name": u.get("name") or u.get("displayName"),
        "avatar": u.get("avatar"),
    }


def poll_account(crm_id: str, of_user_id: str) -> None:
    """Poll one account. Safe to call from threads — doesn't raise."""
    try:
        # The scheduler checks too, but a pause can arrive after a job was
        # submitted and before its worker starts. Exit without touching the
        # account failure counter in that race.
        if not runtime_readiness.signed_jobs_ready():
            logger.warning("poll skipped by signed-job circuit for %s/%s",
                           crm_id, of_user_id)
            return
        # Platform dispatch: Fansly accounts have a narrower poll surface and a
        # different API, handled by fansly_poller. Gated by FANSLY_POLLING_ENABLED
        # so the OF poll path is the only one active by default.
        acct = db.get_of_account(crm_id, of_user_id)
        if acct and (acct.get('platform') or 'onlyfans') == 'fansly':
            import config as _config
            if getattr(_config, 'FANSLY_POLLING_ENABLED', False):
                import fansly_poller
                fansly_poller.poll_fansly_account(crm_id, of_user_id)
            else:
                # Not silent: surfaced to operators here, to API consumers via
                # the PATCH /polling warning, and to the UI via
                # pf.capabilities('fansly')['polling'] reflecting the flag.
                logger.warning(
                    "fansly poll skipped for %s/%s: FANSLY_POLLING_ENABLED=false",
                    crm_id, of_user_id)
            return

        cursor = db.load_polling_cursor(crm_id, of_user_id) or {}
        new_cursor = dict(cursor)
        saw_failure = False
        poll_index = int(cursor.get("poll_index", 0)) + 1
        new_cursor["poll_index"] = poll_index

        # ------- 1. Notifications -------
        # No skip_users — we need the embedded user object for fan extraction.
        ok, data, _, _ = handle_of_request(
            crm_id, of_user_id,
            "/api2/v2/users/notifications?limit=100",
        )
        if ok:
            # OF returns a bare list; older shape had {list: [...]}. Handle both.
            items = data if isinstance(data, list) else (data.get("list") or [] if isinstance(data, dict) else [])
            last_id = cursor.get("last_notification_id")
            max_id = last_id
            # FIRST POLL SEEDS THE CURSOR, IT DOES NOT EMIT.
            #
            # Without this, an account whose polling was just switched on has no
            # cursor, so the `if last_id` guard below never fires and every one
            # of the 100 notifications OnlyFans returns is emitted as if it had
            # just happened. Those are not harmless UI rows: event_bus.emit fans
            # each one out to SSE, to HMAC-signed webhooks, to automations (which
            # can send DMs), and to the panel Telegram channel.
            #
            # Measured on a real 5-account panel: enabling polling wrote 110
            # events in one second, with occurred_at spanning the previous two
            # weeks. The dashboard then showed a two-week-old purchase in a feed
            # labelled "Live". At 600 accounts that is up to 60,000 backdated
            # events pushed through every integration on import day — which is
            # exactly the moment a bulk import would trigger it.
            #
            # The history itself is not lost: transactions/subscribers backfills
            # populate the caches, and those are what the earnings and fan views
            # read. What is suppressed is only the claim that old news is new.
            seeding = not last_id
            for notif in reversed(items):
                nid = str(notif.get("id") or "")
                if nid and (not max_id or _nid_gt(nid, max_id)):
                    max_id = nid
            if seeding:
                if max_id:
                    new_cursor["last_notification_id"] = str(max_id)
                logger.info(
                    "poll: seeding notification cursor for %s/%s at %s "
                    "(%d historical notifications suppressed, not emitted)",
                    crm_id, of_user_id, max_id, len(items),
                )
                items = []
            for notif in reversed(items):  # oldest-first so events are emitted chronologically
                nid = str(notif.get("id") or "")
                if not nid:
                    continue
                # Advance cursor for every new item even if we don't emit — stops reprocessing
                if last_id:
                    try:
                        if int(nid) <= int(last_id):
                            continue
                    except ValueError:
                        if nid <= str(last_id):
                            continue
                if not max_id:
                    max_id = nid
                else:
                    try:
                        if int(nid) > int(max_id):
                            max_id = nid
                    except ValueError:
                        if nid > str(max_id):
                            max_id = nid
                event_type = SUBTYPE_MAP.get(notif.get("subType"))
                if not event_type:
                    continue
                fan = _extract_fan(notif)
                if fan.get("id"):
                    db.upsert_fan(
                        crm_id, of_user_id, fan["id"],
                        username=fan.get("username"),
                        display_name=fan.get("display_name"),
                        avatar=fan.get("avatar"),
                    )
                payload = {
                    "fan": fan,
                    "text": _strip_html(notif.get("text")),
                    "amount": _parse_amount(notif),
                    "raw_type": notif.get("type"),
                    "raw_subtype": notif.get("subType"),
                    "created_at": notif.get("createdAt"),
                }
                event_bus.emit(
                    crm_id, of_user_id, event_type, payload,
                    source_event_id=nid,
                    occurred_at=notif.get("createdAt"),
                )
            if max_id:
                new_cursor["last_notification_id"] = str(max_id)
        elif isinstance(data, dict) and data.get('reason') == 'sync_blocked':
            return
        else:
            saw_failure = True

        # ------- 2. Subscribers — delta-walk via subscribers_sync, fills subs_cache -------
        # Same walker the scheduled 7d job uses, capped at 10 pages so a
        # fast-interval poll can't blow the quota. Skips empty-cache-first-sync
        # (that's what the scheduled refresh is for — we'd otherwise try to
        # walk all 20k subs in a 120s loop).
        def _emit_new_sub(u: dict) -> None:
            sbd = u.get("subscribedByData") or {}
            sub_at = sbd.get("subscribeAt")
            fan_id = u.get("id")
            if not fan_id or not sub_at:
                return
            db.upsert_fan(
                crm_id, of_user_id, fan_id,
                username=u.get("username"),
                display_name=u.get("name") or u.get("displayName"),
                avatar=u.get("avatar"),
            )
            subscribes = sbd.get("subscribes") or []
            latest_action = subscribes[-1].get("action", "subscribe") if subscribes else "subscribe"
            event_type = "renewed_subscriber" if latest_action == "renewal" else "new_subscriber"
            payload = {
                "fan": {
                    "id": fan_id,
                    "username": u.get("username"),
                    "display_name": u.get("name") or u.get("displayName"),
                    "avatar": u.get("avatar"),
                },
                "price": sbd.get("price"),
                "regular_price": sbd.get("regularPrice"),
                "subscribed_at": sub_at,
                "expire_at": sbd.get("expiredAt"),
                "action": latest_action,
            }
            event_bus.emit(
                crm_id, of_user_id, event_type, payload,
                source_event_id=f"sub:{fan_id}:{sub_at}",
                occurred_at=sub_at,
            )

        try:
            subs_result = subscribers_sync.delta_sync_subscribers(
                crm_id, of_user_id,
                on_new_row=_emit_new_sub,
                max_pages=POLLER_MAX_PAGES,
                promote_to_full_on_empty=False,  # scheduled weekly job does this
            )
            if not subs_result.get('success'):
                if 'temporarily paused' in str(subs_result.get('error') or '').lower():
                    return
                saw_failure = True
        except Exception:
            traceback.print_exc()
            saw_failure = True

        # ------- 3. Transactions — delta-walk via transactions_sync, fills tx_cache -------
        # Authoritative source for monetary events. Emits new_tip / new_purchase
        # here instead of from notifications because the tx row carries the
        # precise amount, net, status, and a stable tx_id (perfect for event
        # dedup + avoids double-emission when both layers would fire).
        def _emit_new_tx(tx: dict) -> None:
            tx_type = db._classify_tx(tx) if hasattr(db, '_classify_tx') else None
            event_type = TX_TYPE_TO_EVENT.get(tx_type or '', None)
            if not event_type:
                return
            user_obj = tx.get('user') or {}
            fan_id = user_obj.get('id')
            if fan_id:
                db.upsert_fan(
                    crm_id, of_user_id, fan_id,
                    username=user_obj.get('username'),
                    display_name=user_obj.get('name'),
                    avatar=user_obj.get('avatar'),
                )
            payload = {
                "fan": {
                    "id": fan_id,
                    "username": user_obj.get('username'),
                    "display_name": user_obj.get('name'),
                    "avatar": user_obj.get('avatar'),
                },
                "amount": tx.get('amount'),
                "net": tx.get('net'),
                "currency": tx.get('currency'),
                "tx_type": tx_type,
                "status": tx.get('status'),
                "description": _strip_html(tx.get('description')),
                "created_at": tx.get('createdAt'),
            }
            event_bus.emit(
                crm_id, of_user_id, event_type, payload,
                source_event_id=f"tx:{tx.get('id')}",
                occurred_at=tx.get('createdAt'),
            )

        try:
            tx_result = transactions_sync.delta_sync_transactions(
                crm_id, of_user_id,
                on_new_row=_emit_new_tx,
                max_pages=POLLER_MAX_PAGES,
                promote_to_initial_on_empty=False,  # scheduled 24h job does this
            )
            if not tx_result.get('success'):
                if 'temporarily paused' in str(tx_result.get('error') or '').lower():
                    return
                saw_failure = True
        except Exception:
            traceback.print_exc()
            saw_failure = True

        # ------- 3. Every 10th poll: subscribers/count for expired detection -------
        if poll_index % 10 == 0:
            ok, data, _, _ = handle_of_request(
                crm_id, of_user_id,
                "/api2/v2/subscriptions/subscribers/count",
            )
            if ok and isinstance(data, dict):
                # Real field is `count`; legacy shapes had `subscribersCount` / `total`
                total = int(data.get("count") or data.get("subscribersCount") or data.get("total") or 0)
                prev = cursor.get("subscriber_count")
                if prev is not None and total < prev:
                    event_bus.emit(
                        crm_id, of_user_id, "expired_subscriber",
                        payload={"previous_total": prev, "new_total": total, "delta": total - prev},
                        source_event_id=f"subs:{datetime.utcnow().strftime('%Y%m%d%H%M')}",
                    )
                new_cursor["subscriber_count"] = total

        db.save_polling_cursor(crm_id, of_user_id, new_cursor, success=not saw_failure)

        # Auto-pause after 5 consecutive failures
        if saw_failure:
            _auto_pause_if_needed(crm_id, of_user_id)
    except Exception:
        traceback.print_exc()
        db.save_polling_cursor(crm_id, of_user_id, None, success=False)
        # Exceptions used to bypass the five-failure pause entirely, producing
        # unbounded retry storms for missing local dependencies.
        _auto_pause_if_needed(crm_id, of_user_id)


# Once an account has failed this many polls in a row, and it has a proxy, we
# actively TEST the proxy. A confirmed-dead proxy pauses the account right away
# (with an actionable reason) instead of burning more poll cycles; a reachable
# proxy is left polling until the generic safety threshold below.
PROXY_CHECK_AFTER_FAILURES = int(os.environ.get("POLL_PROXY_CHECK_AFTER", 3))
# Backstop: pause after this many consecutive failures regardless of cause, so a
# broken session (proxy fine, account broken) can't retry-storm forever.
MAX_FAILURES_BEFORE_PAUSE = int(os.environ.get("POLL_MAX_FAILURES", 5))


def _pause_polling(crm_id: str, of_user_id: str, reason: str, failures: int,
                   message: str | None = None, connection_state: str | None = None,
                   connection_code: str | None = None) -> None:
    """Stop polling this account and announce why. Fail-soft on the extras."""
    db.update_account_polling(crm_id, of_user_id, enabled=False)
    if connection_state:
        try:
            db.set_connection_error(crm_id, of_user_id, connection_state,
                                    connection_code or connection_state)
        except Exception:
            pass
    payload = {"reason": reason, "failures": failures}
    if message:
        payload["message"] = message
    try:
        event_bus.emit(
            crm_id, of_user_id, "polling_paused", payload=payload,
            source_event_id=f"pause:{datetime.utcnow().isoformat()}",
        )
    except Exception:
        logger.exception("polling_paused emit failed for %s/%s", crm_id, of_user_id)


def _auto_pause_if_needed(crm_id: str, of_user_id: str) -> None:
    """Called after a failed poll. Confirms a dead proxy before pausing on proxy
    grounds; otherwise pauses on the generic safety threshold.

    Shared by the OnlyFans and Fansly poll paths."""
    info = db.get_account_polling(crm_id, of_user_id) or {}
    failures = info.get("polling_failure_count", 0)
    if not info.get("polling_enabled") or failures < PROXY_CHECK_AFTER_FAILURES:
        return

    # Confirm whether the proxy is actually dead before blaming it.
    account = db.get_of_account(crm_id, of_user_id) or {}
    proxy = account.get("proxy")
    if proxy:
        health = proxy_health.probe(proxy)
        if health.get("alive") is False:
            logger.warning(
                "Proxy dead for %s/%s (%s) after %d failures — pausing polling.",
                crm_id, of_user_id, health.get("reason"), failures)
            _pause_polling(
                crm_id, of_user_id, reason="proxy_unreachable", failures=failures,
                message=("The saved proxy could not be reached (%s). Polling is "
                         "paused — replace the proxy, then switch polling back on."
                         % health.get("reason")),
                connection_state="proxy_error", connection_code="proxy_dead")
            return
        # Proxy is reachable → the failures are NOT the proxy. Fall through to the
        # generic backstop so a broken session still can't retry forever.

    if failures >= MAX_FAILURES_BEFORE_PAUSE:
        _pause_polling(crm_id, of_user_id, reason="consecutive failures",
                       failures=failures)


def jitter_seconds(base: int) -> int:
    """Return a slightly randomized interval around ``base`` to avoid
    synchronized bursts across accounts."""
    jitter = int(base * 0.15)
    return max(60, base + random.randint(-jitter, jitter))
