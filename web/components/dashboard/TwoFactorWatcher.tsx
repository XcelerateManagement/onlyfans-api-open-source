"use client";

/**
 * Dashboard-wide 2FA / verification notifier.
 *
 * Mounted once in the dashboard layout. When the backend flags an account as
 * needing a second factor it fires a `verification.required` SSE event (see
 * of_client.flag_verification_required); this surfaces it as a toast from
 * wherever the operator is, with a shortcut to the accounts page to confirm it.
 * A matching `verification.approved` dismisses it. Renders nothing.
 *
 * Lives under `components/` so Tailwind's `source(none)` scanner keeps its
 * classes (a component under lib/ renders unstyled).
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ShieldAlert } from "lucide-react";

import { useSSE } from "@/lib/hooks/use-sse";
import { useAccounts } from "@/lib/hooks/use-selected-account";

export function TwoFactorWatcher() {
  const router = useRouter();
  const { accounts } = useAccounts();
  const { events } = useSSE({
    types: ["verification.required", "verification.approved"],
  });
  const lastHandled = useRef<string | null>(null);
  // Keep the freshest account list available to the fire-time closure without
  // re-subscribing the SSE stream on every list refresh.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  useEffect(() => {
    const ev = events[0];
    const evKey = ev ? (ev.id != null ? String(ev.id) : `${ev.event_type}:${ev.created_at}`) : null;
    if (!ev || evKey === lastHandled.current) return;
    lastHandled.current = evKey;

    const ofUserId =
      (ev.payload as { of_user_id?: string } | undefined)?.of_user_id ?? null;
    const acct = ofUserId
      ? accountsRef.current.find((a) => String(a.of_user_id) === String(ofUserId))
      : null;
    const who = acct?.username ? `@${acct.username}` : acct?.email || "An account";

    if (ev.event_type === "verification.approved") {
      if (ofUserId) toast.dismiss(`2fa:${ofUserId}`);
      toast.success(`${who} verified`, { id: `2fa-ok:${ofUserId ?? "x"}` });
      return;
    }

    const reason =
      (ev.payload as { reason?: string } | undefined)?.reason === "face_id_required"
        ? "needs face verification"
        : "needs a 2FA code";
    toast(
      (t) => (
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-sm">
            <div className="font-medium">{who} {reason}</div>
            <button
              type="button"
              className="mt-0.5 text-xs text-amber-400 underline underline-offset-2"
              onClick={() => {
                toast.dismiss(t.id);
                router.push("/dashboard/accounts");
              }}
            >
              Confirm now
            </button>
          </div>
        </div>
      ),
      { id: `2fa:${ofUserId ?? "x"}`, duration: 12000 },
    );
  }, [events, router]);

  return null;
}
