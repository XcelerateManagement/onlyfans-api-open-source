# MCP server

An [MCP](https://modelcontextprotocol.io) server that puts your self-hosted
CRM in front of an AI client. Point Claude, ChatGPT, Cursor or any other MCP
client at it and the model can read fans, subscribers, messages, earnings,
transactions, tracking links, automations and webhooks — and, with explicit
confirmation, write.

It is a thin Streamable-HTTP wrapper around the Flask API in [`../api`](../api):
58 `of_*` tools, one tenant per bearer token. It holds no data of its own and
talks to nothing except the API you point it at.

Both platforms are covered by the same tools. Once an account is attached,
`of_list_accounts` and everything downstream addresses it by the same
`of_user_id` whether it is an OnlyFans or a Fansly account. A handful of tools
are single-platform and say so in their own description
(`of_create_payout_request`, `of_login_account`, `of_verify_login_otp` and
`of_proxy_request` are OnlyFans-only; `of_list_campaign_claimers` is
OnlyFans-only on its live path).

Full tool list: [`COVERAGE.md`](COVERAGE.md).

## Run it

Node >= 20, and a running API from this repo.

```bash
cd mcp
cp .env.example .env     # set BACKEND_URL + INTER_SERVICE_TOKEN
npm install
npm run build
npm start                # http://127.0.0.1:8181/mcp
```

`npm run dev` runs the TypeScript directly with hot reload instead.

Two variables actually matter:

| Variable | Default | What it is |
|---|---|---|
| `BACKEND_URL` | `http://localhost:5000` | Your Flask API. `http://api:5000` inside docker compose. |
| `INTER_SERVICE_TOKEN` | *(empty)* | Shared secret, must match the same variable on the API. Lets the API push cache invalidation when you rotate a key, and lets OAuth callers through. |

Everything else — port, bind address, origin allowlist, cache TTLs, OAuth,
per-tool rate limits — is documented in [`.env.example`](.env.example).

Smoke-test it:

```bash
curl -i -X POST http://127.0.0.1:8181/mcp \
  -H "Authorization: Bearer $YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

A `200`, an `Mcp-Session-Id` header and a capabilities payload means you are
done. There is also an unauthenticated `GET /health` on the Node process —
don't expose it publicly.

## Exposing it

The process binds loopback by default and speaks plain HTTP. Put a
TLS-terminating reverse proxy in front of it, keep the `/health` and
`/internal/*` paths private, and set `PUBLIC_URL` to the external URL
(including the `/mcp` path) so OAuth audiences line up. Remote MCP clients
need SSE to pass through untouched: `proxy_buffering off`,
`proxy_read_timeout` in the hours, HTTP/1.1.

If you put it on the internet, also set `ALLOWED_ORIGINS` — the default list
covers the hosted AI clients plus `http://localhost:3000`, and setting the
variable **replaces** that list rather than extending it.

## Getting a token

The bearer token is a CRM API key from your own panel. Mint a **separate** key
for each MCP client from `/dashboard/api-keys` (or `POST /api/crm/{crm_id}/api-keys`)
rather than pasting the primary one — revoking a leaked MCP key then breaks
nothing else. The full key is shown once and never again.

Revoking or rotating a key invalidates this server's cached session within
seconds when `INTER_SERVICE_TOKEN` is configured, and within five minutes
otherwise.

## Connect a client

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "onlyfans-crm": {
      "url": "https://crm.example.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

Restart Claude Desktop. For a local install the URL is
`http://127.0.0.1:8181/mcp`.

### Claude Code

```bash
claude mcp add --transport http onlyfans-crm https://crm.example.com/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

### Cursor

`.cursor/mcp.json` in the project, or the global one in `~/.cursor/`:

```json
{
  "mcpServers": {
    "onlyfans-crm": {
      "url": "https://crm.example.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

### ChatGPT

ChatGPT refuses static bearer tokens, so it needs the OAuth path: your Flask
API acts as the authorization server and this process as the resource server.
Set `OAUTH_ISSUER` / `OAUTH_AUDIENCE` to externally resolvable URLs on both
sides, then in ChatGPT go to **Settings → Apps & Connectors → Add custom** and
paste your `https://crm.example.com/mcp`. Discovery, client registration and
PKCE happen on their own. Full walkthrough: [`OAUTH.md`](OAUTH.md).

Setting `OAUTH_ENABLED=false` turns all of that off and leaves API-key bearers
only, which is the simpler setup if no client needs it.

## Safety model

- **Writes are confirm-gated.** `of_send_message`, `of_create_payout_request`,
  `of_delete_account`, `of_delete_webhook`, `of_delete_automation`,
  `of_set_subscription_price` and any non-GET through the escape hatches all
  take `confirm: true`. Called with `confirm: false` they return a dry-run
  preview and change nothing.
- **`of_proxy_request` is read-only** until you flip `mcp_unsafe_proxy` for the
  panel on `/dashboard/mcp`. Every call through it is audit-logged.
- **Admin paths are unreachable** from the escape hatches — `/api/admin/*` and
  `/internal/*` are refused, including via path-traversal and percent-encoding.
- **Untrusted content is marked.** Fan usernames, message bodies, bios and
  descriptions come back wrapped in `<UNTRUSTED>…</UNTRUSTED>`. The system
  prompt tells the model to treat anything inside as data, never instructions —
  worth knowing if you swap in your own client.
- **Per-tool rate limits** sit on top of the API's own limiter, as a guard
  against an agent loop hammering the upstream platform. Defaults per minute:
  refreshes 30, fan refresh 60, sends 60, PPV stats 10, test webhook 30,
  payouts 10, automation runs 60, escape hatches 120. All tunable with
  `MCP_RL_*` (see `.env.example`).
- **Bearer tokens are never logged** and never echoed in an error body; log
  correlation uses a hash prefix.

Live tools (`of_list_subscribers`, `of_list_chats`, `of_get_earnings_*`,
`of_list_purchases`, `of_list_campaigns`, …) call the platform directly and can
get the account rate-limited upstream. The `_cached` variants read your own
database and cost nothing — prefer them for anything repetitive.

## Licence

AGPL-3.0-or-later, same as the rest of the repository. See [`../LICENSE`](../LICENSE).
