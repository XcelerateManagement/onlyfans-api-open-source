#!/usr/bin/env python3
"""Background worker for the "Download your data" export feature.

`run_export(crm_id, of_user_id, job_id)` is dispatched once via
`scheduler.run_in_background(...)`. It walks the selected data types — cheap
cached SQL first, expensive live OF/Fansly walks last — writes CSV + JSON into a
temp build dir, zips it into `EXPORTS_DIR/<crm_id>/<job_id>.zip`, and reports
progress into the `export_jobs` row (the source of truth) AND over the SSE hub
(`export.progress` / `export.complete`).

Design notes:
  * The DB row is authoritative; SSE is a live nudge. A client that misses an
    event can always GET the job to recover.
  * Each phase runs in its own try/except — one failing phase (e.g. messages
    401) records a manifest warning and the rest of the export still completes.
  * `run_export` is module-level so APScheduler's SQLAlchemy jobstore can pickle
    it; only string args are passed.

This module never raises out of `run_export` — failures land in the job row.
"""

from __future__ import annotations

import csv
import html as _html
import json
import logging
import os
import re
import shutil
import time
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import config
import crm_database as db
from of_client import handle_of_request
from sse_hub import hub

logger = logging.getLogger(__name__)

PHASE_LABELS = {
    'account': 'Account profile',
    'subscribers': 'Subscribers',
    'transactions': 'Transactions',
    'fans': 'Fans',
    'earnings': 'Earnings',
    'messages': 'Messages',
    'media': 'Media files',
    'packaging': 'Packaging',
    'complete': 'Complete',
    'error': 'Error',
}


# ---------------------------------------------------------------------------
# Small utilities
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return db.iso_utc_now()


class _Canceled(Exception):
    """Raised when a running export is canceled by the user mid-walk."""


def _raise_if_canceled(job_id):
    """Cooperative cancel check — the cancel route flips the row to 'canceled';
    the worker polls this at phase/conversation boundaries and bails."""
    row = db.get_export_job_unscoped(job_id)
    if row and row.get('status') == 'canceled':
        raise _Canceled()


def _bump_calls(crm_id, counts, n=1):
    """Count one (or more) live platform API call(s): both against the per-export
    tally surfaced in the UI. This build has no usage meter to bill against."""
    counts['api_calls'] = counts.get('api_calls', 0) + n


def _safe_name(value, fallback='unknown') -> str:
    """Filesystem-safe slug for usernames / ids used in paths + archive names."""
    s = re.sub(r'[^A-Za-z0-9._-]+', '_', str(value or '')).strip('_')
    return s[:80] or fallback


def _parse_iso(value):
    """Best-effort parse of an ISO-ish timestamp to a naive datetime for
    range comparison. Returns None on failure."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00').replace('+00:00', ''))
    except Exception:
        try:
            return datetime.strptime(str(value)[:19], '%Y-%m-%dT%H:%M:%S')
        except Exception:
            return None


def _write_json(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, default=str)


def _write_csv(path, rows, fieldnames):
    """Write a list of dicts to CSV with a fixed column order. List/dict cell
    values are JSON-encoded so the CSV stays one-value-per-cell."""
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction='ignore')
        w.writeheader()
        for r in rows:
            out = {}
            for k in fieldnames:
                v = r.get(k)
                if isinstance(v, (list, dict)):
                    v = json.dumps(v, ensure_ascii=False)
                out[k] = v
            w.writerow(out)


def _of_media(raw_msg) -> list:
    """Extract a compact media list `[{type, url?}]` from a raw OF message.
    OF exposes the full-resolution URL under several shifting keys; try them in
    priority order and take the first usable one per item. `url` is omitted when
    the media isn't viewable/downloadable (the type is still recorded)."""
    out = []
    if not isinstance(raw_msg, dict):
        return out
    for item in (raw_msg.get('media') or []):
        if not isinstance(item, dict):
            continue
        url = None
        if item.get('canView') is not False:
            files = item.get('files')
            if isinstance(files, dict):
                full = files.get('full') or files.get('source')
                if isinstance(full, dict):
                    url = full.get('url')
            if not url:
                src = item.get('source')
                if isinstance(src, dict):
                    url = src.get('source')
                elif isinstance(src, str):
                    url = src
            if not url:
                for k in ('full', 'src', 'url'):
                    cand = item.get(k)
                    if isinstance(cand, str) and cand.startswith('http'):
                        url = cand
                        break
        rec = {'type': item.get('type') or 'media'}
        # Media id — the durable reference to the (PPV) content, kept alongside
        # the (often signed/expiring) url so a locked/unpurchased item is still
        # identifiable even when no viewable url is exposed.
        if item.get('id') is not None:
            rec['id'] = item.get('id')
        # Why a url may be missing. Without this a consumer cannot tell
        # "locked PPV, OF exposes no url" (can_view False — expected, nothing
        # was lost) from "viewable but we failed to find the url" (can_view
        # True and no url — a real extraction gap worth reporting).
        if item.get('canView') is not None:
            rec['can_view'] = bool(item.get('canView'))
        if isinstance(url, str) and url.startswith('http'):
            rec['url'] = url
        out.append(rec)
    return out


def _media_urls(media) -> list:
    """The downloadable URLs out of a compact media list."""
    return [m['url'] for m in (media or []) if isinstance(m, dict) and m.get('url')]


def _clean_text(s) -> str:
    """OF/Fansly message bodies come wrapped in HTML (`<p>…</p>`, `<br>`). Turn
    that into readable plain text: tags out, entities decoded, breaks kept."""
    if not s:
        return ''
    s = re.sub(r'(?i)<br\s*/?>', '\n', s)
    s = re.sub(r'(?i)</p\s*>', '\n', s)
    s = re.sub(r'(?i)<p[^>]*>', '', s)
    s = re.sub(r'<[^>]+>', '', s)
    return _html.unescape(s).strip()


