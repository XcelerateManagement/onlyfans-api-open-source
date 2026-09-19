"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

import { useAccounts, type OfAccount } from "@/lib/hooks/use-selected-account";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS } from "@/lib/tour-fake-data";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { cn } from "@/lib/utils";
import { parseUtc } from "@/lib/chat-utils";
import {
  PxShield,
  PxLink,
  PxActivity,
  PxRefresh,
  PxCheck,
  PxChevronRight,
} from "@/components/ui/PixelIcons";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";

/** Failure count at which the poller flips `polling_enabled` off by itself.
 *  Mirrors poller.poll_account's auto-pause threshold. */
const AUTO_PAUSE_FAILURES = 5;

/** Floor for the staleness window. The backend's admin health query uses a flat
 *  10 minutes; here we take the larger of that and 2x the account's own poll
 *  interval, so a deliberately slow 30-minute account isn't reported as broken. */
const LAG_FLOOR_MS = 10 * 60 * 1000;

/** How many affected accounts to name inline before deferring to the list page. */
const INLINE_LIMIT = 6;

type Severity = "critical" | "serious" | "warning" | "neutral";

interface Bucket {
  key: string;
  label: string;
  hint: string;
  severity: Severity;
  icon: React.ReactNode;
  accounts: OfAccount[];
}

const SEVERITY_STYLE: Record<Severity, { dot: string; text: string; border: string }> = {
  critical: { dot: "bg-red-500", text: "text-red-400", border: "border-red-500/30" },
  serious: { dot: "bg-orange-500", text: "text-orange-400", border: "border-orange-500/30" },
  warning: { dot: "bg-amber-400", text: "text-amber-300", border: "border-amber-400/30" },
  neutral: { dot: "bg-white/30", text: "text-default-400", border: "border-white/[0.08]" },
};

function accountLabel(a: OfAccount): string {
  return a.username || a.email || a.of_user_id;
}

/**
 * "How many accounts are broken right now."
 *
 * Everything here is derived from the account rows the AccountProvider has
 * already fetched — this card issues ZERO requests of its own, which is the
 * only shape that survives 600 connected accounts. The panel-scoped equivalents
 * on the backend (`poller_paused_accounts` / `poller_lagging_accounts`) are not
 * usable from here: they live behind `/api/admin/system/health`, which requires
 * an admin session and counts across ALL tenants, not this panel.
 */
