# Events, Webhooks, and Automations

This document describes the event taxonomy emitted by the background poller and
the payload shape delivered to webhooks / automations.

## Event taxonomy

All events are grounded in real payloads observed against a live OnlyFans
account. Each poll cycle reads `/users/notifications`, delta-walks the
subscribers and transactions caches, and — on every 10th cycle — reads
`/subscriptions/subscribers/count`:

| `event_type`          | Source                                                | Key fields in payload |
|-----------------------|-------------------------------------------------------|-----------------------|
| `new_subscriber`      | `/subscribers/latest` — item with `action="subscribe"` | `fan`, `price`, `subscribed_at`, `expire_at` |
| `renewed_subscriber`  | `/subscribers/latest` — item with `action="renewal"`  | same as above |
| `expired_subscriber`  | `/subscribers/count` delta (every 10th poll)          | `previous_total`, `new_total`, `delta` |
| `new_tip`             | Transactions walker — row with `type="tip"` (mapped via `TX_TYPE_TO_EVENT`) | `fan`, `amount`, `text` |
| `new_message`         | Notification with `subType="new_message"`             | `fan`, `text` |
| `new_purchase`        | Transactions walker — rows with type `message`, `post`, `stream` or `chargeback` (mapped via `TX_TYPE_TO_EVENT` in `poller.py`). `subscribe` and `renewal` are deliberately **not** here — the subscribers walker owns those | `fan`, `amount`, `text` |
| `balance_increased`   | **Fansly only.** `fansly_poller.py` diffs the creator's earnings-wallet balance. The OnlyFans poller does not read `/payouts/balances` at all | `previous_balance`, `new_balance`, `delta` |
| `payout_completed`    | (reserved) — not emitted by anything                  | — |
| `polling_paused`      | Poller auto-paused an account after 5 consecutive failures | `reason`, `failures` |

### Notes on source choice

- **Subscribers come exclusively from `/subscribers/latest`** (not from notifications). Notifications return `subType="new_subscriber"` for subscribe events but have no reliable renewal indicator. `/subscribers/latest` exposes the `subscribedByData.subscribes[]` array with an `action` field (`subscribe` vs `renewal`), so it's the single source of truth.
- **OnlyFans balance is not polled** — `new_tip` and `new_purchase` already carry the money signal from the transaction ledger, which is authoritative and arrives sooner. Adding a balance check would be an extra request per poll with no new information. (Fansly is different: its poller *does* diff the wallet balance, and that is the only source of `balance_increased`.)
- **Amounts on notification-sourced events** are parsed from `replacePairs["{AMOUNT}"]` (e.g. `"$25.00"`) — OF renders them there rather than as a numeric field. Transaction-sourced events take the numeric `amount` off the ledger row instead.
- **Fan data** (`fan.id`, `fan.username`, `fan.display_name`, `fan.avatar`) comes from the notification's embedded `user` object, which requires NOT passing `skip_users=all` on the request.

## Webhook payload

Every webhook POST has:

```http
POST <your url>
Content-Type: application/json
User-Agent: TheOnlyAPI-Webhook/1.0
X-OnlyAPI-Signature: sha256=<hex>
X-OnlyAPI-Timestamp: <unix seconds>
X-OnlyAPI-Event: <event_type>
X-OnlyAPI-Delivery-Id: <random hex>
```

Body:

```json
{
  "id": 12345,
  "event_type": "new_tip",
  "crm_id": "crm_0123456789abcdef",
  "of_user_id": "1234567",
  "occurred_at": "2026-04-18T12:34:56.789",
  "payload": {
    "fan": {"id": "987", "username": "somefan", "display_name": "Some Fan", "avatar": "https://..."},
    "amount": 10.0,
    "text": "tipped you $10",
    "raw_type": "tip",
    "created_at": "2026-04-18T12:34:50.000"
  }
}
```

## Verifying the signature