def _ext_from_url(url, default='bin') -> str:
    path = url.split('?', 1)[0]
    ext = path.rsplit('.', 1)[-1] if '.' in path.rsplit('/', 1)[-1] else ''
    ext = re.sub(r'[^A-Za-z0-9]', '', ext)[:5]
    return ext or default


# ---------------------------------------------------------------------------
# Message adapter — unify OF and Fansly message rows
# ---------------------------------------------------------------------------

def _adapt_of_message(raw, of_user_id):
    from_user = raw.get('fromUser') or {}
    from_id = from_user.get('id')
    price = raw.get('price') or 0
    try:
        price = float(price)
    except Exception:
        price = 0.0
    from_self = str(from_id) == str(of_user_id)
    is_tip = bool(raw.get('isTip'))
    # For a PPV the creator SENT, was it unlocked? (canPurchase False == already
    # bought / not for sale; isOpened == viewed). Only meaningful for sent PPVs.
    purchased = None
    if from_self and price > 0 and not is_tip:
        purchased = (raw.get('canPurchase') is False) or bool(raw.get('isOpened'))
    # `isLiked` is a real, first-class field on the OF chat-message object — it
    # sits alongside canPurchase/isOpened/isTip in the same serializer (verified
    # against 48 captured api2_chat_message frames in
    # of-scripts/ws_live_dump.jsonl). It is a bare boolean: OF ships no
    # likedBy/likesCount on messages, so the flag says a like EXISTS on the
    # message, not who left it. See EXPORT-API.md for the full caveat.
    liked = raw.get('isLiked')
    liked = bool(liked) if liked is not None else None
    # Native OF quote-reply pointer. Present only when the message explicitly
    # quotes another one; absent on ordinary consecutive replies.
    reply_to = raw.get('replyToMessage')
    reply_to_id = None
    if isinstance(reply_to, dict) and reply_to.get('id') is not None:
        reply_to_id = str(reply_to['id'])
    elif isinstance(reply_to, (str, int)):
        reply_to_id = str(reply_to)
    return {
        'id': str(raw.get('id')) if raw.get('id') is not None else None,
        'from_self': from_self,
        'from_user_id': str(from_id) if from_id is not None else None,
        'created_at': raw.get('createdAt'),
        'text': _clean_text(raw.get('text')),
        'price': price,
        'is_tip': is_tip,
        'purchased': purchased,
        'is_liked': liked,
        'reply_to_message_id': reply_to_id,
        'media': _of_media(raw),
    }


def _adapt_fansly_message(norm):
    price = norm.get('price') or 0
    try:
        price = float(price)
    except Exception:
        price = 0.0
    media = [{'type': (a.get('mimetype') or 'media'), 'url': a.get('url')}
             for a in (norm.get('attachments') or [])
             if isinstance(a, dict) and isinstance(a.get('url'), str)
             and a['url'].startswith('http')]
    return {
        'id': norm.get('id'),
        'from_self': bool(norm.get('isFromSelf')),
        'from_user_id': norm.get('fromUserId'),
        'created_at': norm.get('createdAt'),
        'text': _clean_text(norm.get('text')),
        'price': price,
        'is_tip': False,
        'purchased': None,
        # Fansly's message model exposes no like/reaction on a DM (its
        # normalizer in fansly_normalize._normalize_message carries no such
        # field), so this stays None — "unknown", not "not liked".
        'is_liked': None,
        'reply_to_message_id': (str(norm['inReplyTo'])
                                if norm.get('inReplyTo') is not None else None),
        'media': media,
    }


# Reply status values. Deliberately not booleans: '' (not applicable) has to be
# distinguishable from 'no_reply' in a CSV cell.
REPLY_NA = ''                 # inbound message — "was it replied to" is not asked
REPLY_REPLIED = 'replied'
REPLY_NO_REPLY = 'no_reply'


def _derive_reply_status(ordered):
    """Annotate an oldest-first conversation with whether the fan replied.

    OnlyFans exposes no "was this replied to" field, so it is derived from the
    thread order the export already holds. The rule, stated exactly:

      An OUTBOUND message is `replied` iff the very next message in the
      conversation is INBOUND (from the fan) — i.e. the fan answered before we
      sent anything else. Otherwise it is `no_reply`. Inbound messages get ''.

    Consequences, all intentional:
      * A fan message that arrived BEFORE ours never counts — only the message
        that follows can be a reply to it.
      * In a run of consecutive outbound messages only the LAST one can be
        `replied`; the earlier ones were superseded by our own next message.
        Attributing the reply to every message of a burst would make "reply
        rate" meaningless.
      * A thread where the fan only ever messaged first → every outbound message
        is `no_reply`.

    One exception strengthens the rule: OnlyFans has a native quote-reply
    (`replyToMessage`). An inbound message that explicitly quotes one of our
    messages is proof that message was replied to, even if we sent more messages
    in between — so it also marks that target `replied`.

    Because the flag is computed over the messages INCLUDED IN THE EXPORT, a
    reply that falls outside a `since`/`until` window cannot be seen, and the
    last outbound message of a still-running conversation reads `no_reply` until
    the fan answers. Both are documented in EXPORT-API.md.

    Mutates and returns `ordered`.
    """
    # Earliest inbound quote-reply per quoted message id.
    quoted = {}
    for idx, m in enumerate(ordered):
        if m.get('from_self'):
            continue
        tgt = m.get('reply_to_message_id')
        if tgt is not None and str(tgt) not in quoted:
            quoted[str(tgt)] = idx

    n = len(ordered)
    for i, m in enumerate(ordered):
        if not m.get('from_self'):
            m['reply_status'] = REPLY_NA
            m['replied_at'] = None
            m['reply_latency_seconds'] = None
            continue

        reply_idx = None
        if i + 1 < n and not ordered[i + 1].get('from_self'):
            reply_idx = i + 1
        mid = m.get('id')
        q_idx = quoted.get(str(mid)) if mid is not None else None
        # A quote-reply only counts if it came after the message it quotes.
        if q_idx is not None and q_idx > i and (reply_idx is None or q_idx < reply_idx):
            reply_idx = q_idx

        if reply_idx is None:
            m['reply_status'] = REPLY_NO_REPLY
            m['replied_at'] = None
            m['reply_latency_seconds'] = None
            continue

        reply = ordered[reply_idx]
        m['reply_status'] = REPLY_REPLIED
        m['replied_at'] = reply.get('created_at')
        sent_dt = _parse_iso(m.get('created_at'))
        reply_dt = _parse_iso(reply.get('created_at'))
        latency = None
        if sent_dt and reply_dt:
            delta = (reply_dt - sent_dt).total_seconds()
            # Out-of-order timestamps mean the latency is not meaningful; report
            # nothing rather than a negative number the client has to special-case.
            if delta >= 0:
                latency = int(round(delta))
        m['reply_latency_seconds'] = latency
    return ordered


