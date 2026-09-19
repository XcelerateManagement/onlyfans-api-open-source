"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Switch } from "@heroui/switch";
import { Chip } from "@heroui/chip";
import {
  PxFileText,
  PxCheck,
  PxRefresh,
} from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useExportJobs } from "@/lib/hooks/use-export-jobs";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { ExportProgress, apiCallsOf } from "@/components/dashboard/ExportProgress";
import {
  isPlatformNotSupported,
  platformUnsupportedMessage,
  type ExportJob,
  type ExportStatus,
} from "@/lib/api-client";
import { platformLabel } from "@/lib/platform-capabilities";
import toast from "react-hot-toast";

const DATA_TYPES: { key: string; label: string; hint: string; quota?: boolean }[] = [
  { key: "account", label: "Account profile", hint: "Your profile info" },
  { key: "subscribers", label: "Subscribers", hint: "Subscriber list + spend" },
  { key: "transactions", label: "Transactions & tips", hint: "Full payment ledger" },
  { key: "fans", label: "Fans", hint: "Fan list, tags & totals" },
  { key: "earnings", label: "Earnings", hint: "Revenue summary", quota: true },
  { key: "messages", label: "Messages", hint: "Full conversation history", quota: true },
];

const STATUS_COLOR: Record<ExportStatus, "default" | "primary" | "success" | "danger" | "warning"> = {
  queued: "warning",
  running: "primary",
  complete: "success",
  failed: "danger",
  canceled: "default",
  expired: "default",
};

function fmtSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function rangeLabel(job: ExportJob): string {
  if (!job.since && !job.until) return "All time";
  return `${job.since || "start"} → ${job.until || "now"}`;
}

/**
 * Human-readable failure line for a job. Never echoes a raw 501 /
 * platform_not_supported payload or a backend traceback — those get mapped to
 * friendly copy; short human-written backend messages pass through.
 */
function friendlyJobError(job: ExportJob): string {
  const raw = (job.error || "").trim();
  if (!raw) return "Export failed.";
  if (/platform_not_supported|\b501\b/i.test(raw)) {
    return platformUnsupportedMessage(undefined, job.platform);
  }
  if (/traceback|<html|exception:|errno/i.test(raw) || raw.length > 200) {
    return "Export failed — try again, or narrow the date range and data types.";
  }
  return raw;
}

/** Same sanitation for per-section warning notes. */
function friendlyWarning(w: { phase: string; error?: string | null }): string {
  const raw = (w.error || "").trim();
  if (!raw) return "section came back incomplete";
  if (/platform_not_supported|\b501\b/i.test(raw)) {
    return "not available on this platform yet";
  }
  if (/traceback|<html|exception:|errno/i.test(raw) || raw.length > 200) {
    return "section came back incomplete";
  }
  return raw;
}

