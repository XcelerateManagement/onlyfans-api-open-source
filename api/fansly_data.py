#!/usr/bin/env python3
"""Fansly data-fetch orchestration.

One entry point — ``fetch(crm_id, account_id, feature, params, proxy)`` — that:
  1. checks the capability matrix (returns a clean 501 for unsupported features),
  2. builds the Fansly ``/api/v1`` path for the feature,
  3. calls ``fansly_client.handle_fansly_request`` (auth + auto-relogin),
  4. normalizes the response into the OF-shaped body the route returns.

Keeps the Flask routes in ``crm_api.py`` thin: each data route adds a small
"if platform == fansly: return fansly_data.fetch(...)" guard and otherwise runs
its existing OnlyFans logic untouched.
"""

from urllib.parse import urlencode

import platform_features as pf
import fansly_client
import fansly_normalize as fnorm


def _q(params):
    """Build a query string from non-None params (stable ordering)."""
    clean = {k: v for k, v in params.items() if v is not None and v != ''}
    return ('?' + urlencode(clean)) if clean else ''


def _int(v, default=0):
    """Coerce a request param (str/int/None) to int. Never raises."""
    try:
        return int(v)
    except (ValueError, TypeError):
        return default


def _path_for(feature, p):
    """Return (method, path, body) for a feature. ``p`` is the request params
    dict. Paths include the /api/v1 prefix (the client-check hashes the full
    pathname). Returns None for features with no direct fetch path."""
    # All paths + shapes below were confirmed against a live account.
    if feature == 'profile':
        return 'GET', '/api/v1/account/me', None

    if feature in ('balances', 'earnings'):
        # /account/me carries the creator's earningsWallet (available balance),
        # totalSpent30, and counts — richer than /account/wallets/earnings
        # (which only returns pendingBalance).
        return 'GET', '/api/v1/account/me', None

    if feature == 'transactions':
        # OF-style `marker` translates to the wallet endpoint's
        # `before=<transactionId>` cursor (snowflake ids, confirmed live) so
        # marker paging actually advances; offset stays as the fallback.
        marker = p.get('marker') or None
        qs = _q({
            'limit': _int(p.get('limit', 100), 100),
            'offset': _int(p.get('offset', 0), 0) if not marker else None,
            'before': marker,
        })
        return 'GET', f'/api/v1/account/wallets/transactions{qs}', None

    if feature == 'notifications':
        return 'GET', '/api/v1/notifications', None

    if feature == 'campaigns':
        # Unpaginated — one call returns every tracking link with clicks /
        # follows / subscriptions / totalGross (cents). Confirmed live.
        return 'GET', '/api/v1/trackinglinks', None

    if feature == 'subscription_price':
        # Tiers + plans ride on the same /account/me the profile seam uses.
        return 'GET', '/api/v1/account/me', None

    if feature == 'chats':
        # Conversation list. Pagination handled client-side from the full list.
        return 'GET', '/api/v1/messaging/groups', None

    if feature == 'messages':
        qs = _q({
            'groupId': p.get('with_user_id') or p.get('groupId'),
            'before': p.get('before', 0),
            'after': p.get('after', 0),
            'limit': p.get('limit', 50),
            'offset': p.get('offset', 0),
        })
        return 'GET', f'/api/v1/message{qs}', None

    if feature == 'send_message':
        body = {
            'groupId': p.get('with_user_id') or p.get('groupId'),
            'content': p.get('text', ''),
        }
        if p.get('price'):
            # UNIT: callers pass DOLLARS (the OF convention used everywhere in
            # this API); Fansly amounts are integer *tenths of a cent*
            # (value/1000 == dollars — the inverse of ``_cents``; 56000 ==
            # $56.00). Forwarding raw dollars would create a 1000× underpriced
            # PPV (price:5 → $0.005).
            body['price'] = int(round(float(p['price']) * 1000))
        reply_to = p.get('reply_to_id') or p.get('inReplyTo')
        if reply_to:
            # Raw Fansly messages carry `inReplyTo` (confirmed in live message
            # keys) — pass it through so replies aren't silently dropped.
            body['inReplyTo'] = str(reply_to)
        return 'POST', '/api/v1/message', body

    return None


