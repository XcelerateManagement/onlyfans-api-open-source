/**
 * OAuth 2.1 consent screen.
 *
 * This is the user-facing half of the authorization-code flow. The Flask
 * authorization server validates the inbound /oauth/authorize request,
 * then 302s the browser here carrying:
 *
 *   - flow         — HMAC-signed envelope sealing the validated params
 *   - client_id    — for display
 *   - client_name  — for display
 *   - scope        — space-separated scope list to consent to
 *   - redirect_uri — for display
 *
 * On Approve / Deny we run a server action that POSTs to Flask
 * /oauth/authorize/grant with the user's X-API-Key (read off the
 * NextAuth session, never sent to the browser), then redirects to
 * the URL Flask gives back — either the OAuth client's redirect_uri
 * carrying ?code=… or carrying ?error=access_denied.
 */

import { getServerSession } from "next-auth";
import { backendUrl } from "@/lib/backend-url";
import { getToken } from "next-auth/jwt";
import { cookies, headers } from "next/headers";
import { authOptions } from "@/lib/auth-options";
import { isSessionActive } from "@/lib/account-security";
import { redirect } from "next/navigation";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { ConsentChrome } from "./_components/ConsentChrome";



type SearchParams = {
  flow?: string;
  client_id?: string;
  client_name?: string;
  scope?: string;
  redirect_uri?: string;
};

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  "of:read":
    "Read your CRM data — connected OnlyFans accounts, fans, events, earnings, campaigns.",
  "of:write":
    "Take actions on your behalf — send DMs, manage automations, create webhooks.",
};

