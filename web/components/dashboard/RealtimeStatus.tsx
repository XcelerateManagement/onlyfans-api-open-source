"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

import { useSSE } from "@/lib/hooks/use-sse";
import { useAccounts, type OfAccount } from "@/lib/hooks/use-selected-account";
import { useTour } from "@/lib/tour-context";
import { platformLabel } from "@/lib/platform-capabilities";
import { deriveAccountStatus, type StatusTone } from "./AccountStatus";

/**
 * Honest "is this feed actually live?" indicator.
 *
 * The bug this replaces: every live badge on the dashboard was wired straight
 * to `useSSE().connected`, which is only "our browser holds an EventSource to
 * our own Flask /events/stream". That connection succeeds for every panel,
 * including one whose accounts can never emit a single event — so a Fansly-only
 * panel rendered a pulsing green "Live" over a feed that was structurally
 * guaranteed to stay empty. A green light over nothing is worse than no light.
 *
 * What actually has to be true for an event to reach the feed:
 *
 *   1. The account has an event SOURCE running server-side, and
 *   2. the browser's SSE transport is up to carry it.
 *
 * Only (2) was ever checked. (1) is what `deriveAccountStatus` already computes
 * for the accounts table — capabilities.polling (which the backend derives from
 * config.FANSLY_POLLING_ENABLED / FANSLY_WS_ENABLED, so it tracks the actual
 * deployment) AND-ed with the account's own polling_enabled, minus the relogin
 * circuit breaker. Reusing it is deliberate: two places deciding "can this
 * account produce events" is how the two drift apart.
 *
 * `polling_enabled` really is the master switch for BOTH platforms' realtime,
 * not just the poller: scheduler.reconcile only starts a WS listener inside its
 * `list_pollable_accounts()` loop (scheduler.py), and the PATCH /polling route
 * only calls start_ws_listener / start_fansly_ws_listener inside its
 * `if info.polling_enabled` branch (crm_api.py). An account with polling off
 * has no socket either. That is why `capabilities.websocket` is NOT treated
 * here as an independent event source — on OnlyFans it is statically true while
 * the listener is additionally allowlist-gated (WS_ENABLED_ACCOUNTS), so
 * trusting it would reintroduce the same overclaim one layer down.
 *
 * Colour is never the only carrier: protan separation of green/amber on
 * #0d0d0d is inadequate (green↔amber ΔE 5.7), so every state renders a glyph
 * AND a word, and the reason is always available as the title/tooltip.
 */

export type RealtimeKind =
  | "unknown"
  | "no_accounts"
  | "unsupported"
  | "off"
  | "reconnecting"
  | "live";

export interface RealtimeStatus {
  kind: RealtimeKind;
  /** Short word for the badge. Always rendered next to the dot. */
  label: string;
  tone: StatusTone;
  /** Full explanation — rendered as the title/tooltip. */
  detail: string;
  /** True only when an event could actually arrive right now. */
  isLive: boolean;
}

/** Account statuses that mean "an event source is scheduled for this account".
 *  `never_polled` and `lagging` are included: the job exists, it is just late
 *  or has not had its first cycle — events can still arrive. */
const EMITTING_KINDS = new Set(["polling_on", "lagging", "never_polled"]);

