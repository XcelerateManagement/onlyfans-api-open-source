// Use empty string to make requests relative (proxied via next.config.js rewrites)
const BASE_URL = "";

/** A 2FA factor OnlyFans will accept for an account, in UI-offer order. */
export type TwoFactorMethod = "app" | "email" | "sms" | "face";

/**
 * Where an OnlyFans face (selfie) check stands for one account.
 *
 * `status` values:
 *   pending  — a check was started here and the server is watching for it
 *   approved — OnlyFans answers for this account again
 *   timeout  — the watch window expired without the gate lifting
 *   error    — the watch stopped for another reason (proxy died, session died)
 *   required — flagged as gated, but nothing is watching (e.g. after a restart)
 *   clear    — no gate
 */
export interface FaceIdStatus {
  of_user_id: string;
  status: "pending" | "approved" | "timeout" | "error" | "required" | "clear";
  detail?: string | null;
  redirect_url?: string | null;
  required_since?: string | null;
  otp_state?: Record<string, unknown> | null;
  elapsed_seconds?: number;
  expires_in_seconds?: number;
}

export type EarningsPlatform = "onlyfans" | "fansly";

/** Mirror of `GET /earnings/summary`. Money is net of platform fees; period
 *  bounds and every `*_at` without an offset are UTC. Optional fields are
 *  absent on older backends. */
export interface EarningsSummary {
  total: number;
  prev_total: number;
  /** Previous period up to the same elapsed point (null for custom ranges). */
  prev_total_to_date?: number | null;
  by_category: Record<string, number>;
  by_category_platform?: Record<string, Partial<Record<EarningsPlatform, number>>>;
  by_platform?: Partial<
    Record<
      EarningsPlatform,
      {
        total: number;
        prev_total: number;
        prev_total_to_date: number | null;
        /** In `total` but in no category (unmapped transaction types). */
        uncategorized: number;
        transactions: number;
        accounts: number;
        stale: number;
        never_synced: number;
        connection_errors: number;
        oldest_sync_at: string | null;
      }
    >
  >;
  new_subs?: {
    count: number;
    renewals: number;
    prev_count: number;
    prev_renewals: number;
    by_platform: Partial<
      Record<
        EarningsPlatform,
        {
          count: number;
          renewals: number;
          prev_count: number;
          prev_renewals: number;
          accounts: number;
          accounts_tracked: number;
          oldest_sync_at: string | null;
        }
      >
    >;
    accounts: number;
    accounts_tracked: number;
    accounts_never_synced: number;
    oldest_sync_at: string | null;
  } | null;
  chart: number[];
  chart_days?: string[];
  accounts_count: number;
  transactions_counted: number;
  transactions_capped: boolean;
  period: string;
  source?: string;
  accounts_stale?: number;
  accounts_never_synced?: number;
  oldest_sync_at?: string | null;
  /** When the server built this body (a cached response keeps its stamp). */
  computed_at?: string;
  period_start?: string;
  period_end?: string;
  cached: boolean;
  /** Panels with a Fansly account only. A wallet snapshot — never part of
   *  `total`, the trend or the category split. */
  fansly_balance?: {
    /** Whole earnings wallet, including earnings still on hold. */
    current: number;
    /** Withdrawable now. */
    available: number;
    /** On hold. */
    pending: number;
    accounts: number;
    sampled: number;
    pending_sampled: number;
    oldest_sample_at: string | null;
    newest_sample_at: string | null;
  };
  /** @deprecated Same number as `fansly_balance.available`. Never inside `total`. */
  fansly_balance_floor?: number;
  fansly_accounts?: number;
  fansly_balance_sampled?: number;
}

export interface SubscribersCacheStatus {
  total: number;
  active: number;
  expired: number;
  /** number of fans with non-zero lifetime spend */
  spenders?: number;
  /** sum of per-fan lifetime spend (canonical, from OF's subscribedOnData.totalSumm) */
  total_spent_sum?: number;
  /** per-channel breakdown (also lifetime, canonical) */
  breakdown?: {
    tips: number;
    messages: number;
    posts: number;
    streams: number;
    subscriptions: number;
  };
  /** ISO timestamp of the most recent row upsert */
  last_row_synced_at: string | null;
  /** ISO timestamp of the last full refresh attempt that finished successfully */
  last_refreshed_at: string | null;
  consecutive_failures: number;
}

/** Mirror of backend refresh_state.RefreshJobState.to_payload().
 *  `crm_id` is intentionally absent — the SSE channel is already scoped. */
export interface RefreshJobState {
  job_id: string;
  of_user_id: string;
  kind: "subs" | "tx" | "campaigns";
  phase:
    | "counting"
    | "fetching"
    | "upserting"
    | "caught_up"
    | "window_exhausted"
    | "no_more"
    | "page_cap"
    | "error"
    | "complete";
  pages_done: number;
  pages_est: number | null;
  rows_inserted: number;
  rows_updated: number;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
  success?: boolean | null;
  stopped_reason?: string | null;
  error?: string | null;
  duration_seconds?: number | null;
}

/** Per-campaign earnings row returned by GET /campaigns/earnings. */
export interface CampaignEarnings {
  campaign_id: string | number;
  claimers_count: number;
  /** Claimers for whom we have a subscribers_cache row (and thus real spend). */
  mapped_claimers_count: number;
  /** Sum of subs_cache.total_spent for this campaign's mapped claimers. */
  total_spent: number;
  /** mapped / total × 100 — tells the UI whether the earnings number can be
   *  trusted yet or a subs refresh is still pending. */
  coverage_pct: number;
}

export interface CampaignsCacheStatus {
  campaigns: number;
  claimers: number;
  last_row_synced_at: string | null;
  last_refreshed_at: string | null;
  consecutive_failures: number;
}

export interface TransactionsCacheStatus {
  total: number;
  /** Gross amount summed across the cached window (raw, pre-chargeback) */
  total_amount: number;
  /** Creator's net after fees/VAT */
  total_net: number;
  /** ISO of the oldest cached tx (bounds the delta answer) */
  oldest: string | null;
  /** ISO of the newest cached tx */
  newest: string | null;
  /** [{tx_type, n, amt}] */
  by_type: Array<{ tx_type: string; n: number; amt: number }>;
  last_refreshed_at: string | null;
  consecutive_failures: number;
  /** OF's marker for the most recent tx we've seen — used to resume delta walks */
  last_tx_marker: string | null;
}

export class ApiError extends Error {
  status: number;
  data: any;
  /** Seconds the caller should wait before retrying, when the server said so
   *  (429 `Retry-After` header or the backend's `retry_after` body field). */
  retryAfter: number | null;
  constructor(status: number, data: any, retryAfter: number | null = null) {
    super(data?.error || `Request failed with status ${status}`);
    this.status = status;
    this.data = data;
    this.retryAfter = retryAfter;
  }

  /** The panel burned through its per-minute quota. Distinct from "no data". */
  get isRateLimit(): boolean {
    return this.status === 429;
  }

