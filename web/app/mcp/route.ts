/**
 * MCP entrypoint for this install, served at /mcp.
 *
 * (port 3181). The actual MCP server is a separate Node service on
 * 127.0.0.1:8181 that the public can't hit directly. This route is a
 * thin transparent reverse-proxy so MCP clients (Claude Desktop /
 * Claude.ai / Cursor / curl / OpenAI Responses API) can connect via the
 * pretty public URL.
 *
 * - POST is JSON-RPC (sometimes returns SSE). Body is opaque.
 * - GET is for server-initiated SSE streams.
 * - DELETE ends a session.
 *
 * We must preserve:
 *   - Authorization (Bearer <api_key>)
 *   - Mcp-Session-Id / Mcp-Protocol-Version / Last-Event-Id (req → MCP)
 *   - Mcp-Session-Id / Mcp-Protocol-Version + Content-Type (MCP → resp)
 *   - The streaming body verbatim (don't buffer SSE).
 */
import type { NextRequest } from "next/server";

// Disable Next's default body handling — we want raw streaming both ways.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 3600;

const MCP_URL =
  process.env.MCP_SERVER_URL || "http://127.0.0.1:8181/mcp";

const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
]);

const EXPOSED_RESPONSE_HEADERS = new Set([
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "cache-control",
  "transfer-encoding",
  // OAuth 2.1 challenge — without this, ChatGPT / Claude.ai can't
  // discover the authorization server from a 401. Per RFC 6750 §3
  // the WWW-Authenticate header is the trigger for the client to
  // re-run the OAuth flow.
  "www-authenticate",
]);

async function proxy(req: NextRequest): Promise<Response> {
  // Re-emit only the headers the MCP transport cares about. Strip
  // hop-by-hop and Cloudflare/Vercel/Next-injected headers that would
  // confuse the upstream.
  const fwdHeaders: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    if (ALLOWED_REQUEST_HEADERS.has(k.toLowerCase())) {
      fwdHeaders[k] = v;
    }
  }

  // For non-GET/HEAD we forward the body. Next.js gives us a ReadableStream
  // on req.body; undici can consume it directly with `duplex: "half"`.
  const method = req.method;
  const init: RequestInit = {
    method,
    headers: fwdHeaders,
    // The `duplex` option is required by the Fetch spec when piping a
    // ReadableStream as the body. Casting because TS lib doesn't include it.
    ...((method !== "GET" && method !== "HEAD" && method !== "DELETE")
      ? { body: req.body, duplex: "half" } as RequestInit & { duplex?: "half" }
      : {}),
  };

  let upstream: Response;
  try {
    upstream = await fetch(MCP_URL, init);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "MCP server unreachable",
        detail: (err as Error).message,
      }),
      {
        status: 502,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Build the response, copying the headers we want to expose.
  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers.entries()) {
    if (EXPOSED_RESPONSE_HEADERS.has(k.toLowerCase())) {
      respHeaders.set(k, v);
    }
  }
  // Belt-and-braces: Cloudflare/Next can buffer SSE without these hints.
  respHeaders.set("X-Accel-Buffering", "no");
  if ((respHeaders.get("content-type") || "").includes("event-stream")) {
    respHeaders.set("cache-control", "no-cache, no-transform");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export async function POST(req: NextRequest) { return proxy(req); }
export async function GET(req: NextRequest)  { return proxy(req); }
export async function DELETE(req: NextRequest) { return proxy(req); }

export async function OPTIONS() {
  // The MCP server already handles CORS for cross-origin browser clients.
  // We just need to keep Cloudflare from serving its own 405 page here.
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers":
        "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id",
    },
  });
}