def _clean_message(m) -> dict:
    """Slim, human-readable record for the per-conversation JSON. Drops the ~35
    noisy raw OF fields (canBePinned, giphyId, previews, full fromUser, …) and
    omits empty/zero fields so the file stays readable."""
    rec = {
        'id': m.get('id'),
        'at': m.get('created_at'),
        'direction': 'sent' if m.get('from_self') else 'received',
    }
    if m.get('text'):
        rec['text'] = m['text']
    if m.get('price'):
        rec['price'] = m['price']
    if m.get('is_tip'):
        rec['is_tip'] = True
    if m.get('purchased') is not None:
        rec['purchased'] = m['purchased']
    # `liked` is emitted whenever the platform reports it — including False.
    # Absent means "the platform exposes no like state" (Fansly), NOT "not
    # liked"; omitting the False would collapse those two very different cases.
    if m.get('is_liked') is not None:
        rec['liked'] = m['is_liked']
    # Reply status is only meaningful on messages we sent; '' on inbound ones is
    # dropped rather than written as an empty string.
    if m.get('reply_status'):
        rec['reply_status'] = m['reply_status']
        if m.get('replied_at'):
            rec['replied_at'] = m['replied_at']
        if m.get('reply_latency_seconds') is not None:
            rec['reply_latency_seconds'] = m['reply_latency_seconds']
    if m.get('reply_to_message_id'):
        rec['reply_to_message_id'] = m['reply_to_message_id']
    if m.get('media'):
        rec['media'] = m['media']
    return rec


# ---------------------------------------------------------------------------
# Phase: account profile
# ---------------------------------------------------------------------------

_ACCOUNT_SAFE_FIELDS = ('of_user_id', 'username', 'email', 'avatar', 'about',
                        'platform', 'created_at', 'last_login')


def _export_account(account, base_dir, counts):
    safe = {k: account.get(k) for k in _ACCOUNT_SAFE_FIELDS if account.get(k) is not None}
    _write_json(os.path.join(base_dir, 'account.json'), safe)
    counts['account'] = 1 if safe else 0


# ---------------------------------------------------------------------------
# Phase: subscribers (cached, free)
# ---------------------------------------------------------------------------

_SUB_CSV_COLS = ['fan_of_user_id', 'username', 'display_name', 'subscribed_at',
                 'expired_at', 'is_active', 'subscribe_price', 'total_spent',
                 'spent_tips', 'spent_messages', 'spent_posts', 'spent_streams',
                 'spent_subscriptions', 'campaign_id']


def _export_subscribers(crm_id, of_user_id, since, until, data_dir, counts):
    rows = []
    offset = 0
    while True:
        page, total = db.list_cached_subscribers(
            crm_id, of_user_id, type_='all', limit=500, offset=offset,
            since=since, until=until)
        rows.extend(page)
        offset += len(page)
        if len(page) < 500 or offset >= total:
            break
    for r in rows:
        r.pop('raw_json', None)  # keep the export readable; raw is huge
    _write_json(os.path.join(data_dir, 'subscribers.json'), rows)
    _write_csv(os.path.join(data_dir, 'subscribers.csv'), rows, _SUB_CSV_COLS)
    counts['subscribers'] = len(rows)


# ---------------------------------------------------------------------------
# Phase: transactions (OF cached / Fansly live)
# ---------------------------------------------------------------------------

_TX_CSV_COLS = ['tx_id', 'created_at', 'tx_type', 'fan_of_user_id', 'fan_username',
                'amount', 'net', 'fee', 'vat_amount', 'currency', 'status', 'description']


def _map_fansly_tx_row(r):
    """One fansly-normalized purchase row (id/createdAt/user{...}) → the
    _TX_CSV_COLS schema (tx_id/created_at/...) shared with the cached export."""
    user = r.get('user') or {}
    return {
        'tx_id': r.get('id'),
        'created_at': r.get('createdAt'),
        'tx_type': r.get('type'),
        'fan_of_user_id': user.get('id'),
        'fan_username': user.get('username'),
        'amount': r.get('amount'),
        'net': r.get('net'),
        'fee': r.get('fee'),
        'vat_amount': None,
        'currency': r.get('currency'),
        'status': r.get('status'),
        'description': r.get('description'),
    }


