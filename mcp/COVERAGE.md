# MCP Coverage

Tracks which Flask routes the MCP server exposes, which of the user's
representative workflows it can drive, and the full tool inventory.

Updated by hand whenever a tool is added or changed.

## Summary

- **User-facing Flask routes**: 58
- **Exposed via MCP**: 56 (96.6%) — every read tool + every safe write tool
- **Intentionally NOT exposed**: 2 (auth/register, send-chat-stub) + all `/internal/*`, `/api/admin/*`
- **Total MCP tools registered**: 58
- **Read tools**: 38
- **Write tools (require `confirm`)**: 12
- **Escape hatches**: 2 (`of_crm_request`, `of_proxy_request`)
- **User use-case coverage**: 8 / 8 (7 fully covered ✅, 1 partial 🟡 — PPV conversion is best-effort)

## Use-case coverage (the 8 representative workflows)

| # | Use-case | Status | Tools the model uses |
|---|---|---|---|
| 1 | "Pull this week's revenue per creator and chart it." | ✅ | `of_list_accounts` → loop `of_get_earnings_chart(of_user_id, startDate=…)` per account |
| 2 | "List my top 50 spenders with their last message timestamp." | ✅ | `of_list_fans(sort='spend', limit=50)` returns `total_spend` + `last_event_at` |
| 3 | "Find every fan flagged for chargeback in the last 30 days." | ✅ | `of_list_transactions_cached(type='chargeback', since='YYYY-MM-DD')` |
| 4 | "Draft a renewal DM for fans churning in the next 7 days. No auto-send." | ✅ | `of_list_subscribers(type='active')` → filter by `expires_at` client-side; **no send tool called** |
| 5 | "Compare PPV conversion rates across my creators this month." | 🟡 | `of_list_accounts` → loop `of_get_ppv_stats(since=…, max_chats=25)`. Best-effort — `ppv_sent` may under-count if max_chats is small; expensive (walks chats per account). |
| 6 | "Build a daily report for Slack: revenue, top fans, chat backlog." | ✅ | `of_get_earnings_summary(period='week')` + `of_list_fans(sort='spend')` + `of_list_chats(order='unread')` |
| 7 | "Identify whales who haven't messaged in 14 days — draft a re-engagement." | ✅ | `of_list_fans(sort='spend')` → filter by `last_event_at` < now − 14d client-side |
| 8 | "Export all transactions over $200 from last quarter as CSV." | ✅ | `of_list_transactions_cached(since=<Q-start>)` → filter `amount > 200` client-side → model serializes CSV |

## Endpoint coverage

### Auth & onboarding (registration routes intentionally excluded)

| Flask route | MCP tool | Notes |
|---|---|---|
| `POST /api/auth/register` | ✗ not exposed | Dashboard signup only. |
| `POST /api/auth/login` | ✗ not exposed | Dashboard login only. |
| `POST /api/crm/register` | ✗ not exposed | Dashboard signup only. |
| `GET /api/whoami` | (internal) | Used by MCP server itself to resolve bearer → crm_id. |
| `PATCH /api/crm/<crm>/mcp/unsafe-proxy` | ✗ not exposed | Dashboard toggle — not a tool. |

### Accounts (8/8)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts` | `of_list_accounts` |
| `DELETE /api/crm/<crm>/accounts/<of>` | `of_delete_account` |
| `GET /api/crm/<crm>/accounts/<of>/polling` | `of_get_polling` |
| `PATCH /api/crm/<crm>/accounts/<of>/polling` | `of_set_polling` |
| `GET /api/crm/<crm>/accounts/<of>/proxy` | `of_get_proxy` |
| `PATCH /api/crm/<crm>/accounts/<of>/proxy` | `of_set_proxy` |
| `PATCH /api/crm/<crm>/accounts/<of>/subscription-price` | `of_set_subscription_price` |
| `POST /api/crm/<crm>/accounts/login` | `of_login_account` |
| `POST /api/crm/<crm>/accounts/login/cookies` | `of_login_with_cookies` |
| `POST /api/crm/<crm>/accounts/login/verify-otp` | `of_verify_login_otp` |

### Fans (5/5)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/fans` | `of_list_fans` (sort, tag, search, spend fields) |
| `POST /api/crm/<crm>/fans/<fid>/tags` | `of_add_fan_tag` |
| `DELETE /api/crm/<crm>/fans/<fid>/tags/<tag>` | `of_remove_fan_tag` |
| `POST /api/crm/<crm>/accounts/<of>/fans/<fid>/refresh-profile` | `of_refresh_fan_profile` |
| `GET /api/crm/<crm>/accounts/<of>/fans/<fid>/transactions/cached` | `of_list_fan_transactions` |