function listPlatforms(accounts: OfAccount[]): string {
  const names = Array.from(
    new Set(accounts.map((a) => platformLabel(a.platform))),
  );
  if (names.length === 0) return "These";
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/**
 * Pure derivation so the rule is testable and identical everywhere.
 *
 * @param accounts  The accounts in scope — the whole panel for a panel-wide
 *                  feed, or a single-element list for a scoped one.
 * @param connected Whether the shared EventSource is currently open.
 * @param loaded    Whether the account list has ever loaded successfully. An
 *                  empty list that has never loaded means "we don't know", not
 *                  "nothing is connected".
 */
export function deriveRealtimeStatus(
  accounts: OfAccount[],
  connected: boolean,
  loaded: boolean,
): RealtimeStatus {
  if (!loaded) {
    return {
      kind: "unknown",
      label: "Checking…",
      tone: "muted",
      detail: "Still loading the account list — realtime state is not known yet.",
      isLive: false,
    };
  }

  if (accounts.length === 0) {
    return {
      kind: "no_accounts",
      label: "Not live",
      tone: "muted",
      detail:
        "No account is in scope, so nothing can produce events. Connect an account to start a live feed.",
      isLive: false,
    };
  }

  const statuses = accounts.map((a) => ({
    account: a,
    status: deriveAccountStatus(a),
  }));
  const emitting = statuses.filter((s) => EMITTING_KINDS.has(s.status.kind));

  if (emitting.length === 0) {
    // Nothing server-side can produce an event. Say WHY, because the two
    // reasons need different actions from the operator.
    const unsupported = statuses.filter(
      (s) => s.status.kind === "polling_unsupported",
    );
    if (unsupported.length === statuses.length) {
      const platforms = listPlatforms(unsupported.map((s) => s.account));
      return {
        kind: "unsupported",
        label: "Not live",
        tone: "muted",
        detail: `${platforms} realtime is disabled on the server for this deployment, so no events will arrive here. Nothing on this page will update on its own until that changes.`,
        isLive: false,
      };
    }
    const broken = statuses.filter((s) => s.status.kind === "login_failed").length;
    const detail =
      broken === statuses.length
        ? "Every account in scope needs reconnecting — auto-relogin is blocked, so no events are being collected."
        : "No account in scope has polling switched on, so no events are being collected. Turn on polling from the Accounts page.";
    return {
      kind: "off",
      label: "Not live",
      tone: "muted",
      detail,
      isLive: false,
    };
  }

  if (!connected) {
    return {
      kind: "reconnecting",
      label: "Reconnecting…",
      tone: "warn",
      detail: `${emitting.length} account${
        emitting.length === 1 ? " is" : "s are"
      } collecting events, but this browser lost its connection to the live stream. Reconnecting automatically — the feed will catch up.`,
      isLive: false,
    };
  }

  const intervals = emitting
    .map((s) => s.account.polling_interval_seconds || 120)
    .sort((a, b) => a - b);
  const fastest = intervals[0];
  return {
    kind: "live",
    label: "Live",
    tone: "ok",
    detail: `Live — ${emitting.length} account${
      emitting.length === 1 ? "" : "s"
    } collecting events, streaming to this page. Events are detected by the background poller, so they can lag real time by up to ${fastest}s.`,
    isLive: true,
  };
}

/** The scope of a realtime badge: an account object, an of_user_id, or nothing
 *  (panel-wide). */
export type RealtimeScope = OfAccount | string | null | undefined;

/**
 * Subscribe to the honest realtime state for a scope. Safe to call from several
 * components on one page — `useSSE` shares one refcounted EventSource.
 */
export function useRealtimeStatus(scope?: RealtimeScope): RealtimeStatus {
  const { accounts, loaded } = useAccounts();
  const { isActive: isTourActive } = useTour();
  // bufferSize 1: this hook only needs the connection status, not a backlog.
  const { connected } = useSSE({ bufferSize: 1, disabled: isTourActive });

  const scoped = useMemo(() => {
    if (!scope) return accounts;
    if (typeof scope === "string") {
      const hit = accounts.find((a) => a.of_user_id === scope);
      return hit ? [hit] : [];
    }
    return [scope];
  }, [accounts, scope]);

  return useMemo(() => {
    if (isTourActive) {
      // The guided tour runs on canned data with no backend at all. Claiming
      // "Live" here is a demo, not a claim about the operator's accounts.
      return {
        kind: "live" as const,
        label: "Live",
        tone: "ok" as const,
        detail: "Guided tour — this feed is showing example data.",
        isLive: true,
      };
    }
    return deriveRealtimeStatus(scoped, connected, loaded);
  }, [scoped, connected, loaded, isTourActive]);
}

/** Filled where something is running, hollow where nothing is. Mirrors
 *  AccountStatus so the two indicators read the same way. */
const TONE_DOT: Record<StatusTone, string> = {
  ok: "●",
  warn: "◐",
  bad: "●",
  muted: "○",
};

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-success-500",
  warn: "text-amber-400",
  bad: "text-red-400",
  muted: "text-default-400",
};

const TONE_CHIP: Record<StatusTone, string> = {
  ok: "text-green-400 border-green-500/30 bg-green-500/[0.06]",
  warn: "text-amber-400 border-amber-500/30 bg-amber-500/[0.06]",
  bad: "text-red-400 border-red-500/30 bg-red-500/[0.06]",
  muted: "text-default-400 border-white/[0.08] bg-white/[0.02]",
};

/**
 * Inline "● Live" / "○ Not live" for a page subtitle. Drop-in replacement for
 * the hand-rolled spans that read `connected ? "Live" : "Off"`.
 */
export function RealtimeIndicator({ scope }: { scope?: RealtimeScope }) {
  const status = useRealtimeStatus(scope);
  return (
    <span
      role="status"
      aria-live="polite"
      title={status.detail}
      className={TONE_TEXT[status.tone]}
    >
      <span aria-hidden="true">{TONE_DOT[status.tone]}</span> {status.label}
    </span>
  );
}

/**
 * Bordered pill form, for card headers and the dashboard header bar.
 * `pulseKey` (optional) re-triggers the dot pulse when a new event lands.
 */
export function RealtimeChip({
  scope,
  pulseKey,
  className = "",
}: {
  scope?: RealtimeScope;
  pulseKey?: number;
  className?: string;
}) {
  const status = useRealtimeStatus(scope);
  return (
    <span
      role="status"
      aria-live="polite"
      title={status.detail}
      className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${
        TONE_CHIP[status.tone]
      } ${className}`}
    >
      <motion.span
        key={pulseKey ?? 0}
        aria-hidden="true"
        className="inline-block h-1 w-1 bg-current"
        animate={
          status.isLive ? { scale: [1, 1.6, 1], opacity: [1, 0.6, 1] } : { scale: 1 }
        }
        transition={{ duration: 1.2 }}
      />
      {status.label}
    </span>
  );
}
