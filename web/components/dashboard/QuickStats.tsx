"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";

import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE } from "@/lib/hooks/use-sse";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useCountUp } from "@/lib/hooks/use-count-up";
import { useTour } from "@/lib/tour-context";
import {
  TOUR_ACCOUNTS,
  TOUR_AUTOMATIONS,
  TOUR_BALANCES,
  TOUR_POLLING_STATE,
  TOUR_WEBHOOKS,
} from "@/lib/tour-fake-data";
import { cn } from "@/lib/utils";
import {
  PxUsers,
  PxDollarSign,
  PxZap,
  PxLink,
  PxActivity,
  PxTrendingUp,
} from "@/components/ui/PixelIcons";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";

interface Row {
  key: string;
  label: string;
  value: number;
  href: string;
  icon: React.ReactNode;
  format?: (n: number) => string;
}

export function QuickStats() {
  const api = useApiClient();
  const { accounts: realAccounts } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const accounts = isTourActive ? TOUR_ACCOUNTS : realAccounts;
  const [balance, setBalance] = useState(0);
  // How many accounts actually contributed to `balance`. When this is below the
  // account count the figure is a partial sum, and the row says so instead of
  // presenting it as the panel total.
  const [balanceSampled, setBalanceSampled] = useState(0);
  const [pollingOn, setPollingOn] = useState(0);
  const [automations, setAutomations] = useState(0);
  const [webhooks, setWebhooks] = useState(0);

  const { events } = useSSE({
    types: ["balance_increased", "polling_paused"],
    bufferSize: 10,
    disabled: isTourActive,
  });
  // Debounce so a burst of events doesn't fan out to N account fetches.
  const lastEventId = useDebounced(events[0]?.id ?? null, 800);

  useEffect(() => {
    if (isTourActive) {
      const total = Object.values(TOUR_BALANCES).reduce(
        (s, b) => s + b.payoutAvailable,
        0,
      );
      const polling = Object.values(TOUR_POLLING_STATE).filter(
        (p) => p.polling_enabled,
      ).length;
      setBalance(total);
      setBalanceSampled(Object.keys(TOUR_BALANCES).length);
      setPollingOn(polling);
      setAutomations(TOUR_AUTOMATIONS.filter((a) => a.is_active).length);
      setWebhooks(TOUR_WEBHOOKS.filter((w) => w.is_active).length);
      return;
    }
    if (!api) return;
    let cancelled = false;

    // Balance and polling state ride along on the account rows the provider has
    // already fetched, so this costs nothing. It used to be a SERIAL loop doing
    // getBalances() + getAccountPolling() per account — and getBalances is a
    // live OF round-trip (~1s), so the overview took ~2 requests × N accounts
    // one after another. Past a few dozen accounts that is minutes of loading
    // and it exhausts the per-key rate limit, which the dashboard then renders
    // as an empty "no accounts connected" state.
    //
    // last_balance_available is undefined for a never-sampled account, which is
    // deliberately not the same as 0 — sum only what was actually sampled and
    // report the shortfall rather than silently understating the total.
    let total = 0;
    let sampled = 0;
    let running = 0;

    for (const acc of accounts) {
      const bal = acc.last_balance_available;

      if (typeof bal === "number") {
        total += bal;
        sampled += 1;
      }
      if (acc.polling_enabled) running += 1;
    }
    setBalance(total);
    setBalanceSampled(sampled);
    setPollingOn(running);

    async function load() {
      const [a, w] = await Promise.all([
        api!.listAutomations().catch(() => ({ automations: [] })),
        api!.listWebhooks().catch(() => ({ webhooks: [] })),
      ]);

      if (!cancelled) {
        setAutomations(
          ((a as any)?.automations || []).filter((x: any) => x.is_active).length
        );
        setWebhooks(
          ((w as any)?.webhooks || []).filter((x: any) => x.is_active).length
        );
      }
    }
    load();

    return () => {
      cancelled = true;
    };
  }, [api, accounts, lastEventId, isTourActive]);

  const rows: Row[] = [
    {
      key: "accounts",
      label: "Connected",
      value: accounts.length,
      href: "/dashboard/accounts",
      icon: <PxUsers className="h-4 w-4" />,
    },
    {
      key: "polling",
      label: "Polling on",
      value: pollingOn,
      href: "/dashboard/accounts",
      icon: <PxActivity className="h-4 w-4" />,
    },
    {
      key: "balance",
      // Say when the figure covers only part of the panel. An account is
      // unsampled until something fetches its balance once, and a bare
      // "Available" over a partial sum reads as the panel total.
      label:
        balanceSampled < accounts.length
          ? `Available (${balanceSampled}/${accounts.length})`
          : "Available",
      value: balance,
      href: "/dashboard/earnings",
      icon: <PxDollarSign className="h-4 w-4" />,
      format: (n) =>
        n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
    },
    {
      key: "automations",
      label: "Automations",
      value: automations,
      href: "/dashboard/automations",
      icon: <PxZap className="h-4 w-4" />,
    },
    {
      key: "webhooks",
      label: "Webhooks",
      value: webhooks,
      href: "/dashboard/webhooks",
      icon: <PxLink className="h-4 w-4" />,
    },
  ];

  return (
    <GlassCard delay={0.05}>
      <GlassCardHeader className="!px-4 !py-3">
        <div className="flex items-center gap-2">
          <PxTrendingUp className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Quick Stats
          </h3>
        </div>
      </GlassCardHeader>
      <GlassCardBody className="!p-0">
        <motion.div
          className="grid grid-cols-1 divide-y divide-white/[0.06]"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
        >
          {rows.map((r) => (
            <QuickStatRow key={r.key} row={r} />
          ))}
        </motion.div>
      </GlassCardBody>
    </GlassCard>
  );
}

function QuickStatRow({ row }: { row: Row }) {
  const animated = useCountUp(row.value, 500);
  const display = row.format
    ? row.format(animated)
    : Math.round(animated).toLocaleString("en-US");
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, x: 8 }, visible: { opacity: 1, x: 0 } }}
    >
      <Link
        href={row.href}
        className={cn(
          "flex items-center gap-3 px-4 py-3 transition-colors",
          "hover:bg-white/[0.02] group"
        )}
      >
        <span
          className="text-default-400 group-hover:text-foreground transition-colors"
          style={{ color: "var(--theme-accent, #f54900)" }}
        >
          {row.icon}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-default-500 flex-1">
          {row.label}
        </span>
        <span className="text-sm font-bold tabular-nums">{display}</span>
      </Link>
    </motion.div>
  );
}
