import express from "express";
import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { SERVER_NAME } from "../version.js";
import { logger } from "../logging.js";
import { resolveSession, invalidateByToken, invalidateByCrmId } from "../auth/whoami.js";
import {
  verifyOAuthBearer,
  looksLikeJwt,
  wwwAuthenticateChallenge,
} from "../auth/oauth.js";
import type { Session } from "../auth/whoami.js";
import { AuthError, BackendError, HttpError } from "../auth/errors.js";
import {
  createSession,
  deleteSession,
  getSession,
  checkSessionOwnership,
} from "./transport.js";
import { hashToken } from "../logging.js";

function extractBearer(req: Request): string | null {
  const auth = req.header("authorization");
  if (!auth) return null;
  // Strict format: "Bearer <token>" — anything else is rejected.
  const m = /^Bearer\s+([A-Za-z0-9_\-\.~+\/=]+)$/.exec(auth.trim());
  return m ? (m[1] ?? null) : null;
}

function isOriginAllowed(origin: string | undefined): boolean {
  // No Origin header = server-to-server / curl / native client. Allow.
  if (!origin) return true;
  return config.allowedOrigins.has(origin);
}

function applyCorsHeaders(req: Request, res: Response): void {
  const origin = req.header("origin");
  if (origin && config.allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Mcp-Session-Id, Mcp-Protocol-Version",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  }
}

export function buildApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");

  // 1 MB JSON cap. MCP JSON-RPC payloads are tiny; raise only if a tool
  // ever needs to accept blobs.
  app.use(express.json({ limit: "1mb" }));

  app.use((req, res, next) => {
    // Always set no-sniff. CSP is for HTML; SSE/JSON doesn't need it.
    res.setHeader("X-Content-Type-Options", "nosniff");
    applyCorsHeaders(req, res);
    next();
  });

  // Health probe. Cheap, no auth.
  app.get("/health", (_req, res) => {
    res.json({ status: "healthy", service: SERVER_NAME });
  });

  // CORS preflight.
  app.options("/mcp", (_req, res) => {
    res.status(204).end();
  });

  // RFC 9728 — Protected Resource Metadata. ChatGPT (and any MCP client
  // following the spec) fetches this to discover which authorization
  // server to use. We hard-code the AS issuer + supported scopes so the
  // doc is purely a function of config; no DB lookup needed.
  //
  // Spec: https://datatracker.ietf.org/doc/html/rfc9728
  // OpenAI guide: https://developers.openai.com/apps-sdk/build/auth
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({
      resource: config.oauthAudience,
      authorization_servers: [config.oauthIssuer],
      scopes_supported: ["of:read", "of:write"],
      bearer_methods_supported: ["header"],
      resource_documentation: config.resourceDocumentationUrl,
    });
  });

  // Service-token-gated cache invalidation (called by Flask on key rotation).
  app.post("/internal/cache/invalidate", express.json({ limit: "16kb" }), (req, res) => {
    // Fail-closed if the token is unset / too short to be meaningful.
    if (!config.serviceToken || config.serviceToken.length < 16) {
      return res.status(501).json({ error: "INTER_SERVICE_TOKEN not configured" });
    }
    const provided = req.header("x-service-token") ?? "";
    // Use timingSafeEqual via fixed-length buffers so we don't leak length.
    // Pad/truncate `provided` to match `serviceToken` length, then compare.
    const expected = Buffer.from(config.serviceToken, "utf8");
    const got = Buffer.alloc(expected.length);
    Buffer.from(provided, "utf8").copy(got, 0, 0, expected.length);
    let ok = false;
    try {
      ok = timingSafeEqual(expected, got);
    } catch {
      ok = false;
    }
    // Also reject if the lengths differed (after constant-time compare, so the
    // attacker can't time the length check).
    if (provided.length !== expected.length) ok = false;
    if (!ok) return res.status(401).json({ error: "Unauthorized" });
    const body = req.body as { api_key?: string; crm_id?: string };
    let dropped = 0;
    if (body?.api_key) {
      invalidateByToken(body.api_key);
      dropped = 1;
    } else if (body?.crm_id) {
      dropped = invalidateByCrmId(body.crm_id);
    } else {
      return res.status(400).json({ error: "api_key or crm_id required" });
    }
    res.json({ success: true, dropped });
  });

  // The MCP endpoint. Streamable HTTP supports POST / GET / DELETE on the same path.
  app.all("/mcp", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const origin = req.header("origin");
      if (!isOriginAllowed(origin)) {
        logger.warn({ origin }, "rejected origin");
        return res.status(403).json({ error: "Origin not allowed" });
      }

      const token = extractBearer(req);
      if (!token) {
        // RFC 9728 / OpenAI Apps SDK: pointer the client at the
        // protected-resource metadata so they can run discovery.
        res.setHeader(
          "WWW-Authenticate",
          wwwAuthenticateChallenge({ error: "invalid_request", description: "Missing bearer token" }),
        );
        return res.status(401).json({ error: "Missing Bearer token in Authorization header" });
      }

      // Two accepted bearer formats:
      //   - JWT (three dot-separated base64url segments) → OAuth flow
      //   - Anything else                                 → legacy CRM API key
      // We try OAuth first when it looks like a JWT (and the feature flag
      // is on). On verify failure we surface the AuthError so its
      // WWW-Authenticate challenge reaches the client.
      let session: Session;
      if (config.oauthEnabled && looksLikeJwt(token)) {
        session = await verifyOAuthBearer(token);
      } else {
        session = await resolveSession(token);
      }

      const sessionId = req.header("mcp-session-id");
      let managed = sessionId ? getSession(sessionId) : undefined;

      if (managed) {
        // Hijack defense: same sessionId, different bearer → reject + drop.
        if (!checkSessionOwnership(managed, token)) {
          logger.error(
            { session_id: sessionId, token_h: hashToken(token) },
            "session hijack attempt — bearer mismatch",
          );
          deleteSession(managed.sessionId);
          return res.status(403).json({ error: "Session does not belong to this bearer" });
        }
      } else if (req.method === "DELETE") {
        // Trying to delete a session we don't know about.
        return res.status(404).json({ error: "Unknown session" });
      } else {
        // Cold start — create new transport + server. SDK will assign sessionId on initialize.
        managed = await createSession(session);
      }

      // Hand the request to the transport.
      await managed.transport.handleRequest(req, res, req.body);

      // If the request was a DELETE the SDK has already closed it; drop from map.
      if (req.method === "DELETE" && sessionId) {
        deleteSession(sessionId);
      }
    } catch (err) {
      next(err);
    }
  });

  // JSON error handler. Never echo the bearer back, and never raw HTML.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      const body: Record<string, unknown> = { error: err.message };
      if (err instanceof BackendError && err.bodySnippet) body.detail = err.bodySnippet;
      // RFC 6750 §3 — emit the WWW-Authenticate challenge on 401 so
      // MCP clients (ChatGPT, Claude.ai) can discover the AS and
      // re-run the OAuth flow without out-of-band configuration.
      if (err instanceof AuthError && err.challenge && !res.headersSent) {
        res.setHeader("WWW-Authenticate", err.challenge);
      }
      if (!res.headersSent) res.status(err.status).json(body);
      return;
    }
    logger.error({ err: (err as Error).message, stack: (err as Error).stack }, "unhandled error");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
