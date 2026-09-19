"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";

import {
  PxUsers,
  PxDollarSign,
  PxActivity,
  PxZap,
  PxSettings,
} from "@/components/ui/PixelIcons";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE, type LiveEvent } from "@/lib/hooks/use-sse";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { platformLabel } from "@/lib/platform-capabilities";
import { parseUtc } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

function formatDollars(n: number | undefined | null, digits = 2): string {
  return (Number(n) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
  });
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatRelative(iso: string | null | undefined): string {
  const d = parseUtc(iso);
  if (!d) return "never";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

export default function AccountDetailPage() {
  const params = useParams<{ of_user_id: string }>();
  const router = useRouter();
  const api = useApiClient();
  const { accounts, loading: accountsLoading } = useAccounts();
  const ofUserId = params?.of_user_id as string;

  const account = useMemo(
    () => accounts.find((a) => a.of_user_id === ofUserId),
    [accounts, ofUserId]
  );
  const connectionState = account?.connection_state;
  const connectionHealthy = !connectionState || connectionState === "connected";

  const [polling, setPolling] = useState<any>(null);
  const [balance, setBalance] = useState(0);
  const [subCount, setSubCount] = useState<number | null>(null);
  const [chartData, setChartData] = useState<number[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  // Fansly's normalized earnings body carries series_available:false and its
  // "total" is really the wallet balance — track it so we never label that
  // balance as period earnings. OF bodies omit the key (=> series available).
  const [seriesAvailable, setSeriesAvailable] = useState(true);
  const [topFans, setTopFans] = useState<any[]>([]);
  const [recentEvents, setRecentEvents] = useState<any[]>([]);
  const [automationsCount, setAutomationsCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const { events: live, connected } = useSSE({
    types: [
      "new_tip",
      "new_subscriber",
      "renewed_subscriber",
      "expired_subscriber",
      "new_message",
      "new_purchase",
      "balance_increased",
      "polling_paused",
    ],
    bufferSize: 20,
    disabled: !connectionHealthy,
  });
  const scopedLive = useMemo(
    () => live.filter((e) => String(e.of_user_id) === String(ofUserId)),
    [live, ofUserId]
  );
  const lastScopedId = scopedLive[0]?.id ?? null;

  useEffect(() => {
    if (!api || !account || !connectionHealthy) return;
    let cancelled = false;
    const now = new Date();
    const thirty = new Date(now.getTime() - 30 * 86400000);
    thirty.setHours(0, 0, 0, 0);

    async function load() {
      setLoading(true);
      try {
        // Fansly blocks the OF-style subscribers/count passthrough and uses
        // different balance/earnings field names. Skip the OF-only count call
        // for Fansly (the count rides along on the normalized balances body).
        const isFansly = account!.platform === "fansly";

        const [pollRes, balRes, subsRes, earningsRes, fansRes, eventsRes, autoRes] =
          await Promise.all([
            api!.getAccountPolling(ofUserId).catch(() => null),
            api!.getBalances(ofUserId).catch(() => null),
            isFansly
              ? Promise.resolve(null)
              : api!
                  .makeRequest(
                    ofUserId,
                    "/api2/v2/subscriptions/subscribers/count",
                    "GET"
                  )
                  .catch(() => null),
            api!
              .getEarnings(
                ofUserId,
                formatDateTime(thirty),
                formatDateTime(now)
              )
              .catch(() => null),
            api!.listFans({ of_user_id: ofUserId, sort: "tips", limit: 5 }).catch(() => ({ fans: [] })),
            api!.listEvents({ of_user_id: ofUserId, limit: 30 }).catch(() => ({ events: [] })),
            api!.listAutomations().catch(() => ({ automations: [] })),
          ]);

        if (cancelled) return;

        setPolling(pollRes?.polling ?? null);
        // "Available" = withdrawable now. Both platforms' bodies carry it as
        // payoutAvailable (Fansly's currentBalance also includes money on hold).
        const bals = (balRes as any)?.balances;
        setBalance(Number(bals?.payoutAvailable) || 0);
        const sc = isFansly
          ? bals?.subscriberCount ?? null
          : (subsRes as any)?.data?.subscribersCount ??
            (subsRes as any)?.data?.count ??
            null;
        setSubCount(sc != null ? Number(sc) : null);

        const e = (earningsRes as any)?.earnings;
        // OF earnings total is total.total; Fansly's normalized total is total.amount.
        const t = Number(isFansly ? e?.total?.amount : e?.total?.total) || 0;
        setTotalEarnings(t);
        // Only an explicit false means "no per-day series" (Fansly today).
        // Once the backend fansly series lands with series_available:true, the
        // normal chart path below renders it with no further page change.
        setSeriesAvailable(e?.series_available !== false);
        const byDay = new Map<string, number>();
        // The earnings body exposes the per-day series as chartAmount
        // ([{date, count}]) under both `total` and the top level — not `chart`.
        for (const pt of e?.total?.chartAmount || e?.chartAmount || e?.chart || []) {
          const day = String(pt.date || pt.x || "").slice(0, 10);
          if (!day) continue;
          byDay.set(day, (byDay.get(day) || 0) + (Number(pt.count ?? pt.y ?? pt.amount) || 0));
        }
        setChartData(Array.from(byDay.keys()).sort().map((k) => byDay.get(k)!));

        setTopFans((fansRes as any)?.fans || []);
        setRecentEvents((eventsRes as any)?.events || []);
        const autos = (autoRes as any)?.automations || [];
        setAutomationsCount(
          autos.filter(
            (a: any) =>
              a.is_active &&
              (!a.of_user_id || String(a.of_user_id) === String(ofUserId))
          ).length
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, account, connectionHealthy, ofUserId, lastScopedId]);

  const mergedRecent = useMemo(() => {
    const seen = new Set<string>();
    const out: LiveEvent[] = [];
    const push = (e: any) => {
      const k = String(e.id ?? `${e.event_type}:${e.source_event_id}`);
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    };
    scopedLive.forEach(push);
    recentEvents.forEach(push);
    return out.slice(0, 20);
  }, [scopedLive, recentEvents]);

  const eventsLast24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return recentEvents.filter((e) => {
      const ts = e.occurred_at || e.created_at;
      return ts && new Date(ts).getTime() >= cutoff;
    }).length;
  }, [recentEvents]);

  // Wait until the account list has actually loaded before deciding
  if (accountsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <PixelSpinner />
      </div>
    );
  }

  if (!account) {
    return (
      <EmptyState
        icon={<PxUsers className="h-8 w-8" />}
        title="Account not found"
        description="This account doesn't belong to your CRM panel."
        actionLabel="Back to accounts"
        onAction={() => router.push("/dashboard/accounts")}
      />
    );
  }

  if (!connectionHealthy) {
    return (
      <EmptyState
        icon={<PxUsers className="h-8 w-8" />}
        title={connectionState === "login_failed" ? "Login failed" : "Account sync unavailable"}
        description={account.login_failure?.message
          || account.connection_error?.message
          || "Resolve this account before requesting live balances, earnings, subscribers, or messages."}
        actionLabel="Back to accounts"
        onAction={() => router.push("/dashboard/accounts")}
      />
    );
  }

  if (loading && subCount === null && totalEarnings === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <PixelSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/dashboard/accounts"
          className="text-xs text-default-400 hover:text-foreground inline-flex items-center gap-1"
        >
          ← Accounts
        </Link>
      </div>

      {/* Header card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="relative bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none overflow-hidden">
          <CornerBrackets size={10} />
          <CardBody className="p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0">
                <FanAvatar
                  username={account.username}
                  displayName={account.username || account.email}
                  avatar={account.avatar}
                  size={56}
                />
                <div className="min-w-0">
                  <h2 className="text-xl font-bold truncate">
                    {account.username || "—"}
                  </h2>
                  <p className="text-xs text-default-400 truncate">
                    {account.email}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Chip
                      size="sm"
                      variant="flat"
                      className="rounded-none bg-white/[0.04] text-default-400"
                    >
                      {platformLabel(account.platform)}
                    </Chip>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={polling?.polling_enabled ? "success" : "default"}
                    >
                      ● {polling?.polling_enabled ? "Polling on" : "Polling off"}
                    </Chip>
                    {polling?.polling_enabled && (
                      <span className="text-xs text-default-500">
                        every {polling.polling_interval_seconds}s · last{" "}
                        {formatRelative(polling.last_polled_at)}
                      </span>
                    )}
                    {connected && (
                      <span className="text-xs text-success-500">● Live</span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="bordered"
                size="sm"
                startContent={<PxSettings className="h-4 w-4" />}
                onPress={() => router.push("/dashboard/accounts")}
                className="bg-transparent border border-white/[0.08] rounded-none"
              >
                Manage
              </Button>
            </div>
          </CardBody>
        </Card>
      </motion.div>

      {/* KPI tiles */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
        }}
      >
        <KpiTile
          label="Subscribers"
          value={subCount ?? 0}
          icon={<PxUsers className="h-4 w-4" />}
        />
        <KpiTile
          label="Available"
          value={balance}
          icon={<PxDollarSign className="h-4 w-4" />}
          format={(n) => formatDollars(n)}
        />
        <KpiTile
          label="Events 24h"
          value={eventsLast24h}
          icon={<PxActivity className="h-4 w-4" />}
        />
        <KpiTile
          label="Automations"
          value={automationsCount}
          icon={<PxZap className="h-4 w-4" />}
        />
      </motion.div>

      {/* Earnings + top fans */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="lg:col-span-2"
        >
          <Card className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none h-full">
            <CardBody className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold">
                  {seriesAvailable
                    ? "Earnings — last 30 days"
                    : `Available balance — ${platformLabel(account.platform)} period series not synced yet`}
                </p>
                <Link
                  href="/dashboard/earnings"
                  className="text-xs text-default-400 hover:text-foreground"
                >
                  Details →
                </Link>
              </div>
              <p className="text-3xl font-bold tabular-nums mb-3" style={{ color: "var(--theme-accent, #f54900)" }}>
                {formatDollars(totalEarnings)}
              </p>
              {chartData.length > 0 ? (
                <div className="w-full">
                  <Sparkline data={chartData} width="100%" height={60} />
                </div>
              ) : seriesAvailable ? (
                <p className="text-xs text-default-400">
                  {totalEarnings > 0
                    ? "Per-day breakdown unavailable for this range."
                    : "No earnings data yet for this period."}
                </p>
              ) : (
                <p className="text-xs text-default-400">
                  {platformLabel(account.platform)} doesn&apos;t provide a
                  per-day earnings series yet — the amount above is your
                  current wallet balance, not this period&apos;s earnings.
                </p>
              )}
            </CardBody>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.15 }}
        >
          <Card className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none h-full">
            <CardBody className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold">
                  Top fans
                </p>
                <Link
                  href="/dashboard/fans"
                  className="text-xs text-default-400 hover:text-foreground"
                >
                  All →
                </Link>
              </div>
              {(() => {
                const tippers = topFans.filter((f) => Number(f.total_tips) > 0);
                if (tippers.length === 0) {
                  return (
                    <p className="text-xs text-default-400">
                      No tipping fans yet — they&apos;ll appear here as tips come in.
                    </p>
                  );
                }
                return (
                  <div className="space-y-2">
                    {tippers.map((f, i) => (
                      <div key={f.id} className="flex items-center gap-2 text-sm">
                        <span className="text-default-500 text-xs w-4">
                          {i + 1}
                        </span>
                        <FanAvatar
                          username={f.username}
                          displayName={f.display_name}
                          avatar={f.avatar}
                          size={22}
                        />
                        <span className="flex-1 truncate">
                          @{f.username || f.fan_of_user_id}
                        </span>
                        <span
                          className="tabular-nums text-xs font-semibold"
                          style={{ color: "var(--theme-accent, #f54900)" }}
                        >
                          {formatDollars(f.total_tips, 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </CardBody>
          </Card>
        </motion.div>
      </div>

      {/* Recent activity */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <Card className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none">
          <CardBody className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold">
                Recent activity
              </p>
              <Link
                href="/dashboard/activity"
                className="text-xs text-default-400 hover:text-foreground"
              >
                All events →
              </Link>
            </div>
            {mergedRecent.length === 0 ? (
              <p className="text-xs text-default-400">No events yet.</p>
            ) : (
              <div className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {mergedRecent.map((e: any) => (
                    <motion.div
                      key={String(e.id ?? `${e.event_type}:${e.source_event_id}`)}
                      layout
                      initial={{ opacity: 0, y: -3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 text-xs"
                    >
                      <Chip size="sm" variant="flat">
                        {e.event_type.replace(/_/g, " ")}
                      </Chip>
                      <span className="flex-1 truncate">
                        {e.payload?.fan?.username ||
                          e.payload?.fan?.display_name ||
                          "—"}{" "}
                        {e.payload?.text && (
                          <span className="text-default-500">
                            · {e.payload.text}
                          </span>
                        )}
                      </span>
                      {e.payload?.amount ? (
                        <span className="tabular-nums font-semibold" style={{ color: "var(--theme-accent, #f54900)" }}>
                          {formatDollars(Number(e.payload.amount))}
                        </span>
                      ) : null}
                      <span className="text-default-400 whitespace-nowrap">
                        {formatRelative(e.occurred_at || e.created_at)}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </CardBody>
        </Card>
      </motion.div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon,
  format,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  format?: (n: number) => string;
}) {
  const animated = useCountUp(value, 500);
  const display = format
    ? format(animated)
    : Math.round(animated).toLocaleString("en-US");
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
    >
      <div
        className={cn(
          "relative border border-white/[0.06] bg-[#0d0d0d] p-4 hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.2)] transition-colors"
        )}
      >
        <div className="flex items-center gap-2 text-default-500 mb-1">
          <span style={{ color: "var(--theme-accent, #f54900)" }}>{icon}</span>
          <p className="text-[10px] uppercase tracking-wider font-semibold">
            {label}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums">{display}</p>
      </div>
    </motion.div>
  );
}
