"use client";

import { useEffect } from "react";

/**
 * Listens for ChunkLoadError (Next.js / webpack runtime error fired when a
 * lazy-loaded JS chunk can't be fetched — most commonly because a deploy
 * landed between the user's HTML response and a subsequent chunk request).
 *
 * On a chunk error, soft-reload the page once per session so the user gets
 * the new HTML referencing current chunks. Guarded against reload loops via
 * sessionStorage.
 *
 * This is a defensive safety net. Without it, a deploy mid-session leaves
 * the user staring at a frozen dashboard.
 */
export function ChunkErrorReloader() {
  useEffect(() => {
    const RELOAD_KEY = "__chunk_error_reload";
    const RELOAD_TTL_MS = 30_000;

    function shouldReload(): boolean {
      try {
        const last = sessionStorage.getItem(RELOAD_KEY);
        if (!last) return true;
        return Date.now() - Number(last) > RELOAD_TTL_MS;
      } catch {
        return true;
      }
    }

    function markReloaded() {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        // sessionStorage unavailable (private mode, sandboxed iframe, etc.) — fall through
      }
    }

    function isChunkError(err: unknown): boolean {
      if (!err) return false;
      const msg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message + " " + (err.name ?? "")
            : String((err as { message?: unknown })?.message ?? "");
      return /ChunkLoadError|Loading chunk|Failed to load chunk|Failed to fetch dynamically imported module/i.test(
        msg
      );
    }

    function handleError(err: unknown) {
      if (!isChunkError(err)) return;
      if (!shouldReload()) return;
      markReloaded();
      window.location.reload();
    }

    function onError(event: ErrorEvent) {
      handleError(event.error ?? event.message);
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      handleError(event.reason);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
