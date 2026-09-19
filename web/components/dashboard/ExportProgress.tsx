"use client";

import { Progress } from "@heroui/progress";
import { motion } from "framer-motion";
import type { ExportJob } from "@/lib/api-client";

const PHASE_LABELS: Record<string, string> = {
  account: "Account profile",
  subscribers: "Subscribers",
  transactions: "Transactions",
  fans: "Fans",
  earnings: "Earnings",
  messages: "Messages",
  media: "Media files",
  packaging: "Packaging",
  complete: "Complete",
  error: "Error",
};

const PHASE_SEQUENCE = [
  "account",
  "subscribers",
  "transactions",
  "fans",
  "earnings",
  "messages",
];

/** Reconstruct the ordered phase plan the worker runs for this job. */
function planFor(job: ExportJob): string[] {
  const phases = PHASE_SEQUENCE.filter((p) => job.data_types?.includes(p));
  const withMedia =
    job.include_media && phases.includes("messages")
      ? [...phases, "media"]
      : phases;
  return [...withMedia, "packaging"];
}

/** A short human summary of the current phase's counters. */
function countsLine(job: ExportJob): string {
  const c = job.counts || {};
  const m = c.messages;
  if (job.phase === "messages" && m && typeof m === "object") {
    if (m.discovering) {
      const found = m.discovered ?? 0;
      return found > 0
        ? `found ${found.toLocaleString()} conversations…`
        : "finding conversations…";
    }
    const total = m.chats_total ?? 0;
    const done = m.chats_done ?? 0;
    const remaining = Math.max(0, total - done);
    return `${done}/${total} conversations · ${remaining} remaining · ${(m.messages ?? 0).toLocaleString()} messages scraped`;
  }
  const md = c.media;
  if (job.phase === "media" && md && typeof md === "object") {
    const mb = md.bytes ? ` · ${(md.bytes / (1024 * 1024)).toFixed(0)} MB` : "";
    return `${md.downloaded ?? 0} downloaded${md.failed ? `, ${md.failed} failed` : ""}${mb}`;
  }
  const cur = c[job.phase as string];
  if (typeof cur === "number") return `${cur.toLocaleString()} rows`;
  return "";
}

/** Running tally of live platform API calls this export has spent. */
export function apiCallsOf(job: ExportJob): number {
  const c = job.counts || {};
  return typeof c.api_calls === "number" ? c.api_calls : 0;
}

/**
 * Live progress bar for one running export. Determinate by phase position
 * (we don't have exact row totals up front, so the bar advances per phase and
 * the status line carries the running counters). Matches the thin
 * RefreshProgressBar aesthetic.
 */
export function ExportProgress({ job }: { job: ExportJob }) {
  const running = job.status === "queued" || job.status === "running";
  const failed = job.status === "failed";
  const complete = job.status === "complete";

  const plan = planFor(job);
  const idx = job.phase ? plan.indexOf(job.phase) : -1;
  const percent = complete
    ? 100
    : idx >= 0
      ? Math.min(95, Math.round(((idx + 0.5) / plan.length) * 100))
      : 5;

  const canceled = job.status === "canceled";
  const label = complete
    ? "Done"
    : canceled
      ? "Canceled"
      : failed
        ? `Failed: ${job.error || "unknown error"}`
        : PHASE_LABELS[job.phase || ""] || "Working…";

  const calls = apiCallsOf(job);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      transition={{ duration: 0.18 }}
      className="w-full py-1"
    >
      <div className="flex items-center gap-2 text-[11px] tracking-wide text-default-400">
        <span className="font-semibold text-foreground/80">{label}</span>
        <span className="flex-1 truncate">{!failed && countsLine(job)}</span>
        {calls > 0 && (
          <span className="shrink-0 text-default-500">{calls} API calls</span>
        )}
      </div>
      <Progress
        aria-label="Export progress"
        size="sm"
        isIndeterminate={running && job.status === "queued"}
        value={percent}
        maxValue={100}
        color={failed ? "danger" : canceled ? "default" : complete ? "success" : "primary"}
        classNames={{
          base: "mt-0.5",
          track: "h-1 bg-white/[0.06] rounded-none",
          indicator: "rounded-none",
        }}
      />
    </motion.div>
  );
}