export function AccountHealthCard() {
  const { accounts: realAccounts } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const accounts = isTourActive ? TOUR_ACCOUNTS : realAccounts;
  const [expanded, setExpanded] = useState<string | null>(null);

  const { buckets, attention, healthy } = useMemo(() => {
    const now = Date.now();
    const needsReconnect: OfAccount[] = [];
    const needsVerification: OfAccount[] = [];
    const connectionIssues: OfAccount[] = [];
    const paused: OfAccount[] = [];
    const lagging: OfAccount[] = [];
    const neverPolled: OfAccount[] = [];

    for (const a of accounts) {
      if (a.needs_reconnect) needsReconnect.push(a);
      if (a.needs_verification) needsVerification.push(a);
      if (["proxy_error", "rate_limited", "sync_blocked", "temporary_error"].includes(a.connection_state || "")) {
        connectionIssues.push(a);
        continue;
      }

      const failures = a.polling_failure_count ?? 0;
      // The poller turns `polling_enabled` off once it hits the threshold, so
      // "paused" is polling-OFF *with* accumulated failures. (A plain
      // polling_enabled=0 with no failures is the user's own choice, not a
      // fault — do not report it.) Note this is the inverse of the backend's
      // admin query, which looks for polling_enabled=1 AND failures>=5 and can
      // therefore essentially never match.
      if (!a.polling_enabled && failures >= AUTO_PAUSE_FAILURES) {
        paused.push(a);
        continue;
      }
      if (!a.polling_enabled) continue;

      if (!a.last_polled_at) {
        neverPolled.push(a);
        continue;
      }
      // parseUtc, NOT Date.parse. The backend stores last_polled_at without a
      // timezone ("2026-08-05T16:19:13"), and per the ECMAScript spec a
      // date-TIME string with no offset is parsed as LOCAL time. In UTC+2 that
      // silently ages every timestamp by two hours, which is well past the
      // 10-minute floor below — so every polling account was reported as
      // "lagging" the moment it was polled. Measured: 7228s instead of 28s.
      const lastDate = parseUtc(a.last_polled_at);
      const last = lastDate ? lastDate.getTime() : NaN;
      if (!Number.isFinite(last)) continue;
      const interval = (a.polling_interval_seconds ?? 0) * 1000;
      const window = Math.max(LAG_FLOOR_MS, interval * 2);
      if (now - last > window) lagging.push(a);
    }

    const list: Bucket[] = [
      {
        key: "reconnect",
        label: "Login failed",
        hint: "The saved login was rejected. Open the account to see the exact safe reason and action.",
        severity: "critical",
        icon: <PxLink className="h-3.5 w-3.5" />,
        accounts: needsReconnect,
      },
      {
        key: "verification",
        label: "Verification needed",
        hint: "OnlyFans is refusing this account until someone passes a face check on the account's own IP. Reconnecting will not help.",
        severity: "critical",
        icon: <PxLink className="h-3.5 w-3.5" />,
        accounts: needsVerification,
      },
      {
        key: "connection",
        label: "Sync blocked",
        hint: "A proxy, rate limit, local dependency, or temporary upstream failure is preventing a healthy sync. This is not a password failure.",
        severity: "serious",
        icon: <PxActivity className="h-3.5 w-3.5" />,
        accounts: connectionIssues,
      },
      {
        key: "paused",
        label: "Polling paused",
        hint: `The poller disabled itself after ${AUTO_PAUSE_FAILURES} consecutive failures.`,
        severity: "serious",
        icon: <PxActivity className="h-3.5 w-3.5" />,
        accounts: paused,
      },
      {
        key: "lagging",
        label: "Polling lagging",
        hint: "Last poll is older than twice the account's interval (min 10 min) — the scheduler is behind.",
        severity: "warning",
        icon: <PxRefresh className="h-3.5 w-3.5" />,
        accounts: lagging,
      },
      {
        key: "never",
        label: "Never polled",
        hint: "Polling is on but no run has completed yet.",
        severity: "neutral",
        icon: <PxRefresh className="h-3.5 w-3.5" />,
        accounts: neverPolled,
      },
    ];

    // An account can land in several buckets (e.g. needs_reconnect AND
    // lagging), so the headline counts distinct accounts, not bucket sums.
    const distinct = new Set<string>();
    for (const b of list) for (const a of b.accounts) distinct.add(a.of_user_id);

    return {
      buckets: list,
      attention: distinct.size,
      healthy: Math.max(0, accounts.length - distinct.size),
    };
  }, [accounts]);

  const animatedAttention = useCountUp(attention, 500);
  const allWell = attention === 0 && accounts.length > 0;

  return (
    <GlassCard delay={0.05}>
      <GlassCardHeader className="!px-4 !py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PxShield className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Account Health
            </h3>
          </div>
          <Link
            href="/dashboard/accounts"
            className="text-[10px] uppercase tracking-wider text-default-500 hover:text-foreground transition-colors"
          >
            All accounts →
          </Link>
        </div>
      </GlassCardHeader>

      <GlassCardBody className="!p-0">
        {/* Headline */}
        <div className="flex items-baseline gap-2 px-4 py-3 border-b border-white/[0.06]">
          {allWell ? (
            <>
              <PxCheck className="h-4 w-4 text-green-400 self-center" />
              <span className="text-sm font-semibold text-green-400">
                All {accounts.length} accounts healthy
              </span>
            </>
          ) : (
            <>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  attention > 0 ? "text-red-400" : "text-default-400"
                )}
              >
                {Math.round(animatedAttention)}
              </span>
              <span className="text-[11px] uppercase tracking-wider text-default-500">
                {attention === 1 ? "account needs" : "accounts need"} attention
              </span>
              <span className="ml-auto text-[11px] text-default-500 tabular-nums self-center">
                {healthy}/{accounts.length} ok
              </span>
            </>
          )}
        </div>

        {/* Buckets */}
        <div className="divide-y divide-white/[0.06]">
          {buckets.map((b) => {
            const style = SEVERITY_STYLE[b.severity];
            const count = b.accounts.length;
            const isOpen = expanded === b.key;
            return (
              <div key={b.key}>
                <button
                  type="button"
                  disabled={count === 0}
                  onClick={() => setExpanded(isOpen ? null : b.key)}
                  title={b.hint}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                    count > 0
                      ? "hover:bg-white/[0.02] cursor-pointer"
                      : "cursor-default opacity-50"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0",
                      count > 0 ? style.dot : "bg-white/20"
                    )}
                  />
                  <span
                    className={cn(
                      "shrink-0",
                      count > 0 ? style.text : "text-default-500"
                    )}
                  >
                    {b.icon}
                  </span>
                  <span className="text-[11px] uppercase tracking-wider text-default-500 flex-1 truncate">
                    {b.label}
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold tabular-nums",
                      count > 0 ? style.text : "text-default-500"
                    )}
                  >
                    {count}
                  </span>
                  {count > 0 && (
                    <motion.span
                      animate={{ rotate: isOpen ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-default-500 shrink-0"
                    >
                      <PxChevronRight className="h-3 w-3" />
                    </motion.span>
                  )}
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && count > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="overflow-hidden"
                    >
                      <div
                        className={cn(
                          "mx-4 mb-3 border-l pl-3 space-y-1",
                          style.border
                        )}
                      >
                        <p className="text-[10px] text-default-500 leading-relaxed pt-1">
                          {b.hint}
                        </p>
                        {b.accounts.slice(0, INLINE_LIMIT).map((a) => (
                          <Link
                            key={a.of_user_id}
                            href={`/dashboard/accounts/${a.of_user_id}`}
                            className="block text-[11px] font-mono text-default-400 hover:text-foreground transition-colors truncate"
                          >
                            {accountLabel(a)}
                          </Link>
                        ))}
                        {count > INLINE_LIMIT && (
                          <Link
                            href="/dashboard/accounts"
                            className="block text-[10px] uppercase tracking-wider text-[color:var(--theme-accent,#f54900)] hover:underline pt-0.5"
                          >
                            +{count - INLINE_LIMIT} more →
                          </Link>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </GlassCardBody>
    </GlassCard>
  );
}