def _normalize(feature, data, p):
    """Dispatch the raw Fansly envelope to the matching normalizer."""
    if feature == 'profile':
        return {'success': True, 'profile': fnorm.normalize_account(data)}
    if feature == 'balances':
        return fnorm.normalize_balances(data)
    if feature == 'earnings':
        return fnorm.normalize_earnings(data)
    if feature == 'transactions':
        return fnorm.normalize_transactions(data,
                                            offset=_int(p.get('offset', 0), 0),
                                            limit=_int(p.get('limit', 100), 100),
                                            self_account_id=p.get('self_account_id'),
                                            fan_idx=p.get('_fan_idx'),
                                            marker=p.get('marker') or None)
    if feature == 'notifications':
        # Fansly's endpoint has no limit param — apply the route's ?limit
        # post-join (None → keep everything, e.g. poller/harvest callers).
        raw_limit = p.get('limit')
        return fnorm.normalize_notifications(
            data, limit=_int(raw_limit, 20) if raw_limit is not None else None)
    if feature == 'chats':
        # Full list comes back in one response — paginate here so ?limit/?offset
        # behave like the OF endpoint. None → unsliced (export paths).
        raw_limit = p.get('limit')
        return fnorm.normalize_chats(
            data,
            limit=_int(raw_limit, 20) if raw_limit is not None else None,
            offset=_int(p.get('offset', 0), 0))
    if feature == 'campaigns':
        return fnorm.normalize_campaigns(data)
    if feature == 'subscription_price':
        return fnorm.normalize_subscription_price(data)
    if feature == 'messages':
        return fnorm.normalize_messages(data, self_account_id=p.get('self_account_id'))
    if feature == 'send_message':
        # Echo the created message id where present; UI just needs success.
        resp = data.get('response') if isinstance(data, dict) else None
        mid = (resp or {}).get('id') if isinstance(resp, dict) else None
        return {'success': True, 'message_id': str(mid) if mid is not None else None}
    return {'success': True, 'data': data}


def fetch(crm_id, account_id, feature, params=None, proxy=None):
    """Fetch a feature's data for a Fansly account.

    Returns (status_code, body_dict) ready for ``jsonify``. Unsupported features
    return the canonical 501 body from the capability matrix.
    """
    params = params or {}
    # Make the creator's own account id available to normalizers that must
    # distinguish self/ledger rows from real counterparties (transactions,
    # messages). Don't clobber an explicit caller value.
    params.setdefault('self_account_id', str(account_id))

    if not pf.supports(pf.PLATFORM_FANSLY, feature):
        body, code = pf.unsupported_response(feature, pf.PLATFORM_FANSLY)
        return code, body

    spec = _path_for(feature, params)
    if spec is None:
        body, code = pf.unsupported_response(feature, pf.PLATFORM_FANSLY)
        return code, body

    # Wallet rows carry no buyer identity beyond correlationAccountId — enrich
    # username/display_name from the harvested fans table for the normalizer.
    if feature == 'transactions' and '_fan_idx' not in params:
        try:
            import crm_database as db
            params['_fan_idx'] = db.fans_username_index(crm_id, account_id)
        except Exception:
            params['_fan_idx'] = None

    method, path, req_body = spec
    ok, data, status, relogin = fansly_client.handle_fansly_request(
        crm_id, account_id, path, method=method, body=req_body, proxy=proxy
    )

    if not ok:
        err = data if isinstance(data, dict) else {'error': str(data)[:300]}
        err.setdefault('success', False)
        err.setdefault('error', 'Fansly request failed')
        return (status or 502), err

    body = _normalize(feature, data, params)
    if feature == 'earnings':
        # Fansly exposes no earnings time-series; build the daily chart from
        # the cached wallet ledger (fansly_sync) for the requested range.
        try:
            _attach_earnings_series(crm_id, account_id, body,
                                    params.get('startDate'), params.get('endDate'))
        except Exception:
            pass
    if relogin:
        body['relogin'] = True
    return 200, body


