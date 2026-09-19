# Live Subscriber Tracking — Integration Guide

How to track incoming subscribers with timestamps and receive live notifications
from your own install in your own CRM.

**Base URL:** `https://your-install.example.com`
**Auth:** every request needs your API key in the `X-API-Key` header.

Replace in all examples below:

| Placeholder | Meaning |
|---|---|
| `{CRM_ID}` | Your panel id, e.g. `crm_a1b2c3d4e5f6g7h8` |
| `{API_KEY}` | Your panel API key |
| `{OF_USER_ID}` | The OnlyFans account id (numeric), from `GET /api/crm/{CRM_ID}/accounts` |

---

## 0. One-time setup: enable polling on the account

Live events (new subscriber, tip, message, …) are produced by a background
poller. **Connecting an account turns polling on for you**, at
`DEFAULT_PAID_POLL_INTERVAL` (300s by default); an account that already had
polling on keeps whatever interval it had. Change or check it here:

```bash
curl -X PATCH https://your-install.example.com/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/polling \
  -H "X-API-Key: {API_KEY}" -H "Content-Type: application/json" \
  -d '{"enabled": true, "interval_seconds": 120}'
```

`interval_seconds` can be 60–3600 (`POLL_INTERVAL_MIN` / `POLL_INTERVAL_MAX`).
Check status any time with `GET` on the same URL. There is no API quota in this
build — the only cost of a shorter interval is upstream requests to OnlyFans,
which is what rate-limits and flags accounts. The subscriber history endpoints
below (`/subscribers/new`, `/subscribers/stats`) read from cache and make
**zero** OnlyFans requests.

---

## 1. New subscribers with timestamps

`GET /api/crm/{CRM_ID}/accounts/{OF_USER_ID}/subscribers/new`

Every incoming subscription (new subs **and** renewals — a renewal moves the
fan's `subscribed_at` forward), newest first.

| Query param | Meaning |
|---|---|
| `since` / `until` | Inclusive ISO-8601 bounds on `subscribed_at` (e.g. `2026-06-01T00:00:00+00:00` — remember to URL-encode `+` as `%2B`) |
| `limit` | 1–500, default 50 |
| `offset` | Pagination offset |
| `type` | `all` (default) / `active` / `expired` |

```bash
curl "https://your-install.example.com/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/subscribers/new?since=2026-06-01T00:00:00%2B00:00&limit=100" \
  -H "X-API-Key: {API_KEY}"
```

```json
{
  "success": true,
  "subscribers": [
    {
      "fan_of_user_id": "123456789",
      "username": "examplefan",
      "display_name": "Example Fan",
      "avatar": "https://…",
      "subscribed_at": "2026-05-18T13:13:05+00:00",
      "expired_at": "2026-06-18T13:13:05+00:00",
      "subscribe_price": 9.99,
      "total_spent": 50.0,
      "is_active": 1
    }
  ],
  "count": 1, "total": 131, "offset": 0, "limit": 100, "hasMore": true,
  "window": {"since": "2026-06-01T00:00:00+00:00", "until": null}
}
```

**Sync pattern for your CRM:** store the newest `subscribed_at` you've seen,
then call with `since=<that value>` every few minutes. New rows = new subs.

## 2. Subscriber counts per timeframe (for charts)

`GET /api/crm/{CRM_ID}/accounts/{OF_USER_ID}/subscribers/stats`

Time-bucketed counts of incoming subscriptions — this is the endpoint for
"how many subs did I get per day/week/month".

| Query param | Meaning |
|---|---|
| `granularity` | `hour` / `day` (default) / `week` (Monday-start) / `month` |
| `since` / `until` | Inclusive ISO-8601 bounds on `subscribed_at` |

```bash
curl "https://your-install.example.com/api/crm/{CRM_ID}/accounts/{OF_USER_ID}/subscribers/stats?granularity=day&since=2026-06-01" \
  -H "X-API-Key: {API_KEY}"
```

```json
{
  "success": true,
  "granularity": "day",
  "buckets": [
    {"bucket": "2026-06-01", "count": 12},
    {"bucket": "2026-06-03", "count": 7}
  ],
  "total_in_window": 19,
  "window": {"since": "2026-06-01", "until": null},
  "cache": {"total": 15148, "active": 12124, "expired": 3024, "...": "…"}
}
```

Buckets with zero subs are omitted — zero-fill the gaps when charting.

## 3. Poll events every few minutes (simplest live tracking)

`GET /api/crm/{CRM_ID}/events`

Every new/renewed/expired subscriber the poller detects is stored as an event
with two timestamps: `occurred_at` (when the sub actually happened on OF) and
`created_at` (when we detected it).

| Query param | Meaning |
|---|---|
| `types` | Comma-separated: `new_subscriber,renewed_subscriber,expired_subscriber,new_tip,new_message,new_purchase,balance_increased,payout_completed` |
| `of_user_id` | Filter to one OF account (omit = all accounts on the panel) |
| `since` | Exclusive lower bound on `created_at` — **use the last `created_at` you processed as a cursor** |
| `until` | Inclusive upper bound on `created_at` |
| `limit` | 1–500, default 100 |

```bash
curl "https://your-install.example.com/api/crm/{CRM_ID}/events?types=new_subscriber,renewed_subscriber&of_user_id={OF_USER_ID}&since=2026-07-12T00:00:00" \
  -H "X-API-Key: {API_KEY}"
```

Each `new_subscriber` / `renewed_subscriber` event payload:

```json
{
  "fan": {"id": "123", "username": "…", "display_name": "…", "avatar": "…"},
  "price": 9.99,
  "regular_price": 9.99,
  "subscribed_at": "2026-07-12T09:31:05+00:00",
  "expire_at": "2026-08-12T09:31:05+00:00",
  "action": "subscribe"
}
```

`action` is `"subscribe"` for a first-time sub, `"renewal"` on a renewal
(also distinguished by the event type itself).

## 4. Real-time push: SSE stream

`GET /api/crm/{CRM_ID}/events/stream` — a standard Server-Sent-Events stream
(`text/event-stream`). Events appear within one poll interval of happening.
Optionally filter server-side with `?types=`:

```bash
curl -N "https://your-install.example.com/api/crm/{CRM_ID}/events/stream?types=new_subscriber,renewed_subscriber" \
  -H "X-API-Key: {API_KEY}"
```

```
: connected

event: new_subscriber
id: 4821
data: {"id":4821,"event_type":"new_subscriber","of_user_id":"…","payload":{…}}

: keep-alive
```

Node example:

```js
const EventSource = require("eventsource"); // npm i eventsource (v2 API)
const es = new EventSource(
  "https://your-install.example.com/api/crm/{CRM_ID}/events/stream?types=new_subscriber,renewed_subscriber",
  { headers: { "X-API-Key": "{API_KEY}" } }
);
es.addEventListener("new_subscriber", (e) => {
  const evt = JSON.parse(e.data);
  console.log("new sub:", evt.payload.fan.username, "at", evt.payload.subscribed_at);
});
```

Notes:
- Consume SSE **from your server**, not from a browser page — the browser
  `EventSource` API can't send the `X-API-Key` header (and you'd leak the key).
  If you need it in a browser, proxy it through your own backend.
