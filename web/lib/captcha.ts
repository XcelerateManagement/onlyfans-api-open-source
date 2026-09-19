/**
 * Cloudflare Turnstile captcha helpers — server side.
 *
 * Turnstile verification. Behaviour is
 * identical across the two surfaces: same env names, same dev-mode no-op,
 * same error shape. Keeps a Turnstile widget config in Cloudflare's UI
 * allowed hostnames) able to back both apps with one key.
 *
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — embedded in the client widget
 *   TURNSTILE_SECRET_KEY            — server-side verification secret
 *
 * If TURNSTILE_SECRET_KEY is unset we return success and log a warning —
 * local dev stays unblocked, production sets the key and verification
 * becomes strict.
 */

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerifyResult {
  success: boolean;
  reason?: string;
}

interface TurnstileApiResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  "error-codes"?: string[];
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  ip?: string
): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn(
      "[captcha] TURNSTILE_SECRET_KEY not set — skipping verification (dev mode)"
    );
    return { success: true, reason: "no_key_configured" };
  }

  // E2E bypass: a server-only env can opt in a single magic token value
  // that succeeds without hitting Cloudflare. Set CAPTCHA_BYPASS_TOKEN to a
  // long random string in dev/CI, NEVER in prod. Default is empty so the
  // bypass is impossible unless explicitly configured. Constant-time compare
  // defeats per-byte timing leaks if someone tries to guess the value.
  const bypass = process.env.CAPTCHA_BYPASS_TOKEN;
  if (bypass && token && typeof token === "string" && token.length === bypass.length) {
    let mismatch = 0;
    for (let i = 0; i < bypass.length; i++) {
      mismatch |= bypass.charCodeAt(i) ^ token.charCodeAt(i);
    }
    if (mismatch === 0) {
      return { success: true, reason: "bypass" };
    }
  }

  if (!token) {
    return { success: false, reason: "missing_token" };
  }

  const formData = new URLSearchParams();
  formData.append("secret", secret);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: formData,
    });
    const data = (await res.json()) as TurnstileApiResponse;
    if (!data.success) {
      const codes = data["error-codes"] ?? [];
      return {
        success: false,
        reason: codes.length > 0 ? codes.join(",") : "verification_failed",
      };
    }
    return { success: true };
  } catch (e) {
    console.error("[captcha] Turnstile verify network error:", e);
    return { success: false, reason: "network_error" };
  }
}

