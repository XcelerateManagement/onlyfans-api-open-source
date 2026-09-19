// Detect and describe proxy / transport failures so the dashboard can offer an
// inline "fix proxy" flow instead of a dead-end error.
//
// The backend (onlyfans-api of_client.py) tags data-fetch transport failures
// with reason: "proxy_*"; the /proxy/test endpoint uses short reasons like
// "auth". Background refresh jobs only carry the translated message string, so
// we also match the human-readable text (e.g. "Proxy authentication failed (407)").

const PROXY_REASONS = new Set([
  "proxy_auth",
  "proxy_reset",
  "proxy_timeout",
  "proxy_connection",
  "proxy_dns",
  "proxy_tls",
  "proxy_error",
  // OnlyFans' Cloudflare refused a login from the proxy's IP (HTTP 424).
  "proxy_blocked",
  // /proxy/test short reasons
  "auth",
  "dns",
  "connection",
  "timeout",
  "tls",
  "reset",
  "proxy",
]);

const PROXY_MSG_RE =
  /proxy authentication|\(407\)|\b407\b|connect tunnel failed|proxy (?:auth|unreachable|refused|timed? ?out|connection|host)/i;

type MaybeApiError = {
  data?: { reason?: string; error?: string };
  reason?: string;
  message?: string;
};

/** True when the value looks like a proxy/transport failure (ApiError or status string). */
export function isProxyError(input: unknown): boolean {
  if (!input) return false;
  if (typeof input === "string") return PROXY_MSG_RE.test(input);
  const e = input as MaybeApiError;
  const reason = e?.data?.reason ?? e?.reason;
  if (typeof reason === "string" && PROXY_REASONS.has(reason)) return true;
  const msg = e?.data?.error || e?.message || "";
  return PROXY_MSG_RE.test(String(msg));
}

/** Pull the human-readable message out of an ApiError / status string. */
export function proxyErrorMessage(input: unknown): string {
  if (typeof input === "string") return input;
  const e = input as MaybeApiError;
  return e?.data?.error || e?.message || "Couldn't reach OnlyFans through the proxy.";
}
