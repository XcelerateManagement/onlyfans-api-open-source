#!/usr/bin/env python3
"""Per-account Fansly poller — the Fansly analogue of ``poller.poll_account``.

Fansly's pollable surface is narrower than OF's, and (confirmed against a live
account) has one decisive shape constraint: **wallet transactions carry no
buyer id** (sourceId/destinationId are null), so a transaction can't be
attributed to a fan. The only per-fan-attributable money signal is
``/notifications`` → ``tips[]`` (each carries the buyer's ``senderId`` + gross
``amount``).

So this poller fans out exactly two things:
  - ``balance_increased`` — diff of the creator's earnings-wallet balance
    (GET /api/v1/account/me) against the cursor. This is the "money came in"
    signal (covers tips, PPV, subscriptions — everything), with no double-count.
  - ``new_tip`` — NEW notification tips (with the real fan + gross amount).
    These light up per-fan spend on the Fans page and fire tip automations.

We deliberately do NOT emit a per-transaction ``new_purchase``: Fansly wallet
rows are buyer-less, so they'd be anonymous noise that also duplicates the
``balance_increased`` money signal. The full ledger is still available on the
Transactions page (read path via fansly_data.fetch). ``new_subscriber`` is not
emitted (yet): the roster IS enumerable (GET /api/v1/subscribers — see
subscribers_sync's fansly walk, which keeps subscribers_cache fresh on the 20h
cron), but diffing it every poll cycle would add live calls per 120s tick for
an event no automation currently needs.

Historical tips are backfilled silently by ``fansly_data.harvest_fans`` (a
direct deduped insert, no fan-out), so when the poller first sees them its
``event_bus.emit`` is deduped and never re-fans-out old tips. Gated by
``config.FANSLY_POLLING_ENABLED`` (checked by ``poller.poll_account``).
"""
from __future__ import annotations

import traceback
from datetime import datetime, timezone

import crm_database as db
import event_bus
import fansly_client
import fansly_normalize as fnorm

# If the last poll is older than this many intervals, treat the cursor as
# STALE: seed it with current values instead of diffing, so re-enabling
# polling after days/weeks doesn't fire one giant catch-up balance_increased
# (live case: cursor 85.36 vs wallet 489.36 → a ~$404 event dated "now" would
# hit every amount-threshold automation/webhook for money that arrived over
# weeks).
STALE_AFTER_INTERVALS = 3


def _cursor_is_stale(info: dict | None) -> bool:
    """True when the account hasn't been polled for ~3 intervals (or ever)."""
    if not info:
        return True
    last = info.get('last_polled_at')
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(str(last).replace('Z', '+00:00'))
        if last_dt.tzinfo is not None:
            last_dt = last_dt.astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, TypeError):
        return True
    interval = info.get('polling_interval_seconds') or 120
    age = (datetime.utcnow() - last_dt).total_seconds()
    return age > STALE_AFTER_INTERVALS * max(60, int(interval))


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


_PAUSE_MESSAGES = {
    'requires_2fa': 'Re-connect this Fansly account — re-login needs a fresh 2FA / verification code.',
    'auth_token_expired': 'Re-paste your Fansly auth token to resume syncing.',
    'login_failed': 'Fansly re-login failed — re-connect the account.',
}


def _extract_balance(envelope) -> float | None:
    """Creator earnings-wallet balance (dollars) from /account/me. None-safe."""
    resp = envelope.get('response') if isinstance(envelope, dict) else None
    if not isinstance(resp, dict):
        return None
    acc = resp.get('account') if isinstance(resp.get('account'), dict) else resp
    ew = acc.get('earningsWallet') if isinstance(acc.get('earningsWallet'), dict) else {}
    return fnorm._cents(fnorm._first(ew, 'balance', 'balance64'))


