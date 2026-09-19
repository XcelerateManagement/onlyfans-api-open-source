"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardBody } from "@heroui/card";
import { Tooltip } from "@heroui/tooltip";

import type { EarningsSummary, EarningsPlatform } from "@/lib/api-client";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE } from "@/lib/hooks/use-sse";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS, TOUR_EARNINGS_SUMMARY } from "@/lib/tour-fake-data";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { Skeleton } from "@/components/dashboard/Skeleton";
import { cn } from "@/lib/utils";
import {
  PxDollarSign,
  PxFileText,
  PxBell,
  PxZap,
  PxUsers,
  PxUserCheck,
  PxActivity,
} from "@/components/ui/PixelIcons";

type PeriodKey = "today" | "week" | "month";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
];

/** What "this period" covers — periods are UTC on the server. */
const PERIOD_SPAN: Record<PeriodKey, string> = {
  today: "today so far (since 00:00 UTC)",
  week: "this week so far (since Monday 00:00 UTC)",
  month: "this month so far (since the 1st, 00:00 UTC)",
};

const SAME_POINT_LABEL: Record<PeriodKey, string> = {
  today: "same time yesterday",
  week: "same point last week",
  month: "same point last month",
};

const PREV_LABEL: Record<PeriodKey, string> = {
  today: "yesterday",
  week: "last week",
  month: "last month",
};

type CategoryKey =
  | "subscriptions"
  | "posts"
  | "messages"
  | "tips"
  | "streams"
  | "referrals";

const CATEGORY_ORDER: CategoryKey[] = [
  "subscriptions",
  "posts",
  "messages",
  "tips",
  "streams",
  "referrals",
];

interface TileHelp {
  what: string;
  source: string;
}

const CATEGORY_META: Record<CategoryKey, { label: string; icon: React.ReactNode; help: TileHelp }> = {
  subscriptions: {
    label: "Subscriptions",
    icon: <PxUsers className="h-4 w-4" />,
    help: {
      what: "Subscription revenue: new subscriptions and renewals paid in this period.",
      source:
        "OnlyFans payout transactions (subscriptions & renewals) + Fansly wallet ledger (subscription payments).",
    },
  },
  posts: {
    label: "Posts",
    icon: <PxFileText className="h-4 w-4" />,
    help: {
      what: "Revenue from paid (PPV) post unlocks.",
      source: "OnlyFans post payments + Fansly post purchases.",
    },
  },
  messages: {
    label: "Messages",
    icon: <PxBell className="h-4 w-4" />,
    help: {
      what: "Revenue from paid messages — PPV content unlocked in chat.",
      source: "OnlyFans message payments + Fansly message purchases.",
    },
  },
  tips: {
    label: "Tips",
    icon: <PxZap className="h-4 w-4" />,
    help: {
      what: "Tips fans sent (on posts, in chat, or on the profile).",
      source: "OnlyFans tip transactions + Fansly tips.",
    },
  },
  streams: {
    label: "Streams",
    icon: <PxActivity className="h-4 w-4" />,
    help: {
      what: "Revenue from live streams.",
      source: "OnlyFans stream payments + Fansly live-stream tips.",
    },
  },
  referrals: {
    label: "Referrals",
    icon: <PxDollarSign className="h-4 w-4" />,
    help: {
      what: "Commission from creators you referred.",
      source: "OnlyFans referral transactions (OnlyFans only — Fansly has no referral earnings).",
    },
  },
};

const NEW_SUBS_HELP: TileHelp = {
  what: "Fans whose subscription started in this period, free or paid. Renewals are not counted as new.",
  source:
    "Subscriber lists synced in the background (OnlyFans subscribers, Fansly subscribers). Fansly renewals are read from its wallet ledger.",
};

const PLATFORM_LABEL: Record<EarningsPlatform, string> = {
  onlyfans: "OnlyFans",
  fansly: "Fansly",
};
const PLATFORMS: EarningsPlatform[] = ["onlyfans", "fansly"];

type PlatformSplit = Partial<Record<EarningsPlatform, number>>;

