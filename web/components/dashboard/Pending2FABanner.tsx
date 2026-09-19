"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { usePendingTwoFactor } from "@/lib/hooks/use-pending-2fa";
import { otpWindow } from "@/lib/import-format";
import { PxLock } from "@/components/ui/PixelIcons";

/**
 * Dashboard-wide "N accounts need a 2FA code" notice.
 *
 * Mounted once in the dashboard layout next to `RateLimitBanner`, and for the
 * same reason: the state belongs to the panel, not to the page that created it.
 * An operator who kicks off a 600-account import and then walks over to
 * Earnings must still be told that eleven logins are parked waiting on a code —
 * otherwise the codes quietly expire and the work is lost.
 *
 * Costs nothing per page: the provider above it owns a single 30s poll for the
 * whole dashboard.
 */
export function Pending2FABanner() {
  const { count, rows, unavailable } = usePendingTwoFactor();
  const pathname = usePathname();
  // Dismissal is scoped to a count. If another row parks, the notice comes
  // back — this is time-limited work, so "dismiss" must not mean "never again".
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const onImporter = pathname?.startsWith("/dashboard/import") ?? false;
  const visible = !unavailable && count > 0 && !onImporter && dismissedAt !== count;

  // One timer for the whole banner, ticking only while it is on screen.
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visible]);

  useEffect(() => {
    if (count === 0) setDismissedAt(null);
  }, [count]);

  /** The row that will expire first — the deadline that actually matters. */
  const soonest = useMemo(() => {
    let best: { secondsLeft: number; display: string; urgent: boolean } | null = null;
    for (const r of rows) {
      const w = otpWindow(r.otp_expires_at, now);
      if (!w || w.expired) continue;
      if (!best || w.secondsLeft < best.secondsLeft) best = w;
    }
    return best;
  }, [rows, now]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          role="status"
          aria-live="polite"
          className="overflow-hidden"
        >
          {/* Margin on the inner box so it collapses with the height animation. */}
          <div className="mb-4 flex items-start gap-3 border border-amber-500/30 bg-amber-500/[0.06] px-4 py-2.5">
            <PxLock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-amber-300">
                {count === 1
                  ? "1 account needs a 2FA code"
                  : `${count} accounts need a 2FA code`}
              </p>
              <p className="text-[11px] text-amber-200/60 mt-0.5 leading-relaxed">
                {count === 1 ? "This login is " : "These logins are "}
                paused waiting for a 6-digit code. The rest of your import
                finished without {count === 1 ? "it" : "them"}.{" "}
                {soonest ? (
                  <>
                    The first code window closes in{" "}
                    <span
                      className={`tabular-nums font-semibold ${
                        soonest.urgent ? "text-red-300" : ""
                      }`}
                    >
                      {soonest.display}
                    </span>
                    ; after that the account has to log in again.
                  </>
                ) : (
                  <>Enter the codes before their windows close.</>
                )}
              </p>
            </div>
            <Link
              href="/dashboard/import"
              className="shrink-0 self-center border border-amber-400/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-amber-300 hover:bg-amber-500/10 transition-colors"
            >
              Enter codes
            </Link>
            <button
              type="button"
              onClick={() => setDismissedAt(count)}
              className="text-[11px] uppercase tracking-wider text-amber-200/50 hover:text-amber-200 transition-colors shrink-0 self-center"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