def _export_transactions(crm_id, of_user_id, platform, since, until, data_dir,
                         counts, proxy, warnings):
    rows = []
    use_cache = platform != 'fansly'
    if platform == 'fansly':
        # Prefer the cached ledger once fansly_sync has populated it — exports
        # then match /transactions/cached exactly. Fall back to a live wallet
        # walk only when the cache is empty (sync never ran).
        try:
            cache_total = (db.transactions_cache_summary(crm_id, of_user_id) or {}).get('total') or 0
        except Exception:
            cache_total = 0
        use_cache = cache_total > 0

    if platform == 'fansly' and not use_cache:
        import fansly_data
        offset = 0
        wallet_total = None
        for _ in range(20):  # cap pages
            status, body = fansly_data.fetch(
                crm_id, of_user_id, 'transactions',
                {'limit': 100, 'offset': offset}, proxy=proxy)
            _bump_calls(crm_id, counts)
            if status != 200:
                warnings.append({'phase': 'transactions',
                                 'error': f'fansly transactions fetch {status}'})
                break
            # fansly_data's normalizer returns rows under 'purchases'.
            page = (body.get('purchases') or body.get('transactions')
                    or body.get('list') or [])
            if wallet_total is None:
                wallet_total = body.get('total')
            if not page:
                break
            rows.extend(_map_fansly_tx_row(r) for r in page)
            if len(page) < 100:
                break
            offset += len(page)
        # A wallet that reports rows but an export that got none is a bug, not
        # an empty account — say so instead of silently writing empty files.
        if not rows and (wallet_total or 0) > 0:
            warnings.append({
                'phase': 'transactions',
                'error': f'0 rows exported from a wallet reporting total={wallet_total}',
            })
        # Client-side date filter (Fansly ledger is offset-paged, not range-queried).
        if since or until:
            s = _parse_iso(since)
            u = _parse_iso(until)
            def _in_range(r):
                dt = _parse_iso(r.get('created_at') or r.get('createdAt'))
                if dt is None:
                    return True
                if s and dt < s:
                    return False
                if u and dt > u:
                    return False
                return True
            rows = [r for r in rows if _in_range(r)]
    else:
        offset = 0
        while True:
            page, total = db.list_transactions_cache(
                crm_id, of_user_id, since=since, until=until,
                limit=1000, offset=offset)
            rows.extend(page)
            offset += len(page)
            if len(page) < 1000 or offset >= total:
                break
        for r in rows:
            r.pop('raw_json', None)
    _write_json(os.path.join(data_dir, 'transactions.json'), rows)
    _write_csv(os.path.join(data_dir, 'transactions.csv'), rows, _TX_CSV_COLS)
    counts['transactions'] = len(rows)


# ---------------------------------------------------------------------------
# Phase: fans (cached, free)
# ---------------------------------------------------------------------------

_FAN_CSV_COLS = ['fan_of_user_id', 'username', 'display_name', 'first_seen_at',
                 'last_seen_at', 'last_event_at', 'total_tips', 'total_spend',
                 'event_count', 'tags']


def _export_fans(crm_id, of_user_id, since, until, data_dir, counts):
    rows = []
    offset = 0
    total = None
    while True:
        page, total = db.list_fans(
            crm_id, of_user_id=of_user_id, with_stats=True, since=since,
            until=until, limit=500, offset=offset, with_total=True)
        rows.extend(page)
        offset += len(page)
        if not page or offset >= (total or 0):
            break
    # tags is a list per fan; CSV joins with ';'
    csv_rows = []
    for r in rows:
        rr = dict(r)
        if isinstance(rr.get('tags'), list):
            rr['tags'] = ';'.join(rr['tags'])
        csv_rows.append(rr)
    _write_json(os.path.join(data_dir, 'fans.json'), rows)
    _write_csv(os.path.join(data_dir, 'fans.csv'), csv_rows, _FAN_CSV_COLS)
    counts['fans'] = len(rows)


# ---------------------------------------------------------------------------
# Phase: earnings (live)
# ---------------------------------------------------------------------------

def _export_earnings(crm_id, of_user_id, platform, account, since, until,
                     data_dir, counts, proxy, warnings):
    if platform == 'fansly':
        import fansly_data
        status, body = fansly_data.fetch(crm_id, of_user_id, 'earnings', {}, proxy=proxy)
        _bump_calls(crm_id, counts)
        if status != 200:
            warnings.append({'phase': 'earnings', 'error': f'fansly earnings {status}'})
            counts['earnings'] = 0
            return
        _write_json(os.path.join(data_dir, 'earnings.json'), body)
        counts['earnings'] = 1
        return

    # OnlyFans earnings chart needs an explicit start. It must NOT come from
    # of_accounts.created_at — that is when the account was connected to this CRM,
    # not how old the OF account is, so using it silently clipped "all time" to the
    # connection date (one account lost 2+ years that way). Ask OF for the real
    # joinDate and fall back to a pre-OF floor only if that lookup fails.
    start = since
    if not start:
        ok_p, prof, _st, _rl = handle_of_request(crm_id, of_user_id,
                                                "/api2/v2/users/me", proxy=proxy)
        _bump_calls(crm_id, counts)
        join = (prof or {}).get('joinDate') if ok_p else None
        if not join:
            warnings.append({'phase': 'earnings',
                             'error': 'joinDate lookup failed — falling back to '
                                      '2015-01-01 for the all-time window'})
        start = (join or '2015-01-01')[:19]
    end = until or datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    # The chart endpoint wants 'YYYY-MM-DD HH:MM:SS'.
    start = start.replace('T', ' ')
    if len(start) == 10:
        start = start + ' 00:00:00'
    if len(end) == 10:
        end = end + ' 23:59:59'
    path = (f"/api2/v2/earnings/chart?startDate={quote(start, safe='')}"
            f"&endDate={quote(end, safe='')}&withTotal=1"
            f"&filter%5Btotal_count%5D=total_count"
            f"&filter%5Btotal_amount%5D=total_amount")
    ok, data, status, _relogin = handle_of_request(crm_id, of_user_id, path, proxy=proxy)
    _bump_calls(crm_id, counts)
    if not ok:
        warnings.append({'phase': 'earnings',
                         'error': f'earnings fetch failed: {str(data)[:200]}'})
        counts['earnings'] = 0
        return
    _write_json(os.path.join(data_dir, 'earnings.json'),
                {'period': {'startDate': start, 'endDate': end}, 'earnings': data})
    counts['earnings'] = 1


# ---------------------------------------------------------------------------
# Phase: messages (live walk) — the expensive one
# ---------------------------------------------------------------------------

_MSG_CSV_COLS = ['conversation', 'fan_of_user_id', 'message_id', 'direction',
                 'created_at', 'text', 'price', 'is_tip', 'purchased',
                 'is_liked', 'reply_status', 'replied_at',
                 'reply_latency_seconds', 'reply_to_message_id', 'media_count']


