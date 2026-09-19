"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@heroui/progress";
import toast from "react-hot-toast";

import {
  ApiError,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  type ImportJob,
  type ImportJobRow,
  type ImportPreviewResponse,
} from "@/lib/api-client";
import {
  IMPORT_COLUMN_ALIASES,
  IMPORT_EXAMPLE,
  IMPORT_STATE_ORDER,
  analysePaste,
  countOf,
  formatBytes,
  parkedCount,
  settledCount,
  stateChipClass,
  stateDotClass,
  stateLabel,
} from "@/lib/import-format";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useImportJob } from "@/lib/hooks/use-import-job";
import { usePendingTwoFactor } from "@/lib/hooks/use-pending-2fa";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { ImportPreviewTable } from "@/components/dashboard/ImportPreviewTable";
import { ImportRowsTable } from "@/components/dashboard/ImportRowsTable";
import { ImportOtpRow } from "@/components/dashboard/ImportOtpRow";
import {
  PxCopy,
  PxLock,
  PxPaperclip,
  PxRefresh,
  PxUsers,
  PxZap,
} from "@/components/ui/PixelIcons";

type View = "compose" | "preview" | "job";

/** How many parked rows get an inline code box up top before we stop and point
 *  at the filtered table. Beyond this the pinned queue stops being a queue. */
const QUEUE_VISIBLE = 8;

/** Turn any thrown value into one honest sentence. Never renders a transport
 *  failure as "nothing here" — that distinction is the whole point of
 *  `ApiError.isTransport`. */
function errorLine(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.isRateLimit) {
      return e.retryAfter
        ? `Rate limit reached — try again in ${e.retryAfter}s.`
        : "Rate limit reached — try again shortly.";
    }
    if (e.status === 404) {
      return "This panel's API doesn't have the bulk importer yet.";
    }
    if (e.isTransport) {
      return "Could not reach the API. Nothing was submitted — try again.";
    }
    return e.data?.error || e.message || fallback;
  }
  return fallback;
}

