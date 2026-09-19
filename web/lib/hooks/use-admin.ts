"use client";

import { useEffect, useState } from "react";

/** Returns `{ isAdmin, loading }`. Calls `/api/admin/me` once on mount; the
 *  backend answers 200 if the current session's email has `is_admin=1`. */
export function useAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me", { cache: "no-store" })
      .then((r) => {
        if (cancelled) return;
        setIsAdmin(r.ok);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { isAdmin: !!isAdmin, loading: isAdmin === null };
}

/** Shared fetch helper for admin pages. Throws on non-2xx so callers can
 *  rely on the resolved value being the JSON body. */
export async function adminFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const r = await fetch(path.startsWith("/") ? path : `/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.headers || {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await r.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text || `HTTP ${r.status}` };
  }
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data as T;
}
