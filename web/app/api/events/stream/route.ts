import { getActiveToken, isSessionActive } from "@/lib/account-security";
import { backendUrl } from "@/lib/backend-url";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";



/**
 * SSE proxy. The browser's EventSource cannot set custom headers, so we
 * read the API key from the signed JWT (NOT from session.user, which no
 * longer carries the key — see auth-options.ts) and attach X-API-Key
 * ourselves when opening the upstream connection to Flask.
 */
export async function GET(req: NextRequest) {
  const token = await getActiveToken(req);
  const crmId = (token as any)?.crmId as string | undefined;
  const apiKey = (token as any)?.apiKey as string | undefined;

  if (!crmId || !apiKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(
    `${backendUrl()}/api/crm/${crmId}/events/stream`,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "text/event-stream",
      },
      // Ensure we can stream back
      cache: "no-store",
      signal: req.signal,
    }
  );

  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream unavailable", { status: 502 });
  }

  // The stream outlives the check above. Re-check on the same 30s cadence as
  // the session cache and end the stream once the session has been removed.
  const reader = upstream.body.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    clearInterval(timer);
    reader.cancel().catch(() => {});
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(async () => {
        if (!(await isSessionActive(token))) finish(controller);
      }, 30_000);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) finish(controller);
        else controller.enqueue(value);
      } catch {
        finish(controller);
      }
    },
    cancel() {
      clearInterval(timer);
      return reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
