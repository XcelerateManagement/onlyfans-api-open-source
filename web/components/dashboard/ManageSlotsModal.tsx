"use client";

import { useEffect, useState } from "react";
import { Button } from "@heroui/button";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import type { SlotsState } from "@/lib/hooks/use-slots";

interface ManageSlotsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen target count. Throws on error; otherwise resolves. */
  onConfirm: (targetCount: number) => Promise<void>;
  slotsData: SlotsState | null;
  loading: boolean;
  error?: string | null;
  /** Number of OF accounts actually connected. Drives the "you already have
   *  unused slots, connect an account" hint instead of pushing the user to
   *  buy more they don't need. */
  accountsConnected?: number;
  /** Optional close-and-jump-to-add-account handler. When provided AND the
   *  user has spare slots, the modal surfaces a CTA that opens the add-
   *  account flow directly instead of asking them to change the target. */
  onConnectAccount?: () => void;
}

const TIER_THRESHOLD = 15;
const TIER_1_PRICE = 20;
const TIER_2_PRICE = 15;

/** Approximate monthly bill for a given total slot count. */
function estimateMonthly(total: number): number {
  if (total <= TIER_THRESHOLD - 1) return total * TIER_1_PRICE;
  return (TIER_THRESHOLD - 1) * TIER_1_PRICE + (total - (TIER_THRESHOLD - 1)) * TIER_2_PRICE;
}

/** Approximate prorated charge today for `addCount` new slots, given days remaining in the period. */
function estimateProratedToday(
  addCount: number,
  currentTotal: number,
  currentPeriodEnd: string | null
): number {
  if (addCount <= 0) return 0;
  if (!currentPeriodEnd) return addCount * TIER_1_PRICE;
  const remainingMs = new Date(currentPeriodEnd).getTime() - Date.now();
  const fraction = Math.max(0, Math.min(1, remainingMs / (30 * 24 * 60 * 60 * 1000)));
  // For each new slot, charge at the tier it falls into.
  let charge = 0;
  for (let i = 0; i < addCount; i++) {
    const tierPrice = (currentTotal + i + 1) > TIER_THRESHOLD - 1 ? TIER_2_PRICE : TIER_1_PRICE;
    charge += tierPrice * fraction;
  }
  return Math.round(charge * 100) / 100;
}

/**
 * ManageSlotsModal — pick an absolute target slot count.
 *
 * Replaces the +1 BuySlotModal: user enters how many slots they want IN TOTAL.
 * Cost preview computes the delta:
 *   - increase: prorated charge today + new monthly total
 *   - decrease: shows "N slots will release at next renewal"
 *
 * Calls onConfirm(targetCount) — caller posts `{ targetCount }` to
 * /api/slots/purchase which routes through setSlotCount when V2 is enabled.
 */
