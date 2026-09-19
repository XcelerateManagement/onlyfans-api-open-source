import { getActiveToken } from "@/lib/account-security";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  // Read apiKey from the signed JWT — it's no longer surfaced on session.user.
  const token = await getActiveToken(req);
  const apiKey = (token as { apiKey?: string } | null | undefined)?.apiKey;
  if (!apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Same reasoning as /api/mcp/test — local loopback is the right server-side
  // address; deploy env always sets CRM_API_BASE explicitly.
  const backend =
    process.env.CRM_API_BASE ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:5020";

  let res: Response;
  try {
    res = await fetch(`${backend.replace(/\/$/, "")}/api/whoami`, {
      headers: { "X-API-Key": apiKey },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Backend unreachable", detail: (e as Error).message },
      { status: 502 },
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch {/* keep null */}
  return NextResponse.json(data ?? { error: text.slice(0, 200) }, { status: res.status });
}
