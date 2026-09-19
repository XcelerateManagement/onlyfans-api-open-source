# OAuth 2.1 for the MCP server

This document describes how OAuth 2.1 + PKCE + Dynamic Client Registration
(DCR) is wired into the MCP server so that **OpenAI ChatGPT**,
**Claude.ai**, and any other MCP client following the
[MCP authorization spec (2025-06-18)][mcp-spec] can connect without a
pre-shared API key.

If you only need legacy bearer (API key) auth, you can ignore this — the
MCP server still accepts a CRM API key in the `Authorization: Bearer`
header. Both schemes are live side-by-side; the JWT path takes priority
when the bearer looks like a JWT.

---

## Why OAuth 2.1 at all

OpenAI's Apps SDK is strict about how custom MCP servers authenticate:

> The auth requirements are strict: OAuth 2.1 and Dynamic Client
> Registration are both mandatory, and bearer tokens [from static keys]
> are not accepted. For an authenticated MCP server, you are expected to
> implement an OAuth 2.1 flow that conforms to the MCP authorization
> spec, with your MCP server as the resource server, your identity
> provider as the authorization server, and ChatGPT acting on behalf of
> the user as the client.
>
> — [OpenAI Apps SDK · Authentication][openai-auth]

To put the same MCP server in front of ChatGPT, Claude.ai, and Cursor
without a vendor-specific shim, we implement the spec as written:
**OAuth 2.1 + PKCE (S256) + DCR**, with audience-bound JWT access
tokens.

---

## Architecture

```
┌─────────────────┐   1. import server URL    ┌──────────────────────┐
│  ChatGPT /      │ ────────────────────────► │  MCP Server          │
│  Claude.ai      │                            │  (Resource Server)   │
│  Cursor / …     │                            │  Node + Express      │
│                 │ ◄─ 401 + WWW-Authenticate ─│  - /mcp              │
│                 │                            │  - /.well-known/     │
│                 │                            │      oauth-protected-│
│                 │                            │      resource        │
│                 │                            └──────────────────────┘
│                 │ ─── 2. follow resource_metadata link ───┐
│                 │                                          │
│                 │ ◄── 3. .well-known/oauth-authorization-server ──┐
│                 │                                                  │
│                 │ ─── 4. POST /oauth/register (DCR) ──────────────►│
│                 │ ◄── 5. {client_id, client_secret?} ──────────────│
│                 │                                                  │
│                 │ ─── 6. GET /oauth/authorize ────────────────────►│
│                 │       (response_type=code, PKCE, resource=…)     │
│                 │ ◄── 7. 302 → /oauth/consent (Next.js dashboard) ─┤
│  User           │                                                  │
│  consents ──────┤ ─── 8. POST /oauth/authorize/grant ──────────────│
│                 │       (server-side, X-API-Key on user's session) │
│                 │ ◄── 9. {redirect: …?code=…&state=…} ─────────────│
│                 │                                                  │
│                 │ ─── 10. POST /oauth/token ──────────────────────►│
│                 │        (code + PKCE verifier + redirect_uri)     │
│                 │ ◄── 11. {access_token: JWT, …}                   │
│                 │                                                  │
│                 │   12. /mcp with Authorization: Bearer <JWT> ─────│
│                 │                                                  │
│                 │            ┌─────────────────────────────────────│
│                 │            │  Flask                              │
│                 │            │  (Authorization Server)             │
│                 │            │  - /.well-known/oauth-authorization-│
│                 │            │      server                         │
│                 │            │  - /.well-known/jwks.json           │
│                 │            │  - /oauth/{register,authorize,token}│
│                 │            │  - /oauth/authorize/grant           │
│                 │            └─────────────────────────────────────│
```

**Three components:**

1. **Authorization Server (AS)** — `api/` Flask app. Owns user
   identity, mints JWT access tokens. Exposes the discovery doc + JWKS
   + DCR + authorize + token endpoints.
2. **Resource Server (RS)** — `mcp/` Node/Express app. Verifies
   incoming JWTs against the AS's JWKS, then calls Flask using an
   inter-service impersonation header for the JWT's `sub`.
3. **Consent UI** — `web/app/oauth/consent/page.tsx`.
   A Next.js server component that authenticates the user via NextAuth,
   shows them the requested scopes, and posts back to the AS via a
   server action.

