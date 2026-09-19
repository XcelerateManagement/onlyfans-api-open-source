"use client";

import { Progress } from "@heroui/progress";
import { AnimatePresence, motion } from "framer-motion";
import type { RefreshJobState } from "@/lib/hooks/use-refresh-jobs";
import { isProxyError } from "@/lib/proxy-error";

interface Props {
  state: RefreshJobState | null;
  /** Label prefix — usually "Subscribers" or "Spending" */
  label: string;
  /** Compact variant for inline use inside a table row. Default false. */
  compact?: boolean;
  /** When set, a job that failed with a proxy/407 error shows a "Fix proxy" button. */
  onFixProxy?: () => void;
}

/** A failed job whose error is a proxy/407 problem. */
function isProxyFailure(s: RefreshJobState): boolean {
  return (s.phase === "error" || s.success === false) && isProxyError(s.error);
}

/** Phrase shown under the bar. Keep it short — this sits inside a table row. */
function phaseLabel(s: RefreshJobState): string {
  if (s.phase === "complete") {
    if (s.success === false) return `Failed: ${s.error ?? "unknown error"}`;
    const new_ = s.rows_inserted ?? 0;
    const upd = s.rows_updated ?? 0;
    const rows =
      new_ + upd > 0
        ? ` · ${new_} new${upd ? `, ${upd} updated` : ""}`
        : "";
    const reason = s.stopped_reason ? ` (${s.stopped_reason.replace(/_/g, " ")})` : "";
    return `Done${reason}${rows}`;
  }
  if (s.phase === "error") return `Error: ${s.error ?? "unknown"}`;
  // Fetching: show page-based progress if we know the total (tx-initial),
  // else a running "X synced · page N" counter (subs + tx-delta — variable
  // page sizes and/or unknown total depth).
  const rowsSoFar = (s.rows_inserted ?? 0) + (s.rows_updated ?? 0);
  if (s.pages_est && s.pages_est > 0) {
    return `Page ${s.pages_done}/${s.pages_est} · ${rowsSoFar} rows`;
  }
  return `${rowsSoFar} synced · page ${s.pages_done}`;
}

/**
 * Thin progress bar with a status line. Renders null when `state` is null, so
 * callers can pass the hook's `get(...)` output directly without guards.
 *
 * Determinate when `pages_est` is set, indeterminate stripes otherwise.
 */
export function RefreshProgressBar({ state, label, compact = false, onFixProxy }: Props) {
  return (
    <AnimatePresence initial={false}>
      {state && (
        <motion.div
          key={state.job_id}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          className={compact ? "w-full" : "w-full py-1"}
        >
          <div className="flex items-center gap-2 text-[11px] tracking-wide text-default-400">
            <span className="font-semibold text-foreground/80">{label}</span>
            <span className="flex-1 truncate">{phaseLabel(state)}</span>
            {onFixProxy && isProxyFailure(state) && (
              <button
                type="button"
                onClick={onFixProxy}
                className="shrink-0 rounded-sm border border-danger/40 bg-danger/10 px-2 py-0.5 font-semibold text-danger-500 hover:bg-danger/20"
              >
                Fix proxy →
              </button>
            )}
          </div>
          <Progress
            aria-label={`${label} refresh progress`}
            size="sm"
            isIndeterminate={state.phase !== "complete" && !state.pages_est}
            value={
              state.pages_est && state.pages_est > 0
                ? Math.min(100, (state.pages_done / state.pages_est) * 100)
                : state.phase === "complete"
                  ? 100
                  : undefined
            }
            maxValue={100}
            color={
              state.phase === "error" || state.success === false
                ? "danger"
                : state.phase === "complete"
                  ? "success"
                  : "primary"
            }
            classNames={{
              base: "mt-0.5",
              track: "h-1 bg-white/[0.06] rounded-none",
              indicator: "rounded-none",
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
