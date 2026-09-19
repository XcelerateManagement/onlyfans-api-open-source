# Multi-Tenant CRM API - Usage Guide

Flask API for managing OnlyFans accounts across multiple CRM panels with
complete isolation. The backend lives in `api/`; `https://your-install.example.com`
in the examples below is wherever you deployed it.

There is no billing, metering or quota layer in this build: no plans, no account
slots and no monthly API-call limit. The only limits are the per-minute
flask-limiter caps described in
[SECURITY-HARDENING.md](SECURITY-HARDENING.md#rate-limiting).

---

## Quick Start

### Step 1: Register a CRM Panel

```bash
curl -X POST https://your-install.example.com/api/crm/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My CRM Panel"}'
```

Response:
```json
{
  "success": true,
  "crm_id": "crm_a1b2c3d4e5f6g7h8",
  "api_key": "abcdef123456...",
  "name": "My CRM Panel"
}
```

**Save the `crm_id` and `api_key`!** You'll need them for all future requests.

---

### Step 2: Login an OnlyFans Account

**Without Proxy:**
```bash
curl -X POST https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/accounts/login \
  -H "Content-Type: application/json" \
  -H "X-API-Key: abcdef123456..." \
  -d '{
    "email": "creator@example.com",
    "password": "password123",
    "use_captcha": true
  }'
```

**With Proxy (saves proxy for later use):**
```bash
curl -X POST https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/accounts/login \
  -H "Content-Type: application/json" \
  -H "X-API-Key: abcdef123456..." \
  -H "X-Proxy: http://user:pass@proxy.example.com:8080" \
  -d '{
    "email": "creator@example.com",
    "password": "password123",
    "use_captcha": true
  }'
```

`use_captcha: true` needs a captcha provider key: set one per panel under
**Settings → Captcha provider**, or server-wide as `TWOCAPTCHA_API_KEY`. With
neither set this call fails with a message saying so; nothing else is affected,
because the key is not required to start the stack.

Response:
```json
{
  "success": true,
  "of_user_id": "123456789",
  "username": "examplecreator",
  "email": "creator@example.com",
  "proxy": "http://user:pass@proxy.example.com:8080"
}
```

The session and proxy are saved automatically. Future requests will use the saved proxy unless you override it.

---

### Step 3: Get All Accounts

```bash
curl https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/accounts \
  -H "X-API-Key: abcdef123456..."
```

Response:
```json
{
  "success": true,
  "count": 2,
  "accounts": [
    {
      "id": 1,
      "of_user_id": "123456789",
      "email": "creator@example.com",
      "username": "username",
      "created_at": "2025-11-03T05:00:00",
      "last_login": "2025-11-03T05:00:00"
    }
  ]
}
```

---

### Step 4: Call Any OnlyFans Endpoint (OF Proxy)

Once an account is logged in, you can forward any OnlyFans API request through your install. It handles all signing, session cookies, and authentication headers automatically — you just pass your API key and the OF user ID.

**Option A — Transparent Proxy (mirrors the OF URL directly):**

```bash
curl -X GET "https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/api2/v2/users/me" \
  -H "X-API-Key: abcdef123456..." \
  -H "user-id: 123456789"
```

The path after `/api/crm/{crm_id}/` maps directly to the OnlyFans API path. Query strings are forwarded as-is:

```bash
curl "https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/api2/v2/subscriptions/subscribers?limit=10&offset=0" \
  -H "X-API-Key: abcdef123456..." \
  -H "user-id: 123456789"
```

**Option B — Generic request endpoint:**

```bash
curl -X POST https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/accounts/123456789/request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: abcdef123456..." \
  -d '{
    "path": "/api2/v2/users/me",
    "method": "GET"
  }'
```

Both options return the raw OnlyFans API response:
```json
{
  "success": true,
  "status_code": 200,
  "data": {
    "id": 123456789,
    "username": "examplecreator",
    "name": "Display Name"
  }
}
```

---

## OF Proxy — First-Time Session Setup

The transparent proxy (`/api/crm/{crm_id}/api2/v2/...`) requires a saved session for the account. There are two ways to set one up:

### Method 1: Login via email/password (recommended)

Use Step 2 above. After a successful login the session is saved and all proxy requests work immediately.

### Method 2: Provide existing OnlyFans cookies on first request

If you already have a valid OnlyFans session, pass the cookies on your first proxy request using `-b`. The server saves the session — subsequent requests need no cookies.

| Cookie | Required | Description |
|--------|----------|-------------|
| `sess` | ✅ required | Main OnlyFans session token |
| `auth_id` | ✅ required | Your OnlyFans user ID |
| `fp` | optional | Fingerprint cookie |

Find these in your browser: **DevTools → Application → Cookies → onlyfans.com**

```bash
curl "https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/api2/v2/users/me" \
  -H "X-API-Key: abcdef123456..." \
  -H "user-id: 123456789" \
  -H "X-Proxy: http://user:pass@proxy.example.com:8080" \
  -b "sess=YOUR_SESS_COOKIE; auth_id=YOUR_AUTH_ID_COOKIE; fp=YOUR_FP_COOKIE"
```

After the first request the session is saved — subsequent requests no longer need the `-b` cookie flag.

---

## Proxy Header

A proxy is **required** for OF proxy requests. It can be provided in three ways (checked in this order):

1. `X-Proxy` request header
2. `proxy` field in the JSON request body (POST requests)
3. The proxy saved when the account was logged in (used automatically if no override is given)

```bash
# Override the saved proxy for a single request
curl "https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/api2/v2/users/me" \
  -H "X-API-Key: abcdef123456..." \
  -H "user-id: 123456789" \
  -H "X-Proxy: http://user:pass@newproxy.example.com:8080"
```

---

## Multi-Tenant Isolation

Each CRM panel is completely isolated:

1. **Unique CRM ID** — Each panel gets a unique identifier (e.g., `crm_a1b2c3d4e5f6g7h8`)
2. **API Key Authentication** — Every request requires the panel's API key via `X-API-Key` header
3. **Isolated Sessions** — Sessions are stored in `saved_sessions/{crm_id}/{of_user_id}.json`
4. **Database Isolation** — Accounts are linked to CRM panel ID in the database

Panel A cannot access Panel B's accounts — even with the same `of_user_id`, the API returns 404 because session files are isolated by `crm_id`.

---

## API Endpoints Reference

### POST /api/crm/register
Register a new CRM panel.

**Body:**
```json
{"name": "My CRM Panel"}
```

**Response:**
```json
{
  "success": true,
  "crm_id": "crm_xxx",
  "api_key": "xxx"
}
```

---

### POST /api/crm/{crm_id}/accounts/login
Login an OnlyFans account via email and password.

**Headers:**
- `X-API-Key`: Your API key
- `Content-Type`: application/json
- `X-Proxy`: Proxy URL (optional, saved for future use)

**Body:**
```json
{
  "email": "creator@example.com",
  "password": "password",
  "use_captcha": true
}
```

**Response:**
```json
{
  "success": true,
  "of_user_id": "123456",
  "username": "username"
}
```

---

### POST /api/crm/{crm_id}/accounts/login/cookies
Login using existing OnlyFans session cookies instead of email/password.

**Headers:**
- `X-API-Key`: Your API key
- `Content-Type`: application/json
- `X-Proxy`: Proxy URL (required)

**Body:**
```json
{
  "of_user_id": "123456789",
  "sess": "YOUR_SESS_COOKIE",
  "auth_id": "YOUR_AUTH_ID_COOKIE"
}
```

**Response:**
```json
{
  "success": true,
  "of_user_id": "123456789",
  "username": "username"
}
```

---

### GET /api/crm/{crm_id}/accounts
Get all accounts for a CRM panel.

**Headers:**
- `X-API-Key`: Your API key

**Response:**
```json
{
  "success": true,
  "count": 2,
  "accounts": [...]
}
```

---

### GET|POST|PATCH|PUT|DELETE /api/crm/{crm_id}/api2/v2/{of_path}
Transparent OF API proxy. Mirrors any OnlyFans API endpoint — the server injects session cookies and signed authentication headers automatically.

**Headers:**
- `X-API-Key`: Your API key (required)
- `user-id`: OnlyFans user ID of the account to use (required)
- `X-Proxy`: Proxy URL (optional — falls back to saved proxy from login)

**First request only (if no session exists):**
- `-b "sess=...; auth_id=..."`: OnlyFans session cookies to bootstrap the session

**Query parameters** are forwarded to OnlyFans as-is.

**Request body** (POST/PATCH/PUT) is forwarded as JSON.

**Example:**
```bash
curl "https://your-install.example.com/api/crm/crm_a1b2c3d4e5f6g7h8/api2/v2/subscriptions/subscribers?limit=10" \
  -H "X-API-Key: abcdef123456..." \
  -H "user-id: 123456789"
```

**Response:**
```json
{
  "success": true,
  "status_code": 200,
  "data": {...}
}
```

---

### POST /api/crm/{crm_id}/accounts/{of_user_id}/request
Make any authenticated OnlyFans API request (alternative to the transparent proxy).

**Headers:**
- `X-API-Key`: Your API key
- `Content-Type`: application/json
- `X-Proxy`: Proxy URL (optional — falls back to saved proxy from login)

**Body:**
```json
{
  "path": "/api2/v2/users/me",
  "method": "GET",
  "body": {}
}
```

**Response:**
```json
{
  "success": true,
  "status_code": 200,
  "data": {...}
}
```

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/notifications

**Headers:**
- `X-API-Key`: Your API key

**Query Parameters:**
- `limit`: Number of notifications (default: 20)

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/balances

**Headers:**
- `X-API-Key`: Your API key

**Response:**
```json
{
  "success": true,
  "balances": {
    "payoutAvailable": 2859.95,
    "payoutPending": 0,
    "currency": "USD",
    "withdrawalPeriod": "N/A"
  }
}
```

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/earnings

**Headers:**
- `X-API-Key`: Your API key

**Query Parameters:**
- `startDate`: Start date `"YYYY-MM-DD HH:MM:SS"` (required)
- `endDate`: End date (optional, defaults to now)
- `withTotal`: Include total calculations (default: true)

---

## Referrals

**OnlyFans only.** Fansly accounts get `501 platform_not_supported`
(`feature: "referrals"`) — no Fansly referral surface is known to this API.
Check `capabilities.referrals` on the account payload from `GET /accounts`
before showing a referrals UI.

All three routes are **live reads** (no cache). Each one may fan out to more
than one OnlyFans endpoint, so treat them as expensive relative to the
cache-backed routes.

> **Response shapes are passed through, not mapped.** OnlyFans' referral
> bodies were captured from the web client but their *item* fields were never
> confirmed, so rows are returned untouched and the raw upstream body is echoed
> under `data`. Treat any field inside a referral row as unverified.

### GET /api/crm/{crm_id}/accounts/{of_user_id}/referrals

The creators/users this account referred.

**Headers:**
- `X-API-Key`: Your API key
- `X-Proxy`: Proxy URL (optional — falls back to the account's saved proxy)

**Query Parameters** (all optional; forwarded upstream only when supplied — no
default date window is invented):
- `startDate`, `endDate`: `"YYYY-MM-DD"` or `"YYYY-MM-DD HH:MM:SS"`
- `offset`, `marker`: pagination
- `onlyPerformers`: restrict to referred creators
- `limit`

**Response:**
```json
{
  "success": true,
  "referrals": [],
  "count": 0,
  "hasMore": false,
  "data": { "list": [], "hasMore": false }
}
```

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/referrals/earnings

Referral money summary — balance and chart in one response (two OnlyFans calls).

**Headers:**
- `X-API-Key`: Your API key
- `X-Proxy`: Proxy URL (optional)

**Query Parameters** (forwarded to the chart call only):
- `startDate`, `endDate`
- `withTotal` (default `1`), `withChart` (default `true`), `filter`

**Response** — `balance` and `chart` hold the **raw** OnlyFans bodies; a source
that fails comes back `null` and `sources` records why:
```json
{
  "success": true,
  "balance": {},
  "chart": [],
  "sources": {
    "balance": { "ok": true, "status": 200 },
    "chart": { "ok": true, "status": 200 }
  }
}
```

If **both** sources fail the route returns the upstream status (e.g. `401`)
with `success: false` — an expired session must not look like "no referral
earnings".

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/referrals/payout-requests

Referral payout history — the referral twin of `/payout-requests`, shaped the
same way.

**Headers:**
- `X-API-Key`: Your API key
- `X-Proxy`: Proxy URL (optional)

**Query Parameters** (all optional): `startDate`, `endDate`, `offset`,
`marker`, `limit`

**Response:**
```json
{
  "success": true,
  "requests": [],
  "count": 0,
  "marker": null,
  "data": { "list": [], "marker": null }
}
```

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/campaigns

**Headers:**
- `X-API-Key`: Your API key

**Query Parameters:**
- `limit`: Number of campaigns (default: 10)
- `offset`: Pagination offset (default: 0)
- `stats`: Include statistics (default: true)
- `with_deleted`: Include deleted campaigns (default: 0)

**Note:** `countTransitions` = link clicks, `countSubscribers` = actual subscriptions from that link.

---

### POST /api/crm/{crm_id}/accounts/{of_user_id}/campaigns
Create a tracking link campaign.

**Headers:**
- `X-API-Key`: Your API key
- `Content-Type`: application/json

**Body:**
```json
{"name": "Campaign Name"}
```

---

### GET /api/crm/{crm_id}/accounts/{of_user_id}/subscribers/new
Incoming subscriptions with timestamps, newest first. Cache-backed — zero OF
requests.

**Query:** `since`, `until` (inclusive ISO-8601 bounds on `subscribed_at`),
`limit` (1–500, default 50), `offset`, `type` (`all`/`active`/`expired`)

### GET /api/crm/{crm_id}/accounts/{of_user_id}/subscribers/stats
Time-bucketed counts of incoming subscriptions for charting sub growth.

**Query:** `granularity` (`hour`/`day`/`week`/`month`, default `day`),
`since`, `until`

### GET /api/crm/{crm_id}/events
Persisted event log (new/renewed/expired subscriber, tips, messages, …).

**Query:** `types` (comma-separated), `of_user_id`, `since` (exclusive, on
`created_at` — use as a cursor), `until` (inclusive), `limit`

### GET /api/crm/{crm_id}/events/stream
Server-Sent-Events live stream. Optional `?types=` filters server-side.

See **LIVE_SUBSCRIBER_TRACKING.md** for a full integration guide (polling
setup, SSE, signed webhooks, sync patterns).

---

## Error Handling

| Error | Status | Meaning |
|-------|--------|---------|
| `Missing X-API-Key header` | 401 | No API key provided |
| `Invalid API key` | 403 | Wrong API key |
| `user-id header is required` | 400 | Missing `user-id` on proxy requests |
| `No session found. Provide sess and auth_id cookies...` | 401 | Account not logged in — login first or pass cookies |
| `Proxy is required. Provide X-Proxy header` | 400 | No proxy found in header or saved from login |

---

## Example: Managing Multiple CRM Panels

```python
import requests

BASE = "https://your-install.example.com"

# Register two CRM panels
panel_a = requests.post(f'{BASE}/api/crm/register', json={'name': 'Agency A'}).json()
panel_b = requests.post(f'{BASE}/api/crm/register', json={'name': 'Agency B'}).json()

# Login accounts for each panel
requests.post(f'{BASE}/api/crm/{panel_a["crm_id"]}/accounts/login',
    headers={'X-API-Key': panel_a['api_key']},
    json={'email': 'creator1@example.com', 'password': 'pass1', 'use_captcha': True})

requests.post(f'{BASE}/api/crm/{panel_b["crm_id"]}/accounts/login',
    headers={'X-API-Key': panel_b['api_key']},
    json={'email': 'creator2@example.com', 'password': 'pass2', 'use_captcha': True})

# Use the transparent proxy to call any OF endpoint
me = requests.get(
    f'{BASE}/api/crm/{panel_a["crm_id"]}/api2/v2/users/me',
    headers={'X-API-Key': panel_a['api_key'], 'user-id': '123456789'}
).json()

# Panel A cannot access Panel B's accounts — complete isolation
accounts_a = requests.get(f'{BASE}/api/crm/{panel_a["crm_id"]}/accounts',
    headers={'X-API-Key': panel_a['api_key']}).json()

accounts_b = requests.get(f'{BASE}/api/crm/{panel_b["crm_id"]}/accounts',
    headers={'X-API-Key': panel_b['api_key']}).json()
```
