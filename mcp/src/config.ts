import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csv(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  // Your Flask API. Same machine by default; inside docker compose this is
  // usually http://api:5000.
  backendUrl: (process.env.BACKEND_URL ?? "http://localhost:5000").replace(/\/$/, ""),
  // The URL MCP clients actually connect to. Must be the externally
  // reachable one when you put this behind a reverse proxy.
  publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8181/mcp",
  port: num("PORT", 8181),
  host: process.env.HOST ?? "127.0.0.1",
  // Browser-based MCP clients send an Origin header; anything not listed
  // here is refused. Add your own panel origin via ALLOWED_ORIGINS.
  allowedOrigins: new Set(
    csv("ALLOWED_ORIGINS", [
      "https://claude.ai",
      "https://desktop.claude.com",
      "https://app.cursor.com",
      "https://chat.openai.com",
      "https://chatgpt.com",
      "http://localhost:3000",
    ]),
  ),
  serviceToken: process.env.INTER_SERVICE_TOKEN ?? "",
  logLevel: process.env.LOG_LEVEL ?? "info",
  whoamiTtlMs: num("WHOAMI_CACHE_TTL_SEC", 300) * 1000,
  whoamiNegTtlMs: num("WHOAMI_NEG_CACHE_TTL_SEC", 30) * 1000,
  // Advertised on /.well-known/oauth-protected-resource so a client that
  // hits a 401 knows where to read about this deployment.
  resourceDocumentationUrl:
    process.env.RESOURCE_DOCUMENTATION_URL ??
    "https://github.com/theonlyapi/onlyfans-api/blob/main/mcp/README.md",

  // OAuth 2.1 resource-server config. The MCP server validates JWTs minted
  // by the AS (your own Flask backend) before serving MCP traffic.
  //   - oauthIssuer:   must match the `iss` claim on incoming tokens.
  //   - oauthJwksUri:  where to fetch the AS public keys (JWKS).
  //   - oauthAudience: canonical resource URL — must equal both the `aud`
  //                    claim on tokens and the `resource` value advertised
  //                    on the protected-resource metadata doc.
  //   - oauthEnabled:  when false, the server falls back to plain bearer
  //                    (CRM API key) auth only. When true, both schemes
  //                    are accepted side-by-side (JWT preferred).
  oauthEnabled: (process.env.OAUTH_ENABLED ?? "true").toLowerCase() !== "false",
  oauthIssuer: (process.env.OAUTH_ISSUER ?? "http://localhost:5000").replace(/\/$/, ""),
  oauthJwksUri:
    process.env.OAUTH_JWKS_URI ??
    `${(process.env.OAUTH_ISSUER ?? "http://localhost:5000").replace(/\/$/, "")}/.well-known/jwks.json`,
  oauthAudience: (process.env.OAUTH_AUDIENCE ?? process.env.PUBLIC_URL ?? "http://localhost:8181/mcp").replace(/\/$/, ""),
  oauthRequiredScopes: csv("OAUTH_REQUIRED_SCOPES", ["of:read"]),
};

export type AppConfig = typeof config;