def _walk_of_chats(crm_id, of_user_id, proxy, counts):
    """Yield (with_user_id, username) for every OF conversation, paginated."""
    offset = 0
    seen = 0
    page = 50  # OF caps /chats page size ~50; larger = far fewer discovery calls
    while seen < config.EXPORT_MAX_CHATS:
        path = f"/api2/v2/chats?limit={page}&offset={offset}&order=recent"
        ok, data, _status, _relogin = handle_of_request(crm_id, of_user_id, path, proxy=proxy)
        _bump_calls(crm_id, counts)
        if not ok:
            raise RuntimeError(f"chats list failed: {str(data)[:200]}")
        chats = (data or {}).get('list') or []
        if not chats:
            break
        for c in chats:
            wu = c.get('withUser') or {}
            if wu.get('id') is not None:
                yield str(wu['id']), wu.get('username')
                seen += 1
                if seen >= config.EXPORT_MAX_CHATS:
                    break
        # NOTE: OF's /chats pagination is non-standard — it IGNORES `limit` and
        # serves 10-14 conversations per call with hasMore=true throughout, and
        # `offset` counts CONVERSATIONS (offset 0/10/20 return disjoint sets).
        # So a short page is NOT the end here — only an empty page, hasMore=false,
        # or EXPORT_MAX_CHATS ends discovery — and the cursor must advance by what
        # the page actually held. Advancing by the requested `page` instead skipped
        # ~80% of every account's conversations.
        if not (data or {}).get('hasMore'):
            break
        offset += len(chats)


def _walk_of_messages(crm_id, of_user_id, with_user_id, since_dt, until_dt, proxy, counts):
    """Return adapted messages for one OF conversation within the date window."""
    out = []
    seen_ids = set()
    last_id = None
    stop = False
    while len(seen_ids) < config.EXPORT_MAX_MESSAGES_PER_CHAT and not stop:
        # OF /messages pages by an `id` CURSOR (the oldest id seen so far), not by
        # offset. It serves short pages (measured 1-16) with hasMore=true no matter
        # what `limit` says, so a short page is NOT the end of the history — and
        # offset paging either skips messages or re-serves ones already held.
        # Cursor + hasMore is the only walk that is both exact and terminating.
        path = (f"/api2/v2/chats/{quote(str(with_user_id), safe='')}"
                f"/messages?limit=100&order=desc")
        if last_id is not None:
            path += f"&id={quote(str(last_id), safe='')}"
        ok, data, _status, _relogin = handle_of_request(crm_id, of_user_id, path, proxy=proxy)
        _bump_calls(crm_id, counts)
        if not ok:
            raise RuntimeError(f"messages failed for {with_user_id}: {str(data)[:160]}")
        msgs = (data or {}).get('list') or []
        if not msgs:
            break
        fresh = 0
        for m in msgs:
            mid = m.get('id')
            if mid in seen_ids:
                continue  # pages can overlap at the cursor boundary
            seen_ids.add(mid)
            fresh += 1
            created = _parse_iso(m.get('createdAt'))
            if since_dt and created and created < since_dt:
                stop = True  # desc order: everything past here is older
                break
            if until_dt and created and created > until_dt:
                continue
            out.append(_adapt_of_message(m, of_user_id))
        last_id = msgs[-1].get('id')  # desc order → last item is the oldest
        # A page holding nothing new means the cursor stopped advancing; bail
        # rather than re-request the same tail forever.
        if fresh == 0 or not (data or {}).get('hasMore'):
            break
    return out


def _walk_fansly_messages(crm_id, of_user_id, group_id, since_dt, until_dt, proxy, counts):
    import fansly_data
    out = []
    fetched = 0
    offset = 0
    while fetched < config.EXPORT_MAX_MESSAGES_PER_CHAT:
        limit = min(50, config.EXPORT_MAX_MESSAGES_PER_CHAT - fetched)
        status, body = fansly_data.fetch(
            crm_id, of_user_id, 'messages',
            {'groupId': group_id, 'limit': limit, 'offset': offset}, proxy=proxy)
        _bump_calls(crm_id, counts)
        if status != 200:
            raise RuntimeError(f"fansly messages failed for {group_id}: {status}")
        msgs = body.get('messages') or []
        if not msgs:
            break
        for m in msgs:
            a = _adapt_fansly_message(m)
            created = _parse_iso(a.get('created_at'))
            if since_dt and created and created < since_dt:
                continue
            if until_dt and created and created > until_dt:
                continue
            out.append(a)
        fetched += len(msgs)
        if len(msgs) < limit:
            break
        offset += limit
    return out