def fetch_fan_profile(crm_id, account_id, fan_id, proxy=None):
    """GET /api/v1/account?ids=<fan_id> → (status, body) for the fan drawer's
    force-refresh. Fansly has no ``subscribedOnData`` (spend comes from the
    cached wallet ledger), so this refreshes identity only — username /
    display name / freshly-signed avatar — and upserts the ``fans`` row.
    Body mirrors the OF route's shape ({success, fan, updated_cache})."""
    ok, data, status, relogin = fansly_client.handle_fansly_request(
        crm_id, account_id, '/api/v1/account' + _q({'ids': fan_id}),
        method='GET', proxy=proxy)
    if not ok:
        err = data if isinstance(data, dict) else {'error': str(data)[:300]}
        err.setdefault('success', False)
        err.setdefault('error', 'Fansly request failed')
        return (status or 502), err

    prof = fnorm.normalize_account(data)
    if not prof.get('id'):
        return 404, {'success': False, 'error': f'Fansly account {fan_id} not found'}
    # Keep the fans row fresh (identity only — spend lives in transactions_cache).
    try:
        import crm_database as db
        db.upsert_fan(crm_id, account_id, prof['id'],
                      username=prof.get('username'),
                      display_name=prof.get('display_name'),
                      avatar=prof.get('avatar'))
    except Exception:
        pass
    body = {
        'success': True,
        'fan': prof,
        # subscribers_cache is OF-only (subscribedOnData) — never touched here.
        'updated_cache': False,
        'platform': 'fansly',
    }
    if relogin:
        body['relogin'] = True
    return 200, body


def fetch_subscribers_page(crm_id, account_id, limit=25, offset=0, proxy=None,
                           type_='all', hydrate=True):
    """One page of GET /api/v1/subscribers, hydrated with identities via a
    single batched GET /api/v1/account?ids= call → (status, body) in the OF
    /subscribers route shape ({success, list, hasMore, count, offset, limit}).

    Confirmed live: the subscription rows carry lifecycle + pricing but NO
    identity beyond ``subscriberId``; /account?ids= resolves username /
    displayName (avatar object only when the fan has one). Hydrated identities
    are upserted into the ``fans`` table as a side effect — this is the fix for
    the anonymous snowflake-only fan rows harvest can't reach.

    ``type_`` in {all, active, expired}: the endpoint's own ?status filter is
    unverified, so filtering happens client-side within the page. Because a
    filtered page can return fewer rows than were consumed from the unfiltered
    stream, the body carries ``nextOffset`` (offset + RAW rows consumed) —
    pagers must advance by that, not by len(list). The OF branch of the
    /subscribers route emits ``nextOffset`` too (there it is simply
    offset + len(list)), so the two platforms share one paging contract; see
    that route's docstring.

    For the same reason ``hasMore`` — not an empty ``list`` — is the stop
    signal: a page whose rows all failed the type filter returns zero rows and
    still has more behind it.
    """
    limit = max(1, min(_int(limit, 25), 100))
    offset = max(0, _int(offset, 0))
    ok, data, status, relogin = fansly_client.handle_fansly_request(
        crm_id, account_id,
        f'/api/v1/subscribers{_q({"limit": limit, "offset": offset})}',
        method='GET', proxy=proxy)
    if not ok:
        err = data if isinstance(data, dict) else {'error': str(data)[:300]}
        err.setdefault('success', False)
        err.setdefault('error', 'Fansly request failed')
        return (status or 502), err

    resp = _resp(data) or {}
    raw_subs = resp.get('subscriptions') or [] if isinstance(resp, dict) else []

    # One batched identity lookup per page. Best-effort: a failed hydration
    # still returns the page (ids-only rows) rather than erroring the request.
    acct_idx = {}
    ids = sorted({str(s['subscriberId']) for s in raw_subs
                  if isinstance(s, dict) and s.get('subscriberId') is not None})
    if hydrate and ids:
        ok2, data2, _s2, _r2 = fansly_client.handle_fansly_request(
            crm_id, account_id, '/api/v1/account' + _q({'ids': ','.join(ids)}),
            method='GET', proxy=proxy)
        if ok2:
            accounts = _resp(data2)
            for acc in (accounts if isinstance(accounts, list) else []):
                if isinstance(acc, dict) and acc.get('id') is not None:
                    acct_idx[str(acc['id'])] = acc

    rows, stats = fnorm.normalize_subscribers(data, acct_idx)

    # Keep the fans table converging on real identities (username may be None
    # when hydration failed — upsert_fan treats None as "leave unknown").
    try:
        import crm_database as db
        for row in rows:
            if row.get('id') and (row.get('username') or row.get('name')):
                db.upsert_fan(crm_id, account_id, row['id'],
                              username=row.get('username'),
                              display_name=row.get('name'),
                              avatar=row.get('avatar'))
    except Exception:
        pass

    consumed = len(raw_subs)
    if type_ in ('active', 'expired'):
        rows = [r for r in rows if r.get('status') == type_]
    total = stats.get('total') or 0
    has_more = bool(consumed) and (offset + consumed) < total if total \
        else consumed >= limit
    body = {
        'success': True,
        'list': rows,
        'count': len(rows),
        'total': total,
        'stats': stats,
        'offset': offset,
        'limit': limit,
        'nextOffset': offset + consumed,
        'hasMore': has_more,
        'platform': 'fansly',
    }
    if relogin:
        body['relogin'] = True
    return 200, body