  /** The request never produced a usable answer — as opposed to producing an
   *  empty one. Anything that renders an empty state MUST check this first,
   *  otherwise a 429 or a dead backend reads to the operator as "you have
   *  nothing connected". */
  get isTransport(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** True for any thrown value that means "the fetch failed", including the
 *  network-level ApiError(0) the client synthesises. Use this to gate empty
 *  states so a failure is never rendered as legitimate emptiness. */
export function isFetchFailure(err: unknown): boolean {
  return err instanceof ApiError && err.isTransport;
}

// ── Rate-limit broadcast ─────────────────────────────────────────────────────
// Every 429 from any page is announced here so a single subscriber (the
// dashboard-wide banner) can tell the operator what happened. Pages don't have
// to opt in — going through CrmApiClient is enough.

export interface RateLimitNotice {
  /** Path that tripped the limit, e.g. "/accounts". */
  path: string;
  /** Seconds to wait, when the server told us. */
  retryAfter: number | null;
  /** Epoch ms when it happened. */
  at: number;
}

type RateLimitListener = (notice: RateLimitNotice) => void;
const rateLimitListeners = new Set<RateLimitListener>();

export function subscribeToRateLimit(fn: RateLimitListener): () => void {
  rateLimitListeners.add(fn);
  return () => {
    rateLimitListeners.delete(fn);
  };
}

function announceRateLimit(notice: RateLimitNotice): void {
  for (const fn of rateLimitListeners) {
    try {
      fn(notice);
    } catch {
      // A broken listener must never break the request that triggered it.
    }
  }
}

// ── Writes-disabled broadcast ───────────────────────────────────────────────
// Same shape as the rate-limit broadcast above, and the same reason: a write
// refused with `403 WRITES_DISABLED` can be triggered from many pages (send a
// DM, mass DM, create a campaign, set a price, request a payout). Rather than
// each page importing a handler, the client announces it once and a single
// subscriber (WritesDisabledWatcher, mounted in the dashboard layout) shows the
// one-click "Enable writes" toast. Pages don't opt in.

export interface WritesDisabledNotice {
  /** The account the write was refused for, parsed from the request path. */
  ofUserId: string | null;
  /** Path that was refused, e.g. "/accounts/123/messages/mass". */
  path: string;
  /** Epoch ms when it happened. */
  at: number;
}

type WritesDisabledListener = (notice: WritesDisabledNotice) => void;
const writesDisabledListeners = new Set<WritesDisabledListener>();

export function subscribeToWritesDisabled(fn: WritesDisabledListener): () => void {
  writesDisabledListeners.add(fn);
  return () => {
    writesDisabledListeners.delete(fn);
  };
}

function announceWritesDisabled(notice: WritesDisabledNotice): void {
  for (const fn of writesDisabledListeners) {
    try {
      fn(notice);
    } catch {
      // A broken listener must never break the request that triggered it.
    }
  }
}

/** Pull the `{of_user_id}` out of an account-scoped path. Every write gate in
 *  crm_api.py lives under `/accounts/{of_user_id}/…`, so this resolves the
 *  account the enable-writes toggle must target. */
function accountIdFromPath(path: string): string | null {
  const m = path.match(/\/accounts\/([^/?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Pull a wait-in-seconds out of a `Retry-After` header (delta-seconds or an
 *  HTTP-date) or the backend's `retry_after` body field, which flask-limiter
 *  fills with a human string like "600 per 1 minute". */
function parseRetryAfter(headerValue: string | null, body: any): number | null {
  if (headerValue) {
    const secs = Number(headerValue);
    if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
    const when = Date.parse(headerValue);
    if (Number.isFinite(when)) {
      return Math.max(0, Math.ceil((when - Date.now()) / 1000));
    }
  }
  const fromBody = body?.retry_after;
  if (typeof fromBody === "number" && Number.isFinite(fromBody)) {
    return Math.ceil(fromBody);
  }
  return null;
}

/**
 * True when an error is the backend's canonical 501
 * `{"code": "platform_not_supported", "feature": ..., "platform": ...}`
 * response (platform_features.unsupported_response). Pages should map this to
 * `platformUnsupportedMessage(...)` instead of toasting the raw backend string.
 */
export function isPlatformNotSupported(err: unknown): err is ApiError {
  return err instanceof ApiError && err.data?.code === "platform_not_supported";
}

/**
 * True when a write was refused because the account's `allow_of_write_actions`
 * toggle is off — the backend's `403 {"code": "WRITES_DISABLED"}` (returned by
 * every OnlyFans/Fansly write gate in crm_api.py).
 *
 * The dashboard does not need to call this per page: `request()` detects the
 * code centrally, rewrites the raw PATCH-snippet message, and broadcasts via
 * `announceWritesDisabled` so the single `WritesDisabledWatcher` can show a
 * one-click "Enable writes" toast (components/dashboard/WritesDisabledToast).
 * This predicate is exported for any caller that still wants to branch on the
 * code directly.
 */
export function isWritesDisabled(err: unknown): err is ApiError {
  return err instanceof ApiError && err.data?.code === "WRITES_DISABLED";
}

/**
 * Friendly copy for a feature a platform can't serve — the single place that
 * turns a `platform_not_supported` ApiError into user-facing text. Pass the
 * backend-emitted `err.data.feature` / `err.data.platform` when available:
 *
 *   if (isPlatformNotSupported(err)) {
 *     toast(platformUnsupportedMessage(err.data?.feature, err.data?.platform));
 *   }
 */
export function platformUnsupportedMessage(
  feature?: string | null,
  platform?: string | null
): string {
  const label =
    platform === "fansly"
      ? "Fansly"
      : platform === "onlyfans"
        ? "OnlyFans"
        : "this platform";
  const what = feature ? feature.replace(/_/g, " ") : "";
  return what
    ? `${what.charAt(0).toUpperCase()}${what.slice(1)} isn't available on ${label} yet.`
    : `Not available on ${label} yet.`;
}

// ── Request metrics (api_metrics.py) ────────────────────────────────────────
// `GET /metrics/requests` (own panel) and `GET /api/admin/metrics/requests`
// (all tenants) return an IDENTICAL payload, so one component renders either.

export type MetricsGranularity = "5m" | "15m" | "1h" | "6h" | "1d";

/** One time bucket. Zero-filled and oldest-first by the backend — do NOT
 *  re-fill client-side. In an empty bucket every count is 0 but
 *  `avg_latency_ms` is deliberately `null` (a latency of zero would be a lie),
 *  so a latency chart must draw a GAP there rather than a drop to zero. */
export interface MetricsBucket {
  bucket: string;
  total: number;
  "1xx": number;
  "2xx": number;
  "3xx": number;
  "4xx": number;
  "5xx": number;
  errors: number;
  /** Fraction 0–1, 6dp — multiply for a percentage. */
  error_rate: number;
  avg_latency_ms: number | null;
  max_latency_ms: number;
  slow_requests: number;
}

/** Per-route rollup. Shared by top_routes / slowest_routes / top_error_routes. */
export interface MetricsRouteRow {
  route: string;
  method: string;
  requests: number;
  errors: number;
  client_errors: number;
  server_errors: number;
  /** Fraction 0–1. */
  error_rate: number;
  avg_latency_ms: number | null;
  max_latency_ms: number;
  slow_requests: number;
}

export interface ApiErrorRow {
  id: number;
  occurred_at: string;
  route: string;
  method: string;
  path?: string | null;
  status_code: number;
  latency_ms?: number | null;
  error_code?: string | null;
  message?: string | null;
  body?: string | null;
  of_user_id?: string | null;
  reported?: boolean;
  report_note?: string | null;
}

export interface RequestMetrics {
  range: {
    since: string;
    until: string;
    hours: number;
    granularity: MetricsGranularity;
    bucket_seconds: number;
    buckets: number;
    crm_id: string | null;
  };
  totals: {
    requests: number;
    errors: number;
    client_errors: number;
    server_errors: number;
    /** Fractions 0–1. */
    error_rate: number;
    server_error_rate: number;
    /** null when there were no requests at all in the window. */
    avg_latency_ms: number | null;
    max_latency_ms: number;
    slow_requests: number;
    slow_rate: number;
    /** Requests at or above this many ms count as `slow_requests`. */
    slow_threshold_ms: number;
  };
  series: MetricsBucket[];
  status_codes: Array<{ status: number; status_class: string; count: number }>;
  top_routes: MetricsRouteRow[];
  slowest_routes: MetricsRouteRow[];
  top_error_routes: MetricsRouteRow[];
  /** Always [] on the tenant-scoped route — treat empty as "not applicable to
   *  this caller", never as "no traffic". */
  top_tenants: Array<{
    crm_id: string | null;
    requests: number;
    errors: number;
    server_errors: number;
    error_rate: number;
  }>;
  collector: {
    recorded: number;
    dropped: number;
    flushed_rows: number;
    pending_buckets: number;
    pending_requests: number;
    last_flush_at: string | null;
    last_flush_error: string | null;
    bucket_seconds: number;
    slow_ms: number;
    retention_days: number;
    enabled: boolean;
  };
}

export type ExportStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "canceled"
  | "expired";

/** One "Download your data" job. Mirrors the backend export_jobs row. */
export interface ExportJob {
  job_id: string;
  of_user_id: string;
  platform?: string | null;
  status: ExportStatus;
  phase?: string | null;
  data_types: string[];
  since?: string | null;
  until?: string | null;
  include_media: boolean;
  counts?: Record<string, any> | null;
  warnings?: Array<{ phase: string; error: string }> | null;
  file_name?: string | null;
  file_size?: number | null;
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  expires_at?: string | null;
}

// ── Bulk account import ──────────────────────────────────────────────────────
// A paste of up to 1000 `email,password,platform,proxy,totp_secret` rows becomes
// one job; the backend logs in to each account in the background. The two things
// that shape this contract: a row that needs a 2FA code must PARK rather than
// block the other 599, and the panel must be able to find those parked rows
// again after the operator navigates away.

/** Hard limits the backend enforces. Mirrored client-side so an over-long paste
 *  is refused before it is sent, not after. */
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Lifecycle of one pasted line.
 *
 *   pending → running → success | needs_2fa | failed
 *                          ↓ (code submitted)   ↑ (retry)
 *                        running
 *
 * Terminal-ish extras: `invalid` (never attempted — the line didn't parse),
 * `skipped` (already connected), `slot_exhausted` (no subscription slot left),
 * `needs_2fa_expired` (the 600s OTP window closed — needs a full re-login, not
 * a code) and `canceled`.
 */
export type ImportRowState =
  | "pending"
  | "running"
  | "success"
  | "needs_2fa"
  | "needs_2fa_expired"
  | "failed"
  | "canceled"
  | "invalid"
  | "skipped"
  | "slot_exhausted";

export type ImportJobStatus =
  | "queued"
  | "running"
  | "complete"
  | "canceled"
  | "failed";

/** Per-state tallies. Always present on a job; the progress bar reads only this
 *  so it stays correct without holding every row in memory. */
export type ImportCounts = Partial<Record<ImportRowState, number>> & {
  total?: number;
};

/**
 * One normalized row from `/import/preview`. NOTE what is not here: the
 * password and the TOTP secret. The server echoes neither — only whether each
 * was supplied — because this table is the screen operators screenshot.
 */
export interface ImportPreviewRow {
  /** 1-based line in the pasted text, so an error points at something real. */
  line: number;
  email: string | null;
  /** Whether a non-empty password was parsed off this line. */
  has_password: boolean;
  platform: string | null;
  /** Masked by the server (host kept, credentials starred), or null. */
  proxy: string | null;
  /** Whether a TOTP secret was supplied. When false the operator will have to
   *  type a code by hand for this account — the single most useful thing to
   *  learn at preview time rather than 20 minutes into a 600-row run. */
  has_totp_secret: boolean;
  /** What will happen: `pending` = will be attempted. */
  state: Extract<
    ImportRowState,
    "pending" | "invalid" | "skipped" | "slot_exhausted"
  >;
  /** Blocking problems — a row with any of these is not attempted. */
  errors?: string[] | null;
  /** Non-blocking notes (e.g. "already connected — will be skipped"). */
  warnings?: string[] | null;
}

export interface ImportPreviewResponse {
  success: boolean;
  rows: ImportPreviewRow[];
  counts: ImportCounts;
  /** What the parser decided, echoed back so the operator can see that their
   *  semicolons/tabs were understood. */
  detected?: {
    delimiter?: string | null;
    has_header?: boolean;
    columns?: string[] | null;
  } | null;
  /** Rows that would be attempted but have no TOTP secret — each will park on
   *  `needs_2fa` and wait for a hand-typed code. */
  needs_manual_2fa?: number;
  limits?: { max_rows?: number; max_bytes?: number } | null;
  /** Subscription headroom, when the backend reports it. */
  slots_available?: number | null;
  /** True when the paste was cut off at max_rows. */
  truncated?: boolean;
}

/** One row of a created job. Same redaction rules as the preview row. */
export interface ImportJobRow {
  row_id: string;
  line: number;
  email: string | null;
  platform: string | null;
  state: ImportRowState;
  /** Human-readable failure reason, or null. */
  error?: string | null;
  /** Set once the login succeeds. */
  of_user_id?: string | null;
  username?: string | null;
  has_totp_secret?: boolean;
  /** ISO deadline for the parked OTP window. After this the row needs `retry`,
   *  not a code — the UI counts down to it and hard-swaps the input for a
   *  re-login button when it passes. */
  otp_expires_at?: string | null;
  attempts?: number;
  updated_at?: string | null;
}

/** A single state change, used for the "recent activity" tail. The backend
 *  coalesces progress to ~1/s and ships a short tail rather than an event per
 *  row, because SSE drops on queue overflow and per-row streaming would lose
 *  exactly the transitions that matter. */
export interface ImportTransition {
  row_id: string;
  line?: number;
  email?: string | null;
  from?: ImportRowState | null;
  to: ImportRowState;
  at?: string | null;
  error?: string | null;
}

export interface ImportJob {
  job_id: string;
  status: ImportJobStatus;
  total: number;
  counts: ImportCounts;
  created_at: string;
  updated_at?: string | null;
  completed_at?: string | null;
  label?: string | null;
  error?: string | null;
}

export interface ImportJobDetail {
  success: boolean;
  job: ImportJob;
  rows: ImportJobRow[];
  counts: ImportCounts;
  /** Present when the server paginated `rows`. */
  total_rows?: number;
  recent?: ImportTransition[] | null;
}

/** Payload of the coalesced `import.progress` / `import.complete` SSE event. */
export interface ImportProgressEvent {
  job_id: string;
  status: ImportJobStatus;
  counts: ImportCounts;
  total?: number;
  recent?: ImportTransition[] | null;
  updated_at?: string;
}

/** Panel-wide parked-2FA state — the thing that survives closing the importer. */
export interface PendingTwoFactorResponse {
  success: boolean;
  count: number;
  rows: Array<
    ImportJobRow & {
      job_id: string;
    }
  >;
}

export type TelegramBotMode = "shared" | "custom";

/** Mirror of crm_api._telegram_public(). Note what is NOT here: the bot token.
 *  It is encrypted at rest and no endpoint returns it, masked or otherwise. */
export interface TelegramIntegration {
  bot_mode: TelegramBotMode;
  /** whether a custom token is stored — never the token itself */
  has_custom_token: boolean;
  bot_username: string | null;
  chat_id: string | null;
  chat_title: string | null;
  chat_type: string | null;
  event_types: string[];
  is_active: boolean;
  is_paired: boolean;
  consecutive_failures: number;
  last_delivery_at: string | null;
  last_error: string | null;
  paired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramIntegrationResponse {
  success: boolean;
  integration: TelegramIntegration | null;
  /** false when the deployment has no shared bot configured — the UI must
   *  then offer only the "bring your own bot" path. */
  shared_bot_available: boolean;
  shared_bot_username: string | null;
  event_types: string[];
}

export class CrmApiClient {
  private crmId: string;

  /**
   * The constructor no longer takes an `apiKey`. The browser never holds the
   * key — every call goes to `/api/crm/<crm_id>/...` on this origin, which is
   * a server-side proxy (app/api/crm/[...path]/route.ts) that reads the key
   * from the signed JWT and attaches `X-API-Key` upstream.
   */
  constructor(crmId: string) {
    this.crmId = crmId;
  }

  private async request<T = any>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const baseHeaders: Record<string, string> = {};
    // Only advertise JSON when there's actually a body — Flask/Werkzeug 400s
    // on Content-Type: application/json with an empty body.
    if (options?.body != null) baseHeaders["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/api/crm/${this.crmId}${path}`, {
        ...options,
        // Cookies must be sent so the proxy can read the NextAuth JWT.
        credentials: "same-origin",
        headers: {
          ...baseHeaders,
          ...options?.headers,
        },
      });
    } catch (e: any) {
      throw new ApiError(0, { error: e.message || "Network error — unable to reach the API server" });
    }

    const text = await res.text();
    let data: any;
    let parsed = true;
    try {
      data = JSON.parse(text);
    } catch {
      parsed = false;
    }

    // 429 first, and before the JSON check: flask-limiter answers with JSON
    // (`{error, retry_after}`) but an upstream proxy may not, and either way
    // "you are rate limited" must never degrade into the generic "server
    // error" copy — that is what made an exhausted quota look like an empty
    // panel. Announce it so the dashboard-wide banner can say so once.
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"), parsed ? data : null);
      announceRateLimit({ path, retryAfter, at: Date.now() });
      const wait = retryAfter ? ` Try again in ${retryAfter}s.` : " Try again shortly.";
      throw new ApiError(
        429,
        {
          ...(parsed && data ? data : {}),
          error: `Rate limit reached — too many requests to the API.${wait}`,
        },
        retryAfter
      );
    }

    if (!parsed) {
      // Server returned non-JSON (e.g. HTML error page). Cloudflare swaps any
      // origin 502/504 for its own page, so the backend may be up and have
      // answered with a real error that never reached us — don't claim "down".
      if (res.status === 502 || res.status === 504) {
        throw new ApiError(res.status, {
          error: `The request failed at the gateway (HTTP ${res.status}). The server may have hit an upstream error. Try again; if it keeps happening, contact support.`,
        });
      }
      if (res.status === 503) {
        throw new ApiError(res.status, { error: "API server is temporarily unavailable. Please try again." });
      }
      if (res.status === 404) {
        throw new ApiError(404, { error: "API endpoint not found. The server may be starting up." });
      }
      throw new ApiError(res.status, { error: `Server error (${res.status}). The API may be down or misconfigured.` });
    }

    // Writes-disabled: the backend's raw `error` is a copy-paste PATCH snippet
    // for API callers. In the dashboard, announce it so the global watcher can
    // show a one-click "Enable writes" toast, and rewrite the message so the
    // curl instruction never reaches a page's generic error toast. Same shape
    // of handling as the 429 branch above.
    if (res.status === 403 && data?.code === "WRITES_DISABLED") {
      const ofUserId = accountIdFromPath(path);
      announceWritesDisabled({ ofUserId, path, at: Date.now() });
      throw new ApiError(403, {
        ...data,
        error: "Writes are turned off for this account.",
      });
    }

    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  // ── Accounts ──────────────────────────────────────────────

  /**
   * List the panel's accounts. `search` (username / email / exact of_user_id)
   * and `tag` are applied SERVER-side — at ~600 accounts, shipping the whole
   * list on every keystroke to filter it in the browser is the thing the
   * filter exists to avoid.
   *
   * `all_tags` is the panel's whole tag universe and is computed before
   * filtering, so a tag dropdown built from it keeps every option after one is
   * chosen. Each account carries its own `tags` — no per-account request.
   */
  async getAccounts(opts?: { search?: string; tag?: string }) {
    const p = new URLSearchParams();
    if (opts?.search) p.set("search", opts.search);
    if (opts?.tag) p.set("tag", opts.tag);
    return this.request<{
      success: boolean;
      count: number;
      accounts: any[];
      all_tags?: string[];
    }>(`/accounts${p.toString() ? `?${p}` : ""}`);
  }

  async addAccountTag(ofUserId: string, tag: string) {
    return this.request<{ success: boolean; tag: string }>(
      `/accounts/${ofUserId}/tags`,
      { method: "POST", body: JSON.stringify({ tag }) }
    );
  }

  async removeAccountTag(ofUserId: string, tag: string) {
    return this.request<{ success: boolean }>(
      `/accounts/${ofUserId}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" }
    );
  }

  async loginAccount(
    email: string,
    password: string,
    options?: {
      proxy?: string;
      use_captcha?: boolean;
      platform?: "onlyfans" | "fansly";
    }
  ) {
    return this.request<{
      success?: boolean;
      requires_2fa?: boolean;
      requires_verification?: boolean;
      needs_verification?: boolean;
      /** "otp_required" (a code factor) | "face_id_required" (forced selfie). */
      reason?: string;
      /** true when OnlyFans forces the face factor — a typed code can't clear it. */
      face_required?: boolean;
      otp_state?: Record<string, unknown> | string;
      otp_methods?: TwoFactorMethod[];
      email?: string;
      of_user_id?: string;
      username?: string;
      platform?: "onlyfans" | "fansly";
      error?: string;
    }>("/accounts/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        platform: options?.platform ?? "onlyfans",
        use_captcha: options?.use_captcha ?? true,
        proxy: options?.proxy,
      }),
    });
  }

  // Connect a Fansly account with a pasted auth token (the Fansly analogue of
  // OF cookie login). The device id is optional — the backend mints one.
  async loginFanslyToken(options: {
    auth_token: string;
    fansly_session_id: string;
    fansly_client_id?: string;
    proxy?: string;
  }) {
    return this.request<{
      success?: boolean;
      of_user_id?: string;
      username?: string;
      email?: string;
      platform?: "fansly";
      login_method?: string;
      error?: string;
    }>("/accounts/login/cookies", {
      method: "POST",
      body: JSON.stringify({
        platform: "fansly",
        auth_token: options.auth_token,
        fansly_session_id: options.fansly_session_id,
        fansly_client_id: options.fansly_client_id,
        proxy: options.proxy,
      }),
    });
  }

  async verifyOtp(
    email: string,
    otpCode: string,
    platform: "onlyfans" | "fansly" = "onlyfans"
  ) {
    return this.request<{
      success: boolean;
      of_user_id?: string;
      username?: string;
      email?: string;
      platform?: "onlyfans" | "fansly";
      error?: string;
    }>("/accounts/login/verify-otp", {
      method: "POST",
      body: JSON.stringify({ email, otp_code: otpCode, platform }),
    });
  }

  // ── Notifications ─────────────────────────────────────────

  async getNotifications(ofUserId: string, limit = 20) {
    return this.request<{
      success: boolean;
      count: number;
      notifications: any[];
    }>(`/accounts/${ofUserId}/notifications?limit=${limit}`);
  }

  // ── Balances ──────────────────────────────────────────────

  async getBalances(ofUserId: string) {
    return this.request<{
      success: boolean;
      balances: any;
    }>(`/accounts/${ofUserId}/balances`);
  }

  // ── Earnings ──────────────────────────────────────────────

  async getEarnings(
    ofUserId: string,
    startDate: string,
    endDate?: string
  ) {
    const params = new URLSearchParams({ startDate });
    if (endDate) params.set("endDate", endDate);
    return this.request<{
      success: boolean;
      earnings: any;
    }>(`/accounts/${ofUserId}/earnings?${params.toString()}`);
  }

  // ── Campaigns ─────────────────────────────────────────────

  async getCampaigns(ofUserId: string, limit = 10, offset = 0) {
    return this.request<{
      success: boolean;
      campaigns: any[];
      hasMore: boolean;
    }>(
      `/accounts/${ofUserId}/campaigns?limit=${limit}&offset=${offset}`
    );
  }

  async createCampaign(ofUserId: string, name: string) {
    return this.request(`/accounts/${ofUserId}/campaigns`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  async getCampaignClaimers(
    ofUserId: string,
    campaignId: string,
    limit = 10,
    offset = 0
  ) {
    return this.request<{
      success: boolean;
      claimers: any[];
      hasMore: boolean;
      count: number;
    }>(
      `/accounts/${ofUserId}/campaigns/${campaignId}/claimers?limit=${limit}&offset=${offset}`
    );
  }

  // ── API keys (multi-key console) ──────────────────────────
  // Panel-level. All go through the JWT proxy, which attaches the PRIMARY key —
  // create/revoke are primary-key-only on the backend.

  /** List all keys for the panel, each with this-month count + 30-day series. */
  async listApiKeys() {
    return this.request<{
      success: boolean;
      keys: Array<{
        id: number;
        name: string;
        prefix: string;
        is_primary: boolean;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
        requests_this_month: number;
        requests_all_time: number;
        series: number[];
      }>;
    }>(`/api-keys`);
  }

  /** Mint a new secondary key. Returns the full `api_key` ONCE — show it now. */
  async createApiKey(name: string) {
    return this.request<{
      success: boolean;
      id: number;
      name: string;
      prefix: string;
      api_key: string;
      created_at: string;
    }>(`/api-keys`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }

  /** Revoke a secondary key (primary is non-revocable). */
  async revokeApiKey(keyId: number) {
    return this.request<{ success: boolean }>(`/api-keys/${keyId}`, {
      method: "DELETE",
    });
  }

  /** Per-key usage detail: time-series + totals + endpoint breakdown. */
  async getApiKeyUsage(keyId: number, days = 30) {
    return this.request<{
      success: boolean;
      key: {
        id: number;
        name: string;
        prefix: string;
        is_primary: boolean;
        created_at: string;
        last_used_at: string | null;
        revoked_at: string | null;
      };
      totals: {
        month_total: number;
        all_time_total: number;
        last_used_at: string | null;
        month: string;
      };
      series: Array<{ day: string; count: number }>;
      endpoints: Array<{ endpoint: string; count: number }>;
    }>(`/api-keys/${keyId}/usage?days=${days}`);
  }

  /**
   * Per-request outcomes for this panel: volume, status classes, error rate,
   * latency, worst routes. ONE query against local counters — nothing here
   * scales with the number of connected accounts.
   *
   * `hours` 1–2160, `limit` 1–50. Omit `granularity` and the backend picks it
   * from the range (5m ≤6h, 1h ≤48h, 6h ≤14d, else 1d); an unknown value is a
   * 400. Note `/events/stream` is excluded from collection entirely — one
   * long-lived SSE connection would poison every latency figure — so these are
   * not literally "every request".
   */
  async getRequestMetrics(opts?: {
    hours?: number;
    granularity?: MetricsGranularity;
    limit?: number;
  }) {
    const p = new URLSearchParams();
    if (opts?.hours != null) p.set("hours", String(opts.hours));
    if (opts?.granularity) p.set("granularity", opts.granularity);
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    const qs = p.toString();
    return this.request<{ success: boolean; metrics: RequestMetrics }>(
      `/metrics/requests${qs ? `?${qs}` : ""}`
    );
  }

  /** The individual failures behind the error-rate number.
   *
   *  /metrics/requests stores counters, so it can say how many failed but never
   *  what happened. This returns the logged rows with their response bodies.
   *  `reporting_available` is false when the server has no ops chat configured
   *  — surface that rather than offering a report button that drops the report. */
  async getRecentErrors(opts?: { limit?: number; statusClass?: "4xx" | "5xx" }) {
    const p = new URLSearchParams();
    if (opts?.limit != null) p.set("limit", String(opts.limit));
    if (opts?.statusClass) p.set("status_class", opts.statusClass);
    const qs = p.toString();
    return this.request<{
      success: boolean;
      errors: ApiErrorRow[];
      count: number;
      reporting_available: boolean;
    }>(`/errors/recent${qs ? `?${qs}` : ""}`);
  }

  /** Send one logged failure to the operations channel. The destination lives
   *  entirely server-side — the caller supplies a note, never a chat. */
  async reportError(errorId: number, note?: string) {
    return this.request<{ success: boolean; reported: boolean }>(
      `/errors/${errorId}/report`,
      { method: "POST", body: JSON.stringify(note ? { note } : {}) },
    );
  }

  /** Panel-wide monthly quota + slot consumption. One local query on the
   *  backend, no upstream calls — safe to put on the Overview. An
   *  `api_calls_limit` of -1 means unlimited. */
  async getUsage() {
    return this.request<{
      success: boolean;
      crm_id: string;
      plan: string;
      api_calls_used: number;
      api_calls_limit: number;
      accounts_used: number;
      accounts_limit: number;
      month: string;
    }>(`/usage`);
  }

  // ── Campaign tags ─────────────────────────────────────────
  // Mirror addFanTag/removeFanTag. Campaigns are OF-side with no local row, so
  // tags live in a backend campaign_tags table keyed by campaign_id.

  /** Bulk-fetch tags for every tagged campaign on this account, plus the
   *  distinct tag universe for building a filter dropdown. */
  async getCampaignTags(ofUserId: string) {
    return this.request<{
      success: boolean;
      tags: Record<string, string[]>;
      all_tags: string[];
    }>(`/accounts/${ofUserId}/campaign-tags`);
  }

  async addCampaignTag(ofUserId: string, campaignId: string, tag: string) {
    return this.request<{ success: boolean }>(
      `/accounts/${ofUserId}/campaigns/${campaignId}/tags`,
      { method: "POST", body: JSON.stringify({ tag }) }
    );
  }

  async removeCampaignTag(ofUserId: string, campaignId: string, tag: string) {
    return this.request<{ success: boolean }>(
      `/accounts/${ofUserId}/campaigns/${campaignId}/tags/${encodeURIComponent(tag)}`,
      { method: "DELETE" }
    );
  }

  // ── Account Management ────────────────────────────────────

  async deleteAccount(ofUserId: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/accounts/${ofUserId}`, {
      method: "DELETE",
    });
  }

  // ── Subscription Settings ─────────────────────────────────

  /** Read the account's current subscription price live from /users/me.
   *  `isFree` (price <= 0) gates tracking-link eligibility on the roster.
   *  Costs one OF call per invocation — fan out with care (quota). */
  async getSubscriptionPrice(ofUserId: string) {
    return this.request<{
      success: boolean;
      subscribePrice: number;
      isFree: boolean;
    }>(`/accounts/${ofUserId}/subscription-price`);
  }

  async updateSubscriptionPrice(ofUserId: string, subscribePrice: number) {
    return this.request<{
      success: boolean;
      data: any;
      subscribePrice: number;
    }>(`/accounts/${ofUserId}/subscription-price`, {
      method: "PATCH",
      body: JSON.stringify({ subscribePrice }),
    });
  }

  // ── Proxy Management ──────────────────────────────────────

  async updateProxy(ofUserId: string, proxy: string | null) {
    return this.request<{
      success: boolean;
      proxy: string | null;
    }>(`/accounts/${ofUserId}/proxy`, {
      method: "PATCH",
      body: JSON.stringify({ proxy }),
    });
  }

  async getProxy(ofUserId: string) {
    return this.request<{
      success: boolean;
      proxy: string | null;
    }>(`/accounts/${ofUserId}/proxy`);
  }

  // ── Face (selfie) verification ────────────────────────────
  // OnlyFans can gate an account behind a liveness check; until it passes,
  // every account-scoped call answers 403 {reason: "face_id_required"}.
  // `verify_url` must be opened from the account's own egress IP — OF ties the
  // check to the session's address, so a laptop on a different connection
  // fails it. See onlyfans-api/of_faceid.py.

  async startFaceId(ofUserId: string, source: "regular" | "banking" = "regular") {
    return this.request<{
      success: boolean;
      verify_url: string;
      source: string;
      proxy_country?: string | null;
      note?: string;
      status?: FaceIdStatus;
    }>(`/accounts/${ofUserId}/face-id/start`, {
      method: "POST",
      body: JSON.stringify({ source }),
    });
  }

  async getFaceIdStatus(ofUserId: string) {
    return this.request<{ success: boolean } & FaceIdStatus>(
      `/accounts/${ofUserId}/face-id/status`,
    );
  }

  async postponeFaceId(ofUserId: string) {
    return this.request<{ success: boolean }>(
      `/accounts/${ofUserId}/face-id/postpone`,
      { method: "POST" },
    );
  }

  // ── Per-account 2FA confirmation ──────────────────────────
  // An account behind an OnlyFans 2FA gate (error 101/105) is confirmed from
  // next to the account, whether the gate was raised at connect time or later
  // by a poll. `methods` drives which inputs the UI shows.

  async get2faStatus(ofUserId: string) {
    return this.request<{
      success: boolean;
      needs_2fa: boolean;
      reason: "face_id_required" | "otp_required" | null;
      methods: TwoFactorMethod[];
      otp_state: Record<string, unknown> | null;
      required_since: string | null;
      expires_in_seconds: number | null;
    }>(`/accounts/${ofUserId}/2fa/status`);
  }

  /** Ask OnlyFans to send a code (email/sms). No-op for the app factor. */
  async request2faCode(ofUserId: string, method: "email" | "sms") {
    return this.request<{ success: boolean; method: string; message: string }>(
      `/accounts/${ofUserId}/2fa/request-code`,
      { method: "POST", body: JSON.stringify({ method }) },
    );
  }

  async submit2fa(ofUserId: string, code: string) {
    return this.request<{
      success: boolean;
      of_user_id?: string;
      username?: string | null;
      message?: string;
    }>(`/accounts/${ofUserId}/2fa/submit`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  }

  // ── Payouts ───────────────────────────────────────────────

  async createPayoutRequest(ofUserId: string, withdrawalAmount: number) {
    return this.request<{
      success: boolean;
      request?: {
        amount?: number;
        createdAt?: string;
        currency?: string;
        invoiceId?: string;
        rejectReason?: string | null;
        state?: string;
      };
      data: any;
    }>(`/accounts/${ofUserId}/payout-requests`, {
      method: "POST",
      body: JSON.stringify({ withdrawal_amount: withdrawalAmount }),
    });
  }

  async getPayoutAccount(ofUserId: string) {
    return this.request<{
      success: boolean;
      account: any;
      check_receive: any;
      balances: any;
      can_withdraw: boolean;
      blockers: string[];
    }>(`/accounts/${ofUserId}/payout-account`);
  }

  async getPayoutRequests(
    ofUserId: string,
    options?: { startDate?: string; endDate?: string; limit?: number; offset?: number }
  ) {
    const params = new URLSearchParams();
    if (options?.startDate) params.set("startDate", options.startDate);
    if (options?.endDate) params.set("endDate", options.endDate);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    const qs = params.toString();
    return this.request<{
      success: boolean;
      requests: any[];
      count: number;
    }>(`/accounts/${ofUserId}/payout-requests${qs ? "?" + qs : ""}`);
  }

  // ── Purchases / Transactions ──────────────────────────────

  async getPurchases(
    ofUserId: string,
    startDate: string,
    options?: { marker?: string; limit?: number; offset?: number }
  ) {
    const params = new URLSearchParams({ startDate });
    if (options?.marker) params.set("marker", options.marker);
    if (options?.limit) params.set("limit", String(options.limit));
    // Fansly live-mode paging: wallet transactions page by offset, not by
    // OF-style markers. Harmless for OF (backend ignores it there).
    if (options?.offset) params.set("offset", String(options.offset));
    return this.request<{
      success: boolean;
      purchases: any[];
      marker: string | null;
      hasMore: boolean;
      nextMarker: string | null;
    }>(`/accounts/${ofUserId}/purchases?${params.toString()}`);
  }

  // ── Subscribers ───────────────────────────────────────────

  async getSubscribers(
    ofUserId: string,
    options?: { limit?: number; offset?: number; type?: string }
  ) {
    const params = new URLSearchParams();
    params.set("limit", String(options?.limit ?? 10));
    params.set("offset", String(options?.offset ?? 0));
    if (options?.type) params.set("type", options.type);
    return this.request<{
      success: boolean;
      list: any[];
      hasMore: boolean;
      count: number;
      /** Fansly only: type filtering is client-side within the page, so pagers
       *  must advance by this (raw rows consumed), not by list.length. */
      nextOffset?: number;
      /** Fansly only: stats.total from /api/v1/subscribers. */
      total?: number;
    }>(`/accounts/${ofUserId}/subscribers?${params.toString()}`);
  }

  /** Read subscribers from the local cache (populated by the weekly subs-refresh
   *  job + any manual refresh). Does not hit OF. */
  async getCachedSubscribers(
    ofUserId: string,
    options?: {
      limit?: number;
      offset?: number;
      type?: "all" | "active" | "expired";
      /** Server-side sort. `total_spent` is most useful ("who's the whale"). */
      sort?: "subscribed_at" | "total_spent" | "expired_at" | "username";
    }
  ) {
    const params = new URLSearchParams();
    params.set("limit", String(options?.limit ?? 100));
    params.set("offset", String(options?.offset ?? 0));
    if (options?.type) params.set("type", options.type);
    if (options?.sort) params.set("sort", options.sort);
    return this.request<{
      success: boolean;
      list: any[];
      count: number;
      total: number;
      hasMore: boolean;
      cache: SubscribersCacheStatus;
    }>(`/accounts/${ofUserId}/subscribers/cached?${params.toString()}`);
  }

  /** Kick off an async subscriber cache refresh. Returns immediately (202)
   *  with the initial RefreshJobState. The sync runs on the backend scheduler's
   *  threadpool; progress streams over /events/stream as `refresh.progress`
   *  and `refresh.complete`. Use `useRefreshJobs()` to render a live bar. */
  async refreshSubscribers(
    ofUserId: string,
    options?: { mode?: "delta" | "full" }
  ) {
    return this.request<{
      success: boolean;
      already_running?: boolean;
      state: RefreshJobState;
    }>(`/accounts/${ofUserId}/subscribers/refresh`, {
      method: "POST",
      body: JSON.stringify({ mode: options?.mode ?? "delta" }),
    });
  }

  async getSubscribersRefreshStatus(ofUserId: string) {
    return this.request<{
      success: boolean;
      cache: SubscribersCacheStatus;
    }>(`/accounts/${ofUserId}/subscribers/refresh/status`);
  }

  // ── Transactions (ledger cache) ─────────────────────────────────

  /** Kick off an async transaction cache refresh. Same response shape as
   *  refreshSubscribers (202 + RefreshJobState). Progress streams over SSE. */
  async refreshTransactions(
    ofUserId: string,
    options?: { mode?: "delta" | "initial"; days?: number; max_pages?: number }
  ) {
    return this.request<{
      success: boolean;
      already_running?: boolean;
      state: RefreshJobState;
    }>(`/accounts/${ofUserId}/transactions/refresh`, {
      method: "POST",
      body: JSON.stringify({
        mode: options?.mode ?? "delta",
        ...(options?.days !== undefined ? { days: options.days } : {}),
        ...(options?.max_pages !== undefined ? { max_pages: options.max_pages } : {}),
      }),
    });
  }

  // ── Campaigns / tracking links ──────────────────────────────────

  /** Kick off an async refresh that walks every non-empty campaign's claimers
   *  and upserts them into campaign_claimers_cache. Progress streams via SSE
   *  as `refresh.progress` with `kind=campaigns`. */
  async refreshAllCampaigns(ofUserId: string) {
    return this.request<{
      success: boolean;
      already_running?: boolean;
      state: RefreshJobState;
    }>(`/accounts/${ofUserId}/campaigns/refresh`, { method: "POST" });
  }

  async getCampaignsRefreshStatus(ofUserId: string) {
    return this.request<{
      success: boolean;
      cache: CampaignsCacheStatus;
    }>(`/accounts/${ofUserId}/campaigns/refresh/status`);
  }

  /** Per-campaign earnings from the cache-level JOIN. Zero OF calls. */
  async getCampaignsEarnings(ofUserId: string) {
    return this.request<{
      success: boolean;
      earnings: CampaignEarnings[];
      cache: CampaignsCacheStatus;
    }>(`/accounts/${ofUserId}/campaigns/earnings`);
  }

  /** Cached claimers for one campaign, already joined with subscribers_cache
   *  so rows carry `total_spent` + breakdown + `mapped_spent`. */
  async getCachedCampaignClaimers(
    ofUserId: string,
    campaignId: string | number,
    options?: { limit?: number; offset?: number }
  ) {
    const p = new URLSearchParams();
    if (options?.limit !== undefined) p.set("limit", String(options.limit));
    if (options?.offset !== undefined) p.set("offset", String(options.offset));
    const qs = p.toString() ? `?${p}` : "";
    return this.request<{
      success: boolean;
      list: any[];
      count: number;
      total: number;
      hasMore: boolean;
    }>(`/accounts/${ofUserId}/campaigns/${campaignId}/claimers/cached${qs}`);
  }

  // ── Fan drill-down ───────────────────────────────────────────────

  /** Force-refresh one fan's profile: single /users/{id} call, upserts into
   *  subscribers_cache if they're a subscriber. Sync (1-2s). */
  async refreshFanProfile(ofUserId: string, fanId: string | number) {
    return this.request<{
      success: boolean;
      fan: any;
      updated_cache: boolean;
      error?: string;
    }>(`/accounts/${ofUserId}/fans/${fanId}/refresh-profile`, {
      method: "POST",
    });
  }

  /** All cached transactions for one fan + their mapped_spent (signed sum). */
  async getCachedFanTransactions(
    ofUserId: string,
    fanId: string | number,
    options?: { limit?: number; offset?: number }
  ) {
    const p = new URLSearchParams();
    if (options?.limit !== undefined) p.set("limit", String(options.limit));
    if (options?.offset !== undefined) p.set("offset", String(options.offset));
    const qs = p.toString() ? `?${p}` : "";
    return this.request<{
      success: boolean;
      list: any[];
      count: number;
      total: number;
      mapped_spent: number;
      hasMore: boolean;
    }>(`/accounts/${ofUserId}/fans/${fanId}/transactions/cached${qs}`);
  }

  // ── Refresh coordination ───────────────────────────────────────

  /** Snapshot of every in-flight refresh job for this CRM. Called by the
   *  useRefreshJobs hook on mount so the UI re-hydrates after a page reload. */
  async listActiveRefreshes() {
    return this.request<{
      success: boolean;
      jobs: RefreshJobState[];
    }>(`/refresh/active`);
  }

  async getTransactionsRefreshStatus(ofUserId: string) {
    return this.request<{
      success: boolean;
      cache: TransactionsCacheStatus;
    }>(`/accounts/${ofUserId}/transactions/refresh/status`);
  }

  async getCachedTransactions(
    ofUserId: string,
    options?: { limit?: number; offset?: number; fan_id?: string; type?: string; since?: string }
  ) {
    const p = new URLSearchParams();
    if (options?.limit !== undefined) p.set("limit", String(options.limit));
    if (options?.offset !== undefined) p.set("offset", String(options.offset));
    if (options?.fan_id) p.set("fan_id", options.fan_id);
    if (options?.type)   p.set("type", options.type);
    if (options?.since)  p.set("since", options.since);
    return this.request<{
      success: boolean;
      list: any[];
      count: number;
      total: number;
      hasMore: boolean;
      cache: TransactionsCacheStatus;
    }>(`/accounts/${ofUserId}/transactions/cached?${p.toString()}`);
  }

  // ── Chats / Messages ──────────────────────────────────────

  async listChats(
    ofUserId: string,
    options?: { limit?: number; offset?: number; order?: "recent" | "unread" }
  ) {
    const p = new URLSearchParams();
    if (options?.limit) p.set("limit", String(options.limit));
    if (options?.offset) p.set("offset", String(options.offset));
    if (options?.order) p.set("order", options.order);
    return this.request<{
      success: boolean;
      chats: any[];
      hasMore: boolean;
    }>(`/accounts/${ofUserId}/chats${p.toString() ? `?${p}` : ""}`);
  }

  async listChatMessages(
    ofUserId: string,
    withUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const p = new URLSearchParams();
    if (options?.limit) p.set("limit", String(options.limit));
    if (options?.offset) p.set("offset", String(options.offset));
    return this.request<{
      success: boolean;
      messages: any[];
      hasMore: boolean;
    }>(
      `/accounts/${ofUserId}/chats/${withUserId}/messages${p.toString() ? `?${p}` : ""}`
    );
  }

  /**
   * Send a message to a single fan. Writes are gated per-account by
   * allow_of_write_actions — a disabled account returns 403 WRITES_DISABLED
   * (enable it via updateAccountPolling first).
   */
  async sendMessage(
    ofUserId: string,
    withUserId: string,
    payload: {
      text?: string;
      price?: number;
      attachmentNames?: string[];
      replyToId?: string;
    }
  ) {
    return this.request<{ success: boolean }>(
      `/accounts/${ofUserId}/chats/${withUserId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          text: payload.text || "",
          price: payload.price || 0,
          attachment_names: payload.attachmentNames || [],
          reply_to_id: payload.replyToId || null,
        }),
      }
    );
  }

  /**
   * Mass-message ("massive messaging"): resolve an audience from the subscriber
   * cache and DM each fan. `dry_run` (default true) returns the resolved
   * recipient count + a sample WITHOUT sending — the "who will this reach?"
   * preview. Set dry_run=false to deliver; that path is gated by
   * allow_of_write_actions (enable it via updateAccountPolling first).
   */
  async sendMassMessage(
    ofUserId: string,
    payload: {
      text?: string;
      price?: number;
      lockedText?: boolean;
      mediaFiles?: number[];
      previews?: number[];
      audience?: {
        type?: "all" | "active" | "expired";
        fan_ids?: string[];
        min_spent?: number;
        since?: string;
        until?: string;
      };
      dryRun?: boolean;
    }
  ) {
    return this.request<{
      success: boolean;
      dry_run: boolean;
      recipients: number;
      sample?: Array<{ fan_of_user_id: string; username: string | null }>;
      sent: number;
      failed?: number;
      note?: string;
      results?: Array<{ fan_of_user_id: string; ok: boolean; error?: string }>;
    }>(`/accounts/${ofUserId}/messages/mass`, {
      method: "POST",
      body: JSON.stringify({
        text: payload.text || "",
        price: payload.price || 0,
        lockedText: payload.lockedText || false,
        mediaFiles: payload.mediaFiles || [],
        previews: payload.previews || [],
        audience: payload.audience || { type: "active" },
        dry_run: payload.dryRun !== false,
      }),
    });
  }

  // ── Generic Proxy Request ─────────────────────────────────

  async makeRequest(
    ofUserId: string,
    path: string,
    method = "GET",
    body?: any
  ) {
    return this.request<{
      success: boolean;
      status_code: number;
      data: any;
    }>(`/accounts/${ofUserId}/request`, {
      method: "POST",
      body: JSON.stringify({ path, method, body }),
    });
  }

  // ── Earnings summary (server-aggregated + cached) ────────

  async getEarningsSummary(period: "today" | "week" | "month") {
    return this.request<EarningsSummary>(`/earnings/summary?period=${period}`);
  }

  /** Panel-wide payout totals from the last-known per-account samples.
   *
   *  One local query, no upstream calls — as opposed to fetching
   *  `/accounts/{id}/balances` per account, which is a live platform
   *  round-trip each. `accounts_never_sampled` is how many accounts have no
   *  sample yet and are therefore absent from the totals; treat a non-zero
   *  value as "this is a partial sum", not as zero balances. */
  async getBalancesSummary() {
    return this.request<{
      total_available: number;
      total_pending: number;
      currency: string | null;
      accounts: number;
      accounts_with_balance: number;
      accounts_never_sampled: number;
      oldest_sample_at: string | null;
      newest_sample_at: string | null;
    }>(`/balances/summary`);
  }

  // ── Polling Control ───────────────────────────────────────

  async getAccountPolling(ofUserId: string) {
    return this.request<{
      success: boolean;
      polling: {
        of_user_id: string;
        polling_enabled: number;
        polling_interval_seconds: number;
        last_polled_at: string | null;
        polling_failure_count: number;
        allow_of_write_actions: number;
      };
    }>(`/accounts/${ofUserId}/polling`);
  }

  /**
   * Update polling for one account.
   *
   * `warning` is set (200, not an error) when the account's polling row was
   * saved but the platform's poller is disabled deployment-wide — today that
   * means a Fansly account while FANSLY_POLLING_ENABLED is false: the job gets
   * scheduled and then no-ops forever. Callers MUST surface it; dropping it is
   * what produced a "polling on" switch over a permanently empty feed.
   */
  async updateAccountPolling(
    ofUserId: string,
    patch: { enabled?: boolean; interval_seconds?: number; allow_of_write_actions?: boolean }
  ) {
    return this.request<{
      success: boolean;
      polling?: Record<string, any>;
      warning?: string;
    }>(`/accounts/${ofUserId}/polling`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  // ── Events ────────────────────────────────────────────────

  async listEvents(opts?: { types?: string[]; of_user_id?: string; since?: string; limit?: number }) {
    const p = new URLSearchParams();
    if (opts?.types && opts.types.length) p.set("types", opts.types.join(","));
    if (opts?.of_user_id) p.set("of_user_id", opts.of_user_id);
    if (opts?.since) p.set("since", opts.since);
    if (opts?.limit) p.set("limit", String(opts.limit));
    return this.request<{ success: boolean; events: any[] }>(
      `/events${p.toString() ? `?${p}` : ""}`
    );
  }

  // ── Webhooks ──────────────────────────────────────────────

  async listWebhooks() {
    return this.request<{ success: boolean; webhooks: any[] }>("/webhooks");
  }

  async createWebhook(data: {
    url: string;
    event_types: string[];
    description?: string;
  }) {
    return this.request<{ success: boolean; webhook: any }>("/webhooks", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateWebhook(
    id: number,
    patch: Partial<{ url: string; event_types: string[]; description: string; is_active: boolean }>
  ) {
    return this.request<{ success: boolean; webhook: any }>(`/webhooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async deleteWebhook(id: number) {
    return this.request<{ success: boolean }>(`/webhooks/${id}`, { method: "DELETE" });
  }

  async testWebhook(id: number) {
    return this.request<{ success: boolean }>(`/webhooks/${id}/test`, { method: "POST" });
  }

  async listWebhookDeliveries(id: number, limit = 50) {
    return this.request<{ success: boolean; deliveries: any[] }>(
      `/webhooks/${id}/deliveries?limit=${limit}`
    );
  }

  // ── Integrations ──────────────────────────────────────────

  /** Fetch groups/chats the user's Telegram bot has recently seen.
   *  Telegram has no "list my chats" API — the bot only knows about chats
   *  where someone has messaged it, so the user may need to @mention the
   *  bot in a group first. */
  async listTelegramGroups(botToken: string) {
    return this.request<{
      success: boolean;
      groups: Array<{ id: number; type: string; title: string }>;
    }>("/integrations/telegram/groups", {
      method: "POST",
      body: JSON.stringify({ bot_token: botToken }),
    });
  }

  // ── Panel-level Telegram channel ──────────────────────────
  // The bot token is write-only by design: it is sent on pair() and never
  // comes back. `has_custom_token` is all the UI ever learns about it.

  /**
   * Whether this panel has its own captcha provider key.
   *
   * The key itself is never returned — only whether one is set and a masked
   * preview. When `configured` is false, logins spend against the server-wide
   * key the operator configured in the environment.
   */
  async getCaptchaSettings() {
    return this.request<{
      success: boolean;
      configured: boolean;
      preview: string | null;
      provider: string;
      falls_back_to_server_key: boolean;
    }>("/settings/captcha");
  }

  /** Store this panel's captcha key. Validated with the provider before it is saved. */
  async setCaptchaKey(apiKey: string) {
    return this.request<{ success: boolean; configured: boolean; balance?: number }>(
      "/settings/captcha",
      { method: "PUT", body: JSON.stringify({ api_key: apiKey }) },
    );
  }

  /** Clear it, falling back to the server-wide key. */
  async clearCaptchaKey() {
    return this.request<{ success: boolean; configured: boolean }>(
      "/settings/captcha",
      { method: "DELETE" },
    );
  }

  async getTelegramIntegration() {
    return this.request<TelegramIntegrationResponse>("/integrations/telegram");
  }

  /** Start (or restart) pairing. Returns a t.me deep link to open. */
  async pairTelegram(data: {
    bot_mode: TelegramBotMode;
    /** custom mode only — write-only, never returned by any endpoint */
    bot_token?: string;
    event_types?: string[];
  }) {
    return this.request<{
      success: boolean;
      deep_link: string;
      bot_username: string;
      expires_at: string;
      ttl_seconds: number;
      integration: TelegramIntegration;
    }>("/integrations/telegram/pair", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTelegramIntegration(
    patch: Partial<{ event_types: string[]; is_active: boolean }>
  ) {
    return this.request<{ success: boolean; integration: TelegramIntegration }>(
      "/integrations/telegram",
      { method: "PATCH", body: JSON.stringify(patch) }
    );
  }

  async deleteTelegramIntegration() {
    return this.request<{ success: boolean }>("/integrations/telegram", {
      method: "DELETE",
    });
  }

  async testTelegramIntegration() {
    return this.request<{
      success: boolean;
      error?: string;
      integration: TelegramIntegration | null;
    }>("/integrations/telegram/test", { method: "POST" });
  }

  // ── Automations ───────────────────────────────────────────

  async listAutomations() {
    return this.request<{ success: boolean; automations: any[] }>("/automations");
  }

  async createAutomation(data: {
    name: string;
    trigger_event: string;
    action_type: string;
    action_params: Record<string, any>;
    conditions?: Array<{ field: string; op: string; value: any }>;
    of_user_id?: string;
  }) {
    return this.request<{ success: boolean; automation: any }>("/automations", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAutomation(id: number, patch: Record<string, any>) {
    return this.request<{ success: boolean; automation: any }>(`/automations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  async deleteAutomation(id: number) {
    return this.request<{ success: boolean }>(`/automations/${id}`, { method: "DELETE" });
  }

  async runAutomationNow(id: number, sample_payload?: Record<string, any>) {
    return this.request<{ success: boolean; result: any }>(`/automations/${id}/run-now`, {
      method: "POST",
      body: JSON.stringify({ sample_payload }),
    });
  }

  async listAutomationRuns(id: number, limit = 50) {
    return this.request<{ success: boolean; runs: any[] }>(
      `/automations/${id}/runs?limit=${limit}`
    );
  }

  // ── Fans ──────────────────────────────────────────────────

  async listFans(opts?: {
    of_user_id?: string;
    limit?: number;
    offset?: number;
    sort?: "last_seen" | "first_seen" | "tips" | "spend" | "events";
    search?: string;
    tag?: string;
  }) {
    const p = new URLSearchParams();
    if (opts?.of_user_id) p.set("of_user_id", opts.of_user_id);
    if (opts?.limit) p.set("limit", String(opts.limit));
    if (opts?.offset) p.set("offset", String(opts.offset));
    if (opts?.sort) p.set("sort", opts.sort);
    if (opts?.search) p.set("search", opts.search);
    if (opts?.tag) p.set("tag", opts.tag);
    return this.request<{ success: boolean; fans: any[] }>(
      `/fans${p.toString() ? `?${p}` : ""}`
    );
  }

  async addFanTag(fanOfUserId: string, ofUserId: string, tag: string) {
    return this.request<{ success: boolean }>(`/fans/${fanOfUserId}/tags`, {
      method: "POST",
      body: JSON.stringify({ of_user_id: ofUserId, tag }),
    });
  }

  async removeFanTag(fanOfUserId: string, ofUserId: string, tag: string) {
    return this.request<{ success: boolean }>(
      `/fans/${fanOfUserId}/tags/${encodeURIComponent(tag)}?of_user_id=${ofUserId}`,
      { method: "DELETE" }
    );
  }

  /** Set (or clear, with note="") a fan's local private note. */
  async setFanNote(fanOfUserId: string, ofUserId: string, note: string) {
    return this.request<{ success: boolean }>(`/fans/${fanOfUserId}/note`, {
      method: "PUT",
      body: JSON.stringify({ of_user_id: ofUserId, note }),
    });
  }

  // ── Proxy Test ────────────────────────────────────────────

  /** Probe a proxy URL via the backend. Returns translated, user-friendly
   * status — never raw curl/network errors. */
  async testProxy(proxy: string) {
    return this.request<{
      ok: boolean;
      latency_ms?: number;
      ip?: string;
      geo?: {
        country?: string | null;
        country_code?: string | null;
        region?: string | null;
        city?: string | null;
        isp?: string | null;
      } | null;
      // OnlyFans reachability through this proxy. `false` = the proxy works but
      // OnlyFans blocks logins from its IP (see of_warning + blocked_ip); null =
      // couldn't determine. A false here means a connect will fail.
      of_reachable?: boolean | null;
      of_warning?: string | null;
      blocked_ip?: string | null;
      ray_id?: string | null;
      error?: string;
      reason?: "auth" | "dns" | "connection" | "timeout" | "tls" | "reset" | "http" | "proxy" | "unknown" | "private_address";
    }>("/proxy/test", {
      method: "POST",
      body: JSON.stringify({ proxy }),
    });
  }

  // Turn background polling on (at the paid default interval) for every account
  // on the panel whose platform supports it. Paid plans only.
  async enableAllPolling() {
    return this.request<{
      success: boolean;
      enabled: number;
      already_on: number;
      skipped: { of_user_id: string; reason: string }[];
      interval_seconds: number;
    }>("/accounts/polling/enable-all", { method: "POST" });
  }

  // ── MCP Server ────────────────────────────────────────────

  /** Toggle the per-CRM flag that lets the hosted MCP server make non-GET
   * OnlyFans proxy calls. Off by default; needs an explicit opt-in because
   * a chatty model could otherwise issue mutating /api2/v2 calls. */
  async setMcpUnsafeProxy(enabled: boolean) {
    return this.request<{ success: boolean; mcp_unsafe_proxy: boolean }>(
      "/mcp/unsafe-proxy",
      {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }
    );
  }

  // ── Data export ("Download your data") ────────────────────

  async createExport(
    ofUserId: string,
    opts: {
      dataTypes: string[];
      since?: string | null;
      until?: string | null;
      includeMedia?: boolean;
    }
  ) {
    return this.request<{
      success: boolean;
      job: ExportJob;
      warning?: string | null;
      already_running?: boolean;
    }>(`/accounts/${ofUserId}/exports`, {
      method: "POST",
      body: JSON.stringify({
        data_types: opts.dataTypes,
        since: opts.since ?? null,
        until: opts.until ?? null,
        include_media: !!opts.includeMedia,
      }),
    });
  }

  async listExports(ofUserId: string, limit = 50, offset = 0) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<{ success: boolean; jobs: ExportJob[]; total: number }>(
      `/accounts/${ofUserId}/exports?${params.toString()}`
    );
  }

  async getExport(ofUserId: string, jobId: string) {
    return this.request<{ success: boolean; job: ExportJob }>(
      `/accounts/${ofUserId}/exports/${jobId}`
    );
  }

  async deleteExport(ofUserId: string, jobId: string) {
    return this.request<{ success: boolean }>(
      `/accounts/${ofUserId}/exports/${jobId}`,
      { method: "DELETE" }
    );
  }

  async cancelExport(ofUserId: string, jobId: string) {
    return this.request<{ success: boolean; job?: ExportJob }>(
      `/accounts/${ofUserId}/exports/${jobId}/cancel`,
      { method: "POST", body: JSON.stringify({}) }
    );
  }

  /**
   * URL for an `<a href download>` to fetch the ZIP. Goes through the same
   * proxy as every other call — the browser authenticates with the NextAuth
   * cookie, so no API key is needed client-side.
   */
  downloadExportUrl(ofUserId: string, jobId: string) {
    return `${BASE_URL}/api/crm/${this.crmId}/accounts/${ofUserId}/exports/${jobId}/download`;
  }

  // ── Bulk account import ───────────────────────────────────
  //
  // Request budget is the design constraint here: a job can hold 1000 rows and
  // every method below is O(1) in the number of rows. Nothing in this section
  // is ever called in a loop over accounts.

  /**
   * Parse + validate a paste WITHOUT touching anything. Safe to call on demand;
   * the backend creates no job, logs in to nothing, and returns no secrets.
   */
  async previewImport(text: string, opts?: { platform?: string | null }) {
    return this.request<ImportPreviewResponse>(`/import/preview`, {
      method: "POST",
      body: JSON.stringify({
        text,
        ...(opts?.platform ? { default_platform: opts.platform } : {}),
      }),
    });
  }

  /** Create the job. Same text the preview saw, so what was shown is what runs. */
  async createImportJob(
    text: string,
    opts?: { platform?: string | null; label?: string | null }
  ) {
    return this.request<{ success: boolean; job: ImportJob }>(`/import/jobs`, {
      method: "POST",
      body: JSON.stringify({
        text,
        ...(opts?.platform ? { default_platform: opts.platform } : {}),
        ...(opts?.label ? { label: opts.label } : {}),
      }),
    });
  }

  async listImportJobs(limit = 20, offset = 0) {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<{ success: boolean; jobs: ImportJob[]; total?: number }>(
      `/import/jobs?${params.toString()}`
    );
  }

  /**
   * Job + rows + counts in ONE request — this is the single endpoint the page
   * polls while an import runs, whatever the row count.
   *
   * `limit`/`offset`/`state` are sent as a courtesy for large jobs. A backend
   * that ignores them and returns every row still works: the table paginates
   * client-side off whatever it receives, and `counts` (not `rows.length`) is
   * what drives progress.
   */
  async getImportJob(
    jobId: string,
    opts?: { limit?: number; offset?: number; state?: string | null }
  ) {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    if (opts?.state) params.set("state", opts.state);
    const qs = params.toString();
    return this.request<ImportJobDetail>(
      `/import/jobs/${jobId}${qs ? `?${qs}` : ""}`
    );
  }

  async cancelImportJob(jobId: string) {
    return this.request<{ success: boolean; job?: ImportJob }>(
      `/import/jobs/${jobId}/cancel`,
      { method: "POST", body: JSON.stringify({}) }
    );
  }

  /** Hand a parked row its 6-digit code; the row resumes from `running`. */
  async submitImportOtp(jobId: string, rowId: string, code: string) {
    return this.request<{ success: boolean; row?: ImportJobRow }>(
      `/import/jobs/${jobId}/rows/${rowId}/otp`,
      { method: "POST", body: JSON.stringify({ code }) }
    );
  }

  /** Start the login for one row over again. This is the ONLY way out of
   *  `needs_2fa_expired` — the parked challenge is gone, so a code can't fix
   *  it, and offering one would be a dead end. */
  async retryImportRow(jobId: string, rowId: string) {
    return this.request<{ success: boolean; row?: ImportJobRow }>(
      `/import/jobs/${jobId}/rows/${rowId}/retry`,
      { method: "POST", body: JSON.stringify({}) }
    );
  }

  /** Panel-wide parked rows, across every job. One cheap call — this is what
   *  lets the dashboard say "3 accounts need a code" on a page that knows
   *  nothing about imports. */
  async getPendingImport2FA() {
    return this.request<PendingTwoFactorResponse>(`/import/pending-2fa`);
  }

  // ── Health Check ──────────────────────────────────────────

  async healthCheck() {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
