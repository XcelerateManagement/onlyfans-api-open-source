import { getActiveToken } from "@/lib/account-security";
import { backendUrl } from "@/lib/backend-url";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



/**
 * Front door for every `/api/crm/<crm_id>/...` call. Two auth modes:
 *
 *  1. Direct API consumers (the documented product) send `X-API-Key`
 *     themselves — the "Copy cURL" button, SDKs, scripts. We forward that
 *     header straight to Flask, which validates it against the crm_id in the
 *     URL. No session cookie required. (The inter-service `X-Service-Token`
 *     pair is forwarded the same way for the hosted MCP server.)
 *
 *  2. The dashboard browser sends NO key — it relies on the signed NextAuth
 *     JWT cookie. We read `apiKey`/`crmId` from the JWT and attach the key
 *     server-side, so the key is never exposed to client-side JS (an XSS or
 *     hostile dep on the dashboard can't exfiltrate it). For this path we pin
 *     the URL crm_id to the session's crmId so a crafted fetch can't address
 *     another tenant.
 *
 * Mode 1 doesn't weaken mode 2: a browser XSS attacker still can't read the
 * httpOnly cookie, so they can't supply a valid X-API-Key either.
 */
async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  const segments = path || [];
  if (segments.length === 0) {
    return new Response(JSON.stringify({ error: "Bad request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const directKey = req.headers.get("x-api-key");
  const svcToken = req.headers.get("x-service-token");

  const fwdHeaders: Record<string, string> = {};

  if (directKey || svcToken) {
    // ── Direct API / inter-service path ──────────────────────────────────
    // Forward the caller's own auth headers verbatim. Flask scopes the key
    // (or service token) to the crm_id in the URL, so no extra pinning here.
    if (directKey) fwdHeaders["X-API-Key"] = directKey;
    if (svcToken) {
      fwdHeaders["X-Service-Token"] = svcToken;
      const acting = req.headers.get("x-acting-crm-id");
      if (acting) fwdHeaders["X-Acting-Crm-Id"] = acting;
    }
  } else {
    // ── Browser / dashboard path ─────────────────────────────────────────
    const token = await getActiveToken(req);
    const crmId = (token as any)?.crmId as string | undefined;
    const apiKey = (token as any)?.apiKey as string | undefined;

    if (!crmId || !apiKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Enforce tenant scoping: the URL crm_id must match the session crm_id.
    if (segments[0] !== crmId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    fwdHeaders["X-API-Key"] = apiKey;
  }

  const suffix = segments.join("/");
  const search = req.nextUrl.search || "";
  const upstreamUrl = `${backendUrl()}/api/crm/${suffix}${search}`;

  // Carry through Content-Type and X-Proxy if the client sent them.
  const ct = req.headers.get("content-type");
  if (ct) fwdHeaders["Content-Type"] = ct;
  const xp = req.headers.get("x-proxy");
  if (xp) fwdHeaders["X-Proxy"] = xp;
  // The transparent OF passthrough (`/api/crm/<id>/api2/v2/...`) selects the
  // OF account via the `user-id` header — forward it so Flask can see it.
  const ofUserId = req.headers.get("user-id");
  if (ofUserId) fwdHeaders["user-id"] = ofUserId;
  // First-request cookie login: forward only OF session cookies, never the
  // dashboard's NextAuth cookie.
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const ofCookies = cookieHeader
      .split(/;\s*/)
      .filter((c) => /^(sess|auth_id|fp)=/.test(c));
    if (ofCookies.length) fwdHeaders["Cookie"] = ofCookies.join("; ");
  }

  const method = req.method.toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method);
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers: fwdHeaders,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: "no-store",
      signal: req.signal,
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Backend unreachable", detail: err?.message }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const respHeaders = new Headers();
  const upstreamCt = upstream.headers.get("content-type");
  if (upstreamCt) respHeaders.set("Content-Type", upstreamCt);
  // File downloads (e.g. data-export ZIPs) come back as attachments — carry
  // the disposition + length through so the browser saves with the filename.
  const dispo = upstream.headers.get("content-disposition");
  if (dispo) respHeaders.set("Content-Disposition", dispo);
  const len = upstream.headers.get("content-length");
  if (len) respHeaders.set("Content-Length", len);
  // Cache-control: never cache CRM data in browsers / intermediaries.
  respHeaders.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
};