interface NewSubs {
  count: number;
  renewals: number;
  prevCount: number;
  byPlatform: Partial<Record<EarningsPlatform, { count: number; renewals: number }>>;
  accounts: number;
  tracked: number;
  oldestSyncAt: string | null;
}

interface FanslyWallet {
  current: number;
  available: number;
  pending: number;
  accounts: number;
  sampled: number;
  pendingSampled: number;
  newestSampleAt: string | null;
  connectionErrors: number;
  neverSynced: number;
}

interface Aggregated {
  total: number;
  /** Comparison base for the trend — same point last period when available. */
  prevTotal: number;
  prevIsToDate: boolean;
  byCategory: Record<CategoryKey, number>;
  byCategoryPlatform: Record<CategoryKey, PlatformSplit>;
  byPlatformTotal: PlatformSplit;
  uncategorized: number;
  chart: number[];
  newSubs: NewSubs | null;
  fansly: FanslyWallet | null;
  computedAt: string | null;
  accountsStale: number;
  accountsNeverSynced: number;
  oldestSyncAt: string | null;
}

const EMPTY_CATEGORIES: Record<CategoryKey, number> = {
  subscriptions: 0, posts: 0, messages: 0, tips: 0, streams: 0, referrals: 0,
};

const EMPTY: Aggregated = {
  total: 0,
  prevTotal: 0,
  prevIsToDate: false,
  byCategory: EMPTY_CATEGORIES,
  byCategoryPlatform: {
    subscriptions: {}, posts: {}, messages: {}, tips: {}, streams: {}, referrals: {},
  },
  byPlatformTotal: {},
  uncategorized: 0,
  chart: [],
  newSubs: null,
  fansly: null,
  computedAt: null,
  accountsStale: 0,
  accountsNeverSynced: 0,
  oldestSyncAt: null,
};

const num = (v: unknown) => Number(v) || 0;

/** One mapping for both the live response and the tour fixture. */
function toAggregated(res: Partial<EarningsSummary>): Aggregated {
  const cats = res.by_category || {};
  const byCategory = { ...EMPTY_CATEGORIES };
  const byCategoryPlatform = { ...EMPTY.byCategoryPlatform };
  for (const key of CATEGORY_ORDER) {
    byCategory[key] = num(cats[key]);
    byCategoryPlatform[key] = { ...(res.by_category_platform?.[key] || {}) };
  }
  const byPlatformTotal: PlatformSplit = {};
  let uncategorized = 0;
  for (const p of PLATFORMS) {
    const bp = res.by_platform?.[p];
    if (!bp) continue;
    byPlatformTotal[p] = num(bp.total);
    uncategorized += num(bp.uncategorized);
  }
  const toDate = res.prev_total_to_date;
  const ns = res.new_subs;
  const fb = res.fansly_balance;
  const fanslyStats = res.by_platform?.fansly;
  return {
    total: num(res.total),
    prevTotal: toDate != null ? num(toDate) : num(res.prev_total),
    prevIsToDate: toDate != null,
    byCategory,
    byCategoryPlatform,
    byPlatformTotal,
    uncategorized,
    chart: res.chart ? [...res.chart] : [],
    newSubs: ns
      ? {
          count: num(ns.count),
          renewals: num(ns.renewals),
          prevCount: num(ns.prev_count),
          byPlatform: Object.fromEntries(
            PLATFORMS.filter((p) => ns.by_platform?.[p]).map((p) => [
              p,
              { count: num(ns.by_platform[p]!.count), renewals: num(ns.by_platform[p]!.renewals) },
            ]),
          ),
          accounts: num(ns.accounts),
          tracked: num(ns.accounts_tracked),
          oldestSyncAt: ns.oldest_sync_at ?? null,
        }
      : null,
    fansly:
      fb && fb.accounts > 0
        ? {
            current: num(fb.current),
            available: num(fb.available),
            pending: num(fb.pending),
            accounts: num(fb.accounts),
            sampled: num(fb.sampled),
            pendingSampled: num(fb.pending_sampled),
            newestSampleAt: fb.newest_sample_at ?? null,
            connectionErrors: num(fanslyStats?.connection_errors),
            neverSynced: num(fanslyStats?.never_synced),
          }
        : null,
    computedAt: res.computed_at ?? null,
    accountsStale: num(res.accounts_stale),
    accountsNeverSynced: num(res.accounts_never_synced),
    oldestSyncAt: res.oldest_sync_at ?? null,
  };
}

