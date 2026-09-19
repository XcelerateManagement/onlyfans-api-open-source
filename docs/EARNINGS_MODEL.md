# Earnings model — cached subscribers + transactions

This document describes how per-fan spending is computed. Read it before
touching `api/earnings_model.py`, `api/subscribers_sync.py`,
`api/transactions_sync.py` or the related Flask routes.

All file paths below are relative to `api/`.

---

## Why there are two caches

OF exposes two different truths about "how much has this fan spent?":

1. **`/subscriptions/subscribers/latest`** returns each fan's **lifetime** spend
   aggregate, inside the per-row `subscribedOnData` object:

   ```json
   "subscribedOnData": {
     "subscribeAt": "2026-04-05T00:18:01+00:00",
     "expiredAt":   "2036-04-05T00:18:01+00:00",
     "totalSumm":     1692.0,
     "tipsSumm":        56.0,
     "messagesSumm":  1636.0,
     "postsSumm":        0.0,
     "streamsSumm":      0.0,
     "subscribesSumm":   0.0
   }
   ```

   It is canonical and trustworthy, but the only way to walk it is offset
   pagination at 100 per page. For a creator with 20k subs that's ~200 requests
   per full refresh. Measured on one live account: ~11s per page → ~35 min for
   a full walk. **Heavy. Run rarely.**

2. **`/payouts/transactions`** returns the creator's **ledger** — every tip, PPV
   message payment, subscription payment, paid post, chargeback, referral —
   marker-paginated top-down by date:

   ```json
   {
     "id": "d0b107d178a45cba35853ff935f62176",
     "amount": 59,
     "net": 47.2,
     "fee": 11.8,
     "vatAmount": 12.98,
     "createdAt": "2026-04-18T14:51:45+00:00",
     "currency": "USD",
     "description": "Payment for message from <a>…</a>",
     "status": "done",
     "user": { "id": 123456789, "username": "u123456789", "isDeleted": false }
   }
   ```

   Every row has a stable `id`, `user.id` for attribution, and a `status`.
   This is cheap to delta-walk (stop at the first known tx id) and gives
   per-tx attribution we can aggregate any way we like. **Bounded initial
   window (default 30 days), forward-delta thereafter.**

Neither cache alone is sufficient:
- Subs alone lags by up to a full refresh cycle (we refresh weekly).
- Tx alone is bounded to the recent window (no lifetime history).

They cover each other: **subs = lifetime canonical, tx = freshness + attribution**.

---

## The formula

For each fan:

```
current_spent(fan) = canonical(fan) + signed_delta(fan, since=subs.last_synced_at)
```

- **`canonical(fan)`** = `subscribers_cache.total_spent` (= `subscribedOnData.totalSumm`
  at the moment we last synced the subs list).
- **`signed_delta(fan, since=T)`** = SUM over `transactions_cache` rows for
  that fan whose `created_at > T`, with the following sign rules:
  - `status ∈ {done, loading}` → `+amount`
  - `status ∈ {undo}`           → `−amount`
  - anything else               → `0` (and we want to hear about it)

