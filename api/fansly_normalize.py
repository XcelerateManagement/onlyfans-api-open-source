#!/usr/bin/env python3
"""Map Fansly API responses onto the OnlyFans-shaped route payloads the
dashboard already consumes, so the existing frontend works unchanged for
Fansly accounts.

Field mappings here were CONFIRMED against a live Fansly creator account
(tgirl_elli) — see the endpoint table below. Amounts are integer *tenths of a
cent* (value / 1000 == dollars, NOT cents): earningsWallet.balance 56000 ==
$56.00, a $5 subscription nets a 4000-unit credit ($4.00). See ``_cents``. We
convert to dollars to match OF's convention and keep the raw object under
``raw``. Timestamps are unix ms on wallet/message rows and unix seconds on
notifications — ``_ts_to_iso`` detects which.

Confirmed endpoints → response shapes:
  GET /account/me                    -> response.account.{username,displayName,
                                          about,avatar(media obj),banner,
                                          followCount,subscriberCount,
                                          totalSpent30,earningsWallet.balance}
  GET /account/wallets/earnings      -> response.pendingBalance
  GET /account/wallets/transactions  -> response.{total,data[]}, row=
                                          {transactionId,amount,createdAt(ms),
                                           correlationAccountId(fan),type,status,
                                           newBalance}
  GET /notifications                 -> response.{notifications[],accountMedia[]}
                                          notif={id,type,correlationId,
                                          correlationGroupId,createdAt(s),metadata}
  GET /messaging/groups              -> response.{data[],aggregationData.accounts[]}
                                          conv={groupId,partnerAccountId,
                                          partnerUsername,unreadCount,lastMessageId}
  GET /message?groupId=..            -> response.messages[], msg=
                                          {id,content,senderId,createdAt(ms),type}
"""

from datetime import datetime, timezone


def _response(envelope):
    if isinstance(envelope, dict) and 'response' in envelope and 'success' in envelope:
        return envelope.get('response')
    return envelope