export default function ExportPage() {
  const api = useApiClient();
  const { selectedAccount } = useAccounts();
  const ofUserId = selectedAccount?.of_user_id ?? null;
  const isFansly = selectedAccount?.platform === "fansly";

  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [selected, setSelected] = useState<Set<string>>(
    new Set(DATA_TYPES.map((d) => d.key))
  );
  const [includeMedia, setIncludeMedia] = useState(false);
  const [creating, setCreating] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const { jobs, activeCount, loading, error: jobsError, refresh } =
    useExportJobs(ofUserId);

  const liveCost = useMemo(
    () => selected.has("messages") || selected.has("earnings") || includeMedia,
    [selected, includeMedia]
  );

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyPreset(days: number | "all" | "year") {
    const now = new Date();
    if (days === "all") {
      setSince("");
      setUntil("");
      return;
    }
    setUntil(now.toISOString().slice(0, 10));
    if (days === "year") {
      setSince(`${now.getFullYear()}-01-01`);
    } else {
      const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      setSince(past.toISOString().slice(0, 10));
    }
  }

  async function handleCreate() {
    if (!api || !ofUserId) return;
    if (selected.size === 0) {
      toast.error("Select at least one data type to export.");
      return;
    }
    setCreating(true);
    try {
      const res = await api.createExport(ofUserId, {
        dataTypes: [...selected],
        since: since || null,
        until: until || null,
        includeMedia: includeMedia && !isFansly,
      });
      setWarning(res.warning || null);
      if (res.already_running) {
        toast("An export is already running for this account.");
      } else {
        toast.success("Export started — track its progress below.");
      }
      await refresh();
    } catch (e: any) {
      if (isPlatformNotSupported(e)) {
        toast.error(platformUnsupportedMessage(e.data?.feature, e.data?.platform));
      } else {
        toast.error(e?.data?.error || "Failed to start export.");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(jobId: string) {
    if (!api || !ofUserId) return;
    try {
      await api.deleteExport(ofUserId, jobId);
      await refresh();
    } catch (e: any) {
      toast.error(e?.data?.error || "Failed to delete export.");
    }
  }

  async function handleCancel(jobId: string) {
    if (!api || !ofUserId) return;
    try {
      await api.cancelExport(ofUserId, jobId);
      toast("Stopping export…");
      await refresh();
    } catch (e: any) {
      toast.error(e?.data?.error || "Failed to cancel export.");
    }
  }

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxFileText className="h-8 w-8" />}
        title="No account selected"
        description="Select an account from the header dropdown to export its data."
        pattern="waves"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2 className="heading-2">Export Data</h2>
        <p className="text-sm text-default-500 mt-1">
          Download a copy of {selectedAccount.username || selectedAccount.email}
          &apos;s data — messages, tips, subscribers and more, packaged as CSV + JSON.
        </p>
      </motion.div>

      {/* Builder */}
      <GlassCard className="p-5" delay={0.05}>
        <div className="space-y-5">
          {/* Date range */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs uppercase tracking-wider text-default-400 font-semibold">
                Date range
              </label>
              <div className="flex gap-1.5">
                {([
                  ["All time", "all"],
                  ["30d", 30],
                  ["90d", 90],
                  ["This year", "year"],
                ] as const).map(([label, val]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => applyPreset(val as any)}
                    className="text-[11px] px-2 py-1 border border-white/[0.08] text-default-400 hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] hover:text-foreground transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                type="date"
                label="From"
                value={since}
                onChange={(e) => setSince(e.target.value)}
                variant="bordered"
                className="w-44"
                classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
              />
              <Input
                type="date"
                label="To"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
                variant="bordered"
                className="w-44"
                classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
              />
              <span className="text-[11px] text-default-500 pb-2">
                Leave empty for everything.
              </span>
            </div>
          </div>

          {/* Data types */}
          <div>
            <label className="text-xs uppercase tracking-wider text-default-400 font-semibold mb-2 block">
              What to include
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {DATA_TYPES.map((d) => {
                const on = selected.has(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggle(d.key)}
                    className={`flex items-start gap-2 p-3 text-left border transition-colors ${
                      on
                        ? "border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.5)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.06)]"
                        : "border-white/[0.08] hover:border-white/[0.16]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${
                        on
                          ? "bg-accent border-accent text-white"
                          : "border-white/20 text-transparent"
                      }`}
                    >
                      <PxCheck className="h-3 w-3" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {d.label}
                        {d.quota && (
                          <span className="text-[9px] uppercase tracking-wide text-amber-500/80 border border-amber-500/30 px-1">
                            live
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] text-default-500">{d.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Media toggle */}
          <div className="flex items-center justify-between border border-white/[0.06] p-3">
            <div>
              <div className="text-sm font-medium text-foreground">Include media files</div>
              <div className="text-[11px] text-default-500">
                {isFansly
                  ? "Media download is OnlyFans-only for now — attachment URLs are listed in the message JSON."
                  : "Download images/videos from messages. Much larger and slower."}
              </div>
            </div>
            <Switch
              isSelected={includeMedia && !isFansly}
              isDisabled={isFansly || !selected.has("messages")}
              onValueChange={setIncludeMedia}
              size="sm"
            />
          </div>

          {/* Fansly completeness note — cached transaction/subscriber tables
              aren't synced for Fansly yet, so those sections can come back
              lighter than the live wallet. Remove once the fansly tx sync lands. */}
          {isFansly && (
            <div className="text-[11px] text-default-400 border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              {platformLabel(selectedAccount.platform)} exports: transaction and
              subscriber sections may be incomplete until background syncing
              reaches {platformLabel(selectedAccount.platform)} accounts. Any
              section that comes back short is flagged in the export notes below.
            </div>
          )}

          {/* Quota note + action */}
          {liveCost && (
            <div className="text-[11px] text-amber-500/90 border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2">
              Messages, earnings and media are fetched live from the platform — this
              can take a few minutes and counts against your monthly API quota.
              Subscribers, transactions and fans export instantly and free.
            </div>
          )}

          <div className="flex items-center gap-3">
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold"
                onPress={handleCreate}
                isLoading={creating}
                startContent={!creating ? <PxFileText className="h-4 w-4" /> : undefined}
              >
                Create export
              </Button>
            </motion.div>
            {activeCount > 0 && (
              <span className="text-[11px] text-default-500">
                {activeCount} export{activeCount > 1 ? "s" : ""} in progress…
              </span>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Create-time warning from the backend (e.g. a section it already knows
          will be incomplete for this platform). Previously set but never shown. */}
      {warning && (
        <div className="border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 text-[12px] text-amber-500/90">
          {warning}
        </div>
      )}

      {/* History */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm uppercase tracking-wider text-default-400 font-semibold">
            Your exports
          </h3>
          <button
            type="button"
            onClick={() => refresh()}
            className="flex items-center gap-1.5 text-[11px] text-default-400 hover:text-foreground transition-colors"
          >
            <PxRefresh className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>

        <DataState
          compact
          loading={loading}
          error={jobsError}
          isEmpty={jobs.length === 0}
          onRetry={refresh}
          noun="export history"
          skeleton={
            <div className="border border-white/[0.06] bg-[#0d0d0d] p-8 text-center text-sm text-default-500">
              Loading…
            </div>
          }
          emptyContent={
            <div className="border border-white/[0.06] bg-[#0d0d0d] p-8 text-center text-sm text-default-500">
              No exports yet. Create one above to get started.
            </div>
          }
        >
          <div className="space-y-2">
            {jobs.map((job) => {
              const running = job.status === "queued" || job.status === "running";
              const downloadable = job.status === "complete";
              return (
                <div
                  key={job.job_id}
                  className="border border-white/[0.06] bg-[#0d0d0d] p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Chip
                          size="sm"
                          variant="flat"
                          color={STATUS_COLOR[job.status]}
                          className="rounded-none capitalize"
                        >
                          {job.status}
                        </Chip>
                        <span className="text-sm text-foreground truncate">
                          {(job.data_types || []).join(", ")}
                          {job.include_media ? " + media" : ""}
                        </span>
                      </div>
                      <div className="text-[11px] text-default-500 mt-1">
                        {rangeLabel(job)} · {fmtDate(job.created_at)}
                        {downloadable && ` · ${fmtSize(job.file_size)}`}
                        {apiCallsOf(job) > 0 && ` · ${apiCallsOf(job).toLocaleString()} API calls`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {downloadable && api && ofUserId && (
                        <a
                          href={api.downloadExportUrl(ofUserId, job.job_id)}
                          download
                          className="bg-accent text-white hover:bg-accent-hover px-3 py-1.5 text-xs uppercase tracking-wider font-bold"
                        >
                          Download
                        </a>
                      )}
                      {running && (
                        <button
                          type="button"
                          onClick={() => handleCancel(job.job_id)}
                          className="px-3 py-1.5 text-xs border border-white/[0.08] text-default-400 hover:border-danger/40 hover:text-danger-500 transition-colors"
                        >
                          Stop
                        </button>
                      )}
                      {!running && (
                        <button
                          type="button"
                          onClick={() => handleDelete(job.job_id)}
                          className="px-3 py-1.5 text-xs border border-white/[0.08] text-default-400 hover:border-danger/40 hover:text-danger-500 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  {running && <ExportProgress job={job} />}

                  {/* Per-section warnings (e.g. a 0-row section against a
                      non-empty wallet) — show the actual note, not just the
                      phase name, so short sections aren't silently trusted. */}
                  {job.status === "complete" && job.warnings && job.warnings.length > 0 && (
                    <div className="mt-2 border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2 space-y-0.5">
                      <div className="text-[11px] font-semibold text-amber-500/90">
                        Completed with notes:
                      </div>
                      {job.warnings.map((w, i) => (
                        <div key={`${w.phase}-${i}`} className="text-[11px] text-amber-500/80">
                          <span className="capitalize">{w.phase}</span>
                          {` — ${friendlyWarning(w)}`}
                        </div>
                      ))}
                    </div>
                  )}
                  {job.status === "failed" && (
                    <div className="mt-2 text-[11px] text-danger-500">
                      {friendlyJobError(job)}
                    </div>
                  )}
                  {job.status === "expired" && (
                    <div className="mt-2 text-[11px] text-default-500">
                      This archive has expired and is no longer downloadable.
                    </div>
                  )}
                  {job.status === "canceled" && (
                    <div className="mt-2 text-[11px] text-default-500">
                      Stopped
                      {apiCallsOf(job) > 0
                        ? ` after ${apiCallsOf(job).toLocaleString()} API calls.`
                        : "."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DataState>
      </motion.div>
    </div>
  );
}