```python
import hmac, hashlib

def verify(secret, timestamp, body_bytes, signature_header):
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        f'{timestamp}.'.encode() + body_bytes,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

## Retry schedule

Failed deliveries retry at `[5s, 30s, 5m, 30m, 2h]`. After 5 consecutive
failures, the webhook is auto-deactivated (`is_active=0`) and will not be
contacted again until a `PATCH` re-enables it.

## Automation actions

Action types accepted in `POST /api/crm/{crm_id}/automations`:

| `action_type` | `action_params` |
|---------------|-----------------|
| `webhook`     | `{"url": "...", "secret": "..."}` — secret optional |
| `discord`     | `{"url": "...", "message": "...", "username": "..."}` |
| `slack`       | `{"url": "...", "message": "..."}` |
| `telegram`    | `{"bot_token": "...", "chat_id": "...", "message": "..."}` — see also the panel-level channel below, which needs no per-automation token |
| `send_dm`     | `{"message": "...", "to_fan_id": "..."}` — requires `allow_of_write_actions=1` on the account |
| `tag_fan`     | `{"tag": "vip"}` |

The `message` field supports mustache-like interpolation on event fields —
e.g. `"Thanks {payload.fan.username}!"` resolves at dispatch time.

Credential-bearing keys (`bot_token`, `secret`, `token`, `api_key`, `password`)
are **excluded** from that interpolation and passed through verbatim — a secret
must never reach a template evaluator.

## Conditions

Automations support a list of AND-joined conditions that must all pass:

```json
{
  "conditions": [
    {"field": "payload.amount", "op": "gt", "value": 5},
    {"field": "payload.fan.username", "op": "neq", "value": "banned_user"}
  ]
}
```

Supported operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`,
`startswith`, `in`.

## Panel-level Telegram channel

Separate from the `telegram` *automation action* above: one channel per CRM
panel, configured once, fed from the same `event_bus.emit` fan-out as SSE and
webhooks. Honours the same event-type filter contract (`'*'` = everything).

All routes below are relative to `/api/crm/{crm_id}`.

| Route | Purpose |
|---|---|
| `GET /integrations/telegram` | Current state + whether a shared bot exists on this deployment |
| `POST /integrations/telegram/pair` | `{bot_mode: "shared"\|"custom", bot_token?}` → returns a `https://t.me/<bot>?start=<code>` deep link |
| `PATCH /integrations/telegram` | `{event_types?, is_active?}` |
| `DELETE /integrations/telegram` | Disconnect |
| `POST /integrations/telegram/test` | Send a test message down the live path |

Two bot modes:

- **shared** — the platform's own bot (`TELEGRAM_SHARED_BOT_TOKEN` +
  `TELEGRAM_SHARED_BOT_USERNAME`). The tenant creates nothing. If the
  deployment has not configured it, pairing returns **409 with an explicit
  message** rather than handing out a link that can never resolve.
- **custom** — the tenant's own token from @BotFather. Stored Fernet-encrypted
  in `telegram_integrations.encrypted_bot_token` and **never returned by any
  route**, masked or otherwise. The API only ever reports `has_custom_token`.

Pairing: the user opens the deep link and presses Start. Codes are single-use,
expire after `TELEGRAM_PAIRING_TTL_SECONDS` (default 600s), and only one is
outstanding per panel — issuing a new one invalidates the previous.

Update intake is a **short poll** of `getUpdates` on a 3s scheduler job
(`internal.telegram_intake`). Telegram allows exactly one consumer per bot;
that job is it. See the module docstring in `telegram_updates.py` for why
gunicorn's enforced `workers = 1` is what makes that true, and what happens if
it is ever lifted. Custom bots are polled ONLY while that panel has an open
pairing code.

Failure handling mirrors webhooks: 5 consecutive send failures auto-deactivate
the channel (`is_active = 0`); re-enabling from the dashboard resets the
counter. A Telegram outage never propagates into `event_bus.emit`.

## Consuming events

- `GET /api/crm/{crm_id}/events` — persisted event log. Filters: `types`
  (comma-separated), `of_user_id`, `since` (exclusive, on `created_at`),
  `until` (inclusive), `limit`.
- `GET /api/crm/{crm_id}/events/stream` — SSE. Optional `?types=` filters
  server-side; `'*'` or no param streams everything.
- Subscriber history with timestamps (cache-backed, zero OF requests):
  `GET …/accounts/{of_user_id}/subscribers/new` and
  `GET …/accounts/{of_user_id}/subscribers/stats?granularity=hour|day|week|month`.

See [LIVE_SUBSCRIBER_TRACKING.md](LIVE_SUBSCRIBER_TRACKING.md) for the
client-facing integration guide, and [ARCHITECTURE.md](ARCHITECTURE.md) for how
the event bus fans out.