def poll_fansly_account(crm_id: str, account_id: str) -> None:
    """Poll one Fansly account. Safe to call from threads — never raises."""
    account_id = str(account_id)
    try:
        cursor = db.load_polling_cursor(crm_id, account_id) or {}
        new_cursor = dict(cursor)
        new_cursor['poll_index'] = int(cursor.get('poll_index', 0)) + 1
        saw_failure = False
        auth_reason = None
        # First poll after (re)enable? Seed cursors instead of diffing against
        # values that may be weeks old.
        stale = _cursor_is_stale(db.get_account_polling(crm_id, account_id))

        def _note_failure(d):
            nonlocal saw_failure, auth_reason
            saw_failure = True
            if isinstance(d, dict) and d.get('relogin_failed'):
                auth_reason = d.get('reason') or auth_reason

        # ── 1. Balance → balance_increased on a positive delta ──────────────
        ok, data, _s, _r = fansly_client.handle_fansly_request(
            crm_id, account_id, '/api/v1/account/me')
        if ok:
            bal = _extract_balance(data)
            if bal is not None:
                prev = cursor.get('last_balance')
                if isinstance(prev, (int, float)) and bal > prev + 0.001 and not stale:
                    delta = round(bal - prev, 2)
                    event_bus.emit(
                        crm_id, account_id, 'balance_increased',
                        # delta/available are the keys the dashboard reads; keep
                        # amount/balance + previous/new for webhook consumers.
                        {'delta': delta, 'available': bal,
                         'previous_balance': round(prev, 2), 'new_balance': bal,
                         'amount': delta, 'balance': bal,
                         'currency': 'USD', 'source': 'poll'},
                        # Include poll_index so a balance that coincidentally
                        # returns to an earlier value in a later cycle isn't
                        # deduped away as a repeat of that earlier event.
                        source_event_id=f"fansly-bal:{account_id}:{new_cursor['poll_index']}:{bal}",
                    )
                new_cursor['last_balance'] = bal
                # Stamp the panel-wide balance sample too. The poll already has
                # the number in hand, so this is free — and without it the only
                # writer is the on-demand /balances route, meaning a Fansly
                # account nobody has opened in the dashboard has no sample at
                # all. /earnings/summary reads these samples rather than making
                # one live call per account, so an unstamped account silently
                # contributes 0 to the reported wallet floor. This poll only
                # reads /account/me, so pending is not known here: the stored
                # pending figure (from the scheduled wallet snapshot) is kept
                # instead of being wiped to NULL.
                try:
                    import fansly_wallet
                    fansly_wallet.record_wallet_sample(crm_id, account_id, bal,
                                                       None, pending_known=False)
                except Exception:
                    pass
        else:
            _note_failure(data)

        # ── 2. Notifications → new_tip (the only per-fan spend signal) ──────
        ok, data, _s, _r = fansly_client.handle_fansly_request(
            crm_id, account_id, '/api/v1/notifications')
        if ok:
            resp = data.get('response') if isinstance(data, dict) else None
            if isinstance(resp, dict):
                acct_idx = {
                    str(a['id']): a for a in (resp.get('accounts') or [])
                    if isinstance(a, dict) and a.get('id') is not None
                }
                last_tip = cursor.get('last_fansly_tip_id')
                max_tip = last_tip
                # First poll seeds, it does not emit — same rule as the OF
                # poller (see poller.py). The dedup this loop relies on only
                # saves us when the harvest happened to insert these tips
                # first; with no cursor and no prior harvest, every historical
                # tip would fan out to webhooks, automations and Telegram as if
                # it had just arrived.
                if last_tip is None:
                    for tip in (resp.get('tips') or []):
                        if isinstance(tip, dict) and tip.get('id') is not None:
                            max_tip = _id_max(max_tip, str(tip['id']))
                    if max_tip is not None:
                        new_cursor['last_fansly_tip_id'] = str(max_tip)
                    resp = dict(resp, tips=[])
                # Oldest-first so events fire chronologically; dedup (by
                # source_event_id, incl. harvest's prior insert) makes re-seen
                # tips harmless and prevents historical fan-out.
                for tip in reversed(resp.get('tips') or []):
                    if not isinstance(tip, dict) or tip.get('id') is None:
                        continue
                    tip_id = str(tip['id'])
                    if last_tip is not None and _id_le(tip_id, last_tip):
                        continue
                    sid, payload = fnorm.build_tip_event(tip, acct_idx)
                    if sid and str(sid) != account_id and payload.get('amount'):
                        try:
                            db.upsert_fan(
                                crm_id, account_id, sid,
                                username=payload['fan'].get('username'),
                                display_name=payload['fan'].get('display_name'),
                                avatar=payload['fan'].get('avatar'))
                        except Exception:
                            pass
                        event_bus.emit(
                            crm_id, account_id, 'new_tip', payload,
                            source_event_id=fnorm.tip_source_event_id(tip),
                            occurred_at=payload.get('created_at'))
                    max_tip = _id_max(max_tip, tip_id)
                if max_tip is not None:
                    new_cursor['last_fansly_tip_id'] = str(max_tip)
        else:
            _note_failure(data)

        # ── 3. Wallet ledger → transactions_cache (delta walk) ──────────────
        # Keeps cached tx / fan spend / earnings-summary fresh each cycle.
        # Bounded to a few pages; snowflake cursor makes re-walks cheap. Silent
        # upserts only — no per-tx events (buyer-less rows would duplicate the
        # balance_increased money signal).
        try:
            import fansly_sync
            _tx_res = fansly_sync.poll_delta_sync(crm_id, account_id)
            # poll_delta_sync swallows its own exceptions and returns None on
            # failure; count that (or an explicit success:false) as a poll
            # failure so a persistently-broken wallet sync trips the auto-pause
            # instead of silently going stale forever.
            if _tx_res is None or not _tx_res.get('success', True):
                saw_failure = True
        except Exception:
            traceback.print_exc()
            saw_failure = True

        # Merge cursor keys written out-of-band while this poll ran (the tx
        # sync's last_fansly_tx_id, harvest's last_harvest_at) so the full
        # save below doesn't clobber them with the stale snapshot from the top.
        try:
            fresh = db.load_polling_cursor(crm_id, account_id) or {}
            for k in ('last_fansly_tx_id', 'last_harvest_at'):
                if fresh.get(k) is not None:
                    new_cursor[k] = fresh[k]
        except Exception:
            pass

        db.save_polling_cursor(crm_id, account_id, new_cursor, success=not saw_failure)

        # Auto-pause on repeated failures — but confirm a dead proxy first,
        # via the same shared logic the OF poller uses (tests the proxy and
        # only pauses on proxy grounds when it is genuinely unreachable).
        if saw_failure:
            import poller as _poller
            _poller._auto_pause_if_needed(crm_id, account_id)
    except Exception:
        traceback.print_exc()
        db.save_polling_cursor(crm_id, account_id, None, success=False)