def _export_messages(crm_id, of_user_id, platform, since, until, msg_dir, counts,
                     proxy, warnings, collect_media, emit, phase_index, base_dir, job_id):
    os.makedirs(msg_dir, exist_ok=True)
    since_dt = _parse_iso(since) if since else None
    until_dt = _parse_iso(until) if until else None
    # Hard wall-clock budget: OF reports hasMore=true even on empty pages and
    # spam accounts carry thousands of junk chats, so the walk must be bounded.
    deadline = time.monotonic() + config.EXPORT_MAX_RUNTIME_SECONDS

    # Discovery: find the conversations to walk (itself costs API calls).
    counts['messages'] = {'chats_done': 0, 'chats_total': 0, 'messages': 0,
                          'discovering': True}
    emit(phase='messages', phase_index=phase_index)
    conversations = []  # (route_id, fan_id, username)
    if platform == 'fansly':
        import fansly_data
        status, body = fansly_data.fetch(crm_id, of_user_id, 'chats', {}, proxy=proxy)
        _bump_calls(crm_id, counts)
        if status != 200:
            raise RuntimeError(f"fansly chats list failed: {status}")
        for c in (body.get('chats') or [])[:config.EXPORT_MAX_CHATS]:
            wu = c.get('withUser') or {}
            route_id = c.get('messageRouteId') or c.get('id')
            if route_id is not None:
                conversations.append((str(route_id), wu.get('id'), wu.get('username')))
    else:
        for fan_id, username in _walk_of_chats(crm_id, of_user_id, proxy, counts):
            conversations.append((fan_id, fan_id, username))
            # Surface discovery progress so a long chat-list walk doesn't look
            # frozen at "0/0 discovering" (which reads as a hang).
            if len(conversations) % 100 == 0:
                counts['messages'] = {'chats_done': 0, 'chats_total': 0,
                                      'discovered': len(conversations), 'discovering': True}
                emit(phase='messages', phase_index=phase_index)
            if time.monotonic() > deadline:
                warnings.append({'phase': 'messages',
                                 'error': f'discovery hit the {config.EXPORT_MAX_RUNTIME_SECONDS}s '
                                          f'time budget — walking the {len(conversations)} '
                                          'conversations found so far'})
                break

    chats_total = len(conversations)
    counts['messages'] = {'chats_done': 0, 'chats_total': chats_total, 'messages': 0}

    flat_rows = []
    index = []
    media_manifest = []
    total_msgs = 0

    for i, (route_id, fan_id, username) in enumerate(conversations):
        _raise_if_canceled(job_id)
        if time.monotonic() > deadline:
            warnings.append({'phase': 'messages',
                             'error': f'message walk stopped at the '
                                      f'{config.EXPORT_MAX_RUNTIME_SECONDS}s time budget after '
                                      f'{i}/{chats_total} conversations'})
            break
        try:
            if platform == 'fansly':
                msgs = _walk_fansly_messages(crm_id, of_user_id, route_id,
                                             since_dt, until_dt, proxy, counts)
            else:
                msgs = _walk_of_messages(crm_id, of_user_id, route_id,
                                         since_dt, until_dt, proxy, counts)
        except _Canceled:
            raise
        except Exception as e:
            warnings.append({'phase': 'messages',
                             'error': f'conversation {username or fan_id}: {str(e)[:160]}'})
            msgs = []

        convo_name = _safe_name(username or fan_id, fallback=str(fan_id or i))
        # Oldest-first for natural reading. OF returns desc; Fansly already asc.
        ordered = list(reversed(msgs)) if platform != 'fansly' else msgs
        # Reply status is derived from this exact sequence, so a reader can
        # verify any 'replied' flag by looking at the next row of the same file.
        _derive_reply_status(ordered)
        _write_json(os.path.join(msg_dir, f'{convo_name}.json'), {
            'conversation_with': {'fan_of_user_id': fan_id, 'username': username},
            'message_count': len(ordered),
            'messages': [_clean_message(m) for m in ordered],
        })

        convo_media = 0
        for m in ordered:
            urls = _media_urls(m.get('media'))
            mc = len(m.get('media') or [])
            convo_media += mc
            flat_rows.append({
                'conversation': username or fan_id,
                'fan_of_user_id': fan_id,
                # Needed to join a CSV row to messages/<convo>.json and to
                # resolve reply_to_message_id — without it the reply columns
                # cannot be cross-referenced.
                'message_id': m.get('id') or '',
                'direction': 'sent' if m.get('from_self') else 'received',
                'created_at': m['created_at'],
                'text': m['text'],
                'price': m['price'] or '',
                'is_tip': m['is_tip'],
                'purchased': '' if m.get('purchased') is None else m['purchased'],
                # Blank = platform exposes no like state (Fansly), not "unliked".
                'is_liked': '' if m.get('is_liked') is None else m['is_liked'],
                'reply_status': m.get('reply_status') or '',
                'replied_at': m.get('replied_at') or '',
                'reply_latency_seconds': ('' if m.get('reply_latency_seconds') is None
                                          else m['reply_latency_seconds']),
                'reply_to_message_id': m.get('reply_to_message_id') or '',
                'media_count': mc,
            })
            if collect_media and urls:
                media_manifest.append({
                    'conversation': convo_name,
                    'msg_id': m['id'],
                    'urls': urls,
                })
        total_msgs += len(ordered)
        sent = [m for m in ordered if m.get('from_self')]
        index.append({
            'conversation': username or str(fan_id),
            'fan_of_user_id': fan_id,
            'file': f'{convo_name}.json',
            'message_count': len(ordered),
            'media_count': convo_media,
            # Per-conversation roll-up of the two derived signals, so the client
            # gets reply rate / like counts without re-walking every file.
            'sent_count': len(sent),
            'received_count': len(ordered) - len(sent),
            'liked_count': sum(1 for m in ordered if m.get('is_liked')),
            'replied_count': sum(1 for m in sent
                                 if m.get('reply_status') == REPLY_REPLIED),
        })

        counts['messages'] = {'chats_done': i + 1, 'chats_total': chats_total,
                              'messages': total_msgs}
        if (i + 1) % 5 == 0 or (i + 1) == chats_total:
            emit(phase='messages', phase_index=phase_index)

    _write_csv(os.path.join(msg_dir, 'messages.csv'), flat_rows, _MSG_CSV_COLS)
    _write_json(os.path.join(msg_dir, 'index.json'), index)
    if collect_media and media_manifest:
        _write_json(os.path.join(base_dir, '_media_manifest.json'), media_manifest)


# ---------------------------------------------------------------------------
# Phase: media download (optional, OnlyFans only in v1)
# ---------------------------------------------------------------------------

