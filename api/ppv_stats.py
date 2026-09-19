"""
PPV (pay-per-view) conversion stats.

Conversion rate = (paid PPVs in period) / (PPV messages sent in period).

- **Paid PPVs**: counted from `transactions_cache` where `tx_type='message'` (fast SQL).
- **Sent PPVs**: walked from OF — for each chat we visit, we paginate through messages
  and count those (a) sent by the creator (`fromUser.id == of_user_id`), (b) with
  `price > 0`, (c) within the date range.

Because walking every chat would cost dozens of OF calls per account, we:
- Restrict to the first `max_chats` chats ordered by `recent`.
- Cap per-chat pagination at `max_messages_per_chat`.
- Cache the result for 1h keyed on `(crm_id, of_user_id, since, until, max_chats)`.

Treat the conversion rate as a **lower bound** when `max_chats` is small — sent count
won't include fans whose chats fell out of the recent window.
"""

import json
import sqlite3
import time
from datetime import datetime
from urllib.parse import quote

import crm_database as db
from of_client import handle_of_request


_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL_SEC = 3600


def _cache_get(key):
    entry = _CACHE.get(key)
    if not entry:
        return None
    expires_at, data = entry
    if expires_at < time.time():
        _CACHE.pop(key, None)
        return None
    return data


def _cache_put(key, data):
    _CACHE[key] = (time.time() + _CACHE_TTL_SEC, data)


def _count_paid_ppv(crm_id, of_user_id, since, until):
    """Return (count, revenue_sum) of paid PPVs from transactions_cache."""
    conn = sqlite3.connect(db.DB_FILE)
    try:
        conn.row_factory = sqlite3.Row
        clauses = [
            "crm_id = ?",
            "of_user_id = ?",
            "tx_type = 'message'",
        ]
        params = [crm_id, str(of_user_id)]
        if since:
            clauses.append("created_at >= ?")
            params.append(since)
        if until:
            clauses.append("created_at <= ?")
            params.append(until)
        sql = (
            "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS revenue "
            "FROM transactions_cache WHERE " + " AND ".join(clauses)
        )
        row = conn.execute(sql, params).fetchone()
        return int(row["n"] or 0), float(row["revenue"] or 0)
    finally:
        conn.close()


