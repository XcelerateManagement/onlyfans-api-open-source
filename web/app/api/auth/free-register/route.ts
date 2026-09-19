import { NextResponse } from "next/server";

import { backendUrl } from "@/lib/backend-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create an account on this install.
 *
 * This talks to one place: your own API container. There is no external
 * service, no subscription to attach and nothing to check against a licence
 * server — the account is created in your database and that is the whole of it.
 *
 * The first account to register owns the install. Close registration
 * afterwards by setting ALLOW_PUBLIC_REGISTRATION=false, or anyone who can
 * reach the page can create themselves a panel.
 */
export async function POST(req: Request) {
  if (process.env.ALLOW_PUBLIC_REGISTRATION === "false") {
    return NextResponse.json(
      { error: "Registration is closed on this install." },
      { status: 403 },
    );
  }

  let body: { name?: string; email?: string; password?: string };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const name = (body.name || "").trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  let res: Response;

  try {
    res = await fetch(`${backendUrl()}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
      cache: "no-store",
    });
  } catch (e) {
    // Almost always a misconfigured or not-yet-running API container.
    return NextResponse.json(
      {
        error:
          "Could not reach the API. Check BACKEND_URL and that the api " +
          "container is running.",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const data = await res.json().catch(() => ({}) as Record<string, unknown>);

  if (!res.ok) {
    const message = String((data as { error?: string })?.error || "");
    // The page shows a "sign in instead" prompt on 409.
    const exists = res.status === 409 || /exists|already/i.test(message);

    return NextResponse.json(
      { error: message || "Could not create your account" },
      { status: exists ? 409 : res.status },
    );
  }

  // The caller signs in normally through NextAuth from here.
  return NextResponse.json({ success: true });
}
