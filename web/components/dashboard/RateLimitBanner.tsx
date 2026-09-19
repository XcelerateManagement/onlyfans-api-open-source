"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  subscribeToRateLimit,
  type RateLimitNotice,
} from "@/lib/api-client";
import { PxZap } from "@/components/ui/PixelIcons";

/** How long to keep the banner up when the server didn't say how long to wait.
 *  flask-limiter's window is a minute, but the bucket refills continuously, so
 *  a short notice is honest and doesn't nag. */
const DEFAULT_HOLD_SECONDS = 20;

/**
 * Dashboard-wide 429 notice.
 *
 * Mounted once in the dashboard layout and fed by `CrmApiClient`, so ANY page's
 * rate-limited request surfaces here without that page opting in. This is the
 * counterpart to the empty-state fix: pages stop rendering "nothing here" on a
 * failed fetch, and this says what actually happened.
 */
export function RateLimitBanner() {
  const [notice, setNotice] = useState<RateLimitNotice | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  // Count every 429 in the current burst — clicking through the dashboard trips
  // several at once, and "1 request was throttled" would understate it.
  const [hits, setHits] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return subscribeToRateLimit((n) => {
      setNotice(n);
      setHits((h) => h + 1);
      setSecondsLeft(
        n.retryAfter && n.retryAfter > 0
          ? Math.min(n.retryAfter, 120)
          : DEFAULT_HOLD_SECONDS
      );
    });
  }, []);

  useEffect(() => {
    if (!notice) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setNotice(null);
          setHits(0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [notice]);

  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          role="status"
          aria-live="polite"
          className="overflow-hidden"
        >
          {/* Margin lives on the inner box, not the animated wrapper, so it
              collapses with the height animation instead of leaving a gap. */}
          <div className="mb-4 flex items-start gap-3 border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5">
            <PxZap className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-amber-300">
                Rate limit reached — some data on this page could not load
              </p>
              <p className="text-[11px] text-amber-200/60 mt-0.5 leading-relaxed">
                {hits > 1 ? `${hits} requests were ` : "A request was "}
                throttled by the API (
                <code className="font-mono">{notice.path}</code>
                {hits > 1 ? " and others" : ""}). This is the per-minute cap on
                your API key, not a problem with your account. Retrying in{" "}
                <span className="tabular-nums font-semibold">{secondsLeft}s</span>
                .
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setHits(0);
              }}
              className="text-[11px] uppercase tracking-wider text-amber-200/50 hover:text-amber-200 transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