def _iso_to_naive(value):
    """Best-effort parse an ISO string for comparison. Returns None on failure."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00").replace("+00:00", ""))
    except Exception:
        try:
            return datetime.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")
        except Exception:
            return None


def compute(
    crm_id: str,
    of_user_id: str,
    since: str | None = None,
    until: str | None = None,
    max_chats: int = 25,
    max_messages_per_chat: int = 200,
    proxy: str | None = None,
):
    """
    Walk chats + count PPV sent + revenue. Cross-reference paid count from the DB.

    Returns dict:
      {
        period: {since, until},
        ppv_sent: int,
        ppv_paid: int,
        ppv_revenue: float,           # cached + summed from transactions_cache
        conversion_rate: float|None,  # paid / sent, or None when sent=0
        chats_sampled: int,
        max_chats: int,
        per_fan: [
          {fan_of_user_id, fan_username, sent, paid_proxy, paid_revenue_proxy},
        ],
        notes: [...]
      }

    `paid_proxy` is per-fan paid count derived from message walk (proxy because
    we read `isOpened`/`canPurchase` flags). The authoritative paid totals come
    from `transactions_cache` and are aggregated under `ppv_paid`/`ppv_revenue`.
    """
    cache_key = (crm_id, str(of_user_id), since or "", until or "", int(max_chats))
    cached = _cache_get(cache_key)
    if cached:
        cached_copy = dict(cached)
        cached_copy["cached"] = True
        return cached_copy

    since_dt = _iso_to_naive(since) if since else None
    until_dt = _iso_to_naive(until) if until else None

    paid_count, paid_revenue = _count_paid_ppv(crm_id, of_user_id, since, until)

    sent_total = 0
    per_fan = []
    notes: list[str] = []

    # 1. Pull chats list.
    chat_path = f"/api2/v2/chats?limit={min(max_chats, 50)}&offset=0&order=recent"
    ok, chats_data, _status, _relogin = handle_of_request(
        crm_id, of_user_id, chat_path, proxy=proxy
    )
    if not ok:
        notes.append(f"chats list failed: {chats_data}")
        chats_data = {"list": []}
    chats = (chats_data or {}).get("list") or []
    chats = chats[:max_chats]

    # 2. For each chat, walk messages until we step past the `since` bound or
    #    hit max_messages_per_chat.
    for chat in chats:
        with_user = chat.get("withUser") or {}
        with_user_id = with_user.get("id")
        if not with_user_id:
            continue
        fetched = 0
        offset = 0
        page_size = 100
        sent_per_fan = 0
        paid_proxy_per_fan = 0
        paid_revenue_proxy_per_fan = 0.0
        stop = False
        while fetched < max_messages_per_chat and not stop:
            this_limit = min(page_size, max_messages_per_chat - fetched)
            msg_path = (
                f"/api2/v2/chats/{quote(str(with_user_id), safe='')}"
                f"/messages?limit={this_limit}&offset={offset}&order=desc"
            )
            ok, m_data, _status, _relogin = handle_of_request(
                crm_id, of_user_id, msg_path, proxy=proxy
            )
            if not ok:
                notes.append(f"messages for fan {with_user_id} failed: {m_data}")
                break
            msgs = (m_data or {}).get("list") or []
            if not msgs:
                break
            for m in msgs:
                created = m.get("createdAt") or ""
                created_dt = _iso_to_naive(created)
                # Window-bound — stop once we drop before `since` (list is desc).
                if since_dt and created_dt and created_dt < since_dt:
                    stop = True
                    break
                if until_dt and created_dt and created_dt > until_dt:
                    continue
                from_user = m.get("fromUser") or {}
                from_user_id = from_user.get("id")
                price = m.get("price") or 0
                try:
                    price = float(price)
                except Exception:
                    price = 0.0
                # Sent by the creator at non-zero price = a PPV the creator sent.
                if str(from_user_id) == str(of_user_id) and price > 0 and not m.get("isTip"):
                    sent_per_fan += 1
                    is_paid_proxy = (m.get("canPurchase") is False) or bool(m.get("isOpened"))
                    if is_paid_proxy:
                        paid_proxy_per_fan += 1
                        paid_revenue_proxy_per_fan += price
            fetched += len(msgs)
            if not (m_data or {}).get("hasMore"):
                break
            offset += this_limit
        sent_total += sent_per_fan
        if sent_per_fan > 0:
            per_fan.append(
                {
                    "fan_of_user_id": str(with_user_id),
                    "fan_username": with_user.get("username"),
                    "sent": sent_per_fan,
                    "paid_proxy": paid_proxy_per_fan,
                    "paid_revenue_proxy": round(paid_revenue_proxy_per_fan, 2),
                }
            )

    conversion_rate = None
    if sent_total > 0:
        conversion_rate = round(paid_count / sent_total, 4)

    result = {
        "period": {"since": since, "until": until},
        "ppv_sent": sent_total,
        "ppv_paid": paid_count,
        "ppv_revenue": round(paid_revenue, 2),
        "conversion_rate": conversion_rate,
        "chats_sampled": len(chats),
        "max_chats": max_chats,
        "per_fan": per_fan,
        "notes": notes,
        "cached": False,
    }
    _cache_put(cache_key, result)
    return result


def invalidate_cache(crm_id: str | None = None):
    """Drop cached PPV stats. Pass crm_id to scope the drop, else flush everything."""
    if crm_id is None:
        _CACHE.clear()
        return
    for k in list(_CACHE.keys()):
        if k[0] == crm_id:
            _CACHE.pop(k, None)