export function ManageSlotsModal({
  isOpen,
  onClose,
  onConfirm,
  slotsData,
  loading,
  error,
  accountsConnected,
  onConnectAccount,
}: ManageSlotsModalProps) {
  // Free plan ⇒ zero paid slots, regardless of what the dashboard's slots
  // endpoint claims. The dashboard can return hasSubscription=true with
  // a stale accountSlots from an expired old subscription, which makes
  // the modal display "5 of 5 slots, $100/mo, No change" to a user who
  // is actually on the free plan. Treat it as 0 here so the upgrade flow
  // is honest.
  const isFreeUpgrade = slotsData?.planId === "only-api-free" || (slotsData?.accountSlots ?? 0) === 0;
  const currentTotal = isFreeUpgrade ? 0 : (slotsData?.accountSlots ?? 0);
  const periodEnd = slotsData?.currentPeriodEnd ?? null;
  // On free plan, default the picker to 1 (buy your first slot).
  // On paid plan, default to current so the picker starts at "no change".
  const defaultTarget = isFreeUpgrade ? 1 : Math.max(1, currentTotal);
  const [target, setTarget] = useState<number>(defaultTarget);

  // Reset to default whenever the modal re-opens.
  useEffect(() => {
    if (isOpen) setTarget(defaultTarget);
  }, [isOpen, defaultTarget]);

  const delta = target - currentTotal;
  const newMonthly = estimateMonthly(target);
  const proratedToday = delta > 0 ? estimateProratedToday(delta, currentTotal, periodEnd) : 0;
  const crossesTier = currentTotal < TIER_THRESHOLD && target >= TIER_THRESHOLD;

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center" size="md">
      <ModalContent>
        <ModalHeader>
          {isFreeUpgrade ? "Upgrade your plan" : "Manage slots"}
        </ModalHeader>
        <ModalBody className="space-y-4">
          {error && <div className="dashboard-error">{error}</div>}

          {/* ── Free → Starter upgrade flow ─────────────────────────
              Minimal UX: no stepper, no math, no preview rows.
              Subscribing to Starter IS the first paid slot — same $20/mo
              Stripe subscription that lifts the 1000-call cap AND keeps
              the 1 account. To add a SECOND account, the user
              comes back here after subscribing and buys another slot. */}
          {isFreeUpgrade ? (
            <>
              <div className="rounded-none border border-[color:var(--theme-accent,#f54900)]/30 bg-[color:var(--theme-accent,#f54900)]/[0.06] p-4 space-y-2">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--theme-accent,#f54900)]">
                  You're on the Free plan
                </div>
                <p className="text-sm text-white/90 leading-relaxed">
                  Free includes <strong className="text-white">1 account</strong>
                  {" "}and a <strong className="text-white">1,000 API call/month cap</strong>.
                  Upgrade to <strong className="text-white">Starter</strong> to lift the
                  cap and keep your 1 account — same $20/mo as a slot. After
                  Starter you can add more accounts (one slot each).
                </p>
              </div>

              <div className="rounded-none border border-white/[0.08] bg-black/40 p-4 space-y-3">
                <div className="text-center">
                  <div className="text-[10px] uppercase tracking-wider text-default-400 mb-1">
                    Starter
                  </div>
                  <div className="text-3xl font-bold font-mono">
                    $20<span className="text-default-400 text-lg font-normal">/mo</span>
                  </div>
                  <div className="text-[11px] text-default-500 mt-1">
                    14-day free trial · cancel any time
                  </div>
                </div>
                <ul className="text-xs text-white/85 space-y-1 pt-2 border-t border-white/[0.04]">
                  <li className="flex items-start gap-2">
                    <span className="text-[color:var(--theme-accent,#f54900)]">✓</span>
                    <span><strong>Unlimited API calls</strong> — no monthly cap</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[color:var(--theme-accent,#f54900)]">✓</span>
                    <span>Keeps your <strong>1 account</strong> connected</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[color:var(--theme-accent,#f54900)]">✓</span>
                    <span>After Starter, add more accounts at $20/mo per slot ($15/mo from your 15th)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[color:var(--theme-accent,#f54900)]">✓</span>
                    <span>30-day Stripe subscription · cancel from this modal</span>
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <>
              {/* Trial banner. Pulled from the dashboard's /slots response —
                  status='trialing' on the underlying Stripe sub means the
                  next invoice is $0 until trial_end. We show the next-charge
                  date so the user doesn't think they're being billed today. */}
              {slotsData?.status === "trialing" && slotsData?.currentPeriodEnd && (
                <div className="rounded-none border border-emerald-500/30 bg-emerald-500/[0.06] p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2 text-emerald-300 font-semibold uppercase tracking-wider text-[10px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" />
                    Free until renewal
                  </div>
                  <p className="text-white/85 leading-relaxed">
                    You&apos;re on a comp&apos;d period — next charge is{" "}
                    <strong className="text-white">
                      ${estimateMonthly(slotsData.accountSlots ?? 0)}/mo on{" "}
                      {new Date(slotsData.currentPeriodEnd).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </strong>
                    . Adding slots now still adds them to the same comp period.
                  </p>
                </div>
              )}

              {/* "You already have free slots" hint. Most common reason a user
                  opens this modal is they hit "Manage" expecting to add an OF
                  account, not buy more slots. Make that path obvious so they
                  don't end up buying duplicates. */}
              {typeof accountsConnected === "number" &&
                slotsData &&
                accountsConnected < slotsData.accountSlots && (
                  <div className="rounded-none border border-[color:var(--theme-accent,#f54900)]/30 bg-[color:var(--theme-accent,#f54900)]/[0.06] p-3 text-xs space-y-2">
                    <p className="text-white/90 leading-relaxed">
                      You have{" "}
                      <strong className="text-white">
                        {slotsData.accountSlots - accountsConnected} unused slot
                        {slotsData.accountSlots - accountsConnected === 1 ? "" : "s"}
                      </strong>
                      {" "}already paid for. You don&apos;t need to buy more — connect
                      an account to use them.
                    </p>
                    {onConnectAccount && (
                      <Button
                        size="sm"
                        className="bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold w-full"
                        onPress={() => {
                          onClose();
                          onConnectAccount();
                        }}
                      >
                        Connect an account instead →
                      </Button>
                    )}
                  </div>
                )}

              <p className="text-sm text-default-500">
                Pick how many slots you want in total. Each slot lasts 30 days from purchase and renews automatically.
              </p>

              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="bordered"
                  isDisabled={loading || target <= 1}
                  onPress={() => setTarget(Math.max(1, target - 1))}
                  className="rounded-none min-w-[36px]"
                >
                  −
                </Button>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={target}
                  onChange={(e) =>
                    setTarget(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))
                  }
                  disabled={loading}
                  className="flex-1 text-center bg-white/[0.03] border border-white/[0.12] rounded-none py-3 text-3xl font-bold font-mono outline-none focus:border-[color:var(--theme-accent,#f54900)]"
                />
                <Button
                  size="sm"
                  variant="bordered"
                  isDisabled={loading || target >= 100}
                  onPress={() => setTarget(Math.min(100, target + 1))}
                  className="rounded-none min-w-[36px]"
                >
                  +
                </Button>
              </div>

              {/* Tier-discount FOMO. Triggers when the user is within 5
                  slots of crossing 15. At that point every slot's NEXT
                  renewal drops from $20 to $15 — so the savings on their
                  EXISTING slots is the headline number. */}
              {(() => {
                if (currentTotal < 5 || currentTotal >= TIER_THRESHOLD) return null;
                const slotsUntilDiscount = TIER_THRESHOLD - currentTotal;
                if (slotsUntilDiscount > 5) return null;
                const savedPerMonth = currentTotal * 5;
                return (
                  <div className="rounded-none border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs">
                    <p className="font-semibold text-amber-300 mb-1">
                      ⚡ Unlock the $15/slot tier
                    </p>
                    <p className="text-white/85 leading-relaxed">
                      Buy {slotsUntilDiscount} more slot{slotsUntilDiscount === 1 ? "" : "s"}{" "}
                      → from next renewal, <strong className="text-white">every slot drops to $15/mo</strong>.
                      You&apos;d save <strong className="text-white">${savedPerMonth}/mo</strong> on the {currentTotal} slot{currentTotal === 1 ? "" : "s"} you already own.
                    </p>
                  </div>
                );
              })()}

              <div className="rounded-none border border-white/[0.06] bg-white/[0.02] p-3 text-sm space-y-1.5 font-mono">
                <div className="flex justify-between">
                  <span className="text-default-400">Current</span>
                  <span>{currentTotal} slot{currentTotal === 1 ? "" : "s"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-default-400">Target</span>
                  <span>{target} slot{target === 1 ? "" : "s"}</span>
                </div>
                <div className="flex justify-between text-foreground font-semibold pt-1 border-t border-white/[0.04]">
                  <span>New monthly</span>
                  <span>${newMonthly}/mo</span>
                </div>
                {delta > 0 && (
                  <div className="flex justify-between text-foreground">
                    <span>Charged today (prorated)</span>
                    <span>~${proratedToday.toFixed(2)}</span>
                  </div>
                )}
                {delta < 0 && (
                  <div className="flex justify-between text-amber-400">
                    <span>Releasing at renewal</span>
                    <span>{Math.abs(delta)} slot{Math.abs(delta) === 1 ? "" : "s"}</span>
                  </div>
                )}
                {delta === 0 && (
                  <div className="text-center text-default-400 pt-1 text-xs">No change</div>
                )}
              </div>

              {/* Live "today / next month" breakdown — separates the prorated
                  per-slot charges from the recurring next-cycle bill, and calls
                  out the volume discount when crossing the 15-slot threshold.
                  Pure client-side math from currentTotal + target. */}
              {delta > 0 && (() => {
                const lines: { slot: number; price: number }[] = [];
                for (let i = 0; i < delta; i++) {
                  const slotNum = currentTotal + 1 + i;
                  // Slot #16+ bills today at $15; slots #1-15 still $20 today.
                  const price = slotNum >= 16 ? TIER_2_PRICE : TIER_1_PRICE;
                  lines.push({ slot: slotNum, price });
                }
                const todayFullPriceTotal = lines.reduce((a, l) => a + l.price, 0);
                const visibleLines = lines.slice(0, 5);
                const hidden = lines.slice(5);
                const hiddenByPrice = new Map<number, number>();
                for (const l of hidden) {
                  hiddenByPrice.set(l.price, (hiddenByPrice.get(l.price) ?? 0) + 1);
                }
                // Next-month after reconcile: target * tier price.
                const targetTierPrice = target >= TIER_THRESHOLD ? TIER_2_PRICE : TIER_1_PRICE;
                const nextMonthlyTotal = target * targetTierPrice;
                const existingDropping = currentTotal >= 1 && currentTotal < TIER_THRESHOLD && target >= TIER_THRESHOLD ? currentTotal : 0;
                const existingSavings = existingDropping * (TIER_1_PRICE - TIER_2_PRICE);
                return (
                  <div className="rounded-none border border-white/[0.06] bg-white/[0.02] p-3 text-xs space-y-3 font-mono">
                    <div className="space-y-1">
                      <div className="flex justify-between uppercase tracking-wider text-default-500 text-[10px]">
                        <span>Today's bill</span>
                        <span>per slot</span>
                      </div>
                      {visibleLines.map((l) => (
                        <div key={l.slot} className="flex justify-between text-default-200">
                          <span className="text-default-400">Slot #{l.slot}</span>
                          <span>${l.price}</span>
                        </div>
                      ))}
                      {hidden.length > 0 && (
                        <div className="text-default-400 italic">
                          {Array.from(hiddenByPrice.entries()).map(([price, count], idx) => (
                            <span key={price}>
                              {idx > 0 ? " · " : ""}…and {count} more at ${price} each
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-between pt-1 border-t border-white/[0.04] text-white font-semibold">
                        <span>Charged today (full)</span>
                        <span>${todayFullPriceTotal}</span>
                      </div>
                      {periodEnd && (
                        <div className="flex justify-between text-default-500 text-[10px]">
                          <span>Prorated portion</span>
                          <span>~${proratedToday.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between uppercase tracking-wider text-default-500 text-[10px]">
                        <span>Next month's bill</span>
                        <span>after reconcile</span>
                      </div>
                      <div className="flex justify-between text-default-200">
                        <span className="text-default-400">
                          {target} × ${targetTierPrice}/mo
                        </span>
                        <span className="text-white font-semibold">${nextMonthlyTotal}/mo</span>
                      </div>
                      {existingDropping > 0 && (
                        <div className="text-amber-300 leading-relaxed text-[11px] pt-1">
                          ⚡ Your existing {existingDropping} slot{existingDropping === 1 ? "" : "s"} also drop to $15/mo at their next renewal — saving{" "}
                          <strong className="text-white">${existingSavings}/mo</strong>.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Release flow breakdown — shows the monthly bill before/after
                  when target < current. Pure client-side; the actual release
                  is scheduled at each slot's next renewal. */}
              {delta < 0 && (() => {
                const currentTierPrice = currentTotal >= TIER_THRESHOLD ? TIER_2_PRICE : TIER_1_PRICE;
                const targetTierPrice = target >= TIER_THRESHOLD ? TIER_2_PRICE : TIER_1_PRICE;
                const currentMonthly = currentTotal * currentTierPrice;
                const nextMonthly = target * targetTierPrice;
                const crossesDown = currentTotal >= TIER_THRESHOLD && target < TIER_THRESHOLD;
                return (
                  <div className="rounded-none border border-white/[0.06] bg-white/[0.02] p-3 text-xs space-y-1 font-mono">
                    <div className="flex justify-between uppercase tracking-wider text-default-500 text-[10px]">
                      <span>At next renewal</span>
                      <span>release</span>
                    </div>
                    <div className="flex justify-between text-default-300">
                      <span>{Math.abs(delta)} slot{Math.abs(delta) === 1 ? "" : "s"} released</span>
                      <span>—</span>
                    </div>
                    <div className="flex justify-between text-default-300 pt-1 border-t border-white/[0.04]">
                      <span>Bill drops from</span>
                      <span>
                        <span className="line-through text-default-500">${currentMonthly}/mo</span>
                        {" → "}
                        <span className="text-white font-semibold">${nextMonthly}/mo</span>
                      </span>
                    </div>
                    {crossesDown && (
                      <div className="text-amber-300 leading-relaxed text-[11px] pt-1">
                        ⚠ Dropping below 15 slots — remaining slots renew at $20/mo (volume tier lost).
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}

          {!isFreeUpgrade && crossesTier && delta > 0 && (
            <p className="text-xs text-amber-400">
              ⚡ Crossing the 15-slot threshold — every slot beyond 14 is billed at $15/mo instead of $20/mo.
            </p>
          )}

          {/* Per-slot expiry preview — concrete dates so the user sees what
              they're signing up for. We cap at 3 + "...and N more" once the
              delta gets big, otherwise the modal grows unwieldy. Hidden on
              the free→paid upgrade flow because there's only one slot. */}
          {!isFreeUpgrade && delta > 0 && (() => {
            const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const expiresFmt = expires.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
            const previewCount = Math.min(3, delta);
            const rows = [] as import('react').ReactElement[];
            for (let i = 0; i < previewCount; i++) {
              const slotNumber = currentTotal + i + 1;
              const tierPrice = slotNumber > TIER_THRESHOLD - 1 ? TIER_2_PRICE : TIER_1_PRICE;
              rows.push(
                <div key={i} className="flex justify-between text-default-300">
                  <span>Slot {slotNumber}</span>
                  <span className="text-default-400">expires {expiresFmt} · ${tierPrice}/mo</span>
                </div>
              );
            }
            return (
              <div className="rounded-none border border-white/[0.06] bg-white/[0.02] p-3 text-xs space-y-1 font-mono">
                {rows}
                {delta > 3 && (
                  <div className="text-default-400 italic pt-1">
                    …and {delta - 3} more slot{delta - 3 === 1 ? "" : "s"}, all expiring {expiresFmt}
                  </div>
                )}
              </div>
            );
          })()}

          {delta < 0 && (
            <div className="rounded-none border border-white/[0.06] bg-white/[0.02] p-3 text-xs space-y-1 font-mono text-amber-300">
              <div>
                {Math.abs(delta)} slot{Math.abs(delta) === 1 ? "" : "s"} will be released at their next renewal.
              </div>
              <div className="text-default-400">
                We pick empty slots first (no OF account connected), then the oldest.
              </div>
            </div>
          )}

          {!isFreeUpgrade && (
            <p className="text-xs text-default-400">
              Each slot is its own 30-day Stripe subscription. Removing a connected OF account frees the slot for re-use within the period; &quot;Release&quot; stops billing at the next renewal. If payment fails you have 5 days to fix your card before the slot is cancelled.
            </p>
          )}
          {isFreeUpgrade && (
            <p className="text-xs text-default-400">
              After subscribing, you'll come back here to add more slots, release them, or cancel.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={loading}>
            Cancel
          </Button>
          <Button
            className="bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold"
            isLoading={loading}
            isDisabled={delta === 0}
            onPress={() => onConfirm(target)}
          >
            {delta > 0
              ? isFreeUpgrade
                ? "Subscribe to Starter — $20/mo"
                : `Confirm — Add ${delta} slot${delta === 1 ? "" : "s"}`
              : delta < 0
                ? `Confirm — Release ${Math.abs(delta)}`
                : "No change"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
