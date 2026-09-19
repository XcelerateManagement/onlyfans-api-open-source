"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useSSE } from "@/lib/hooks/use-sse";
import { ApiError, type PendingTwoFactorResponse } from "@/lib/api-client";

type PendingRow = PendingTwoFactorResponse["rows"][number];

interface PendingTwoFactorState {
  /** Rows parked on `needs_2fa` across every import job in the panel. */
  rows: PendingRow[];
  /** Server-reported count. Authoritative even if `rows` is truncated. */
  count: number;
  /** First load hasn't answered yet. */
  loading: boolean;
  /** Last failure. Non-null means `count` is stale, not that it is zero. */
  error: ApiError | null;
  /** The panel's backend doesn't expose the importer at all (404). Polling is
   *  switched off permanently; consumers should render nothing. */
  unavailable: boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PendingTwoFactorState | null>(null);

/** Idle cadence. Parked rows are created by a background worker, so the page
 *  has to ask — but a code has a 600s life, so 30s is plenty of resolution and
 *  costs 120 requests/hour for the whole panel, not per account. */
const POLL_MS = 30_000;
/** Right after an import event, look again sooner. */
const NUDGE_MS = 1_500;

/**
 * Owns the panel's single `GET /import/pending-2fa` subscription.
 *
 * Mounted once in the dashboard layout, exactly like `RateLimitBanner`'s
 * subscriber, so that *any* page can surface "N accounts need a 2FA code"
 * without opting in. This is the requirement that the operator must not lose
 * 2FA work by closing the importer: the codes are owned by the panel, not by
 * the importer screen.
 *
 * Everything here is O(1) per tick regardless of how many accounts are
 * importing — one request returns the whole parked set.
 */
export function PendingTwoFactorProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const api = useApiClient();
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // Guards a slow response from clobbering a newer one, and stops the timer
  // from stacking calls if the backend is crawling.
  const inFlight = useRef(false);
  const unavailableRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!api || inFlight.current || unavailableRef.current) return;
    inFlight.current = true;
    try {
      const res = await api.getPendingImport2FA();
      setRows(res?.rows ?? []);
      setCount(
        typeof res?.count === "number" ? res.count : (res?.rows?.length ?? 0)
      );
      setError(null);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, { error: String(e) });
      // A 404 means this backend predates the importer. Stop asking — a banner
      // that can never appear is not worth a request every 30 seconds.
      if (err.status === 404) {
        unavailableRef.current = true;
        setUnavailable(true);
        setRows([]);
        setCount(0);
        setError(null);
      } else {
        // Keep the last known rows. A transport blip must not read as "all
        // clear" — `error` is exposed so consumers can say so.
        setError(err);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [api]);

  // Reset when the session's panel changes.
  useEffect(() => {
    unavailableRef.current = false;
    setUnavailable(false);
    setRows([]);
    setCount(0);
    setLoading(!!api);
  }, [api]);

  // Poll, but only while the tab is actually being looked at.
  useEffect(() => {
    if (!api || unavailable) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
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
  }, [api, unavailable, refresh]);

  // Import progress is coalesced to ~1/s by the backend; we only use it as a
  // hint to look again sooner than the idle cadence would.
  const { events } = useSSE({
    types: ["import.progress", "import.complete"],
    bufferSize: 5,
    disabled: unavailable,
  });
  const lastSeen = events[0];
  useEffect(() => {
    if (!lastSeen || unavailable) return;
    const t = setTimeout(() => void refresh(), NUDGE_MS);
    return () => clearTimeout(t);
  }, [lastSeen, refresh, unavailable]);

  const value = useMemo<PendingTwoFactorState>(
    () => ({ rows, count, loading, error, unavailable, refresh }),
    [rows, count, loading, error, unavailable, refresh]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read the panel's parked-2FA state. Safe to call outside the provider (returns
 * an inert zero state) so a component can't crash a page by being mounted early.
 */
export function usePendingTwoFactor(): PendingTwoFactorState {
  const ctx = useContext(Ctx);
  return (
    ctx ?? {
      rows: [],
      count: 0,
      loading: false,
      error: null,
      unavailable: true,
      refresh: async () => {},
    }
  );
}