Canonical uses `subs.last_synced_at` (normalized canonical UTC ISO,
matching OF's format) as the strict-greater-than cutoff, so a tx at the
exact same second as the subs sync stays in canonical (was already baked
into OF's aggregate at the moment they computed it).

```
                      subs.last_synced_at
                              │
 time ──────────────────────► │ ──────────────────────►
                              │
      ┌──── canonical ────────┤ ──── signed_delta ────┐
      └───────────────────────┴───────────────────────┘
                    current_spent
```

Orphan fans (have tx, no subs row yet) get `canonical = 0` and the delta
spans the full tx window. Result shape flags this as `source: "tx-only"`
so callers can tell the difference.

---

## Status taxonomy (why we don't just SUM(amount))

A live scan of 214 transactions on one account found:

| status    | count | meaning                                             | contribution |
|-----------|------:|-----------------------------------------------------|--------------|
| `done`    |   174 | cleared, creator can withdraw                       | `+amount`    |
| `loading` |    39 | within `payoutPendingDays` (default 7)              | `+amount`    |
| `undo`    |     1 | chargeback (`refundReason: "ethoca_alert"`)         | `−amount`    |

**A naive `SUM(amount)` overstates earnings by twice the chargeback amount**
(the chargeback appears as a positive `amount` in the ledger because OF just
marks the original line `status='undo'` rather than writing a negative row).
On the sampled account the difference was a $25 chargeback → a $50 swing: raw
sum $9,087, signed sum $9,037. Always use `earnings_model.compute_current_spent`,
never a direct SQL SUM.

Unknown statuses are **ignored**, not assumed positive. If OF introduces a new
one, `current_spent` will diverge from `canonical` on the next subs sync and
we'll notice. The alternative — assuming "+amount" — would silently hide the
bug.

Deleted fans (`user.isDeleted = true`, description uses `<span>` instead of
`<a>`) still contribute normally. The money was real.

---

## Field mapping

### subscribers_cache (populated by `subscribers_sync.delta_sync_subscribers`)

| column                 | source                                    |
|------------------------|-------------------------------------------|
| `fan_of_user_id`       | `user.id`                                 |
| `username`             | `user.username`                           |
| `display_name`         | `user.name`                               |
| `avatar`               | `user.avatar`                             |
| `subscribed_at`        | `subscribedOnData.subscribeAt` (fallback: `subscribedByData.subscribeAt`, `subscribedOn`) |
| `expired_at`           | `subscribedOnData.expiredAt`  (fallback: `subscribedByData.expiredAt`)                   |
| `subscribe_price`      | `subscribedOnData.subscribePrice` (fallback: `subscribedByData.subscribePrice`, top-level `subscribePrice`) |
| `total_spent`          | `subscribedOnData.totalSumm`              |
| `spent_tips`           | `subscribedOnData.tipsSumm`               |
| `spent_messages`       | `subscribedOnData.messagesSumm`           |
| `spent_posts`          | `subscribedOnData.postsSumm`              |
| `spent_streams`        | `subscribedOnData.streamsSumm`            |
| `spent_subscriptions`  | `subscribedOnData.subscribesSumm`         |
| `is_active`            | derived from `expired_at` vs now          |
| `campaign_id`          | `subscribedOnData.campaignId` (if present — carries the tracking-link attribution when a fan came via a campaign) |
| `raw_json`             | the full user object (for later re-parsing) |
| `last_synced_at`       | `iso_utc_now()` at write time, in `YYYY-MM-DDTHH:MM:SS+00:00` format (matches `tx.created_at` so SQL `>` works) |

### transactions_cache (populated by `transactions_sync.delta_sync_transactions`)

| column             | source                 |
|--------------------|------------------------|
| `tx_id`            | `id` (stable hex, used as delta-stop key and dedup constraint) |
| `fan_of_user_id`   | `user.id`              |
| `fan_username`     | `user.username`        |
| `amount`           | `amount` (gross)       |
| `net`              | `net`                  |
| `fee`              | `fee`                  |
| `vat_amount`       | `vatAmount`            |
| `tax_amount`       | `taxAmount`            |
| `media_tax_amount` | `mediaTaxAmount`       |
| `currency`         | `currency` (always `USD` on creator accounts we've seen) |
| `description`      | `description` (HTML string; user.id is the stable attribution key, don't parse the `<a href>`) |
| `tx_type`          | derived via keyword match on description (tip / message / subscription / renewal / post / stream / story / referral / chargeback / other) |
| `status`           | `status` — drives the signed-amount rule |
| `created_at`       | `createdAt` (OF format, used for `>` comparison against `subs.last_synced_at`) |
| `raw_json`         | full tx object         |
| `synced_at`        | `iso_utc_now()` at write time |

---

## Invariants

These are verified by `api/tests/test_earnings_scenarios.py`.

- **I1 — No double-counting.** Delta uses strict `>` against `subs.last_synced_at`.
- **I2 — Chargebacks subtract.** `status='undo'` → `−amount`.
- **I3 — Pending clears count.** `status='loading'` is real money; include.
- **I4 — Unknown statuses are ignored.** `0`, never assumed positive.
- **I5 — Orphan tx are summable.** Missing subs row → `canonical = 0`,
  delta over full cached window, `source: "tx-only"`.
- **I6 — Canonical timestamp format.** `last_synced_at` written via
  `crm_database.iso_utc_now()` so SQL `>` against OF's `createdAt` is
  lexicographically correct (no `.` vs `+` boundary mismatch).

---

## Scheduler cadences

`scheduler.py` runs both on per-account interval jobs:

| job                  | id                                    | default cadence | cost per run |
|----------------------|---------------------------------------|-----------------|--------------|
| poll (notifications) | `account:{crm}:{of_user_id}`          | per-account `polling_interval_seconds`. The column default is 120s, but connecting an account switches polling on at `DEFAULT_PAID_POLL_INTERVAL` (300s) | ~3–5 requests |
| subscribers refresh  | `subs_refresh:{crm}:{of_user_id}`     | 7 days (`SUBS_REFRESH_INTERVAL_HOURS = 168`) | ~35 min for 20k subs (full walk, first time) / ~1 pg if cache is warm (delta) |
| transactions refresh | `tx_refresh:{crm}:{of_user_id}`       | **adaptive**, not a flat day: `TX_REFRESH_FAST_MINUTES` (10) for polling-enabled accounts, `TX_REFRESH_IDLE_MINUTES` (360) for the rest, never below `TX_REFRESH_MIN_MINUTES` (5). `TX_REFRESH_INTERVAL_HOURS = 24` survives only as a legacy default | 1–2 pages (delta) / up to 30 pages (bounded initial) |

Fansly accounts reuse the same two job ids but run a different body and a
different cadence (`FANSLY_REFRESH_FAST_MINUTES` / `FANSLY_REFRESH_IDLE_MINUTES`
/ `FANSLY_SUBS_REFRESH_HOURS`) — see the comments in `scheduler.py`.

Subs refresh is weekly because it's **heavy** AND the lifecycle data (who's
subscribed, what price, active/expired) doesn't change fast enough to need
more. The minute-to-minute freshness comes from the tx refresh, which is why
that one is adaptive rather than daily.

First sync for a new account does an unbounded subs walk (one-time cost) and
a **bounded** tx walk (`INITIAL_WINDOW_DAYS` = 30 days or `INITIAL_MAX_PAGES` =
30 pages, whichever hits first) to avoid multi-hour backfills on creators with
millions of historical transactions.

---

## Scenarios (spec, examples, expected outputs)

The tests in `api/tests/test_earnings_scenarios.py` encode these. It is a
standalone script, not a pytest module — run it directly (`cd api && python
tests/test_earnings_scenarios.py`; on Windows set `PYTHONIOENCODING=utf-8`
first) before shipping any change to `earnings_model.py` or the tx/subs upsert
logic.

### Scenario 1 — Fresh snapshot, no tx

```
subs_cache: fan=1, total_spent=100, last_synced_at=now
tx_cache:   (empty)
```
→ `canonical=100, delta=0, current_spent=100, source='canonical+delta'`

### Scenario 2 — Stale snapshot, new tip since

```
subs_cache: fan=1, total_spent=100, last_synced_at="2026-04-01T00:00:00+00:00"
tx_cache:   fan=1, amount=50, created_at="2026-04-05T00:00:00+00:00", status=done
```
→ `canonical=100, delta=+50, current_spent=150`

### Scenario 3 — Chargeback between sub syncs

```
subs_cache: fan=1, total_spent=100, last_synced_at="2026-04-01T00:00:00+00:00"
tx_cache:   t1 +$50 done   @ 2026-04-05
            t2 +$20 undo   @ 2026-04-06  (chargeback)
```
→ `delta_positive=50, delta_negative=20, delta_signed=+30, current_spent=130`

### Scenario 4 — Pending clear still counts

```
tx_cache: $40 loading @ 2026-04-17 (within payoutPendingDays=7)
```
→ `current_spent = canonical + 40`

### Scenario 5 — Unknown status is ignored

```
tx_cache: $9999 status="mysteryXYZ"
```
→ `delta_signed = 0`, the outlandish amount does NOT enter `current_spent`.

### Scenario 6 — tx at exact snapshot second

```
subs.last_synced_at = "2026-04-10T12:00:00+00:00"
tx.created_at       = "2026-04-10T12:00:00+00:00"
```
→ tx excluded from delta (strict `>`); already in canonical.

### Scenario 7 — tx one second after snapshot

```
subs.last_synced_at = "2026-04-10T12:00:00+00:00"
tx.created_at       = "2026-04-10T12:00:01+00:00"
```
→ tx included in delta.

### Scenario 8 — Orphan tx (fan not in subs cache)

```
subs_cache: (empty for fan=77)
tx_cache:   fan=77, $25
```
→ `canonical=0, delta_signed=25, current_spent=25, source='tx-only'`

### Scenario 9 — Subs only, no tx

→ `current_spent = canonical`.

### Scenario 10 — Multi-sync cycle (no double-count)

```
T0: subs sync, canonical=100
T1: $40 tip lands in tx_cache       → current_spent=140
T2: subs sync, canonical=140, last_synced_at advanced past the tx
```
→ T2: `canonical=140, delta=0, current_spent=140` — tx stays in cache but no
longer contributes (its `created_at` is now ≤ snapshot). **No double count.**

### Scenario 11 — Cross-account isolation

→ A tx under a different `of_user_id` must not leak into this account's sum.

### Scenario 12 — Bulk == per-fan

→ `compute_current_spent_bulk` returns exactly what repeated per-fan calls would.

### Scenario 13 — Chargeback of a pre-snapshot payment

```
subs.last_synced_at = "2026-04-05T00:00:00+00:00"
(original +$30 done payment happened before snapshot — baked into canonical)
tx_cache: $30 undo @ 2026-04-07 (chargeback for that earlier payment)
```
→ `canonical=100, delta_negative=30, delta_signed=−30, current_spent=70`
(canonical overcounts by 30, delta undercounts by 30, they meet at truth)

### Scenario 14 — Breakdown fields populate from `subscribedOnData.*Summ`

→ `spent_tips`, `spent_messages`, `spent_posts`, `spent_streams`,
  `spent_subscriptions` all match the source aggregates.

---

## Known limitations

- **Tx window is bounded.** Default 30 days. If a fan's only spend was
  > 30 days ago and they're not yet in `subscribers_cache`, we'll report
  `current_spent = 0` until a subs sync pulls them in with the canonical
  total.
- **OF aggregate lag.** OF might not update `totalSumm` in real-time — there
  could be a few seconds/minutes between a tx clearing and it being baked
  into the aggregate. A tx that fired just before our subs sync might
  technically be double-counted for that brief window. We accept this.
- **Chargebacks before our first sync** are invisible unless the original
  tx and chargeback are both within the tx window. For creators we're
  picking up mid-history, the canonical value is correct but we can't
  independently verify it.
- **No currency conversion.** Every row seen so far is USD. If a creator
  takes payouts in another currency, SUM-across-accounts would be wrong.
  Guard against this at the reporting layer, not here.

---

## Where the code lives

| file                                           | role                                 |
|------------------------------------------------|--------------------------------------|
| `crm_database.py`                              | schema + upsert_subscriber / upsert_transaction / summary helpers |
| `subscribers_sync.py`                          | the full+delta walker for `/subscribers/latest` |
| `transactions_sync.py`                         | the bounded-initial + delta walker for `/payouts/transactions` |
| `earnings_model.py`                            | **the math** — `compute_current_spent`, `compute_current_spent_bulk`, `reconcile_check` |
| `scheduler.py`                                 | registers per-account jobs on the 7d/24h cadence |
| `crm_api.py`                                   | routes: `/subscribers/refresh`, `/transactions/refresh`, `/subscribers/cached`, `/transactions/cached` |
| `tests/test_earnings_scenarios.py`             | **14 scenarios.** Must stay green. |
