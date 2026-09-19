import { request } from "undici";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { AuthError, BackendError } from "./errors.js";
import { logger, hashToken } from "../logging.js";
import { VERSION, SERVER_NAME } from "../version.js";

export type Session = {
  /** The CRM panel ID resolved from the bearer token. */
  crmId: string;
  /** Display name of the panel (best-effort). */
  name?: string | null;
  /** Whether this panel has opted into non-GET calls through of_proxy_request. */
  mcpUnsafeProxy: boolean;
  /** Raw bearer token (kept so the FlaskClient can use it as X-API-Key). */
  token: string;
  /** sha256-prefix correlation identifier for logging. Never the raw token. */
  tokenHash: string;
};

type CachedSession = Omit<Session, "token" | "tokenHash">;
type PositiveEntry = { session: CachedSession; expiresAt: number };
type NegativeEntry = { expiresAt: number };

// Cap cache size so a flood of unique tokens can't blow up memory. When the
// cap is hit, we drop the oldest entry (Map preserves insertion order).
const MAX_POSITIVE = 5000;
const MAX_NEGATIVE = 5000;

const positive = new Map<string, PositiveEntry>();
const negative = new Map<string, NegativeEntry>();

function capInsert<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  if (map.size >= cap) {
    // Drop oldest.
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, value);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function resolveSession(token: string): Promise<Session> {
  if (!token || typeof token !== "string") {
    throw new AuthError("Missing bearer token");
  }
  const key = sha256(token);
  const now = Date.now();

  const neg = negative.get(key);
  if (neg && neg.expiresAt > now) {
    throw new AuthError("Invalid bearer token");
  }

  const pos = positive.get(key);
  if (pos && pos.expiresAt > now) {
    return { ...pos.session, token, tokenHash: hashToken(token) };
  }

  // Cold lookup against Flask.
  const url = `${config.backendUrl}/api/whoami`;
  let res;
  try {
    res = await request(url, {
      method: "GET",
      headers: {
        "X-API-Key": token,
        "User-Agent": `${SERVER_NAME}/${VERSION}`,
      },
    });
  } catch (e) {
    logger.error({ err: (e as Error).message }, "whoami fetch failed");
    throw new BackendError(502, "Auth backend unreachable");
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    capInsert(negative, key, { expiresAt: now + config.whoamiNegTtlMs }, MAX_NEGATIVE);
    throw new AuthError("Invalid bearer token");
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const body = await res.body.text().catch(() => "");
    throw new BackendError(res.statusCode, "whoami returned non-2xx", body.slice(0, 200));
  }

  const data = (await res.body.json()) as {
    crm_id: string;
    name?: string | null;
    mcp_unsafe_proxy?: boolean;
  };
  if (!data?.crm_id) {
    throw new AuthError("Auth backend returned no crm_id");
  }

  const session = {
    crmId: data.crm_id,
    name: data.name ?? null,
    mcpUnsafeProxy: !!data.mcp_unsafe_proxy,
  };
  capInsert(positive, key, { session, expiresAt: now + config.whoamiTtlMs }, MAX_POSITIVE);
  return { ...session, token, tokenHash: hashToken(token) };
}

export function invalidateByToken(token: string): void {
  positive.delete(sha256(token));
  negative.delete(sha256(token));
}

export function invalidateByCrmId(crmId: string): number {
  let dropped = 0;
  for (const [k, v] of positive) {
    if (v.session.crmId === crmId) {
      positive.delete(k);
      dropped++;
    }
  }
  return dropped;
}

export function _cacheSizesForTests(): { positive: number; negative: number } {
  return { positive: positive.size, negative: negative.size };
}