### Subscribers (4/4)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts/<of>/subscribers` | `of_list_subscribers` |
| `GET /api/crm/<crm>/accounts/<of>/subscribers/cached` | `of_list_subscribers_cached` |
| `POST /api/crm/<crm>/accounts/<of>/subscribers/refresh` | `of_refresh_subscribers` |
| `GET /api/crm/<crm>/accounts/<of>/subscribers/refresh/status` | `of_get_refresh_status(kind='subscribers')` |

### Messaging / inbox (3/4 — write stub on backend)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts/<of>/chats` | `of_list_chats` (trims to last_message + unread_count) |
| `GET /api/crm/<crm>/accounts/<of>/chats/<with>/messages` | `of_list_messages` |
| `POST /api/crm/<crm>/accounts/<of>/chats/<with>/messages` | `of_send_message` |
| | …backend returns 501 (stub). Tool exists with `confirm=true` gate for when the backend lands. |

### Earnings & payouts (6/6)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts/<of>/balances` | `of_get_balances` |
| `GET /api/crm/<crm>/accounts/<of>/earnings` | `of_get_earnings_chart` |
| `GET /api/crm/<crm>/earnings/summary` | `of_get_earnings_summary` |
| `GET /api/crm/<crm>/accounts/<of>/payout-account` | `of_get_payout_account` |
| `GET /api/crm/<crm>/accounts/<of>/payout-requests` | `of_list_payout_requests` |
| `POST /api/crm/<crm>/accounts/<of>/payout-requests` | `of_create_payout_request` |

### Campaigns / tracking links (6/6)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts/<of>/campaigns` | `of_list_campaigns` |
| `POST /api/crm/<crm>/accounts/<of>/campaigns` | `of_create_campaign` |
| `GET /api/crm/<crm>/accounts/<of>/campaigns/<cid>/claimers` | `of_list_campaign_claimers(cached=false)` |
| `GET /api/crm/<crm>/accounts/<of>/campaigns/<cid>/claimers/cached` | `of_list_campaign_claimers(cached=true)` |
| `POST /api/crm/<crm>/accounts/<of>/campaigns/refresh` | `of_refresh_campaigns` |
| `GET /api/crm/<crm>/accounts/<of>/campaigns/earnings` | `of_get_campaign_earnings` |

### Transactions / purchases / refreshes (6/6)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts/<of>/purchases` | `of_list_purchases` (since, marker) |
| `GET /api/crm/<crm>/accounts/<of>/transactions/cached` | `of_list_transactions_cached` (type, since, fan_of_user_id) |
| `POST /api/crm/<crm>/accounts/<of>/transactions/refresh` | `of_refresh_transactions` |
| `GET /api/crm/<crm>/accounts/<of>/transactions/refresh/status` | `of_get_refresh_status(kind='transactions')` |
| `GET /api/crm/<crm>/refresh/active` | `of_list_active_refreshes` |
| `GET /api/crm/<crm>/accounts/<of>/campaigns/refresh/status` | `of_get_refresh_status(kind='campaigns')` |

### Webhooks (7/7)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/webhooks` | `of_list_webhooks` (secrets masked) |
| `POST /api/crm/<crm>/webhooks` | `of_create_webhook` |
| `GET /api/crm/<crm>/webhooks/<wid>` | `of_get_webhook` |
| `PATCH /api/crm/<crm>/webhooks/<wid>` | `of_update_webhook` |
| `DELETE /api/crm/<crm>/webhooks/<wid>` | `of_delete_webhook` |
| `POST /api/crm/<crm>/webhooks/<wid>/test` | `of_test_webhook` |
| `GET /api/crm/<crm>/webhooks/<wid>/deliveries` | `of_list_webhook_deliveries` |

### Automations (7/7)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/automations` | `of_list_automations` |
| `POST /api/crm/<crm>/automations` | `of_create_automation` |
| `GET /api/crm/<crm>/automations/<aid>` | `of_get_automation` |
| `PATCH /api/crm/<crm>/automations/<aid>` | `of_update_automation` |
| `DELETE /api/crm/<crm>/automations/<aid>` | `of_delete_automation` |
| `POST /api/crm/<crm>/automations/<aid>/run-now` | `of_run_automation_now` |
| `GET /api/crm/<crm>/automations/<aid>/runs` | `of_list_automation_runs` |

### Events (1/1, SSE not exposed)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/events` | `of_list_events` (cursor-paginated via `since`) |
| `GET /api/crm/<crm>/events/stream` | ✗ not exposed | SSE bridging deferred; model uses `of_list_events(since=…)` polling instead. |

### Notifications, integrations, PPV (3/3)

| Flask route | MCP tool |
|---|---|
| `GET /api/crm/<crm>/accounts/<of>/notifications` | `of_list_notifications` |
| `POST /api/crm/<crm>/integrations/telegram/groups` | `of_list_telegram_groups` |
| `GET /api/crm/<crm>/accounts/<of>/ppv-stats` | `of_get_ppv_stats` |

