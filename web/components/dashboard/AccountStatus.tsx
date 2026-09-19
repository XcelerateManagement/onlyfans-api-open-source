"use client";

import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import type { OfAccount } from "@/lib/hooks/use-selected-account";
import { parseUtc } from "@/lib/chat-utils";

/**
 * Per-row account status for the accounts table.
 *
 * Everything below is derived from fields ALREADY on the `GET /accounts`
 * payload (polling_enabled, polling_interval_seconds, last_polled_at,
 * polling_failure_count, needs_reconnect, capabilities). Nothing here may ever
 * trigger a per-account request: at ~600 accounts an N+1 in this cell is a
 * ten-minute page load, which this table has already been through once.
 *
 * The hard rule is that the indicator may not claim more than the backend will
 * actually do. A Fansly account can have polling_enabled = 1 in the database
 * while `config.FANSLY_POLLING_ENABLED` is false server-side (it ships false),
 * in which case the poll job is scheduled but no-ops forever. The backend
 * already tells us this — `capabilities.polling` is computed from the flag in
 * platform_features.py — so a green "Polling on" over a permanently empty feed
 * is a lie we have the data to avoid. `capabilities.polling` is checked BEFORE
 * polling_enabled for exactly that reason.
 */

export type AccountStatusKind =
  | "unknown"
  | "login_failed"
  | "verification"
  | "proxy_error"
  | "rate_limited"
  | "sync_blocked"
  | "temporary_error"
  | "polling_unsupported"
  | "paused_failures"
  | "polling_off"
  | "never_polled"
  | "lagging"
  | "polling_on";

export type StatusTone = "ok" | "warn" | "bad" | "muted";

export interface AccountStatus {
  kind: AccountStatusKind;
  /** Short label for the row. */
  label: string;
  tone: StatusTone;
  /** Longer explanation — rendered as the title/tooltip. */
  detail: string;
}

/** Consecutive failures at which poller.py auto-disables polling. */
const AUTO_PAUSE_FAILURES = 5;

/**
 * A poll is "lagging" once it is this many intervals late. The scheduler
 * jitters each interval and a long-running account sync can push one cycle
 * out, so 3× (with a 5-minute floor for short intervals) flags a genuinely
 * stuck account rather than normal drift.
 */
function lagThresholdMs(intervalSeconds: number): number {
  const interval = Math.max(60, intervalSeconds || 120);
  return Math.max(interval * 3, interval + 300) * 1000;
}