def _download_media(crm_id, of_user_id, platform, media_dir, counts, proxy,
                    warnings, emit, phase_index, base_dir):
    manifest_path = os.path.join(base_dir, '_media_manifest.json')
    if not os.path.exists(manifest_path):
        counts['media'] = {'downloaded': 0, 'failed': 0, 'bytes': 0}
        return
    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    if platform == 'fansly':
        warnings.append({'phase': 'media',
                         'error': 'media export not yet supported for Fansly — '
                                  'message attachment URLs are listed in the message JSON'})
        counts['media'] = {'downloaded': 0, 'failed': 0, 'bytes': 0, 'skipped': True}
        return

    import multi_tenant_auth
    session_data = multi_tenant_auth.load_session(crm_id, of_user_id, proxy=proxy)
    if not session_data or not session_data.get('session'):
        warnings.append({'phase': 'media', 'error': 'no active session for media download'})
        counts['media'] = {'downloaded': 0, 'failed': 0, 'bytes': 0}
        return
    sess = session_data['session']

    os.makedirs(media_dir, exist_ok=True)
    downloaded = failed = total_bytes = 0
    done = 0
    for entry in manifest:
        if downloaded >= config.EXPORT_MAX_MEDIA_FILES or total_bytes >= config.EXPORT_MAX_MEDIA_BYTES:
            warnings.append({'phase': 'media', 'error': 'media cap reached — download truncated'})
            break
        convo = _safe_name(entry.get('conversation'), 'convo')
        convo_dir = os.path.join(media_dir, convo)
        os.makedirs(convo_dir, exist_ok=True)
        for n, url in enumerate(entry.get('urls') or []):
            done += 1
            try:
                resp = sess.get(url, timeout=60)
                if resp.status_code != 200 or not resp.content:
                    failed += 1
                    continue
                ext = _ext_from_url(url)
                fname = f"{_safe_name(entry.get('msg_id'), 'msg')}-{n}.{ext}"
                with open(os.path.join(convo_dir, fname), 'wb') as out:
                    out.write(resp.content)
                downloaded += 1
                total_bytes += len(resp.content)
            except Exception:
                failed += 1
            if done % 25 == 0:
                counts['media'] = {'downloaded': downloaded, 'failed': failed, 'bytes': total_bytes}
                emit(phase='media', phase_index=phase_index)
    counts['media'] = {'downloaded': downloaded, 'failed': failed, 'bytes': total_bytes}


# ---------------------------------------------------------------------------
# Packaging
# ---------------------------------------------------------------------------