def fetch_campaigns_earnings(crm_id, account_id, proxy=None):
    """GET /api/v1/trackinglinks → (status, body) in the shape the campaigns
    page reads from GET /campaigns/earnings ({success, earnings[], cache}).

    Unlike OF (where earnings come from a local claimers×subscribers JOIN that
    needs a refresh walk), Fansly attributes per-link revenue server-side —
    this is a single live read, so coverage is always 100% and no refresh
    machinery applies."""
    ok, data, status, relogin = fansly_client.handle_fansly_request(
        crm_id, account_id, '/api/v1/trackinglinks', method='GET', proxy=proxy)
    if not ok:
        err = data if isinstance(data, dict) else {'error': str(data)[:300]}
        err.setdefault('success', False)
        err.setdefault('error', 'Fansly request failed')
        return (status or 502), err
    body = fnorm.normalize_campaigns_earnings(data)
    if relogin:
        body['relogin'] = True
    return 200, body


def fetch_payout_account(crm_id, account_id, proxy=None):
    """Fansly payout status → the OF /payout-account response shape.

    Combines GET /api/v1/payments/payoutmethods (method list — the endpoint
    carries no amounts) with the earnings wallet balance from /account/me.
    ``can_withdraw`` is always False with NO blockers: the read side is fine,
    but withdrawal requests are a POST this API never sends to Fansly
    (capability ``payouts_request`` is False) — an empty blockers list keeps
    the dashboard from rendering OF banking/verification warnings that don't
    apply here."""
    ok_m, methods_env, status_m, relogin_m = fansly_client.handle_fansly_request(
        crm_id, account_id, '/api/v1/payments/payoutmethods', method='GET', proxy=proxy)
    ok_b, me_env, status_b, relogin_b = fansly_client.handle_fansly_request(
        crm_id, account_id, '/api/v1/account/me', method='GET', proxy=proxy)
    if not ok_m and not ok_b:
        err = methods_env if isinstance(methods_env, dict) else {'error': str(methods_env)[:300]}
        err.setdefault('success', False)
        err.setdefault('error', 'Fansly request failed')
        return (status_m or 502), err

    methods = fnorm.normalize_payout_methods(methods_env) if ok_m else None
    balances = None
    if ok_b:
        balances = (fnorm.normalize_balances(me_env) or {}).get('balances')

    body = {
        'success': True,
        'account': {
            'platform': 'fansly',
            'payoutMethods': methods,
            'hasPayoutMethod': bool(methods),
        },
        'check_receive': None,   # OF-only concept — no Fansly equivalent
        'balances': balances,
        'can_withdraw': False,
        'blockers': [],
        'platform': 'fansly',
    }
    if relogin_m or relogin_b:
        body['relogin'] = True
    return 200, body