export default function BulkImportPage() {
  const api = useApiClient();
  const pending2fa = usePendingTwoFactor();

  const [view, setView] = useState<View>("compose");
  const [text, setText] = useState("");
  const [defaultPlatform, setDefaultPlatform] = useState<"onlyfans" | "fansly">(
    "onlyfans"
  );

  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [history, setHistory] = useState<ImportJob[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  /** Latch for the "jump to the job with parked codes" convenience below. */
  const autoOpened = useRef(false);

  const job = useImportJob(jobId);

  // ── One clock for every countdown on the page ────────────────────────────
  // Parked rows each show a live OTP timer. They share this tick rather than
  // owning an interval apiece, so 600 rows cost one timer, not 600.
  const [now, setNow] = useState(() => Date.now());
  const parked = useMemo(
    () =>
      job.rows.filter(
        (r) => r.state === "needs_2fa" || r.state === "needs_2fa_expired"
      ),
    [job.rows]
  );
  const needsClock = parked.length > 0;
  useEffect(() => {
    if (!needsClock) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [needsClock]);

  // ── Deep link / resume ───────────────────────────────────────────────────
  // Read `?job=` once on the client so the page doesn't need a Suspense
  // boundary just to look at the query string.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("job");
    if (q) {
      setJobId(q);
      setView("job");
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!api) return;
    try {
      const res = await api.listImportJobs(10);
      setHistory(res?.jobs ?? []);
      setHistoryError(null);
    } catch (e) {
      setHistory(null);
      setHistoryError(errorLine(e, "Could not load previous imports."));
    }
  }, [api]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Arriving from the dashboard-wide banner with no job chosen: jump to
  // whichever job is actually holding parked logins. This is the "don't lose
  // 2FA work by closing the importer" path — the operator clicks one link and
  // lands on the codes.
  useEffect(() => {
    // Once only. Without this latch, "New import" would be unusable for as long
    // as any row stays parked: clearing the job would immediately re-trigger
    // this and bounce the operator straight back to the old one.
    if (autoOpened.current) return;
    if (jobId || view !== "compose") return;
    const first = pending2fa.rows[0];
    if (first?.job_id) {
      autoOpened.current = true;
      setJobId(first.job_id);
      setView("job");
    }
  }, [jobId, view, pending2fa.rows]);

  // ── Pre-flight ───────────────────────────────────────────────────────────
  const stats = useMemo(() => analysePaste(text), [text]);
  const canPreview = stats.rowCount > 0 && !stats.blocker && !!api;

  async function handlePreview() {
    if (!api || !canPreview) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await api.previewImport(text, { platform: defaultPlatform });
      setPreview(res);
      setView("preview");
    } catch (e) {
      setPreviewError(errorLine(e, "Could not check this list."));
    } finally {
      setPreviewing(false);
    }
  }

  async function handleCreate() {
    if (!api || !preview) return;
    setCreating(true);
    try {
      const res = await api.createImportJob(text, { platform: defaultPlatform });
      const created = res?.job;
      if (!created?.job_id) throw new ApiError(0, { error: "No job returned." });
      setJobId(created.job_id);
      setView("job");
      setPreview(null);
      void loadHistory();
      toast.success(`Importing ${created.total ?? willImport} accounts`);
    } catch (e) {
      toast.error(errorLine(e, "Could not start the import."));
    } finally {
      setCreating(false);
    }
  }

  async function handleCancel() {
    try {
      await job.cancel();
      toast("Stopping import…");
    } catch (e) {
      toast.error(errorLine(e, "Could not cancel the import."));
    }
  }

  function handleFile(file: File | null) {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      toast.error(
        `That file is ${formatBytes(file.size)} — the limit is ${formatBytes(
          IMPORT_MAX_BYTES
        )}.`
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsText(file);
  }

  const previewCounts = preview?.counts ?? {};
  const willImport = countOf(previewCounts, "pending");
  const manual2fa =
    preview?.needs_manual_2fa ??
    (preview?.rows ?? []).filter((r) => r.state === "pending" && !r.has_totp_secret)
      .length;

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <h2 className="heading-2">Bulk Import</h2>
          <p className="text-sm text-default-500 mt-1">
            Paste a list of accounts and walk away. Logins run in the background —
            one that asks for a 2FA code waits for you without holding up the rest.
          </p>
        </div>
        {view !== "compose" && (
          <button
            type="button"
            onClick={() => {
              // Asking for a blank importer is an explicit choice — hold the
              // latch so the parked-job jump can't undo it.
              autoOpened.current = true;
              setView("compose");
              setPreview(null);
              setJobId(null);
            }}
            className="border border-white/[0.08] px-3 py-1.5 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
          >
            New import
          </button>
        )}
      </motion.div>

      {/* ── Compose ──────────────────────────────────────────────────── */}
      {view === "compose" && (
        <>
          <GlassCard className="p-5" delay={0.05}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="import-paste"
                  className="text-xs uppercase tracking-wider text-default-400 font-semibold"
                >
                  Paste your accounts
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.tsv,.txt,text/plain,text/csv"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
                  >
                    <PxPaperclip className="h-3 w-3" />
                    Or load a file
                  </button>
                  {text && (
                    <button
                      type="button"
                      onClick={() => setText("")}
                      className="border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              <textarea
                id="import-paste"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  "creator.one@example.com,hunter2,onlyfans,http://user:pw@1.2.3.4:8000,JBSWY3DPEHPK3PXP\ncreator.two@example.com:hunter3\n…"
                }
                className="w-full h-64 bg-black/30 border border-white/[0.08] px-3 py-2.5 text-[12px] font-mono leading-relaxed text-foreground placeholder:text-white/15 outline-none focus:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] resize-y styled-scrollbar"
              />

              {/* Pre-flight readout. The caps are stated here, next to the box,
                  and enforced before submit — never discovered as a server
                  error after the operator has already pasted 1200 lines. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                <span
                  className={`tabular-nums ${
                    stats.overRows ? "text-red-400 font-semibold" : "text-default-500"
                  }`}
                >
                  {stats.rowCount.toLocaleString()} / {IMPORT_MAX_ROWS.toLocaleString()} rows
                </span>
                <span
                  className={`tabular-nums ${
                    stats.overBytes ? "text-red-400 font-semibold" : "text-default-500"
                  }`}
                >
                  {formatBytes(stats.bytes)} / {formatBytes(IMPORT_MAX_BYTES)}
                </span>
                {stats.commentLines > 0 && (
                  <span className="text-default-500">
                    {stats.commentLines} comment
                    {stats.commentLines === 1 ? "" : "s"} ignored
                  </span>
                )}
                {stats.blankLines > 0 && (
                  <span className="text-default-500">
                    {stats.blankLines} blank line
                    {stats.blankLines === 1 ? "" : "s"} ignored
                  </span>
                )}
              </div>

              <AnimatePresence>
                {stats.blocker && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-[12px] border border-red-500/30 bg-red-500/[0.06] text-red-300 px-3 py-2"
                  >
                    Too big to import in one go: {stats.blocker}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Default platform */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-default-500">
                  Platform for rows that don&apos;t name one:
                </span>
                {(["onlyfans", "fansly"] as const).map((p) => {
                  const on = defaultPlatform === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDefaultPlatform(p)}
                      className={`border px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                        on
                          ? "border-accent bg-accent/10 text-white"
                          : "border-white/[0.08] text-default-400 hover:border-white/[0.2]"
                      }`}
                    >
                      {p === "onlyfans" ? "OnlyFans" : "Fansly"}
                    </button>
                  );
                })}
              </div>

              {previewError && (
                <p className="text-[12px] border border-red-500/30 bg-red-500/[0.06] text-red-300 px-3 py-2">
                  {previewError}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={!canPreview || previewing}
                  className="dashboard-btn-primary bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold px-4 py-2 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {previewing ? "Checking…" : "Check this list"}
                </button>
                <span className="text-[11px] text-default-500">
                  Nothing is imported yet — this only reads your list and tells you
                  what would happen.
                </span>
              </div>
            </div>
          </GlassCard>

          <FormatHelp onUseExample={() => setText(IMPORT_EXAMPLE)} />

          <ImportHistory
            jobs={history}
            error={historyError}
            onOpen={(id) => {
              setJobId(id);
              setView("job");
            }}
          />
        </>
      )}

      {/* ── Preview ──────────────────────────────────────────────────── */}
      {view === "preview" && preview && (
        <>
          <GlassCard className="p-5" delay={0.05}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <SummaryTile
                  label="Will import"
                  value={willImport}
                  tone="success"
                />
                <SummaryTile
                  label="Already connected"
                  value={countOf(previewCounts, "skipped")}
                  tone="muted"
                />
                <SummaryTile
                  label="Can't read"
                  value={countOf(previewCounts, "invalid")}
                  tone="danger"
                />
                {countOf(previewCounts, "slot_exhausted") > 0 && (
                  <SummaryTile
                    label="No slot"
                    value={countOf(previewCounts, "slot_exhausted")}
                    tone="warning"
                  />
                )}
              </div>

              {preview.detected && (
                <p className="text-[11px] text-default-500">
                  Read as{" "}
                  <span className="text-default-400">
                    {preview.detected.has_header
                      ? "a header row plus data"
                      : "data with no header"}
                  </span>
                  {preview.detected.delimiter ? (
                    <>
                      , split on{" "}
                      <code className="font-mono text-default-400">
                        {preview.detected.delimiter === "\t"
                          ? "tab"
                          : preview.detected.delimiter}
                      </code>
                    </>
                  ) : null}
                  {preview.detected.columns?.length ? (
                    <>
                      {" "}
                      → {preview.detected.columns.join(", ")}
                    </>
                  ) : null}
                  .
                </p>
              )}

              {/* The single most valuable thing to learn BEFORE starting: how
                  many logins will stop and wait for a hand-typed code. */}
              {manual2fa > 0 && (
                <div className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5">
                  <PxLock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-amber-300">
                      {manual2fa === 1
                        ? "1 account has no TOTP secret"
                        : `${manual2fa} accounts have no TOTP secret`}
                    </p>
                    <p className="text-[11px] text-amber-200/60 mt-0.5 leading-relaxed">
                      If {manual2fa === 1 ? "it asks" : "they ask"} for a 2FA code,
                      you will have to type{" "}
                      {manual2fa === 1 ? "it" : "each one"} by hand within 10
                      minutes of the prompt. Add a{" "}
                      <code className="font-mono">totp_secret</code> column to your
                      list and the codes are generated automatically —{" "}
                      <button
                        type="button"
                        onClick={() => setView("compose")}
                        className="underline hover:text-amber-200"
                      >
                        go back and add them
                      </button>
                      .
                    </p>
                  </div>
                </div>
              )}

              {preview.truncated && (
                <p className="text-[12px] border border-amber-500/30 bg-amber-500/[0.06] text-amber-300 px-3 py-2">
                  Your list was cut off at {IMPORT_MAX_ROWS.toLocaleString()} rows.
                  The rest was not read.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || willImport === 0}
                  className="dashboard-btn-primary bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold px-4 py-2 text-[12px] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {creating
                    ? "Starting…"
                    : willImport === 0
                      ? "Nothing to import"
                      : `Import ${willImport.toLocaleString()} account${willImport === 1 ? "" : "s"}`}
                </button>
                <button
                  type="button"
                  onClick={() => setView("compose")}
                  className="border border-white/[0.08] px-3 py-2 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
                >
                  Back to editing
                </button>
                {countOf(previewCounts, "skipped") +
                  countOf(previewCounts, "invalid") >
                  0 && (
                  <span className="text-[11px] text-default-500">
                    Rows that won&apos;t import are left alone — nothing is deleted
                    or changed.
                  </span>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-0" delay={0.1} hover={false}>
            <ImportPreviewTable rows={preview.rows ?? []} />
          </GlassCard>
        </>
      )}

      {/* ── Running job ──────────────────────────────────────────────── */}
      {view === "job" && (
        <JobView
          job={job}
          now={now}
          parked={parked}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}

// ── Sub-views ────────────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning" | "muted" | "accent";
}) {
  const toneClass = {
    success: "text-green-400 border-green-500/30",
    danger: "text-red-400 border-red-500/30",
    warning: "text-amber-400 border-amber-500/30",
    muted: "text-default-400 border-white/[0.08]",
    accent:
      "text-[color:var(--theme-accent,#f54900)] border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]",
  }[tone];
  return (
    <div className={`border px-3 py-2 min-w-[104px] ${toneClass}`}>
      <div className="text-[18px] font-semibold tabular-nums leading-none">
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-default-500 mt-1">
        {label}
      </div>
    </div>
  );
}

/**
 * The "advertise the parser" block. People reformat lists by hand for an hour
 * because nothing told them they didn't have to, so this is stated up front and
 * the example is one click away from being in the box.
 */
function FormatHelp({ onUseExample }: { onUseExample: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(IMPORT_EXAMPLE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy — select the text instead.");
    }
  }

  return (
    <GlassCard className="p-5" delay={0.1} hover={false}>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <PxZap className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
          Don&apos;t reformat anything — paste what you have
        </h3>
        <ul className="text-[12px] text-default-500 space-y-1 leading-relaxed">
          <li>
            • Separate columns with a{" "}
            <code className="font-mono text-default-400">comma</code>,{" "}
            <code className="font-mono text-default-400">semicolon</code>,{" "}
            <code className="font-mono text-default-400">tab</code> or{" "}
            <code className="font-mono text-default-400">pipe</code> — whichever
            your list already uses.
          </li>
          <li>
            • Just credentials is fine:{" "}
            <code className="font-mono text-default-400">email:password</code>,
            one per line.
          </li>
          <li>
            • A header row is optional. Without one the order is{" "}
            <code className="font-mono text-default-400">
              email, password, platform, proxy, totp_secret
            </code>
            .
          </li>
          <li>
            • Header names are flexible —{" "}
            {IMPORT_COLUMN_ALIASES.map((c, i) => (
              <span key={c.canonical}>
                {i > 0 ? "; " : ""}
                <code className="font-mono text-default-400">{c.canonical}</code>{" "}
                also accepts {c.aliases.map((a) => `"${a}"`).join(", ")}
              </span>
            ))}
            .
          </li>
          <li>
            • Blank lines and lines starting with{" "}
            <code className="font-mono text-default-400">#</code> are ignored.
          </li>
          <li>
            • Only <code className="font-mono text-default-400">email</code> and{" "}
            <code className="font-mono text-default-400">password</code> are
            required. Supplying{" "}
            <code className="font-mono text-default-400">totp_secret</code> means
            you never have to type a 2FA code.
          </li>
        </ul>

        <div className="border border-white/[0.08] bg-black/30">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06]">
            <span className="text-[10px] uppercase tracking-wider text-default-500">
              Example
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1 border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
              >
                <PxCopy className="h-3 w-3" />
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onUseExample}
                className="border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
              >
                Try it
              </button>
            </div>
          </div>
          <pre className="px-3 py-2.5 text-[11px] font-mono leading-relaxed text-default-400 overflow-x-auto styled-scrollbar">
            {IMPORT_EXAMPLE}
          </pre>
        </div>
      </div>
    </GlassCard>
  );
}

function ImportHistory({
  jobs,
  error,
  onOpen,
}: {
  jobs: ImportJob[] | null;
  error: string | null;
  onOpen: (jobId: string) => void;
}) {
  // A failed list must not look like "you've never imported anything".
  if (error) {
    return (
      <GlassCard className="p-5" delay={0.15} hover={false}>
        <p className="text-[12px] text-amber-300/80">{error}</p>
      </GlassCard>
    );
  }
  if (!jobs?.length) return null;

  return (
    <GlassCard className="p-0" delay={0.15} hover={false}>
      <div className="px-5 py-3 border-b border-white/[0.06]">
        <h3 className="text-sm font-semibold">Previous imports</h3>
      </div>
      <div>
        {jobs.map((j) => {
          const stuck = parkedCount(j.counts);
          return (
            <button
              key={j.job_id}
              type="button"
              onClick={() => onOpen(j.job_id)}
              className="w-full flex flex-wrap items-center gap-3 px-5 py-2.5 border-b border-white/[0.04] last:border-b-0 text-left transition-colors hover:bg-accent/5"
            >
              <span className="text-[12px] text-foreground/90 tabular-nums">
                {j.total?.toLocaleString() ?? "?"} accounts
              </span>
              <span className="text-[11px] text-default-500">
                {new Date(j.created_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="text-[11px] text-green-400/80 tabular-nums">
                {countOf(j.counts, "success")} connected
              </span>
              {stuck > 0 && (
                <span className="text-[10px] uppercase tracking-wider border border-amber-500/30 bg-amber-500/10 text-amber-400 px-1.5 py-0.5">
                  {stuck} awaiting code
                </span>
              )}
              <span className="ml-auto text-[10px] uppercase tracking-wider text-default-500">
                {j.status}
              </span>
            </button>
          );
        })}
      </div>
    </GlassCard>
  );
}

function JobView({
  job,
  now,
  parked,
  onCancel,
}: {
  job: ReturnType<typeof useImportJob>;
  now: number;
  parked: ImportJobRow[];
  onCancel: () => void;
}) {
  const { counts, error, unavailable, loading } = job;
  const total = job.job?.total ?? job.rows.length;
  const settled = settledCount(counts);
  const percent = total > 0 ? Math.min(100, Math.round((settled / total) * 100)) : 0;
  const inFlight = countOf(counts, "running") + countOf(counts, "pending");
  // The job holds every parsed line, but lines that were never going to be
  // attempted shouldn't inflate the headline — it has to match the number the
  // operator agreed to on the preview screen.
  const notAttempted = countOf(counts, "skipped") + countOf(counts, "invalid");
  const attempted = Math.max(0, total - notAttempted);

  if (unavailable) {
    return (
      <GlassCard className="p-5" hover={false}>
        <p className="text-[12px] text-amber-300">
          {errorLine(error, "This import job could not be found.")}
        </p>
      </GlassCard>
    );
  }

  // A dead backend must never render as a finished import with zero rows.
  const hardError = error && !job.job;
  if (hardError) {
    return (
      <GlassCard className="p-5" hover={false}>
        <div className="flex items-start gap-3">
          <PxZap className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-red-300">
              Couldn&apos;t load this import
            </p>
            <p className="text-[11px] text-red-200/60 mt-0.5">
              {errorLine(error, "The API did not answer.")} The import itself keeps
              running on the server.
            </p>
            <button
              type="button"
              onClick={() => void job.refresh()}
              className="mt-2 flex items-center gap-1.5 border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
            >
              <PxRefresh className="h-3 w-3" />
              Try again
            </button>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (loading && !job.job) {
    return (
      <GlassCard className="p-5" hover={false}>
        <p className="text-[12px] text-default-500">Loading import…</p>
      </GlassCard>
    );
  }

  return (
    <>
      {/* Progress */}
      <GlassCard className="p-5" delay={0.05} hover={false}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <PxUsers className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
              <span className="text-sm font-semibold">
                {job.active
                  ? `Importing ${attempted.toLocaleString()} accounts`
                  : `Import of ${attempted.toLocaleString()} accounts — ${job.job?.status ?? "done"}`}
              </span>
              {notAttempted > 0 && (
                <span className="text-[11px] text-default-500">
                  ({notAttempted.toLocaleString()} line
                  {notAttempted === 1 ? "" : "s"} not attempted)
                </span>
              )}
              {job.active && (
                <span className="h-1.5 w-1.5 bg-[color:var(--theme-accent,#f54900)] animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* A stale-data notice, so a transport blip is visible rather
                  than silently freezing the numbers. */}
              {error && (
                <span className="text-[10px] uppercase tracking-wider text-amber-400/80">
                  Live updates interrupted
                </span>
              )}
              <button
                type="button"
                onClick={() => void job.refresh()}
                className="flex items-center gap-1.5 border border-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
              >
                <PxRefresh className="h-3 w-3" />
                Refresh
              </button>
              {job.active && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="border border-amber-400/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-amber-400 hover:bg-amber-500/10 transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] text-default-500 mb-1">
              <span>
                {settled.toLocaleString()} of {total.toLocaleString()} done
                {inFlight > 0 ? ` · ${inFlight.toLocaleString()} to go` : ""}
              </span>
              <span className="tabular-nums">{percent}%</span>
            </div>
            <Progress
              aria-label="Import progress"
              size="sm"
              value={percent}
              maxValue={100}
              color={job.job?.status === "failed" ? "danger" : "primary"}
              classNames={{
                track: "h-1 bg-white/[0.06] rounded-none",
                indicator: "rounded-none",
              }}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {IMPORT_STATE_ORDER.filter((s) => countOf(counts, s) > 0).map((s) => (
              <span
                key={s}
                className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-wider ${stateChipClass(
                  s
                )}`}
              >
                <span className={`h-1.5 w-1.5 ${stateDotClass(s)}`} />
                {stateLabel(s)}
                <span className="tabular-nums font-semibold">
                  {countOf(counts, s).toLocaleString()}
                </span>
              </span>
            ))}
          </div>
        </div>
      </GlassCard>

      {/* Parked logins — the queue that must not get lost */}
      {parked.length > 0 && (
        <GlassCard className="p-0" delay={0.08} hover={false}>
          <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <PxLock className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-300">
              {parked.length === 1
                ? "1 login is waiting for a code"
                : `${parked.length} logins are waiting for a code`}
            </h3>
            <span className="text-[11px] text-default-500">
              — the rest of the import carried on without them
            </span>
          </div>
          <div>
            {parked.slice(0, QUEUE_VISIBLE).map((row) => (
              <div
                key={row.row_id}
                className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-white/[0.04] last:border-b-0"
              >
                <span className="text-[11px] tabular-nums text-default-500 w-10 shrink-0">
                  #{row.line}
                </span>
                <span className="text-[12px] text-foreground/90 min-w-[180px] truncate">
                  {row.email || "—"}
                </span>
                <div className="ml-auto">
                  <ImportOtpRow
                    row={row}
                    now={now}
                    onSubmitOtp={job.submitOtp}
                    onRetry={job.retryRow}
                  />
                </div>
              </div>
            ))}
          </div>
          {parked.length > QUEUE_VISIBLE && (
            <p className="px-5 py-2.5 text-[11px] text-default-500 border-t border-white/[0.06]">
              {parked.length - QUEUE_VISIBLE} more below — use the{" "}
              <span className="text-default-400">Needs you</span> filter in the
              table.
            </p>
          )}
        </GlassCard>
      )}

      {/* Recent transitions tail */}
      {job.recent.length > 0 && (
        <GlassCard className="p-0" delay={0.1} hover={false}>
          <div className="px-5 py-3 border-b border-white/[0.06]">
            <h3 className="text-sm font-semibold">Recent activity</h3>
          </div>
          <div className="max-h-[180px] overflow-y-auto styled-scrollbar">
            <AnimatePresence initial={false}>
              {job.recent.slice(0, 12).map((t) => (
                <motion.div
                  key={`${t.row_id}-${t.to}-${t.at ?? ""}`}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2.5 px-5 py-1.5 text-[11px] border-b border-white/[0.03] last:border-b-0"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 ${stateDotClass(t.to)}`} />
                  <span className="text-default-400 truncate max-w-[240px]">
                    {t.email || `line ${t.line ?? "?"}`}
                  </span>
                  <span className="text-default-500">{stateLabel(t.to)}</span>
                  {t.error && (
                    <span className="text-red-400/70 truncate">{t.error}</span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </GlassCard>
      )}

      {/* Full table */}
      <GlassCard className="p-0" delay={0.12} hover={false}>
        <ImportRowsTable
          rows={job.rows}
          counts={counts}
          now={now}
          onSubmitOtp={job.submitOtp}
          onRetry={job.retryRow}
        />
      </GlassCard>
    </>
  );
}