The AS, RS, and Consent UI are three separate processes that talk over
HTTP. They share two secrets:
- `INTER_SERVICE_TOKEN` — used for AS↔Next.js (flow sealing) and RS→AS
  (impersonation).
- `OAUTH_KEYS_DIR/active.pem` — read by the AS to sign tokens, only;
  the RS fetches the public half via JWKS.

---

## Endpoint reference

### Authorization Server (Flask, `api/`)

| Method | Path | Spec | Purpose |
|---|---|---|---|
| `GET` | `/.well-known/oauth-authorization-server` | [RFC 8414][rfc-8414] | AS metadata for client discovery |
| `GET` | `/.well-known/jwks.json` | [RFC 7517][rfc-7517] | Public signing key (RS256) for RS verification |
| `POST` | `/oauth/register` | [RFC 7591][rfc-7591] | Dynamic Client Registration — open, no auth |
| `GET` | `/oauth/authorize` | [RFC 6749 §4.1][rfc-6749-41] | Code-flow start — 302s to the consent UI |
| `POST` | `/oauth/authorize/grant` | (custom) | Server-to-server callback from the consent UI |
| `POST` | `/oauth/token` | [RFC 6749 §3.2][rfc-6749-32] | Code exchange. Validates PKCE, mints JWT |

### Resource Server (Node, `mcp/`)

| Method | Path | Spec | Purpose |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | [RFC 9728][rfc-9728] | Points at the AS, declares scopes |
| `POST/GET/DELETE` | `/mcp` | MCP HTTP | The MCP transport. Auth via `Authorization: Bearer <JWT or API key>` |

### JWT shape (`token_type: "access_token"`, RFC 9068)

```json
{
  "iss": "https://crm.example.com",
  "sub": "crm_1f099dc2875b1dab",
  "aud": "https://crm.example.com/mcp",
  "scope": "of:read of:write",
  "client_id": "client_YgjVb8CBjPGLmFf95IF_JGhHlBEhPckc",
  "iat": 1778853162,
  "nbf": 1778853162,
  "exp": 1778856762,
  "jti": "7Z3wZVK8Jj_H0ZRfyWRakA",
  "token_type": "access_token"
}
```

Header: `{ "alg": "RS256", "kid": "<sha256-prefix>", "typ": "at+jwt" }`.

---

## End-to-end flow (the exact dance)

Step numbers match the diagram above.

1. **User pastes the MCP server URL into ChatGPT** → ChatGPT issues
   an MCP `initialize` request to `/mcp` with no auth.
2. **MCP server returns `401`** with:
   ```
   WWW-Authenticate: Bearer realm="https://crm.example.com/mcp",
       resource_metadata="https://crm.example.com/mcp/.well-known/oauth-protected-resource",
       error="invalid_request"
   ```
3. **ChatGPT fetches the protected-resource metadata**, sees the
   `authorization_servers` list, and fetches
   `/.well-known/oauth-authorization-server` from the AS.
4. **ChatGPT performs DCR** — `POST /oauth/register` with its
   `redirect_uri` (something like
   `https://chat.openai.com/connector/<id>/oauth/callback`). The AS
   mints a `client_id` and (since we accept public clients) no
   secret. Public-client + PKCE is exactly OpenAI's recommended
   posture.
5. **ChatGPT generates PKCE pair** — code verifier (43–128 chars) and
   S256 challenge.
6. **ChatGPT opens a browser to `/oauth/authorize`** with
   `response_type=code`, `client_id`, `redirect_uri`,
   `scope=of:read`, `state=…`, `code_challenge=…`,
   `code_challenge_method=S256`, **and `resource=https://crm.example.com/mcp`**.

   The AS validates each param. Crucially, it requires `resource` —
   without it, audience confusion would be possible. With it, the
   minted JWT's `aud` is bound to the MCP server's canonical URL.
7. **AS 302s to the Next.js consent UI** carrying the validated params
   as an HMAC-signed `flow` blob (300s TTL). This means the consent
   page doesn't need to re-validate, and the AS doesn't need a
   stateful pending-authorization table.
8. **Consent UI authenticates the user via NextAuth.** If signed in,
   it renders Approve/Deny with the requested scopes spelled out.
   On Approve, a server action `POST`s to
   `/oauth/authorize/grant` with the user's `X-API-Key` (read from
   the session JWT, never sent to the browser).