- A `: keep-alive` comment is sent periodically; reconnect with backoff if the
  connection drops. There is no WebSocket endpoint — SSE covers the same
  use case with plain HTTP; for server-to-server pushes prefer webhooks (below).

## 5. Real-time push: webhooks

Your install POSTs each event to your URL — the best option if your CRM has a
public endpoint.

```bash
curl -X POST https://your-install.example.com/api/crm/{CRM_ID}/webhooks \
  -H "X-API-Key: {API_KEY}" -H "Content-Type: application/json" \
  -d '{"url": "https://your-crm.example.com/hooks/subscribers", "event_types": ["new_subscriber", "renewed_subscriber", "expired_subscriber"]}'
```

The response includes a `secret`. Each delivery carries:

| Header | Meaning |
|---|---|
| `X-OnlyAPI-Event` | Event type |
| `X-OnlyAPI-Delivery-Id` | Unique id per attempt |
| `X-OnlyAPI-Timestamp` | Unix seconds used in the signature |
| `X-OnlyAPI-Signature` | `sha256=` + HMAC-SHA256 of `"{timestamp}." + rawBody` with your `secret` |

Verify (Node):

```js
const crypto = require("crypto");
function verify(secret, timestamp, rawBody, signatureHeader) {
  const expected = "sha256=" + crypto.createHmac("sha256", secret)
    .update(`${timestamp}.`).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
```

Respond with 2xx quickly. Failures retry at 5s, 30s, 5m, 30m, 2h; after 5
consecutive failed deliveries the webhook is deactivated (re-enable it via
`PATCH /api/crm/{CRM_ID}/webhooks/{id}` with `{"is_active": true}`).

---

## Which method should you use?

| Need | Use |
|---|---|
| Backfill / audit / charts of sub counts per day-week-month | `/subscribers/stats` (cached, 0 OnlyFans requests) |
| List of who subscribed in a window, with timestamps | `/subscribers/new` (cached, 0 OnlyFans requests) |
| Simple "check every few minutes" integration | `/events?types=…&since=<cursor>` |
| Live updates in your own backend, no public URL | SSE `/events/stream` |
| Live push to your server, most robust | Webhooks (signed, retried) |

Freshness: the poller runs every `interval_seconds` (300s on an account whose
polling was switched on by connecting it), so events and cache updates land
within one interval of the sub happening. A scheduled
full refresh additionally backfills the complete subscriber history, so
`/subscribers/new` and `/subscribers/stats` cover subs from **before** you
enabled polling too.

Rate limits: reads fall under `RATE_LIMIT_DEFAULT` (1000/min per API key by
default) and writes under `RATE_LIMIT_SENSITIVE` (100/min); the SSE stream is
exempt (one long-lived connection is fine). All three are configurable in
`.env` — see [SECURITY-HARDENING.md](SECURITY-HARDENING.md#rate-limiting).
