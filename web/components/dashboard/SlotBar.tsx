"use client";

import type { SlotsState } from "@/lib/hooks/use-slots";

interface SlotBarProps {
  data: SlotsState | null;
  loading?: boolean;
  onBuySlot?: () => void;
  accountsConnected?: number;
}

/**
 * Renders nothing on a self-hosted install.
 *
 * In the hosted product this bar shows how many account slots a panel has
 * bought, how many are in use, and offers to buy more. None of that exists
 * here: there is no slot limit, so there is nothing to display and nothing to
 * sell. The component is kept as a no-op so the accounts page is identical in
 * both builds.
 */
export function SlotBar(_props: SlotBarProps) {
  return null;
}