9. **AS verifies the flow, mints a single-use authorization code**
   (60s TTL), persists it bound to user/client/PKCE/resource, returns
   `{redirect: "<client redirect_uri>?code=…&state=…"}`. The consent
   page redirects the browser there.
10. **ChatGPT receives the code at its callback URL.** It calls
    `POST /oauth/token` with `grant_type=authorization_code`, the
    `code`, the original `redirect_uri`, and the `code_verifier`.
11. **AS atomically consumes the code, verifies PKCE
    (`base64url(sha256(verifier)) == challenge`), and mints a JWT**
    bound to the original `resource`. Returns
    `{access_token, token_type: "Bearer", expires_in: 3600, scope}`.
12. **ChatGPT retries `/mcp` with `Authorization: Bearer <JWT>`.** The
    MCP server detects the JWT shape (three dot-separated base64
    segments), verifies signature against the cached JWKS, checks
    `iss`/`aud`/`exp`/`scope`, opens an MCP session bound to
    `sub` (the `crm_id`), and serves tools.

When the token expires after 1h, ChatGPT silently re-runs steps 6–11
(re-authorize). The user only sees the consent screen once per
client per scope set — `oauth_consents` remembers prior grants.

---

## Setting up ChatGPT to connect

Once your AS is up, here's what users do.

1. Go to **ChatGPT → Settings → Apps & Connectors** (or
   `Settings → Developer mode → Apps` if on Plus and you want full
   read/write). Click **Add custom**.
2. Paste your MCP server URL (e.g. `https://crm.example.com/mcp`).
3. ChatGPT performs steps 1–4 from above on its own. After a few
   seconds it shows **"Sign in with the The Only API"** in a popup.
4. The popup opens our consent UI. If the user is logged into the
   dashboard, they see the Approve/Deny screen immediately. If not,
   they hit the standard `/login` and bounce back here.
5. After Approve, ChatGPT marks the connector ready. Tools (`of_*`)
   show up in the tools menu.

Per OpenAI's docs, ChatGPT only surfaces the OAuth UI when:
- The tool declares `securitySchemes: [{ type: "oauth2", scopes: […] }]`, **and**
- The tool's error response carries `_meta["mcp/www_authenticate"]`.

To take advantage of that (i.e., make ChatGPT prompt for *additional*
scopes when a write tool is called), add this to your tool definitions:

```typescript
server.registerTool(
  "of_send_message",
  {
    title: "Send a DM",
    description: "Send a direct message to a fan",
    inputSchema: { of_user_id: z.string(), fan_id: z.string(), text: z.string() },
    outputSchema: { /* … */ },
    securitySchemes: [{ type: "oauth2", scopes: ["of:write"] }],
  },
  async ({ of_user_id, fan_id, text }, { extra }) => {
    if (!extra.session.scopes.includes("of:write")) {
      return {
        content: [{ type: "text", text: "Write scope required." }],
        _meta: {
          "mcp/www_authenticate": [
            `Bearer resource_metadata="https://crm.example.com/mcp/.well-known/oauth-protected-resource", scope="of:write", error="insufficient_scope"`,
          ],
        },
        isError: true,
      };
    }
    // … perform send …
  },
);
```

---

## Security model

| Concern | Mitigation |
|---|---|
| Phishing the consent screen | The consent UI is served by your own panel, on the same origin users already sign in to. The browser address bar is the check. |
| Authorization-code interception | PKCE S256 mandatory. The code without the original verifier is useless. |
| Audience confusion (token meant for service A used at service B) | The `resource` param is **required** at `/oauth/authorize`. It binds the token's `aud` claim. The RS rejects any token whose `aud` doesn't match its configured URL. |
| Token replay | JWTs include `jti` and `exp` (1h). Codes are single-use; `consume_code` runs `BEGIN IMMEDIATE → SELECT → UPDATE → COMMIT` so two concurrent token requests can't both win. |
| Token leakage in logs | The Pino redactor in `mcp/src/logging.ts` hashes any bearer to a 12-char sha256 prefix before logging. Flask never logs the `Authorization` header. |
| Stolen API key escalating into JWT | The consent step requires the user's session API key. An attacker with only a leaked CRM API key can complete consent but only for their own account — they can't sign in as someone else. Rotate the key from `/dashboard/api-keys` if it leaks. |
| MCP server compromised → mints fake JWTs | Impossible. The RS only holds the **public** half of the keypair (via JWKS). Only the AS has the signing key. |
| AS compromised | All bets off — the AS is the trust root. Treat the keypair as a deployment secret. Rotate by adding a new keypair under `OAUTH_KEYS_DIR/` and restarting; the old `kid` stays in JWKS until you remove the old PEM. |
| Stuck open clients post-DCR | DCR is open (no auth) which is correct per RFC 7591 §1.2 for public-client OAuth. The AS rate-limits the endpoint at 1/min in production. Stale clients with no token activity in 90d are GC'd. |