def _write_manifest_and_readme(base_dir, job, account, platform, counts, warnings):
    generated_at = _now_iso()
    manifest = {
        'job_id': job['job_id'],
        'generated_at': generated_at,
        'account': {
            'of_user_id': job['of_user_id'],
            'username': account.get('username'),
            'platform': platform,
        },
        'range': {'since': job.get('since'), 'until': job.get('until')},
        'data_types': job.get('data_types'),
        'include_media': job.get('include_media'),
        'counts': counts,
        'warnings': warnings,
        'retention_days': config.EXPORT_RETENTION_DAYS,
    }
    _write_json(os.path.join(base_dir, 'manifest.json'), manifest)

    rng = 'all time'
    if job.get('since') or job.get('until'):
        rng = f"{job.get('since') or 'beginning'} → {job.get('until') or 'now'}"
    lines = [
        "DATA EXPORT",
        "===========",
        "",
        f"Account   : {account.get('username') or job['of_user_id']} ({platform})",
        f"Range     : {rng}",
        f"Created   : {generated_at}",
        f"API calls : {counts.get('api_calls', 0)} live platform request(s)",
        "",
        "Contents:",
        "  account.json            - your account profile",
        "  data/*.csv, data/*.json - subscribers, transactions, fans, earnings",
        "  messages/               - one JSON per conversation + messages.csv + index.json",
        "  media/                  - downloaded images/videos (if requested)",
        "  manifest.json           - machine-readable summary of this export",
        "",
        f"This archive is downloadable for {config.EXPORT_RETENTION_DAYS} days, then auto-deleted.",
    ]
    if warnings:
        lines += ["", "Notes / partial sections:"]
        lines += [f"  - {w.get('phase')}: {w.get('error')}" for w in warnings]
    with open(os.path.join(base_dir, 'README.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def _zip_build(base_dir, crm_id, of_user_id, job_id, account, since, until):
    out_dir = os.path.join(config.EXPORTS_DIR, _safe_name(crm_id, 'crm'))
    os.makedirs(out_dir, exist_ok=True)
    try:
        os.chmod(out_dir, 0o700)
    except OSError:
        pass

    uname = _safe_name(account.get('username') or of_user_id)
    s = (since or 'all')[:10]
    u = (until or 'now')[:10]
    folder = f"of-export-{uname}-{s}_{u}"
    file_name = f"{folder}.zip"
    zip_path = os.path.join(out_dir, f"{job_id}.zip")

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(base_dir):
            for fn in files:
                if fn.startswith('_') or fn.startswith('.'):
                    continue  # skip build sidecars (e.g. _media_manifest.json)
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, base_dir)
                zf.write(full, os.path.join(folder, rel))
    size = os.path.getsize(zip_path)
    return zip_path, file_name, size


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def run_export(crm_id, of_user_id, job_id):
    """Run a queued export to completion. Picklable; dispatched once via
    scheduler.run_in_background. Never raises — failures land in the job row."""
    of_user_id = str(of_user_id)
    job = db.get_export_job_unscoped(job_id)
    if not job:
        logger.warning("export %s: job row missing", job_id)
        return
    if job.get('status') != 'queued':
        logger.warning("export %s: not queued (status=%s) — skipping", job_id, job.get('status'))
        return

    data_types = job.get('data_types') or []
    include_media = job.get('include_media')
    since, until = job.get('since'), job.get('until')

    account = db.get_of_account(crm_id, of_user_id) or {}
    platform = account.get('platform') or job.get('platform') or 'onlyfans'
    proxy = account.get('proxy')

    counts: dict = {'api_calls': 0}
    warnings: list = []

    phases = [p for p in config.EXPORT_DATA_TYPES if p in data_types]
    run_media = bool(include_media and 'messages' in phases)
    plan = phases + (['media'] if run_media else []) + ['packaging']
    phase_total = len(plan)

    def emit(status='running', phase=None, phase_index=None, event='export.progress', **extra):
        try:
            db.update_export_job(job_id, status=status, phase=phase, counts=counts)
        except Exception:
            logger.exception("export %s: db progress write failed", job_id)
        payload = {
            'job_id': job_id,
            'of_user_id': of_user_id,
            'status': status,
            'phase': phase,
            'phase_label': PHASE_LABELS.get(phase, phase),
            'phase_index': phase_index,
            'phase_total': phase_total,
            'counts': counts,
            'updated_at': _now_iso(),
        }
        payload.update(extra)
        try:
            hub.broadcast(crm_id, {'event_type': event, 'payload': payload})
        except Exception:
            pass

    base_dir = os.path.join(config.EXPORTS_DIR, 'build', _safe_name(job_id, 'job'))
    data_dir = os.path.join(base_dir, 'data')
    msg_dir = os.path.join(base_dir, 'messages')
    media_dir = os.path.join(base_dir, 'media')

    try:
        db.update_export_job(job_id, status='running', started_at=_now_iso())
        os.makedirs(data_dir, exist_ok=True)

        idx = 0
        for phase in phases:
            _raise_if_canceled(job_id)
            idx += 1
            emit(phase=phase, phase_index=idx)
            try:
                if phase == 'account':
                    _export_account(account, base_dir, counts)
                elif phase == 'subscribers':
                    _export_subscribers(crm_id, of_user_id, since, until, data_dir, counts)
                elif phase == 'transactions':
                    _export_transactions(crm_id, of_user_id, platform, since, until,
                                         data_dir, counts, proxy, warnings)
                elif phase == 'fans':
                    _export_fans(crm_id, of_user_id, since, until, data_dir, counts)
                elif phase == 'earnings':
                    _export_earnings(crm_id, of_user_id, platform, account, since, until,
                                     data_dir, counts, proxy, warnings)
                elif phase == 'messages':
                    _export_messages(crm_id, of_user_id, platform, since, until, msg_dir,
                                     counts, proxy, warnings, collect_media=run_media,
                                     emit=emit, phase_index=idx, base_dir=base_dir, job_id=job_id)
            except _Canceled:
                raise
            except Exception as e:
                logger.exception("export %s: phase %s failed", job_id, phase)
                warnings.append({'phase': phase, 'error': str(e)[:300]})
            db.update_export_job(job_id, counts=counts, warnings=warnings)

        if run_media:
            _raise_if_canceled(job_id)
            idx += 1
            emit(phase='media', phase_index=idx)
            try:
                _download_media(crm_id, of_user_id, platform, media_dir, counts,
                                proxy, warnings, emit, idx, base_dir)
            except _Canceled:
                raise
            except Exception as e:
                logger.exception("export %s: media phase failed", job_id)
                warnings.append({'phase': 'media', 'error': str(e)[:300]})
            db.update_export_job(job_id, counts=counts, warnings=warnings)

        # Packaging
        _raise_if_canceled(job_id)
        idx += 1
        emit(phase='packaging', phase_index=idx)
        _write_manifest_and_readme(base_dir, job, account, platform, counts, warnings)
        zip_path, file_name, size = _zip_build(
            base_dir, crm_id, of_user_id, job_id, account, since, until)

        expires_at = (datetime.now(timezone.utc) +
                      timedelta(days=config.EXPORT_RETENTION_DAYS)
                      ).strftime('%Y-%m-%dT%H:%M:%S+00:00')
        db.update_export_job(
            job_id, status='complete', phase='complete', counts=counts,
            warnings=warnings, file_path=zip_path, file_name=file_name,
            file_size=size, completed_at=_now_iso(), expires_at=expires_at,
            # Clear any stale error (e.g. a startup-reconcile 'interrupted by
            # server restart' blip on a long-running job that then finished fine).
            error=None)
        emit(status='complete', phase='complete', phase_index=phase_total,
             event='export.complete', file_size=size, expires_at=expires_at,
             warnings=warnings)
        logger.info("export %s complete (%s bytes, %s)", job_id, size, counts)
    except _Canceled:
        logger.info("export %s canceled by user", job_id)
        db.update_export_job(job_id, status='canceled', phase='canceled',
                             counts=counts, warnings=warnings, completed_at=_now_iso())
        emit(status='canceled', phase='canceled', event='export.complete')
    except Exception as e:
        logger.exception("export %s failed", job_id)
        db.update_export_job(job_id, status='failed', error=str(e)[:500],
                             completed_at=_now_iso(), counts=counts, warnings=warnings)
        emit(status='failed', phase='error', event='export.complete', error=str(e)[:500])
    finally:
        if os.path.isdir(base_dir):
            shutil.rmtree(base_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Maintenance (called from the scheduler)
# ---------------------------------------------------------------------------

def cleanup_expired():
    """Delete ZIPs whose retention window has passed and sweep orphan build
    dirs. Registered as a periodic scheduler job."""
    swept = 0
    try:
        for job in db.list_expired_exports(_now_iso()):
            fp = job.get('file_path')
            try:
                if fp and os.path.exists(fp):
                    os.remove(fp)
            except OSError:
                pass
            db.update_export_job(job['job_id'], status='expired', file_path=None)
            swept += 1
    except Exception:
        logger.exception("export cleanup_expired failed")
    # Orphan build dirs (interrupted runs) — remove any not tied to an active job.
    build_root = os.path.join(config.EXPORTS_DIR, 'build')
    try:
        if os.path.isdir(build_root):
            for name in os.listdir(build_root):
                job = db.get_export_job_unscoped(name)
                if not job or job.get('status') not in ('queued', 'running'):
                    shutil.rmtree(os.path.join(build_root, name), ignore_errors=True)
    except Exception:
        logger.exception("export build-dir sweep failed")
    if swept:
        logger.info("export cleanup: swept %s expired archive(s)", swept)
    return swept


def reconcile_stale_exports():
    """Fail any export left queued/running before this process started — its
    one-shot scheduler job was lost on restart. Call once at startup."""
    boot = _now_iso()
    failed = 0
    try:
        for job in db.list_stale_running_exports(boot):
            db.update_export_job(job['job_id'], status='failed',
                                 error='interrupted by server restart',
                                 completed_at=_now_iso())
            failed += 1
    except Exception:
        logger.exception("reconcile_stale_exports failed")
    if failed:
        logger.info("export reconcile: failed %s stale job(s)", failed)
    return failed
