"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { PxRefresh, PxDollarSign } from "@/components/ui/PixelIcons";
import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { useApiClient } from "@/lib/hooks/use-api-client";
import toast from "react-hot-toast";

function money(n?: number | null): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "$0.00";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Slide-in detail for a single claimer/fan:
 *   • identity
 *   • two spending numbers side-by-side (Total from subs_cache vs Mapped from tx_cache)
 *   • the gap, if any, with a "Load full history" button that kicks a deeper tx refresh
 *   • cached tx list for this fan
 *   • "Refresh profile" button — single /users/{fan_id} call, updates subs_cache
 *
 * Minimal state — all data is fetched from the tx-cache endpoint every time
 * the drawer opens. Small scale (one fan → a few hundred rows max).
 */
export function ClaimerDetailDrawer({
  claimer,
  ofUserId,
  onClose,
  onSpendingRefreshed,
}: {
  claimer: any | null;             // { fan_of_user_id, fan_username, total_spent, mapped_spent, ... } OR null to hide
  ofUserId: string;
  onClose: () => void;
  /** Fired after "Refresh profile" succeeds, so the parent (claimers modal)
   *  can re-paint with the fresh total_spent without a full re-fetch. */
  onSpendingRefreshed?: (fanId: string, totalSpent: number | null) => void;
}) {
  const api = useApiClient();
  const [txRows, setTxRows] = useState<any[]>([]);
  const [mappedSpent, setMappedSpent] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // Mirror of claimer.total_spent — kept local so refresh-profile updates instantly.
  const [totalSpent, setTotalSpent] = useState<number | null>(
    claimer?.total_spent != null ? Number(claimer.total_spent) : null
  );

  const fanId = claimer?.fan_of_user_id;

  // Re-hydrate on open or when the claimer changes
  useEffect(() => {
    setTotalSpent(claimer?.total_spent != null ? Number(claimer.total_spent) : null);
  }, [claimer?.fan_of_user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchTx = useCallback(async () => {
    if (!api || !fanId) return;
    setLoading(true);
    try {
      const res = await api.getCachedFanTransactions(ofUserId, fanId, { limit: 200 });
      setTxRows(res.list || []);
      setMappedSpent(res.mapped_spent || 0);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [api, ofUserId, fanId]);

  useEffect(() => {
    if (fanId) fetchTx();
  }, [fanId, fetchTx]);

  const handleRefreshProfile = async () => {
    if (!api || !fanId) return;
    setRefreshingProfile(true);
    try {
      const res = await api.refreshFanProfile(ofUserId, fanId);
      // Pull the fresh total from the returned user payload
      const fresh = res?.fan?.subscribedOnData?.totalSumm;
      if (typeof fresh === "number") {
        setTotalSpent(fresh);
        onSpendingRefreshed?.(fanId, fresh);
      }
      toast.success(
        res.updated_cache
          ? `Profile refreshed · total=${money(fresh)}`
          : "Profile refreshed (not a subscriber, cache untouched)"
      );
    } catch (err: any) {
      toast.error(err?.message || "Refresh failed");
    } finally {
      setRefreshingProfile(false);
    }
  };

  const handleLoadFullHistory = async () => {
    if (!api || !fanId) return;
    setLoadingHistory(true);
    try {
      // Deeper-window initial sync — picks up older transactions for every
      // fan, not just this one, as a side-effect. See the plan doc.
      const res = await api.refreshTransactions(ofUserId, {
        mode: "initial",
        days: 365,
        max_pages: 200,
      });
      if (res.already_running) {
        toast("Tx refresh already in progress — watch the bar up top");
      } else {
        toast.success(
          "Pulling 365d of ledger history — this runs in the background. The table will refill when it's done."
        );
      }
    } catch (err: any) {
      toast.error(err?.message || "Load history failed");
    } finally {
      setLoadingHistory(false);
    }
  };

  const gap = totalSpent != null && mappedSpent != null
    ? Math.max(0, totalSpent - mappedSpent)
    : null;

  return (
    <AnimatePresence>
      {claimer && (
        <>
          {/* backdrop */}
          <motion.div
            key="bd"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* panel */}
          <motion.aside
            key="pn"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto bg-[#0d0d0d] border-l border-white/[0.06] p-6"
          >
            <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <FanAvatar
                  avatar={(claimer as any).avatar}
                  username={claimer.fan_username || ""}
                  size={44}
                />
                <div>
                  <div className="font-semibold">{claimer.display_name || claimer.name || claimer.fan_username}</div>
                  <div className="text-xs text-default-500">@{claimer.fan_username || "—"} · fan #{fanId}</div>
                </div>
              </div>
              <Button size="sm" variant="light" onPress={onClose} isIconOnly>
                ✕
              </Button>
            </div>

            {/* Spending panel — two numbers side-by-side */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase tracking-wider text-default-400">Total (OF aggregate)</div>
                <div className="text-xl font-semibold mt-1">
                  {totalSpent != null ? money(totalSpent) : "—"}
                </div>
                <div className="text-[11px] text-default-500 mt-0.5">
                  from subscribers_cache
                </div>
              </div>
              <div className="border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase tracking-wider text-default-400">Mapped (tx ledger)</div>
                <div className="text-xl font-semibold mt-1">{money(mappedSpent)}</div>
                <div className="text-[11px] text-default-500 mt-0.5">
                  {txRows.length} tx cached
                </div>
              </div>
            </div>

            {gap != null && gap > 0.01 && (
              <div className="mt-3 p-3 text-xs bg-amber-500/5 border border-amber-500/20">
                <span className="font-semibold text-amber-400">{money(gap)}</span>{" "}
                <span className="text-default-400">
                  of spend not in the cached ledger — older than the current tx window.
                </span>
              </div>
            )}

            {/* Per-channel breakdown (from subs_cache) */}
            {claimer && (claimer.spent_tips || claimer.spent_messages || claimer.spent_posts || claimer.spent_streams) ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {claimer.spent_messages ? (
                  <Chip size="sm" variant="flat" className="rounded-none bg-white/[0.04]">
                    💬 messages {money(claimer.spent_messages)}
                  </Chip>
                ) : null}
                {claimer.spent_tips ? (
                  <Chip size="sm" variant="flat" className="rounded-none bg-white/[0.04]">
                    🎁 tips {money(claimer.spent_tips)}
                  </Chip>
                ) : null}
                {claimer.spent_posts ? (
                  <Chip size="sm" variant="flat" className="rounded-none bg-white/[0.04]">
                    📝 posts {money(claimer.spent_posts)}
                  </Chip>
                ) : null}
                {claimer.spent_streams ? (
                  <Chip size="sm" variant="flat" className="rounded-none bg-white/[0.04]">
                    🎥 streams {money(claimer.spent_streams)}
                  </Chip>
                ) : null}
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button
                size="sm"
                variant="bordered"
                isLoading={refreshingProfile}
                startContent={!refreshingProfile ? <PxRefresh className="h-3 w-3" /> : undefined}
                onPress={handleRefreshProfile}
                title="Single /users/{id} call — freshest totalSumm for this fan right now"
                className="bg-transparent border border-white/[0.08] rounded-none"
              >
                Refresh profile
              </Button>
              <Button
                size="sm"
                variant="bordered"
                isLoading={loadingHistory}
                startContent={!loadingHistory ? <PxDollarSign className="h-3 w-3" /> : undefined}
                onPress={handleLoadFullHistory}
                title="Kicks a 365-day ledger backfill (picks up older tx for every fan as a side-effect)"
                className="bg-transparent border border-white/[0.08] rounded-none"
              >
                Load full history
              </Button>
            </div>

            {/* Cached tx list */}
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider text-default-400 mb-2">
                Cached transactions {txRows.length ? `(${txRows.length})` : ""}
              </div>
              {loading ? (
                <div className="text-xs text-default-500">Loading…</div>
              ) : txRows.length === 0 ? (
                <div className="text-xs text-default-500">
                  No cached transactions for this fan yet.
                  <br />
                  Try &quot;Load full history&quot; to backfill.
                </div>
              ) : (
                <div className="space-y-1">
                  {txRows.map((tx, i) => {
                    const isUndo = tx.status === "undo";
                    const isLoading = tx.status === "loading";
                    return (
                      <div
                        key={tx.id || tx.tx_id || i}
                        className="flex items-center justify-between text-xs py-1.5 border-b border-white/[0.04] last:border-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-foreground/80">
                            {tx.tx_type || "tx"} ·{" "}
                            <span className="text-default-500">
                              {tx.createdAt
                                ? new Date(tx.createdAt).toLocaleDateString()
                                : tx.created_at
                                  ? new Date(tx.created_at).toLocaleDateString()
                                  : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isLoading && (
                            <span className="text-[10px] text-amber-400">pending</span>
                          )}
                          <span
                            className={
                              isUndo
                                ? "text-red-400 font-medium"
                                : "text-foreground/80 font-medium"
                            }
                          >
                            {isUndo ? "−" : ""}
                            {money(tx.amount)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
