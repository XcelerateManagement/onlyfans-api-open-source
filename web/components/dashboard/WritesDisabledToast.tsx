"use client";

/**
 * The "Enable writes" toast, shown when a write is refused with
 * `403 WRITES_DISABLED`.
 *
 * NOT wired per page. `CrmApiClient` detects the code centrally and broadcasts
 * it (`announceWritesDisabled`); the single `WritesDisabledWatcher` in the
 * dashboard layout subscribes and calls `notifyWritesDisabled`. The backend's
 * raw `error` (a copy-paste PATCH snippet) is hidden — the operator gets a
 * one-click toggle instead.
 *
 * Lives under `components/` on purpose: Tailwind is configured with
 * `@import "tailwindcss" source(none)` + explicit `@source "../app"` /
 * `"../components"` (see styles/globals.css). A component under `lib/` is not
 * scanned, so its utility classes get purged and the toast renders unstyled.
 */

import { useState } from "react";
import toast, { type Toast } from "react-hot-toast";
import { Lock } from "lucide-react";
import type { CrmApiClient } from "@/lib/api-client";

interface NotifyOptions {
  api: CrmApiClient | null | undefined;
  /** The account whose writes are off. */
  ofUserId: string | null;
  /** For friendlier copy — "@alex" instead of "this account". */
  username?: string | null;
  /** Optional: run after writes are enabled (e.g. to refresh a view). */
  onEnabled?: () => void;
}

/** Show the enable-writes toast. Deduped per account so repeated blocked
 *  clicks refresh one toast instead of stacking. */
export function notifyWritesDisabled(opts: NotifyOptions): void {
  toast.custom((t) => <WritesDisabledToast t={t} {...opts} />, {
    id: `writes-disabled-${opts.ofUserId ?? "unknown"}`,
    duration: 12000,
  });
}

function WritesDisabledToast({
  t,
  api,
  ofUserId,
  username,
  onEnabled,
}: NotifyOptions & { t: Toast }) {
  const [enabling, setEnabling] = useState(false);
  const who = username ? `@${username}` : "this account";
  const canEnable = !!api && !!ofUserId;

  const enable = async () => {
    if (!api || !ofUserId || enabling) return;
    setEnabling(true);
    try {
      await api.updateAccountPolling(ofUserId, { allow_of_write_actions: true });
      toast.dismiss(t.id);
      toast.success(`Writes enabled for ${who} — try that again.`, { icon: "🔓" });
      onEnabled?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't enable writes.";
      toast.error(msg);
    } finally {
      setEnabling(false);
    }
  };

  return (
    <div
      role="alert"
      className="pointer-events-auto flex w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-[#141414] shadow-2xl ring-1 ring-orange-500/20"
      style={{
        opacity: t.visible ? 1 : 0,
        transform: t.visible ? "translateY(0)" : "translateY(-10px)",
        transition: "opacity 200ms ease, transform 200ms ease",
      }}
    >
      {/* Orange accent rail — the thing that makes it read as "act on me". */}
      <div className="w-1 shrink-0 bg-orange-500" />
      <div className="flex flex-1 gap-3 p-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400">
          <Lock size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">
            Writing is off for {who}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/60">
            Messages, mass DMs, campaigns, and payout requests are disabled for
            this account until you turn writing on.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={enable}
              disabled={enabling || !canEnable}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm shadow-orange-500/30 transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lock size={13} />
              {enabling ? "Enabling…" : "Enable writes"}
            </button>
            <button
              type="button"
              onClick={() => toast.dismiss(t.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-white/45 transition-colors hover:bg-white/5 hover:text-white/80"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
