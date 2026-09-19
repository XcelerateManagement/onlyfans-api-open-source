"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useSSE } from "@/lib/hooks/use-sse";
import {
  ApiError,
  type ImportCounts,
  type ImportJob,
  type ImportJobRow,
  type ImportProgressEvent,
  type ImportTransition,
} from "@/lib/api-client";

/** Poll cadence while the job is doing something. The backend coalesces its own
 *  progress to ~1/s, so asking faster than this buys nothing. */
const ACTIVE_POLL_MS = 2_000;
/** Once a job stops moving on its own it can still change — a parked row
 *  resumes when a code is submitted, and OTP windows expire server-side. Keep a
 *  slow heartbeat so an expiry shows up without a reload. */
const IDLE_POLL_MS = 20_000;
/** Never let SSE nudges turn into a request storm. */
const MIN_REFETCH_GAP_MS = 900;
/** How many transitions to keep for the activity tail. */
const RECENT_CAP = 40;

export interface UseImportJobResult {
  job: ImportJob | null;
  rows: ImportJobRow[];
  counts: ImportCounts;
  /** Newest-first tail of row transitions, merged from SSE + poll. */
  recent: ImportTransition[];
  loading: boolean;
  /** Non-null when the last fetch failed. The caller MUST check this before
   *  rendering an empty table as "no rows". */
  error: ApiError | null;
  /** The importer routes don't exist on this backend. */
  unavailable: boolean;
  /** True while the job still moves on its own. */
  active: boolean;
  refresh: () => Promise<void>;
  submitOtp: (rowId: string, code: string) => Promise<void>;
  retryRow: (rowId: string) => Promise<void>;
  cancel: () => Promise<void>;
}

function isActive(job: ImportJob | null): boolean {
  return job?.status === "queued" || job?.status === "running";
}

function transitionKey(t: ImportTransition): string {
  return `${t.row_id}:${t.to}:${t.at ?? ""}`;
}

/**
 * Live state for one import job.
 *
 * The request budget is the whole design. A job holds up to 1000 rows, and the
 * rule is O(1) requests: this hook makes exactly one call per tick —
 * `GET /import/jobs/<id>` returns the job, its per-state counts and its rows
 * together — plus one call per operator action. Nothing here loops over rows.
 *
 * SSE is an accelerator, not the source of truth. The backend coalesces
 * `import.progress` to roughly one event a second and drops on queue overflow,
 * so a UI built on per-row events would lose precisely the transitions that
 * matter. Events update the counts and the activity tail immediately; the poll
 * reconciles the authoritative row list underneath.
 */
