"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useApiClient } from "./use-api-client";
import { ApiError } from "@/lib/api-client";

export type Platform = "onlyfans" | "fansly";
export type ConnectionState =
  | "connected"
  | "login_failed"
  | "verification_required"
  | "proxy_error"
  | "rate_limited"
  | "sync_blocked"
  | "temporary_error";

export interface LoginFailure {
  code:
    | "invalid_password"
    | "invalid_credentials"
    | "account_not_found"
    | "account_disabled"
    | "account_deleted"
    | "session_revoked"
    | "missing_credentials";
  message: string;
  occurred_at: string | null;
  action: "reconnect" | "contact_support" | "remove_account";
}

export interface ConnectionError {
  code: string;
  message: string;
  occurred_at: string | null;
  retryable: boolean;
}

export interface OfAccount {
  id: number;
  of_user_id: string;
  email: string;
  username: string | null;
  proxy: string | null;
  created_at: string;
  last_login: string | null;
  avatar?: string | null;
  about?: string | null;
  // Platform this account belongs to. Optional + defaults to "onlyfans" so
  // existing accounts (and any backend that predates the column) keep working.
  platform?: Platform;
  // Per-account capability matrix emitted by the backend (platform_features.py).
  // Prefer this over the static frontend MATRIX via accountSupports().
  capabilities?: Partial<Record<string, boolean>>;
  // Relogin circuit breaker: true when the backend paused auto-relogin because
  // the stored password was rejected — the user must reconnect the account.
  needs_reconnect?: boolean;
  relogin_block_reason?: string | null;
  connection_state?: ConnectionState;
  login_failure?: LoginFailure | null;
  connection_error?: ConnectionError | null;
  // Platform identity gate — OnlyFans is refusing every account-scoped call
  // until a human passes a face/selfie check. Deliberately NOT needs_reconnect:
  // the password and the session are both fine, so reconnecting achieves
  // nothing. See onlyfans-api/of_faceid.py.
  needs_verification?: boolean;
  verification?: {
    required_since?: string | null;
    reason?: string | null;
    face_required?: boolean;
    otp_state?: Record<string, unknown> | null;
  } | null;
  // Local account tags (account_tags table), merged into the list response so
  // the accounts page never issues a per-account tag request.
  tags?: string[];
  // Polling state, carried on the list response so panel-wide views don't have
  // to ask per account. 0/1 from SQLite rather than a bool.
  polling_enabled?: number;
  polling_interval_seconds?: number;
  last_polled_at?: string | null;
  polling_failure_count?: number;
  // Last known payout balance, stamped by the backend whenever a balance was
  // already fetched for this account. Undefined means "never sampled" — which
  // is NOT the same as zero, so callers must distinguish the two when they
  // aggregate. See balances/summary for the server-side equivalent.
  last_balance_available?: number | null;
  last_balance_pending?: number | null;
  last_balance_currency?: string | null;
  last_balance_at?: string | null;
  // Country flags, resolved + cached server-side (backfill_account_geo). Both
  // are ISO alpha-2 codes (e.g. "US") + a display name, or absent until the
  // background lookup has run once. `proxy_country_*` is the proxy's real exit
  // country; `profile_country_*` is the OnlyFans banking country (OF only).
  proxy_country_code?: string | null;
  proxy_country?: string | null;
  // When the proxy's exit country was last resolved (UTC ISO), for the proxy
  // hover tooltip. Null until the background geo lookup has run.
  proxy_geo_at?: string | null;
  profile_country_code?: string | null;
  profile_country?: string | null;
}

interface AccountContextType {
  accounts: OfAccount[];
  selectedAccount: OfAccount | null;
  setSelectedAccount: (account: OfAccount | null) => void;
  refreshAccounts: () => Promise<void>;
  loading: boolean;
  /** Why the last fetch failed, or null when it succeeded. An empty
   *  `accounts` alongside a non-null `error` means "we don't know", NOT
   *  "nothing is connected" — callers must not render an empty state for it.
   *  `error.isRateLimit` is the common case: ~17 dashboard subpages will
   *  exhaust the per-key per-minute cap on a click-through. */
  error: ApiError | null;
  /** True once a fetch has completed successfully at least once. The only
   *  safe precondition for showing "No accounts connected". */
  loaded: boolean;
}

const AccountContext = createContext<AccountContextType | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const [accounts, setAccounts] = useState<OfAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<OfAccount | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refreshAccounts = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const data = await api.getAccounts();
      setAccounts(data.accounts || []);
      setError(null);
      setLoaded(true);
      // Auto-select first account if none selected
      if (!selectedAccount && data.accounts?.length > 0) {
        setSelectedAccount(data.accounts[0]);
      }
    } catch (e: any) {
      // This used to swallow the error, which is how a 429 became the words
      // "No accounts connected": the list stayed [] and every consumer read
      // that as truth. Publish the failure instead, and deliberately do NOT
      // clobber a previously-good list — a transient rate limit should not
      // blank a panel that was rendering fine a second ago.
      setError(
        e instanceof ApiError
          ? e
          : new ApiError(0, { error: e?.message || "Could not load accounts" })
      );
    } finally {
      setLoading(false);
    }
  }, [api, selectedAccount]);

  useEffect(() => {
    refreshAccounts();
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AccountContext.Provider
      value={{
        accounts,
        selectedAccount,
        setSelectedAccount,
        refreshAccounts,
        loading,
        error,
        loaded,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts() {
  const ctx = useContext(AccountContext);
  if (!ctx)
    throw new Error("useAccounts must be used within AccountProvider");
  return ctx;
}
