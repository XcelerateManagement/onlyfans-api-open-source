"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { useDisclosure } from "@heroui/use-disclosure";
import { PxDollarSign, PxBanknote, PxTrendingUp } from "@/components/ui/PixelIcons";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import { useSSE } from "@/lib/hooks/use-sse";
import { useTour } from "@/lib/tour-context";
import {
  TOUR_ACCOUNTS,
  TOUR_EARNINGS_DETAIL,
  TOUR_PAYOUT_HISTORY,
  TOUR_PAYOUT_STATUS,
} from "@/lib/tour-fake-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import { StatCard } from "@/components/dashboard/StatCard";
import { GlassCard } from "@/components/dashboard/GlassCard";
import toast from "react-hot-toast";

export default function EarningsPage() {
  const api = useApiClient();
  const { selectedAccount: realSelectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const selectedAccount = isTourActive
    ? (realSelectedAccount ?? TOUR_ACCOUNTS[0])
    : realSelectedAccount;
  const connectionState = selectedAccount?.connection_state;
  const connectionHealthy = !connectionState || connectionState === "connected";

  // Payout READS (methods + balance + history) are capability-gated separately
  // from withdrawal REQUESTS: Fansly serves the read side (payout methods +
  // wallet balance + ledger-derived history) but the backend never POSTs a
  // withdrawal to Fansly, so the request form gates on payouts_request.
  const payoutsOk = accountSupports(selectedAccount, "payouts");
  const payoutRequestOk = accountSupports(selectedAccount, "payouts_request");
  // Presentation: Fansly has no gross-vs-net split — the wallet balance IS the
  // figure, so show a single Wallet Balance tile instead of Gross==Net pair.
  const isFansly = selectedAccount?.platform === "fansly";

  // Default to last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [startDate, setStartDate] = useState(
    thirtyDaysAgo.toISOString().slice(0, 10)
  );
  const [endDate, setEndDate] = useState(now.toISOString().slice(0, 10));

  const [earnings, setEarnings] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payoutHistory, setPayoutHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // The history call used to swallow into `{ requests: [] }`, so a failure was
  // rendered as "No withdrawals yet" — a claim about the operator's money.
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [payoutAccount, setPayoutAccount] = useState<any>(null);
  const [payoutStatus, setPayoutStatus] = useState<{
    can_withdraw: boolean;
    blockers: string[];
    check_receive: any;
    balances: any;
    account: any;
  } | null>(null);

  // Payout modal
  const { isOpen: isPayoutOpen, onOpen: onPayoutOpen, onClose: onPayoutClose } = useDisclosure();
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [payoutError, setPayoutError] = useState("");
  const [payoutSuccess, setPayoutSuccess] = useState("");

  const fetchEarnings = async () => {
    if (isTourActive) {
      setEarnings(TOUR_EARNINGS_DETAIL);
      setLoading(false);
      setError("");
      return;
    }
    if (!api || !selectedAccount || !connectionHealthy) return;
    if (new Date(startDate) > new Date(endDate)) {
      toast.error("Start date must be before end date");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const data = await api.getEarnings(
        selectedAccount.of_user_id,
        `${startDate} 00:00:00`,
        `${endDate} 23:59:59`
      );
      setEarnings(data.earnings);
    } catch (err: any) {
      const msg = err?.message || "Failed to load earnings";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchPayoutHistory = async () => {
    if (isTourActive) {
      setPayoutHistory(TOUR_PAYOUT_HISTORY);
      setPayoutStatus(TOUR_PAYOUT_STATUS);
      setPayoutAccount(TOUR_PAYOUT_STATUS.account);
      setHistoryLoading(false);
      return;
    }
    if (!api || !selectedAccount || !connectionHealthy) return;
    // No payout read surface on this platform — skip the fetch and clear any
    // payout state left over from a previously selected account, otherwise
    // stale blocker copy and amounts leak onto this account.
    if (!accountSupports(selectedAccount, "payouts")) {
      setPayoutHistory([]);
      setPayoutStatus(null);
      setPayoutAccount(null);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const [hist, status] = await Promise.all([
        api
          .getPayoutRequests(selectedAccount.of_user_id, { limit: 20 })
          .catch((e: any) => {
            // Keep the failure instead of laundering it into an empty list.
            setHistoryError(e);
            return { requests: [] };
          }),
        api.getPayoutAccount(selectedAccount.of_user_id).catch(() => null),
      ]);
      setPayoutHistory(hist.requests || []);
      if (status) {
        setPayoutStatus({
          can_withdraw: !!status.can_withdraw,
          blockers: status.blockers || [],
          check_receive: status.check_receive,
          balances: status.balances,
          account: status.account,
        });
        setPayoutAccount(status.account || null);
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  const blockerMessage = (code: string): string => {
    const map: Record<string, string> = {
      manual_payout_disabled: "Manual payouts are disabled for this account.",
      banking_needs_update: "Banking information needs to be updated in OnlyFans settings.",
      identity_not_verified: "Account identity is not verified.",
      account_cannot_pay: "This account is not permitted to receive payouts (check country & tax info).",
      check_receive_failed: "Could not verify payout eligibility — try again.",
    };
    return map[code] || code;
  };

  useEffect(() => {
    fetchEarnings();
    fetchPayoutHistory();
  }, [selectedAccount]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when money comes in
  const { events: liveEvents } = useSSE({
    types: ["new_tip", "new_purchase", "balance_increased"],
    bufferSize: 5,
    disabled: isTourActive || !connectionHealthy,
  });
  const lastLiveId = liveEvents[0]?.id ?? null;
  useEffect(() => {
    if (lastLiveId && selectedAccount) fetchEarnings();
  }, [lastLiveId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePayout = async () => {
    if (!api || !selectedAccount || !payoutAmount) return;
    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    const available = earnings?.total?.total || 0;
    if (amount > available) {
      toast.error(`Amount exceeds available balance ($${typeof available === 'number' ? available.toFixed(2) : '0'})`);
      return;
    }
    if (payoutStatus && !payoutStatus.can_withdraw) {
      const reason = payoutStatus.blockers.map(blockerMessage).join(" ");
      toast.error(reason || "Withdrawals are not available for this account.");
      return;
    }
    const minAmt = payoutStatus?.balances?.minPayoutSumm;
    const maxAmt = payoutStatus?.balances?.maxPayoutSumm ?? payoutStatus?.balances?.payoutAvailable;
    if (minAmt != null && amount < Number(minAmt)) {
      toast.error(`Minimum payout is $${minAmt}.`);
      return;
    }
    if (maxAmt != null && amount > Number(maxAmt)) {
      toast.error(`Maximum payout is $${maxAmt} (available balance).`);
      return;
    }
    setPayoutLoading(true);
    setPayoutError("");
    setPayoutSuccess("");
    try {
      await api.createPayoutRequest(
        selectedAccount.of_user_id,
        parseFloat(payoutAmount)
      );
      setPayoutSuccess("Payout request created successfully!");
      toast.success("Payout request created!");
      setPayoutAmount("");
      fetchPayoutHistory();
    } catch (err: any) {
      // WRITES_DISABLED is handled globally (WritesDisabledWatcher) — skip the
      // redundant inline + toast error.
      if (err?.data?.code === "WRITES_DISABLED") return;
      const msg = err?.message || "Failed to create payout request";
      setPayoutError(msg);
      toast.error(msg);
    } finally {
      setPayoutLoading(false);
    }
  };

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxDollarSign className="h-8 w-8" />}
        title="No account selected"
        description="Select an account from the header dropdown to view earnings."
        pattern="waves"
      />
    );
  }

  if (!connectionHealthy) {
    return (
      <EmptyState
        icon={<PxDollarSign className="h-8 w-8" />}
        title={connectionState === "login_failed" ? "Login failed" : "Earnings sync unavailable"}
        description={selectedAccount.login_failure?.message
          || selectedAccount.connection_error?.message
          || "Resolve this account on the Accounts page before requesting live earnings."}
        pattern="waves"
      />
    );
  }

  // Helper: OF API returns some values as {count, date} objects
  const num = (v: any): number =>
    typeof v === "object" && v !== null ? v.count ?? 0 : v ?? 0;

  // Parse chart data from API response
  const chartData =
    earnings?.total?.chartAmount?.map((item: any, i: number) => {
      const amount = typeof item === "object" ? item.count : num(item);
      const dateStr = typeof item === "object" && item.date
        ? new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : `${i + 1}`;
      return {
        day: dateStr,
        amount: typeof amount === "number" ? amount : num(amount),
        count: num(earnings?.total?.chartCount?.[i]),
      };
    }) || [];

  const totalEarnings = num(earnings?.total?.total);
  const grossEarnings = num(earnings?.total?.gross);

  // Fansly earnings responses set series_available:false (wallet balance only,
  // no time-series) — show an explicit empty-state instead of silently hiding
  // the chart. Once the backend fansly series lands, this only shows while the
  // cache is empty. Absent flag (OF) → series assumed available.
  const seriesAvailable = earnings?.series_available !== false;

  // When a per-day series is available the `total` figures are real range
  // earnings (net/gross) for both platforms — show the Net/Gross pair. Only
  // when Fansly serves no series (total collapses to the current wallet
  // balance) do we fall back to a single "Wallet Balance" tile.
  const showNetGross = !isFansly || seriesAvailable;
  const money2 = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h2 className="heading-2">Earnings</h2>
        <p className="text-sm text-default-500 mt-1">
          Revenue data for {selectedAccount.username || selectedAccount.email}
        </p>
      </motion.div>

      {/* Date range controls */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex flex-wrap items-end gap-3"
      >
        {/* Date range only means something when a time-series exists — hide it
            when the loaded response says series_available:false. */}
        {seriesAvailable && (
          <>
            <Input
              type="date"
              label="Start Date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              variant="bordered"
              className="w-44"
              classNames={{
                inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
              }}
            />
            <Input
              type="date"
              label="End Date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              variant="bordered"
              className="w-44"
              classNames={{
                inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
              }}
            />
          </>
        )}
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button
            className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold"
            onPress={fetchEarnings}
            isLoading={loading}
          >
            <PxTrendingUp className="h-4 w-4 mr-2" />
            Fetch
          </Button>
        </motion.div>
        {/* Withdrawal requests are a write — gated on payouts_request (false on
            Fansly: the backend never POSTs a withdrawal there). */}
        {payoutRequestOk && (
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} data-tour="earnings-payout">
            <Button
              variant="bordered"
              startContent={<PxBanknote className="h-4 w-4" />}
              onPress={onPayoutOpen}
              className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
            >
              Request Payout
            </Button>
          </motion.div>
        )}
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="dashboard-error"
        >
          {error}
        </motion.div>
      )}

      {/* Summary. With a per-day series both platforms report real range
          earnings, so show the Net/Gross pair. Only a Fansly account with no
          series (total = current wallet balance) gets the single Wallet Balance
          tile. */}
      {earnings && (
        <div className={`grid grid-cols-1 gap-4 ${showNetGross ? "sm:grid-cols-2" : ""}`}>
          <StatCard
            label={showNetGross ? "Net Earnings" : "Wallet Balance"}
            value={money2(totalEarnings)}
            icon={<PxDollarSign className="h-6 w-6" />}
            pattern="crosshatch"
          />
          {showNetGross && (
            <StatCard
              label="Gross Earnings"
              value={money2(grossEarnings)}
              icon={<PxDollarSign className="h-6 w-6" />}
              pattern="triangles"
            />
          )}
        </div>
      )}

      {/* Chart — or an explicit note when the platform serves no time-series */}
      {earnings && !seriesAvailable ? (
        <EmptyState
          icon={<PxTrendingUp className="h-8 w-8" />}
          title="No earnings chart yet"
          description="No earnings time-series available for this account yet — see Purchases for the full ledger."
          pattern="diagonalStripes"
        />
      ) : chartData.length > 0 && (
        <GlassCard delay={0.2} pattern="diagonalStripes">
          <div className="px-5 py-4 pb-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 border border-white/[0.08]" style={{ backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)" }}>
                <PxTrendingUp className="h-4 w-4 text-accent" />
              </div>
              <h3 className="text-lg font-semibold">Earnings Over Time</h3>
            </div>
          </div>
          <div className="p-5" data-tour="earnings-chart">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient
                      id="earningsGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--theme-accent, #f54900)"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--theme-accent, #f54900)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.04)"
                  />
                  <XAxis dataKey="day" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0d0d0d",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 0,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="var(--theme-accent, #f54900)"
                    strokeWidth={2}
                    fill="url(#earningsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Payout Account Setup Warning — OF-only; gate so stale OF blocker copy
          can never render on a platform without payouts. */}
      {payoutsOk && payoutStatus && !payoutStatus.can_withdraw && payoutStatus.blockers.length > 0 && (
        <GlassCard delay={0.25} pattern="dots">
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 border border-yellow-500/30 bg-yellow-500/10">
                <PxDollarSign className="h-4 w-4 text-yellow-400" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-yellow-400">Withdrawals not available</h4>
                <ul className="text-xs text-default-400 mt-1 space-y-0.5 list-disc list-inside">
                  {payoutStatus.blockers.map((b) => (
                    <li key={b}>{blockerMessage(b)}</li>
                  ))}
                </ul>
                {payoutStatus.balances?.minPayoutSumm != null && (
                  <p className="text-xs text-default-500 mt-2">
                    Minimum payout: ${payoutStatus.balances.minPayoutSumm} · Available: ${payoutStatus.balances.payoutAvailable ?? 0}
                  </p>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Withdrawal History — OF-only payout flow */}
      {payoutsOk && (
      <GlassCard delay={0.3} pattern="grid">
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 border border-white/[0.08]" style={{ backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)" }}>
              <PxBanknote className="h-4 w-4 text-accent" />
            </div>
            <h3 className="text-lg font-semibold">
              {payoutRequestOk ? "Withdrawal History" : "Payout History"}
            </h3>
          </div>
          <Button
            size="sm"
            variant="bordered"
            onPress={fetchPayoutHistory}
            isLoading={historyLoading}
            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] text-xs"
          >
            Refresh
          </Button>
        </div>
        <div className="p-5 pt-0">
          <DataState
            compact
            loading={historyLoading}
            error={historyError}
            isEmpty={payoutHistory.length === 0}
            onRetry={fetchPayoutHistory}
            noun="payout history"
            skeleton={
              <div className="text-sm text-default-400 py-4 text-center">Loading history...</div>
            }
            emptyContent={
              <div className="text-sm text-default-400 py-6 text-center">
                {payoutRequestOk
                  ? 'No withdrawals yet. Click "Request Payout" to withdraw your available balance.'
                  : `No payouts recorded yet. ${platformLabel(selectedAccount.platform)} payouts appear here once they land in the synced wallet ledger.`}
              </div>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-default-500 border-b border-white/[0.06] pb-2">
                <div className="col-span-3">Date</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-2 text-right">Fee</div>
                <div className="col-span-2 text-right">Net</div>
                <div className="col-span-3">Status</div>
              </div>
              {payoutHistory.map((req: any, i: number) => {
                const amount = Number(req.amount ?? req.withdrawalAmount ?? 0);
                const fee = Number(req.fee ?? 0);
                const net = Number(req.amountPaid ?? req.netAmount ?? (amount - fee));
                const status = String(req.status ?? req.state ?? "unknown");
                const date = req.createdAt || req.date;
                const statusColor = status === "completed" || status === "paid" ? "text-green-400" :
                                    status === "pending" || status === "processing" ? "text-yellow-400" :
                                    status === "failed" || status === "cancelled" ? "text-red-400" :
                                    "text-default-400";
                return (
                  <div key={req.id || i} className="grid grid-cols-12 gap-2 text-sm py-2 border-b border-white/[0.02]">
                    <div className="col-span-3 text-default-400">
                      {date ? new Date(date).toLocaleDateString() : "—"}
                    </div>
                    <div className="col-span-2 text-right font-medium">${amount.toFixed(2)}</div>
                    <div className="col-span-2 text-right text-default-500">${fee.toFixed(2)}</div>
                    <div className="col-span-2 text-right text-green-400">${net.toFixed(2)}</div>
                    <div className={`col-span-3 capitalize ${statusColor}`}>{status}</div>
                  </div>
                );
              })}
            </div>
          </DataState>
        </div>
      </GlassCard>
      )}

      {/* Payout Modal */}
      <Modal isOpen={isPayoutOpen} onClose={onPayoutClose} placement="center">
        <ModalContent>
          <ModalHeader>Request Payout</ModalHeader>
          <ModalBody>
            {payoutError && (
              <div className="dashboard-error">
                {payoutError}
              </div>
            )}
            {payoutSuccess && (
              <div className="dashboard-success">
                {payoutSuccess}
              </div>
            )}
            <Input
              label="Withdrawal Amount ($)"
              type="number"
              value={payoutAmount}
              onValueChange={setPayoutAmount}
              startContent={<PxDollarSign className="h-4 w-4 text-default-400" />}
              placeholder="100.00"
              variant="bordered"
              isRequired
              min={0}
              step={0.01}
              classNames={{
                inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onPayoutClose}>
              Cancel
            </Button>
            <Button
              className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold"
              isLoading={payoutLoading}
              onPress={handlePayout}
            >
              Submit Request
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
