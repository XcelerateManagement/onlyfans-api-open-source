"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSSE, type LiveEvent } from "./use-sse";

export interface UseLiveDataOptions<T> {
  fetcher: () => Promise<T>;
  /** Event types that should trigger a refetch. */
  refetchOn?: string[];
  /** Fallback poll interval in ms. 0 to disable. Default: 30000. */
  refreshInterval?: number;
  /** Debounce window for refetches triggered by a burst of events. */
  debounceMs?: number;
  /** Disable entirely (e.g. when no account is selected). */
  disabled?: boolean;
}

/**
 * Fetch + live-refresh a piece of dashboard data. Refetches when a matching SSE
 * event arrives, and also at a slow interval as a fallback when SSE is down.
 */
export function useLiveData<T>(options: UseLiveDataOptions<T>) {
  const {
    fetcher,
    refetchOn,
    refreshInterval = 30000,
    debounceMs = 500,
    disabled = false,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (disabled) return;
    setLoading(true);
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (e: any) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [disabled]);

  const scheduleRefetch = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(refetch, debounceMs);
  }, [refetch, debounceMs]);

  const { events, connected } = useSSE({
    types: refetchOn,
    disabled,
  });

  // Initial fetch + dependency refresh
  useEffect(() => {
    if (disabled) return;
    refetch();
  }, [disabled, refetch]);

  // Trigger refetch when a new matching event arrives
  const lastEventId = events[0]?.id ?? null;
  const previousEventId = useRef<number | null>(null);
  useEffect(() => {
    if (disabled) return;
    if (lastEventId && lastEventId !== previousEventId.current) {
      previousEventId.current = lastEventId;
      scheduleRefetch();
    }
  }, [lastEventId, disabled, scheduleRefetch]);

  // Fallback poll
  useEffect(() => {
    if (disabled || !refreshInterval) return;
    const id = setInterval(refetch, refreshInterval);
    return () => clearInterval(id);
  }, [disabled, refreshInterval, refetch]);

  return { data, loading, error, connected, refetch };
}

export type { LiveEvent };
