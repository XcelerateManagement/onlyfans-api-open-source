"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSSE } from "@/lib/hooks/use-sse";
import { useApiClient } from "@/lib/hooks/use-api-client";
import type { ExportJob } from "@/lib/api-client";

/**
 * Shape of the SSE `export.progress` / `export.complete` payload broadcast by
 * the backend export_runner. It's a thinner view than the full ExportJob row
 * (no created_at etc.) — enough to drive a live progress bar.
 */
export interface ExportProgress {
  job_id: string;
  of_user_id: string;
  status: ExportJob["status"];
  phase?: string | null;
  phase_label?: string | null;
  phase_index?: number | null;
  phase_total?: number | null;
  counts?: Record<string, any> | null;
  file_size?: number | null;
  expires_at?: string | null;
  error?: string | null;
  warnings?: Array<{ phase: string; error: string }> | null;
  updated_at?: string;
}

/**
 * Live export-job state for one account, keyed by job_id.
 *
 * Two sources merged:
 *   1. On mount (and when `ofUserId` changes) we seed from GET …/exports so
 *      history + any in-flight job render immediately, even after a reload.
 *   2. The SSE stream pushes `export.progress` / `export.complete`; each is
 *      merged into the local map by job_id.
 *
 * Unlike refresh jobs, exports are persistent — we keep completed/failed rows
 * around (they're the download history), we just stop animating them.
 */
export function useExportJobs(ofUserId: string | null | undefined): {
  jobs: ExportJob[];
  byId: Record<string, ExportJob>;
  activeCount: number;
  loading: boolean;
  /** Why the last seed failed, or null. Non-null with no jobs means "we don't
   *  know what exports exist" — NOT "there are no exports". */
  error: unknown;
  refresh: () => Promise<void>;
} {
  const api = useApiClient();
  const [byId, setById] = useState<Record<string, ExportJob>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    if (!api || !ofUserId) return;
    setLoading(true);
    try {
      const res = await api.listExports(ofUserId);
      const map: Record<string, ExportJob> = {};
      for (const j of res?.jobs ?? []) map[j.job_id] = j;
      setById(map);
      setError(null);
    } catch (e) {
      // Non-fatal for live updates — SSE still delivers in-flight progress —
      // but the HISTORY is now unknown, and the page must not print
      // "No exports yet" over it.
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [api, ofUserId]);

  // Reset + seed when the selected account changes.
  useEffect(() => {
    setById({});
    void refresh();
  }, [refresh]);

  // Live updates. Merge progress payloads onto the existing row so we keep
  // history fields (created_at, file_name) that the thin SSE payload omits.
  const { events } = useSSE({
    types: ["export.progress", "export.complete"],
    bufferSize: 50,
  });

  useEffect(() => {
    const evt = events[0];
    if (!evt) return;
    const p = evt.payload as unknown as ExportProgress;
    if (!p?.job_id) return;
    if (ofUserId && String(p.of_user_id) !== String(ofUserId)) return;

    setById((prev) => {
      const existing = prev[p.job_id];
      // Seed a minimal row when we get an event for a job not yet in the map
      // (e.g. created in another tab). refresh()/getExport fills in the rest.
      const base: ExportJob = existing ?? {
        job_id: p.job_id,
        of_user_id: String(p.of_user_id),
        data_types: [],
        include_media: false,
        created_at: p.updated_at ?? new Date().toISOString(),
        status: p.status,
      };
      const merged: ExportJob = {
        ...base,
        status: p.status,
        phase: p.phase ?? base.phase ?? null,
        counts: p.counts ?? base.counts ?? null,
        warnings: p.warnings ?? base.warnings ?? null,
        file_size: p.file_size ?? base.file_size ?? null,
        expires_at: p.expires_at ?? base.expires_at ?? null,
        error: p.error ?? base.error ?? null,
      };
      return { ...prev, [p.job_id]: merged };
    });

    // On completion, pull the authoritative row (file_name, completed_at, …).
    if (evt.event_type === "export.complete" && api && ofUserId) {
      api
        .getExport(ofUserId, p.job_id)
        .then((r) => {
          if (r?.job) setById((prev) => ({ ...prev, [p.job_id]: r.job }));
        })
        .catch(() => {});
    }
  }, [events, api, ofUserId]);

  const jobs = useMemo(
    () =>
      Object.values(byId).sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "")
      ),
    [byId]
  );

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === "queued" || j.status === "running").length,
    [jobs]
  );

  // Add a freshly-created job (from createExport) so the bar shows instantly.
  return { jobs, byId, activeCount, loading, error, refresh };
}