---

## Configuration

### Flask (Authorization Server)

| Env var | Default | Notes |
|---|---|---|
| `OAUTH_ISSUER` | `http://localhost:5000` | Public URL of the Flask app. **Must** match the `iss` claim. |
| `OAUTH_KEYS_DIR` | `oauth_keys` | Directory holding `active.pem`. Mode 0600. Persist this across deploys. |
| `OAUTH_ACCESS_TTL_SEC` | `3600` | Access token lifetime. Don't raise above 24h. |
| `OAUTH_CONSENT_UI_URL` | `http://localhost:3000/oauth/consent` | The Next.js consent page. |
| `DASHBOARD_ORIGINS` | `http://localhost:3000` | CORS allowlist for the consent UI's POST. Add your panel origin. |
| `INTER_SERVICE_TOKEN` | (required) | HMAC key for the flow envelope **and** for RS impersonation. ≥32 chars. |

### MCP Server (Resource Server)

| Env var | Default | Notes |
|---|---|---|
| `OAUTH_ENABLED` | `true` | Set `false` to disable the JWT path (legacy bearer only). |
| `OAUTH_ISSUER` | `http://localhost:5000` | Must match the AS's issuer. |
| `OAUTH_JWKS_URI` | `<issuer>/.well-known/jwks.json` | Override only for custom routing. |
| `OAUTH_AUDIENCE` | `<PUBLIC_URL>` | Canonical MCP URL. Tokens with `aud != this` are rejected. |
| `OAUTH_REQUIRED_SCOPES` | `of:read` | Comma-separated. Tokens missing any are rejected. |
| `INTER_SERVICE_TOKEN` | (required) | Used as `X-Service-Token` on Flask calls. |

### Next.js (Consent UI)

The consent page reuses the NextAuth setup (no new env vars). It reads
`BACKEND_URL` (already set for the dashboard) to find the AS.

---

## Implementation notes

### Why the consent UI is a separate component

The AS is Flask, but the dashboard's user session is in Next.js
(NextAuth). Rather than reimplementing NextAuth session reading in
Python, we 302 from `/oauth/authorize` to the Next.js page, let it
authenticate the user, then have it call back to Flask
`/oauth/authorize/grant` with the user's session API key as
`X-API-Key`. This is a clean separation: Flask validates the OAuth
shape; Next.js owns the human-facing UI; the API key is the bridge.

The handoff envelope is HMAC-signed (with `INTER_SERVICE_TOKEN`) so
the consent page can't be tricked into approving something the AS
didn't validate, and the AS doesn't need to maintain a
pending-authorization table.

### Why we use inter-service impersonation for RS→Flask

The Flask API routes are wired to `X-API-Key`. The MCP server only
holds a JWT, not the API key. Two ways to bridge:

- **Make Flask accept JWTs.** Cleaner long-term, but every route's
  `verify_api_key()` would need to grow JWT support. Lots of surface.
- **Inter-service impersonation.** The RS sends `X-Service-Token` +
  `X-Acting-Crm-Id`. Flask trusts the service token, scopes the
  request to the impersonated `crm_id`. Tiny change to one function.

We picked the latter. The service token is already shared between
processes for other internal endpoints (`/internal/cache/invalidate`,
etc.), so we're not introducing a new credential.

### Audience binding

The MCP spec requires that tokens be bound to a specific resource so
they can't be replayed at a different MCP server. We enforce this on
both sides:

