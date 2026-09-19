import { getActiveToken } from "@/lib/account-security";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Default to the loopback address — the public URL is only the right answer
// from a *browser*, not from this Next.js server (which is co-located with
// the MCP daemon and goes through localhost). The deploy env always sets
// MCP_SERVER_URL=http://127.0.0.1:8181/mcp explicitly.
const DEFAULT_MCP_URL = "http://127.0.0.1:8181/mcp";

/**
 * Best-effort one-line summary of an upstream non-JSON response (Cloudflare
 * 502 page, Nginx default 502, etc.). Never echoes raw HTML to the client.
 */
function summariseNonJson(text: string, status: number): string {
  const head = text.slice(0, 500).toLowerCase();
  if (head.includes("bad gateway") || head.includes("502")) {
    return "MCP server unreachable (502 from the public edge). Check that the MCP daemon is running and that NEXT.js has MCP_SERVER_URL pointed at it.";
  }
  if (head.includes("cloudflare")) {
    return `Cloudflare returned a ${status} for the MCP URL. The public path probably isn't routed to the MCP daemon.`;
  }
  if (head.startsWith("<!doctype") || head.startsWith("<html")) {
    return `Got an HTML response (${status}) from the MCP URL — that endpoint isn't an MCP server.`;
  }
  return `MCP server returned non-JSON (${status}).`;
}

export async function POST(req: NextRequest) {
  // Read apiKey from the signed JWT — it's no longer surfaced on session.user.
  const token = await getActiveToken(req);
  const apiKey = (token as { apiKey?: string } | null | undefined)?.apiKey;
  if (!apiKey) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const mcpUrl = process.env.MCP_SERVER_URL ?? process.env.NEXT_PUBLIC_MCP_URL ?? DEFAULT_MCP_URL;

  const initBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "dashboard-mcp-test", version: "0.1.0" },
    },
  };

  let res: Response;
  try {
    res = await fetch(mcpUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initBody),
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "MCP server unreachable", detail: (e as Error).message },
      { status: 502 },
    );
  }

  const sessionId = res.headers.get("mcp-session-id") ?? null;
  const text = await res.text();

  // The transport responds either as JSON or as a single SSE `data:` line.
  // Tolerate both.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = /data:\s*(\{[\s\S]*\})/.exec(text);
    if (m && m[1]) {
      try {
        parsed = JSON.parse(m[1]);
      } catch {/* ignore */}
    }
  }

  if (!res.ok || !parsed) {
    let detail: unknown;
    if (typeof parsed === "object" && parsed !== null && "error" in (parsed as Record<string, unknown>)) {
      detail = (parsed as Record<string, unknown>).error;
    } else {
      detail = summariseNonJson(text, res.status);
    }
    return NextResponse.json(
      { ok: false, status: res.status, detail, url: mcpUrl },
      { status: res.ok ? 502 : res.status },
    );
  }

  // After initialize we ask for the tools list to count what's exposed.
  // This is a second round-trip; the user only triggers this manually.
  let toolCount: number | null = null;
  let serverInfo: { name?: string; version?: string } | null = null;
  if (typeof parsed === "object" && parsed !== null) {
    const result = (parsed as { result?: Record<string, unknown> }).result;
    if (result && typeof result === "object" && "serverInfo" in result) {
      serverInfo = result.serverInfo as { name?: string; version?: string };
    }
  }

  if (sessionId) {
    // Send "initialized" notification then tools/list.
    try {
      await fetch(mcpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Mcp-Session-Id": sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      const listRes = await fetch(mcpUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Mcp-Session-Id": sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });
      const listText = await listRes.text();
      let listParsed: unknown = null;
      try { listParsed = JSON.parse(listText); }
      catch {
        const m = /data:\s*(\{[\s\S]*\})/.exec(listText);
        if (m && m[1]) { try { listParsed = JSON.parse(m[1]); } catch {/* ignore */} }
      }
      if (listParsed && typeof listParsed === "object" && "result" in listParsed) {
        const result = (listParsed as { result?: { tools?: unknown[] } }).result;
        if (Array.isArray(result?.tools)) toolCount = result.tools.length;
      }
      // Best-effort session close.
      await fetch(mcpUrl, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Mcp-Session-Id": sessionId,
        },
      }).catch(() => undefined);
    } catch {
      // Tool-count is informational; don't fail the test on it.
    }
  }

  return NextResponse.json({
    ok: true,
    server: serverInfo,
    tool_count: toolCount,
    url: mcpUrl,
  });
}
