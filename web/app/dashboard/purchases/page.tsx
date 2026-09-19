"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@heroui/table";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { PxReceipt, PxSearch, PxRefresh } from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import {
  isPlatformNotSupported,
  platformUnsupportedMessage,
} from "@/lib/api-client";
import { useSSE } from "@/lib/hooks/use-sse";
import { useRefreshJobs } from "@/lib/hooks/use-refresh-jobs";
import { useTour } from "@/lib/tour-context";
import {
  TOUR_ACCOUNTS,
  TOUR_TRANSACTIONS,
  TOUR_TRANSACTIONS_CACHE,
} from "@/lib/tour-fake-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { RefreshProgressBar } from "@/components/dashboard/RefreshProgressBar";
import type { TransactionsCacheStatus } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

type Source = "cache" | "live";

/** Strip HTML tags and extract readable text from OF API descriptions. */
function parseDescription(html: string): string {
  if (!html) return "Transaction";
  return html
    .replace(/<a[^>]*>([^<]*)<\/a>/g, "$1")
    .replace(/<span[^>]*>([^<]*)<\/span>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .trim() || "Transaction";
}

/** Derive transaction type from description when the backend didn't tag it. */
function deriveType(desc: string): string {
  if (!desc) return "Other";
  const d = desc.toLowerCase();
  if (d.includes("tip from")) return "Tip";
  if (d.includes("payment for message")) return "Message";
  if (d.includes("subscription")) return "Subscription";
  if (d.includes("post")) return "Post";
  if (d.includes("stream")) return "Stream";
  if (d.includes("referral")) return "Referral";
  if (d.includes("chargeback") || d.includes("refund")) return "Chargeback";
  return "Other";
}

function money(n?: number | null): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "$0.00";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "—";
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function PurchasesPage() {
  const api = useApiClient();
  const { selectedAccount: realSelectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const selectedAccount = isTourActive
    ? (realSelectedAccount ?? TOUR_ACCOUNTS[0])
    : realSelectedAccount;
  const refreshJobs = useRefreshJobs();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().slice(0, 10));

  const [rows, setRows] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // Live mode uses a server-side marker (date-based) for pagination; cache
  // mode uses numeric offset. Keep both, use whichever matches the source.
  const [nextMarker, setNextMarker] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [cache, setCache] = useState<TransactionsCacheStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // The banner above kept the message but not the failure ITSELF, so the list
  // below still rendered "No transactions" underneath it — the page contradicted
  // itself. Keep the thrown error so DataState can replace the empty state.
  const [fetchError, setFetchError] = useState<unknown>(null);
  const [source, setSource] = useState<Source>("cache");

  const uid = selectedAccount?.of_user_id ? String(selectedAccount.of_user_id) : null;
  const connectionState = selectedAccount?.connection_state;
  const connectionHealthy = !connectionState || connectionState === "connected";
  const txJob = uid ? refreshJobs.get(uid, "tx") : null;
  const txBusy = !!txJob && txJob.phase !== "complete";

  // Ledger cache + "Refresh spending" only exist where the transactions sync
  // runs (capability-gated; older backends / other platforms fall back to live).
  const cachedOk = accountSupports(selectedAccount, "transactions_refresh");
  const isFansly = selectedAccount?.platform === "fansly";

  const fetchPage = async (reset: boolean) => {
    if (isTourActive) {
      setRows(TOUR_TRANSACTIONS);
      setHasMore(false);
      setTotal(TOUR_TRANSACTIONS_CACHE.total);
      setCache(TOUR_TRANSACTIONS_CACHE);
      setOffset(TOUR_TRANSACTIONS.length);
      setNextMarker(null);
      setLoading(false);
      setError("");
      return;
    }
    if (!api || !uid) return;
    if (source === "live" && !connectionHealthy) return;
    if (source === "cache" && !cachedOk) {
      // No ledger cache on this platform — the effect below flips us to live.
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setFetchError(null);
    try {
      if (source === "cache") {
        const res = await api.getCachedTransactions(uid, {
          limit: 50,
          offset: reset ? 0 : offset,
          since: `${startDate}T00:00:00+00:00`,
        });
        setRows(reset ? res.list : [...rows, ...res.list]);
        setHasMore(res.hasMore);
        setTotal(res.total);
        setCache(res.cache);
        setOffset((reset ? 0 : offset) + (res.list?.length ?? 0));
        setNextMarker(null);
      } else {
        const marker = reset ? undefined : nextMarker || undefined;
        const res = await api.getPurchases(uid, `${startDate} 00:00:00`, {
          marker, limit: 50,
          // Fansly fallback: the backend translates marker→before, so marker
          // paging works unchanged — but if no marker came back, the wallet
          // endpoint still pages numerically. Ignored for OF.
          ...(isFansly && !reset && !marker ? { offset: rows.length } : {}),
        });
        let list: any[] = res.purchases ?? [];
        if (isFansly) {
          // No probe-proven server-side date param on the Fansly wallet
          // endpoint — apply the start-date filter client-side. Rows without
          // a parseable timestamp are kept rather than silently dropped.
          const cutoff = new Date(`${startDate}T00:00:00`).getTime();
          if (isFinite(cutoff)) {
            list = list.filter((p: any) => {
              const t = new Date(p.createdAt ?? p.created_at ?? NaN).getTime();
              return !isFinite(t) || t >= cutoff;
            });
          }
        }
        setRows(reset ? list : [...rows, ...list]);
        setHasMore(res.hasMore);
        setNextMarker(res.nextMarker);
        setTotal(0);
      }
    } catch (err: any) {
      const msg = isPlatformNotSupported(err)
        ? platformUnsupportedMessage(err.data?.feature, err.data?.platform)
        : err?.message || "Failed to load transactions";
      setError(msg);
      setFetchError(err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Platforms without the tx sync can't serve cached mode — force live so the
  // page never shows a misleading "0 transactions · $0.00 · cached never".
  useEffect(() => {
    if (!cachedOk && source === "cache") setSource("live");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedOk, uid]);

  // Reset + load on account / startDate / source change
  useEffect(() => {
    if (!connectionHealthy && cachedOk && source === "live") {
      setSource("cache");
      return;
    }
    setRows([]);
    setOffset(0);
    setNextMarker(null);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, startDate, source, connectionHealthy]);

  // Revalidate when a tx refresh completes
  const txCompletedAt = txJob?.phase === "complete" ? txJob.completed_at : null;
  useEffect(() => {
    if (txCompletedAt && source === "cache") {
      setRows([]);
      setOffset(0);
      fetchPage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txCompletedAt]);

  // And on tip / purchase / balance SSE events. balance_increased matters for
  // fansly: PPV + subscription money never emits new_purchase there.
  const { events: liveEvents } = useSSE({
    types: ["new_tip", "new_purchase", "balance_increased"],
    bufferSize: 5,
    disabled: isTourActive || !connectionHealthy,
  });
  const lastLiveId = liveEvents[0]?.id ?? null;
  useEffect(() => {
    if (lastLiveId && uid) {
      setRows([]);
      setOffset(0);
      setNextMarker(null);
      fetchPage(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLiveId]);

  const handleRefreshSpending = async () => {
    if (!api || !uid || !connectionHealthy) return;
    try {
      const res = await api.refreshTransactions(uid, { mode: "delta" });
      if (res.already_running) toast("Already refreshing spending…");
      else toast.success("Spending refresh started");
    } catch (err: any) {
      toast.error(
        isPlatformNotSupported(err)
          ? platformUnsupportedMessage(err.data?.feature, err.data?.platform)
          : err?.message || "Refresh failed"
      );
    }
  };

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxReceipt className="h-8 w-8" />}
        title="No account selected"
        description="Select an account from the header dropdown to view transactions."
        pattern="moroccan"
      />
    );
  }

  if (!connectionHealthy && !cachedOk) {
    return (
      <EmptyState
        icon={<PxReceipt className="h-8 w-8" />}
        title={connectionState === "login_failed" ? "Login failed" : "Transactions sync unavailable"}
        description={selectedAccount.login_failure?.message
          || selectedAccount.connection_error?.message
          || "Resolve this account before requesting live transactions."}
        pattern="moroccan"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2 className="heading-2">Purchases & Transactions</h2>
        <p className="text-sm text-default-500 mt-1">
          {source === "cache" && !cachedOk ? (
            <>The cached ledger isn&apos;t available on {platformLabel(selectedAccount?.platform)} yet — showing live data.</>
          ) : source === "cache" && cache ? (
            <>
              <span className="font-semibold text-foreground/80">{cache.total.toLocaleString()}</span> transactions
              {" · "}
              <span className="font-semibold text-foreground/80">{money(cache.total_amount)}</span> gross
              {" · "}
              <span className="font-semibold text-foreground/80">{money(cache.total_net)}</span> net
              {" · "}
              <span className="text-default-400">cached {relativeTime(cache.last_refreshed_at)}</span>
            </>
          ) : source === "live" ? (
            <>Live from {platformLabel(selectedAccount?.platform)} — fresh but slower.</>
          ) : (
            "Loading…"
          )}
        </p>
      </motion.div>

      {/* Filters + refresh */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex flex-wrap items-end gap-3"
        data-tour="purchases-filter"
      >
        <Select
          size="sm"
          variant="bordered"
          selectedKeys={[source]}
          isDisabled={!connectionHealthy}
          className="w-36"
          onChange={(e) => setSource((e.target.value || (cachedOk ? "cache" : "live")) as Source)}
          aria-label="Data source"
          classNames={{ trigger: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
          items={
            cachedOk
              ? [{ key: "cache", label: "Cached" }, { key: "live", label: "Live" }]
              : [{ key: "live", label: "Live" }]
          }
        >
          {(o) => <SelectItem key={o.key}>{o.label}</SelectItem>}
        </Select>

        <Input
          type="date"
          label="Start Date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          variant="bordered"
          className="w-44"
          classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
        />
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold"
            onPress={() => fetchPage(true)}
            isLoading={loading}
            startContent={<PxSearch className="h-4 w-4" />}
          >
            Fetch
          </Button>
        </motion.div>
        {cachedOk && (
          <Button
            size="sm"
            variant="bordered"
            isDisabled={txBusy || !connectionHealthy}
            isLoading={txBusy}
            startContent={!txBusy ? <PxRefresh className="h-3 w-3" /> : undefined}
            onPress={handleRefreshSpending}
            title="Refresh transaction ledger now (also runs automatically on its configured schedule)"
            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
          >
            Refresh spending
          </Button>
        )}
      </motion.div>

      <RefreshProgressBar state={txJob} label="Spending" />

      {/* Only annotate rows we ARE showing. With no rows the failure is the
          whole story, and DataState tells it in full below. */}
      {error && rows.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="dashboard-error"
        >
          {error}
        </motion.div>
      )}

      <DataState
        loading={loading}
        error={fetchError}
        isEmpty={rows.length === 0}
        onRetry={() => fetchPage(true)}
        noun="transactions"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={8} rowHeight={56} />
          </div>
        }
        icon={<PxReceipt className="h-8 w-8" />}
        title={cachedOk && source === "cache" && cache?.total === 0 ? "Ledger cache is empty" : "No transactions"}
        description={
          cachedOk && source === "cache" && cache?.total === 0
            ? 'Run "Refresh spending" to populate the ledger. First sync pulls the last 30 days (configurable) then delta-updates from there.'
            : !cachedOk && source === "cache"
              ? `The cached ledger isn't available on ${platformLabel(selectedAccount?.platform)} yet — switch to Live.`
              : "No transactions found for this filter."
        }
        actionLabel={cachedOk && source === "cache" && cache?.total === 0 ? "Refresh spending" : undefined}
        onAction={cachedOk && source === "cache" && cache?.total === 0 ? handleRefreshSpending : undefined}
      >
        <>
          <GlassCard delay={0.2} pattern="checkerboard">
            <Table aria-label="Purchases table" className="min-h-[200px]" data-tour="purchases-list">
              <TableHeader>
                <TableColumn>DESCRIPTION</TableColumn>
                <TableColumn>AMOUNT</TableColumn>
                <TableColumn>NET</TableColumn>
                <TableColumn>FEE</TableColumn>
                <TableColumn>TYPE</TableColumn>
                <TableColumn>STATUS</TableColumn>
                <TableColumn>DATE</TableColumn>
              </TableHeader>
              <TableBody>
                {rows.map((p, i) => {
                  // Fansly rows carry numeric status codes (1 = settled) — map
                  // to the OF-style strings the chip styling expects.
                  const rawStatus = p.status ?? "done";
                  const status =
                    rawStatus === 1 || rawStatus === "1"
                      ? "done"
                      : // OF returns "loading" while a payout is still in its
                        // pending-hold window — show it as "pending", not a
                        // raw spinner-looking word.
                        String(rawStatus) === "loading"
                        ? "pending"
                        : String(rawStatus);
                  // Rows in cache come from raw_json (OF-native shape) so field
                  // names are consistent with live mode. Coerce to String: fansly
                  // emits integer type codes (15001/2116) and .toLowerCase() on a
                  // number crashes the page — keep as defense even now that the
                  // backend normalizer emits string types.
                  const typeLabel = String(p.tx_type || p.type || deriveType(p.description));
                  const fanId = p.user?.id ?? p.user_id ?? p.fan_id;
                  return (
                    <TableRow
                      key={p.id || p.tx_id || i}
                      className={cn(
                        "transition-colors hover:bg-accent/5",
                        i !== rows.length - 1 && "border-b border-white/[0.04]"
                      )}
                    >
                      <TableCell className="font-medium max-w-[300px] truncate">
                        {p.description
                          ? parseDescription(p.description)
                          : `${typeLabel}${fanId ? ` · fan ${fanId}` : ""}`}
                      </TableCell>
                      <TableCell>{money(p.amount)}</TableCell>
                      <TableCell className="text-success">{money(p.net)}</TableCell>
                      {/* Fansly rows carry `tax` (destinationTax), not `fee`. */}
                      <TableCell className="text-default-500">{money(p.fee ?? p.tax)}</TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="flat"
                          className="rounded-none capitalize"
                          style={{
                            backgroundColor:
                              typeLabel.toLowerCase() === "chargeback"
                                ? "rgba(239,68,68,0.12)"
                                : "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)",
                          }}
                        >
                          {typeLabel}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="flat"
                          className={cn(
                            "rounded-none capitalize",
                            status === "undo"
                              ? "bg-red-500/10 text-red-400"
                              : status === "pending"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-green-500/10 text-green-400"
                          )}
                        >
                          {status === "undo" ? "chargeback" : status}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-default-500">
                        {p.createdAt
                          ? new Date(p.createdAt).toLocaleDateString()
                          : p.created_at
                            ? new Date(p.created_at).toLocaleDateString()
                            : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </GlassCard>

          {hasMore && (
            <motion.div
              className="flex justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <Button
                variant="bordered"
                isLoading={loading}
                onPress={() => fetchPage(false)}
                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
              >
                {source === "cache" && total > rows.length
                  ? `Load more (${(total - rows.length).toLocaleString()} remaining)`
                  : "Load more"}
              </Button>
            </motion.div>
          )}
        </>
      </DataState>
    </div>
  );
}