- AS: rejects `/oauth/authorize` without a `resource` param.
- AS: writes the `resource` into the JWT's `aud`.
- AS: at `/oauth/token`, if the client sends `resource`, requires it
  match the one bound to the code.
- RS: rejects any JWT whose `aud != config.oauthAudience`.

### Public clients only (for now)

We accept `token_endpoint_auth_method=none` (public client) and
`client_secret_basic` (confidential client). We don't yet support
`private_key_jwt` (CIMD-style). OpenAI prefers CIMD because it
eliminates per-instance registrations, but DCR is sufficient for now
and is what every MCP client supports. CIMD is straightforward to
add: parse the CIMD URL on first use, fetch the metadata, verify
client assertions against the published JWKS.

### Key rotation

`OAUTH_KEYS_DIR/active.pem` is the single active key. To rotate:

1. Generate a new keypair: `openssl genrsa -out new.pem 2048`.
2. Drop it into `OAUTH_KEYS_DIR/` (any filename other than
   `active.pem`).
3. Update `oauth_keys.py` to publish *both* keys in JWKS (one-line
   change — extend `jwks_document()` to enumerate `*.pem`).
4. Atomically swap `active.pem` to point at the new key.
5. After 1h (max token lifetime), remove the old PEM. JWTs signed
   under the old `kid` will stop verifying.

Tokens carry the signing `kid` in their header, so verification picks
the right key from JWKS automatically.

### Refresh tokens

Not yet implemented. Access tokens are 1h, and ChatGPT silently
re-runs the auth-code flow when one expires. If we want longer
sessions, add an `oauth_refresh_tokens` table and grow `/oauth/token`
to handle `grant_type=refresh_token`. The MCP authorization spec
allows this but doesn't require it.

---

## Verifying the setup

After a fresh deploy, walk through:

```bash
# 1. AS metadata is reachable.
curl https://crm.example.com/.well-known/oauth-authorization-server | jq .

# 2. JWKS publishes at least one key.
curl https://crm.example.com/.well-known/jwks.json | jq '.keys | length'

# 3. RS metadata advertises the AS.
curl https://crm.example.com/mcp/.well-known/oauth-protected-resource | jq .

# 4. Hitting /mcp without auth returns 401 + WWW-Authenticate.
curl -i https://crm.example.com/mcp \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

```

There is no scripted end-to-end test for the full dance — walk it by hand
with the curls above plus your client of choice.

---

## References

- [MCP Authorization Specification (2025-06-18)][mcp-spec]
- [OpenAI Apps SDK · Authentication][openai-auth]
- [OpenAI · Building MCP servers for ChatGPT][openai-mcp]
- [RFC 6749 — OAuth 2.0 Authorization Framework][rfc-6749]
- [RFC 7517 — JSON Web Key (JWK)][rfc-7517]
- [RFC 7591 — Dynamic Client Registration][rfc-7591]
- [RFC 7636 — PKCE][rfc-7636]
- [RFC 8414 — Authorization Server Metadata][rfc-8414]
- [RFC 8707 — Resource Indicators][rfc-8707]
- [RFC 9068 — JWT Profile for Access Tokens][rfc-9068]
- [RFC 9728 — Protected Resource Metadata][rfc-9728]

[mcp-spec]: https://modelcontextprotocol.io/specification/draft/basic/authorization
[openai-auth]: https://developers.openai.com/apps-sdk/build/auth
[openai-mcp]: https://developers.openai.com/api/docs/mcp
[rfc-6749]: https://datatracker.ietf.org/doc/html/rfc6749
[rfc-6749-32]: https://datatracker.ietf.org/doc/html/rfc6749#section-3.2
[rfc-6749-41]: https://datatracker.ietf.org/doc/html/rfc6749#section-4.1
[rfc-7517]: https://datatracker.ietf.org/doc/html/rfc7517
[rfc-7591]: https://datatracker.ietf.org/doc/html/rfc7591
[rfc-7636]: https://datatracker.ietf.org/doc/html/rfc7636
[rfc-8414]: https://datatracker.ietf.org/doc/html/rfc8414
[rfc-8707]: https://datatracker.ietf.org/doc/html/rfc8707
[rfc-9068]: https://datatracker.ietf.org/doc/html/rfc9068
[rfc-9728]: https://datatracker.ietf.org/doc/html/rfc9728