### Escape hatches

| MCP tool | Purpose |
|---|---|
| `of_crm_request(method, path, body?)` | Generic CRM call. Admin/internal paths denied. Non-GET requires `confirm=true`. |
| `of_proxy_request(of_user_id, method, of_path, body?, confirm?)` | Generic OnlyFans `/api2/v2/...` call. Non-GET requires both `mcp_unsafe_proxy=1` AND `confirm=true`. |

## Tool inventory (read / write classification)

### Read tools (37)

`of_whoami`,
`of_list_accounts`, `of_get_polling`, `of_get_proxy`,
`of_list_fans`, `of_list_fan_transactions`,
`of_list_subscribers`, `of_list_subscribers_cached`,
`of_list_chats`, `of_list_messages`,
`of_get_balances`, `of_get_earnings_chart`, `of_get_earnings_summary`,
`of_get_payout_account`, `of_list_payout_requests`,
`of_list_campaigns`, `of_list_campaign_claimers`, `of_get_campaign_earnings`,
`of_list_purchases`, `of_list_transactions_cached`, `of_get_refresh_status`, `of_list_active_refreshes`,
`of_list_events`, `of_list_notifications`,
`of_list_webhooks`, `of_get_webhook`, `of_list_webhook_deliveries`,
`of_list_automations`, `of_get_automation`, `of_list_automation_runs`,
`of_get_ppv_stats`, `of_crm_request` (GET only without confirm), `of_proxy_request` (GET only without unsafe flag).

### Write tools

Only the destructive and money-moving tools gate on `confirm=true`. Without it they
return a dry-run preview instead of acting.

**Confirm-gated (6):**

`of_send_message`, `of_create_payout_request`, `of_set_subscription_price`,
`of_delete_account`, `of_delete_webhook`, `of_delete_automation`.

Plus the two escape hatches, which gate every non-GET method:
`of_crm_request` (needs `confirm=true`) and `of_proxy_request` (needs
`confirm=true` **and** the per-CRM `mcp_unsafe_proxy` flag).

**Ungated writes — these apply immediately on the first call:**

`of_login_account`, `of_login_with_cookies`, `of_verify_login_otp`,
`of_set_polling`, `of_set_proxy`,
`of_add_fan_tag`, `of_remove_fan_tag`, `of_refresh_fan_profile`,
`of_create_campaign`, `of_refresh_campaigns`, `of_refresh_subscribers`,
`of_refresh_transactions`,
`of_create_webhook`, `of_update_webhook`, `of_test_webhook`,
`of_create_automation`, `of_update_automation`, `of_run_automation_now`,
`of_list_telegram_groups` (POST under the hood).

> This list previously read "require `confirm=true` (12)" and then enumerated 25
> tools — neither number was right, and it implied a confirmation step on 19 tools
> that have none. If you widen the gate, add the tool to the confirm-gated list
> here and keep the two lists disjoint.

### Per-tool MCP-side rate limits

| Tool | Capacity / refill |
|---|---|
| `of_refresh_subscribers` / `of_refresh_transactions` / `of_refresh_campaigns` | 5 / min |
| `of_refresh_fan_profile` | 10 / min |
| `of_send_message` | 20 / min |
| `of_test_webhook` | 10 / min |
| `of_create_payout_request` | 3 / min |
| `of_run_automation_now` | 20 / min |
| `of_get_ppv_stats` | 3 / min |
| `of_crm_request` / `of_proxy_request` | 30 / min |

Other tools rely on the Flask per-API-key limiter only (default 100/min).

## Known gaps / follow-ups

- **PPV `ppv_sent` is a sampled metric** (best-effort over `max_chats` recent chats). For accounts with thousands of fans, conversion rate is a **lower bound**. To make it exact, the backend would need an aggregated "PPV messages sent in period" query — either a periodic poller that ingests message-send events into a new cache table, or a heavier walk-everything-with-resume endpoint.
- **`of_list_messages` lacks `since`** — pagination by offset only. Adding a `since` filter requires a backend change (OF's endpoint doesn't offer it either, so we'd filter client-side at Flask).
- **Top spenders across all creators** — `of_list_fans(sort='spend')` is fan-row-level (a fan that appears under multiple OF accounts is multiple rows). For dedupe-by-fan-id ranking the model has to merge client-side.
- **SSE streaming** — `of_list_events(since=…)` polling pattern works today; native streaming via the MCP transport is deferred to v1.1.
- **`crm_request` body-amount filter on transactions** — backend has no `min_amount` / `max_amount` filter on `/transactions/cached`. The model fetches and filters client-side.

## How to refresh this file

When you add or change a tool:

1. Update the matching row in the endpoint table (or add a new one).
2. Update the read/write classification list.
3. Re-check the 8 use-cases — does the change move any from 🟡 to ✅?
4. Keep the tool total at the top in sync.
