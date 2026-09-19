/**
 * OAuth 2.1 resource-server verification.
 *
 * Verifies access tokens minted by the Flask authorization server. The
 * MCP HTTP transport accepts either:
 *   (1) an OAuth 2.1 JWT bearer (verified here) → preferred for ChatGPT
 *       / Claude.ai / any MCP client that follows the spec, or
 *   (2) a legacy CRM API key bearer (handled by ../auth/whoami.ts) →
 *       kept for back-compat with Claude Desktop config and curl tests.
 *
 * Verification follows the MCP authorization spec (2025-06-18):
 *   - iss MUST match config.oauthIssuer
 *   - aud MUST contain config.oauthAudience (audience confusion defense)
 *   - exp / nbf MUST be valid
 *   - scope MUST include every entry in config.oauthRequiredScopes
 *
 * On any failure we throw an AuthError carrying the WWW-Authenticate
 * challenge string the HTTP layer should send back per RFC 6750 §3.
 */

import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type RemoteJWKSetOptions,
} from "jose";
import { config } from "../config.js";
import { AuthError } from "./errors.js";
import type { Session } from "./whoami.js";
import { hashToken } from "../logging.js";

const JWKS_OPTIONS: RemoteJWKSetOptions = {
  // Cache JWKS for an hour. RFC 7517 explicitly allows this; rotation
  // is handled by adding a new kid to the AS — old kid stays in JWKS
  // until the key file is removed, so verifications keep succeeding.
  cacheMaxAge: 60 * 60 * 1000,
  cooldownDuration: 30 * 1000,
  timeoutDuration: 5 * 1000,
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (jwks) return jwks;
  jwks = createRemoteJWKSet(new URL(config.oauthJwksUri), JWKS_OPTIONS);
  return jwks;
}

/**
 * Build the value of the WWW-Authenticate header we return on 401.
 *
 * Per the MCP spec and RFC 9728, this points clients at the protected-
 * resource metadata document so they can discover the authorization
 * server without out-of-band configuration.
 */
export function wwwAuthenticateChallenge(opts: {
  error?: string;
  description?: string;
  scope?: string;
} = {}): string {
  const parts: string[] = [
    `Bearer realm="${config.oauthAudience}"`,
    `resource_metadata="${config.oauthAudience}/.well-known/oauth-protected-resource"`,
  ];
  if (opts.scope) parts.push(`scope="${opts.scope}"`);
  if (opts.error) parts.push(`error="${opts.error}"`);
  if (opts.description) parts.push(`error_description="${opts.description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}

export interface OAuthSession extends Session {
  /** Always set when an OAuth bearer is used. */
  authScheme: "oauth";
  /** OAuth scopes carried in the access token. */
  scopes: string[];
  /** Registered client_id from the AS. */
  clientId: string;
  /** Raw JWT payload — useful for audit logs. Never returned to the user. */
  jwt: JWTPayload;
}

/**
 * Verify a bearer string as an OAuth access token. Throws AuthError on any
 * failure with a WWW-Authenticate challenge attached. The caller is
 * expected to detect AuthError and surface a 401 with the challenge in
 * the header.
 */
export async function verifyOAuthBearer(token: string): Promise<OAuthSession> {
  if (!config.oauthEnabled) {
    throw new AuthError("OAuth is disabled on this MCP server", {
      challenge: wwwAuthenticateChallenge({ error: "invalid_token" }),
    });
  }

  let result;
  try {
    result = await jwtVerify(token, getJwks(), {
      issuer: config.oauthIssuer,
      audience: config.oauthAudience,
      algorithms: ["RS256"],
    });
  } catch (e) {
    const msg = (e as Error).message ?? "invalid token";
    throw new AuthError(`OAuth token verification failed: ${msg}`, {
      challenge: wwwAuthenticateChallenge({
        error: "invalid_token",
        description: msg,
      }),
    });
  }

  const payload = result.payload;

  if (payload.token_type && payload.token_type !== "access_token") {
    throw new AuthError("Token is not an access token", {
      challenge: wwwAuthenticateChallenge({ error: "invalid_token" }),
    });
  }

  const scope = typeof payload.scope === "string" ? payload.scope : "";
  const scopes = scope.split(/\s+/).filter(Boolean);
  for (const required of config.oauthRequiredScopes) {
    if (!scopes.includes(required)) {
      throw new AuthError(`Missing required scope: ${required}`, {
        challenge: wwwAuthenticateChallenge({
          error: "insufficient_scope",
          scope: config.oauthRequiredScopes.join(" "),
        }),
      });
    }
  }

  const sub = payload.sub;
  const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
  if (!sub || !clientId) {
    throw new AuthError("Token is missing sub or client_id", {
      challenge: wwwAuthenticateChallenge({ error: "invalid_token" }),
    });
  }

  // `sub` is the user's CRM panel id (set by the AS at /oauth/token).
  // We don't re-resolve it against /api/whoami here — the AS is the
  // authority. If the user is later revoked, their refresh attempts
  // will fail at the AS, and the short access-token TTL (1h) caps the
  // staleness window.
  return {
    authScheme: "oauth",
    crmId: sub,
    name: typeof payload.name === "string" ? payload.name : null,
    mcpUnsafeProxy: false,
    // The raw "token" we hand to FlaskClient is the original JWT — Flask
    // doesn't currently accept it. The FlaskClient uses an inter-service
    // bridge instead (see flask/client.ts) when authScheme === "oauth".
    token,
    tokenHash: hashToken(token),
    scopes,
    clientId,
    jwt: payload,
  };
}

/**
 * Quick heuristic: is this bearer a JWT (three base64url segments
 * separated by dots) or an opaque CRM API key? Lets the router pick the
 * right verifier without parsing the body.
 */
export function looksLikeJwt(token: string): boolean {
  // CRM API keys are URL-safe base64-ish and don't contain dots. JWTs
  // always do (header.payload.signature). This is a routing hint, not a
  // security boundary — if the verifier rejects either way, the token
  // is invalid.
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9_\-]+$/.test(p));
}
