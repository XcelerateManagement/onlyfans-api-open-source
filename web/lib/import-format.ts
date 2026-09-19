/**
 * Presentation helpers for the bulk account importer.
 *
 * Two jobs, both deliberately narrow:
 *
 *  1. A *pre-flight* read of the pasted text — enough to enforce the 1000-row
 *     and 2 MiB caps in the browser, so the operator learns about them while
 *     they can still fix the paste instead of after a round trip. This is NOT a
 *     second copy of the parser: it counts payload lines and bytes and nothing
 *     else. Splitting columns, resolving aliases and validating emails stay on
 *     the server, which is the only place that can also say "already connected".
 *
 *  2. The state vocabulary — one table mapping every `ImportRowState` to its
 *     label, colour and, crucially, whether it is *actionable*. Nine states
 *     across three components is exactly how a `needs_2fa_expired` row ends up
 *     rendering a code box that silently does nothing.
 */

import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportCounts,
  type ImportRowState,
} from "@/lib/api-client";

// ── Pre-flight ───────────────────────────────────────────────────────────────

export interface PasteStats {
  /** UTF-8 size, which is what the 2 MiB cap actually measures. */
  bytes: number;
  /** Lines that will become rows: not blank, not a `#` comment. */
  rowCount: number;
  blankLines: number;
  commentLines: number;
  overRows: boolean;
  overBytes: boolean;
  /** Non-null when the paste cannot be submitted as-is. */
  blocker: string | null;
}

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

function byteLength(text: string): number {
  if (encoder) return encoder.encode(text).length;
  // SSR / very old runtime: 1 byte per code unit is close enough for a warning.
  return text.length;
}

/**
 * Count what the server will count. Mirrors the documented parser rules for
 * *skipping* only — blank lines and `#` comments are ignored, everything else
 * is a candidate row (including a header line, which the server may then
 * recognise and drop; over-counting by one is the safe direction for a cap).
 */
