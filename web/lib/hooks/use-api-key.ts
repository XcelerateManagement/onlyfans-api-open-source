"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

interface ApiKeyState {
  apiKey: string | null;
  crmId: string | null;
  loading: boolean;
  error: string | null;
}

let cached: { crmId: string; apiKey: string } | null = null;
let inflight: Promise<{ crmId: string; apiKey: string } | null> | null = null;

async function fetchApiKey(): Promise<{ crmId: string; apiKey: string } | null> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/me/api-key", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return null;
      const data = (await res.json()) as { crmId?: string; apiKey?: string };
      if (!data.crmId || !data.apiKey) return null;
      cached = { crmId: data.crmId, apiKey: data.apiKey };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Clear the in-process cache — call after sign-out so the key isn't held in
 *  module-scope memory across a re-auth. */
export function clearApiKeyCache(): void {
  cached = null;
}

/**
 * Lazy-loaded API key hook for dashboard surfaces that need to display the
 * key. Replaces direct reads of `session?.user?.apiKey` (the key no longer
 * rides on the public session — see auth-options.ts session callback).
 *
 * Returns null until the first fetch resolves so callers can show a skeleton
 * / dash. Errors are non-fatal — the components that use this gracefully
 * render "<api_key>" placeholders when null.
 */
export function useApiKey(): ApiKeyState {
  const { status } = useSession();
  const [state, setState] = useState<ApiKeyState>({
    apiKey: cached?.apiKey || null,
    crmId: cached?.crmId || null,
    loading: !cached,
    error: null,
  });

  useEffect(() => {
    if (status !== "authenticated") {
      setState({ apiKey: null, crmId: null, loading: false, error: null });
      return;
    }
    if (cached) {
      setState({ apiKey: cached.apiKey, crmId: cached.crmId, loading: false, error: null });
      return;
    }
    let alive = true;
    fetchApiKey()
      .then((v) => {
        if (!alive) return;
        if (v) {
          setState({ apiKey: v.apiKey, crmId: v.crmId, loading: false, error: null });
        } else {
          setState({ apiKey: null, crmId: null, loading: false, error: "Failed to load API key" });
        }
      })
      .catch((e) => {
        if (!alive) return;
        setState({ apiKey: null, crmId: null, loading: false, error: e?.message || "error" });
      });
    return () => {
      alive = false;
    };
  }, [status]);

  return state;
}