function formatDollars(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/** Server timestamps are UTC; the offset-less "YYYY-MM-DD HH:MM:SS" form would
 *  otherwise be parsed as the viewer's local time. */
function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  let s = value.trim().replace(" ", "T");
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatAgo(value: string | null | undefined): string | null {
  const d = parseUtc(value);
  if (!d) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const TOOLTIP_CLASSES = {
  content: "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs",
};

interface HelpRow {
  label: string;
  value: string;
  tone?: "warning";
}

function HelpCard({
  title,
  what,
  rows = [],
  source,
  notes = [],
}: {
  title: string;
  what: string;
  rows?: HelpRow[];
  source?: string;
  notes?: { text: string; tone?: "warning" }[];
}) {
  return (
    <div className="max-w-[280px] px-1 py-1.5 text-[11px] leading-snug space-y-1.5">
      <p className="text-[10px] uppercase tracking-wider font-semibold text-foreground">
        {title}
      </p>
      <p className="text-default-300">{what}</p>
      {rows.length > 0 && (
        <div className="border-t border-white/[0.06] pt-1.5 space-y-0.5">
          {rows.map((r) => (
            <div key={r.label} className="flex justify-between gap-4">
              <span className="text-default-400">{r.label}</span>
              <span
                className={cn(
                  "tabular-nums font-medium",
                  r.tone === "warning" && "text-warning-500",
                )}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
      {source && (
        <p className="border-t border-white/[0.06] pt-1.5 text-default-500">
          <span className="text-default-400">Source: </span>
          {source}
        </p>
      )}
      {notes.map((n) => (
        <p
          key={n.text}
          className={n.tone === "warning" ? "text-warning-500" : "text-default-500"}
        >
          {n.text}
        </p>
      ))}
    </div>
  );
}

function platformRows(split: PlatformSplit, format: (n: number) => string): HelpRow[] {
  return PLATFORMS.filter((p) => split[p] !== undefined).map((p) => ({
    label: PLATFORM_LABEL[p],
    value: format(split[p] || 0),
  }));
}

export function EarningsOverview() {
  const api = useApiClient();
  const { accounts: realAccounts, loaded: accountsLoaded } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const accounts = isTourActive ? TOUR_ACCOUNTS : realAccounts;
  const [period, setPeriod] = useState<PeriodKey>("week");
  const [data, setData] = useState<Aggregated>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<number>(0);
  const [error, setError] = useState(false);
  // Flip once the first fetch settles (success OR failure) so a failed-then-
  // retried load doesn't stay stuck behind the skeleton (which used to gate on
  // lastRefreshed===0 and never clear after an error).
  const [hasAttempted, setHasAttempted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live refresh: refetch when events that move a number on this card arrive
  // (the backend drops its summary cache on the same events).
  const { events } = useSSE({
    types: ["new_tip", "new_purchase", "balance_increased", "new_subscriber", "renewed_subscriber"],
    bufferSize: 30,
  });
  // Debounce so rapid event bursts (e.g. a poller batch) trigger one refetch,
  // not one per event.
  const lastEventId = useDebounced(events[0]?.id ?? null, 800);

  const [cached, setCached] = useState(false);
  const [capped, setCapped] = useState(false);

  useEffect(() => {
    // Tour mode: use canned data, no API calls.
    if (isTourActive) {
      const res = TOUR_EARNINGS_SUMMARY[period];
      setData(toAggregated(res as unknown as Partial<EarningsSummary>));
      setCached(res.cached);
      setCapped(res.transactions_capped);
      setLastRefreshed(Date.now());
      return;
    }
    if (!api) return;
    if (accounts.length === 0) {
      // An empty account list has two very different causes. When the provider
      // has never completed a fetch (a 429 on click-through is the usual one),
      // showing EMPTY renders $0.00 across the tiles with no error text — a
      // financial figure asserted from a request that never landed. Surface the
      // failure instead and let the existing retry branch handle it.
      if (!accountsLoaded) {
        setError(true);
        setHasAttempted(true);
        return;
      }
      setData(EMPTY);
      setHasAttempted(true);
      return;
    }
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // Single server-aggregated + cached call — no per-account fan-out.
        // Backend invalidates its cache on the same live events we listen
        // for, so SSE-driven refetches see fresh numbers.
        const res = await api!.getEarningsSummary(period);
        if (cancelled) return;
        setData(toAggregated(res));
        setCached(!!res.cached);
        setCapped(!!res.transactions_capped);
        setLastRefreshed(Date.now());
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHasAttempted(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // accountsLoaded is a dep so a recovered account fetch (0 accounts →
    // loaded) re-runs and clears the error rather than latching it.
  }, [api, accounts.length, accountsLoaded, period, lastEventId, isTourActive, reloadKey]);

  // `total` is period earnings only — the Fansly wallet is a snapshot and is
  // never part of it (nor of the trend or the tile percentages).
  const periodTotal = data.total;

  const deltaPct = useMemo(() => {
    if (data.prevTotal <= 0) return null;
    return ((periodTotal - data.prevTotal) / data.prevTotal) * 100;
  }, [periodTotal, data.prevTotal]);

  // "Initial loading" = we have accounts to fetch for, but the first response
  // hasn't settled yet. Gated on hasAttempted (not lastRefreshed===0) so a
  // failed load surfaces the error block instead of an eternal skeleton.
  const isLoading =
    !isTourActive && accounts.length > 0 && !error && (loading || !hasAttempted);

  // Hold the count-up target at 0 while loading so the smooth 0 → real-value
  // animation kicks off the moment the skeleton goes away — instead of
  // running invisibly behind the skeleton and finishing before reveal.
  const animatedTotal = useCountUp(isLoading ? 0 : periodTotal, 700);

  // Prefer the server's build time: a cached body can be minutes old while
  // the browser fetched it just now.
  const updatedAt = parseUtc(data.computedAt) ?? (lastRefreshed > 0 ? new Date(lastRefreshed) : null);
  const syncedAgo = formatAgo(data.oldestSyncAt);

  const totalHelp = (
    <HelpCard
      title="Total earnings"
      what={`Net revenue (after platform fees) from all connected accounts, ${PERIOD_SPAN[period]}. Payouts, refunds and wallet transfers are excluded; the Fansly wallet balance is not included.`}
      rows={[
        ...platformRows(data.byPlatformTotal, formatDollars),
        ...(data.uncategorized > 0
          ? [{ label: "Not in a category", value: formatDollars(data.uncategorized) }]
          : []),
        {
          label: data.prevIsToDate ? `At the ${SAME_POINT_LABEL[period]}` : `All of ${PREV_LABEL[period]}`,
          value: formatDollars(data.prevTotal),
        },
      ]}
      source="OnlyFans payout transactions and the Fansly wallet ledger, synced in the background."
      notes={[
        ...(syncedAgo ? [{ text: `Oldest account sync: ${syncedAgo}.` }] : []),
        ...(data.accountsStale + data.accountsNeverSynced > 0
          ? [{
              text: `${data.accountsStale + data.accountsNeverSynced} account(s) not synced recently — their latest earnings may be missing.`,
              tone: "warning" as const,
            }]
          : []),
      ]}
    />
  );

  return (
    <Card className="relative bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none overflow-hidden">
      <CornerBrackets size={10} />
      <CardBody className="p-5 md:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold">
              Creator earnings overview
            </p>
            <p className="text-xs text-default-400">
              {accounts.length} account{accounts.length === 1 ? "" : "s"} ·{" "}
              {PERIODS.find((p) => p.key === period)?.label.toLowerCase()}
              {updatedAt && (
                <span className="ml-2 text-default-500">
                  · updated {updatedAt.toLocaleTimeString()}
                  {cached && " (cached)"}
                </span>
              )}
              {capped && (
                <span className="ml-2 text-warning-500" title="Hit the per-account transaction cap (500). Category totals may undercount for this period.">
                  · truncated
                </span>
              )}
            </p>
          </div>
          <PeriodToggle value={period} onChange={setPeriod} />
        </div>

        {error && lastRefreshed === 0 ? (
          <div className="flex flex-col items-start gap-3 py-8">
            <p className="text-sm text-danger-400">
              Couldn&apos;t load earnings — the API didn&apos;t respond.
            </p>
            <button
              onClick={() => {
                setError(false);
                setReloadKey((k) => k + 1);
              }}
              className="inline-flex items-center gap-1.5 border border-white/[0.08] px-3 py-1.5 text-xs uppercase tracking-wider font-semibold text-default-300 hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] hover:text-foreground"
            >
              Retry
            </button>
          </div>
        ) : (
        <>
        {error && (
          <div className="mb-4 flex items-center gap-2 text-xs text-warning-500">
            <span>Couldn&apos;t refresh — showing last known figures.</span>
            <button
              onClick={() => {
                setError(false);
                setReloadKey((k) => k + 1);
              }}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Retry
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] items-end gap-6 mb-6">
          <Tooltip content={totalHelp} placement="bottom-start" delay={300} classNames={TOOLTIP_CLASSES}>
            <div tabIndex={0} className="w-fit cursor-help outline-none">
              <AnimatePresence mode="wait">
                {isLoading ? (
                  <Skeleton className="h-12 md:h-14 w-48" />
                ) : (
                  <motion.p
                    key={period}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="text-4xl md:text-5xl font-bold tracking-tight tabular-nums"
                    style={{ color: "var(--theme-accent, #f54900)" }}
                  >
                    {formatDollars(animatedTotal)}
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-3 mt-2 text-xs">
                <span className="text-default-500">Total earnings</span>
                {deltaPct !== null && (
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      deltaPct >= 0 ? "text-success-500" : "text-danger-500"
                    )}
                  >
                    {deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct).toFixed(1)}% vs{" "}
                    {data.prevIsToDate ? SAME_POINT_LABEL[period] : PREV_LABEL[period]}
                  </span>
                )}
                {loading && (
                  <span className="text-default-400">refreshing…</span>
                )}
              </div>
            </div>
          </Tooltip>
          <Sparkline data={data.chart} width={180} height={44} />
        </div>

        {!isLoading && data.fansly && <FanslyWalletRow wallet={data.fansly} />}

        <motion.div
          className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.04 } },
          }}
          key={period}
        >
          {CATEGORY_ORDER.map((key) => (
            <motion.div
              key={key}
              variants={{
                hidden: { opacity: 0, y: 10 },
                visible: { opacity: 1, y: 0 },
              }}
              transition={{ duration: 0.25 }}
            >
              <CategoryTile
                label={CATEGORY_META[key].label}
                icon={CATEGORY_META[key].icon}
                help={CATEGORY_META[key].help}
                split={data.byCategoryPlatform[key]}
                period={period}
                value={data.byCategory[key]}
                total={periodTotal}
                loading={isLoading}
              />
            </motion.div>
          ))}
          <motion.div
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 },
            }}
            transition={{ duration: 0.25 }}
          >
            <NewSubsTile subs={data.newSubs} period={period} loading={isLoading} />
          </motion.div>
        </motion.div>
        </>
        )}
      </CardBody>
    </Card>
  );
}

function FanslyWalletRow({ wallet }: { wallet: FanslyWallet }) {
  const unsampled = wallet.accounts - wallet.sampled;
  const sampledAgo = formatAgo(wallet.newestSampleAt);
  const help = (
    <HelpCard
      title="Fansly wallet"
      what="A live snapshot of the Fansly earnings wallets — not money earned in this period, so it is never added to the total, the trend or the tiles."
      rows={[
        { label: "Current (whole wallet)", value: formatDollars(wallet.current) },
        { label: "On hold (pending)", value: formatDollars(wallet.pending) },
        { label: "Available to withdraw", value: formatDollars(wallet.available) },
        {
          label: "Accounts sampled",
          value: `${wallet.sampled} of ${wallet.accounts}`,
          tone: unsampled > 0 ? "warning" : undefined,
        },
      ]}
      source="Fansly earnings wallet (withdrawable balance) + pending earnings, refreshed in the background."
      notes={[
        ...(sampledAgo ? [{ text: `Last sampled ${sampledAgo}.` }] : []),
        ...(wallet.pendingSampled < wallet.sampled
          ? [{
              text: `${wallet.sampled - wallet.pendingSampled} account(s) have no pending figure yet — their Current equals Available until the next refresh.`,
            }]
          : []),
        ...(wallet.connectionErrors > 0
          ? [{
              text: `${wallet.connectionErrors} Fansly account(s) can't sync (proxy or login error) — their balance and earnings are out of date. Fix them on the Accounts page.`,
              tone: "warning" as const,
            }]
          : []),
      ]}
    />
  );
  return (
    <Tooltip content={help} placement="bottom" delay={300} classNames={TOOLTIP_CLASSES}>
      <div
        tabIndex={0}
        className={cn(
          "mb-6 border bg-black/20 px-3 py-2.5 cursor-help outline-none transition-colors",
          unsampled > 0 || wallet.connectionErrors > 0
            ? "border-warning-500/25"
            : "border-white/[0.06] hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.25)]",
        )}
      >
        <div className="flex items-center justify-between gap-x-6 gap-y-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider text-default-500 font-semibold">
            Fansly wallet
          </span>
          <div className="flex items-baseline gap-5">
            <span className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wider text-default-500">Current</span>
              <span className="text-sm font-bold tabular-nums">{formatDollars(wallet.current)}</span>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-[10px] uppercase tracking-wider text-default-500">Available</span>
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: "var(--theme-accent, #f54900)" }}
              >
                {formatDollars(wallet.available)}
              </span>
            </span>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-default-400">
          {wallet.pending > 0
            ? `${formatDollars(wallet.pending)} on hold · `
            : ""}
          wallet snapshot, not part of period earnings
          {wallet.connectionErrors > 0 && (
            <span className="text-warning-500">
              {" "}· {wallet.connectionErrors} account{wallet.connectionErrors === 1 ? "" : "s"} not syncing
            </span>
          )}
        </p>
      </div>
    </Tooltip>
  );
}

