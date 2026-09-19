"use client";

/**
 * Account slots — a no-op on a self-hosted install.
 *
 * The hosted product meters how many creator accounts a panel may connect and
 * bills per slot. This build has no metering and no billing: connect as many
 * accounts as your proxies and captcha balance can support.
 *
 * The hook is kept, rather than torn out of every caller, so that the accounts
 * page reads the same in both builds. It reports an effectively unlimited
 * allowance, which makes every "do you have a free slot?" gate pass, and its
 * mutations do nothing.
 */

export interface Slot {
  slotId: string;
  ofAccountId: string | null;
  purchasedAt: string;
  scheduledForRelease: boolean;
  releaseAt?: string;
}

export interface SlotsState {
  hasSubscription: boolean;
  planId: string | null;
  status: string | null;
  slots: Slot[];
  accountSlots: number;
  slotsAssigned: number;
  slotsAvailable: number;
  slotsVersion: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextSlotPrice: number;
  nextInvoicePreview: { amountDue: number; periodEnd: string | null } | null;
}

/** Large enough that no UI gate ever trips; small enough to render sanely. */
const UNLIMITED = 9999;

const SELF_HOSTED: SlotsState = {
  hasSubscription: true,
  planId: "self-hosted",
  status: "active",
  slots: [],
  accountSlots: UNLIMITED,
  slotsAssigned: 0,
  slotsAvailable: UNLIMITED,
  slotsVersion: 0,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  nextSlotPrice: 0,
  nextInvoicePreview: null,
};

/* eslint-disable @typescript-eslint/no-unused-vars */
const noop = async (..._args: unknown[]) => {};

export function useSlots() {
  return {
    data: SELF_HOSTED,
    loading: false,
    error: null as string | null,
    refresh: noop,
    purchase: noop,
    setTotalSlots: noop,
    release: noop,
    cancelRelease: noop,
  };
}

/** Always free here. Kept so the confirm-modal preview still compiles. */
export function estimateProratedCharge(): number {
  return 0;
}
