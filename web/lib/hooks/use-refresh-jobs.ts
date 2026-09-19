"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSSE } from "@/lib/hooks/use-sse";
import { useApiClient } from "@/lib/hooks/use-api-client";

/**
 * Shape returned by the backend refresh_state.RefreshJobState.to_payload().
 * `crm_id` is intentionally absent — the SSE channel is already scoped.
 */
export interface RefreshJobState {
  job_id: string;
  of_user_id: string;
  kind: "subs" | "tx" | "campaigns";
  phase:
    | "counting"
    | "fetching"
    | "upserting"
    | "caught_up"
    | "window_exhausted"
    | "no_more"
    | "page_cap"
    | "error"
    | "complete";
  pages_done: number;
  pages_est: number | null;
  rows_inserted: number;
  rows_updated: number;
  started_at: string;
  updated_at: string;
  completed_at?: string | null;
  success?: boolean | null;
  stopped_reason?: string | null;
  error?: string | null;
  duration_seconds?: number | null;
}

type Key = `${string}:${RefreshJobState["kind"]}`;
const _key = (ofUserId: string, kind: RefreshJobState["kind"]): Key =>
  `${ofUserId}:${kind}`;

/**
 * Live progress state for every refresh job on this CRM.
 *
 * Two sources merged:
 *   1. On mount, GET /refresh/active seeds any in-flight jobs (so a user who
 *      reloads the page mid-walk sees the bar appear immediately).
 *   2. The SSE stream pushes `refresh.progress` and `refresh.complete` events;
 *      each one is merged into the local map by (of_user_id, kind).
 *
 * Completed jobs linger for ~3s (matches backend COMPLETED_TTL_SECONDS) so the
 * UI can show the final state before the bar fades.
 */
export function useRefreshJobs(): {
  /** Map lookup for the per-row progress bar. null = nothing active. */
  get: (ofUserId: string, kind: RefreshJobState["kind"]) => RefreshJobState | null;
  /** Whole map (useful for global indicators). */
  all: Record<Key, RefreshJobState>;
  /** Count of currently-running (not-yet-complete) jobs. */
  activeCount: number;
} {
  const api = useApiClient();
  const [jobs, setJobs] = useState<Record<Key, RefreshJobState>>({});

  // 1) Seed from /refresh/active on mount (handles page reload mid-walk).
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listActiveRefreshes();
        if (cancelled || !res?.jobs) return;
        setJobs((prev) => {
          const next = { ...prev };
          for (const j of res.jobs) {
            next[_key(j.of_user_id, j.kind)] = j;
          }
          return next;
        });
      } catch {
        // Non-fatal — the SSE stream will still deliver live updates.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // 2) Live updates via SSE. We filter for our two event types so non-matching
  //    events don't enter the buffer (and thus don't cause this effect to
  //    re-run its event loop on unrelated pushes).
  const { events } = useSSE({
    types: ["refresh.progress", "refresh.complete"],
    bufferSize: 50,
  });

  // Keep the latest event merged into the map. events[] is newest-first so we
  // only need to look at events[0] each render.
  useEffect(() => {
    const evt = events[0];
    if (!evt) return;
    const payload = evt.payload as unknown as RefreshJobState;
    if (!payload?.of_user_id || !payload?.kind) return;
    const k = _key(payload.of_user_id, payload.kind);

    if (evt.event_type === "refresh.complete") {
      // Show the final state briefly, then prune. Matches backend grace window.
      setJobs((prev) => ({ ...prev, [k]: payload }));
      const t = setTimeout(() => {
        setJobs((prev) => {
          if (prev[k]?.job_id === payload.job_id) {
            const next = { ...prev };
            delete next[k];
            return next;
          }
          return prev;
        });
      }, 3500);
      return () => clearTimeout(t);
    }

    setJobs((prev) => ({ ...prev, [k]: payload }));
  }, [events]);

  const get = useCallback(
    (ofUserId: string, kind: RefreshJobState["kind"]) =>
      jobs[_key(ofUserId, kind)] ?? null,
    [jobs]
  );

  const activeCount = useMemo(
    () => Object.values(jobs).filter((j) => j.phase !== "complete").length,
    [jobs]
  );

  return { get, all: jobs, activeCount };
}
