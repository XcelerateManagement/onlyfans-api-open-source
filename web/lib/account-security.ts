import { getToken, type JWT } from "next-auth/jwt";
import { backendUrl } from "@/lib/backend-url";
import type { NextRequest } from "next/server";
import { getServiceToken } from "@/lib/inter-service-token";

/**
 * Server-side helpers for dashboard 2FA and signed-in sessions.
 *
 * The state lives in Flask (onlyfans-api/account_security.py) behind
 * /internal/account-security/*, which only accepts the inter-service token.
 * The browser never calls it directly: API routes here act on the crmId /
 * sessionId from the user's own signed session cookie.
 */



export { MFA_REQUIRED_PREFIX } from "@/lib/account-security-shared";

/**
 * Rollout switch. ACCOUNT_SECURITY_CRM_IDS lists the panels that get 2FA and
 * session tracking: comma-separated crm ids, "*" for everyone, unset or empty
 * for no one. Every other panel keeps the previous login flow unchanged.
 */
export function accountSecurityEnabled(crmId: string | null | undefined): boolean {
  if (!crmId) return false;
  const allowed = (process.env.ACCOUNT_SECURITY_CRM_IDS || "").trim();
  if (allowed === "*") return true;
  return allowed.split(",").map((id) => id.trim()).includes(crmId);
}

export class AccountSecurityError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function accountSecurityCall<T = any>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${backendUrl()}/internal/account-security/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Token": getServiceToken(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AccountSecurityError(
      "Account security is temporarily unavailable. Please try again shortly.",
      503
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AccountSecurityError(
      res.status >= 500 || !data?.error
        ? "Account security is temporarily unavailable. Please try again shortly."
        : data.error,
      res.status
    );
  }
  return data as T;
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) || undefined;
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

/** Real client IP (Cloudflare fronts the site), for rate limits and the session list. */
export function clientIp(headers: HeaderSource): string | undefined {
  return (
    readHeader(headers, "cf-connecting-ip") ||
    readHeader(headers, "x-forwarded-for")?.split(",")[0]?.trim() ||
    readHeader(headers, "x-real-ip") ||
    undefined
  );
}

/** Approximate device / location details shown in Settings → Signed-in sessions. */
export function sessionMetadata(headers: HeaderSource) {
  const country = readHeader(headers, "cf-ipcountry");
  return {
    ip: clientIp(headers) || null,
    // Cloudflare uses XX for unknown and T1 for Tor.
    country: country && /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null,
    user_agent: readHeader(headers, "user-agent") || null,
  };
}

// ── session liveness ────────────────────────────────────────────────────────

const CHECK_CACHE_MS = 30_000;
const checkCache = new Map<string, { active: boolean; at: number }>();

function remember(key: string, active: boolean) {
  if (checkCache.size > 5000) checkCache.clear();
  checkCache.set(key, { active, at: Date.now() });
}

/**
 * Whether a decoded session cookie is still allowed.
 *
 * Only an explicit "not active" answer from Flask signs a user out. If Flask
 * can't answer (e.g. during the ~60s of-api restart) the last known answer,
 * or else "active", is used, so a deploy never logs everyone out.
 * Answers are cached for 30s, so a removed session stops working within 30s.
 */
export async function isSessionActive(token: JWT | null | undefined): Promise<boolean> {
  if (!token) return false;
  const crmId = token.crmId;
  // Nothing to look up: such a session can't reach any CRM data anyway.
  // Panels outside the rollout aren't tracked.
  if (!crmId || !accountSecurityEnabled(crmId)) return true;
  const sessionId = token.sessionId || null;
  const issuedAt = Number(token.iat) || 0;
  const key = `${crmId}:${sessionId || `legacy:${issuedAt}`}`;
  const hit = checkCache.get(key);
  if (hit && Date.now() - hit.at < CHECK_CACHE_MS) return hit.active;
  try {
    const result = await accountSecurityCall<{ active?: boolean }>("sessions/check", {
      crm_id: crmId,
      session_id: sessionId,
      issued_at: issuedAt,
    });
    const active = result.active === true;
    remember(key, active);
    return active;
  } catch {
    return hit ? hit.active : true;
  }
}

/** Forget cached answers for a panel, e.g. right after its sessions were removed. */
export function forgetSessionChecks(crmId: string) {
  for (const key of checkCache.keys()) {
    if (key.startsWith(`${crmId}:`)) checkCache.delete(key);
  }
}

/** getToken() plus the session-removed check. Use for every authenticated route. */
export async function getActiveToken(req: NextRequest): Promise<JWT | null> {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
  if (!token) return null;
  return (await isSessionActive(token)) ? token : null;
}

/** Reject cross-site browser writes to security routes. */
export function isSameOrigin(req: NextRequest): boolean {
  const expected = new URL(process.env.NEXTAUTH_URL || "http://localhost:3000").origin;
  const origin = req.headers.get("origin");
  return origin === expected || origin === req.nextUrl.origin;
}

// ── billing dashboard password check ────────────────────────────────────────

export type DashboardLoginResult = {
  ok: boolean;
  status: number;
  data: any;
};

