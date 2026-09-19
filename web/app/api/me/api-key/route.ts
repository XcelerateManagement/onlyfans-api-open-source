import { getActiveToken } from "@/lib/account-security";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/me/api-key
 *
 * Returns the authenticated user's CRM API key. The key lives in the signed
 * JWT (server-only) — not on `session.user` — so the only way for the client
 * to see it is via this endpoint, which requires a valid session cookie. UI
 * surfaces that need to display the key (settings, api-docs, admin/api-keys,
 * ApiKeyWidget, mcp page) fetch this on mount.
 *
 * Compared to leaving `apiKey` on `session.user`, this:
 *   - Shrinks the XSS-to-key-theft window to a single authenticated GET
 *   - Lets you audit / rate-limit / scope key disclosure server-side
 *   - Keeps the key out of `useSession()`-tied React tree state, where any
 *     dependency could read it via the next-auth context
 */
export async function GET(req: NextRequest) {
  const token = await getActiveToken(req);
  const crmId = (token as any)?.crmId as string | undefined;
  const apiKey = (token as any)?.apiKey as string | undefined;

  if (!crmId || !apiKey) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ crmId, apiKey }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