async function grant(formData: FormData) {
  "use server";

  const decision = formData.get("decision");
  const flow = formData.get("flow");
  if (typeof decision !== "string" || typeof flow !== "string") {
    throw new Error("Invalid consent submission");
  }
  if (decision !== "approve" && decision !== "deny") {
    throw new Error("Decision must be approve or deny");
  }

  // The session callback strips `apiKey` off session.user for XSS defense
  // (see lib/auth-options.ts), so we read the raw JWT here. It lives only
  // server-side; the browser never sees it.
  const cookieStore = await cookies();
  const headerStore = await headers();
  const cookieName = "__Secure-next-auth.session-token";
  const fallbackName = "next-auth.session-token";
  const reqLike = {
    headers: Object.fromEntries(headerStore.entries()),
    cookies: Object.fromEntries(
      cookieStore.getAll().map((c) => [c.name, c.value]),
    ),
  } as unknown as Parameters<typeof getToken>[0]["req"];
  const jwt = await getToken({
    req: reqLike,
    secret: process.env.NEXTAUTH_SECRET,
  }).catch(() => null);
  const apiKey = (jwt as { apiKey?: string } | null)?.apiKey;
  if (!apiKey || !(await isSessionActive(jwt))) {
    // Session expired between page render and submit. Bounce back to
    // login carrying the original consent URL so we resume cleanly.
    redirect("/login?error=session_expired");
  }

  const res = await fetch(`${backendUrl()}/oauth/authorize/grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey as string,
    },
    body: JSON.stringify({ flow, decision }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OAuth grant failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { redirect?: string };
  if (!data.redirect) {
    throw new Error("OAuth grant: no redirect in response");
  }
  redirect(data.redirect);
}

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { flow, client_id, client_name, scope, redirect_uri } = params;

  // Param-level checks first — if any are missing, the AS sent us
  // somewhere bad, refuse to render the screen.
  if (!flow || !client_id || !scope || !redirect_uri) {
    return (
      <ConsentChrome>
        <div className="relative bg-[#0d0d0d]/80 backdrop-blur-xl border border-white/[0.06] p-8 overflow-hidden">
          <CornerBrackets size={10} />
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#f54900] mb-3">
            ERR · INVALID_REQUEST
          </p>
          <h1 className="text-xl font-semibold mb-3 text-white">
            Invalid authorization request
          </h1>
          <p className="text-sm text-white/60 leading-relaxed">
            This page must be reached from an OAuth client (ChatGPT,
            Claude.ai, Cursor, …). Start a fresh connection attempt from
            that app.
          </p>
        </div>
      </ConsentChrome>
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    // Preserve the full consent URL so login can bounce back here.
    const next = `/oauth/consent?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/login?callbackUrl=${encodeURIComponent(next)}`);
  }

  const scopes = scope.split(/\s+/).filter(Boolean);
  const clientLabel = client_name || client_id;
  const redirectHost = (() => {
    try {
      return new URL(redirect_uri).host;
    } catch {
      return redirect_uri;
    }
  })();

  return (
    <ConsentChrome>
      {/* Glass card with corner brackets — matches the login page chrome */}
      <div className="relative bg-[#0d0d0d]/80 backdrop-blur-xl border border-white/[0.06] p-8 sm:p-10 overflow-hidden">
        <CornerBrackets size={10} />

        {/* Scanline overlay — same effect as the CodeExampleHero terminal */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0, transparent 2px, #fff 2px, #fff 3px)",
          }}
        />

        {/* Header — terminal-prompt vibe */}
        <div className="relative mb-7">
          <div className="flex items-center gap-2 mb-4 text-[11px] font-mono uppercase tracking-[0.2em] text-[#f54900]">
            <span className="inline-block w-1.5 h-1.5 bg-[#f54900] animate-pulse" />
            OAUTH · 2.1 · PKCE · S256
          </div>
          <h1 className="text-[1.65rem] leading-tight font-semibold text-white tracking-tight mb-3">
            <span className="text-[#f54900]">{clientLabel}</span>{" "}
            <span className="text-white/80">wants to connect</span>
          </h1>
          <p className="text-[13px] text-white/55 leading-relaxed">
            Signed in as{" "}
            <span className="font-mono text-white/80">{session.user.email}</span>.
            After you approve, this app can call your self-hosted API on your behalf
            for 1 hour, or until you revoke it from{" "}
            <span className="font-mono text-white/80">/dashboard/mcp</span>.
          </p>
        </div>

        {/* Scopes — render as a console output block */}
        <div className="relative mb-7">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/40 mb-3">
            PERMISSIONS · REQUESTED
          </p>
          <div className="bg-[#0c0a09] border border-[#f54900]/15 px-4 py-3 font-mono text-[12px]">
            {scopes.map((s, i) => (
              <div key={s} className={i > 0 ? "mt-2 pt-2 border-t border-white/[0.04]" : ""}>
                <div className="flex items-baseline gap-2">
                  <span className="text-[#f54900]">{"$"}</span>
                  <code className="text-white">{s}</code>
                </div>
                <p className="mt-1 ml-4 text-white/55 leading-relaxed font-sans text-[12px]">
                  {SCOPE_DESCRIPTIONS[s] ?? "Unknown scope"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Token target / client id — monospace metadata block */}
        <div className="relative mb-7 border-t border-white/[0.06] pt-5 space-y-1.5">
          <div className="flex items-baseline gap-3 text-[11px] font-mono">
            <span className="text-white/35 uppercase tracking-[0.15em] min-w-[88px]">
              DELIVER →
            </span>
            <span className="text-white/75 break-all">{redirectHost}</span>
          </div>
          <div className="flex items-baseline gap-3 text-[11px] font-mono">
            <span className="text-white/35 uppercase tracking-[0.15em] min-w-[88px]">
              CLIENT_ID
            </span>
            <span className="text-white/75 break-all">{client_id}</span>
          </div>
          <div className="flex items-baseline gap-3 text-[11px] font-mono">
            <span className="text-white/35 uppercase tracking-[0.15em] min-w-[88px]">
              TOKEN_TTL
            </span>
            <span className="text-white/75">3600s · RS256</span>
          </div>
        </div>

        {/* Buttons — uppercase, tracking-wider, orange glow on Approve */}
        <form action={grant} className="relative flex gap-3">
          <input type="hidden" name="flow" value={flow} />
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 px-4 py-3 border border-white/[0.08] text-white/60 hover:text-white hover:border-white/20 hover:bg-white/[0.03] transition text-[12px] font-bold uppercase tracking-[0.18em]"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 px-4 py-3 bg-[#f54900] hover:bg-[#ff5a0a] text-black font-bold uppercase tracking-[0.18em] text-[12px] transition shadow-[0_0_24px_-6px_rgba(245,73,0,0.6)] hover:shadow-[0_0_32px_-4px_rgba(245,73,0,0.85)]"
          >
            Approve
          </button>
        </form>
      </div>

      {/* Footer — matches login page footer */}
      <p className="text-center text-[10px] font-mono uppercase tracking-[0.25em] text-white/25 mt-5">
        Open Source OnlyFans + Fansly API · OAuth 2.1 · MCP
      </p>
    </ConsentChrome>
  );
}
