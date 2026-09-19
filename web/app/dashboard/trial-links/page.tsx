"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Avatar } from "@heroui/avatar";
import { Input } from "@heroui/input";
import {
  PxLink,
  PxRefresh,
  PxCheck,
  PxSearch,
  PxMegaphone,
} from "@/components/ui/PixelIcons";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts, type OfAccount } from "@/lib/hooks/use-selected-account";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS } from "@/lib/tour-fake-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { GlassCard } from "@/components/dashboard/GlassCard";
import PlatformBadge from "@/components/dashboard/PlatformBadge";
import { accountSupports } from "@/lib/platform-capabilities";
import { cn } from "@/lib/utils";

// Limit how many /users/me lookups run at once. Each is a real OnlyFans call
// counting against the monthly quota, so we fan out gently rather than firing
// one per account simultaneously.
const CONCURRENCY = 4;

type Eligibility = {
  status: "pending" | "loading" | "done" | "error";
  price?: number;
  isFree?: boolean;
  error?: string;
};

function money(n?: number | null): string {
  const v = Number(n ?? 0);
  if (!isFinite(v) || v <= 0) return "Free";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`;
}

export default function TrialLinksPage() {
  const api = useApiClient();
  const router = useRouter();
  const { accounts: realAccounts, setSelectedAccount, loading } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const accounts = isTourActive ? (TOUR_ACCOUNTS as unknown as OfAccount[]) : realAccounts;

  // Trial links are CREATED campaign links — an OnlyFans-only write, so the
  // roster gates on campaigns_create (false on Fansly, whose tracking links
  // are read-only) plus the subscription-price read the eligibility check
  // needs. This filter is both the render gate and the fetch guard: checkAll()
  // only walks this list, so no request can fire for an unsupported account.
  // accountSupports() prefers the backend-emitted capabilities on each row.
  const ofAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          accountSupports(a, "campaigns_create") &&
          accountSupports(a, "subscription_price")
      ),
    [accounts]
  );

  const [eligibility, setEligibility] = useState<Record<string, Eligibility>>({});
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState(false);

  // Guard against state updates after the component unmounts mid-scan.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const checkAll = useCallback(async () => {
    if (!api || ofAccounts.length === 0) return;

    // Tour mode: fabricate a deterministic split so the page is populated
    // without burning real OF calls.
    if (isTourActive) {
      const fake: Record<string, Eligibility> = {};
      ofAccounts.forEach((a, i) => {
        const price = i % 3 === 0 ? 0 : 9.99 + i;
        fake[a.of_user_id] = { status: "done", price, isFree: price <= 0 };
      });
      setEligibility(fake);
      return;
    }

    setChecking(true);
    // Seed everything as pending so the table shows progress immediately.
    setEligibility(() => {
      const seed: Record<string, Eligibility> = {};
      for (const a of ofAccounts) seed[a.of_user_id] = { status: "pending" };
      return seed;
    });

    const queue = [...ofAccounts];

    const worker = async () => {
      while (queue.length > 0) {
        const account = queue.shift();
        if (!account) break;
        const uid = account.of_user_id;
        if (aliveRef.current) {
          setEligibility((prev) => ({ ...prev, [uid]: { status: "loading" } }));
        }
        try {
          const res = await api.getSubscriptionPrice(uid);
          if (!aliveRef.current) return;
          setEligibility((prev) => ({
            ...prev,
            [uid]: {
              status: "done",
              price: res.subscribePrice,
              isFree: res.isFree,
            },
          }));
        } catch (err: any) {
          if (!aliveRef.current) return;
          setEligibility((prev) => ({
            ...prev,
            [uid]: { status: "error", error: err?.message || "Lookup failed" },
          }));
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker())
    );
    if (aliveRef.current) setChecking(false);
  }, [api, ofAccounts, isTourActive]);

  // Kick off a scan once accounts are loaded. Re-runs if the set of accounts
  // changes (e.g. one is connected/disconnected in another tab).
  const accountKey = ofAccounts.map((a) => a.of_user_id).join(",");
  useEffect(() => {
    checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? ofAccounts.filter(
          (a) =>
            (a.username || "").toLowerCase().includes(q) ||
            (a.email || "").toLowerCase().includes(q)
        )
      : ofAccounts;
    // Sort: available first, then pending/loading, then free, then errors.
    const rank = (uid: string) => {
      const e = eligibility[uid];
      if (e?.status === "done") return e.isFree ? 2 : 0;
      if (e?.status === "error") return 3;
      return 1; // pending / loading
    };
    return [...filtered].sort((a, b) => rank(a.of_user_id) - rank(b.of_user_id));
  }, [ofAccounts, eligibility, search]);

  const stats = useMemo(() => {
    let available = 0;
    let free = 0;
    let pending = 0;
    let errored = 0;
    for (const a of ofAccounts) {
      const e = eligibility[a.of_user_id];
      if (!e || e.status === "pending" || e.status === "loading") pending++;
      else if (e.status === "error") errored++;
      else if (e.isFree) free++;
      else available++;
    }
    return { available, free, pending, errored };
  }, [ofAccounts, eligibility]);

  const openCampaigns = (account: OfAccount) => {
    setSelectedAccount(account);
    router.push("/dashboard/campaigns");
  };

  if (loading && !isTourActive) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <PixelSpinner />
          <p className="text-sm text-muted-foreground">Loading accounts...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2">Trial Links</h2>
          <p className="text-sm text-default-500 mt-1">
            Free-trial links are an OnlyFans paid-account feature. This shows which
            connected models can offer them — any account with a subscription price
            above&nbsp;$0.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="bordered"
            isDisabled={checking || ofAccounts.length === 0}
            isLoading={checking}
            startContent={!checking ? <PxRefresh className="h-3 w-3" /> : undefined}
            onPress={checkAll}
            title="Re-check every account's subscription price live from OnlyFans (uses one API call per account)"
            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
          >
            Re-check
          </Button>
        </div>
      </div>

      {ofAccounts.length === 0 ? (
        <EmptyState
          icon={<PxLink className="h-8 w-8" />}
          title="No OnlyFans accounts"
          description="Connect an OnlyFans account to see which models can offer free-trial links."
          actionLabel="Go to Accounts"
          onAction={() => router.push("/dashboard/accounts")}
          pattern="circuit"
        />
      ) : (
        <>
          {/* Summary chips */}
          <div className="flex flex-wrap items-center gap-2">
            <Chip
              variant="flat"
              className="bg-green-500/10 text-green-400 rounded-none"
              startContent={<PxCheck className="h-3 w-3 ml-1" />}
            >
              {stats.available} available
            </Chip>
            <Chip variant="flat" className="bg-white/[0.04] text-default-400 rounded-none">
              {stats.free} free (unavailable)
            </Chip>
            {stats.pending > 0 && (
              <Chip variant="flat" className="bg-amber-500/10 text-amber-400 rounded-none">
                {stats.pending} checking…
              </Chip>
            )}
            {stats.errored > 0 && (
              <Chip variant="flat" className="bg-red-500/10 text-red-400 rounded-none">
                {stats.errored} failed
              </Chip>
            )}
          </div>

          {/* Search */}
          <Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search models…"
            startContent={<PxSearch className="h-4 w-4 text-default-400" />}
            variant="bordered"
            classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
          />

          <GlassCard animate={false} pattern="grid">
            <Table aria-label="Trial links availability by model" className="min-h-[200px]">
              <TableHeader>
                <TableColumn>MODEL</TableColumn>
                <TableColumn>PLATFORM</TableColumn>
                <TableColumn>SUBSCRIPTION</TableColumn>
                <TableColumn>TRIAL LINKS</TableColumn>
                <TableColumn>ACTIONS</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No models match your search.">
                {rows.map((account, index) => {
                  const e = eligibility[account.of_user_id];
                  const isLoadingRow =
                    !e || e.status === "pending" || e.status === "loading";
                  const available = e?.status === "done" && !e.isFree;
                  return (
                    <TableRow
                      key={account.of_user_id}
                      className={cn(
                        "transition-colors hover:bg-accent/5",
                        index !== rows.length - 1 && "border-b border-white/[0.04]",
                        e?.status === "done" && e.isFree && "opacity-60"
                      )}
                    >
                      <TableCell className="font-medium">
                        <div className="inline-flex items-center gap-2.5">
                          <Avatar
                            src={account.avatar || undefined}
                            name={account.username || account.email}
                            size="sm"
                            radius="full"
                            className="flex-shrink-0 w-7 h-7 text-tiny"
                          />
                          <span>{account.username || account.email || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <PlatformBadge platform={account.platform} />
                      </TableCell>
                      <TableCell>
                        {isLoadingRow ? (
                          <span className="text-default-400 text-xs">checking…</span>
                        ) : e.status === "error" ? (
                          <span className="text-default-400">—</span>
                        ) : (
                          <span className={available ? "font-semibold" : "text-default-400"}>
                            {money(e.price)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isLoadingRow ? (
                          <Chip
                            size="sm"
                            variant="flat"
                            className="bg-amber-500/10 text-amber-400 rounded-none"
                          >
                            Checking
                          </Chip>
                        ) : e.status === "error" ? (
                          <Chip
                            size="sm"
                            variant="flat"
                            className="bg-red-500/10 text-red-400 rounded-none"
                            title={e.error}
                          >
                            Lookup failed
                          </Chip>
                        ) : available ? (
                          <Chip
                            size="sm"
                            variant="flat"
                            className="bg-green-500/10 text-green-400 rounded-none"
                          >
                            Available
                          </Chip>
                        ) : (
                          <Chip
                            size="sm"
                            variant="flat"
                            className="bg-white/[0.04] text-default-400 rounded-none"
                          >
                            Free account
                          </Chip>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="bordered"
                          isDisabled={!available}
                          startContent={<PxMegaphone className="h-3 w-3" />}
                          onPress={() => openCampaigns(account)}
                          title={
                            available
                              ? "Open this model's campaigns"
                              : "Free accounts can't offer free-trial links"
                          }
                          className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                        >
                          Campaigns
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </GlassCard>
        </>
      )}
    </div>
  );
}