export function useImportJob(jobId: string | null): UseImportJobResult {
  const api = useApiClient();
  const [job, setJob] = useState<ImportJob | null>(null);
  const [rows, setRows] = useState<ImportJobRow[]>([]);
  const [counts, setCounts] = useState<ImportCounts>({});
  const [recent, setRecent] = useState<ImportTransition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const inFlight = useRef(false);
  const lastFetchAt = useRef(0);
  const unavailableRef = useRef(false);
  // `refresh` must NOT depend on the job state it writes. If it did, every
  // successful poll would give `refresh` a new identity, restart the interval
  // effect below, and fire another request immediately — a feedback loop that
  // turns a 2s poll into ~30 requests a second. The 404 check reads the job
  // through this ref instead.
  const jobRef = useRef<ImportJob | null>(null);
  jobRef.current = job;

  const mergeRecent = useCallback((incoming: ImportTransition[] | null | undefined) => {
    if (!incoming?.length) return;
    setRecent((prev) => {
      const seen = new Set(prev.map(transitionKey));
      const fresh = incoming.filter((t) => t?.row_id && !seen.has(transitionKey(t)));
      if (!fresh.length) return prev;
      // Backends may ship the tail oldest-first; we render newest-first.
      return [...fresh.reverse(), ...prev].slice(0, RECENT_CAP);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!api || !jobId || inFlight.current || unavailableRef.current) return;
    inFlight.current = true;
    lastFetchAt.current = Date.now();
    try {
      const res = await api.getImportJob(jobId);
      if (res?.job) setJob(res.job);
      setRows(res?.rows ?? []);
      setCounts(res?.counts ?? res?.job?.counts ?? {});
      mergeRecent(res?.recent);
      setError(null);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, { error: String(e) });
      if (err.status === 404 && !jobRef.current) {
        // No job AND a 404: either the importer doesn't exist on this backend
        // or the id is bogus. Either way, stop asking.
        unavailableRef.current = true;
        setUnavailable(true);
      }
      setError(err);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [api, jobId, mergeRecent]);

  // Reset everything when the job under inspection changes.
  useEffect(() => {
    unavailableRef.current = false;
    setUnavailable(false);
    setJob(null);
    setRows([]);
    setCounts({});
    setRecent([]);
    setError(null);
    setLoading(!!jobId);
  }, [jobId]);

  const active = isActive(job);

  // Poll. Cadence follows the job, and pauses with the tab.
  useEffect(() => {
    if (!api || !jobId || unavailable) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const period = active ? ACTIVE_POLL_MS : IDLE_POLL_MS;

    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), period);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [api, jobId, active, unavailable, refresh]);

  // SSE: apply the coalesced snapshot straight away, then reconcile rows.
  const { events } = useSSE({
    types: ["import.progress", "import.complete"],
    bufferSize: 30,
    disabled: !jobId || unavailable,
  });
  const newest = events[0];

  useEffect(() => {
    if (!newest || !jobId) return;
    const p = newest.payload as unknown as ImportProgressEvent;
    if (!p?.job_id || String(p.job_id) !== String(jobId)) return;

    if (p.counts) setCounts(p.counts);
    mergeRecent(p.recent);
    setJob((prev) =>
      prev
        ? {
            ...prev,
            status: p.status ?? prev.status,
            counts: p.counts ?? prev.counts,
            updated_at: p.updated_at ?? prev.updated_at,
          }
        : prev
    );

    // Row detail still has to come from the endpoint — throttled so a burst of
    // events can't turn into a burst of requests.
    const since = Date.now() - lastFetchAt.current;
    const delay = Math.max(0, MIN_REFETCH_GAP_MS - since);
    const t = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(t);
  }, [newest, jobId, refresh, mergeRecent]);

  // ── Operator actions ──────────────────────────────────────────────────────
  // Each is exactly one request. They optimistically move the row so the click
  // feels immediate, then let the next poll state the truth.

  const patchRow = useCallback((rowId: string, patch: Partial<ImportJobRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.row_id === rowId ? { ...r, ...patch } : r))
    );
  }, []);

  const submitOtp = useCallback(
    async (rowId: string, code: string) => {
      if (!api || !jobId) throw new ApiError(0, { error: "Not connected." });
      const res = await api.submitImportOtp(jobId, rowId, code);
      patchRow(rowId, res?.row ?? { state: "running", error: null, otp_expires_at: null });
      void refresh();
    },
    [api, jobId, patchRow, refresh]
  );

  const retryRow = useCallback(
    async (rowId: string) => {
      if (!api || !jobId) throw new ApiError(0, { error: "Not connected." });
      const res = await api.retryImportRow(jobId, rowId);
      patchRow(rowId, res?.row ?? { state: "pending", error: null, otp_expires_at: null });
      void refresh();
    },
    [api, jobId, patchRow, refresh]
  );

  const cancel = useCallback(async () => {
    if (!api || !jobId) throw new ApiError(0, { error: "Not connected." });
    const res = await api.cancelImportJob(jobId);
    if (res?.job) setJob(res.job);
    void refresh();
  }, [api, jobId, refresh]);

  // Rows always render in paste order, whatever order the backend returns them
  // in. A table that reorders itself under a live import is unusable.
  const orderedRows = useMemo(
    () => [...rows].sort((a, b) => (a.line ?? 0) - (b.line ?? 0)),
    [rows]
  );

  return {
    job,
    rows: orderedRows,
    counts,
    recent,
    loading,
    error,
    unavailable,
    active,
    refresh,
    submitOtp,
    retryRow,
    cancel,
  };
}