function PeriodToggle({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (v: PeriodKey) => void;
}) {
  return (
    <div
      className="inline-flex border border-white/[0.06] bg-black/20 relative"
      role="tablist"
    >
      {PERIODS.map((p) => {
        const active = p.key === value;
        return (
          <button
            key={p.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.key)}
            className={cn(
              "relative px-3 py-1.5 text-xs font-semibold tracking-wider uppercase transition-colors z-10",
              active
                ? "text-white"
                : "text-default-400 hover:text-default-200"
            )}
          >
            {active && (
              <motion.span
                layoutId="period-indicator"
                className="absolute inset-0"
                style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative z-10">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const TILE_CLASSES =
  "relative group h-full border border-white/[0.06] bg-black/20 p-3 cursor-help outline-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.25)] focus-visible:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.5)] transition-colors";

function TileHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-default-500 mb-1.5 min-w-0">
      <span className="shrink-0" style={{ color: "var(--theme-accent, #f54900)" }}>{icon}</span>
      {/* Two-up tiles on a phone are ~100px of label space: tighten the type
          there so "Subscriptions" fits; truncate only as a last resort. */}
      <p className="text-[10px] sm:text-[11px] uppercase tracking-wide sm:tracking-wider font-semibold truncate">
        {label}
      </p>
    </div>
  );
}

function CategoryTile({
  label,
  icon,
  help,
  split,
  period,
  value,
  total,
  loading = false,
}: {
  label: string;
  icon: React.ReactNode;
  help: TileHelp;
  split: PlatformSplit;
  period: PeriodKey;
  value: number;
  total: number;
  loading?: boolean;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  // Same "hold at 0 during loading" trick as the parent — keeps the
  // count-up synchronized with the skeleton reveal.
  const animated = useCountUp(loading ? 0 : value, 600);
  const content = (
    <HelpCard
      title={label}
      what={`${help.what} Net of platform fees, ${PERIOD_SPAN[period]}.`}
      rows={[
        ...platformRows(split, formatDollars),
        { label: "Share of total", value: pct > 0 ? `${pct.toFixed(1)}%` : "—" },
      ]}
      source={help.source}
    />
  );
  return (
    <Tooltip content={content} placement="top" delay={300} classNames={TOOLTIP_CLASSES}>
      <div tabIndex={0} className={TILE_CLASSES}>
        <TileHeader icon={icon} label={label} />
        {loading ? (
          <Skeleton className="h-6 w-20" />
        ) : (
          <p className="text-lg font-bold tracking-tight tabular-nums">
            {formatDollars(animated)}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-[2px] flex-1 bg-white/[0.05] overflow-hidden">
            <motion.div
              className="h-full"
              style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, pct)}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <span className="text-[10px] text-default-400 tabular-nums w-10 text-right">
            {pct > 0 ? `${pct.toFixed(1)}%` : "—"}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}

function NewSubsTile({
  subs,
  period,
  loading = false,
}: {
  subs: NewSubs | null;
  period: PeriodKey;
  loading?: boolean;
}) {
  const count = subs?.count ?? 0;
  const renewals = subs?.renewals ?? 0;
  const animated = useCountUp(loading ? 0 : count, 600);
  const newShare = count + renewals > 0 ? (count / (count + renewals)) * 100 : 0;
  const untracked = subs ? subs.accounts - subs.tracked : 0;
  const syncedAgo = formatAgo(subs?.oldestSyncAt);

  const rows: HelpRow[] = [
    { label: "New subscribers", value: count.toLocaleString() },
    { label: "Renewals (not counted)", value: renewals.toLocaleString() },
  ];
  for (const p of PLATFORMS) {
    const bp = subs?.byPlatform[p];
    if (bp) {
      rows.push({
        label: PLATFORM_LABEL[p],
        value: `${bp.count.toLocaleString()} new · ${bp.renewals.toLocaleString()} renewed`,
      });
    }
  }
  // OnlyFans moves a fan's subscribe date forward on renewal, so last month's
  // new subs who have since renewed drop out of last month's count. Only
  // today/week comparisons are fair enough to show.
  if (subs && period !== "month") {
    rows.push({
      label: `At the ${SAME_POINT_LABEL[period]}`,
      value: subs.prevCount.toLocaleString(),
    });
  }
  if (subs) {
    rows.push({
      label: "Accounts tracked",
      value: `${subs.tracked} of ${subs.accounts}`,
      tone: untracked > 0 ? "warning" : undefined,
    });
  }
  const content = (
    <HelpCard
      title="New subs"
      what={`${NEW_SUBS_HELP.what} Counted ${PERIOD_SPAN[period]}.`}
      rows={rows}
      source={NEW_SUBS_HELP.source}
      notes={[
        ...(syncedAgo ? [{ text: `Oldest subscriber sync: ${syncedAgo}.` }] : []),
        ...(untracked > 0
          ? [{
              text: `${untracked} account(s) have no subscriber sync yet, so their new subs aren't counted. Turning polling on keeps them tracked.`,
              tone: "warning" as const,
            }]
          : []),
        ...(!subs ? [{ text: "Not available from this server yet." }] : []),
      ]}
    />
  );

  return (
    <Tooltip content={content} placement="top" delay={300} classNames={TOOLTIP_CLASSES}>
      <div tabIndex={0} className={TILE_CLASSES}>
        <TileHeader icon={<PxUserCheck className="h-4 w-4" />} label="New subs" />
        {loading ? (
          <Skeleton className="h-6 w-14" />
        ) : (
          <p className="text-lg font-bold tracking-tight tabular-nums">
            {subs ? Math.round(animated).toLocaleString() : "—"}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-[2px] flex-1 bg-white/[0.05] overflow-hidden">
            <motion.div
              className="h-full"
              style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, newShare)}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <span className="text-[10px] text-default-400 tabular-nums whitespace-nowrap">
            {renewals > 0 ? `+${renewals.toLocaleString()} renewed` : "—"}
          </span>
        </div>
      </div>
    </Tooltip>
  );
}
