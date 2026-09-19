import type { Platform } from "@/lib/hooks/use-selected-account";

/**
 * Frontend mirror of the backend capability matrix (onlyfans-api/platform_features.py).
 * The backend now also emits `capabilities` on every account payload — prefer
 * that (via accountSupports) so the two can't drift. This static MATRIX is the
 * fallback for older payloads / callers that only have a platform string.
 */
export type PlatformFeature =
  | "profile"
  | "balances"
  | "earnings"
  | "transactions"
  | "transactions_refresh"
  | "backfill"
  | "subscribers"
  | "chats"
  | "messages"
  | "send_message"
  | "send_attachments"
  | "campaigns"
  | "campaigns_create"
  | "notifications"
  | "websocket"
  | "polling"
  | "payouts"
  | "payouts_request"
  | "subscription_price"
  | "subscription_price_update"
  | "ppv_stats"
  | "referrals";

const MATRIX: Record<Platform, Record<PlatformFeature, boolean>> = {
  onlyfans: {
    profile: true,
    balances: true,
    earnings: true,
    transactions: true,
    transactions_refresh: true, // mirrors platform_features.py _ONLYFANS
    backfill: true, // mirrors platform_features.py _ONLYFANS
    subscribers: true,
    chats: true,
    messages: true,
    send_message: true,
    // No upload pipeline exists on either platform — the composer only carries
    // filename strings, so a "successful" send would silently drop media.
    // Mirrors platform_features.py; flip per-platform when a real upload ships.
    send_attachments: false,
    campaigns: true,
    campaigns_create: true,
    notifications: true,
    websocket: true,
    polling: true,
    payouts: true,
    payouts_request: true,
    subscription_price: true,
    subscription_price_update: true,
    ppv_stats: true, // mirrors platform_features.py _ONLYFANS
    referrals: true, // mirrors platform_features.py _ONLYFANS
  },
  fansly: {
    profile: true,
    balances: true,
    earnings: true,
    transactions: true,
    // True once the fansly wallet-tx sync lands (built on the live-proven
    // GET /api/v1/account/wallets/transactions). Backend-emitted capabilities
    // win via accountSupports(), so the live payload governs until then.
    // Mirrors platform_features.py _FANSLY.
    transactions_refresh: true,
    // True alongside the fansly backfill implementation (wallet-tx walk +
    // harvest_fans, GET-only surfaces). Mirrors platform_features.py _FANSLY.
    backfill: true,
    // GET /api/v1/subscribers works (live-proven; the old "403-blocked"
    // assumption was wrong). Live route + cached pipeline + refresh are all
    // wired. Mirrors platform_features.py _FANSLY.
    subscribers: true,
    chats: true,
    messages: true,
    send_message: true,
    send_attachments: false, // no upload pipeline (see onlyfans entry) — platform_features.py parity
    // Tracking links read live from GET /api/v1/trackinglinks (confirmed) —
    // read-only: creating a link would be a POST the backend never sends to
    // Fansly. Mirrors platform_features.py _FANSLY.
    campaigns: true,
    campaigns_create: false,
    notifications: true, // GET /api/v1/notifications (confirmed live)
    // The Fansly WS listener never starts in prod (FANSLY_WS_ENABLED unset →
    // false; scheduler.py:93), so no real-time events flow. Mirrors
    // platform_features.py _FANSLY['websocket']=False; the backend derives it
    // from config so enabling the listener flips it back via capabilities.
    websocket: false,
    polling: true, // backend derives from config.FANSLY_POLLING_ENABLED — platform_features.py parity
    // Read side wired: payout methods (GET /payments/payoutmethods) + wallet
    // balance + payout HISTORY from the synced wallet ledger (tx type 16012).
    // Withdrawal requests would be a POST — never sent to Fansly.
    // Mirrors platform_features.py _FANSLY.
    payouts: true,
    payouts_request: false,
    // Read side wired: subscriptionTiers[].plans[] from /api/v1/account/me.
    // Price updates would be a POST — never sent. Mirrors platform_features.py.
    subscription_price: true,
    subscription_price_update: false,
    ppv_stats: false, // fansly message rows carry no purchase state — platform_features.py parity
    // No Fansly referral surface is known: nothing in the backend's fansly
    // modules reads referrals, no /api/v1 analogue of OF's referral endpoints
    // has been reversed, and the wallet ledger has no referral tx type.
    // Mirrors platform_features.py _FANSLY.
    referrals: false,
  },
};

/** True if the platform supports the feature. Undefined platform → OnlyFans. */
export function supports(
  platform: Platform | undefined,
  feature: PlatformFeature
): boolean {
  return MATRIX[platform ?? "onlyfans"]?.[feature] ?? false;
}

/**
 * Drift-proof variant: prefer the backend-emitted `capabilities` on the account
 * object, falling back to the static MATRIX for older payloads. Pass the whole
 * account so the gate tracks exactly what the backend will 501.
 */
export function accountSupports(
  account: { platform?: Platform; capabilities?: Partial<Record<PlatformFeature, boolean>> } | null | undefined,
  feature: PlatformFeature
): boolean {
  if (!account) return supports(undefined, feature);
  const cap = account.capabilities?.[feature];
  if (typeof cap === "boolean") return cap;
  return supports(account.platform, feature);
}

/** Human label for a platform, for UI copy. */
export function platformLabel(platform: Platform | undefined): string {
  return platform === "fansly" ? "Fansly" : "OnlyFans";
}