function ago(iso: string | null | undefined): string {
  const d = parseUtc(iso);
  if (!d) return "never";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function deriveAccountStatus(account: OfAccount): AccountStatus {
  const platform = platformLabel(account.platform);

  // 1. Credentials first — nothing else matters if we can't log in. The
  //    backend sets this from the relogin circuit breaker.
  if (account.connection_state === "login_failed" || account.needs_reconnect) {
    return {
      kind: "login_failed",
      label: "Login failed",
      tone: "bad",
      detail:
        account.login_failure?.message ||
        account.relogin_block_reason ||
        "OnlyFans rejected the saved login details.",
    };
  }

  // 1b. Platform identity gate. Ranked right after credentials and before
  //     anything about polling, because while it is up NO account-scoped call
  //     succeeds — a "polling on" badge here would be a lie. Distinct from
  //     reconnect: nothing about our stored credentials is wrong.
  if (account.needs_verification) {
    return {
      kind: "verification",
      label: "Verification needed",
      tone: "bad",
      detail:
        account.verification?.reason ||
        `${platform} is holding this account behind a face check — open it from the accounts page and complete the selfie check on the account's own IP.`,
    };
  }

  const connectionLabels = {
    proxy_error: "Proxy error",
    rate_limited: "Rate limited",
    sync_blocked: "Sync blocked",
    temporary_error: "Temporary error",
  } as const;
  if (account.connection_state && account.connection_state in connectionLabels) {
    const kind = account.connection_state as keyof typeof connectionLabels;
    return {
      kind,
      label: connectionLabels[kind],
      tone: kind === "rate_limited" || kind === "temporary_error" ? "warn" : "bad",
      detail: account.connection_error?.message || `${platform} synchronization is temporarily unavailable.`,
    };
  }

  // 2. Can this platform be polled AT ALL in this deployment? Checked before
  //    polling_enabled so a Fansly account with the flag set in the DB never
  //    renders as live while the server-side poller is off.
  if (!accountSupports(account, "polling")) {
    return {
      kind: "polling_unsupported",
      label: "Polling unavailable",
      tone: "muted",
      detail: account.polling_enabled
        ? `Polling is switched on for this account, but ${platform} polling is disabled on the server — no events will arrive until that changes.`
        : `${platform} polling is disabled on the server.`,
    };
  }

  // Old payloads without the polling columns: say nothing rather than guess.
  if (account.polling_enabled === undefined || account.polling_enabled === null) {
    return {
      kind: "unknown",
      label: "—",
      tone: "muted",
      detail: "This account's polling state was not reported by the API.",
    };
  }

  const failures = account.polling_failure_count || 0;

  if (!account.polling_enabled) {
    // poller.py disables polling after AUTO_PAUSE_FAILURES consecutive
    // failures, so "off with a failure streak" means auto-paused, not a
    // deliberate switch-off — a distinction the operator needs.
    if (failures >= AUTO_PAUSE_FAILURES) {
      return {
        kind: "paused_failures",
        label: `Paused after ${failures} failures`,
        tone: "bad",
        detail: `Polling auto-paused after ${failures} consecutive failures. Check the proxy/session, then switch polling back on.`,
      };
    }
    return {
      kind: "polling_off",
      label: "Polling off",
      tone: "muted",
      detail: "Background polling is switched off for this account.",
    };
  }

  if (!account.last_polled_at) {
    return {
      kind: "never_polled",
      label: "Never polled",
      tone: "warn",
      detail:
        "Polling is on but this account has not completed a poll yet. The first cycle can take up to one interval.",
    };
  }

  const last = parseUtc(account.last_polled_at);
  const interval = account.polling_interval_seconds || 120;
  const age = last ? Date.now() - last.getTime() : Number.POSITIVE_INFINITY;

  if (age > lagThresholdMs(interval)) {
    return {
      kind: "lagging",
      label: `Lagging · ${ago(account.last_polled_at)}`,
      tone: "warn",
      detail: `Polling is on with a ${interval}s interval, but the last successful poll was ${ago(
        account.last_polled_at,
      )}${failures > 0 ? ` (${failures} recent failures)` : ""}.`,
    };
  }

  return {
    kind: "polling_on",
    label: `Polling on · ${ago(account.last_polled_at)}`,
    tone: "ok",
    detail: `Polled every ${interval}s. Last poll ${ago(account.last_polled_at)}${
      failures > 0 ? ` · ${failures} recent failures` : ""
    }.`,
  };
}

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "text-green-400",
  warn: "text-amber-400",
  bad: "text-red-400",
  muted: "text-default-400",
};

/** The dot is hollow for states where nothing is running, filled where it is. */
const TONE_DOT: Record<StatusTone, string> = {
  ok: "●",
  warn: "◐",
  bad: "●",
  muted: "○",
};

/**
 * Compact one-line polling indicator for a table row. Pair it with the
 * connection chip already in the STATUS cell.
 */
export function AccountStatusLine({ account }: { account: OfAccount }) {
  const status = deriveAccountStatus(account);
  if (["login_failed", "verification", "proxy_error", "rate_limited", "sync_blocked", "temporary_error"].includes(status.kind)) {
    return null; // rendered with its visible reason in the connection cell
  }

  return (
    <span
      className={`text-[11px] whitespace-nowrap ${TONE_CLASS[status.tone]}`}
      title={status.detail}
    >
      <span aria-hidden="true">{TONE_DOT[status.tone]}</span> {status.label}
    </span>
  );
}
