"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Button } from "@heroui/button";

import { PxUsers, PxPlus, PxBookOpen, PxZap, PxRefresh } from "@/components/ui/PixelIcons";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { AuthBrandLogo } from "@/components/ui/AuthBrandLogo";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useTour } from "@/lib/tour-context";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { LiveActivityCard } from "@/components/dashboard/LiveActivityCard";
import { EarningsOverview } from "@/components/dashboard/EarningsOverview";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { AccountHealthCard } from "@/components/dashboard/AccountHealthCard";
import { ApiMetricsCard } from "@/components/dashboard/ApiMetricsCard";
import { ApiKeyWidget } from "@/components/dashboard/ApiKeyWidget";

export default function DashboardOverview() {
  const { data: session } = useSession();
  const router = useRouter();
  const { accounts, loading, error, loaded, refreshAccounts } = useAccounts();
  const { isActive: isTourActive } = useTour();
  // During the tour, render the full overview content even when no real
  // accounts are connected — the components themselves swap to TOUR_DATA.
  const showContent = isTourActive || accounts.length > 0;
  // A failed /accounts fetch is NOT an empty panel. Until this distinction
  // existed, exhausting the per-minute rate limit (which ~17 dashboard
  // subpages will do on a click-through) rendered as "No accounts connected"
  // — telling the operator their accounts are gone.
  const fetchFailed = !isTourActive && !!error && !loaded;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <AuthBrandLogo compact />
          <PixelSpinner />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <p className="overline uppercase mb-2">Dashboard</p>
        <h2 className="heading-2">
          Welcome back, {session?.user?.name || "there"}
        </h2>
        <p className="text-default-500 mt-1">
          Here&apos;s an overview of your CRM panel.
        </p>
      </motion.div>

      {fetchFailed ? (
        <EmptyState
          icon={
            error?.isRateLimit ? (
              <PxZap className="h-8 w-8" />
            ) : (
              <PxRefresh className="h-8 w-8" />
            )
          }
          title={
            error?.isRateLimit
              ? "Rate limit reached"
              : "Couldn't load your accounts"
          }
          description={
            error?.isRateLimit
              ? `Too many requests to the API in the last minute, so this page has no data to show. Your accounts are fine — this is the per-minute cap on your API key.${
                  error.retryAfter ? ` Retry in ${error.retryAfter}s.` : ""
                }`
              : `${error?.message || "The API did not respond."} This is a failed request, not an empty panel.`
          }
          actionLabel="Retry"
          onAction={() => {
            void refreshAccounts();
          }}
        />
      ) : !showContent ? (
        <EmptyState
          icon={<PxUsers className="h-8 w-8" />}
          title="No accounts connected"
          description="Connect your first OnlyFans or Fansly account to start managing it from the dashboard."
          actionLabel="Add Account"
          onAction={() => router.push("/dashboard/accounts")}
        />
      ) : (
        <>
          {/* Earnings overview */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            data-tour="overview-earnings"
          >
            <EarningsOverview />
          </motion.div>

          {/* Live feed + side stats */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-start"
          >
            {/* Left column carries the two tall cards so it stays roughly level
                with the three-card right rail instead of leaving a dead gap. */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div data-tour="overview-live-activity">
                <LiveActivityCard />
              </div>
              {/* Request volume — panel-wide, three flat calls, never per-account */}
              <div data-tour="overview-api-metrics">
                <ApiMetricsCard />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div data-tour="overview-quick-stats">
                <QuickStats />
              </div>
              <div data-tour="overview-account-health">
                <AccountHealthCard />
              </div>
              <div data-tour="overview-api-key">
                <ApiKeyWidget />
              </div>
            </div>
          </motion.div>

          {/* Quick actions */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.2 }}
            className="flex flex-wrap gap-3"
          >
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                variant="bordered"
                startContent={<PxPlus className="h-4 w-4" />}
                onPress={() => router.push("/dashboard/accounts")}
                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
              >
                Add Account
              </Button>
            </motion.div>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                variant="bordered"
                startContent={<PxBookOpen className="h-4 w-4" />}
                onPress={() => router.push("/dashboard/api-docs")}
                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
              >
                View API Docs
              </Button>
            </motion.div>
          </motion.div>
        </>
      )}
    </div>
  );
}
