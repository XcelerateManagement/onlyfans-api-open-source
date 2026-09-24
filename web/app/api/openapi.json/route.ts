import { NextResponse } from "next/server";
import { reversedOfPaths } from "./reversedOfPaths";

export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Open Source OnlyFans + Fansly API",
      version: "1.0.0",
      summary: "OnlyFans and Fansly API for agencies and developers — 200+ endpoints across a signed OnlyFans passthrough and a normalized, Fansly-aware CRM layer.",
      description:
        "# The Only API \u2014 OnlyFans & Fansly API\n\n**200+ endpoints** for agencies and developers: CRM routes plus OnlyFans passthrough routes. One API key, two platforms \u2014 **OnlyFans and Fansly via one normalized API**.\n\nYour CRM panel is the tenant boundary. Each panel manages a set of connected creator accounts (one \"slot\" per account), each with its own persisted session and proxy.\n\n## Platform support: OnlyFans and Fansly\n\nEvery connected account has a `platform` of either `onlyfans` or `fansly`. All three connection routes \u2014 `POST /accounts/login`, `POST /accounts/login/cookies`, `POST /accounts/login/verify-otp` \u2014 accept a `platform` field in the request body (`\"onlyfans\" | \"fansly\"`, default `\"onlyfans\"`).\n\nOnce connected, the account id is returned as `of_user_id` regardless of platform. That same value is the `{of_user_id}` path parameter and the `user-id` header everywhere in this spec.\n\n**Which surface supports which platform:**\n\n| Surface | OnlyFans | Fansly |\n| --- | --- | --- |\n| CRM data routes (`/accounts/...`, `/fans`, `/events`, `/webhooks`, `/automations`, `/exports`) | yes | yes |\n| Transparent passthrough (`/api2/v2/*`) | yes | **no \u2014 rejected** |\n| `POST /accounts/{of_user_id}/payout-requests`, `/campaigns/{campaign_id}/claimers` | yes | **no \u2014 rejected** |\n\nRequests to `/api2/v2/*` carrying a `user-id` that belongs to a Fansly account are rejected with an `unsupported` error. Use the platform-neutral CRM data routes instead (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...), which are Fansly-aware.\n\n## Two surfaces\n\n### 1. Transparent passthrough \u2014 `/api2/v2/*` (OnlyFans only)\n\nA thin, signed proxy. OnlyFans' own response body is passed through unchanged, but always wrapped in a small envelope: every `/api2/v2/*` response is `{ success, status_code, data }` (plus `relogin: true` when the session was refreshed mid-request). Check `success` first, then read the OnlyFans payload -- including `list`/`hasMore` on paginated endpoints -- from `data`. On error, `success` is false, `status_code` carries the upstream HTTP status, and `data` holds an `error` object with `code` and `message`. Throughout this spec, each `/api2/v2/*` response schema describes the shape of `data` (see the `OFPassthroughEnvelope` schema, and the vault endpoints for worked examples that show the full envelope).\n\nOnlyFans' API requires **signed headers** (`sign`, `time`, `app-token`) that rotate constantly, plus a live session cookie, plus a residential/datacenter proxy. We handle all of that. You hit our endpoints with a single `X-API-Key` + a `user-id` header, and we:\n\n1. Load the saved session for that account (cookies, `x-bc`, `x-hash`)\n2. Route the request through the account's proxy (so OF sees the same IP that logged in)\n3. Generate fresh signed headers server-side using the current OF signing algorithm\n4. Forward to `onlyfans.com/api2/v2/...`\n5. Return the raw JSON response\n\n### 2. Normalized CRM layer (OnlyFans + Fansly)\n\nOn this surface responses **are** normalized \u2014 OnlyFans and Fansly rows are projected to the same shape, and several routes are server-side aggregations with no platform equivalent to pass through:\n\n- **Cached reads that cost zero platform requests** \u2014 `/subscribers/cached`, `/subscribers/new`, `/subscribers/stats`, `/transactions/cached`, `/fans/{fan_id}/transactions/cached`, `/campaigns/{campaign_id}/claimers/cached`\n- **Async refresh + backfill jobs** \u2014 `POST /subscribers/refresh`, `POST /transactions/refresh`, `POST /campaigns/refresh`, `POST /backfill`. Each returns `202`; poll the matching `/refresh/status` route or listen on `GET /events/stream`.\n- **Cross-account earnings aggregation** \u2014 `GET /earnings/summary`\n- **Fan CRM** \u2014 `GET /fans` with tags, notes, and per-fan cached transactions\n- **Messaging** \u2014 `/chats`, `/chats/{with_user_id}/messages`, `POST /messages/mass` (mass DMs), `/ppv-stats`\n- **Data export jobs** \u2014 `/exports`, producing a downloadable ZIP\n- **Webhooks** \u2014 `/webhooks` with a delivery log and test fire\n- **Automations** \u2014 event-triggered actions, `/run-now`, run history\n- **Real-time events** \u2014 `GET /events` (poll) and `GET /events/stream` (SSE)\n- **Hosted MCP server** \u2014 `GET /api/whoami` resolves an API key to a panel; `PATCH /api/crm/{crm_id}/mcp/unsafe-proxy` toggles whether the MCP server may issue non-GET requests (off by default)\n\nAlso included: session management with automatic re-login, per-account proxy routing, and server-side request signing \u2014 .\n\n## Connecting an account\n\n### (A) Session paste \u2014 recommended\n\n**OnlyFans** \u2014 grab the session cookies (`sess`, `auth_id`, optionally `fp`) from a logged-in browser (**DevTools \u2192 Application \u2192 Cookies \u2192 onlyfans.com**), send them once with a proxy, and we store the session server-side. You never pass cookies again.\n\n```\nPOST /accounts/login/cookies\nX-API-Key: <your 43-char key>\nX-Proxy: http://user:pass@host:port      (required for OnlyFans)\n\n{\n  \"platform\": \"onlyfans\",\n  \"sess\": \"<sess cookie value>\",\n  \"auth_id\": \"<your OF user id>\",\n  \"fp\": \"<optional fingerprint cookie>\"\n}\n```\n\n**Fansly** \u2014 paste an auth token instead of cookies. `X-Proxy` is optional here.\n\n```\nPOST /accounts/login/cookies\nX-API-Key: <your 43-char key>\n\n{\n  \"platform\": \"fansly\",\n  \"auth_token\": \"<Fansly bearer token>\",\n  \"fansly_session_id\": \"<Fansly session id>\",\n  \"fansly_client_id\": \"<optional device/client id>\"\n}\n```\n\nProxies can be HTTP or SOCKS5 \u2014 `socks5://user:pass@host:port` (or `socks5h://` for proxy-side DNS) works anywhere a proxy is accepted.\n\n### (B) Credentials (email/username + password)\n\nWe handle the full login flow: Cloudflare init, Turnstile solve, signed login request, 2FA prompt if required.\n\n```\nPOST /accounts/login\nX-API-Key: <your 43-char key>\nX-Proxy: http://user:pass@host:port      (required for OnlyFans, optional for Fansly)\n\n{ \"platform\": \"onlyfans\", \"email\": \"...\", \"password\": \"...\", \"use_captcha\": true }\n```\n\nFor `platform: \"fansly\"` the `email` field accepts a **username or an email**.\n\nIf the platform demands 2FA, the response includes `requires_2fa: true` (Fansly additionally returns `twofa_type`). Submit the code via `POST /accounts/login/verify-otp`, passing the same `platform` and the same identifier you logged in with, plus an `X-Proxy` header.\n\n## Using the passthrough after connection\n\nOnce an OnlyFans account is connected, every `/api2/v2/*` request needs:\n\n- `X-API-Key: <your CRM key>` \u2014 **required**\n- `user-id: <of_user_id>` \u2014 **required**; which account to act as. Omitting it returns `400 user-id header is required`.\n- `X-Proxy: <proxy>` \u2014 optional; overrides the proxy saved at login time\n\nThe URL path mirrors the OnlyFans endpoint:\n\n```\nGET /api/crm/{crm_id}/api2/v2/users/me\nGET /api/crm/{crm_id}/api2/v2/subscriptions/subscribers?limit=10&type=active\nPOST /api/crm/{crm_id}/api2/v2/chats/{fan_id}/messages   (body: { \"text\": \"hi\" })\n```\n\nFull working example:\n\n```bash\ncurl \"{BASE_URL}/api/crm/crm_abc123/api2/v2/users/me\" \\\n  -H \"X-API-Key: <your 43-char key>\" \\\n  -H \"user-id: 482687148\"\n```\n\nThat's it. No cookie header, no signing, no proxy rotation \u2014 the saved session does the work. There is **no** cookie-bootstrap on this surface: the account must already be connected via `POST /accounts/login` or `POST /accounts/login/cookies`, otherwise the call returns `403 Account not found or does not belong to this CRM panel`.\n\n## Picking an account from your panel\n\n`GET /accounts` lists connected accounts and their ids. Add `?include_session=true` and each entry also carries a `session` block with `sess`, `auth_id`, and `proxy`. Either use those values directly, or just pass the `of_user_id` as the `user-id` header and let us resolve the rest.\n\n`DELETE /accounts/{of_user_id}` disconnects an account and frees its slot.\n\n## Session lifecycle\n\nSessions are persisted per CRM panel. If the platform invalidates a session (password changed, suspicious-activity lockout), we auto-retry with stored credentials when possible. If re-login fails, the endpoint returns `relogin_failed` \u2014 reconnect the account.\n\n## Authentication & API keys\n\nSend `X-API-Key` on every request. Keys are tied to your CRM panel \u2014 losing one is like losing a password.\n\nA panel has one **primary** key (named `Default`) plus unlimited **secondary** keys:\n\n- `GET /api-keys` \u2014 list all keys (active + revoked) with usage counts. Full key bodies are never returned.\n- `POST /api-keys` \u2014 mint a secondary key. **Primary key only.** The full key is returned **exactly once**, in this response, and is never retrievable again.\n- `DELETE /api-keys/{key_id}` \u2014 revoke a secondary key. **Primary key only.** The primary `Default` key cannot be revoked \u2014 rotate it instead.\n- `GET /api-keys/{key_id}/usage` \u2014 per-key usage detail (30/90-day series, month + all-time totals, endpoint breakdown).\n- `POST /rotate-key` \u2014 rotate the caller's own key. The old key dies immediately; the new key is returned once in the response body.\n\nCalling `POST /api-keys` or `DELETE /api-keys/{key_id}` with a secondary key returns `403`.\n\n`GET /api/whoami` resolves an API key to its `crm_id` \u2014 this is how the hosted MCP server turns a bearer token into a tenant.\n\n## Webhook signature verification\n\nEvery webhook delivery is a `POST` to your URL carrying these headers:\n\n| Header | Value |\n| --- | --- |\n| `X-OnlyAPI-Signature` | `sha256=<hex digest>` |\n| `X-OnlyAPI-Timestamp` | Unix timestamp in seconds — the same value that was signed |\n| `X-OnlyAPI-Event` | The event type, e.g. `new_tip` |\n| `X-OnlyAPI-Delivery-Id` | Unique id for this delivery attempt |\n\nThe signed message is **not** the raw body on its own. It is the timestamp, a literal `.`, then the raw request body:\n\n```\nmessage   = \"{X-OnlyAPI-Timestamp}.\" + raw_body\nsignature = \"sha256=\" + HMAC_SHA256(webhook_secret, message).hexdigest()\n```\n\nVerify it against the `X-OnlyAPI-Signature` header using a constant-time comparison:\n\n```python\nimport hmac, hashlib\n\ndef verify(secret: str, timestamp: str, raw_body: bytes, received: str) -> bool:\n    message = f\"{timestamp}.\".encode() + raw_body\n    expected = \"sha256=\" + hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()\n    return hmac.compare_digest(expected, received)\n\n# timestamp = request.headers[\"X-OnlyAPI-Timestamp\"]\n# received  = request.headers[\"X-OnlyAPI-Signature\"]\n# raw_body  = request.get_data()   # bytes, before any JSON parsing\n```\n\nSign the **raw** bytes exactly as received — re-serializing the parsed JSON can change the byte sequence and the signature will not match.\n\n## Base URL\n\n`{BASE_URL}/api/crm/{crm_id}`\n\n`{crm_id}` is your panel ID, found in the dashboard \u2192 Settings. Routes that are not scoped to a panel (`GET /health`, `GET /api/whoami`, `POST /api/auth/*`, `POST /api/crm/register`) live at `{BASE_URL}` instead and are documented here with their full path.\n\n## Rate limits\n\nPer-minute HTTP rate limits apply on every plan as anti-flood protection, independently of the monthly call quota:\n\n- **Default:** 1000 requests/minute\n- **Sensitive routes** (writes, key management, mass DMs, exports): 100 requests/minute\n- **Login routes** (`/accounts/login`, `/accounts/login/cookies`, `/accounts/login/verify-otp`): 20 requests/minute\n- **`POST /api/auth/login`:** 6 requests/minute\n- **`GET /health`** and **`GET /events/stream`** are exempt\n\nExceeding a limit returns `429`. Platform-side rate limits still apply per account (roughly 1 req/sec bursts are fine, sustained >5 req/sec will get an account flagged) \u2014 we don't enforce those, so pace your live calls and prefer the `/cached` routes, which cost zero platform requests.",
      contact: {
        name: "Open-source project support",
        url: "https://github.com/XcelerateManagement/onlyfans-api-open-source",
      },
    },
    servers: [
      {
        url: "{baseUrl}/api/crm/{crmId}",
        description: "CRM API Server",
        variables: {
          baseUrl: {
            default: "{BASE_URL}",
            description: "Backend server URL",
          },
          crmId: {
            default: "your-crm-id",
            description: "Your CRM panel ID",
          },
        },
      },
    ],
    tags: [
      {
        name: "Panel & Usage",
        description:
          "Panel signup, health, key→panel resolution, and plan/usage counters. Works for OnlyFans and Fansly panels alike.",
      },
      {
        name: "API Keys",
        description:
          "Primary + secondary API key management. `POST /api-keys` and `DELETE /api-keys/{key_id}` are PRIMARY-KEY ONLY (a secondary key gets 403). The primary `Default` key cannot be revoked — rotate it via `POST /rotate-key`.",
      },
      {
        name: "MCP",
        description:
          "Hosted MCP server support. `GET /api/whoami` turns a bearer token into a tenant; `PATCH /mcp/unsafe-proxy` toggles non-GET tool access (off by default).",
      },
      {
        name: "Auth",
        description:
          "Connect a creator account (OnlyFans or Fansly) and complete 2FA. All three routes accept `platform: \"onlyfans\" | \"fansly\"` and are rate limited to 10 requests/minute.",
      },
      {
        name: "Accounts",
        description:
          "Manage connected creator accounts (OnlyFans and Fansly), their polling settings, proxies, and slots.",
      },
      {
        name: "Earnings",
        description:
          "Revenue & earnings data, including the cross-account `GET /earnings/summary` aggregation. Fansly-aware.",
      },
      {
        name: "Subscribers",
        description:
          "Subscriber reads. Live routes hit the platform; `/subscribers/cached`, `/subscribers/new`, and `/subscribers/stats` cost zero platform requests and normalize OnlyFans + Fansly rows to the same shape.",
      },
      {
        name: "Cache & Sync",
        description:
          "Async refresh, backfill, and job-status routes that populate the local cache. Refresh routes return 202 — poll the matching `/refresh/status` route or listen on `GET /events/stream`.",
      },
      {
        name: "Fans",
        description:
          "Fan CRM across all accounts in the panel — tags, notes, per-fan cached transactions, profile refresh. Fansly-aware.",
      },
      {
        name: "Messaging",
        description:
          "Chats, single DMs/PPVs, mass DMs, and PPV performance stats. Fansly-aware.",
      },
      {
        // Must stay declared here: the docs generator only emits pages for
        // operations whose tag appears in the surface's top-level tag list, so
        // an undeclared tag silently produces no reference page at all.
        name: "Content",
        description:
          "Media upload. Runs OnlyFans' four-stage signed-S3 pipeline server-side and returns a reference you attach to a post, message or story via `mediaFiles`. OnlyFans only.",
      },
      {
        name: "Campaigns",
        description:
          "Tracking link campaigns, claimers, campaign tags, and the tracked-campaign allowlist.",
      },
      {
        name: "Transactions",
        description: "Payout & purchase transactions, live and cached.",
      },
      {
        name: "Notifications",
        description: "Account notifications. Fansly-aware.",
      },
      {
        name: "Settings",
        description: "Account settings, subscription price & proxy management",
      },
      {
        name: "Payouts",
        description:
          "Withdrawal requests and payout account details. Creating a withdrawal is OnlyFans only.",
      },
      {
        name: "Referrals",
        description:
          "OnlyFans referral programme — who the account referred, what it earned, and referral payout history. **OnlyFans only**: Fansly accounts get `501 platform_not_supported` (`feature: \"referrals\"`). Live reads, no cache; one quota call per request. OnlyFans' referral response bodies are passed through with minimal normalization — only the `list`/`hasMore`/`marker` envelope keys are read, and the raw body is echoed under `data`. Fields *inside* a referral row are unverified: do not depend on them without checking against a live account.",
      },
      {
        name: "Exports",
        description:
          "Async data export jobs producing a downloadable ZIP. Progress streams over `GET /events/stream`.",
      },
      {
        name: "Events & Streaming",
        description:
          "Real-time event feed — `GET /events` for polling, `GET /events/stream` for Server-Sent Events (rate-limit exempt).",
      },
      {
        name: "Webhooks",
        description:
          "Outbound webhook subscriptions, test fires, and delivery history.",
      },
      {
        name: "Automations",
        description:
          "Event-triggered automations, manual runs, and run history.",
      },
      {
        name: "Bulk Import",
        description:
          "Connect many creator accounts from one pasted list. `POST /import/preview` validates without side effects; `POST /import/jobs` runs the import in the background and streams `import.progress` / `import.complete` over `GET /events/stream`. Rows that hit a 2FA prompt park as `needs_2fa` until you supply a code.",
      },
      {
        name: "Integrations",
        description:
          "Third-party integrations. One Telegram channel per panel: pair it once, then matching events are delivered to that chat. The bot token is encrypted at rest and is never returned by any route.",
      },
      {
        name: "Proxy",
        description:
          "Generic authenticated OnlyFans API proxy (`POST /accounts/{of_user_id}/request`). OnlyFans only.",
      },
      {
        name: "OF API — User",
        description: "Direct proxy to OnlyFans user profile & settings endpoints. **OnlyFans only.** Requires `X-API-Key` + `user-id` headers.",
      },
      {
        name: "OF API — Subscribers",
        description: "OnlyFans subscriber endpoints (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Subscriptions",
        description: "OnlyFans subscription management (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Messaging",
        description: "OnlyFans chats & messages (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Content",
        description: "OnlyFans posts, vault, labels (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Stories",
        description: "OnlyFans stories (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Streams",
        description: "OnlyFans live streams (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Campaigns",
        description: "OnlyFans campaign endpoints (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Payouts",
        description: "OnlyFans payout & payment endpoints (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Notifications",
        description: "OnlyFans notification endpoints (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Lists",
        description: "OnlyFans user lists (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Promotions",
        description: "OnlyFans promotions & trials (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Helpers",
        description: "OnlyFans helper/manager accounts (via proxy). **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
      {
        name: "OF API — Misc",
        description: "Other OnlyFans endpoints. **OnlyFans only** — Fansly accounts are rejected on this surface.",
      },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Your CRM panel API key",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string" },
          },
        },
        // One row of a bulk import. Mirrors `import_job_rows`, minus every
        // credential column: passwords, TOTP secrets and cookies are reported
        // only as `has_*` booleans, and the 2FA challenge blob and internal
        // claim token never go over the wire at all.
        ImportJobRow: {
          type: "object",
          properties: {
            id: {
              type: "integer",
              description:
                "Row ID — this is the `{row_id}` for the OTP and retry routes.",
            },
            job_id: { type: "string" },
            row_index: {
              type: "integer",
              description: "Zero-based position within the paste.",
            },
            source_line: {
              type: "integer",
              nullable: true,
              description: "Line number in the original paste, for error display.",
            },
            lane: {
              type: "string",
              enum: ["cookie", "password"],
              description:
                "How this row connects: pasted session (`cookie`) or credentials (`password`).",
            },
            platform: { type: "string", enum: ["onlyfans", "fansly"] },
            email: { type: "string", nullable: true },
            label: {
              type: "string",
              nullable: true,
              description: "Optional per-row label from the paste.",
            },
            proxy: { type: "string", nullable: true },
            status: {
              type: "string",
              enum: [
                "pending",
                "running",
                "success",
                "needs_2fa",
                "needs_2fa_expired",
                "failed",
                "canceled",
                "invalid",
                "skipped",
                "slot_exhausted",
              ],
            },
            has_password: { type: "boolean" },
            has_totp_secret: { type: "boolean" },
            two_fa_expires_at: {
              type: "string",
              nullable: true,
              description: "When a parked 2FA challenge stops being answerable.",
            },
            two_fa_remaining_seconds: {
              type: "integer",
              nullable: true,
              description:
                "Seconds left on the 2FA window; `null` unless the row is parked.",
            },
            of_user_id: {
              type: "string",
              nullable: true,
              description: "Set once the account connects.",
            },
            username: { type: "string", nullable: true },
            error: { type: "string", nullable: true },
            error_reason: {
              type: "string",
              nullable: true,
              description: "Machine-readable failure cause; match on this, not `error`.",
            },
            permanent: {
              type: "boolean",
              description: "True when retrying cannot help.",
            },
            attempts: { type: "integer" },
            started_at: { type: "string", nullable: true },
            finished_at: { type: "string", nullable: true },
            created_at: { type: "string" },
            updated_at: { type: "string", nullable: true },
          },
        },
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
          },
        },
        OFMessage: {
          type: "object",
          description: "An OnlyFans chat message object.",
          properties: {
            id: { type: "integer" },
            text: { type: "string" },
            price: { type: "number", nullable: true },
            isFromQueue: { type: "boolean" },
            isOpened: { type: "boolean" },
            isNew: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            changedAt: { type: "string", format: "date-time" },
            isFree: { type: "boolean" },
            media: {
              type: "array",
              items: { $ref: "#/components/schemas/OFMedia" },
            },
            fromUser: { type: "object" },
          },
        },
        OFMedia: {
          type: "object",
          description:
            "Media item (photo/video/audio/gif). Returned by the vault endpoints and embedded in posts, messages, and stories.\n\n**No source fingerprint exists.** OnlyFans does NOT expose an original filename, content hash, upload source ID, or any immutable content fingerprint on this object — `id` is the only stable identifier. To correlate a local file with an existing vault item, use `GET /api2/v2/vault/media/hash?hash={md5}`. `files.*.size` is frequently `0` and must never be used as a fingerprint.",
          properties: {
            id: {
              type: "integer",
              description: "Stable OnlyFans media ID — the only persistent identifier for the item.",
            },
            type: {
              type: "string",
              enum: ["photo", "video", "audio", "gif"],
            },
            createdAt: { type: "string", format: "date-time" },
            duration: {
              type: "integer",
              description: "Duration in seconds (video/audio; 0 for photos).",
            },
            convertedToVideo: { type: "boolean" },
            canView: { type: "boolean" },
            isReady: {
              type: "boolean",
              description: "False while OnlyFans is still processing/transcoding the upload.",
            },
            hasError: { type: "boolean" },
            hasPosts: { type: "boolean", description: "Whether the media is attached to any post." },
            hasCustomPreview: { type: "boolean" },
            counters: {
              type: "object",
              description: "Engagement counters (present on the vault view).",
              properties: {
                buyersCount: { type: "integer" },
                likesCount: { type: "integer" },
                tipsSumm: { type: "number" },
              },
            },
            listStates: {
              type: "array",
              description: "Which vault lists (folders) this media belongs to.",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer", description: "Vault list ID." },
                  name: { type: "string", description: "Vault list name." },
                  hasMedia: { type: "boolean" },
                  canAddMedia: { type: "boolean" },
                },
              },
            },
            files: {
              type: "object",
              description:
                "Signed, time-limited CDN URLs at several resolutions. `size` is frequently `0` — do not rely on it.",
              properties: {
                full: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    width: { type: "integer" },
                    height: { type: "integer" },
                    size: {
                      type: "integer",
                      description: "Frequently 0 — not a reliable fingerprint.",
                    },
                  },
                },
                preview: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    width: { type: "integer" },
                    height: { type: "integer" },
                  },
                },
                thumb: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    width: { type: "integer" },
                    height: { type: "integer" },
                  },
                },
                squarePreview: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                    width: { type: "integer" },
                    height: { type: "integer" },
                  },
                },
              },
            },
            videoSources: {
              type: "object",
              description: "Per-resolution video URLs (e.g. `240`, `720`); entries are null when not applicable.",
              additionalProperties: { type: "string", nullable: true },
            },
          },
        },
        OFPost: {
          type: "object",
          description: "An OnlyFans post object.",
          properties: {
            id: { type: "integer" },
            text: { type: "string" },
            rawText: { type: "string" },
            price: { type: "number", nullable: true },
            isOpened: { type: "boolean" },
            isPinned: { type: "boolean" },
            postedAt: { type: "string", format: "date-time" },
            postedAtPrecise: { type: "string" },
            expiredAt: { type: "string", format: "date-time", nullable: true },
            commentsCount: { type: "integer" },
            favoritesCount: { type: "integer" },
            tipsAmount: { type: "number" },
            media: {
              type: "array",
              items: { $ref: "#/components/schemas/OFMedia" },
            },
            author: { type: "object" },
            canComment: { type: "boolean" },
            canEdit: { type: "boolean" },
            hasVoting: { type: "boolean" },
            voting: {
              type: "array",
              nullable: true,
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  text: { type: "string" },
                  votesCount: { type: "integer" },
                  isSelected: { type: "boolean" },
                },
              },
            },
          },
        },
        OFStream: {
          type: "object",
          description: "A live stream object.",
          properties: {
            id: { type: "integer" },
            title: { type: "string" },
            description: { type: "string" },
            isActive: { type: "boolean" },
            startedAt: { type: "string", format: "date-time" },
            room: { type: "string" },
            thumbUrl: { type: "string" },
            viewersCount: { type: "integer" },
            likesCount: { type: "integer" },
            tipsAmount: { type: "number" },
          },
        },
        OFStory: {
          type: "object",
          description: "A story object.",
          properties: {
            id: { type: "integer" },
            userId: { type: "integer" },
            createdAt: { type: "string", format: "date-time" },
            expiredAt: { type: "string", format: "date-time" },
            isReady: { type: "boolean" },
            isWatched: { type: "boolean" },
            media: {
              type: "array",
              items: { $ref: "#/components/schemas/OFMedia" },
            },
            question: { type: "string", nullable: true },
          },
        },
        OFUserProfile: {
          type: "object",
          description: "Full OnlyFans user profile object.",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            username: { type: "string" },
            displayName: { type: "string", nullable: true },
            about: { type: "string" },
            avatar: { type: "string", description: "Avatar URL" },
            avatarThumbs: {
              type: "object",
              properties: {
                c50: { type: "string" },
                c144: { type: "string" },
              },
            },
            header: { type: "string", description: "Profile header/banner URL" },
            email: { type: "string" },
            isVerified: { type: "boolean" },
            isPerformer: { type: "boolean" },
            canEarn: { type: "boolean" },
            tipsEnabled: { type: "boolean" },
            subscribedBy: { type: "boolean", description: "Whether you are subscribed to this user" },
            subscribersCount: { type: "integer" },
            subscribesCount: { type: "integer" },
            postsCount: { type: "integer" },
            photosCount: { type: "integer" },
            videosCount: { type: "integer" },
            audiosCount: { type: "integer" },
            friendsCount: { type: "integer" },
            joinDate: { type: "string", format: "date-time" },
            firstPublishedPostDate: { type: "string", format: "date-time", nullable: true },
            subscribePrice: { type: "number" },
            chatMessagesCount: { type: "integer", description: "Unread chat messages" },
            countPriorityChat: { type: "integer" },
            countPinnedChat: { type: "integer" },
            hasPurchasedPosts: { type: "boolean" },
            paidFeed: { type: "boolean" },
            openseaInfo: { type: "object", nullable: true },
          },
        },
        OFUserSettings: {
          type: "object",
          description: "Account settings object.",
          properties: {
            needUpdateBanking: { type: "boolean", description: "Whether banking info needs updating" },
            canReceiveManualPayout: { type: "boolean", description: "Manual payout eligibility" },
            isVerifiedReason: { type: "string", nullable: true, description: "Verification status reason code" },
            needVerifyPayoutData: { type: "boolean", description: "Whether payout data verification is needed" },
          },
        },
        OFUserStat: {
          type: "object",
          description: "User statistics / analytics.",
          properties: {
            earnings: { type: "number" },
            revenue: { type: "number" },
            views: { type: "integer" },
            purchases: { type: "integer" },
            tips: { type: "number" },
            comments: { type: "integer" },
            likes: { type: "integer" },
          },
        },
        OFChat: {
          type: "object",
          description: "A chat thread object.",
          properties: {
            id: { type: "integer" },
            withUser: { $ref: "#/components/schemas/OFUserProfile" },
            lastMessage: { $ref: "#/components/schemas/OFMessage" },
            unreadMessagesCount: { type: "integer" },
          },
        },
        OFMessageTemplate: {
          type: "object",
          description: "A saved message template.",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            content: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        OFVaultList: {
          type: "object",
          description: "A vault (media library) list/folder.",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            photosCount: { type: "integer" },
            videosCount: { type: "integer" },
            gifsCount: { type: "integer" },
            audiosCount: { type: "integer" },
            hasMedia: { type: "boolean" },
            canUpdate: { type: "boolean" },
            canDelete: { type: "boolean" },
            medias: {
              type: "array",
              description: "A few thumbnail previews (type + url) used as the folder cover.",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  url: { type: "string" },
                },
              },
            },
          },
        },
        OFLabel: {
          type: "object",
          description: "A user-created label/category for organizing content.",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            postsCount: { type: "integer" },
            type: { type: "string" },
          },
        },
        OFList: {
          type: "object",
          description: "A user list (fans, bookmarks, custom).",
          properties: {
            id: { type: "integer" },
            name: { type: "string" },
            type: { type: "string", description: "List type (e.g. 'archived', 'private_archived', or standard)" },
            postsCount: { type: "integer" },
            usersCount: { type: "integer" },
            customOrderEnabled: { type: "boolean" },
          },
        },
        OFCampaign: {
          type: "object",
          description: "A tracking-link campaign with click/subscriber stats.",
          properties: {
            id: { type: "integer", example: 12345 },
            campaignName: { type: "string", example: "My Campaign" },
            campaignCode: { type: "string", description: "Short code / slug used in the tracking URL" },
            countTransitions: {
              description: "Number of link clicks. May be an integer or `{ count, date }` object when stats=true.",
              oneOf: [
                { type: "integer" },
                { type: "object", properties: { count: { type: "integer" }, date: { type: "string" } } },
              ],
            },
            countSubscribers: {
              description: "Number of subscribers gained through this campaign. May be an integer or `{ count, date }` object.",
              oneOf: [
                { type: "integer" },
                { type: "object", properties: { count: { type: "integer" }, date: { type: "string" } } },
              ],
            },
            createdAt: { type: "string", format: "date-time" },
            sharedWith: {
              type: "array",
              description: "Users this campaign link is shared with",
              items: { $ref: "#/components/schemas/OFUserProfile" },
            },
          },
        },
        OFPromotion: {
          type: "object",
          description: "A subscription promotion (a discounted or free-trial offer to your list).",
          properties: {
            id: { type: "integer" },
            type: { type: "string", description: "Promotion type, e.g. 'promotion' or 'free_trial'." },
            message: { type: "string" },
            rawMessage: { type: "string" },
            price: { type: "number", description: "Discounted subscription price." },
            subscribeDays: { type: "integer", description: "Duration the promo subscription lasts." },
            subscribeCounts: { type: "integer" },
            claimsCount: { type: "integer" },
            canClaim: { type: "boolean" },
            hasRelatedPromo: { type: "boolean" },
            isFinished: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            finishedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        OFTrial: {
          type: "object",
          description: "A free trial link.",
          properties: {
            id: { type: "integer" },
            code: { type: "string", description: "Trial link code" },
            isFinished: { type: "boolean" },
            sharedWith: { type: "array", items: { type: "object" } },
          },
        },
        OFHelper: {
          type: "object",
          description: "A helper/manager account with delegated access.",
          properties: {
            userId: { type: "integer" },
            user: { $ref: "#/components/schemas/OFUserProfile" },
          },
        },
        OFBookmarkCategory: {
          type: "object",
          description: "A bookmark collection/category.",
          properties: {
            id: { type: "string", description: "'all' for all bookmarks, or numeric ID" },
            name: { type: "string" },
          },
        },
        OFInitPayload: {
          type: "object",
          description: "App initialization data — config, feature flags, and authenticated user state.",
          properties: {
            user: { $ref: "#/components/schemas/OFUserProfile" },
            chatMessagesCount: { type: "integer" },
            countPriorityChat: { type: "integer" },
            countPinnedChat: { type: "integer" },
            hasPurchasedPosts: { type: "boolean" },
            paidFeed: { type: "boolean" },
          },
        },
        PaginatedList: {
          type: "object",
          description: "Standard paginated response wrapper used by most OF API list endpoints.",
          properties: {
            list: { type: "array", items: { type: "object" } },
            hasMore: { type: "boolean" },
          },
        },
        OFPassthroughEnvelope: {
          type: "object",
          description:
            "Standard wrapper around EVERY `/api2/v2/*` passthrough response. OnlyFans' raw body is nested under `data` — check `success` first, then read `data` (which itself usually contains `list`/`hasMore` or the OF object). On an error, `success` is `false`, `status_code` carries the upstream HTTP status, and `data` typically holds `{ error: { code, message } }`. A `relogin: true` field is added when the session was refreshed mid-request.",
          properties: {
            success: { type: "boolean", description: "True when OnlyFans returned a 2xx status." },
            status_code: { type: "integer", description: "The upstream OnlyFans HTTP status code." },
            data: { description: "The raw OnlyFans response body (object or array)." },
            relogin: { type: "boolean", description: "Present and true when the session was refreshed mid-request." },
          },
          required: ["success", "status_code", "data"],
        },
      },
      parameters: {
        ofUserId: {
          name: "of_user_id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description:
            "Creator account ID of the connected account (OnlyFans or Fansly). Use `GET /accounts` to list connected accounts and their IDs.",
        },
        ofUserIdHeader: {
          name: "user-id",
          in: "header",
          required: true,
          schema: { type: "string" },
          description:
            "Creator account ID of the account to act as (e.g. `509955039`). **Required** — omitting it returns `400 user-id header is required`. Use `GET /accounts` to list your connected accounts. On `/api2/v2/*` the account must be an OnlyFans account; Fansly accounts are rejected there.",
          example: "509955039",
        },
        proxyHeader: {
          name: "X-Proxy",
          in: "header",
          required: false,
          schema: { type: "string" },
          description:
            "Proxy URL — HTTP or SOCKS5 (e.g. http://user:pass@host:port or socks5://user:pass@host:port). Optional on post-connection routes, where it overrides the proxy saved at login time. **Required on the connection routes** (`POST /accounts/login`, `POST /accounts/login/cookies`, `POST /accounts/login/verify-otp`) for OnlyFans accounts; optional for Fansly.",
        },
        fanId: {
          name: "fan_id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Fan's platform user ID.",
        },
        // Same value as `fanId`, different template name. The tag/note routes
        // spell the Flask path variable `fan_of_user_id`, and the spec matching
        // the source is worth more than one shared component.
        fanOfUserId: {
          name: "fan_of_user_id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description:
            "Fan's platform user ID — the same value returned as `of_user_id` on a row from `GET /fans`, not an internal database id.",
        },
        importJobId: {
          name: "job_id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description:
            "Import job ID (32-character hex) returned by `POST /import/jobs`.",
        },
        importRowId: {
          name: "row_id",
          in: "path",
          required: true,
          schema: { type: "integer" },
          description:
            "Row ID within the import job — the `id` field of a row from `GET /import/jobs/{job_id}`, not its `row_index`.",
        },
        refreshKind: {
          name: "kind",
          in: "path",
          required: true,
          schema: { type: "string", enum: ["subs", "tx", "campaigns"] },
          description:
            "Which refresh job to act on: `subs` (subscribers), `tx` (transactions), or `campaigns` (campaign claimers).",
        },
        campaignId: {
          name: "campaign_id",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Tracking-link campaign ID.",
        },
        limitParam: {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 100 },
          description: "Maximum number of rows to return.",
        },
        offsetParam: {
          name: "offset",
          in: "query",
          schema: { type: "integer", default: 0 },
          description: "Row offset for pagination.",
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      // Reverse-engineered OF /api2/v2 endpoints (auto-generated). Spread first
      // so any hand-written path below overrides the generated stub on collision.
      ...reversedOfPaths,
      // ══════════════════════════════════════════════════════════
      //  CRM ENDPOINTS
      // ══════════════════════════════════════════════════════════

      // ── Accounts / Auth ──
      "/accounts": {
        get: {
          tags: ["Accounts"],
          summary: "List connected accounts",
          description:
            "Returns every creator account connected to this CRM panel — OnlyFans and Fansly. Each entry carries `of_user_id`, `username`, and `platform` (`\"onlyfans\"` or `\"fansly\"`). Use `of_user_id` as the `{of_user_id}` path parameter and as the `user-id` header elsewhere in this API.",
          parameters: [
            {
              name: "include_session",
              in: "query",
              required: false,
              schema: { type: "boolean", default: false },
              description:
                "Include the per-account session block (`sess`, `auth_id`, `proxy`) in each entry.",
            },
          ],
          responses: {
            "200": {
              description: "Account list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      count: { type: "integer" },
                      accounts: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            of_user_id: { type: "string" },
                            username: { type: "string" },
                            platform: {
                              type: "string",
                              enum: ["onlyfans", "fansly"],
                            },
                            session: {
                              type: "object",
                              description:
                                "Only present when `include_session=true`.",
                              properties: {
                                sess: { type: "string" },
                                auth_id: { type: "string" },
                                proxy: { type: "string", nullable: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  example: {
                    success: true,
                    count: 2,
                    accounts: [
                      { of_user_id: "482687148", username: "creator_one", platform: "onlyfans" },
                      { of_user_id: "739104882", username: "creator_two", platform: "fansly" },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      "/accounts/{of_user_id}": {
        delete: {
          tags: ["Accounts"],
          summary: "Disconnect an account",
          description:
            "Delete/disconnect a creator account from this CRM panel, freeing its slot. Works for OnlyFans and Fansly accounts. This is the only way to release a paid slot.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: {
            "200": {
              description: "Account disconnected and its slot released",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SuccessResponse" },
                },
              },
            },
            "404": { description: "Account not found in this panel" },
          },
        },
      },
      "/accounts/login": {
        post: {
          tags: ["Auth"],
          summary: "Connect an account with credentials (OnlyFans or Fansly)",
          description:
            "Connect a new creator account via email/username + password. Set `platform` to `\"onlyfans\"` (default) or `\"fansly\"`.\n\n- **X-Proxy header is REQUIRED for OnlyFans**, optional for Fansly. You may pass `proxy` in the body as an alternative.\n- For `platform: \"fansly\"` the `email` field accepts a **username or an email**.\n- Supports 2FA: if the account has 2FA enabled the response includes `requires_2fa: true` (Fansly also returns `twofa_type`), and you must call `POST /accounts/login/verify-otp` next with the same `platform` and identifier.\n\nConsumes one account slot. Rate limited to 10 requests/minute.",
          parameters: [{ $ref: "#/components/parameters/proxyHeader" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    platform: {
                      type: "string",
                      enum: ["onlyfans", "fansly"],
                      default: "onlyfans",
                      description:
                        "Which platform to connect. Defaults to `onlyfans` when omitted.",
                    },
                    email: {
                      type: "string",
                      example: "user@example.com",
                      description:
                        "Account identifier. An email for OnlyFans; a **username or an email** for Fansly.",
                    },
                    password: { type: "string", example: "your_password" },
                    use_captcha: {
                      type: "boolean",
                      default: true,
                      description: "Use captcha solver for login",
                    },
                    proxy: {
                      type: "string",
                      nullable: true,
                      example: "http://user:pass@host:port",
                      description:
                        "Proxy for this account — alternative to the `X-Proxy` header. Required for OnlyFans (via header or here), optional for Fansly.",
                    },
                  },
                },
                examples: {
                  onlyfans: {
                    summary: "OnlyFans (X-Proxy header required)",
                    value: {
                      platform: "onlyfans",
                      email: "user@example.com",
                      password: "your_password",
                      use_captcha: true,
                    },
                  },
                  fansly: {
                    summary: "Fansly (username accepted, proxy optional)",
                    value: {
                      platform: "fansly",
                      email: "creator_username",
                      password: "your_password",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Login successful or 2FA required",
              content: {
                "application/json": {
                  examples: {
                    success: {
                      summary: "Successful login",
                      value: {
                        success: true,
                        of_user_id: "123456789",
                        username: "example_user",
                        email: "user@example.com",
                        avatar: "https://...",
                      },
                    },
                    twofa: {
                      summary: "2FA required",
                      value: {
                        success: false,
                        requires_2fa: true,
                        otp_state: "...",
                        email: "user@example.com",
                      },
                    },
                  },
                },
              },
            },
            "424": {
              description:
                "The proxy failed. `reason: \"proxy_blocked\"` means OnlyFans refused logins from the proxy's IP (`blocked_ip`, `ray_id` included) — retry with a different proxy. `reason: \"proxy_error\"` means the proxy itself could not reach OnlyFans.",
              content: {
                "application/json": {
                  example: {
                    success: false,
                    error:
                      "Proxy blocked: OnlyFans refused logins from this proxy's IP address. Blocked IP: 203.0.113.7.",
                    suggestion:
                      "Use a different proxy — a residential or mobile IP in the account's usual country — and try again.",
                    reason: "proxy_blocked",
                    connection_state: "proxy_blocked",
                    retryable: true,
                    blocked_ip: "203.0.113.7",
                    ray_id: "8f1c2d3e4a5b6c7d",
                  },
                },
              },
            },
            "503": {
              description:
                "OnlyFans login is temporarily unavailable (`reason: \"temporary_error\"` or `\"sync_blocked\"`). The body carries `retry_after` (seconds). Every connect error also carries a `suggestion` — what to do next.",
            },
            "500": { description: "Login failed" },
          },
        },
      },
      "/accounts/login/cookies": {
        post: {
          tags: ["Auth"],
          summary: "Connect an account with an existing session (OnlyFans or Fansly)",
          description:
            "Connect a creator account using credentials you already hold, rather than a password login.\n\n- **OnlyFans** — session cookie paste. Body: `{ sess, auth_id, fp? }`. `sess` and `auth_id` are **required for OnlyFans only**. **`X-Proxy` is REQUIRED.**\n- **Fansly** — auth-token paste. Body: `{ platform: \"fansly\", auth_token, fansly_session_id, fansly_client_id? }`. `auth_token` and `fansly_session_id` are **required for Fansly**. `X-Proxy` is optional.\n\nWhere to find the OnlyFans cookies: open onlyfans.com while logged in → **DevTools → Application → Cookies → onlyfans.com** and copy `sess` and `auth_id`.\n\nConsumes one account slot. Rate limited to 10 requests/minute.",
          parameters: [{ $ref: "#/components/parameters/proxyHeader" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description:
                    "Field requirements are conditional on `platform`: OnlyFans requires `sess` + `auth_id`; Fansly requires `auth_token` + `fansly_session_id`.",
                  properties: {
                    platform: {
                      type: "string",
                      enum: ["onlyfans", "fansly"],
                      default: "onlyfans",
                      description:
                        "Which platform to connect. Defaults to `onlyfans` when omitted.",
                    },
                    sess: {
                      type: "string",
                      description:
                        "The `sess` cookie value. **Required for OnlyFans**, unused for Fansly.",
                    },
                    auth_id: {
                      type: "string",
                      description:
                        "The `auth_id` cookie value (OnlyFans user ID). **Required for OnlyFans**, unused for Fansly.",
                    },
                    fp: {
                      type: "string",
                      description:
                        "The `fp` fingerprint cookie (OnlyFans, optional — used as `x-bc`).",
                    },
                    auth_token: {
                      type: "string",
                      description:
                        "Fansly bearer/auth token. **Required for Fansly**, unused for OnlyFans.",
                    },
                    fansly_session_id: {
                      type: "string",
                      description:
                        "Fansly session ID. **Required for Fansly**, unused for OnlyFans.",
                    },
                    fansly_client_id: {
                      type: "string",
                      description:
                        "Fansly device/client ID (optional, Fansly only).",
                    },
                  },
                },
                examples: {
                  onlyfans: {
                    summary: "OnlyFans — cookie paste (X-Proxy required)",
                    value: {
                      platform: "onlyfans",
                      sess: "<sess cookie value>",
                      auth_id: "482687148",
                      fp: "<optional fingerprint cookie>",
                    },
                  },
                  fansly: {
                    summary: "Fansly — auth-token paste (X-Proxy optional)",
                    value: {
                      platform: "fansly",
                      auth_token: "<Fansly bearer token>",
                      fansly_session_id: "<Fansly session id>",
                      fansly_client_id: "<optional device id>",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Account connected",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      of_user_id: { type: "string" },
                      username: { type: "string" },
                      platform: {
                        type: "string",
                        enum: ["onlyfans", "fansly"],
                      },
                      login_method: {
                        type: "string",
                        example: "cookies",
                      },
                    },
                  },
                },
              },
            },
            "401": { description: "Invalid or expired session credentials" },
          },
        },
      },
      "/accounts/login/verify-otp": {
        post: {
          tags: ["Auth"],
          summary: "Verify 2FA OTP code (OnlyFans or Fansly)",
          description:
            "Complete a 2FA login started by `POST /accounts/login`.\n\n- Pass the same `platform` and the same identifier you logged in with. For `platform: \"fansly\"` the `email` field may be a **username**.\n- The Fansly 2FA challenge returned by `POST /accounts/login` carries a `twofa_type` field indicating the delivery channel.\n- **The `X-Proxy` header is required.**\n\nRate limited to 10 requests/minute.",
          parameters: [
            {
              name: "X-Proxy",
              in: "header",
              required: true,
              schema: { type: "string" },
              description:
                "Proxy URL — **required** on this route. Use the same proxy the login attempt was made through.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "otp_code"],
                  properties: {
                    platform: {
                      type: "string",
                      enum: ["onlyfans", "fansly"],
                      default: "onlyfans",
                      description:
                        "Must match the `platform` used on `POST /accounts/login`.",
                    },
                    email: {
                      type: "string",
                      example: "user@example.com",
                      description:
                        "The same identifier used on `POST /accounts/login`. An email for OnlyFans; a **username or an email** for Fansly.",
                    },
                    otp_code: {
                      type: "string",
                      example: "123456",
                      description: "6-digit OTP code",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "OTP verified, account connected" },
            "404": { description: "2FA session not found or expired — start the login again" },
            "424": {
              description:
                "`status: \"proxy_blocked\"` — OnlyFans refused the proxy's IP (`blocked_ip`, `ray_id` included). The parked challenge is dropped; start the login again with a different proxy (see `suggestion`).",
            },
            "503": {
              description:
                "`status: \"transport_error\"` — OnlyFans could not be reached. The code stays valid for a few minutes; retry after `retry_after` seconds (see `suggestion`).",
            },
          },
        },
      },

      // ── Notifications ──
      // ── Media upload ──
      "/accounts/{of_user_id}/media": {
        post: {
          tags: ["Content"],
          summary: "Upload media to the vault",
          description:
            "Upload a photo, video, gif or audio file to the account's vault, and get back a reference you can attach to a post, message or story.\n\n**Two ways to call it:**\n\n1. `multipart/form-data` with a `file` part — raw bytes.\n2. `application/json` with `{\"source_url\": \"https://…\"}` — we fetch the file server-side. Use this when your media already lives somewhere public (Drive, S3, a CDN); it saves you building a multipart request at all.\n\n**What happens under the hood.** OnlyFans has no single upload endpoint. The web client runs a four-stage pipeline and so do we: `POST /api2/v2/upload/signed/create` → `PUT` the bytes straight to the returned pre-signed S3 URL (5 MiB parts for files ≥ 5 MiB) → `POST /api2/v2/upload/signed/finish` → hand the S3 descriptor to OnlyFans' converter host. You do not have to orchestrate any of that.\n\n**Using the result.** Put the returned `media` object into the post/message's **`mediaFiles`** array — not `media`, which OnlyFans silently ignores for freshly uploaded files. Pass the object through whole; trimming it to just `processId` also silently attaches nothing:\n\n```json\n{ \"text\": \"new set 🔥\",\n  \"mediaFiles\": [ { \"processId\": \"0ifuov…\", \"host\": \"convert4.onlyfans.com\", \"thumbId\": 1, \"name\": \"IMG_2676.HEIC\", \"extra\": \"…\" } ],\n  \"isScheduled\": 1, \"scheduledDate\": \"2026-08-20T12:00:00+00:00\" }\n```\n\n⚠️ Two things that fail *silently*, both confirmed on a live account:\n\n* Using `media` instead of `mediaFiles`, or trimming the object down to `{processId}`, returns `200` with **no media attached**.\n* **`postedAt` does not schedule anything.** In either format (`…Z` or `…+00:00`) OnlyFans ignores it and publishes immediately — verified live. Scheduling requires **two** fields instead:\n\n```json\n{ \"isScheduled\": 1, \"scheduledDate\": \"2026-08-20T12:00:00+00:00\" }\n```\n\nAlways confirm the post actually queued by checking `GET /api2/v2/schedules` for its id — a post that published instead of queueing looks identical in the create response apart from `postedAt`.\n\nMedia already in the vault is still referenced by plain integer id — list those with `GET /api2/v2/vault/media`.\n\n**An upload does not by itself create a vault item, and that matches OnlyFans exactly.** OnlyFans has no upload-to-vault endpoint: its own vault page is browse/organise only (list, hide, folders, attach), and the uploader is wired solely into the post/message composer. The vault entry is created when a post, message or story consumes the `processId`. So immediately after this call the file will *not* appear in `GET /api2/v2/vault/media`, nor in `GET /api2/v2/vault/media/processing`, nor under `GET /api2/v2/vault/media/hash?h={md5}&size={bytes}` — that last one is the lookup OnlyFans' own client uses to decide whether a file is already in the vault, and it answers `404 Media Not Found`. Publish or schedule with the `processId` and the vault row appears. This is the same behaviour you get clicking upload in the OnlyFans web app.\n\n**Working example:** a runnable Python client covering upload, immediate posting and scheduling — including every silent-failure case above — is at `examples/` in the repository.\n\n**Requires writes to be enabled** for the account (`PATCH /accounts/{of_user_id}/polling {\"allow_of_write_actions\": true}`), because uploading acts as the creator.\n\n**OnlyFans only.** The Fansly upload pipeline is not wired yet; a Fansly account returns 501.\n\n*(This replaces the long-documented `POST /api2/v2/media`, which never existed.)*",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["file"],
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "The media file to upload.",
                    },
                    secure: {
                      type: "boolean",
                      description:
                        "Upload to the secure (DRM) path instead of the standard one.",
                      default: false,
                    },
                  },
                },
              },
              "application/json": {
                schema: {
                  type: "object",
                  required: ["source_url"],
                  properties: {
                    source_url: {
                      type: "string",
                      format: "uri",
                      description:
                        "Publicly reachable http(s) URL of the file. Fetched server-side. Private/loopback/link-local addresses are rejected.\n\nThe URL must return the **file bytes**, not a viewer page. If it serves HTML the request fails at `stage: \"fetch\"` with an explicit message rather than a confusing converter error. For Google Drive that means the file must be shared as \"Anyone with the link\" and the URL must be the direct-download form `https://drive.google.com/uc?export=download&id=FILE_ID` — a normal `/file/d/.../view` link returns a viewer page, and large files return a virus-scan interstitial instead of the bytes.",
                      example: "https://example.com/photos/set-01.jpg",
                    },
                    filename: {
                      type: "string",
                      description:
                        "Override the filename. Defaults to the last path segment of source_url.",
                    },
                    secure: {
                      type: "boolean",
                      description: "Upload to the secure (DRM) path.",
                      default: false,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Upload complete",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      media: {
                        type: "object",
                        description:
                          "Ready to drop into a post/message `media` array.",
                        properties: {
                          processId: { type: "string" },
                          host: { type: "string" },
                          name: { type: "string" },
                          extra: { type: "string" },
                        },
                      },
                      data: {
                        type: "object",
                        description:
                          "Full converter response — thumbs, sourceUrl, duration, plus the echoed key/etag/contentType/size.",
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description:
                "No file and no source_url, an unsafe source_url, or OnlyFans rejected the upload descriptor.",
            },
            "403": {
              description:
                "Writes are disabled for this account (`code: WRITES_DISABLED`).",
            },
            "413": { description: "File exceeds MEDIA_UPLOAD_MAX_BYTES." },
            "501": { description: "Fansly account — not supported yet." },
            "502": {
              description:
                "A stage failed upstream (S3 PUT, the converter, or fetching source_url). The `stage` field says which.",
            },
          },
        },
      },

      "/accounts/{of_user_id}/notifications": {
        get: {
          tags: ["Notifications"],
          summary: "Get notifications",
          description: "Fetch notifications for a connected account.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20 },
            },
          ],
          responses: {
            "200": {
              description: "Notification list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      count: { type: "integer" },
                      notifications: {
                        type: "array",
                        items: { type: "object" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Balances ──
      "/accounts/{of_user_id}/balances": {
        get: {
          tags: ["Earnings"],
          summary: "Get account balances",
          description: "Fetch current payout balance for a connected account.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "200": {
              description: "Balance data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      balances: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Earnings ──
      "/accounts/{of_user_id}/earnings": {
        get: {
          tags: ["Earnings"],
          summary: "Get earnings chart data",
          description:
            "Fetch earnings data for a date range with chart-ready breakdown.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              required: true,
              schema: { type: "string" },
              example: "2025-01-01 00:00:00",
              description: "Start date (ISO format)",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string" },
              example: "2025-12-31 23:59:59",
              description: "End date (ISO format)",
            },
            {
              name: "withTotal",
              in: "query",
              schema: { type: "string", default: "true" },
            },
          ],
          responses: {
            "200": {
              description: "Earnings data with chart arrays",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      earnings: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Subscribers ──
      "/accounts/{of_user_id}/subscribers": {
        get: {
          tags: ["Subscribers"],
          summary: "List subscribers",
          description:
            "Get subscribers with pagination and type filtering. Includes total spent data.\n\n**Paging:** advance with the `nextOffset` from the response, and stop when `hasMore` is `false` — not when `list` is empty. `offset` does not mean the same thing on both platforms: OnlyFans filters by type server-side so its offset counts rows *returned*, while Fansly filters client-side so its offset counts rows *consumed*, which can exceed `count`. Computing `offset + list.length` yourself silently skips subscribers on Fansly, and a page whose rows were all filtered out comes back with an empty `list` and more still behind it. `nextOffset` + `hasMore` are correct on both.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, maximum: 100 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "type",
              in: "query",
              schema: {
                type: "string",
                enum: ["all", "active", "expired"],
                default: "all",
              },
            },
          ],
          responses: {
            "200": {
              description: "Subscriber list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      list: { type: "array", items: { type: "object" } },
                      hasMore: {
                        type: "boolean",
                        description:
                          "The stop signal. An empty `list` is not — a page can filter to zero rows and still have more behind it.",
                      },
                      count: {
                        type: "integer",
                        description:
                          "Length of `list` after type filtering. A page-size readout, not a cursor.",
                      },
                      offset: { type: "integer" },
                      nextOffset: {
                        type: "integer",
                        description:
                          "The offset to pass for the next page. Always follow this rather than computing offset + list.length.",
                      },
                      limit: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Purchases ──
      "/accounts/{of_user_id}/purchases": {
        get: {
          tags: ["Transactions"],
          summary: "Get purchase transactions",
          description:
            "Fetch payout transactions with marker-based pagination.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string" },
              example: "2025-01-01 00:00:00",
            },
            {
              name: "marker",
              in: "query",
              schema: { type: "string" },
              description: "Pagination marker (use nextMarker from response)",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100 },
            },
          ],
          responses: {
            "200": {
              description: "Transaction list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      purchases: {
                        type: "array",
                        items: { type: "object" },
                      },
                      hasMore: { type: "boolean" },
                      nextMarker: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Campaigns ──
      "/accounts/{of_user_id}/campaigns": {
        get: {
          tags: ["Campaigns"],
          summary: "List campaigns",
          description:
            "Get tracking link campaigns with statistics and pagination.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Campaign list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      campaigns: {
                        type: "array",
                        items: { type: "object" },
                      },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Campaigns"],
          summary: "Create campaign",
          description: "Create a new tracking link campaign.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: {
                      type: "string",
                      example: "My Campaign",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Campaign created" },
          },
        },
      },
      "/accounts/{of_user_id}/campaigns/{campaign_id}/claimers": {
        get: {
          tags: ["Campaigns"],
          summary: "Get campaign claimers (live)",
          description:
            "Fetch subscribers who converted through a specific campaign.\n\n**OnlyFans only** — rejected for Fansly accounts. Fetched live from the platform, so it consumes platform requests. For a zero-platform-request read, use `GET /accounts/{of_user_id}/campaigns/{campaign_id}/claimers/cached`.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "campaign_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, maximum: 100 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Claimer list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      claimers: {
                        type: "array",
                        items: { type: "object" },
                      },
                      hasMore: { type: "boolean" },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Subscription Price ──
      "/accounts/{of_user_id}/subscription-price": {
        get: {
          tags: ["Settings"],
          summary: "Get subscription price",
          description:
            "Read the account's current subscription price live from `/users/me`. Consumes a platform request.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "200": {
              description: "Current subscription price",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      subscribePrice: { type: "number", example: 9.99 },
                    },
                  },
                },
              },
            },
          },
        },
        patch: {
          tags: ["Settings"],
          summary: "Update subscription price",
          description:
            "Change the subscription price for a connected OnlyFans account.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["subscribePrice"],
                  properties: {
                    subscribePrice: {
                      type: "number",
                      example: 9.99,
                      description: "New subscription price in USD",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Price updated" },
          },
        },
      },

      // ── Proxy Management ──
      "/accounts/{of_user_id}/proxy": {
        get: {
          tags: ["Settings"],
          summary: "Get account proxy",
          description: "Get the current proxy configured for an account.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: {
            "200": {
              description: "Proxy info",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      proxy: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
        patch: {
          tags: ["Settings"],
          summary: "Update account proxy",
          description:
            "Update or remove the proxy for an account. Set to `null` to remove.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    proxy: {
                      type: "string",
                      nullable: true,
                      example: "http://user:pass@host:port",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Proxy updated" },
          },
        },
      },

      // ── Payout Requests ──
      "/accounts/{of_user_id}/payout-requests": {
        get: {
          tags: ["Payouts"],
          summary: "List withdrawal requests",
          description:
            "Withdrawal request history for the account. For OnlyFans this is read live from the platform; for Fansly it is served from the synced wallet ledger.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            { $ref: "#/components/parameters/limitParam" },
            { $ref: "#/components/parameters/offsetParam" },
          ],
          responses: {
            "200": {
              description: "Withdrawal request history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      payout_requests: {
                        type: "array",
                        items: { type: "object" },
                      },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["Payouts"],
          summary: "Create payout request",
          description:
            "Create a withdrawal request for a connected account.\n\n**OnlyFans only** — rejected for Fansly accounts. Requires an `X-Proxy` header (or a proxy saved on the account).",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["withdrawal_amount"],
                  properties: {
                    withdrawal_amount: {
                      type: "number",
                      example: 100.0,
                      description: "Amount to withdraw in USD",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Payout request created" },
          },
        },
      },

      // ── Generic Proxy ──
      "/accounts/{of_user_id}/request": {
        post: {
          tags: ["Proxy"],
          summary: "Generic OF API proxy",
          description:
            "Send any authenticated request to the OnlyFans API. Use this to access any OF endpoint not covered by the dedicated CRM routes. Auto-relogins on session expiry.\n\n**OnlyFans only** — rejected for Fansly accounts. For Fansly, use the platform-neutral CRM data routes.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["path"],
                  properties: {
                    path: {
                      type: "string",
                      example: "/api2/v2/users/me",
                      description: "OnlyFans API path",
                    },
                    method: {
                      type: "string",
                      enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
                      default: "GET",
                    },
                    body: {
                      type: "object",
                      description: "Request body (for POST/PUT/PATCH)",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Proxied response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: { type: "object" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Panel, health & signup (NOT scoped to a panel — served from {baseUrl}) ──
      "/health": {
        get: {
          tags: ["Panel & Usage"],
          summary: "Service health check",
          description:
            "Liveness probe. Exempt from rate limiting and requires no API key.",
          servers: [
            {
              url: "{baseUrl}",
              variables: {
                baseUrl: { default: "{BASE_URL}" },
              },
            },
          ],
          security: [],
          responses: { "200": { description: "Service is healthy" } },
        },
      },
      "/api/whoami": {
        get: {
          tags: ["MCP", "Panel & Usage"],
          summary: "Resolve an API key to a panel",
          description:
            "Resolves the API key sent in `X-API-Key` to its `crm_id`. This is how the hosted MCP server turns a bearer token into a tenant. Returns only public-safe fields (panel id, plan info).",
          servers: [
            {
              url: "{baseUrl}",
              variables: {
                baseUrl: { default: "{BASE_URL}" },
              },
            },
          ],
          responses: {
            "200": {
              description: "Panel resolved",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      crm_id: { type: "string" },
                      plan: { type: "string", example: "only-api-free" },
                    },
                  },
                },
              },
            },
            "401": { description: "Missing or invalid API key" },
          },
        },
      },
      "/api/auth/register": {
        post: {
          tags: ["Panel & Usage"],
          summary: "Register a dashboard user",
          description:
            "Create a dashboard account. Follow with `POST /api/crm/register` to create a CRM panel and receive your first API key.",
          servers: [
            {
              url: "{baseUrl}",
              variables: { baseUrl: { default: "{BASE_URL}" } },
            },
          ],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "User registered" },
            "400": { description: "Invalid payload or email already in use" },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["Panel & Usage"],
          summary: "Dashboard user login",
          description:
            "Authenticate a dashboard user. Rate limited to **6 requests/minute** — the strictest limit in the API.",
          servers: [
            {
              url: "{baseUrl}",
              variables: { baseUrl: { default: "{BASE_URL}" } },
            },
          ],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Authenticated" },
            "401": { description: "Invalid credentials" },
            "429": { description: "Rate limit exceeded (6/minute)" },
          },
        },
      },
      "/api/auth/start-email-verification": {
        post: {
          tags: ["Panel & Usage"],
          summary: "Send an email verification code",
          servers: [
            {
              url: "{baseUrl}",
              variables: { baseUrl: { default: "{BASE_URL}" } },
            },
          ],
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: { email: { type: "string", format: "email" } },
                },
              },
            },
          },
          responses: { "200": { description: "Verification email sent" } },
        },
      },
      "/api/crm/register": {
        post: {
          tags: ["Panel & Usage"],
          summary: "Create a CRM panel",
          description:
            "Create a CRM panel and receive its `crm_id` plus the primary `Default` API key. The key is returned once — store it.",
          servers: [
            {
              url: "{baseUrl}",
              variables: { baseUrl: { default: "{BASE_URL}" } },
            },
          ],
          security: [],
          responses: {
            "200": {
              description: "Panel created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      crm_id: { type: "string" },
                      api_key: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Usage, keys & MCP ──
      "/rotate-key": {
        post: {
          tags: ["API Keys"],
          summary: "Rotate your API key",
          description:
            "Rotate (regenerate) the caller's own API key. Authenticate with your **current** key. The old key dies immediately and the new key is returned once in the response body — store it before discarding the response.",
          responses: {
            "200": {
              description: "Key rotated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      api_key: {
                        type: "string",
                        description: "The new key. Returned only here.",
                      },
                    },
                  },
                },
              },
            },
            "404": { description: "CRM panel not found" },
          },
        },
      },
      "/api-keys": {
        get: {
          tags: ["API Keys"],
          summary: "List API keys",
          description:
            "List all API keys for the panel (active + revoked), each with this-month request count and a 30-day series. Full key bodies are never returned — only a prefix.",
          responses: {
            "200": {
              description: "Key list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      keys: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "integer" },
                            name: { type: "string" },
                            prefix: { type: "string" },
                            is_primary: { type: "boolean" },
                            created_at: { type: "string" },
                            last_used_at: { type: "string", nullable: true },
                            revoked_at: { type: "string", nullable: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["API Keys"],
          summary: "Create a secondary API key",
          description:
            "Mint a new secondary API key. **PRIMARY-KEY ONLY** — calling this with a secondary key returns `403`. The full key is returned **exactly once**, in this response, and is never retrievable again.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      maxLength: 60,
                      default: "Untitled key",
                      example: "CI pipeline",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Key created — `api_key` is shown only here",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      id: { type: "integer" },
                      name: { type: "string" },
                      prefix: { type: "string" },
                      api_key: { type: "string" },
                      created_at: { type: "string" },
                    },
                  },
                },
              },
            },
            "403": { description: "Not the primary key" },
            "404": { description: "CRM panel not found" },
          },
        },
      },
      "/api-keys/{key_id}": {
        delete: {
          tags: ["API Keys"],
          summary: "Revoke a secondary API key",
          description:
            "Revoke a secondary key. **PRIMARY-KEY ONLY** — calling this with a secondary key returns `403`. The primary `Default` key is non-revocable; rotate it via `POST /rotate-key` instead.",
          parameters: [
            {
              name: "key_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": { description: "Key revoked" },
            "403": { description: "Not the primary key" },
            "404": { description: "Key not found, already revoked, or non-revocable (primary)" },
          },
        },
      },
      "/mcp/unsafe-proxy": {
        patch: {
          tags: ["MCP"],
          summary: "Toggle MCP non-GET proxy access",
          description:
            "Toggle whether the hosted MCP server may issue non-GET requests through the generic OF proxy tool. **Off by default.** Use with care: enabling it lets a model POST/PATCH/DELETE arbitrary OnlyFans endpoints on your behalf.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { enabled: { type: "boolean", default: false } },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Toggle updated",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      mcp_unsafe_proxy: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/proxy/test": {
        post: {
          tags: ["Settings"],
          summary: "Test a proxy",
          description:
            "Check that a proxy URL is reachable and usable before connecting an account with it. HTTP and SOCKS5 are both accepted.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["proxy"],
                  properties: {
                    proxy: {
                      type: "string",
                      example: "http://user:pass@host:port",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Proxy test result" } },
        },
      },

      // ── Account polling & payout account ──
      "/accounts/{of_user_id}/polling": {
        get: {
          tags: ["Accounts"],
          summary: "Get polling settings",
          description:
            "Read the background polling configuration for an account — whether polling is enabled, the interval, and whether write actions are allowed.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: {
            "200": {
              description: "Polling settings",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      polling: {
                        type: "object",
                        properties: {
                          enabled: { type: "boolean" },
                          interval_seconds: { type: "integer" },
                          allow_of_write_actions: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "404": { description: "Account not found" },
          },
        },
        patch: {
          tags: ["Accounts"],
          summary: "Update polling settings",
          description:
            "Enable/disable background polling for an account, set the interval, and control whether automations may perform write actions on the platform.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    interval_seconds: {
                      type: "integer",
                      minimum: 60,
                      maximum: 3600,
                      description: "Polling interval in seconds (60–3600).",
                    },
                    allow_of_write_actions: {
                      type: "boolean",
                      description:
                        "Allow automations to send DMs and other writes for this account.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Polling settings updated" },
            "400": { description: "interval_seconds out of range (60–3600)" },
          },
        },
      },
      "/accounts/{of_user_id}/payout-account": {
        get: {
          tags: ["Payouts"],
          summary: "Get payout account",
          description:
            "Payout/withdrawal account details for a connected account.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: { "200": { description: "Payout account details" } },
        },
      },

      // ── Referrals ──
      "/accounts/{of_user_id}/referrals": {
        get: {
          tags: ["Referrals"],
          summary: "List referred users",
          description:
            "The creators/users this account referred, read live from OnlyFans.\n\n**OnlyFans only** — a Fansly account returns `501` with `code: \"platform_not_supported\"` and `feature: \"referrals\"`.\n\nQuery params are forwarded upstream **only when supplied** — no default date window is invented, because a wrong default silently truncates money figures.\n\nThe row shape inside `referrals` is **unverified** (OnlyFans' item fields were never captured); rows pass through untouched and the raw upstream body is echoed under `data`.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string" },
              description: "Range start, `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string" },
              description: "Range end, same format as startDate",
            },
            { name: "offset", in: "query", schema: { type: "integer" } },
            {
              name: "marker",
              in: "query",
              schema: { type: "string" },
              description: "Pagination cursor returned by OnlyFans",
            },
            {
              name: "onlyPerformers",
              in: "query",
              schema: { type: "string" },
              description: "Restrict to referred creators/performers",
            },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              description: "Referred users",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      referrals: {
                        type: "array",
                        items: { type: "object" },
                        description:
                          "Rows exactly as OnlyFans returned them — item fields unverified.",
                      },
                      count: { type: "integer" },
                      hasMore: { type: "boolean" },
                      data: {
                        description: "Raw upstream body, verbatim.",
                      },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid startDate/endDate format" },
            "403": { description: "Account does not belong to this panel" },
            "501": {
              description:
                "Fansly account — referrals are not available on this platform",
            },
          },
        },
      },
      "/accounts/{of_user_id}/referrals/earnings": {
        get: {
          tags: ["Referrals", "Earnings"],
          summary: "Referral balance + chart",
          description:
            "Referral money summary in one response, fanned out to two OnlyFans endpoints (still one quota call).\n\n`balance` and `chart` hold the **raw** upstream bodies — no field mapping. The two documentation sources disagree about the chart body, and the balance endpoint appears in no capture at all, so mapping fields would fabricate a contract.\n\nPartial failure is tolerated: a source that fails comes back `null` and `sources` records its status. If **both** fail, the route returns the upstream status with `success: false` — an expired session must not be indistinguishable from \"no referral earnings\".\n\n**OnlyFans only** — Fansly returns `501`.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string" },
              description: "Chart range start (forwarded to the chart call)",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string" },
              description: "Chart range end",
            },
            {
              name: "withTotal",
              in: "query",
              schema: { type: "string", default: "1" },
              description: "Include totals. Defaults to the value the OnlyFans web client sends.",
            },
            {
              name: "withChart",
              in: "query",
              schema: { type: "string", default: "true" },
              description: "Include the chart series. Defaults to the value the OnlyFans web client sends.",
            },
            {
              name: "filter",
              in: "query",
              schema: { type: "string" },
              description: "Chart filter; forwarded verbatim when supplied.",
            },
          ],
          responses: {
            "200": {
              description: "Referral earnings (one source may be null)",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      balance: {
                        nullable: true,
                        description:
                          "Raw body of the OnlyFans referral balance endpoint, or null if it failed. Shape unverified.",
                      },
                      chart: {
                        nullable: true,
                        description:
                          "Raw body of the OnlyFans referral chart endpoint, or null if it failed. Shape unverified.",
                      },
                      sources: {
                        type: "object",
                        description:
                          "Per-source outcome, so a null above is explainable.",
                        properties: {
                          balance: {
                            type: "object",
                            properties: {
                              ok: { type: "boolean" },
                              status: { type: "integer" },
                            },
                          },
                          chart: {
                            type: "object",
                            properties: {
                              ok: { type: "boolean" },
                              status: { type: "integer" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid startDate/endDate format" },
            "403": { description: "Account does not belong to this panel" },
            "501": {
              description:
                "Fansly account — referrals are not available on this platform",
            },
          },
        },
      },
      "/accounts/{of_user_id}/referrals/payout-requests": {
        get: {
          tags: ["Referrals", "Payouts"],
          summary: "List referral payout requests",
          description:
            "Referral payout history — the referral twin of `GET /accounts/{of_user_id}/payout-requests`, shaped identically.\n\nThe row shape inside `requests` is **unverified**; rows pass through untouched and the raw upstream body is echoed under `data`.\n\n**OnlyFans only** — Fansly returns `501`.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string" },
              description: "Range start, `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS`",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string" },
              description: "Range end, same format as startDate",
            },
            { name: "offset", in: "query", schema: { type: "integer" } },
            {
              name: "marker",
              in: "query",
              schema: { type: "string" },
              description: "Pagination cursor returned by OnlyFans",
            },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              description: "Referral payout requests",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      requests: {
                        type: "array",
                        items: { type: "object" },
                        description:
                          "Rows exactly as OnlyFans returned them — item fields unverified.",
                      },
                      count: { type: "integer" },
                      marker: {
                        nullable: true,
                        description:
                          "Upstream pagination cursor; pass back as `marker` for the next page.",
                      },
                      data: { description: "Raw upstream body, verbatim." },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid startDate/endDate format" },
            "403": { description: "Account does not belong to this panel" },
            "501": {
              description:
                "Fansly account — referrals are not available on this platform",
            },
          },
        },
      },

      // ── Earnings aggregation ──
      "/earnings/summary": {
        get: {
          tags: ["Earnings"],
          summary: "Aggregated earnings across all accounts",
          description:
            "Server-side earnings aggregation across every account in the panel — OnlyFans and Fansly combined into one normalized response, served from the synced transaction and subscriber caches (no live platform calls). Money is net of platform fees; payouts, refunds/chargebacks and Fansly wallet-to-wallet transfers are excluded. Periods are UTC.\n\nThe response is cached in memory per (panel, period) with a 2–15 minute TTL depending on the period, and auto-invalidates when an event that moves a reported number (`new_tip`, `new_purchase`, `balance_increased`, `new_subscriber`, `renewed_subscriber`) fires for any account in the panel, or when a background Fansly wallet refresh finds new data.\n\nPass `startDate` + `endDate` instead of `period` for a custom range (never cached; the comparison window is the same length immediately before it).",
          parameters: [
            {
              name: "period",
              in: "query",
              schema: {
                type: "string",
                enum: ["today", "week", "month"],
                default: "week",
              },
            },
            {
              name: "startDate",
              in: "query",
              description: "Custom range start (YYYY-MM-DD or ISO-8601). Requires `endDate`.",
              schema: { type: "string" },
            },
            {
              name: "endDate",
              in: "query",
              description: "Custom range end, inclusive (YYYY-MM-DD or ISO-8601). Requires `startDate`.",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Aggregated earnings",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "number", description: "Net earnings in the period." },
                      prev_total: { type: "number", description: "Net earnings for the whole previous period." },
                      prev_total_to_date: {
                        type: "number",
                        nullable: true,
                        description:
                          "Previous period up to the same elapsed point (e.g. last Monday → last Wednesday at this time). Null for custom ranges.",
                      },
                      by_category: {
                        type: "object",
                        properties: {
                          subscriptions: { type: "number" },
                          posts: { type: "number" },
                          messages: { type: "number" },
                          tips: { type: "number" },
                          streams: { type: "number" },
                          referrals: { type: "number" },
                        },
                      },
                      by_category_platform: {
                        type: "object",
                        description: "`by_category` split per platform: `{category: {onlyfans, fansly}}`.",
                        additionalProperties: {
                          type: "object",
                          additionalProperties: { type: "number" },
                        },
                      },
                      by_platform: {
                        type: "object",
                        description:
                          "Per platform (`onlyfans`, `fansly`): money plus sync coverage. `uncategorized` is money in `total` whose transaction type maps to no category.",
                        additionalProperties: {
                          type: "object",
                          properties: {
                            total: { type: "number" },
                            prev_total: { type: "number" },
                            prev_total_to_date: { type: "number", nullable: true },
                            uncategorized: { type: "number" },
                            transactions: { type: "integer" },
                            accounts: { type: "integer" },
                            stale: { type: "integer" },
                            never_synced: { type: "integer" },
                            connection_errors: { type: "integer" },
                            oldest_sync_at: { type: "string", nullable: true },
                          },
                        },
                      },
                      new_subs: {
                        type: "object",
                        nullable: true,
                        description:
                          "Subscribers whose subscription started in the period (free or paid). Renewals are counted separately and are not included in `count`. `accounts_tracked` is how many accounts have a subscriber sync — untracked accounts contribute nothing.",
                        properties: {
                          count: { type: "integer" },
                          renewals: { type: "integer" },
                          prev_count: { type: "integer", description: "New subs at the same point of the previous period." },
                          prev_renewals: { type: "integer" },
                          by_platform: {
                            type: "object",
                            additionalProperties: {
                              type: "object",
                              properties: {
                                count: { type: "integer" },
                                renewals: { type: "integer" },
                                prev_count: { type: "integer" },
                                prev_renewals: { type: "integer" },
                                accounts: { type: "integer" },
                                accounts_tracked: { type: "integer" },
                                oldest_sync_at: { type: "string", nullable: true },
                              },
                            },
                          },
                          accounts: { type: "integer" },
                          accounts_tracked: { type: "integer" },
                          accounts_never_synced: { type: "integer" },
                          oldest_sync_at: { type: "string", nullable: true },
                        },
                      },
                      chart: {
                        type: "array",
                        items: { type: "number" },
                        description: "Daily net values, zero-filled; aligned with `chart_days`.",
                      },
                      chart_days: {
                        type: "array",
                        items: { type: "string" },
                        description: "YYYY-MM-DD label for each `chart` point.",
                      },
                      accounts_count: { type: "integer" },
                      transactions_counted: { type: "integer" },
                      transactions_capped: {
                        type: "boolean",
                        description: "Always false (kept for compatibility).",
                      },
                      period: { type: "string" },
                      source: { type: "string", example: "cache" },
                      accounts_stale: {
                        type: "integer",
                        description: "Accounts whose transaction cache hasn't refreshed in 8h.",
                      },
                      accounts_never_synced: { type: "integer" },
                      oldest_sync_at: { type: "string", nullable: true, description: "UTC." },
                      computed_at: {
                        type: "string",
                        description: "When this body was built (UTC). A cached response keeps its original stamp.",
                      },
                      period_start: { type: "string", description: "UTC." },
                      period_end: { type: "string", description: "UTC." },
                      cached: { type: "boolean" },
                      fansly_balance: {
                        type: "object",
                        description:
                          "Panels with a Fansly account only. Last-sampled Fansly earnings wallets — a snapshot, never part of `total`.",
                        properties: {
                          current: { type: "number", description: "Whole earnings wallet, including earnings on hold." },
                          available: { type: "number", description: "Withdrawable now." },
                          pending: { type: "number", description: "On hold." },
                          accounts: { type: "integer" },
                          sampled: { type: "integer" },
                          pending_sampled: { type: "integer" },
                          oldest_sample_at: { type: "string", nullable: true },
                          newest_sample_at: { type: "string", nullable: true },
                        },
                      },
                      fansly_balance_floor: {
                        type: "number",
                        deprecated: true,
                        description: "Same as `fansly_balance.available`.",
                      },
                      fansly_accounts: { type: "integer" },
                      fansly_balance_sampled: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Cache & sync — subscribers ──
      "/accounts/{of_user_id}/subscribers/refresh": {
        post: {
          tags: ["Cache & Sync", "Subscribers"],
          summary: "Refresh the subscriber cache (async)",
          description:
            "Start an async subscriber sync for this account. Returns **202** immediately — poll `GET /accounts/{of_user_id}/subscribers/refresh/status` or listen on `GET /events/stream` for completion. Works for OnlyFans and Fansly.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "202": { description: "Refresh job accepted and running" },
            "409": { description: "A refresh is already in progress" },
          },
        },
      },
      "/accounts/{of_user_id}/subscribers/refresh/status": {
        get: {
          tags: ["Cache & Sync", "Subscribers"],
          summary: "Subscriber refresh status",
          description:
            "Progress/state of the current or last subscriber refresh job. **Zero platform requests.**",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Refresh job status" } },
        },
      },
      "/accounts/{of_user_id}/subscribers/cached": {
        get: {
          tags: ["Subscribers", "Cache & Sync"],
          summary: "List cached subscribers",
          description:
            "Read subscribers from the local cache, populated by the background refresh job. **Zero platform requests.**\n\nPlatform-neutral: OnlyFans and Fansly rows are normalized to the same shape. Each row carries the raw platform payload merged with the flat spend/lifecycle projection (total spent, breakdown), which for Fansly is backfilled from the wallet ledger.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100 },
            },
            { $ref: "#/components/parameters/offsetParam" },
            {
              name: "type",
              in: "query",
              schema: {
                type: "string",
                enum: ["all", "active", "expired"],
                default: "all",
              },
            },
          ],
          responses: {
            "200": {
              description: "Cached subscriber list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      subscribers: {
                        type: "array",
                        items: { type: "object" },
                      },
                      count: { type: "integer" },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/accounts/{of_user_id}/subscribers/new": {
        get: {
          tags: ["Subscribers", "Cache & Sync"],
          summary: "List newly-seen subscribers",
          description:
            "Subscribers first seen within a recent window, read from the cache. **Zero platform requests.** Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "since",
              in: "query",
              schema: { type: "string" },
              description: "ISO timestamp or date lower bound.",
            },
            { $ref: "#/components/parameters/limitParam" },
          ],
          responses: { "200": { description: "New subscriber list" } },
        },
      },
      "/accounts/{of_user_id}/subscribers/stats": {
        get: {
          tags: ["Subscribers", "Cache & Sync"],
          summary: "Subscriber statistics",
          description:
            "Time-bucketed counts of incoming subscriptions, plus the cache summary. **Zero platform requests.** Fansly-aware.\n\nQuery: `granularity` = `hour|day|week|month` (default `day`), `since`/`until` = inclusive ISO-8601 bounds on `subscribed_at`.\n\nBuckets are ascending, contiguous and **zero-filled server-side** — a quiet day comes back as `count: 0`, not as a missing key, so the array plots directly. With both `since` and `until` the axis spans exactly that window even if it holds no subscriptions; otherwise it spans the first to the last bucket with data. Week buckets are Monday-start ISO dates.\n\n`zero_filled` is `false` when the requested span exceeded the server's bucket ceiling (e.g. `granularity=hour` over an unbounded window): the series is then sparse and you must fill the gaps yourself. Narrow the window or coarsen the granularity.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Subscriber statistics" } },
        },
      },

      // ── Cache & sync — transactions ──
      "/accounts/{of_user_id}/transactions/refresh": {
        post: {
          tags: ["Cache & Sync", "Transactions"],
          summary: "Refresh the transaction cache (async)",
          description:
            "Start an async transaction sync. Returns **202** — poll `GET /accounts/{of_user_id}/transactions/refresh/status` or listen on `GET /events/stream`. Works for OnlyFans and Fansly.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "202": { description: "Refresh job accepted and running" },
            "409": { description: "A refresh is already in progress" },
          },
        },
      },
      "/accounts/{of_user_id}/transactions/refresh/status": {
        get: {
          tags: ["Cache & Sync", "Transactions"],
          summary: "Transaction refresh status",
          description:
            "Progress/state of the current or last transaction refresh job. **Zero platform requests.**",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Refresh job status" } },
        },
      },
      "/accounts/{of_user_id}/transactions/cached": {
        get: {
          tags: ["Transactions", "Cache & Sync"],
          summary: "List cached transactions",
          description:
            "Read transactions from the local cache. **Zero platform requests.** OnlyFans and Fansly rows are normalized to the same shape.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/limitParam" },
            { $ref: "#/components/parameters/offsetParam" },
            {
              name: "since",
              in: "query",
              schema: { type: "string" },
              description: "ISO date lower bound.",
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string" },
              description: "ISO date upper bound.",
            },
          ],
          responses: { "200": { description: "Cached transaction list" } },
        },
      },
      "/accounts/{of_user_id}/backfill": {
        post: {
          tags: ["Cache & Sync"],
          summary: "Backfill historical data (async)",
          description:
            "Kick off a historical backfill for this account, walking further back than the routine refresh. Returns **202** — track progress via the refresh-status routes or `GET /events/stream`.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "202": { description: "Backfill job accepted and running" },
            "409": { description: "A job is already in progress" },
          },
        },
      },
      "/refresh/active": {
        get: {
          tags: ["Cache & Sync"],
          summary: "List active refresh jobs",
          description:
            "All refresh/backfill jobs currently running across the panel. **Zero platform requests.**",
          responses: { "200": { description: "Active job list" } },
        },
      },

      // ── Cache & sync — campaigns ──
      "/accounts/{of_user_id}/campaigns/refresh": {
        post: {
          tags: ["Cache & Sync", "Campaigns"],
          summary: "Refresh the campaign cache (async)",
          description:
            "Start an async campaign + claimer sync. Returns **202** — poll `GET /accounts/{of_user_id}/campaigns/refresh/status` or listen on `GET /events/stream`. Honours the `/tracked-campaigns` allowlist when one is set.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "202": { description: "Refresh job accepted and running" },
            "409": { description: "A refresh is already in progress" },
          },
        },
      },
      "/accounts/{of_user_id}/campaigns/refresh/status": {
        get: {
          tags: ["Cache & Sync", "Campaigns"],
          summary: "Campaign refresh status",
          description:
            "Progress/state of the current or last campaign refresh job. **Zero platform requests.**",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Refresh job status" } },
        },
      },
      "/accounts/{of_user_id}/campaigns/earnings": {
        get: {
          tags: ["Campaigns"],
          summary: "Campaign earnings breakdown",
          description:
            "Earnings attributed to each tracking-link campaign, computed from cached claimers joined with cached transactions. **Zero platform requests.**",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Per-campaign earnings" } },
        },
      },
      "/accounts/{of_user_id}/campaigns/{campaign_id}/claimers/cached": {
        get: {
          tags: ["Campaigns", "Cache & Sync"],
          summary: "Get cached campaign claimers",
          description:
            "Cached claimers for one campaign, already joined with the subscriber cache so each row carries `total_spent`, its breakdown, and `mapped_spent`. **Zero platform requests.**",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/campaignId" },
            { $ref: "#/components/parameters/limitParam" },
            { $ref: "#/components/parameters/offsetParam" },
          ],
          responses: { "200": { description: "Cached claimer list" } },
        },
      },
      "/accounts/{of_user_id}/tracked-campaigns": {
        get: {
          tags: ["Campaigns"],
          summary: "Get the tracked-campaign allowlist",
          description:
            "The allowlist of tracking-link campaigns (names/codes) kept synced for this account. When set, scheduled and backfill claimer syncs walk only these — so a huge link (20k+ subscribers) is never walked on a timer.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Tracked campaign allowlist" } },
        },
        put: {
          tags: ["Campaigns"],
          summary: "Set the tracked-campaign allowlist",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    campaigns: {
                      type: "array",
                      items: { type: "string" },
                      description: "Campaign names or codes to keep synced.",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Allowlist updated" } },
        },
      },
      "/accounts/{of_user_id}/campaign-tags": {
        get: {
          tags: ["Campaigns"],
          summary: "List campaign tags",
          description: "All campaign tags in use for this account.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Campaign tag list" } },
        },
      },
      "/accounts/{of_user_id}/campaigns/{campaign_id}/tags": {
        post: {
          tags: ["Campaigns"],
          summary: "Add a tag to a campaign",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/campaignId" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["tag"],
                  properties: { tag: { type: "string", example: "reddit" } },
                },
              },
            },
          },
          responses: { "200": { description: "Tag added" } },
        },
      },
      "/accounts/{of_user_id}/campaigns/{campaign_id}/tags/{tag}": {
        delete: {
          tags: ["Campaigns"],
          summary: "Remove a tag from a campaign",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/campaignId" },
            {
              name: "tag",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Tag removed" } },
        },
      },

      // ── Fans (panel-wide fan CRM) ──
      "/fans": {
        get: {
          tags: ["Fans"],
          summary: "List fans",
          description:
            "Fan CRM across the whole panel — every fan seen on any connected account, OnlyFans or Fansly, with tags, notes, spend, and activity counters. **Zero platform requests.**",
          parameters: [
            {
              name: "of_user_id",
              in: "query",
              schema: { type: "string" },
              description: "Restrict to fans of one connected account.",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100, minimum: 1, maximum: 500 },
            },
            { $ref: "#/components/parameters/offsetParam" },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["last_seen", "first_seen", "tips", "spend", "events"],
                default: "last_seen",
              },
            },
            {
              name: "search",
              in: "query",
              schema: { type: "string", maxLength: 80 },
              description: "Free-text search over fan name/username.",
            },
            {
              name: "tag",
              in: "query",
              schema: { type: "string" },
              description: "Filter to fans carrying this tag.",
            },
          ],
          responses: {
            "200": {
              description: "Fan list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      fans: { type: "array", items: { type: "object" } },
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid sort value" },
          },
        },
      },
      "/fans/{fan_of_user_id}/tags": {
        post: {
          tags: ["Fans"],
          summary: "Add a tag to a fan",
          parameters: [{ $ref: "#/components/parameters/fanOfUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["tag"],
                  properties: { tag: { type: "string", example: "whale" } },
                },
              },
            },
          },
          responses: { "200": { description: "Tag added" } },
        },
      },
      "/fans/{fan_of_user_id}/tags/{tag}": {
        delete: {
          tags: ["Fans"],
          summary: "Remove a tag from a fan",
          parameters: [
            { $ref: "#/components/parameters/fanOfUserId" },
            {
              name: "tag",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Tag removed" } },
        },
      },
      "/fans/{fan_of_user_id}/note": {
        put: {
          tags: ["Fans"],
          summary: "Set a fan note",
          description:
            "Replace the free-text CRM note stored against a fan. Send an empty string to clear it.",
          parameters: [{ $ref: "#/components/parameters/fanOfUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    note: { type: "string", example: "Prefers PPV over tips." },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Note saved" } },
        },
      },
      "/accounts/{of_user_id}/fans/{fan_id}/refresh-profile": {
        post: {
          tags: ["Fans"],
          summary: "Refresh a fan profile from the platform",
          description:
            "Re-fetch one fan's profile from the platform and update the cache. Consumes a platform request.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/fanId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: { "200": { description: "Fan profile refreshed" } },
        },
      },
      "/accounts/{of_user_id}/fans/{fan_id}/transactions/cached": {
        get: {
          tags: ["Fans", "Cache & Sync"],
          summary: "Get a fan's cached transactions",
          description:
            "Every cached transaction attributed to one fan on this account. **Zero platform requests.** Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/fanId" },
            { $ref: "#/components/parameters/limitParam" },
            { $ref: "#/components/parameters/offsetParam" },
          ],
          responses: { "200": { description: "Cached transaction list" } },
        },
      },

      // ── Messaging ──
      "/accounts/{of_user_id}/chats": {
        get: {
          tags: ["Messaging"],
          summary: "List chats",
          description:
            "Conversation list for a connected account. Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100 },
            },
            { $ref: "#/components/parameters/offsetParam" },
          ],
          responses: { "200": { description: "Chat list" } },
        },
      },
      "/accounts/{of_user_id}/chats/{with_user_id}/messages": {
        get: {
          tags: ["Messaging"],
          summary: "Get message history",
          description:
            "Message history for one conversation, newest-first by default. Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "with_user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The fan's user ID.",
            },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100 },
            },
          ],
          responses: { "200": { description: "Message list" } },
        },
        post: {
          tags: ["Messaging"],
          summary: "Send a DM or PPV",
          description:
            "Send a single DM (or PPV) to one fan. Works for OnlyFans and Fansly.\n\n- `price > 0` makes the message a **PPV**.\n- `mediaFiles` locks vault media behind the price.\n- OnlyFans sends are gated per account by the `allow_of_write_actions` polling setting (`PATCH /accounts/{of_user_id}/polling`).\n\nRate limited to 120 requests/minute.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "with_user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The fan's user ID.",
            },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["text"],
                  properties: {
                    text: { type: "string", example: "Hey! New drop is up 💕" },
                    price: {
                      type: "number",
                      default: 0,
                      description: "Above 0 makes this a PPV message.",
                    },
                    mediaFiles: {
                      type: "array",
                      items: { type: "string" },
                      description: "Vault media IDs to attach.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Message sent" },
            "403": { description: "Write actions disabled for this account" },
          },
        },
      },
      "/accounts/{of_user_id}/messages/mass": {
        post: {
          tags: ["Messaging"],
          summary: "Send a mass DM",
          description:
            "Send one message to many fans at once. Supports PPV pricing and vault media, and can target a subscriber segment. Rate limited to 120 requests/minute. Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["text"],
                  properties: {
                    text: { type: "string", example: "New set just dropped!" },
                    price: {
                      type: "number",
                      default: 0,
                      description: "Above 0 makes this a mass PPV.",
                    },
                    mediaFiles: {
                      type: "array",
                      items: { type: "string" },
                      description: "Vault media IDs to attach.",
                    },
                    userLists: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Target segment(s), e.g. `[\"active\"]` or specific list IDs.",
                    },
                    excludedLists: {
                      type: "array",
                      items: { type: "string" },
                      description: "Segment(s) to exclude.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Mass DM queued/sent" },
            "403": { description: "Write actions disabled for this account" },
          },
        },
      },
      "/accounts/{of_user_id}/ppv-stats": {
        get: {
          tags: ["Messaging"],
          summary: "PPV performance stats",
          description:
            "Purchase/unlock statistics for PPV messages sent from this account, computed from cached transactions. **Zero platform requests.** Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "since",
              in: "query",
              schema: { type: "string" },
              description: "ISO date lower bound.",
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string" },
              description: "ISO date upper bound.",
            },
          ],
          responses: { "200": { description: "PPV statistics" } },
        },
      },

      // ── Exports ──
      "/accounts/{of_user_id}/exports": {
        post: {
          tags: ["Exports"],
          summary: "Create an export job",
          description:
            "Kick off an async data export for one account. Returns **202** with the created job.\n\nProgress streams over `GET /events/stream` as `export.progress`; completion fires `export.complete`. The generated ZIP is downloadable from `GET /accounts/{of_user_id}/exports/{job_id}/download` for the configured retention window. Fansly-aware.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data_types: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: [
                          "subscribers",
                          "transactions",
                          "fans",
                          "earnings",
                          "messages",
                          "account",
                        ],
                      },
                      example: ["subscribers", "transactions"],
                    },
                    since: {
                      type: "string",
                      nullable: true,
                      example: "2026-01-01",
                      description: "YYYY-MM-DD lower bound.",
                    },
                    until: {
                      type: "string",
                      nullable: true,
                      example: "2026-06-30",
                      description: "YYYY-MM-DD upper bound.",
                    },
                    include_media: {
                      type: "boolean",
                      default: false,
                      description: "OnlyFans only in v1.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Export job created" },
            "400": { description: "Invalid data_types or date range" },
          },
        },
        get: {
          tags: ["Exports"],
          summary: "List export jobs",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: { "200": { description: "Export job list" } },
        },
      },
      "/accounts/{of_user_id}/exports/{job_id}": {
        get: {
          tags: ["Exports"],
          summary: "Get export job status",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "job_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Export job" },
            "404": { description: "Job not found" },
          },
        },
        delete: {
          tags: ["Exports"],
          summary: "Delete an export job",
          description: "Delete the job and its generated ZIP.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "job_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Job deleted" } },
        },
      },
      "/accounts/{of_user_id}/exports/{job_id}/download": {
        get: {
          tags: ["Exports"],
          summary: "Download an export ZIP",
          description:
            "Download the generated archive. Available until the retention window expires.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "job_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "ZIP archive",
              content: {
                "application/zip": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "404": { description: "Job not found, not finished, or expired" },
          },
        },
      },
      "/accounts/{of_user_id}/exports/{job_id}/cancel": {
        post: {
          tags: ["Exports"],
          summary: "Cancel a running export job",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "job_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Job cancelled" } },
        },
      },

      // ── Events & streaming ──
      "/events": {
        get: {
          tags: ["Events & Streaming"],
          summary: "List events",
          description:
            "Poll the panel's event feed. **Zero platform requests.** Covers OnlyFans and Fansly accounts alike.",
          parameters: [
            {
              name: "types",
              in: "query",
              schema: { type: "string" },
              description:
                "Comma-separated event types, e.g. `new_subscriber,new_tip`. An unknown type returns 400.",
              example: "new_subscriber,new_tip",
            },
            {
              name: "of_user_id",
              in: "query",
              schema: { type: "string" },
              description: "Restrict to one connected account.",
            },
            {
              name: "since",
              in: "query",
              schema: { type: "string" },
              description: "ISO timestamp lower bound.",
            },
            {
              name: "until",
              in: "query",
              schema: { type: "string" },
              description: "ISO timestamp upper bound.",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 100, minimum: 1, maximum: 500 },
            },
          ],
          responses: {
            "200": {
              description: "Event list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      events: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
            "400": { description: "Unknown event type" },
          },
        },
      },
      "/events/stream": {
        get: {
          tags: ["Events & Streaming"],
          summary: "Stream events (SSE)",
          description:
            "Long-lived **Server-Sent Events** stream of panel events. **Rate-limit exempt.** Use this instead of polling to observe refresh-job completion and `export.progress` / `export.complete`.\n\nOptional server-side filtering: `?types=new_subscriber,new_tip` (`*` or absent = everything). An unknown type returns 400.",
          parameters: [
            {
              name: "types",
              in: "query",
              schema: { type: "string" },
              description:
                "Comma-separated event types, or `*` for everything.",
            },
          ],
          responses: {
            "200": {
              description: "SSE stream",
              content: { "text/event-stream": { schema: { type: "string" } } },
            },
            "400": { description: "Unknown event type" },
          },
        },
      },

      // ── Webhooks ──
      "/webhooks": {
        get: {
          tags: ["Webhooks"],
          summary: "List webhooks",
          responses: { "200": { description: "Webhook list" } },
        },
        post: {
          tags: ["Webhooks"],
          summary: "Create a webhook",
          description:
            "Subscribe an HTTPS endpoint to panel events. Rate limited to 120 requests/minute.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: {
                      type: "string",
                      format: "uri",
                      example: "https://example.com/hooks/theonlyapi",
                    },
                    events: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Event types to deliver. Omit or use `*` for everything.",
                      example: ["new_subscriber", "new_tip"],
                    },
                    of_user_id: {
                      type: "string",
                      nullable: true,
                      description: "Restrict to one connected account.",
                    },
                    enabled: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Webhook created" },
            "400": { description: "Invalid URL or event type" },
          },
        },
      },
      "/webhooks/{webhook_id}": {
        get: {
          tags: ["Webhooks"],
          summary: "Get a webhook",
          parameters: [
            {
              name: "webhook_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": { description: "Webhook" },
            "404": { description: "Not found" },
          },
        },
        patch: {
          tags: ["Webhooks"],
          summary: "Update a webhook",
          parameters: [
            {
              name: "webhook_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    url: { type: "string", format: "uri" },
                    events: { type: "array", items: { type: "string" } },
                    enabled: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Webhook updated" } },
        },
        delete: {
          tags: ["Webhooks"],
          summary: "Delete a webhook",
          parameters: [
            {
              name: "webhook_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: { "200": { description: "Webhook deleted" } },
        },
      },
      "/webhooks/{webhook_id}/test": {
        post: {
          tags: ["Webhooks"],
          summary: "Send a test delivery",
          description:
            "Fire a synthetic event at the webhook so you can verify the endpoint and signature handling. The delivery carries X-OnlyAPI-Signature (sha256=<hex digest>), X-OnlyAPI-Timestamp, X-OnlyAPI-Event and X-OnlyAPI-Delivery-Id; the digest is HMAC-SHA256 over \"{X-OnlyAPI-Timestamp}.\" + the raw body.",
          parameters: [
            {
              name: "webhook_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: { "200": { description: "Test delivery result" } },
        },
      },
      "/webhooks/{webhook_id}/deliveries": {
        get: {
          tags: ["Webhooks"],
          summary: "List webhook deliveries",
          description:
            "Delivery history with response status codes, for debugging failures.",
          parameters: [
            {
              name: "webhook_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
            { $ref: "#/components/parameters/limitParam" },
          ],
          responses: { "200": { description: "Delivery history" } },
        },
      },

      // ── Automations ──
      "/automations": {
        get: {
          tags: ["Automations"],
          summary: "List automations",
          responses: { "200": { description: "Automation list" } },
        },
        post: {
          tags: ["Automations"],
          summary: "Create an automation",
          description:
            "Run an action whenever a panel event fires. `trigger_event` must be a known event type (not `*`) and `action_type` must be a supported action. Rate limited to 120 requests/minute.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "trigger_event", "action_type"],
                  properties: {
                    name: { type: "string", maxLength: 100, example: "Welcome DM" },
                    trigger_event: {
                      type: "string",
                      example: "new_subscriber",
                      description: "A known event type. `*` is not allowed.",
                    },
                    action_type: {
                      type: "string",
                      example: "send_dm",
                      description: "A supported action type.",
                    },
                    conditions: {
                      type: "array",
                      items: { type: "object" },
                      default: [],
                    },
                    action_params: { type: "object", default: {} },
                    of_user_id: {
                      type: "string",
                      nullable: true,
                      description:
                        "Restrict to one connected account. Omit to apply panel-wide.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Automation created" },
            "400": { description: "Invalid trigger_event or action_type" },
          },
        },
      },
      "/automations/{automation_id}": {
        get: {
          tags: ["Automations"],
          summary: "Get an automation",
          parameters: [
            {
              name: "automation_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": { description: "Automation" },
            "404": { description: "Not found" },
          },
        },
        patch: {
          tags: ["Automations"],
          summary: "Update an automation",
          parameters: [
            {
              name: "automation_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    enabled: { type: "boolean" },
                    conditions: { type: "array", items: { type: "object" } },
                    action_params: { type: "object" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Automation updated" } },
        },
        delete: {
          tags: ["Automations"],
          summary: "Delete an automation",
          parameters: [
            {
              name: "automation_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: { "200": { description: "Automation deleted" } },
        },
      },
      "/automations/{automation_id}/run-now": {
        post: {
          tags: ["Automations"],
          summary: "Run an automation immediately",
          parameters: [
            {
              name: "automation_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: { "200": { description: "Run triggered" } },
        },
      },
      "/automations/{automation_id}/runs": {
        get: {
          tags: ["Automations"],
          summary: "List automation runs",
          description: "Execution history for one automation.",
          parameters: [
            {
              name: "automation_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
            { $ref: "#/components/parameters/limitParam" },
          ],
          responses: { "200": { description: "Run history" } },
        },
      },

      // ── Integrations ──
      "/integrations/telegram/groups": {
        post: {
          tags: ["Integrations"],
          summary: "Register Telegram groups",
          description:
            "Register Telegram group targets so automations and webhooks can deliver notifications there.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    groups: {
                      type: "array",
                      items: { type: "object" },
                      description: "Telegram group identifiers to register.",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Groups registered" } },
        },
      },

      // ══════════════════════════════════════════════════════════
      //  OF API ENDPOINTS — transparent proxy  (ONLYFANS ONLY)
      //  These are live routes. Required headers on every call:
      //    X-API-Key: <your crm api key>
      //    user-id:   <of_user_id>   (required — omitting it 400s)
      //  Optional: X-Proxy to override the saved proxy.
      //  The account must ALREADY be connected via
      //  POST /accounts/login or POST /accounts/login/cookies;
      //  /api2/v2/* accepts no cookie bootstrap. An unknown or
      //  foreign user-id returns 403.
      //  Fansly accounts are REJECTED on this surface — use the
      //  platform-neutral CRM data routes (/notifications,
      //  /balances, /chats, /purchases, /subscribers/cached, ...)
      //  which are Fansly-aware.
      // ══════════════════════════════════════════════════════════

      // ── User ──
      "/api2/v2/users/me": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — User"],
          summary: "Get current user profile",
          description:
            "Returns the authenticated user's full profile including stats, subscription info, and settings. Call via the generic proxy endpoint.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          responses: {
            "200": {
              description: "User profile object",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "integer" },
                      name: { type: "string" },
                      username: { type: "string" },
                      about: { type: "string" },
                      avatar: { type: "string" },
                      header: { type: "string" },
                      email: { type: "string" },
                      isPerformer: { type: "boolean" },
                      subscribesCount: { type: "integer" },
                      subscribersCount: { type: "integer" },
                      postsCount: { type: "integer" },
                      photosCount: { type: "integer" },
                      videosCount: { type: "integer" },
                      audiosCount: { type: "integer" },
                      tipsEnabled: { type: "boolean" },
                      subscribePrice: { type: "number" },
                      canEarn: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        patch: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — User"],
          summary: "Update user profile",
          description:
            "Update profile fields. Supports display name, about text, subscription price, tip settings, and more. Only include the fields you want to change.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    displayName: {
                      type: "string",
                      description: "Profile display name",
                      example: "My Creator Name",
                    },
                    about: {
                      type: "string",
                      description: "Bio / about text",
                      example: "Welcome to my page! 💕",
                    },
                    subscribePrice: {
                      type: "number",
                      description: "Monthly subscription price in USD",
                      example: 9.99,
                    },
                    tipsEnabled: {
                      type: "boolean",
                      description: "Whether tips are enabled on the profile",
                    },
                    tipsMin: {
                      type: "number",
                      description: "Minimum tip amount in USD",
                    },
                    tipsMax: {
                      type: "number",
                      description: "Maximum tip amount in USD",
                    },
                    location: {
                      type: "string",
                      description: "Profile location text",
                    },
                    website: {
                      type: "string",
                      description: "Website URL",
                    },
                    wishlist: {
                      type: "string",
                      description: "Amazon wishlist URL",
                    },
                    showPostsTipsSum: {
                      type: "boolean",
                      description: "Show tip totals on posts",
                    },
                    showMediaCount: {
                      type: "boolean",
                      description: "Show photo/video counts on profile",
                    },
                    showPostsCount: {
                      type: "boolean",
                      description: "Show total posts count",
                    },
                    canCommentOnContent: {
                      type: "boolean",
                      description: "Allow comments on posts",
                    },
                    isPossibleToReply: {
                      type: "boolean",
                      description: "Allow DM replies",
                    },
                  },
                },
                examples: {
                  updatePrice: {
                    summary: "Update subscription price",
                    value: { subscribePrice: 14.99 },
                  },
                  updateBio: {
                    summary: "Update bio and display name",
                    value: {
                      displayName: "My New Name",
                      about: "Welcome to my page! 💕 DM me for custom content.",
                    },
                  },
                  updateSettings: {
                    summary: "Update profile settings",
                    value: {
                      tipsEnabled: true,
                      tipsMin: 5,
                      canCommentOnContent: true,
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated profile" } },
        },
      },
      "/api2/v2/users/me/settings": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — User"],
          summary: "Get account settings",
          description: "Returns account-level settings including banking status, payout eligibility, and verification state.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          responses: {
            "200": {
              description: "Settings object",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFUserSettings" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/{user_id}": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — User"],
          summary: "Get user public profile",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "User profile",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFUserProfile" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/{user_id}/block": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — User"],
          summary: "Block a user",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "User blocked" } },
        },
        delete: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — User"],
          summary: "Unblock a user",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "User unblocked" } },
        },
      },
      "/api2/v2/users/{user_id}/restrict": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — User"],
          summary: "Restrict a user",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "User restricted" } },
        },
      },
      "/api2/v2/users/blocked": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — User"],
          summary: "List blocked users",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Blocked users list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/me/profile/views/qr": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — User"],
          summary: "Get profile QR code",
          responses: {
            "200": {
              description: "QR code data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      url: { type: "string", description: "QR code image URL" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Subscribers (OF API) ──
      "/api2/v2/subscriptions/subscribers": {
        get: {
          tags: ["OF API — Subscribers"],
          summary: "List subscribers",
          description: "Full subscriber list with total-spent data.\n\n`data` is a **bare array** of subscriber (fan) profiles — no `{list, hasMore}` wrapper — page it with `limit`/`offset`. For a bounded active/expired roster on very large accounts prefer the CRM route `GET /accounts/{of_user_id}/subscribers/refresh` + `/subscribers/cached`.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "type",
              in: "query",
              schema: {
                type: "string",
                enum: ["all", "active", "expired"],
                default: "all",
              },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", default: "infinite" },
            },
            {
              name: "filter[total_spent]",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "more",
              in: "query",
              schema: { type: "boolean", default: true },
            },
          ],
          responses: {
            "200": {
              description: "Subscriber list, wrapped in the passthrough envelope. Each item is an OFUserProfile plus subscription-relationship fields (`subscribedBy`, `subscribedByExpireDate`, `subscribedOnData`, `currentSubscribePrice`, `listsStates`, tip limits).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/OFUserProfile" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/subscribers/count": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscribers"],
          summary: "Get subscriber count",
          responses: {
            "200": {
              description: "Count",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { count: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/subscribers/recent-expired": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscribers"],
          summary: "Recently expired subscribers",
          responses: {
            "200": {
              description: "Expired subscriber list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/subscribers/awards": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscribers"],
          summary: "Top-spending subscribers",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Awards list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/subscribers/awards/count": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscribers"],
          summary: "Subscriber awards count",
          responses: {
            "200": {
              description: "Count",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { count: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },

      // ── Subscriptions (OF API) ──
      "/api2/v2/subscriptions/subscribes": {
        get: {
          tags: ["OF API — Subscriptions"],
          summary: "List your subscriptions",
          description: "Accounts you are subscribed to.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "type",
              in: "query",
              schema: { type: "string", default: "active" },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", default: "infinite" },
            },
          ],
          responses: {
            "200": {
              description: "Subscription list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/subscribes/count": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscriptions"],
          summary: "Subscription count",
          responses: {
            "200": {
              description: "Count",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { count: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/{subscription_id}/history": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscriptions"],
          summary: "Subscription payment history",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "subscription_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Payment history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/subscriptions/{subscription_id}/discount": {
        put: {
          tags: ["OF API — Subscriptions"],
          summary: "Apply subscription discount",
          description:
            "Apply a percentage discount to a specific subscriber's subscription. Useful for retention or promotional pricing for individual fans.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "subscription_id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Subscription ID to apply discount to",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["discount", "period"],
                  properties: {
                    discount: {
                      type: "integer",
                      description:
                        "Discount percentage (0-100). 0 removes the discount.",
                      minimum: 0,
                      maximum: 100,
                      example: 50,
                    },
                    period: {
                      type: "integer",
                      description:
                        "Number of months the discount is active (1-12).",
                      minimum: 1,
                      maximum: 12,
                      example: 3,
                    },
                  },
                },
                examples: {
                  halfOff: {
                    summary: "50% off for 3 months",
                    value: { discount: 50, period: 3 },
                  },
                  removeDiscount: {
                    summary: "Remove discount",
                    value: { discount: 0, period: 1 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Discount applied" } },
        },
      },
      "/api2/v2/users/{user_id}/subscribe": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscriptions"],
          summary: "Subscribe to a user",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Subscribed" } },
        },
      },
      "/api2/v2/users/{user_id}/unsubscribe": {
        delete: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Subscriptions"],
          summary: "Unsubscribe from a user",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Unsubscribed" } },
        },
      },

      // ── Messaging (OF API) ──
      "/api2/v2/chats": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Messaging"],
          summary: "List recent chats",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "order",
              in: "query",
              schema: { type: "string", default: "recent" },
            },
            {
              name: "skip_users",
              in: "query",
              schema: { type: "string", default: "all" },
            },
          ],
          responses: {
            "200": {
              description: "Chat list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFChat" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/chats/{user_id}/messages": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Messaging"],
          summary: "Get chat messages",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20 },
            },
            {
              name: "order",
              in: "query",
              schema: { type: "string", default: "desc" },
            },
            {
              name: "id",
              in: "query",
              schema: { type: "integer" },
              description:
                "Message ID cursor for pagination. Returns messages before/after this ID depending on order.",
            },
            {
              name: "skip_users",
              in: "query",
              schema: { type: "string", default: "all" },
            },
          ],
          responses: {
            "200": {
              description: "Message list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: {
                        type: "array",
                        items: { $ref: "#/components/schemas/OFMessage" },
                      },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          tags: ["OF API — Messaging"],
          summary: "Send a message",
          description:
            "Send a direct message to a user. Supports text, media attachments (uploaded via the media upload endpoint first), PPV pricing, and locked text. Media must be uploaded to the vault first, then referenced by ID in the `mediaFiles` array.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    text: {
                      type: "string",
                      description: "Message text content",
                      example: "Hello! Check out this exclusive content 🔥",
                    },
                    mediaFiles: {
                      type: "array",
                      description:
                        "Media to attach. Two accepted forms:\n\n* an integer vault ID of media already in the vault (list them with `GET /api2/v2/vault/media`)\n* the `media` object returned by `POST /accounts/{of_user_id}/media` — a freshly uploaded file is referenced by `processId`, not a vault ID\n\nUpload new files with `POST /accounts/{of_user_id}/media` (raw bytes, or a `source_url` we fetch for you).",
                      items: { type: "integer" },
                      example: [12345, 67890],
                    },
                    price: {
                      type: "number",
                      description:
                        "PPV price in USD. If set, the message content is locked behind a paywall.",
                      example: 9.99,
                    },
                    lockedText: {
                      type: "boolean",
                      description:
                        "If true, the text is hidden until the user pays the PPV price.",
                      default: false,
                    },
                    releaseForms: {
                      type: "array",
                      description:
                        "Release form IDs for compliance. Required if media contains other people.",
                      items: { type: "integer" },
                    },
                    replyToMessage: {
                      type: "integer",
                      description: "Message ID to reply to (creates a threaded reply).",
                    },
                  },
                },
                examples: {
                  textOnly: {
                    summary: "Simple text message",
                    value: { text: "Hey! How are you?" },
                  },
                  withMedia: {
                    summary: "Message with media attachments",
                    value: {
                      text: "Here's your exclusive content!",
                      mediaFiles: [12345, 67890],
                    },
                  },
                  ppvMessage: {
                    summary: "Pay-per-view message",
                    value: {
                      text: "Unlock to see 🔒",
                      mediaFiles: [12345],
                      price: 15.0,
                      lockedText: true,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Message sent successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFMessage" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/chats/{user_id}/messages/search": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Messaging"],
          summary: "Search messages in chat",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "query",
              in: "query",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Search results",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFMessage" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/chats/{user_id}/mark-as-read": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Messaging"],
          summary: "Mark chat as read",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Marked as read" } },
        },
      },
      "/api2/v2/messages/queue": {
        get: {
          tags: ["OF API — Messaging"],
          summary: "Get queued mass messages",
          description:
            "List all scheduled/queued mass messages. These are messages waiting to be sent to multiple users.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Queue list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Messaging"],
          summary: "Create a mass message",
          description:
            "Queue a mass message to be sent to multiple subscribers. You can target all subscribers, specific lists, or exclude certain users.\n\n**Attaching media:** `POST /accounts/{of_user_id}/media` (raw bytes or a `source_url` we fetch for you) returns a `media` object — pass it through here. Media already in the vault is referenced by its integer ID from `GET /api2/v2/vault/media`.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    text: {
                      type: "string",
                      description: "Message text",
                      example: "Special offer just for you! 🎁",
                    },
                    mediaFiles: {
                      type: "array",
                      items: { type: "integer" },
                      description: "Media IDs from vault",
                    },
                    price: {
                      type: "number",
                      nullable: true,
                      description: "PPV price for locked content",
                    },
                    lockedText: { type: "boolean", default: false },
                    releaseForms: {
                      type: "array",
                      items: { type: "integer" },
                    },
                    queueBuyers: {
                      type: "array",
                      description:
                        "Target audience filters. Empty array = all subscribers. Can specify list IDs or user groups.",
                      items: { type: "object" },
                      example: [],
                    },
                  },
                },
                examples: {
                  allSubscribers: {
                    summary: "Mass message to all subscribers",
                    value: {
                      text: "Happy weekend! Check your DMs for a surprise 🎁",
                      mediaFiles: [12345],
                      price: 5.0,
                      queueBuyers: [],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Mass message queued successfully" },
          },
        },
      },
      "/api2/v2/messages/queue/size": {
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Messaging"],
          summary: "Calculate mass message audience size",
          description:
            "Preview how many users would receive a mass message given the buyer filter criteria.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    queueBuyers: {
                      type: "array",
                      description:
                        "Same filter array as used in POST /messages/queue. Empty = all subscribers.",
                      items: { type: "object" },
                      example: [],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Audience size estimate",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      size: {
                        type: "integer",
                        description: "Number of users who would receive the message",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/messages/{message_id}/like": {
        post: {
          tags: ["OF API — Messaging"],
          summary: "Like / react to a message",
          description: "Send a like reaction to a specific message in a chat.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "message_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    withUserId: {
                      type: "integer",
                      description: "The user ID of the chat partner (recipient of the like notification).",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Message liked" } },
        },
      },
      "/api2/v2/messages/templates": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Messaging"],
          summary: "Get message templates",
          description: "Get saved message templates for quick replies.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          responses: {
            "200": {
              description: "Template list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFMessageTemplate" },
                  },
                },
              },
            },
          },
        },
      },

      // ── Content (OF API) ──
      "/api2/v2/posts": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get posts feed",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", default: "infinite" },
            },
            {
              name: "skip_users",
              in: "query",
              schema: { type: "string", default: "all" },
            },
          ],
          responses: {
            "200": {
              description: "Posts list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: {
                        type: "array",
                        items: { $ref: "#/components/schemas/OFPost" },
                      },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Content"],
          summary: "Create a new post",
          description:
            "Create a new post on your profile. Supports text, media attachments, PPV pricing, polls, scheduled publishing (`isScheduled` + `scheduledDate`), and expiration dates.\n\n**Attaching a freshly uploaded file — use `mediaFiles`, not `media`.** `POST /accounts/{of_user_id}/media` returns a `media` object; put it in a **`mediaFiles`** array here, unchanged and complete.\n\nVerified live 2026-08-06, and the failure mode is silent — OnlyFans returns `200` and simply attaches nothing if you get this wrong:\n\n| body | result |\n|---|---|\n| `mediaFiles: [{processId, host, thumbId, name, extra}]` | media attached ✅ |\n| `media: [{…same object…}]` | post created, **0 media** |\n| `mediaFiles: [{processId}]` only | post created, **0 media** |\n\nSo pass the whole object through — dropping `thumbId` or `name` silently loses the attachment.\n\nThe vault row for the media is created by this call and appears in `GET /api2/v2/vault/media` roughly 10–15 seconds later. It survives deletion of the post.\n\nMedia already in the vault is referenced by its integer ID from `GET /api2/v2/vault/media`.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    text: {
                      type: "string",
                      description: "Post text / caption",
                      example: "New exclusive content! 🔥",
                    },
                    rawText: {
                      type: "string",
                      description:
                        "Raw text without formatting (used internally for search/indexing)",
                    },
                    price: {
                      type: "number",
                      nullable: true,
                      description:
                        "PPV price in USD. If set, the post is locked behind a paywall.",
                      example: 15.0,
                    },
                    lockedText: {
                      type: "boolean",
                      description:
                        "If true, text content is hidden until PPV is purchased.",
                      default: false,
                    },
                    media: {
                      type: "array",
                      description:
                        "Media to attach: integer vault IDs (from `GET /api2/v2/vault/media`), and/or the `media` object returned by `POST /accounts/{of_user_id}/media` for a file you just uploaded.",
                      items: { type: "integer" },
                      example: [12345, 67890],
                    },
                    preview: {
                      type: "array",
                      nullable: true,
                      description:
                        "Preview media IDs visible before purchasing PPV content.",
                      items: { type: "integer" },
                    },
                    postedAt: {
                      type: "string",
                      format: "date-time",
                      description:
                        "Schedule date for the post (ISO 8601). If in the future, the post is scheduled.",
                      example: "2025-06-15T14:00:00.000Z",
                    },
                    postedAtPrecise: {
                      type: "string",
                      description:
                        "Precise timestamp string (unix ms). Used internally for ordering.",
                    },
                    expiredAt: {
                      type: "string",
                      format: "date-time",
                      nullable: true,
                      description:
                        "Expiration date — post auto-deletes after this time.",
                      example: "2025-07-15T14:00:00.000Z",
                    },
                    isPublishedWithPeriod: {
                      type: "boolean",
                      description:
                        "Whether the post is published for a specific time period (used with expiredAt).",
                      default: false,
                    },
                    voting: {
                      type: "array",
                      nullable: true,
                      description:
                        "Poll options. Each item is a poll choice string. Adds a poll/vote to the post.",
                      items: { type: "string" },
                      example: ["Option A", "Option B", "Option C"],
                    },
                    linkedPosts: {
                      type: "array",
                      nullable: true,
                      description:
                        "Array of post IDs to link to this post (related content).",
                      items: { type: "integer" },
                    },
                    releaseForms: {
                      type: "array",
                      description:
                        "Release form IDs for compliance when media features other people.",
                      items: { type: "integer" },
                    },
                    streamId: {
                      type: "integer",
                      nullable: true,
                      description:
                        "Link this post to a live stream by stream ID.",
                    },
                  },
                },
                examples: {
                  textPost: {
                    summary: "Simple text post",
                    value: { text: "Happy Monday everyone! ❤️" },
                  },
                  mediaPost: {
                    summary: "Post with media",
                    value: {
                      text: "New photoset just dropped!",
                      media: [12345, 67890, 11111],
                    },
                  },
                  ppvPost: {
                    summary: "Pay-per-view post",
                    value: {
                      text: "Unlock to see the full set 🔒",
                      media: [12345, 67890],
                      preview: [12345],
                      price: 25.0,
                      lockedText: false,
                    },
                  },
                  pollPost: {
                    summary: "Post with a poll",
                    value: {
                      text: "What should I post next?",
                      voting: [
                        "Beach photoshoot",
                        "Gym content",
                        "Behind the scenes",
                      ],
                    },
                  },
                  scheduledPost: {
                    summary: "Scheduled post",
                    value: {
                      text: "Coming soon...",
                      media: [12345],
                      postedAt: "2025-06-20T18:00:00.000Z",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Post created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFPost" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/posts/{post_id}": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get specific post",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "post_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "skip_users",
              in: "query",
              schema: { type: "string", default: "all" },
            },
          ],
          responses: {
            "200": {
              description: "Post object",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFPost" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/posts/{post_id}/comments": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get post comments",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "post_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Comments list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            id: { type: "integer" },
                            text: { type: "string" },
                            author: { $ref: "#/components/schemas/OFUserProfile" },
                            createdAt: { type: "string", format: "date-time" },
                            likesCount: { type: "integer" },
                          },
                        },
                      },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/posts/{post_id}/favorites": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Like / favorite a post",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "post_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Post liked" } },
        },
      },
      "/api2/v2/posts/{post_id}/vote": {
        post: {
          tags: ["OF API — Content"],
          summary: "Vote on a post poll",
          description:
            "Submit a vote on a post that has a poll attached. Get the `optionId` from the post's `voting` array.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "post_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["optionId"],
                  properties: {
                    optionId: {
                      type: "integer",
                      description:
                        "The poll option ID to vote for (from the post's voting array).",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Vote recorded" } },
        },
      },
      "/api2/v2/posts/pinned/sort": {
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Content"],
          summary: "Reorder pinned posts",
          description:
            "Change the display order of your pinned posts on your profile.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["order"],
                  properties: {
                    order: {
                      type: "array",
                      items: { type: "integer" },
                      description:
                        "Ordered array of pinned post IDs. First ID appears first on profile.",
                      example: [999, 888, 777],
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Pin order updated" } },
        },
      },
      "/api2/v2/posts/stats-collect": {
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Content"],
          summary: "Report post view/interaction stats",
          description:
            "Submit post view and interaction analytics. Used by the client to report which posts were viewed, scrolled past, or interacted with.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["actions"],
                  properties: {
                    actions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          postId: { type: "integer" },
                          type: {
                            type: "string",
                            description:
                              "Action type (e.g. 'view', 'scroll', 'click')",
                          },
                        },
                      },
                      description: "Array of post interaction events",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Stats collected" } },
        },
      },
      "/api2/v2/posts/bookmarks": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get bookmarked posts",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Bookmarked posts",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFPost" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/posts/bookmarks/categories": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get bookmark categories",
          responses: {
            "200": {
              description: "Categories list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFBookmarkCategory" },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/labels": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get user labels",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Labels list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFLabel" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/vault/lists": {
        get: {
          description: "List the vault folders for an account.\n\n**`view=main` is required** — omitting it makes OnlyFans respond `400 Bad view param` (passed through verbatim). The response is wrapped in the standard passthrough envelope (`{ success, status_code, data }`); the OnlyFans body is under `data`, where `data.list` is the folder array and `data.all` carries global counts across the whole vault.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get vault lists (folders)",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "view",
              in: "query",
              required: true,
              description: "Required by OnlyFans. Use `main` — it returns the folder list plus the `all` bucket of global counts. Omitting it returns `400 Bad view param`.",
              schema: { type: "string", enum: ["main"], default: "main" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Vault folders, wrapped in the passthrough envelope.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          all: {
                            type: "object",
                            description: "Pseudo-folder holding global counts across the entire vault.",
                            properties: {
                              photosCount: { type: "integer" },
                              videosCount: { type: "integer" },
                              gifsCount: { type: "integer" },
                              audiosCount: { type: "integer" },
                            },
                          },
                          list: { type: "array", items: { $ref: "#/components/schemas/OFVaultList" } },
                          hasMore: { type: "boolean" },
                          order: { type: "string" },
                          sort: { type: "string" },
                          canCreateVaultLists: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/vault/media": {
        get: {
          description: "List vault media items. This is how you obtain the integer media IDs referenced by post creation, story creation, and messages.\n\n**Uploading new media:** use `POST /accounts/{of_user_id}/media`. A freshly uploaded file will **not** show up in this list right away — OnlyFans creates the vault entry when a post/message/story consumes the upload's `processId`, not at upload time. That is OnlyFans' own behaviour, not a limitation of this API: there is no upload-to-vault endpoint anywhere in the OnlyFans web client. (A `POST /api2/v2/media` upload route was documented in error until 2026-08-06 — it never existed and OnlyFans answers it with 404.)\n\n**Filtering (supported, but previously undocumented):** `list={list_id}` restricts results to one folder, `field=recent` chooses the ordering field, and `sort=asc|desc` the direction — combine with `limit`/`offset` for paging. The response is wrapped in the standard passthrough envelope; the OnlyFans body (`{ list, hasMore }`) is under `data`.\n\n**Matching a local file to an existing item:** the media object carries no filename or hash — use `GET /api2/v2/vault/media/hash?h={md5}&size={bytes}` instead.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get vault media",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "list",
              in: "query",
              description: "Restrict results to a single vault folder (a list ID from GET /vault/lists).",
              schema: { type: "integer" },
            },
            {
              name: "field",
              in: "query",
              description: "Ordering field. `recent` orders by upload time.",
              schema: { type: "string", enum: ["recent"], default: "recent" },
            },
            {
              name: "sort",
              in: "query",
              description: "Sort direction.",
              schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 24 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Media items, wrapped in the passthrough envelope.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          list: { type: "array", items: { $ref: "#/components/schemas/OFMedia" } },
                          hasMore: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // NOTE: there is deliberately no `POST /api2/v2/media` entry here.
      // It was documented as the vault upload endpoint for a long time and
      // never existed — OF answers it with 404 "Route not found.", and it is
      // absent from both reverse passes over the OF web client. Media upload
      // now lives at the CRM route `POST /accounts/{of_user_id}/media` below,
      // which drives OF's real four-stage signed-S3 pipeline server-side.
      "/api2/v2/vault/media/{media_id}/attach": {
        put: {
          tags: ["OF API — Content"],
          summary: "Attach vault media to post/message",
          description:
            "Attach a media item from the vault to an existing post or message. The media must already be uploaded.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "media_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
              description: "Vault media ID",
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    postId: {
                      type: "integer",
                      description: "Post ID to attach media to",
                    },
                    messageId: {
                      type: "integer",
                      description: "Message ID to attach media to",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Media attached" } },
        },
      },
      "/api2/v2/vault/lists/{list_id}/media": {
        post: {
          tags: ["OF API — Content"],
          summary: "Add media to vault list",
          description:
            "Add one or more media items to a vault list (folder) for organization.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "list_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
              description: "Vault list ID",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["mediaIds"],
                  properties: {
                    mediaIds: {
                      type: "array",
                      items: { type: "integer" },
                      description: "Array of media IDs to add to the list",
                      example: [12345, 67890],
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Media added to list" } },
        },
      },
      "/api2/v2/vault/media/hash": {
        get: {
          description: "**Deduplication / file→vault-item lookup.** Given the MD5 of an original file, returns the matching vault media if that exact byte content was previously uploaded, or `404 Media Not Found` if not.\n\nThis is the ONLY content-based way to correlate a local file with an existing vault item — OnlyFans stores no filename or hash on the media object. The hash is the MD5 of the **original uploaded bytes**: hashing a downloaded/CDN copy will NOT match (the served file differs from the original), and a file that was re-encoded/re-exported after upload will not match either. In that case, capture the media `id` at upload time and keep your own `source → id` map.\n\nResponse is wrapped in the passthrough envelope. **OnlyFans only.**",
          tags: ["OF API — Content"],
          summary: "Find vault media by MD5 (dedupe)",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "h",
              in: "query",
              required: true,
              description:
                "MD5 hex digest of the ORIGINAL uploaded file bytes. Note the parameter is `h`, not `hash` — this was documented as `hash` in error until 2026-08-06. For a single-part upload the S3 ETag returned by `POST /accounts/{of_user_id}/media` is exactly this MD5, so you can feed it straight back in.",
              schema: { type: "string", example: "9f86d081884c7d659a2feaa0c55ad015" },
            },
            {
              name: "size",
              in: "query",
              required: true,
              description:
                "Size of the original file in bytes. OnlyFans' own client always sends this alongside `h`.",
              schema: { type: "integer", example: 290758 },
            },
          ],
          responses: {
            "200": {
              description:
                "Matching media, wrapped in the passthrough envelope. On no match: `success:false`, `status_code:404`, and `data.error.message = \"Media Not Found\"`.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: { $ref: "#/components/schemas/OFMedia" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/vault/media/types": {
        get: {
          description: "Report which media types exist in the vault. `data` is a flat object of booleans (NOT counts) — one per type.\n\nResponse is wrapped in the passthrough envelope. **OnlyFans only.**",
          tags: ["OF API — Content"],
          summary: "Get vault media types present",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "200": {
              description: "Booleans for which media types are present, wrapped in the passthrough envelope.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          hasPhoto: { type: "boolean" },
                          hasVideo: { type: "boolean" },
                          hasGif: { type: "boolean" },
                          hasAudio: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/vault/media/processing": {
        get: {
          description: "List media still being processed/transcoded by OnlyFans (items whose `isReady` is false).\n\n`data` carries its OWN `success` flag alongside `list` — distinct from the outer envelope's `success`.\n\nResponse is wrapped in the passthrough envelope. **OnlyFans only.**",
          tags: ["OF API — Content"],
          summary: "Get vault media being processed",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          responses: {
            "200": {
              description: "Media currently processing, wrapped in the passthrough envelope.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          is_processing: { type: "boolean" },
                          success: { type: "boolean", description: "OnlyFans' own flag, nested inside data." },
                          list: { type: "array", items: { $ref: "#/components/schemas/OFMedia" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/vault/media/{media_id}": {
        get: {
          description: "Get a single vault media item by ID.\n\nResponse is wrapped in the passthrough envelope; the OnlyFans media object is under `data`. **OnlyFans only.**",
          tags: ["OF API — Content"],
          summary: "Get vault media item",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "media_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
              description: "Vault media ID.",
            },
          ],
          responses: {
            "200": {
              description: "The media item, wrapped in the passthrough envelope.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: { $ref: "#/components/schemas/OFMedia" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/vault/media/{media_id}/posts": {
        get: {
          description: "List posts that use a specific vault media item.\n\nResponse is wrapped in the passthrough envelope. **OnlyFans only.**",
          tags: ["OF API — Content"],
          summary: "Get posts using a vault media item",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "media_id",
              in: "path",
              required: true,
              schema: { type: "integer" },
              description: "Vault media ID.",
            },
          ],
          responses: {
            "200": {
              description: "Posts referencing the media, wrapped in the passthrough envelope.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          list: { type: "array", items: { $ref: "#/components/schemas/OFPost" } },
                          hasMore: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/schedules": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get scheduled posts",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Scheduled posts",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFPost" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/schedules/counters": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Content"],
          summary: "Get scheduled-post counts per day",
          responses: {
            "200": {
              description: "Scheduled-post counts, wrapped in the passthrough envelope. `data.list` is an OBJECT keyed by ISO date (e.g. \"2026-07-28\") whose value is `{ post: <count> }` — it is NOT an array.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          list: {
                            type: "object",
                            description: "Keyed by ISO date string.",
                            additionalProperties: {
                              type: "object",
                              properties: { post: { type: "integer" } },
                            },
                          },
                          syncInProcess: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Stories (OF API) ──
      "/api2/v2/users/me/stories": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Stories"],
          summary: "Get your active stories",
          responses: {
            "200": {
              description: "Story list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFStory" },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Stories"],
          summary: "Create a new story",
          description:
            "Post a new story. Stories expire after 24 hours.\n\n**Attaching media:** `POST /accounts/{of_user_id}/media` (raw bytes or a `source_url` we fetch for you) returns a `media` object — pass it through here. Media already in the vault is referenced by its integer ID from `GET /api2/v2/vault/media`.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    media: {
                      type: "array",
                      description:
                        "Array of media IDs from vault upload. At least one required.",
                      items: { type: "integer" },
                      example: [12345],
                    },
                    question: {
                      type: "string",
                      nullable: true,
                      description:
                        "Optional question text to display on the story (interactive Q&A).",
                      example: "What should I post next?",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Story created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFStory" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/{user_id}/stories": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Stories"],
          summary: "Get user's stories",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Story list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFStory" },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/{user_id}/stories/highlights": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Stories"],
          summary: "Get story highlights",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Highlights list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        title: { type: "string" },
                        cover: { type: "string", description: "Cover image URL" },
                        stories: { type: "array", items: { $ref: "#/components/schemas/OFStory" } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/stories/highlights": {
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Stories"],
          summary: "Create a story highlight",
          description:
            "Save stories to a permanent highlight collection on your profile. Stories in highlights don't expire.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "Highlight title/name",
                      example: "Best Moments ✨",
                    },
                    storyIds: {
                      type: "array",
                      items: { type: "integer" },
                      description: "Story IDs to include in the highlight",
                      example: [111, 222, 333],
                    },
                    cover: {
                      type: "integer",
                      nullable: true,
                      description:
                        "Story ID to use as the highlight cover image",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Highlight created" } },
        },
      },
      "/api2/v2/stories/archive": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Stories"],
          summary: "Get archived stories",
          responses: {
            "200": {
              description: "Archived stories",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFStory" },
                  },
                },
              },
            },
          },
        },
      },

      // ── Streams (OF API) ──
      "/api2/v2/streams": {
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Streams"],
          summary: "Create / start a live stream",
          description:
            "Start a new live stream. Returns stream configuration including the room ID and streaming credentials.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "Stream title displayed to viewers",
                      example: "Friday night live! 🎉",
                    },
                    description: {
                      type: "string",
                      description: "Stream description",
                    },
                    isFree: {
                      type: "boolean",
                      description:
                        "If true, stream is free for all. If false, only subscribers can watch.",
                      default: false,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Stream created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFStream" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/streams/active": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Streams"],
          summary: "Get active live streams",
          responses: {
            "200": {
              description: "Active streams",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFStream" },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/streams/{stream_id}/viewers": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Streams"],
          summary: "Get stream viewers",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "stream_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Viewer list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/streams/{stream_id}/stats": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Streams"],
          summary: "Get stream statistics",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "stream_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Stream stats",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      viewersCount: { type: "integer" },
                      likesCount: { type: "integer" },
                      tipsAmount: { type: "number" },
                      commentsCount: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/streams/feed": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Streams"],
          summary: "Stream discovery feed",
          responses: {
            "200": {
              description: "Stream feed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFStream" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/streams/{stream_id}/vote": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Streams"],
          summary: "Vote on a stream poll",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "stream_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["optionId"],
                  properties: {
                    optionId: {
                      type: "integer",
                      description: "The poll option ID to vote for",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Vote recorded" } },
        },
      },
      "/api2/v2/streams/{stream_id}/kick": {
        post: {
          tags: ["OF API — Streams"],
          summary: "Kick a user from stream",
          description: "Remove a viewer from the live stream (creator only).\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "stream_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["userId"],
                  properties: {
                    userId: {
                      type: "integer",
                      description: "User ID to kick from the stream",
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "User kicked" } },
        },
      },

      // ── Campaigns (OF API) ──
      "/api2/v2/campaigns": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Campaigns"],
          summary: "List campaigns",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "pagination",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "stats",
              in: "query",
              schema: { type: "string", default: "true" },
            },
          ],
          responses: {
            "200": {
              description: "Campaign list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: {
                        type: "array",
                        items: { $ref: "#/components/schemas/OFCampaign" },
                      },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Campaigns"],
          summary: "Create campaign",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", example: "My Campaign" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Campaign created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFCampaign" },
                },
              },
            },
          },
        },
      },
      "/api2/v2/campaigns/{campaign_id}/claimers": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Campaigns"],
          summary: "Get campaign conversions",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "campaign_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Claimer list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Payouts (OF API) ──
      "/api2/v2/payouts/balances": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "Get payout balances",
          responses: {
            "200": {
              description: "Balance data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      current: { type: "number", description: "Current available balance" },
                      pending: { type: "number", description: "Pending balance" },
                      total: { type: "number", description: "Total lifetime earnings" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/earnings/chart": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "Get earnings chart",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              required: true,
              schema: { type: "string" },
              example: "2025-01-01 00:00:00",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string" },
              example: "2025-12-31 23:59:59",
            },
            {
              name: "withTotal",
              in: "query",
              schema: { type: "string", default: "true" },
            },
          ],
          responses: {
            "200": {
              description: "Earnings chart data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: {
                        type: "object",
                        properties: {
                          total: { type: "number", description: "Total net earnings" },
                          gross: { type: "number", description: "Total gross earnings" },
                          chartAmount: { type: "array", items: { type: "number" }, description: "Earnings per time bucket" },
                          chartCount: { type: "array", items: { type: "number" }, description: "Transaction count per time bucket" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/transactions": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "Get payout transactions",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "Transaction list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      hasMore: { type: "boolean" },
                      marker: { type: "string", nullable: true },
                      nextMarker: { type: "string", nullable: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/requests": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "List payout requests",
          responses: {
            "200": {
              description: "Payout request history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            state: { type: "string", description: "e.g. 'new', 'completed', 'rejected'" },
                            rejectReason: { type: "string", nullable: true },
                            amount: { type: "number" },
                            createdAt: { type: "string", format: "date-time" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "Create payout request",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    withdrawalAmount: { type: "number", example: 100.0 },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Payout requested" } },
        },
      },
      "/api2/v2/payouts/chargebacks": {
        get: {
          tags: ["OF API — Payouts"],
          summary: "List chargebacks / disputes",
          description: "Paginated list of chargeback transactions. Uses marker-based pagination.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
              description: "Filter start date",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
              description: "Filter end date",
            },
          ],
          responses: {
            "200": {
              description: "Chargeback list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      marker: { type: "number", nullable: true, description: "Pagination marker (unix timestamp)" },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/chargebacks/ratio": {
        get: {
          tags: ["OF API — Payouts"],
          summary: "Get chargeback ratio",
          description: "Returns the chargeback-to-transaction ratio for the given date range.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
          ],
          responses: {
            "200": {
              description: "Chargeback ratio",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      chargebacksRatio: { type: "number", description: "Ratio of chargebacks (0–1)" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/chargebacks/chart": {
        get: {
          tags: ["OF API — Payouts"],
          summary: "Get chargebacks chart data",
          description: "Time-series chart data for chargebacks with totals and delta.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "withTotal",
              in: "query",
              schema: { type: "boolean", default: true },
            },
          ],
          responses: {
            "200": {
              description: "Chargebacks chart",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "number", description: "Total chargeback amount for the period" },
                      delta: { type: "number", description: "Change vs previous period" },
                      chartAmount: { type: "array", items: { type: "number" }, description: "Amount per time bucket" },
                      chartCount: { type: "array", items: { type: "number" }, description: "Count per time bucket" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/requests/referral": {
        get: {
          tags: ["OF API — Payouts"],
          summary: "List referral payout requests",
          description: "Paginated list of referral payout transactions. Uses marker-based pagination.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
            {
              name: "marker",
              in: "query",
              schema: { type: "number", nullable: true },
              description: "Pagination marker from previous response",
            },
          ],
          responses: {
            "200": {
              description: "Referral payout list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      marker: { type: "number", nullable: true },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/referrals/chart": {
        get: {
          tags: ["OF API — Payouts"],
          summary: "Get referrals chart data",
          description: "Time-series chart data for referral earnings with totals and delta.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "withTotal",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
          ],
          responses: {
            "200": {
              description: "Referrals chart",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      total: { type: "number", description: "Total referral earnings for the period" },
                      delta: { type: "number", description: "Change vs previous period" },
                      chartAmount: { type: "array", items: { type: "number" }, description: "Earnings per time bucket" },
                      chartCount: { type: "array", items: { type: "number" }, description: "Referral count per time bucket" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payouts/account": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Payouts"],
          summary: "Get payout account info",
          description: "Get saved banking/payment method info for payouts.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          responses: {
            "200": {
              description: "Banking info",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      type: { type: "string", description: "Payment method type" },
                      isVerified: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payments/all/transactions": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "Get all payment transactions",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "All transactions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/payments/referrals/balance": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Payouts"],
          summary: "Get referral earnings balance",
          responses: {
            "200": {
              description: "Referral balance",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      balance: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // ── Notifications (OF API) ──
      "/api2/v2/users/notifications": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Notifications"],
          summary: "Get notifications",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 20 },
            },
            {
              name: "skip_users",
              in: "query",
              schema: { type: "string", default: "all" },
            },
            {
              name: "format",
              in: "query",
              schema: { type: "string", default: "infinite" },
            },
          ],
          responses: {
            "200": {
              description: "Notification list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { type: "object" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/notifications/count": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Notifications"],
          summary: "Get unread notification count",
          responses: {
            "200": {
              description: "Unread count",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      count: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/users/notifications/read": {
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Notifications"],
          summary: "Mark all notifications as read",
          responses: { "200": { description: "Marked as read" } },
        },
      },

      // ── Lists (OF API) ──
      "/api2/v2/lists": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Lists"],
          summary: "Get user lists",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Lists",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFList" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Lists"],
          summary: "Create a new list",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", example: "My List" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "List created" } },
        },
      },
      "/api2/v2/lists/{list_id}/users": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Lists"],
          summary: "Get users in a list",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "list_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "User list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFUserProfile" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/lists/{list_id}/users/{user_id}": {
        post: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Lists"],
          summary: "Add user to list",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "list_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "User added" } },
        },
        delete: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Lists"],
          summary: "Remove user from list",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "list_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "user_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "User removed" } },
        },
      },

      // ── Promotions (OF API) ──
      "/api2/v2/promotions": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Promotions"],
          summary: "Get promotions",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Promotions list, wrapped in the passthrough envelope. NOTE: the array is under `data.items` (NOT `data.list`). OnlyFans ignores `limit` here — page with `offset` and watch `hasMore`.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status_code: { type: "integer" },
                      data: {
                        type: "object",
                        properties: {
                          items: { type: "array", items: { $ref: "#/components/schemas/OFPromotion" } },
                          hasMore: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/promotions/offers": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Promotions"],
          summary: "Get active promotional offers",
          responses: {
            "200": {
              description: "Offers list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFPromotion" },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/trials": {
        get: {
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Promotions"],
          summary: "Get free trial links",
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
            },
            {
              name: "offset",
              in: "query",
              schema: { type: "integer", default: 0 },
            },
          ],
          responses: {
            "200": {
              description: "Trial links",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      list: { type: "array", items: { $ref: "#/components/schemas/OFTrial" } },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Promotions"],
          summary: "Create a free trial link",
          responses: { "200": { description: "Trial created" } },
        },
      },

      // ── Helpers (OF API) ──
      "/api2/v2/helpers": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Helpers"],
          summary: "List account helpers",
          responses: {
            "200": {
              description: "Helper list",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/OFHelper" },
                  },
                },
              },
            },
          },
        },
      },
      "/api2/v2/helpers/permissions": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          description: "**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          tags: ["OF API — Helpers"],
          summary: "Get helper permissions",
          responses: {
            "200": {
              description: "Permissions config",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    description: "Permission flags for each helper capability area",
                  },
                },
              },
            },
          },
        },
      },

      // ── Misc (OF API) ──
      "/api2/v2/init": {
        get: {
          parameters: [
            { $ref: "#/components/parameters/ofUserIdHeader" },
            { $ref: "#/components/parameters/proxyHeader" },
          ],
          tags: ["OF API — Misc"],
          summary: "App initialization data",
          description: "Returns comprehensive initialization data including authenticated user profile, feature flags, chat counts, and app configuration.\n\n**OnlyFans only.** Requests made with a `user-id` belonging to a Fansly account are rejected — use the platform-neutral CRM data routes (`/notifications`, `/balances`, `/chats`, `/purchases`, `/subscribers/cached`, ...) which are Fansly-aware.",
          responses: {
            "200": {
              description: "Init payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OFInitPayload" },
                },
              },
            },
          },
        },
      },

      // ══════════════════════════════════════════════════════════
      //  CRM ENDPOINTS — bulk import, Telegram, and the routes that
      //  shipped after the first pass of this spec was written.
      //  Response schemas for these are derived from crm_api.py by
      //  docs-site/scripts/extract-responses.py, so a `200` here
      //  carries a description and lets the derivation supply the
      //  field list. Hand-copying it would only invite drift.
      // ══════════════════════════════════════════════════════════

      // ── Bulk account import ──
      "/import/preview": {
        post: {
          tags: ["Bulk Import"],
          summary: "Preview an import paste",
          description:
            "Parse and validate a pasted account list **without side effects** — nothing is written, no login is attempted, and no slot is consumed. Use it to show which rows are valid, which lane each one will take (`cookie` or `password`), and exactly why a bad row is bad, before committing to an import.\n\nSecrets are never echoed back: passwords and TOTP secrets are reduced to `has_password` / `has_totp_secret`, cookies to a `cookie_fields` name list, and a proxy URL to `host:port` with its credentials stripped.\n\nAccepted formats are auto-detected — CSV, TSV, colon- or pipe-separated, with or without a header row. Limits are 1,000 rows and 2 MiB per paste; exceeding either is a rejection, never a silent truncation.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["text"],
                  properties: {
                    text: {
                      type: "string",
                      description: "The pasted account list, one account per line.",
                      example:
                        "email,password,proxy\ncreator1@example.com,pw1,http://user:pass@host:1080\ncreator2@example.com,pw2,",
                    },
                    default_platform: {
                      type: "string",
                      enum: ["onlyfans", "fansly"],
                      default: "onlyfans",
                      description:
                        "Platform for rows that do not name one themselves. Also accepted as `platform`.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Parse result. `rows[]` is redacted; `lanes` and `platforms` count the valid rows by lane and platform.",
            },
            "400": {
              description:
                "`text` missing, `default_platform` not one of `onlyfans`/`fansly`, or the paste could not be parsed (`code: \"IMPORT_PARSE\"`).",
            },
            "413": {
              description:
                "Paste exceeds `max_rows` (1,000) or `max_bytes` (2 MiB). Returns `code: \"IMPORT_LIMIT\"` with a `limits` object. Nothing is imported — split the paste and retry.",
            },
          },
        },
      },
      "/import/jobs": {
        post: {
          tags: ["Bulk Import"],
          summary: "Start a bulk import",
          description:
            "Create an import job and start working through the rows in the background. Returns `202` immediately with the job and its per-status counts.\n\nProgress streams over [`GET /events/stream`](#tag/events-and-streaming) as `import.progress` (coalesced to at most one per second) and finishes with `import.complete`. The job row is the source of truth — if you miss an event, `GET /import/jobs/{job_id}` still has the current state.\n\nRows that hit a 2FA prompt do not fail: they park as `needs_2fa` holding the challenge, and wait for a code via `POST /import/jobs/{job_id}/rows/{row_id}/otp`. Parked rows expire after 10 minutes (retry them for a fresh login) and their stored credential is destroyed after 24 hours regardless.\n\nInvalid rows are reported but never attempted. If *no* row is valid the request fails with `400` and the per-row reasons rather than creating a job that is 100% failures.",
          parameters: [
            {
              name: "X-User-Email",
              in: "header",
              required: false,
              schema: { type: "string" },
              description:
                "Optional label recorded as the job's `requested_by`, for panels where several operators share a key.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["text"],
                  properties: {
                    text: {
                      type: "string",
                      description: "The pasted account list, one account per line.",
                    },
                    default_platform: {
                      type: "string",
                      enum: ["onlyfans", "fansly"],
                      default: "onlyfans",
                      description:
                        "Platform for rows that do not name one themselves. Also accepted as `platform`.",
                    },
                    source: {
                      type: "string",
                      default: "paste",
                      maxLength: 20,
                      description:
                        "Free-text label for where the list came from, stored on the job.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description:
                "Job created and running. `warning` is present only when some rows failed validation and will not be attempted.",
            },
            "400": {
              description:
                "No valid rows. The body carries the same `rows[]` and counts as `POST /import/preview` so you can show what to fix.",
            },
            "413": {
              description:
                "Paste exceeds `max_rows` or `max_bytes` (`code: \"IMPORT_LIMIT\"`).",
            },
          },
        },
        get: {
          tags: ["Bulk Import"],
          summary: "List import jobs",
          description:
            "Import history for the panel, newest first, each job carrying its per-status row counts.",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50, minimum: 1, maximum: 200 },
              description: "Jobs per page (1–200).",
            },
            { $ref: "#/components/parameters/offsetParam" },
          ],
          responses: {
            "200": { description: "Job history with `total` for pagination." },
          },
        },
      },
      "/import/jobs/{job_id}": {
        get: {
          tags: ["Bulk Import"],
          summary: "Get an import job",
          description:
            "One job with its rows and counts. This is the fallback whenever an SSE event is missed — the stored row is authoritative, the events are only a live nudge.\n\n`counts` is zero-filled across every state, so a missing key never has to be read as \"unknown\". `row_states` echoes the full state vocabulary: `pending`, `running`, `success`, `needs_2fa`, `needs_2fa_expired`, `failed`, `canceled`, `invalid`, `skipped`, `slot_exhausted`.\n\nRows never carry credentials — each has `has_password` / `has_totp_secret` flags instead, and a row parked on 2FA also reports `two_fa_remaining_seconds`.",
          parameters: [
            { $ref: "#/components/parameters/importJobId" },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 1000, minimum: 1, maximum: 1000 },
              description: "Rows per page (1–1000).",
            },
            { $ref: "#/components/parameters/offsetParam" },
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "pending",
                  "running",
                  "success",
                  "needs_2fa",
                  "needs_2fa_expired",
                  "failed",
                  "canceled",
                  "invalid",
                  "skipped",
                  "slot_exhausted",
                ],
              },
              description:
                "Return only rows in this state. An unrecognised value is a `400`, not an empty page.",
            },
          ],
          responses: {
            "200": { description: "Job, counts, and one page of rows." },
            "400": { description: "Unknown `status` filter." },
            "404": { description: "No such job in this panel." },
          },
        },
      },
      "/import/jobs/{job_id}/cancel": {
        post: {
          tags: ["Bulk Import"],
          summary: "Cancel an import job",
          description:
            "Stop an import. Cancellation is cooperative: `pending` rows are canceled at once and nothing further is claimed, but a row already mid-login runs to completion — we cannot un-send a login attempt — and records its real outcome. Expect a few more successes after cancelling.\n\nOnly a `queued` or `running` job can be canceled.",
          parameters: [{ $ref: "#/components/parameters/importJobId" }],
          responses: {
            "200": {
              description:
                "Canceled. `canceled_rows` is how many pending rows were dropped.",
            },
            "404": { description: "No such job in this panel." },
            "409": {
              description:
                "Job is already finished — the body reports its actual status.",
            },
          },
        },
      },
      "/import/jobs/{job_id}/rows/{row_id}/otp": {
        post: {
          tags: ["Bulk Import"],
          summary: "Supply a 2FA code for an import row",
          description:
            "Complete one row parked on `needs_2fa` by submitting the code the creator received.\n\nSynchronous by design: it is a single platform call and an operator is watching, so the response carries the real outcome rather than \"queued\". `success: true` means the account is connected.\n\nThe field is `code` (`otp_code` is also accepted here), 4–12 characters, letters, digits and hyphens. This route is on the standard sensitive tier (100/minute), not the login tier — clearing a queue of parked rows back to back is the expected workflow, and the code is verified by the platform rather than by us.",
          parameters: [
            { $ref: "#/components/parameters/importJobId" },
            { $ref: "#/components/parameters/importRowId" },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code"],
                  properties: {
                    code: {
                      type: "string",
                      pattern: "^[A-Za-z0-9-]{4,12}$",
                      example: "123456",
                      description:
                        "The 2FA code. Also accepted as `otp_code`.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Connected.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      row: { $ref: "#/components/schemas/ImportJobRow" },
                    },
                    required: ["success", "row"],
                  },
                },
              },
            },
            "400": {
              description:
                "Malformed code, or the platform rejected it. The row stays parked when the window is still open, so a mistyped code can be resubmitted.",
            },
            "404": { description: "No such row in this job." },
            "409": {
              description:
                "Row is not waiting for a code — either it never was, or its 10-minute window closed (`status: \"needs_2fa_expired\"`). Retry the row to start a fresh login.",
            },
            "503": {
              description:
                "The platform's OTP verification is temporarily unavailable. The row stays parked; try again.",
            },
          },
        },
      },
      "/import/jobs/{job_id}/rows/{row_id}/retry": {
        post: {
          tags: ["Bulk Import"],
          summary: "Retry an import row",
          description:
            "Re-queue one row and restart the job's worker. A `needs_2fa_expired` row re-runs the login **from scratch** — the parked challenge is dead, so replaying it would only earn another rejection.\n\nA row cannot be retried once its stored credential has been destroyed (which happens when a password-lane row reaches a terminal state or ages out after 24 hours); re-import it instead.",
          parameters: [
            { $ref: "#/components/parameters/importJobId" },
            { $ref: "#/components/parameters/importRowId" },
          ],
          responses: {
            "202": {
              description: "Row re-queued; the job is running again.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      row: { $ref: "#/components/schemas/ImportJobRow" },
                    },
                    required: ["success", "row"],
                  },
                },
              },
            },
            "404": { description: "No such row in this job." },
            "409": {
              description:
                "Not retryable: already queued or running, already connected, never parsed (`invalid`), or its credential is gone.",
            },
          },
        },
      },
      "/import/pending-2fa": {
        get: {
          tags: ["Bulk Import"],
          summary: "List rows waiting on a 2FA code",
          description:
            "Every parked 2FA row on the panel, across **all** jobs — `needs_2fa` first, soonest to expire first.\n\nThis is deliberately panel-wide rather than per-job: an operator closes the importer and the dashboard still has to be able to say \"9 accounts need a 2FA code\". `count` is how many are still answerable, `expired_count` how many need a retry instead, and `expiry_seconds` is the window length each one gets.",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 200, minimum: 1, maximum: 1000 },
              description: "Maximum rows to return (1–1000).",
            },
          ],
          responses: {
            "200": { description: "Parked rows across every job in the panel." },
          },
        },
      },

      // ── Telegram channel (one per panel) ──
      "/integrations/telegram": {
        get: {
          tags: ["Integrations"],
          summary: "Get the Telegram integration",
          description:
            "The panel's Telegram channel, or `integration: null` if none is configured.\n\n`shared_bot_available` says whether this deployment has our shared bot configured — check it before offering \"use the shared bot\", so you never present a button that cannot work. `event_types` lists every event type you may subscribe to.\n\nThe bot token is never returned by this or any other route; `has_custom_token` only reports whether one is stored.",
          responses: {
            "200": {
              description:
                "Integration state, plus the deployment's shared-bot availability and the allowed event types.",
            },
          },
        },
        patch: {
          tags: ["Integrations"],
          summary: "Update the Telegram integration",
          description:
            "Change which events are delivered, or pause delivery without unpairing. Send only the fields you want to change.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    event_types: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Event types to deliver. `[\"*\"]` means every type.",
                      example: ["new_subscriber", "new_tip"],
                    },
                    is_active: {
                      type: "boolean",
                      description:
                        "Set `false` to stop delivery while keeping the pairing.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated integration." },
            "400": { description: "An event type is not recognised." },
            "404": { description: "No Telegram integration configured." },
          },
        },
        delete: {
          tags: ["Integrations"],
          summary: "Remove the Telegram integration",
          description:
            "Unpair the channel and delete the stored configuration, including any custom bot token.",
          responses: {
            "200": { description: "Removed." },
            "404": { description: "No Telegram integration configured." },
          },
        },
      },
      "/integrations/telegram/pair": {
        post: {
          tags: ["Integrations"],
          summary: "Start Telegram pairing",
          description:
            "Begin (or restart) pairing and get a `t.me` deep link. Open the link, and the chat that the bot lands in becomes the panel's channel.\n\nTwo modes:\n\n- `bot_mode: \"shared\"` — use our bot. Nothing else to supply. Returns `409` if this deployment has no shared bot configured, rather than handing back a link that can never resolve.\n- `bot_mode: \"custom\"` — use your own bot, passing its `bot_token`. We verify the token with Telegram before storing it, encrypt it at rest, and clear any existing webhook on that bot (otherwise our polling would conflict with it and the deep link would silently never resolve).\n\nThe response carries the deep link and its expiry, never a token. Calling this again replaces any pending code.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    bot_mode: {
                      type: "string",
                      enum: ["shared", "custom"],
                      default: "shared",
                    },
                    bot_token: {
                      type: "string",
                      description:
                        "Required when `bot_mode` is `custom`. Stored encrypted and never returned.",
                      example: "123456789:AA…",
                    },
                    event_types: {
                      type: "array",
                      items: { type: "string" },
                      description:
                        "Which events to deliver. Defaults to every type.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Pairing started. Open `deep_link` before `expires_at` (`ttl_seconds` from now).",
            },
            "400": {
              description:
                "`bot_mode` invalid, an event type is not recognised, the token is malformed, Telegram rejected it, or it is the shared token (use `bot_mode: \"shared\"`).",
            },
            "409": {
              description:
                "`bot_mode: \"shared\"` requested but this deployment has no shared bot. Connect your own bot instead.",
            },
          },
        },
      },
      "/integrations/telegram/test": {
        post: {
          tags: ["Integrations"],
          summary: "Send a Telegram test message",
          description:
            "Post a test message to the paired chat, so you can confirm the whole path end to end. Returns `400` with the failure reason — and the current integration state, including `last_error` — if Telegram refuses it.",
          responses: {
            "200": { description: "Test message delivered." },
            "400": {
              description:
                "Not paired, inactive, or Telegram rejected the send. The body carries the reason.",
            },
          },
        },
      },

      // ── Panel-wide balances & earnings verification ──
      "/balances/summary": {
        get: {
          tags: ["Earnings"],
          summary: "Get panel-wide payout totals",
          description:
            "Available and pending payout totals across every connected account, in **one** query and **zero** platform calls.\n\nThese are last-known values, not live ones. `payoutAvailable` is only knowable by asking the platform, so a live panel-wide total would cost one round trip per account — the honest trade is to serve the last sample and say how old it is. `GET /accounts/{of_user_id}/balances` stamps a fresh sample each time it runs, so normal dashboard use keeps the figures warm at no extra cost.\n\nLabel the number with `oldest_sample_at` / `newest_sample_at`, and treat `accounts_never_sampled` as \"not counted yet\" rather than zero. `currency` is the panel's most common currency.",
          responses: {
            "200": {
              description:
                "Panel totals with sample-freshness metadata. Amounts are rounded to 2 decimal places.",
            },
          },
        },
      },
      "/accounts/{of_user_id}/earnings/verify": {
        get: {
          tags: ["Earnings"],
          summary: "Verify cached earnings against the platform",
          description:
            "Cross-check one account's cached earnings against OnlyFans' own chart for the same window, and report both numbers plus the difference.\n\n`GET /earnings/summary` sums the local transaction cache rather than asking the platform, because the live path cannot converge at panel scale. The cost of that choice is a trust question, and this is the answer to it: same period, both sources, side by side.\n\n**Per-account on purpose.** It makes real upstream calls and sits on the sensitive rate-limit tier so it can never become something a dashboard fans out over hundreds of accounts.\n\nIf the platform is unreachable, `live_available` is `false` and `live_total`/`difference` are `null` — that is \"could not check\", not \"matches\".",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "period",
              in: "query",
              schema: {
                type: "string",
                enum: ["today", "week", "month"],
                default: "week",
              },
              description:
                "Window to compare. Ignored when `startDate` and `endDate` are both supplied.",
            },
            {
              name: "startDate",
              in: "query",
              schema: { type: "string", format: "date" },
              description: "Custom range start. Requires `endDate`.",
            },
            {
              name: "endDate",
              in: "query",
              schema: { type: "string", format: "date" },
              description: "Custom range end. Requires `startDate`.",
            },
          ],
          responses: {
            "200": {
              description:
                "Both totals and their difference. `matches` is the verdict for this window.",
            },
            "400": {
              description:
                "`period` not one of `today`/`week`/`month`, or an unparseable `startDate`/`endDate`.",
            },
            "404": { description: "Account not found in this panel." },
          },
        },
      },

      // ── Account tags ──
      "/accounts/{of_user_id}/tags": {
        post: {
          tags: ["Accounts"],
          summary: "Tag a connected account",
          description:
            "Add a tag to a connected account, for grouping creators inside the panel. Tags are panel-local — they are never sent to the platform. Max 40 characters; re-adding an existing tag is a no-op.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["tag"],
                  properties: {
                    tag: { type: "string", maxLength: 40, example: "vip" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "The stored tag. Send this exact string back when deleting it.",
            },
            "400": { description: "Missing tag, or longer than 40 characters." },
            "403": { description: "Account does not belong to this panel." },
          },
        },
      },
      "/accounts/{of_user_id}/tags/{tag}": {
        delete: {
          tags: ["Accounts"],
          summary: "Remove an account tag",
          description:
            "Remove a tag from a connected account. Pass the tag exactly as the API returned it — the stored form is escaped once on the way in, so re-escaping it here would look for a different string and silently delete nothing. `success: false` means there was no such tag.",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            {
              name: "tag",
              in: "path",
              required: true,
              schema: { type: "string", maxLength: 40 },
              description: "The tag, exactly as returned by the API.",
            },
          ],
          responses: {
            "200": {
              description:
                "`success` reports whether a tag was actually removed.",
            },
            "400": { description: "Missing tag, or longer than 40 characters." },
            "403": { description: "Account does not belong to this panel." },
          },
        },
      },

      // ── Fansly session read-out ──
      "/accounts/{of_user_id}/fansly-credentials": {
        get: {
          tags: ["Accounts"],
          summary: "Read a Fansly account's stored session",
          description:
            "Return the **current** Fansly session for one account you own, so an external worker can pick up refreshed tokens instead of holding a stale copy. We stay the credential authority: we are the thing that re-logs in and rewrites these tokens, so a caller that re-reads here each run is always current.\n\nRead-only — it mutates nothing, and is gated by the same API key and ownership checks as every other account route. **Fansly only**; an OnlyFans account returns `400`.",
          parameters: [{ $ref: "#/components/parameters/ofUserId" }],
          responses: {
            "200": {
              description:
                "Current session material: `auth_token`, `session_id`, `client_id`, and the account's `proxy`.",
            },
            "400": { description: "Not a Fansly account." },
            "403": { description: "Account does not belong to this panel." },
            "404": {
              description:
                "Account not found, or no Fansly session is stored yet — connect it first.",
            },
          },
        },
      },

      // ── Refresh job escape hatch ──
      "/accounts/{of_user_id}/refresh/{kind}/clear": {
        post: {
          tags: ["Cache & Sync"],
          summary: "Clear a stuck refresh job",
          description:
            "Force a wedged refresh job to a terminal state so a new one can start.\n\nThe refresh routes already supersede a stale job automatically, but that is a timer — you have to wait it out, and it cannot help at all with a job that keeps re-stamping its progress while making none. This is the escape hatch for that case.\n\nMakes no platform calls, so it costs no quota. Always returns `200`; `cleared` says whether there was in fact something to clear, and `state` is the job's final state (or `null`).",
          parameters: [
            { $ref: "#/components/parameters/ofUserId" },
            { $ref: "#/components/parameters/refreshKind" },
          ],
          responses: {
            "200": {
              description:
                "`cleared: true` when a job was terminated, `false` when none was running.",
            },
            "400": {
              description: "`kind` is not one of `subs`, `tx`, `campaigns`.",
            },
            "403": { description: "Account does not belong to this panel." },
          },
        },
      },

      // ── Panel request metrics ──
      "/metrics/requests": {
        get: {
          tags: ["Panel & Usage"],
          summary: "Get request metrics for your panel",
          description:
            "Request outcomes for your own panel over a time window: volume, status classes, error rate, latency, and the slowest and most error-prone routes. This is what the dashboard Overview charts.\n\nThe current partial bucket is included, so the numbers are current rather than up to a minute stale. `top_tenants` is always empty here — it exists only so one component can render this and the platform-wide admin view interchangeably.",
          parameters: [
            {
              name: "hours",
              in: "query",
              schema: { type: "integer", default: 24, minimum: 1, maximum: 2160 },
              description: "Window to report, in hours (1–2160, i.e. up to 90 days).",
            },
            {
              name: "granularity",
              in: "query",
              schema: { type: "string", enum: ["5m", "15m", "1h", "6h", "1d"] },
              description:
                "Bucket size for `series`. Defaults to a sensible size for `hours`. Also accepted as `bucket`.",
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10, minimum: 1, maximum: 50 },
              description: "How many rows in each top-N breakdown (1–50).",
            },
          ],
          responses: {
            "200": {
              description:
                "`metrics` carries `range`, `totals`, `series`, `status_codes`, `top_routes`, `slowest_routes`, `top_error_routes`, `top_tenants` (empty) and `collector`.",
            },
            "400": {
              description:
                "`hours` or `limit` out of range, or an unknown `granularity`.",
            },
          },
        },
      },
    },
  };

  // The spec is shared with the hosted tree, whose long-form descriptions
  // retain a handful of billing-era phrases for backwards compatibility.
  // Rewrite presentation-only copy here so the self-hosted reference never
  // advertises plans, paid slots, or a hosted MCP service. Schema field names
  // and legacy enum values are intentionally left untouched because clients
  // may still deserialize them.
  const rewriteOpenSourceCopy = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value
        .replaceAll("The Only API", "Open Source OnlyFans + Fansly API")
        .replaceAll("Hosted MCP server", "MCP service")
        .replaceAll("hosted MCP server", "MCP service")
        .replaceAll('one "slot" per account', "one local record per account")
        .replaceAll("freeing its slot", "and removes its local session")
        .replaceAll("and its slot released", "and its local session removed")
        .replaceAll("This is the only way to release a paid slot.", "")
        .replaceAll("Consumes one account slot.", "Stores one local account session.")
        .replaceAll("no slot is consumed", "no account session is stored")
        .replaceAll("plan/usage counters", "local usage counters")
        .replaceAll("proxies, and slots", "proxies, and local sessions")
        .replaceAll(
          "Per-minute HTTP rate limits apply on every plan as anti-flood protection, independently of the monthly call quota:",
          "Per-minute HTTP rate limits provide local anti-flood protection:",
        );
    }

    if (Array.isArray(value)) return value.map(rewriteOpenSourceCopy);

    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          rewriteOpenSourceCopy(child),
        ]),
      );
    }

    return value;
  };

  return NextResponse.json(rewriteOpenSourceCopy(spec));
}
