"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { Tooltip } from "@heroui/tooltip";
import { PxUsers, PxFilter, PxRefresh, PxDollarSign } from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE } from "@/lib/hooks/use-sse";
import { useRefreshJobs } from "@/lib/hooks/use-refresh-jobs";
import { useTour } from "@/lib/tour-context";
import {
  TOUR_ACCOUNTS,
  TOUR_SUBSCRIBERS,
  TOUR_SUBSCRIBERS_CACHE,
} from "@/lib/tour-fake-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { RefreshProgressBar } from "@/components/dashboard/RefreshProgressBar";
import { MassDmModal } from "@/components/dashboard/MassDmModal";
import { PxSend } from "@/components/ui/PixelIcons";
import { useProxyFix } from "@/lib/hooks/use-proxy-fix";
import { isProxyError, proxyErrorMessage } from "@/lib/proxy-error";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import type { SubscribersCacheStatus } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

/* --------------- helpers --------------- */

/** "2026-04-18T15:23:27+00:00" → "3 minutes ago". Null-safe. */
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

function money(n?: number | null): string {
  const v = Number(n ?? 0);
  if (!isFinite(v) || v === 0) return "$0";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Spend-breakdown tooltip for the SPENT column. */
function BreakdownTooltip({ sub }: { sub: any }) {
  const parts: Array<{ label: string; value: number }> = [
    { label: "Messages", value: sub.spent_messages ?? 0 },
    { label: "Tips",     value: sub.spent_tips ?? 0 },
    { label: "Posts",    value: sub.spent_posts ?? 0 },
    { label: "Streams",  value: sub.spent_streams ?? 0 },
    { label: "Subs",     value: sub.spent_subscriptions ?? 0 },
  ].filter((p) => (p.value ?? 0) > 0);
  if (parts.length === 0) return null;
  return (
    <div className="text-[11px] leading-tight px-2 py-1">
      {parts.map((p) => (
        <div key={p.label} className="flex gap-3 justify-between min-w-[120px]">
          <span className="text-default-400">{p.label}</span>
          <span className="font-medium">{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------- page --------------- */

type SortKey = "total_spent" | "subscribed_at" | "expired_at" | "username";
type Source = "cache" | "live";

/**
 * Normalise a row so the table can consume cached (flat columns: total_spent,
 * spent_messages, subscribed_at, ...) or live-API (nested shape: subscribedOnData.*)
 * without two separate render branches.
 */
function normalize(sub: any) {
  const sod = sub?.subscribedOnData ?? {};
  return {
    // identity
    id:              sub.fan_of_user_id ?? sub.id,
    username:        sub.username,
    display_name:    sub.display_name ?? sub.name,
    // lifecycle
    subscribed_at:   sub.subscribed_at ?? sod.subscribeAt ?? sub.startDate,
    expired_at:      sub.expired_at ?? sod.expiredAt ?? sub.expireDate,
    subscribe_price: sub.subscribe_price ?? sod.subscribePrice ?? sub.subscribePrice,
    is_active:       sub.is_active,  // cache only
    // spend (cache → flat, live → nested)
    total_spent:         sub.total_spent         ?? sod.totalSumm,
    spent_tips:          sub.spent_tips          ?? sod.tipsSumm,
    spent_messages:      sub.spent_messages      ?? sod.messagesSumm,
    spent_posts:         sub.spent_posts         ?? sod.postsSumm,
    spent_streams:       sub.spent_streams       ?? sod.streamsSumm,
    spent_subscriptions: sub.spent_subscriptions ?? sod.subscribesSumm,
  };
}

/**
 * Count-only fallback for accounts whose backend capabilities don't include
 * `subscribers` (e.g. a stale payload from a backend built before the Fansly
 * roster wiring — Fansly enumeration IS supported now). The COUNT rides on the
 * balances body as `subscriberCount`, so we show that instead of a dead page.
 */
function FanslySubscriberCount({ account }: { account: any }) {
  const api = useApiClient();
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Distinguish "probe failed" (connection problem, retryable) from "count not
  // in the payload" (bare em-dash) — a fansly relogin failure lands here.
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!api || !account?.of_user_id) return;
      setLoading(true);
      setError(false);
      try {
        const res = await api.getBalances(String(account.of_user_id));
        if (!cancelled) {
          const c = Number((res as any)?.balances?.subscriberCount);
          setCount(isFinite(c) ? c : null);
        }
      } catch {
        if (!cancelled) {
          setCount(null);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, account?.of_user_id, attempt]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="heading-2">Subscribers</h2>
        <p className="text-sm text-default-500 mt-1">
          {account?.username || account?.email}
        </p>
      </div>
      <GlassCard animate={false} pattern="rings" className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <PxUsers className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
          <span className="text-xs uppercase tracking-wider text-default-500">Subscribers</span>
        </div>
        {error ? (
          <div className="space-y-3">
            <p className="text-sm text-default-500">
              Couldn&apos;t reach {platformLabel(account?.platform)} — check the account connection
            </p>
            <Button
              size="sm"
              variant="bordered"
              startContent={<PxRefresh className="h-3 w-3" />}
              onPress={() => setAttempt((n) => n + 1)}
              className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="text-4xl font-bold">
            {loading ? "…" : count != null ? count.toLocaleString() : "—"}
          </div>
        )}
        <p className="text-xs text-default-400 mt-3 leading-relaxed max-w-prose">
          A per-subscriber list isn&apos;t available for this account yet — only the
          total count. Individual fans still appear on the Fans tab as they tip or
          message, and new-fan activity arrives via real-time events.
        </p>
      </GlassCard>
    </div>
  );
}

export default function SubscribersPage() {
  const api = useApiClient();
  const { selectedAccount: realSelectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const selectedAccount = isTourActive
    ? (realSelectedAccount ?? TOUR_ACCOUNTS[0])
    : realSelectedAccount;
  const refreshJobs = useRefreshJobs();
  const { promptProxyFix } = useProxyFix();
  const [massOpen, setMassOpen] = useState(false);

  // Open the inline "fix proxy" wizard for the selected account, retrying the
  // action once a working proxy is saved.
  const openProxyFix = (reason?: string | null, onFixed?: () => void) => {
    if (!selectedAccount) return;
    promptProxyFix({
      account: {
        of_user_id: selectedAccount.of_user_id,
        username: selectedAccount.username,
        proxy: (selectedAccount as { proxy?: string | null }).proxy ?? null,
      },
      reason,
      onFixed,
    });
  };

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [cache, setCache] = useState<SubscribersCacheStatus | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // "No subscribers" is a statement about the creator's account. Only make it
  // when the request succeeded — a 429 or a bad proxy is not zero subscribers.
  const [error, setError] = useState<unknown>(null);

  const [filterType, setFilterType] = useState<"all" | "active" | "expired">("all");
  const [sort, setSort] = useState<SortKey>("total_spent");
  // Data source: `cache` reads the local store (fast; freshness depends on
  // the configured refresh cadence for this account). `live` hits OF directly
  // through the existing /subscribers pass-through — always current but
  // expensive and subject to OF's rate limits.
  const [source, setSource] = useState<Source>("cache");

  const uid = selectedAccount?.of_user_id ? String(selectedAccount.of_user_id) : null;
  const subsJob = uid ? refreshJobs.get(uid, "subs") : null;
  const txJob   = uid ? refreshJobs.get(uid, "tx") : null;
  const isFansly = selectedAccount?.platform === "fansly";
  const label = platformLabel(selectedAccount?.platform);
  const connectionState = selectedAccount?.connection_state;
  const connectionHealthy = !connectionState || connectionState === "connected";

  // Backend-emitted capability gate (falls back to the static matrix). Both
  // platforms support enumeration now (Fansly via GET /api/v1/subscribers);
  // an unsupported account (stale backend payload) gets the count-only card
  // and must never fire /subscribers/cached — those requests would burn
  // api_usage quota for a 501.
  const subsSupported = accountSupports(selectedAccount, "subscribers");

  const fetchPage = async (newOffset = 0) => {
    if (isTourActive) {
      // Apply the same filterType / sort over the canned subs.
      let list = [...TOUR_SUBSCRIBERS];
      if (filterType === "active") list = list.filter((s) => s.is_active === 1);
      else if (filterType === "expired") list = list.filter((s) => s.is_active === 0);
      const sortKey = sort;
      list.sort((a, b) => {
        if (sortKey === "total_spent") return (b.total_spent || 0) - (a.total_spent || 0);
        if (sortKey === "username") return String(a.username).localeCompare(String(b.username));
        if (sortKey === "subscribed_at") {
          return new Date(b.subscribed_at).getTime() - new Date(a.subscribed_at).getTime();
        }
        // expired_at — soonest first among active
        return new Date(a.expired_at).getTime() - new Date(b.expired_at).getTime();
      });
      setRows(list);
      setHasMore(false);
      setTotal(list.length);
      setCache(TOUR_SUBSCRIBERS_CACHE);
      setOffset(list.length);
      setLoading(false);
      return;
    }
    if (!api || !uid || !subsSupported) return;
    if (source === "live" && !connectionHealthy) return;
    setLoading(true);
    try {
      if (source === "cache") {
        const res = await api.getCachedSubscribers(uid, {
          limit: 50, offset: newOffset, type: filterType, sort,
        });
        setRows((prev) => (newOffset === 0 ? res.list : [...prev, ...res.list]));
        setHasMore(res.hasMore);
        setTotal(res.total);
        setCache(res.cache);
        setOffset(newOffset + (res.list?.length ?? 0));
      } else {
        // Live: pass-through to the platform. No client-side sort (OF returns by
        // most-recent subscribe/renewal; we'd need every page to sort across the
        // whole set). OF carries no total; Fansly does (stats.total) — and Fansly
        // type-filters client-side within the page, so advance the pager by
        // nextOffset (raw rows consumed), not by the filtered list length.
        const res = await api.getSubscribers(uid, {
          limit: 50, offset: newOffset, type: filterType,
        });
        setRows((prev) => (newOffset === 0 ? res.list : [...prev, ...res.list]));
        setHasMore(res.hasMore);
        setTotal(filterType === "all" ? (res.total ?? 0) : 0);
        setOffset(res.nextOffset ?? newOffset + (res.list?.length ?? 0));
      }
      setError(null);
    } catch (err: any) {
      setError(err);
      // Live mode reads OF through the account's proxy — a 407 here means the
      // saved proxy creds are wrong. Offer the inline fix instead of a dead toast.
      if (isProxyError(err)) openProxyFix(proxyErrorMessage(err), () => fetchPage(newOffset));
      else toast.error(err?.message || "Failed to load subscribers");
    } finally {
      setLoading(false);
    }
  };

  // Reset + reload when account / filter / sort / source changes
  useEffect(() => {
    if (!connectionHealthy && source === "live") {
      setSource("cache");
      return;
    }
    setRows([]);
    setOffset(0);
    fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, filterType, sort, source, connectionHealthy]);

  // Revalidate when a refresh job completes (the cache just got fresher)
  const subsCompletedAt = subsJob?.phase === "complete" ? subsJob.completed_at : null;
  useEffect(() => {
    if (subsCompletedAt) {
      setRows([]);
      setOffset(0);
      fetchPage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsCompletedAt]);

  // Also revalidate on subscriber-lifecycle SSE events (new / renewed / expired)
  const { events: liveEvents } = useSSE({
    types: ["new_subscriber", "renewed_subscriber", "expired_subscriber"],
    bufferSize: 5,
    disabled: isTourActive || !connectionHealthy,
  });
  const lastLiveId = liveEvents[0]?.id ?? null;
  useEffect(() => {
    if (lastLiveId && uid && subsSupported) {
      setRows([]);
      setOffset(0);
      fetchPage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastLiveId]);

  const handleRefreshSubs = async () => {
    if (!api || !uid || !connectionHealthy) return;
    try {
      const res = await api.refreshSubscribers(uid, { mode: "full" });
      if (res.already_running) toast(`Already refreshing…`);
      else toast.success("Full subs sync started — this can take a few minutes");
    } catch (err: any) {
      if (isProxyError(err)) openProxyFix(proxyErrorMessage(err), handleRefreshSubs);
      else toast.error(err?.message || "Refresh failed");
    }
  };

  const handleRefreshSpending = async () => {
    if (!api || !uid || !connectionHealthy) return;
    try {
      const res = await api.refreshTransactions(uid, { mode: "delta" });
      if (res.already_running) toast(`Already refreshing spending…`);
      else toast.success("Spending refresh started");
    } catch (err: any) {
      if (isProxyError(err)) openProxyFix(proxyErrorMessage(err), handleRefreshSpending);
      else toast.error(err?.message || "Refresh failed");
    }
  };

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxUsers className="h-8 w-8" />}
        title="No account selected"
        description="Select an account from the header dropdown to view subscribers."
        pattern="rings"
      />
    );
  }

  // No enumeration capability on this account (stale backend payload — both
  // platforms support it on current backends). Show the count-only card
  // instead of a dead "not available" page.
  if (!subsSupported) {
    return <FanslySubscriberCount account={selectedAccount} />;
  }

  const spendersPct =
    cache?.total && cache.total > 0
      ? Math.round(((cache.spenders ?? 0) / cache.total) * 100)
      : 0;

  const subsBusy = !!subsJob && subsJob.phase !== "complete";
  const txBusy = !!txJob && txJob.phase !== "complete";

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between gap-4 flex-wrap"
      >
        <div>
          <h2 className="heading-2">Subscribers</h2>
          <p className="text-sm text-default-500 mt-1">
            {source === "cache" && cache ? (
              <>
                <span className="font-semibold text-foreground/80">{cache.total.toLocaleString()}</span> subs
                {" · "}
                <span className="font-semibold text-foreground/80">{(cache.spenders ?? 0).toLocaleString()}</span> spenders ({spendersPct}%)
                {" · "}
                <span className="font-semibold text-foreground/80">{money(cache.total_spent_sum)}</span> lifetime
                {" · "}
                <span className="text-default-400">cached {relativeTime(cache.last_refreshed_at)}</span>
              </>
            ) : source === "live" ? (
              <>Live from {label} — fresh but slower. Cache continues to refresh in the background on its configured schedule.</>
            ) : (
              "Loading…"
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap" data-tour="subscribers-source">
          {/* Cache vs Live: user picks fast (may be stale) or slow (always fresh). */}
          <Select
            size="sm"
            variant="bordered"
            selectedKeys={[source]}
            isDisabled={!connectionHealthy}
            className="w-36"
            onChange={(e) => setSource((e.target.value || "cache") as Source)}
            aria-label="Data source"
            classNames={{ trigger: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
          >
            <SelectItem key="cache">Cached</SelectItem>
            <SelectItem key="live">{`Live (${isFansly ? "Fansly" : "OF"})`}</SelectItem>
          </Select>

          <Select
            size="sm"
            variant="bordered"
            selectedKeys={[filterType]}
            className="w-32"
            onChange={(e) => setFilterType((e.target.value || "all") as any)}
            aria-label="Filter subscribers"
            startContent={<PxFilter className="h-4 w-4 text-default-400" />}
            classNames={{ trigger: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
          >
            <SelectItem key="all">All</SelectItem>
            <SelectItem key="active">Active</SelectItem>
            <SelectItem key="expired">Expired</SelectItem>
          </Select>

          {/* Live mode can't sort server-side — OF always returns by most-recent
              subscribe. Disable the sort picker instead of silently ignoring it. */}
          <Select
            size="sm"
            variant="bordered"
            selectedKeys={[sort]}
            className="w-44"
            isDisabled={source === "live"}
            onChange={(e) => setSort((e.target.value || "total_spent") as SortKey)}
            aria-label="Sort subscribers"
            classNames={{ trigger: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
          >
            <SelectItem key="total_spent">Highest spend</SelectItem>
            <SelectItem key="subscribed_at">Most recent sub</SelectItem>
            <SelectItem key="expired_at">Expiring soonest</SelectItem>
            <SelectItem key="username">Username A-Z</SelectItem>
          </Select>

          <Button
            size="sm"
            variant="bordered"
            isDisabled={txBusy || !connectionHealthy}
            isLoading={txBusy}
            startContent={!txBusy ? <PxDollarSign className="h-3 w-3" /> : undefined}
            onPress={handleRefreshSpending}
            title="Refresh transaction ledger now (also runs automatically on its configured schedule)"
            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
          >
            Refresh spending
          </Button>

          <Button
            size="sm"
            variant="bordered"
            isDisabled={subsBusy || !connectionHealthy}
            isLoading={subsBusy}
            startContent={!subsBusy ? <PxRefresh className="h-3 w-3" /> : undefined}
            onPress={handleRefreshSubs}
            title="Refresh subscriber cache now (heavy walk; also runs automatically on its configured schedule)"
            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
          >
            Refresh subs
          </Button>

          {/* Mass DM is OnlyFans-only for now — the backend /mass-messages
              route 501s Fansly accounts, so hide the dead affordance. */}
          {!isFansly && (
            <Button
              size="sm"
              startContent={<PxSend className="h-3 w-3" />}
              onPress={() => setMassOpen(true)}
              isDisabled={!uid || !connectionHealthy}
              title="Send a message to many subscribers at once"
              className="rounded-none font-bold bg-[color:rgb(var(--theme-accent-rgb,245,73,0))] text-black"
            >
              Mass DM
            </Button>
          )}
        </div>
      </motion.div>

      {uid && (
        <MassDmModal
          isOpen={massOpen}
          onClose={() => setMassOpen(false)}
          ofUserId={uid}
          defaultAudience={filterType === "expired" ? "expired" : filterType === "all" ? "all" : "active"}
        />
      )}

      {/* Live progress bars — only render while a refresh is running */}
      <RefreshProgressBar
        state={subsJob}
        label="Subscribers"
        onFixProxy={() => openProxyFix(subsJob?.error, handleRefreshSubs)}
      />
      <RefreshProgressBar
        state={txJob}
        label="Spending"
        onFixProxy={() => openProxyFix(txJob?.error, handleRefreshSpending)}
      />

      <DataState
        loading={loading}
        error={error}
        isEmpty={rows.length === 0}
        onRetry={() => fetchPage(0)}
        noun="subscribers"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={8} rowHeight={56} />
          </div>
        }
        icon={<PxUsers className="h-8 w-8" />}
        title={cache?.total === 0 ? "Cache is empty" : "No subscribers"}
        description={
          cache?.total === 0
            ? `Run "Refresh subs" to pull the list from ${label}. Large accounts can take many minutes on the first sync; subsequent refreshes are incremental and near-instant.`
            : "No subscribers match this filter."
        }
        actionLabel={cache?.total === 0 ? "Refresh subs" : undefined}
        onAction={cache?.total === 0 ? handleRefreshSubs : undefined}
      >
        <>
          <GlassCard animate={false} pattern="hexagon">
            <Table aria-label="Subscribers table" className="min-h-[200px]" data-tour="subscribers-list">
              <TableHeader>
                <TableColumn>USER</TableColumn>
                <TableColumn>USERNAME</TableColumn>
                <TableColumn>SPENT (LIFETIME)</TableColumn>
                <TableColumn>SUBSCRIBED</TableColumn>
                <TableColumn>EXPIRES</TableColumn>
                <TableColumn>PRICE</TableColumn>
                <TableColumn>STATUS</TableColumn>
              </TableHeader>
              <TableBody>
                {rows.map((raw, i) => {
                  const sub = normalize(raw);
                  const spent = Number(sub.total_spent ?? 0);
                  const expiresAt = sub.expired_at ? new Date(sub.expired_at) : null;
                  const isActive =
                    sub.is_active != null
                      ? !!sub.is_active
                      : expiresAt
                        ? expiresAt.getTime() > Date.now()
                        : false;
                  return (
                    <TableRow
                      key={sub.id ?? i}
                      className={cn(
                        "transition-colors hover:bg-accent/5",
                        i !== rows.length - 1 && "border-b border-white/[0.04]"
                      )}
                    >
                      <TableCell className="font-medium">
                        {sub.display_name || sub.username || `User ${sub.id}`}
                      </TableCell>
                      <TableCell className="text-default-500">
                        @{sub.username || "—"}
                      </TableCell>
                      <TableCell>
                        {spent > 0 ? (
                          <Tooltip
                            content={<BreakdownTooltip sub={sub} />}
                            placement="right"
                            delay={300}
                          >
                            <span
                              className={cn(
                                "font-semibold cursor-help",
                                spent >= 500 ? "text-[color:var(--theme-accent,#f54900)]" : "text-foreground/90"
                              )}
                            >
                              {money(spent)}
                            </span>
                          </Tooltip>
                        ) : (
                          <span className="text-default-400">$0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-default-500">
                        {sub.subscribed_at ? new Date(sub.subscribed_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-default-500">
                        {expiresAt ? expiresAt.toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        {sub.subscribe_price != null
                          ? Number(sub.subscribe_price) > 0
                            ? money(sub.subscribe_price)
                            : "Free"
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="flat"
                          className={cn(
                            isActive
                              ? "bg-green-500/10 text-green-400 rounded-none"
                              : "bg-white/[0.06] rounded-none"
                          )}
                        >
                          {isActive ? "Active" : "Expired"}
                        </Chip>
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
              transition={{ delay: 0.2 }}
            >
              <Button
                variant="bordered"
                isLoading={loading}
                onPress={() => fetchPage(offset)}
                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
              >
                {total > rows.length
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