export function analysePaste(text: string): PasteStats {
  let rowCount = 0;
  let blankLines = 0;
  let commentLines = 0;

  // An empty box is not "one blank line" — say nothing rather than something
  // faintly wrong.
  for (const raw of text ? text.split(/\r\n|\r|\n/) : []) {
    const line = raw.trim();
    if (!line) {
      blankLines++;
      continue;
    }
    if (line.startsWith("#")) {
      commentLines++;
      continue;
    }
    rowCount++;
  }

  const bytes = byteLength(text);
  const overRows = rowCount > IMPORT_MAX_ROWS;
  const overBytes = bytes > IMPORT_MAX_BYTES;

  let blocker: string | null = null;
  if (overRows && overBytes) {
    blocker = `${rowCount.toLocaleString()} rows and ${formatBytes(bytes)} — the limits are ${IMPORT_MAX_ROWS.toLocaleString()} rows and ${formatBytes(IMPORT_MAX_BYTES)}. Split this into batches.`;
  } else if (overRows) {
    blocker = `${rowCount.toLocaleString()} rows — the limit is ${IMPORT_MAX_ROWS.toLocaleString()} per import. Remove ${(rowCount - IMPORT_MAX_ROWS).toLocaleString()} or split into batches.`;
  } else if (overBytes) {
    blocker = `${formatBytes(bytes)} — the limit is ${formatBytes(IMPORT_MAX_BYTES)} per import. Split this into batches.`;
  }

  return {
    bytes,
    rowCount,
    blankLines,
    commentLines,
    overRows,
    overBytes,
    blocker,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(2)} MiB`;
}

/** The copyable example under the textarea. Fake, obviously-fake credentials. */
export const IMPORT_EXAMPLE = `# any of these lines work — pick whichever your list already uses
email,password,platform,proxy,totp_secret
creator.one@example.com,hunter2,onlyfans,http://user:pw@1.2.3.4:8000,JBSWY3DPEHPK3PXP
creator.two@example.com;hunter3;fansly;;
creator.three@example.com|hunter4
creator.four@example.com:hunter5`;

/** Column aliases the parser accepts, for the "what counts as a header" hint. */
export const IMPORT_COLUMN_ALIASES: { canonical: string; aliases: string[] }[] = [
  { canonical: "email", aliases: ["user", "username", "login", "mail", "e-mail"] },
  { canonical: "password", aliases: ["pass", "pwd", "passwd"] },
  { canonical: "platform", aliases: ["site", "provider"] },
  { canonical: "proxy", aliases: ["proxy_url", "ip"] },
  { canonical: "totp_secret", aliases: ["2fa", "totp", "secret", "otp_secret"] },
];

// ── State vocabulary ─────────────────────────────────────────────────────────

export type StateTone =
  | "neutral"
  | "running"
  | "success"
  | "warning"
  | "danger"
  | "muted";

export interface StateMeta {
  label: string;
  tone: StateTone;
  /** One line of plain English. Shown in the legend and as a row tooltip. */
  help: string;
  /** True when the importer is still going to do something with this row on
   *  its own. Drives the "in flight" tally and the spinner. */
  active: boolean;
  /** True when the row is waiting on the *operator*, not the machine. */
  needsOperator: boolean;
}

export const IMPORT_STATE_META: Record<ImportRowState, StateMeta> = {
  pending: {
    label: "Queued",
    tone: "neutral",
    help: "Waiting its turn. Nothing has been tried yet.",
    active: true,
    needsOperator: false,
  },
  running: {
    label: "Logging in",
    tone: "running",
    help: "Signing in to the platform right now.",
    active: true,
    needsOperator: false,
  },
  success: {
    label: "Connected",
    tone: "success",
    help: "Logged in and added to your accounts.",
    active: false,
    needsOperator: false,
  },
  needs_2fa: {
    label: "Needs code",
    tone: "warning",
    help: "Parked waiting for a 6-digit code. The rest of the import kept going.",
    active: false,
    needsOperator: true,
  },
  needs_2fa_expired: {
    label: "Code expired",
    tone: "danger",
    help: "The 10-minute window closed. A code will no longer work — this row has to log in again.",
    active: false,
    needsOperator: true,
  },
  failed: {
    label: "Failed",
    tone: "danger",
    help: "The login was attempted and rejected.",
    active: false,
    needsOperator: true,
  },
  canceled: {
    label: "Canceled",
    tone: "muted",
    help: "The import was stopped before this row ran.",
    active: false,
    needsOperator: false,
  },
  invalid: {
    label: "Invalid",
    tone: "danger",
    help: "The line could not be read as an account. Never attempted.",
    active: false,
    needsOperator: false,
  },
  skipped: {
    label: "Skipped",
    tone: "muted",
    help: "Already connected to this panel. Left alone.",
    active: false,
    needsOperator: false,
  },
  slot_exhausted: {
    label: "No slot",
    tone: "warning",
    help: "Your subscription has no free account slot for this one. Never attempted.",
    active: false,
    needsOperator: true,
  },
};

/** Order used everywhere a per-state breakdown is listed, so the legend, the
 *  summary tiles and the filter dropdown always agree. */
export const IMPORT_STATE_ORDER: ImportRowState[] = [
  "success",
  "running",
  "pending",
  "needs_2fa",
  "needs_2fa_expired",
  "failed",
  "slot_exhausted",
  "skipped",
  "invalid",
  "canceled",
];

const TONE_CHIP: Record<StateTone, string> = {
  neutral: "border-white/[0.12] bg-white/[0.04] text-default-400",
  running:
    "border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.1)] text-[color:var(--theme-accent,#f54900)]",
  success: "border-green-500/30 bg-green-500/10 text-green-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-400",
  muted: "border-white/[0.08] bg-white/[0.02] text-default-500",
};

const TONE_DOT: Record<StateTone, string> = {
  neutral: "bg-white/30",
  running: "bg-[color:var(--theme-accent,#f54900)]",
  success: "bg-green-400",
  warning: "bg-amber-400",
  danger: "bg-red-400",
  muted: "bg-white/15",
};

export function stateChipClass(state: ImportRowState): string {
  return TONE_CHIP[IMPORT_STATE_META[state]?.tone ?? "neutral"];
}

export function stateDotClass(state: ImportRowState): string {
  return TONE_DOT[IMPORT_STATE_META[state]?.tone ?? "neutral"];
}

export function stateLabel(state: ImportRowState): string {
  return IMPORT_STATE_META[state]?.label ?? state;
}

// ── Counts ───────────────────────────────────────────────────────────────────

export function countOf(counts: ImportCounts | null | undefined, state: ImportRowState): number {
  const n = counts?.[state];
  return typeof n === "number" ? n : 0;
}

/** Rows that reached a state nothing else will move them out of, without the
 *  operator. Used for the progress bar's numerator. */
export function settledCount(counts: ImportCounts | null | undefined): number {
  return (
    countOf(counts, "success") +
    countOf(counts, "failed") +
    countOf(counts, "skipped") +
    countOf(counts, "invalid") +
    countOf(counts, "canceled") +
    countOf(counts, "slot_exhausted") +
    countOf(counts, "needs_2fa") +
    countOf(counts, "needs_2fa_expired")
  );
}

export function parkedCount(counts: ImportCounts | null | undefined): number {
  return countOf(counts, "needs_2fa") + countOf(counts, "needs_2fa_expired");
}

// ── Secrets ──────────────────────────────────────────────────────────────────

/**
 * Defence in depth for the screenshot problem. The contract says the server
 * never echoes a password or a TOTP secret, but "never renders a credential"
 * is a property this UI should hold on its own — if a future backend starts
 * returning one, it gets starred here rather than appearing on screen.
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  return "•".repeat(Math.min(Math.max(value.length, 6), 12));
}

/** Show a proxy without its credentials: `http://user:pw@host:port` → `host:port`. */
export function maskProxy(proxy: string | null | undefined): string {
  if (!proxy) return "";
  const at = proxy.lastIndexOf("@");
  if (at === -1) return proxy;
  const scheme = proxy.slice(0, proxy.indexOf("//") + 2);
  return `${scheme}•••@${proxy.slice(at + 1)}`;
}

// ── OTP countdown ────────────────────────────────────────────────────────────

export interface OtpWindow {
  /** Milliseconds left, floored at 0. */
  msLeft: number;
  secondsLeft: number;
  expired: boolean;
  /** `m:ss`. */
  display: string;
  /** Under 60s — worth shouting about. */
  urgent: boolean;
}

/**
 * Resolve a parked row's OTP deadline against a caller-supplied `now`.
 *
 * The caller passes `now` (rather than this reading the clock) so one interval
 * can drive every countdown on screen — 600 rows must not mean 600 timers.
 */
export function otpWindow(
  expiresAt: string | null | undefined,
  now: number
): OtpWindow | null {
  if (!expiresAt) return null;
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return null;
  const msLeft = Math.max(0, deadline - now);
  const secondsLeft = Math.ceil(msLeft / 1000);
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return {
    msLeft,
    secondsLeft,
    expired: msLeft <= 0,
    display: `${m}:${String(s).padStart(2, "0")}`,
    urgent: msLeft > 0 && secondsLeft <= 60,
  };
}

/**
 * The single source of truth for "can this row still take a code?".
 *
 * A row is codeable only while the backend says `needs_2fa` AND its window is
 * still open. The clock-side check matters: the row state is refreshed on a
 * poll, so between polls a `needs_2fa` row can be seconds past its deadline,
 * and posting a code then just produces a confusing rejection.
 */
export function canAcceptCode(
  state: ImportRowState,
  expiresAt: string | null | undefined,
  now: number
): boolean {
  if (state !== "needs_2fa") return false;
  const w = otpWindow(expiresAt, now);
  // No deadline reported → trust the state and let the operator try.
  if (!w) return true;
  return !w.expired;
}