def payout_requests_from_cache(crm_id, account_id, limit=100, offset=0,
                               start_date=None, end_date=None):
    """Fansly payout HISTORY → the OF /payout-requests GET response shape.

    Served from transactions_cache rows classified 'payout' (wallet tx type
    16012, synced by fansly_sync) — zero live calls; fansly_sync owns
    freshness. Amounts are dollars already (normalized at upsert time)."""
    import crm_database as db
    rows, total = db.list_transactions_cache(
        crm_id, account_id, tx_type='payout',
        since=start_date or None, until=end_date or None,
        limit=limit, offset=offset)
    requests = []
    for r in rows:
        amount = r.get('amount')
        net = r.get('net') if r.get('net') is not None else amount
        requests.append({
            'id': r.get('tx_id'),
            'amount': amount,
            'fee': r.get('fee') or 0,
            'amountPaid': net,
            # Ledger rows only exist for money that actually left the wallet.
            'status': 'completed' if (r.get('status') or 'done') == 'done' else r.get('status'),
            'createdAt': r.get('created_at'),
            'source': 'fansly_wallet_ledger',
        })
    return 200, {
        'success': True,
        'requests': requests,
        'count': len(requests),
        'total': total,
        'platform': 'fansly',
    }


def _attach_earnings_series(crm_id, account_id, body, start_date, end_date):
    """Fill ``earnings.chartAmount/chartCount`` by bucketing transactions_cache
    rows per day inside [start_date, end_date]. Sets ``series_available: true``
    only when cached rows exist for the range — otherwise the balance-only body
    (series_available: false) is left untouched. Amounts are net dollars,
    matching OF's chart convention. Payout rows are excluded (money leaving
    the wallet is not earnings)."""
    import crm_database as db
    from datetime import datetime, timedelta

    earnings = (body or {}).get('earnings')
    if not isinstance(earnings, dict) or not start_date:
        return

    start_day = str(start_date)[:10]
    if end_date:
        end_day = str(end_date)[:10]
    else:
        end_day = datetime.utcnow().strftime('%Y-%m-%d')
    try:
        start_dt = datetime.strptime(start_day, '%Y-%m-%d')
        end_dt = datetime.strptime(end_day, '%Y-%m-%d')
    except ValueError:
        return
    if end_dt < start_dt:
        return

    # created_at is stored as '%Y-%m-%dT%H:%M:%S+00:00' — a bare date lower
    # bound and a 'T23:59:59Z' upper bound bracket it lexicographically.
    rows = []
    offset = 0
    while True:
        page, total = db.list_transactions_cache(
            crm_id, account_id, since=start_day, until=f'{end_day}T23:59:59Z',
            limit=1000, offset=offset)
        rows.extend(page)
        offset += len(page)
        if len(page) < 1000 or offset >= total:
            break

    # Whether this account has ANY cached transactions — decides if an empty
    # range reads $0 (cache synced) or keeps the balance figure (not synced, so
    # a $0 would be misleading rather than truthful).
    try:
        _, all_total = db.list_transactions_cache(crm_id, account_id, limit=1, offset=0)
    except Exception:
        all_total = 0
    cache_synced = (all_total or 0) > 0

    amt_by_day = {}
    cnt_by_day = {}
    range_net = 0.0
    range_gross = 0.0
    for r in rows:
        if (r.get('tx_type') or '') == 'payout':
            continue
        day = str(r.get('created_at') or '')[:10]
        if not day:
            continue
        try:
            net = float(r.get('net') if r.get('net') is not None else (r.get('amount') or 0))
        except (ValueError, TypeError):
            continue
        try:
            gross = float(r.get('amount') if r.get('amount') is not None else net)
        except (ValueError, TypeError):
            gross = net
        amt_by_day[day] = round(amt_by_day.get(day, 0.0) + net, 2)
        cnt_by_day[day] = cnt_by_day.get(day, 0) + 1
        range_net = round(range_net + net, 2)
        range_gross = round(range_gross + gross, 2)

    # Range-scope the headline totals. normalize_earnings fills total.total/
    # gross/amount with the CURRENT wallet balance, which ignores the requested
    # window — recompute them from the in-range ledger. The withdrawable wallet
    # figure stays available under earnings['available'].
    total_obj = earnings.get('total')
    if isinstance(total_obj, dict) and cache_synced:
        total_obj['total'] = range_net
        total_obj['amount'] = range_net
        total_obj['gross'] = range_gross

    if not amt_by_day:
        return

    chart_amount = []
    chart_count = []
    # Continuous day axis (capped so a runaway range can't build a huge list).
    n_days = min((end_dt - start_dt).days, 400)
    for i in range(n_days + 1):
        day = (start_dt + timedelta(days=i)).strftime('%Y-%m-%d')
        stamp = f'{day}T00:00:00+00:00'
        chart_amount.append({'date': stamp, 'count': amt_by_day.get(day, 0.0)})
        chart_count.append({'date': stamp, 'count': cnt_by_day.get(day, 0)})

    earnings['chartAmount'] = chart_amount
    earnings['chartCount'] = chart_count
    if isinstance(total_obj, dict):
        total_obj['chartAmount'] = chart_amount
        total_obj['chartCount'] = chart_count
    earnings['series_available'] = True


