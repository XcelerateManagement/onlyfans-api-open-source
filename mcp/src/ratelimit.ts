/**
 * Per-session, per-tool token bucket. Exists in addition to Flask's
 * X-API-Key limiter — this layer stops a runaway prompt from hammering
 * OnlyFans with cheap-to-issue but expensive-to-serve tools (refreshes,
 * message sends), which is how accounts get rate-limited upstream.
 */
import { RateLimitError } from "./auth/errors.js";

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitSpec {
  capacity: number;
  refillPerSec: number;
}

/**
 * Cost limits per tool, applied per (crm_id, tool) key.
 *
 * These exist *in addition* to Flask's per-API-key limiter. They're a
 * runaway-prompt guard, not the primary safety mechanism.
 *
 * Burst capacity is the per-minute number;
 * refillPerSec is N/60 so the bucket refills to full in a minute.
 *
 * Tune via env (e.g. MCP_RL_REFRESH=120) without redeploying.
 */
import { config as appConfig } from "./config.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const REFRESH = envInt("MCP_RL_REFRESH", 30); // was 5
const REFRESH_FAN = envInt("MCP_RL_REFRESH_FAN", 60); // was 10
const PPV = envInt("MCP_RL_PPV", 10); // was 3
const SEND = envInt("MCP_RL_SEND", 60); // was 20
const TEST_HOOK = envInt("MCP_RL_TEST_WEBHOOK", 30); // was 10
const PAYOUT = envInt("MCP_RL_PAYOUT", 10); // was 3
const AUTOMATION_RUN = envInt("MCP_RL_AUTOMATION_RUN", 60); // was 20
const ESCAPE = envInt("MCP_RL_ESCAPE", 120); // was 30

void appConfig; // keep import alive in case we wire global toggles later

const LIMITS: Record<string, RateLimitSpec> = {
  of_refresh_subscribers: { capacity: REFRESH, refillPerSec: REFRESH / 60 },
  of_refresh_transactions: { capacity: REFRESH, refillPerSec: REFRESH / 60 },
  of_refresh_campaigns: { capacity: REFRESH, refillPerSec: REFRESH / 60 },
  of_refresh_fan_profile: { capacity: REFRESH_FAN, refillPerSec: REFRESH_FAN / 60 },
  of_get_ppv_stats: { capacity: PPV, refillPerSec: PPV / 60 },
  of_send_message: { capacity: SEND, refillPerSec: SEND / 60 },
  of_test_webhook: { capacity: TEST_HOOK, refillPerSec: TEST_HOOK / 60 },
  of_create_payout_request: { capacity: PAYOUT, refillPerSec: PAYOUT / 60 },
  of_run_automation_now: { capacity: AUTOMATION_RUN, refillPerSec: AUTOMATION_RUN / 60 },
  of_crm_request: { capacity: ESCAPE, refillPerSec: ESCAPE / 60 },
  of_proxy_request: { capacity: ESCAPE, refillPerSec: ESCAPE / 60 },
};

/** Exposed for diagnostics / dashboard rendering. */
export function currentLimits(): Record<string, RateLimitSpec> {
  return { ...LIMITS };
}

export function consume(crmId: string, tool: string): void {
  const spec = LIMITS[tool];
  if (!spec) return; // Tool not rate-limited beyond Flask's defaults.
  const key = `${crmId}:${tool}`;
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: spec.capacity, updatedAt: now };
    buckets.set(key, b);
  } else {
    const elapsedSec = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(spec.capacity, b.tokens + elapsedSec * spec.refillPerSec);
    b.updatedAt = now;
  }
  if (b.tokens < 1) {
    throw new RateLimitError(`Tool "${tool}" rate limit hit. Try again shortly.`);
  }
  b.tokens -= 1;
}

export function _resetForTests(): void {
  buckets.clear();
}