def _first(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return default


def _as_list(value, *keys):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        for k in keys:
            v = value.get(k)
            if isinstance(v, list):
                return v
    return []


def _ts_to_iso(ts):
    """Fansly timestamps: unix ms on wallet/message rows, unix seconds on
    notifications. Detect by magnitude. OF uses ISO strings."""
    if ts is None:
        return None
    try:
        ts = int(ts)
    except (ValueError, TypeError):
        # Non-numeric string → already an ISO/date string; pass it through.
        # (A numeric string like "1774000000123" falls through to int() above
        # and IS converted, instead of being emitted raw.)
        return ts if isinstance(ts, str) else None
    secs = ts / 1000 if ts > 1_000_000_000_000 else ts  # >1e12 → ms
    try:
        return datetime.fromtimestamp(secs, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00')
    except (ValueError, OverflowError, OSError):
        return None


def _cents(v):
    """Fansly money integer → dollars (float, 2dp). None-safe.

    NOTE: despite the name, Fansly amounts are NOT cents — they are
    *tenths of a cent* (value / 1000 == dollars). Confirmed against a live
    creator's wallet: earningsWallet.balance 497496 == $497.50, a $5.00 sub
    lands as a 4000-unit net credit ($4.00 after the 20% fee), tier price
    5000 == $5.00. The third significant digit is Fansly's internal sub-cent
    precision, which rounds to a normal 2dp price for display
    (28792 -> $28.79, not $287.92). We keep the raw integer under ``raw``.
    """
    if v is None:
        return None
    try:
        return round(int(v) / 1000.0, 2)
    except (ValueError, TypeError):
        return None


def tip_source_event_id(tip):
    """Stable dedup key for a Fansly notification tip across harvest + poll."""
    tid = (tip or {}).get('id') if isinstance(tip, dict) else None
    return f'fansly-tip:{tid}' if tid is not None else None


def build_tip_event(tip, acct_idx=None):
    """Turn a Fansly /notifications `tips[]` row into an OF-shaped `new_tip`
    event payload. Tips are the ONLY per-fan-attributable spend source on Fansly
    (wallet transactions carry no buyer id). `amount` is the GROSS the fan paid
    (dollars). Returns (sender_id, payload) or (None, None) when there's no
    sender to attribute the spend to.
    """
    if not isinstance(tip, dict):
        return None, None
    sid = tip.get('senderId')
    if sid is None:
        return None, None
    sid = str(sid)
    acc = (acct_idx or {}).get(sid) or {}
    amt = _cents(tip.get('amount'))
    payload = {
        'fan': {
            'id': sid,
            'username': acc.get('username'),
            'display_name': _first(acc, 'displayName', 'username'),
            'avatar': _avatar_url(acc.get('avatar')),
        },
        'amount': amt,
        'net': amt,
        'currency': 'USD',
        'message': tip.get('message') or None,
        'tx_type': 'tip',
        'created_at': _ts_to_iso(tip.get('createdAt')),
        'source': 'fansly',
    }
    return sid, payload


def _signed_location(node):
    """Pull a fully-qualified, signed CDN URL out of a Fansly media node's
    `locations[]` array (each entry's `location` is an absolute
    https://cdn*.fansly.com/...?Signature=... URL). Returns None if the node
    only has a bare relative `location` path (unusable in an <img>)."""
    if not isinstance(node, dict):
        return None
    for loc in (node.get('locations') or []):
        if isinstance(loc, dict):
            url = loc.get('location')
            if isinstance(url, str) and url.startswith('http'):
                return url
    return None


def _avatar_url(avatar):
    """Fansly avatar is a media object. The only URL that actually renders is
    the SIGNED CDN url nested in `variants[].locations[].location` (the
    top-level `location` is a bare relative path with no host/signature).
    Prefer a signed variant URL; fall back to any signed location on the root;
    last resort, the bare path (better than nothing for debugging)."""
    if isinstance(avatar, str):
        return avatar
    if not isinstance(avatar, dict):
        return None
    # 1) signed URL on a variant (typically the 1080/resized one)
    for variant in (avatar.get('variants') or []):
        url = _signed_location(variant)
        if url:
            return url
    # 2) signed URL on the root media node
    url = _signed_location(avatar)
    if url:
        return url
    # 3) bare relative path (won't load in a browser, but preserves prior behavior)
    if avatar.get('location'):
        return avatar['location']
    for variant in (avatar.get('variants') or []):
        if isinstance(variant, dict) and variant.get('location'):
            return variant['location']
    return None


def normalize_account(envelope):
    """Fansly /account/me → canonical profile fields (response.account)."""
    r = _response(envelope) or {}
    acc = r.get('account') if isinstance(r, dict) and isinstance(r.get('account'), dict) else r
    if isinstance(acc, list):
        acc = acc[0] if acc else {}
    return {
        'id': str(_first(acc, 'id', 'accountId', default='')) or None,
        'username': _first(acc, 'username', 'displayName'),
        'display_name': _first(acc, 'displayName', 'username'),
        'avatar': _avatar_url(acc.get('avatar')),
        'about': acc.get('about'),
        'subscriber_count': _first(acc, 'subscriberCount'),
        'follow_count': _first(acc, 'followCount'),
        'available_balance': _cents((acc.get('earningsWallet') or {}).get('balance')),
        'raw': acc,
    }


def normalize_balances(envelope):
    """Fansly /account/me (earningsWallet) → OF /payouts/balances-shaped body."""
    r = _response(envelope) or {}
    acc = r.get('account') if isinstance(r, dict) else {}
    acc = acc or {}
    ew = acc.get('earningsWallet') or {}
    return {
        'success': True,
        'balances': {
            'currentBalance': _cents(_first(ew, 'balance', 'balance64')),
            # Alias under the OF key so OF-keyed consumers (QuickStats, earnings
            # page) read the right number without platform branching.
            'payoutAvailable': _cents(_first(ew, 'balance', 'balance64')),
            'pendingBalance': _cents(r.get('pendingBalance')),  # present only on /wallets/earnings
            'totalSpent30': _cents(acc.get('totalSpent30')),
            'currency': 'USD',
            # Subscriber enumeration is blocked on Fansly, but /account/me carries
            # the count — surface it here so the dashboard can show it without a
            # separate (OF-only) subscribers/count call.
            'subscriberCount': _first(acc, 'subscriberCount'),
            'raw': {'earningsWallet': ew, 'totalSpent30': acc.get('totalSpent30')},
        },
    }


def normalize_earnings(envelope):
    """Fansly /account/me → OF /earnings/chart-shaped body (no series available)."""
    r = _response(envelope) or {}
    acc = (r.get('account') if isinstance(r, dict) else {}) or {}
    ew = acc.get('earningsWallet') or {}
    available = _cents(_first(ew, 'balance', 'balance64'))
    return {
        'success': True,
        'earnings': {
            # Mirror the OnlyFans earnings shape so consumers that read
            # total.total / total.gross / total.chartAmount work unchanged —
            # no platform branching needed on the frontend.
            'total': {
                'total': available,
                'gross': available,
                'amount': available,     # keep the prior key for any existing reader
                'count': None,
                'chartAmount': [],
                'chartCount': [],
            },
            'available': available,
            'spent30': _cents(acc.get('totalSpent30')),
            'chartAmount': [],
            'chartCount': [],
            'series_available': False,   # Fansly exposes no earnings time-series here
            'raw': {'earningsWallet': ew},
        },
    }


# Fansly tracking-link `type` codes (confirmed live on tgirl_elli):
#   1000 — clickable tracking link (clicks populated)
#   1    — claim/promo-code style attribution source (Fansly FYP / Search /
#          Suggestions; clicks always 0, claims/follows/subscriptions real)
_FANSLY_LINK_TYPE = {1000: 'link', 1: 'claim'}


def _normalize_trackinglink(row):
    """One Fansly /trackinglinks row → OF-campaign-shaped row.

    Money: ``totalGross`` is integer CENTS; ``totalNet`` was 0 on every live
    row, so gross is THE money figure for a link. There is no public URL/code
    on the row, so ``campaignCode`` stays None (the dashboard hides its
    OF-style copy-link affordance when it's absent)."""
    if not isinstance(row, dict):
        return {'raw': row}

    def _int0(v):
        try:
            return int(v or 0)
        except (ValueError, TypeError):
            return 0

    type_code = row.get('type')
    return {
        'id': str(_first(row, 'id', default='')) or None,
        'campaignName': row.get('label') or row.get('description') or f'Tracking link {row.get("internalId")}',
        'campaignCode': None,  # Fansly exposes no shareable code on the row
        'countTransitions': _int0(row.get('clicks')),      # OF's "clicks"
        'countSubscribers': _int0(row.get('subscriptions')),
        'countClaims': _int0(row.get('claims')),
        'countFollows': _int0(row.get('follows')),
        'grossEarnings': _cents(row.get('totalGross')),
        'linkType': _FANSLY_LINK_TYPE.get(type_code, str(type_code) if type_code is not None else None),
        'status': row.get('status'),
        'description': row.get('description'),
        'createdAt': _ts_to_iso(row.get('createdAt')),
        'raw': row,
    }


def normalize_campaigns(envelope):
    """Fansly GET /trackinglinks → OF /campaigns-shaped body. The endpoint is
    unpaginated (every link comes back in one response), so hasMore is False."""
    r = _response(envelope)
    rows = r if isinstance(r, list) else _as_list(r or {}, 'data', 'list')
    campaigns = [_normalize_trackinglink(x) for x in rows if isinstance(x, dict)]
    return {'success': True, 'campaigns': campaigns, 'hasMore': False}


def normalize_campaigns_earnings(envelope):
    """Fansly GET /trackinglinks → the CampaignEarnings rows + cache meta the
    campaigns page reads from GET /campaigns/earnings.

    On OF these come from a local claimers/subs JOIN; Fansly attributes revenue
    per link server-side (totalGross, cents), so coverage is always 100% and
    the "cache" is really the live response (last_refreshed_at stays None so
    the UI never renders a stale-cache hint)."""
    r = _response(envelope)
    rows = r if isinstance(r, list) else _as_list(r or {}, 'data', 'list')
    earnings = []
    total_subs = 0
    for row in rows:
        if not isinstance(row, dict) or row.get('id') is None:
            continue
        try:
            subs = int(row.get('subscriptions') or 0)
        except (ValueError, TypeError):
            subs = 0
        total_subs += subs
        earnings.append({
            'campaign_id': str(row['id']),
            'claimers_count': subs,
            'mapped_claimers_count': subs,
            'total_spent': _cents(row.get('totalGross')) or 0.0,
            'coverage_pct': 100,
        })
    return {
        'success': True,
        'earnings': earnings,
        'cache': {
            'campaigns': len(earnings),
            'claimers': total_subs,
            'last_row_synced_at': None,
            'last_refreshed_at': None,
            'consecutive_failures': 0,
        },
        'live': True,
    }


def normalize_subscription_price(envelope):
    """Fansly /account/me subscriptionTiers → OF /subscription-price GET shape.

    Base price = the billingCycle==30 plan of the first tier (tiers all carried
    pos=0 live, so list order is the tiebreak). Tier-level ``price`` was 5000
    on EVERY tier live — only plans[].price is trustworthy. Cents → dollars."""
    r = _response(envelope) or {}
    acc = r.get('account') if isinstance(r, dict) else {}
    if isinstance(acc, list):
        acc = acc[0] if acc else {}
    acc = acc or {}

    def _pos(t):
        try:
            return int(t.get('pos') or 0)
        except (ValueError, TypeError):
            return 0

    tiers = []
    raw_tiers = [t for t in (acc.get('subscriptionTiers') or []) if isinstance(t, dict)]
    for t in sorted(raw_tiers, key=_pos):
        plans = []
        for pl in (t.get('plans') or []):
            if not isinstance(pl, dict):
                continue
            plans.append({
                'id': str(pl.get('id')) if pl.get('id') is not None else None,
                'billingCycle': pl.get('billingCycle'),  # days
                'price': _cents(pl.get('price')),
                'status': pl.get('status'),
            })
        tiers.append({
            'id': str(t.get('id')) if t.get('id') is not None else None,
            'name': t.get('name'),
            'color': t.get('color'),
            'pos': t.get('pos'),
            'plans': plans,
        })

    price = None
    if tiers and tiers[0]['plans']:
        base_plans = tiers[0]['plans']
        monthly = next((p for p in base_plans if p.get('billingCycle') == 30), None)
        if monthly is None:
            # No 30-day plan — fall back to the shortest cycle offered.
            monthly = min(base_plans,
                          key=lambda p: p.get('billingCycle') if isinstance(p.get('billingCycle'), int) else 10**9)
        price = monthly.get('price')
    price = float(price) if price is not None else 0.0

    return {
        'success': True,
        'subscribePrice': price,
        'isFree': price <= 0,
        'tiers': tiers,
        'platform': 'fansly',
    }


# Fansly /subscribers row `status` codes, observed live: page 1 of a real
# account was all 3s (current subs), the deep-offset page was 5s (lapsed).
# Anything else maps to 'unknown' until observed.
_FANSLY_SUB_STATUS = {3: 'active', 5: 'expired'}


def _normalize_subscription(sub, acc=None):
    """One Fansly /api/v1/subscribers row (+ optional hydrated account object
    from /api/v1/account?ids=) → the OF /subscribers/latest user shape that the
    subscribers page, cache upsert and exports read.

    The subscription row carries NO identity (just ``subscriberId``) — username
    / displayName / avatar come from ``acc``. Money fields are integer CENTS →
    dollars. Timestamps are unix ms → ISO."""
    if not isinstance(sub, dict):
        return {'raw': sub}
    acc = acc if isinstance(acc, dict) else {}
    fan_id = sub.get('subscriberId')
    fan_id = str(fan_id) if fan_id is not None else None
    subscribe_at = _ts_to_iso(sub.get('createdAt'))
    expired_at = _ts_to_iso(sub.get('endsAt'))
    price = _cents(sub.get('price'))
    status = _FANSLY_SUB_STATUS.get(sub.get('status'), 'unknown')
    # subscribedOnData is where crm_database.upsert_subscriber and the
    # dashboard's row normalizer look for lifecycle + pricing. Fansly has no
    # spend aggregates here (*Summ stays absent → NULL, meaning "unknown");
    # the sync backfills spend from the wallet ledger where attributable.
    sod = {
        'subscribeAt': subscribe_at,
        'expiredAt': expired_at,
        'subscribePrice': price,
        'renewedAt': _ts_to_iso(sub.get('renewDate')),
    }
    return {
        'id': fan_id,
        'username': acc.get('username'),
        'name': _first(acc, 'displayName', 'username'),
        'avatar': _avatar_url(acc.get('avatar')),
        'status': status,
        'subscribedOnData': sod,
        'subscribedOn': subscribe_at,
        'subscribedUntil': expired_at,
        'subscribePrice': price,
        'autoRenew': bool(sub.get('autoRenew')),
        'fansly': {
            'subscriptionId': str(sub.get('id')) if sub.get('id') is not None else None,
            'statusCode': sub.get('status'),
            'tierId': sub.get('subscriptionTierId'),
            'tierName': sub.get('subscriptionTierName'),
            'tierColor': sub.get('subscriptionTierColor'),
            'planId': sub.get('planId'),
            'billingCycle': sub.get('billingCycle'),
            'renewPrice': _cents(sub.get('renewPrice')),
            'renewDate': _ts_to_iso(sub.get('renewDate')),
        },
        'platform': 'fansly',
    }


def normalize_subscribers(envelope, acct_idx=None):
    """Fansly GET /api/v1/subscribers → (rows, stats).

    ``acct_idx`` — {account_id: raw account object} built from the batched
    /api/v1/account?ids= hydration call. Rows come back in the OF user shape
    (see _normalize_subscription); ``stats`` normalizes the endpoint's
    {totalActive, totalExpired, total} counters."""
    r = _response(envelope) or {}
    r = r if isinstance(r, dict) else {}
    subs = r.get('subscriptions') or []
    rows = []
    for sub in subs:
        if not isinstance(sub, dict) or sub.get('subscriberId') is None:
            continue
        acc = (acct_idx or {}).get(str(sub['subscriberId']))
        rows.append(_normalize_subscription(sub, acc))
    stats_raw = r.get('stats') or {}

    def _int0(v):
        try:
            return int(v or 0)
        except (ValueError, TypeError):
            return 0

    stats = {
        'total': _int0(stats_raw.get('total')),
        'active': _int0(stats_raw.get('totalActive')),
        'expired': _int0(stats_raw.get('totalExpired')),
    }
    return rows, stats


def normalize_payout_methods(envelope):
    """Fansly GET /payments/payoutmethods → list of method rows (no amounts —
    the endpoint only describes where money would go)."""
    r = _response(envelope)
    rows = r if isinstance(r, list) else _as_list(r or {}, 'data', 'list')
    methods = []
    for m in rows:
        if not isinstance(m, dict):
            continue
        methods.append({
            'id': str(m.get('id')) if m.get('id') is not None else None,
            'type': m.get('type'),
            'status': m.get('status'),
            'providerId': m.get('providerId'),
            'raw': m,
        })
    return methods


# Fansly wallet-transaction `type` is an integer code; OF rows carry human
# strings and a `description` that downstream consumers key off
# (_categorize_transaction, crm_database._classify_tx). Codes below were
# identified against the live tgirl_elli ledger (354 rows) by correlating
# rows with known tip events and per-fan monthly recurrence:
#   7101  — tip           (13/14 known tips matched at gross*0.8 with the fan's
#                          correlationAccountId)
#   15001 — subscription  (same fan, same amount, exactly-monthly recurrence)
#   2116  — message/PPV   (largest bucket; per-fan varying amounts, discount
#                          endings like $x.92 — paid-message unlocks)
#   2110  — post purchase (small bucket; repeated same-day content unlocks)
#   16012 — payout        (destination=1, senderId=self, no counterparty,
#                          rate 0 — money leaving the earnings wallet)
# Unknown codes fall back to a string so the UI never renders a bare int.
FANSLY_TX_TYPE = {
    2110: 'post',
    2116: 'message',
    7101: 'tip',
    15001: 'subscription',
    16012: 'payout',
}

# Wallet `status` is an integer. Observed live: 1 on rows from the last ~week
# (pending settlement window), 2 on older/settled rows — both are successful
# money movements, so both render as OF's 'done'. Unknown codes → str(code).
_FANSLY_TX_STATUS = {
    1: 'done',
    2: 'done',
}


def _tx_money(tx):
    """(gross_amount, net, fee) in dollars for a Fansly wallet row.

    CONFIRMED LIVE: the row's ``amount`` is the creator's NET wallet credit
    (a $10 tip lands as amount=800), and ``destinationTax`` is the platform
    fee RATE in fixed-point percent×100 (2000 == 20.00% on every credit row,
    0 on payouts) — NOT a cent amount. So gross = net / (1 - rate) and
    fee = gross - net, mirroring OF's amount/net/fee convention.
    """
    net = _cents(_first(tx, 'destinationAmount', 'amount'))
    if net is None:
        return None, None, None
    rate_raw = _first(tx, 'destinationTax', 'tax')
    try:
        rate = int(rate_raw) / 10000.0
    except (ValueError, TypeError):
        rate = 0.0
    if 0 < rate < 1:
        gross = round(net / (1.0 - rate), 2)
        return gross, net, round(gross - net, 2)
    return net, net, 0.0


def _normalize_tx(tx, self_account_id=None, fan_idx=None):
    """One Fansly wallet transaction → OF-purchase-ish row (+ raw).

    ``fan_idx`` — optional {fan_id: {'username','display_name'}} built from the
    harvested ``fans`` table; used to enrich ``user`` (wallet rows only carry
    correlationAccountId) and the synthetic ``description`` counterparty.
    """
    if not isinstance(tx, dict):
        return {'raw': tx}
    # The fan/counterparty. On many real rows correlationAccountId is null and
    # senderId is the CREATOR's own id (a self/ledger row) — never attribute
    # those to a fan.
    fan_id = _first(tx, 'correlationAccountId', 'senderId')
    if fan_id is not None and self_account_id is not None and str(fan_id) == str(self_account_id):
        fan_id = tx.get('receiverId')
        if fan_id is not None and str(fan_id) == str(self_account_id):
            fan_id = None
    fan_id = str(fan_id) if fan_id is not None else None
    fan = (fan_idx or {}).get(fan_id) if fan_id else None
    username = (fan or {}).get('username')
    display_name = _first(fan or {}, 'display_name', 'username')

    code = tx.get('type')
    type_label = FANSLY_TX_TYPE.get(code)
    if not type_label:
        type_label = str(code) if code is not None else 'transaction'

    # Synthetic description mirroring OF's phrasing so description-keyed
    # consumers (category donut, tx-type classifier) bucket Fansly money right.
    who = display_name or username or (f'fan {fan_id}' if fan_id else 'a fan')
    if type_label == 'tip':
        description = f'Tip from {who}'
    elif type_label == 'message':
        description = f'Payment for message from {who}'
    elif type_label == 'subscription':
        description = f'Subscription from {who}'
    elif type_label == 'post':
        description = f'Payment for post from {who}'
    elif type_label == 'payout':
        description = 'Payout (wallet withdrawal)'
    else:
        description = f'Fansly transaction (type {code})'

    status_raw = tx.get('status')
    status = _FANSLY_TX_STATUS.get(status_raw)
    if status is None:
        status = str(status_raw) if status_raw is not None else None

    gross, net, fee = _tx_money(tx)
    return {
        'id': str(_first(tx, 'transactionId', 'id', default='')) or None,
        'amount': gross,
        'net': net,
        'fee': fee,
        'currency': 'USD',
        'type': type_label,
        'status': status,
        'createdAt': _ts_to_iso(_first(tx, 'createdAt', 'created')),
        'description': description,
        'user': {
            'id': fan_id,
            'username': username,
            'name': display_name,
        },
        'raw': tx,
    }


def normalize_transactions(envelope, offset=0, limit=100, self_account_id=None,
                           fan_idx=None, marker=None):
    """Fansly /account/wallets/transactions → OF /purchases-shaped body.

    ``marker`` — the incoming OF-style cursor (translated to the wallet
    endpoint's ``before=<transactionId>``). ``nextMarker`` is only emitted when
    it actually advances past it, so clients can't loop on the same page.
    """
    try:
        offset = int(offset or 0)
    except (ValueError, TypeError):
        offset = 0
    try:
        limit = int(limit or 100)
    except (ValueError, TypeError):
        limit = 100
    r = _response(envelope) or {}
    rows = _as_list(r, 'data', 'transactions', 'list')
    total = r.get('total') if isinstance(r, dict) else None
    purchases = [_normalize_tx(t, self_account_id=self_account_id, fan_idx=fan_idx)
                 for t in rows]
    last = None
    if rows and isinstance(rows[-1], dict):
        last = _first(rows[-1], 'transactionId', 'id')
        last = str(last) if last is not None else None
    advanced = last is not None and (marker is None or str(last) != str(marker))
    if marker is not None:
        # Cursor paging: offset is meaningless here — a full page means more.
        has_more = advanced and len(rows) >= limit
    else:
        has_more = total is not None and (offset + len(rows)) < total
    next_marker = last if (advanced and has_more) else None
    return {
        'success': True,
        'purchases': purchases,
        'marker': next_marker,
        'nextMarker': next_marker,
        'hasMore': has_more,
        'count': len(purchases),
        'total': total,
    }


# Fansly notification `type` is an integer code; OF uses string labels that the
# dashboard renders via .replace(...). Only 3003 is observed live; map what we
# know and ALWAYS fall back to the string 'notification' (never an int — the UI
# calls .replace() on this and would throw on a number).
_FANSLY_NOTIF_TYPE = {
    3003: 'message',
}


def normalize_notifications(envelope, limit=None):
    """Fansly /notifications → OF /notifications-shaped body.

    Fansly's endpoint takes no ``limit`` param and returns the recent feed in
    one response, so the route's ?limit is applied here after the join
    (``limit=None`` keeps every row).

    The Fansly envelope is denormalized: `notifications[]` are skeletal rows
    (id + numeric type + correlationId) and the human-meaningful content lives
    in sibling arrays — `tips[]` (real buyer senderId + amount), `messages[]`
    (content), and top-level `accounts[]` (identity). We join them so each row
    carries a renderable `text`, `type` (string), `replacePairs` ({NAME}), and
    `isRead`, matching what the dashboard's notifications page expects.
    """
    r = _response(envelope) or {}
    rows = _as_list(r, 'notifications', 'list')

    # Indexes for the join. accounts[] is at the TOP level here (not aggregationData).
    acct_idx = {}
    for a in (r.get('accounts') or []):
        if isinstance(a, dict) and a.get('id') is not None:
            acct_idx[str(a['id'])] = a
    tips_by_id = {}
    tips_by_sender = {}
    for t in (r.get('tips') or []):
        if not isinstance(t, dict):
            continue
        if t.get('id') is not None:
            tips_by_id[str(t['id'])] = t
        if t.get('senderId') is not None:
            tips_by_sender.setdefault(str(t['senderId']), t)
    msgs_by_id = {}
    for m in (r.get('messages') or []):
        if isinstance(m, dict) and m.get('id') is not None:
            msgs_by_id[str(m['id'])] = m

    def _acct_name(acc):
        if not isinstance(acc, dict):
            return None
        return _first(acc, 'displayName', 'username')

    out = []
    for n in rows:
        if not isinstance(n, dict):
            continue
        code = n.get('type')
        type_label = _FANSLY_NOTIF_TYPE.get(code) if isinstance(code, int) else None
        if not type_label:
            type_label = str(code) if isinstance(code, str) and code else 'notification'

        corr = str(n.get('correlationId')) if n.get('correlationId') is not None else None
        text = ''
        replace_pairs = {}
        actor = None  # the account that triggered this notification

        # Join: a tip notification carries the tip via correlationId == tip id,
        # else fall back to a message with the same id.
        tip = tips_by_id.get(corr) if corr else None
        msg = msgs_by_id.get(corr) if corr else None
        if tip:
            type_label = 'tip'
            actor = acct_idx.get(str(tip.get('senderId')))
            amt = _cents(tip.get('amount'))
            text = f'tipped you ${amt:.2f}' if amt is not None else 'sent you a tip'
            note = tip.get('message')
            if note:
                text += f': {note}'
        elif msg:
            type_label = 'message'
            actor = acct_idx.get(str(msg.get('senderId')))
            content = msg.get('content')
            text = content if content else 'sent you a message'
        else:
            # Skeletal row — best-effort label from the type code.
            text = type_label.replace('_', ' ') if type_label != 'notification' else 'new notification'

        if actor:
            name = _acct_name(actor)
            if name:
                replace_pairs['{NAME}'] = name

        out.append({
            'id': str(_first(n, 'id', default='')) or None,
            'type': type_label,                # always a string
            'text': text,
            'replacePairs': replace_pairs or None,
            'correlationId': corr,
            'groupId': str(n.get('correlationGroupId')) if n.get('correlationGroupId') is not None else None,
            'createdAt': _ts_to_iso(n.get('createdAt')),
            'read': n.get('acknowledgedAt') is not None,
            'isRead': n.get('acknowledgedAt') is not None,   # frontend checks isRead
            'metadata': n.get('metadata'),
            'raw': n,
        })
    if limit is not None:
        try:
            out = out[:max(int(limit), 1)]
        except (ValueError, TypeError):
            pass
    return {'success': True, 'count': len(out), 'notifications': out}


def _account_index(agg):
    """Build {account_id: account_obj} from a response's aggregationData."""
    idx = {}
    if isinstance(agg, dict):
        for a in (agg.get('accounts') or []):
            if isinstance(a, dict) and a.get('id') is not None:
                idx[str(a['id'])] = a
    return idx


def _group_index(agg):
    """Build {group_id: group_obj} from aggregationData.groups[] — each group
    carries `lastMessage` (content/senderId/createdAt) for the chat preview."""
    idx = {}
    if isinstance(agg, dict):
        for g in (agg.get('groups') or []):
            if isinstance(g, dict) and g.get('id') is not None:
                idx[str(g['id'])] = g
    return idx


def _normalize_chat(conv, acct_idx, group_idx=None):
    """One Fansly conversation → OF chat-ish row, enriched from aggregationData."""
    if not isinstance(conv, dict):
        return {'raw': conv}
    group_id = _first(conv, 'groupId', 'id')
    partner_id = _first(conv, 'partnerAccountId', 'accountId')
    partner = acct_idx.get(str(partner_id), {}) if partner_id is not None else {}

    # Last-message preview from the matching aggregationData group.
    grp = (group_idx or {}).get(str(group_id), {}) if group_id is not None else {}
    lm = grp.get('lastMessage') if isinstance(grp, dict) else None
    last_message = None
    last_message_at = None
    if isinstance(lm, dict):
        sender = str(lm.get('senderId')) if lm.get('senderId') is not None else None
        last_message_at = _ts_to_iso(lm.get('createdAt'))
        last_message = {
            'id': str(lm.get('id')) if lm.get('id') is not None else None,
            'text': _first(lm, 'content', 'text'),
            'createdAt': last_message_at,
            'senderId': sender,
            'fromUser': {'id': sender},
        }

    return {
        'id': str(group_id) if group_id is not None else None,
        # The Fansly messages/send endpoints key on groupId, not the partner
        # account id. Surface it explicitly so the frontend routes correctly
        # (OF rows won't have this field → frontend falls back to withUser.id).
        'messageRouteId': str(group_id) if group_id is not None else None,
        'withUser': {
            'id': str(partner_id) if partner_id is not None else None,
            'username': _first(conv, 'partnerUsername', default=partner.get('username')),
            'name': _first(partner, 'displayName', 'username') or conv.get('partnerUsername'),
            'avatar': _avatar_url(partner.get('avatar')),
        },
        'lastMessageId': str(conv.get('lastMessageId')) if conv.get('lastMessageId') is not None else None,
        'lastMessage': last_message,
        'lastMessageAt': last_message_at,
        # Emit the OF-canonical key the frontend reads (unreadMessagesCount).
        'unreadCount': _first(conv, 'unreadCount', default=0),
        'unreadMessagesCount': _first(conv, 'unreadCount', 'unreadMessagesCount', default=0),
        'raw': conv,
    }


def normalize_chats(envelope, limit=None, offset=0):
    """Fansly /messaging/groups → OF /chats-shaped body.

    Fansly returns the FULL conversation list in one response, so ?limit/?offset
    pagination (which the OF endpoint honours server-side) is applied here.
    ``limit=None`` keeps the whole list (export paths need everything)."""
    r = _response(envelope) or {}
    rows = _as_list(r, 'data', 'groups', 'list')
    agg = r.get('aggregationData') if isinstance(r, dict) else None
    acct_idx = _account_index(agg)
    group_idx = _group_index(agg)
    chats = [_normalize_chat(c, acct_idx, group_idx) for c in rows]
    total = len(chats)
    try:
        offset = max(int(offset or 0), 0)
    except (ValueError, TypeError):
        offset = 0
    has_more = False
    if limit is not None:
        try:
            limit = max(int(limit), 1)
        except (ValueError, TypeError):
            limit = 20
        chats = chats[offset:offset + limit]
        has_more = offset + limit < total
    elif offset:
        chats = chats[offset:]
    return {'success': True, 'chats': chats, 'hasMore': has_more}


def _normalize_message(msg, self_account_id=None):
    """One Fansly message → OF chat-message-ish row."""
    if not isinstance(msg, dict):
        return {'raw': msg}
    sender_id = _first(msg, 'senderId', 'fromAccountId')
    attachments = []
    for a in (msg.get('attachments') or []):
        if isinstance(a, dict):
            attachments.append({
                'id': str(a.get('id')) if a.get('id') is not None else None,
                'mimetype': a.get('mimetype'),
                'filename': a.get('filename'),
                'url': _first(a, 'contentUri', 'url', 'location'),
            })
    sender = str(sender_id) if sender_id is not None else None
    return {
        'id': str(_first(msg, 'id', default='')) or None,
        'text': _first(msg, 'content', 'text'),
        'fromUserId': sender,
        # OF-canonical sender keys (chat-utils resolves fromUser.id / senderId /
        # fromUserId in that order) — emit all three so OF-keyed consumers work
        # without platform branching.
        'senderId': sender,
        'fromUser': {'id': sender},
        'isFromSelf': (str(sender_id) == str(self_account_id)) if self_account_id else None,
        'createdAt': _ts_to_iso(_first(msg, 'createdAt', 'created')),
        'attachments': attachments,
        # OF rows carry attachments under `media` — alias it so media indicators
        # render for either platform.
        'media': attachments,
        'raw': msg,
    }


def normalize_messages(envelope, self_account_id=None):
    """Fansly /message?groupId= → OF /chats/<id>/messages-shaped body."""
    r = _response(envelope) or {}
    rows = _as_list(r, 'messages', 'list')
    messages = [_normalize_message(m, self_account_id) for m in rows]
    return {'success': True, 'messages': messages, 'hasMore': False}
