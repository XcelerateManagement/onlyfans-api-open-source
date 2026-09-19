"use client";

import { useEffect } from "react";

import { subscribeToWritesDisabled } from "@/lib/api-client";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { notifyWritesDisabled } from "@/components/dashboard/WritesDisabledToast";

/**
 * Dashboard-wide "Enable writes" prompt.
 *
 * Mounted once in the dashboard layout and fed by `CrmApiClient`: any page's
 * write refused with `403 WRITES_DISABLED` surfaces here as a one-click toast,
 * without that page opting in. Counterpart to `RateLimitBanner` — same
 * broadcast pattern. Renders nothing itself.
 */
export function WritesDisabledWatcher() {
  const api = useApiClient();
  const { accounts } = useAccounts();

  useEffect(() => {
    return subscribeToWritesDisabled(({ ofUserId }) => {
      const username = ofUserId
        ? accounts.find((a) => String(a.of_user_id) === String(ofUserId))?.username
        : null;
      notifyWritesDisabled({ api, ofUserId, username });
    });
    // `api` and `accounts` are read at fire time; re-subscribing when they
    // change keeps the closure current without dropping any notice.
  }, [api, accounts]);

  return null;
}
