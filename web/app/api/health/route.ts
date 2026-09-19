import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STARTED = Date.now();

/**
 * Liveness for the dashboard process itself.
 *
 * This deliberately reports nothing about the API, the database or the
 * scheduler: the dashboard is stateless and does not own any of them, and a
 * health endpoint that guesses at its dependencies is worse than none. For the
 * backend's real dependency readiness, call the API's own `/ready` — it returns
 * 503 and names the failing component.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "web",
    uptime_seconds: Math.floor((Date.now() - STARTED) / 1000),
  });
}