def _resp(envelope):
    return (envelope or {}).get('response') if isinstance(envelope, dict) else None


# Don't re-harvest more often than this — each harvest costs 3 live Fansly
# calls (/account/me + /messaging/groups + /notifications).
HARVEST_MIN_INTERVAL_MINUTES = 15


def maybe_harvest_fans(crm_id, account_id, proxy=None,
                       min_interval_minutes=HARVEST_MIN_INTERVAL_MINUTES):
    """Throttled harvest_fans, safe to dispatch from the scheduler background
    pool on every chats/notifications page view. Skips when a harvest ran in
    the last ``min_interval_minutes`` (tracked as ``last_harvest_at`` in the
    polling cursor, written WITHOUT touching poll metadata). Never raises.

    Module-level so scheduler.run_in_background can reference it."""
    from datetime import datetime, timezone
    import crm_database as db
    try:
        cursor = db.load_polling_cursor(crm_id, account_id) or {}
        last = cursor.get('last_harvest_at')
        if last:
            try:
                last_dt = datetime.fromisoformat(str(last).replace('Z', '+00:00'))
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                age = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if age < min_interval_minutes * 60:
                    return 0
            except (ValueError, TypeError):
                pass
        db.update_polling_cursor_fields(
            crm_id, account_id,
            last_harvest_at=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+00:00'))
        return harvest_fans(crm_id, account_id, proxy=proxy)
    except Exception:
        return 0


def harvest_fans(crm_id, account_id, proxy=None):
    """Populate the `fans` table for a Fansly account WITHOUT polling.

    Two cheap surfaces carry real fan identities:
      - chats `aggregationData.accounts[]` — subscribers/followers who have a DM
        conversation (carry id + username + avatar + subscriber flag).
      - notifications `tips[].senderId` + top-level `accounts[]` — real buyers.
    We upsert each into `fans` (scoped to this account), skipping the creator's
    own id. Best-effort and PARTIAL (only fans reachable via chats /
    notifications) — the FULL subscriber roster comes from the subscribers sync
    (fetch_subscribers_page upserts every hydrated identity), this harvest also
    catches non-subscribed tippers/followers.

    Returns the number of fan rows upserted. Never raises.
    """
    import crm_database as db
    upserted = 0
    self_id = str(account_id)

    # Re-sign the creator's own avatar from /account/me (signed Fansly CDN URLs
    # expire ~8-10 days). Best-effort.
    try:
        ok, data, _s, _r = fansly_client.handle_fansly_request(
            crm_id, account_id, '/api/v1/account/me', method='GET', proxy=proxy)
        if ok:
            prof = fnorm.normalize_account(data)
            av = prof.get('avatar')
            if av and str(av).startswith('http'):
                db.update_of_account_avatar(crm_id, account_id, av)
    except Exception:
        pass

    def _upsert(fid, username=None, display_name=None, avatar=None):
        nonlocal upserted
        if fid is None:
            return
        fid = str(fid)
        if not fid or fid == self_id:
            return
        try:
            db.upsert_fan(crm_id, account_id, fid,
                          username=username, display_name=display_name, avatar=avatar)
            upserted += 1
        except Exception:
            pass

    # ── chats: aggregationData.accounts[] ────────────────────────────────────
    try:
        ok, data, _s, _r = fansly_client.handle_fansly_request(
            crm_id, account_id, '/api/v1/messaging/groups', method='GET', proxy=proxy)
        resp = _resp(data) if ok else None
        if isinstance(resp, dict):
            agg = resp.get('aggregationData') or {}
            for acc in (agg.get('accounts') or []):
                if not isinstance(acc, dict):
                    continue
                # Keep subscribers/followers; skip the creator and anyone with
                # no relationship signal at all.
                if not (acc.get('subscriber') or acc.get('followsYou') or acc.get('subscriberSubscription')):
                    continue
                _upsert(acc.get('id'),
                        username=acc.get('username'),
                        display_name=fnorm._first(acc, 'displayName', 'username'),
                        avatar=fnorm._avatar_url(acc.get('avatar')))
    except Exception:
        pass

    # ── notifications: tips[].senderId + accounts[] for identity ─────────────
    try:
        ok, data, _s, _r = fansly_client.handle_fansly_request(
            crm_id, account_id, '/api/v1/notifications', method='GET', proxy=proxy)
        resp = _resp(data) if ok else None
        if isinstance(resp, dict):
            acct_idx = {}
            for acc in (resp.get('accounts') or []):
                if isinstance(acc, dict) and acc.get('id') is not None:
                    acct_idx[str(acc['id'])] = acc
            for tip in (resp.get('tips') or []):
                if not isinstance(tip, dict):
                    continue
                sid_raw = tip.get('senderId')
                if sid_raw is None or str(sid_raw) == self_id:
                    continue
                acc = acct_idx.get(str(sid_raw)) or {}
                _upsert(sid_raw,
                        username=acc.get('username'),
                        display_name=fnorm._first(acc, 'displayName', 'username'),
                        avatar=fnorm._avatar_url(acc.get('avatar')))
                # Backfill the tip as a spend event so the fan shows real spend
                # on the Fans page. Direct insert (deduped by source_event_id) —
                # NOT event_bus.emit — so we don't fan historical tips out to
                # webhooks/automations. The live poller emits NEW tips with
                # full fan-out.
                sid, payload = fnorm.build_tip_event(tip, acct_idx)
                seid = fnorm.tip_source_event_id(tip)
                if sid and seid and payload.get('amount'):
                    try:
                        db.insert_event(crm_id, account_id, 'new_tip', payload,
                                        source_event_id=seid,
                                        occurred_at=payload.get('created_at'))
                    except Exception:
                        pass
    except Exception:
        pass

    return upserted
