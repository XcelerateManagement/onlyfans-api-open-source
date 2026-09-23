"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@heroui/table";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Chip } from "@heroui/chip";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { useDisclosure } from "@heroui/use-disclosure";
import Link from "next/link";
import { PxPlus, PxMail, PxLock, PxGlobe, PxDollarSign, PxSettings, PxActivity, PxRefresh, PxEye, PxCopy, PxSearch, PxUsers } from "@/components/ui/PixelIcons";
import { Switch } from "@heroui/switch";
import { Avatar } from "@heroui/avatar";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useConfirm } from "@/lib/hooks/use-confirm";
import { useProxyFix } from "@/lib/hooks/use-proxy-fix";
import { isProxyError, proxyErrorMessage } from "@/lib/proxy-error";
import { checkProxy } from "@/lib/proxy-format";
import { isPlatformNotSupported, platformUnsupportedMessage } from "@/lib/api-client";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import { useAccounts, type OfAccount } from "@/lib/hooks/use-selected-account";
import { useRefreshJobs } from "@/lib/hooks/use-refresh-jobs";
import { useTour } from "@/lib/tour-context";
import { usePendingTwoFactor } from "@/lib/hooks/use-pending-2fa";
import { TOUR_ACCOUNTS } from "@/lib/tour-fake-data";
import { DataState } from "@/components/dashboard/DataState";
import { GlassCard } from "@/components/dashboard/GlassCard";
import { DataTableToolbar } from "@/components/dashboard/DataTableToolbar";
import { AccountTagEditor } from "@/components/dashboard/AccountTagEditor";
import { AccountStatusLine } from "@/components/dashboard/AccountStatus";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { Select, SelectItem } from "@heroui/select";
import { RefreshProgressBar } from "@/components/dashboard/RefreshProgressBar";
import { FaceVerifyModal } from "@/components/dashboard/FaceVerifyModal";
import { TwoFactorModal } from "@/components/dashboard/TwoFactorModal";
import PlatformBadge from "@/components/dashboard/PlatformBadge";
import { countryCodeToFlag } from "@/lib/country-flag";
import { Tooltip } from "@heroui/tooltip";
import { maskProxy } from "@/lib/import-format";
import { ProxyFormatHint } from "@/components/dashboard/ProxyFormatHint";
import { parseUtc } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

/**
 * Tiny chip-style icon-only button for the trailing slot of an HeroUI
 * Input. Used for paste + reveal in the add-account modal. Stops mouse-
 * down propagation so clicking it doesn't blur the input.
 */
function FieldActionButton({
  icon,
  onPress,
  title,
  active,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      title={title}
      aria-label={title}
      className={cn(
        "border border-white/[0.08] hover:border-white/[0.2] focus-visible:border-white/[0.3] outline-none transition-colors px-1.5 py-0.5 text-default-400 hover:text-white",
        active && "border-[color:var(--theme-accent,#f54900)]/40 text-[color:var(--theme-accent,#f54900)]",
      )}
    >
      {icon}
    </button>
  );
}

/** Full country name for a proxy: the backend's display name if present, else
 *  derived from the ISO code via the browser's own locale data. */
function proxyCountryName(account: OfAccount): string | null {
  if (account.proxy_country) return account.proxy_country;
  const code = account.proxy_country_code;
  if (!code || !/^[a-zA-Z]{2}$/.test(code)) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) || code;
  } catch {
    return code;
  }
}

/** Short "3d ago" style relative time. */
function shortAgo(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").getTime();
  if (Number.isNaN(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** PROXY column cell: flag + country name, with a hover card showing the
 *  masked proxy (password hidden), exit country, and when geo was last checked. */
function ProxyCell({ account }: { account: OfAccount }) {
  if (!account.proxy) return <span className="text-default-400">None</span>;
  const flag = countryCodeToFlag(account.proxy_country_code);
  const name = proxyCountryName(account);
  const checked = shortAgo(account.proxy_geo_at);
  const masked = maskProxy(account.proxy);
  return (
    <Tooltip
      placement="right"
      delay={300}
      classNames={{ content: "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs p-0" }}
      content={
        <div className="text-[11px] leading-tight px-2.5 py-2 min-w-[180px] space-y-1">
          <div className="flex gap-3 justify-between">
            <span className="text-default-400">Proxy</span>
            <span className="font-mono">{masked}</span>
          </div>
          <div className="flex gap-3 justify-between">
            <span className="text-default-400">Exit country</span>
            <span>{flag ? `${flag} ` : ""}{name || account.proxy_country_code || "Unknown"}</span>
          </div>
          <div className="flex gap-3 justify-between">
            <span className="text-default-400">Geo checked</span>
            <span>{checked || "pending"}</span>
          </div>
        </div>
      }
    >
      <div className="inline-flex items-center gap-1.5 cursor-help">
        {flag && <span className="text-sm leading-none">{flag}</span>}
        <span className="text-xs text-green-400">
          {name || account.proxy_country_code || "Configured"}
        </span>
      </div>
    </Tooltip>
  );
}

export default function AccountsPage() {
  const api = useApiClient();
  const confirm = useConfirm();
  const { promptProxyFix } = useProxyFix();
  const {
    accounts: realAccounts,
    refreshAccounts,
    loading,
    error: accountsError,
    loaded,
  } = useAccounts();
  const { isActive: isTourActive } = useTour();
  // Same dashboard-wide provider the banner and the sidebar read — no extra
  // request. Surfaces "N logins are still waiting for a 2FA code" on the button
  // that opens the importer, which is where the operator will look for it.
  const { count: pending2faCount } = usePendingTwoFactor();

  // ── Search + tag filter ──────────────────────────────────────────────────
  // Both run SERVER-side (GET /accounts?search=&tag=). The client-side
  // alternative would mean shipping every row of a ~600-account panel on each
  // keystroke, which is the problem this filter exists to solve.
  //
  // With no filter active we deliberately reuse the AccountProvider's list
  // instead of issuing our own request: unfiltered, it is byte-for-byte the
  // same response, so the default page load still costs exactly one
  // GET /accounts — the same as before this feature.
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [tagFilter, setTagFilter] = useState("");
  const filtersActive = !!(debouncedSearch.trim() || tagFilter);

  const [filteredAccounts, setFilteredAccounts] = useState<any[] | null>(null);
  const [serverTags, setServerTags] = useState<string[] | null>(null);
  const [filtering, setFiltering] = useState(false);
  // A failed FILTER request left filteredAccounts at null, which reads as [],
  // which rendered "No accounts yet" — on a panel that has hundreds.
  const [filterError, setFilterError] = useState<unknown>(null);

  // Optimistic tag edits, keyed by of_user_id, applied over whichever list is
  // in play so a chip added in a row survives until the next list refresh.
  const [tagOverrides, setTagOverrides] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (isTourActive || !api) return;
    if (!filtersActive) {
      setFilteredAccounts(null);
      setServerTags(null);
      return;
    }
    let alive = true;
    setFiltering(true);
    setFilterError(null);
    api
      .getAccounts({
        search: debouncedSearch.trim() || undefined,
        tag: tagFilter || undefined,
      })
      .then((res) => {
        if (!alive) return;
        setFilteredAccounts(res.accounts || []);
        // all_tags is computed before filtering server-side, so the dropdown
        // keeps every option after one is selected.
        setServerTags(res.all_tags || []);
      })
      .catch((err: any) => {
        if (!alive) return;
        setFilterError(err);
        toast.error(err?.message || "Failed to filter accounts");
      })
      .finally(() => {
        if (alive) setFiltering(false);
      });
    return () => {
      alive = false;
    };
  }, [api, debouncedSearch, tagFilter, filtersActive, isTourActive]);

  const baseAccounts = isTourActive
    ? TOUR_ACCOUNTS
    : filtersActive
      ? (filteredAccounts ?? [])
      : realAccounts;

  const accounts = useMemo(
    () =>
      baseAccounts.map((a: any) => {
        const override = tagOverrides[String(a.of_user_id)];
        return override ? { ...a, tags: override } : a;
      }),
    [baseAccounts, tagOverrides],
  );

  /** Every tag in the panel — the filter's option list. */
  const allTags = useMemo(() => {
    const s = new Set<string>(serverTags ?? []);
    // Unfiltered, the provider's list IS the whole panel, so its tags are the
    // whole universe. Overrides are folded in so a tag typed a second ago is
    // immediately filterable.
    if (!serverTags) for (const a of realAccounts) for (const t of a.tags || []) s.add(t);
    for (const list of Object.values(tagOverrides)) for (const t of list) s.add(t);
    return Array.from(s).sort();
  }, [serverTags, realAccounts, tagOverrides]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setTagFilter("");
  }, []);

  const setAccountTags = useCallback(
    (ofUserId: string, next: string[]) => {
      setTagOverrides((prev) => ({ ...prev, [String(ofUserId)]: next }));
      // Keep the shared provider list (header selector, other pages) in step.
      // Fire-and-forget: the optimistic override already updated this table.
      refreshAccounts();
    },
    [refreshAccounts],
  );

  // Add account modal
  const {
    isOpen: isAddOpen,
    onOpen: onAddOpen,
    onClose: onAddClose,
  } = useDisclosure();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [proxy, setProxy] = useState("");
  // Platform selection for the add-account flow. Fansly accounts can connect
  // either with email+password or by pasting an auth token.
  const [platform, setPlatform] = useState<"onlyfans" | "fansly">("onlyfans");
  const [fanslyMethod, setFanslyMethod] = useState<"password" | "token">("password");
  const [fanslyAuthToken, setFanslyAuthToken] = useState("");
  const [fanslySessionId, setFanslySessionId] = useState("");
  const [fanslyClientId, setFanslyClientId] = useState("");
  // Non-error informational notice (e.g. Fansly email-verification guidance).
  const [addNotice, setAddNotice] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  // What to do about addError (backend `suggestion`). Only shown alongside an
  // error, and replaced every time failAdd sets a new one.
  const [addSuggestion, setAddSuggestion] = useState("");
  const failAdd = (message: string, suggestion?: string) => {
    setAddError(message);
    setAddSuggestion(suggestion || "");
  };
  const [proxyTesting, setProxyTesting] = useState(false);
  // `for` is the normalised proxy the result belongs to, so a result never
  // outlives an edit. `definite` marks a real proxy verdict (not a 429/5xx
  // from the test endpoint itself) — only those block Connect.
  const [proxyResult, setProxyResult] = useState<
    | {
        ok: true;
        for: string;
        ip?: string;
        latency_ms?: number;
        geo?: {
          country?: string | null;
          country_code?: string | null;
          region?: string | null;
          city?: string | null;
          isp?: string | null;
        } | null;
        // OnlyFans blocks logins from this proxy's IP even though the proxy works.
        ofBlocked?: boolean;
        ofWarning?: string | null;
      }
    | { ok: false; for: string; error: string; definite: boolean }
    | null
  >(null);
  // Field errors show once a field was left (or Connect was pressed), then
  // track the value live — fixing the input clears the message immediately.
  const [addAttempted, setAddAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<"email" | "password" | "proxy", boolean>>({
    email: false,
    password: false,
    proxy: false,
  });
  const touch = (field: "email" | "password" | "proxy") =>
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  // Seconds since Connect was pressed — a login takes 10–40s and a bare
  // spinner reads as "stuck".
  const [connectStartedAt, setConnectStartedAt] = useState<number | null>(null);
  const [connectElapsed, setConnectElapsed] = useState(0);
  useEffect(() => {
    if (connectStartedAt === null) return;
    setConnectElapsed(0);
    const timer = setInterval(
      () => setConnectElapsed(Math.floor((Date.now() - connectStartedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [connectStartedAt]);
  const proxyCheck = useMemo(() => (proxy.trim() ? checkProxy(proxy) : null), [proxy]);
  const emailError =
    platform === "fansly"
      ? email.trim() ? "" : "Enter the account's username or email."
      : !email.trim()
        ? "Enter the account's email."
        : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
          ? ""
          : "That doesn't look like an email address.";
  const passwordError = password ? "" : "Enter the account's password.";
  const proxyError =
    proxyCheck && !proxyCheck.ok
      ? proxyCheck.error
      : !proxyCheck && platform === "onlyfans"
        ? "OnlyFans needs a proxy — paste one here."
        : "";
  const showFieldError = (field: "email" | "password" | "proxy") =>
    addAttempted || touched[field];
  /** A field changed: stale connect errors no longer describe the form. */
  const editedAddField = () => {
    if (addError) failAdd("");
  };
  const [showPassword, setShowPassword] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  // Which code factors OnlyFans offered (app/email/sms), so the OTP step can
  // tell the user where to read the code instead of a generic prompt.
  const [otp2faMethods, setOtp2faMethods] = useState<string[]>([]);
  // Forced-face (id2) verification step of the add flow — a parallel path to
  // the OTP step: no code can clear it, so the modal shows the selfie link +
  // live status instead of a code box.
  const [faceStep, setFaceStep] = useState(false);
  const [faceOfUserId, setFaceOfUserId] = useState<string | null>(null);
  const [faceUrl, setFaceUrl] = useState<string | null>(null);
  const [faceStatus, setFaceStatus] = useState<string>("required");
  const [faceStarting, setFaceStarting] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpEmail, setOtpEmail] = useState("");

  // Manage account modal (proxy + subscription price)
  const {
    isOpen: isManageOpen,
    onOpen: onManageOpen,
    onClose: onManageClose,
  } = useDisclosure();
  const [manageAccount, setManageAccount] = useState<any>(null);
  // Face-check modal target. Null = closed. Separate from manageAccount because
  // the two flows fix different things: manage edits our config, this one asks
  // OnlyFans to stop refusing the account.
  const [verifyAccount, setVerifyAccount] = useState<OfAccount | null>(null);
  // 2FA-code confirm modal target (app/email/sms factors).
  const [twoFaAccount, setTwoFaAccount] = useState<OfAccount | null>(null);
  const [editProxy, setEditProxy] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [manageLoading, setManageLoading] = useState(false);
  const [manageError, setManageError] = useState("");
  const [manageSuccess, setManageSuccess] = useState("");

  // Read-only subscription price for platforms where the price is READABLE but
  // not updatable via API (subscription_price true, subscription_price_update
  // false — e.g. Fansly, whose tiers come from /account/me). Fetched once per
  // manage-modal open; the update form stays hidden for those accounts.
  const [readOnlyPrice, setReadOnlyPrice] = useState<number | null>(null);
  const [readOnlyPriceLoading, setReadOnlyPriceLoading] = useState(false);
  useEffect(() => {
    setReadOnlyPrice(null);
    if (!api || !manageAccount) return;
    if (
      !accountSupports(manageAccount, "subscription_price") ||
      accountSupports(manageAccount, "subscription_price_update")
    )
      return;
    let alive = true;
    setReadOnlyPriceLoading(true);
    api
      .getSubscriptionPrice(String(manageAccount.of_user_id))
      .then((res) => {
        if (alive) setReadOnlyPrice(res.subscribePrice ?? 0);
      })
      .catch(() => {
        // Non-fatal — the card just shows the note without a number.
      })
      .finally(() => {
        if (alive) setReadOnlyPriceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, manageAccount]);

  // Progress state for both refresh kinds comes from the SSE-backed hook —
  // button "loading" is derived from whether the hook has an active job for
  // this (account, kind) so page reload, cron-triggered refreshes, and a
  // second-tab view all show the same state without manual bookkeeping.
  const refreshJobs = useRefreshJobs();

  // Open the inline "fix proxy" wizard for a specific account, retrying the
  // action once a working proxy is saved. A 407/proxy failure is the most
  // common OF error here, so refreshes route their errors through this.
  const openProxyFix = (
    account: any,
    reason?: string | null,
    onFixed?: () => void,
  ) => {
    if (!account) return;
    promptProxyFix({
      account: {
        of_user_id: account.of_user_id,
        username: account.username,
        proxy: account.proxy ?? null,
      },
      reason,
      onFixed,
    });
  };

  const handleRefreshSubscribers = async (account: any) => {
    if (!api) return;
    const uid = String(account.of_user_id);
    try {
      const res = await api.refreshSubscribers(uid, { mode: "full" });
      if (res.already_running) {
        toast(`Subs refresh already running for @${account.username || uid}`);
      } else {
        toast.success(`Full subs sync started for @${account.username || uid} — can take a few minutes`);
      }
    } catch (err: any) {
      if (isProxyError(err)) {
        openProxyFix(account, proxyErrorMessage(err), () =>
          handleRefreshSubscribers(account),
        );
      } else if (isPlatformNotSupported(err)) {
        toast.error(platformUnsupportedMessage(err.data?.feature, err.data?.platform));
      } else {
        toast.error(err?.message || "Refresh failed");
      }
    }
  };

  const handleRefreshSpending = async (account: any) => {
    if (!api) return;
    const uid = String(account.of_user_id);
    try {
      const res = await api.refreshTransactions(uid, { mode: "delta" });
      if (res.already_running) {
        toast(`Spending refresh already running for @${account.username || uid}`);
      } else {
        toast.success(`Spending refresh started for @${account.username || uid}`);
      }
    } catch (err: any) {
      if (isProxyError(err)) {
        openProxyFix(account, proxyErrorMessage(err), () =>
          handleRefreshSpending(account),
        );
      } else if (isPlatformNotSupported(err)) {
        toast.error(platformUnsupportedMessage(err.data?.feature, err.data?.platform));
      } else {
        toast.error(err?.message || "Refresh failed");
      }
    }
  };

  const tryOpenAddAccount = () => {
    // Self-hosted installs do not meter creator-account slots.
    onAddOpen();
  };

  const runProxyTest = async (raw: string) => {
    if (!api || !raw.trim()) return;
    // A malformed proxy is explained inline under the field; testing it would
    // only come back as a vaguer version of the same message.
    const check = checkProxy(raw);
    if (!check.ok) {
      setProxyResult(null);
      return;
    }
    const target = check.value;
    setProxyResult(null);
    setProxyTesting(true);
    try {
      const r = await api.testProxy(target);
      if (r.ok) {
        setProxyResult({
          ok: true,
          for: target,
          ip: r.ip,
          latency_ms: r.latency_ms,
          geo: r.geo ?? null,
          ofBlocked: r.of_reachable === false,
          ofWarning: r.of_warning ?? null,
        });
      } else {
        setProxyResult({ ok: false, for: target, definite: true, error: r.error || "Proxy test failed." });
      }
    } catch (err) {
      // Never surface raw curl/network errors — give a friendly one-liner.
      const e = err as { message?: string; status?: number; data?: { error?: string } };
      const msg = e?.message || "";
      const isAuth = /407|authentication/i.test(msg);
      const isNet = /(\(56\)|reset|refused|unreachable)/i.test(msg);
      setProxyResult({
        ok: false,
        for: target,
        // 400 = the server rejected the proxy itself; anything else may be the
        // test endpoint's own trouble and must not block connecting.
        definite: e?.status === 400 || isAuth,
        error:
          e?.status === 400 && e.data?.error
            ? e.data.error
            : isAuth
              ? "Proxy authentication failed — check username and password."
              : isNet
                ? "Proxy unreachable. Try again or use a different proxy."
                : "Couldn't run the proxy test right now — you can still connect.",
      });
    } finally {
      setProxyTesting(false);
    }
  };

  const handleTestProxy = () => runProxyTest(proxy);

  const [enableAllLoading, setEnableAllLoading] = useState(false);
  const handleEnableAllPolling = async () => {
    if (!api) return;
    setEnableAllLoading(true);
    try {
      const r = await api.enableAllPolling();
      const mins = Math.round((r.interval_seconds || 300) / 60);
      if (r.enabled > 0) {
        toast.success(
          `Polling on for ${r.enabled} account${r.enabled === 1 ? "" : "s"} (every ${mins} min).` +
            (r.already_on ? ` ${r.already_on} already on.` : ""),
        );
      } else if (r.already_on > 0) {
        toast.success(`All ${r.already_on} eligible accounts are already polling.`);
      } else {
        toast("No accounts were eligible to enable polling.", { icon: "ℹ️" });
      }
      await refreshAccounts();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't enable polling for all accounts.");
    } finally {
      setEnableAllLoading(false);
    }
  };

  /** Test on blur/paste, once per distinct valid proxy. */
  const autoTestProxy = (raw: string) => {
    const check = checkProxy(raw);
    if (!check.ok || proxyTesting) return;
    if (proxyResult && proxyResult.for === check.value) return;
    runProxyTest(raw);
  };
  // The result shown must belong to what is in the field now.
  const currentProxyResult =
    proxyResult && proxyCheck?.ok && proxyResult.for === proxyCheck.value ? proxyResult : null;

  /**
   * Read text from the clipboard and feed it into a state setter. Touch /
   * mobile-friendly alternative to manually selecting the field and pasting.
   * Silent on permission failure — the user can still paste with Cmd-V.
   */
  const pasteInto = async (setter: (v: string) => void) => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setter(t);
    } catch {/* no clipboard permission */}
  };

  /** Same, but also kicks off a proxy test once the value is set. */
  const pasteProxy = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return;
      setProxy(t);
      touch("proxy");
      editedAddField();
      // Fire test directly with the pasted value — don't wait for setState.
      autoTestProxy(t);
    } catch {/* no permission */}
  };

  /** Reset every field in the add-account modal back to defaults. */
  const resetAddForm = () => {
    setEmail("");
    setPassword("");
    setProxy("");
    setPlatform("onlyfans");
    setFanslyMethod("password");
    setFanslyAuthToken("");
    setFanslySessionId("");
    setFanslyClientId("");
    setAddNotice("");
    setOtpStep(false);
    setOtp2faMethods([]);
    setOtpCode("");
    setOtpEmail("");
    setFaceStep(false);
    setFaceOfUserId(null);
    setFaceUrl(null);
    setFaceStatus("required");
    setFaceStarting(false);
    setProxyResult(null);
    setAddAttempted(false);
    setTouched({ email: false, password: false, proxy: false });
    failAdd("");
  };

  const handleAddAccount = async () => {
    if (!api) return;
    const usingFanslyToken = platform === "fansly" && fanslyMethod === "token";
    // Validate required fields per flow before hitting the network. The
    // messages are already rendered under each field once addAttempted is set.
    setAddAttempted(true);
    if (usingFanslyToken) {
      if (!fanslyAuthToken.trim() || !fanslySessionId.trim()) return;
    } else if (emailError || passwordError) {
      return;
    }
    if (proxyError) return;
    if (currentProxyResult && !currentProxyResult.ok && currentProxyResult.definite) {
      failAdd(
        `The proxy test failed: ${currentProxyResult.error}`,
        "Fix the proxy or paste a different one — it is re-tested automatically.",
      );
      return;
    }
    failAdd("");
    setAddNotice("");
    setAddLoading(true);
    setConnectStartedAt(Date.now());

    try {
      // The form's own normalisation (host:port:user:pass → URL, typo repairs).
      const normalizedProxy = proxyCheck?.ok ? proxyCheck.value : undefined;

      // ── Fansly: auth-token paste ──────────────────────────────────────
      if (usingFanslyToken) {
        const result = await api.loginFanslyToken({
          auth_token: fanslyAuthToken.trim(),
          fansly_session_id: fanslySessionId.trim(),
          fansly_client_id: fanslyClientId.trim() || undefined,
          proxy: normalizedProxy,
        });
        if (!result.success) {
          failAdd(result.error || "Failed to connect Fansly account");
          return;
        }
        await refreshAccounts();
        resetAddForm();
        onAddClose();
        return;
      }

      // ── OnlyFans + Fansly password login ──────────────────────────────
      const result = await api.loginAccount(email.trim(), password, {
        proxy: normalizedProxy,
        use_captcha: true,
        platform,
      });
      if (result.requires_2fa) {
        // The backend already added the account row flagged needs_verification,
        // so whichever step we show, closing the modal still leaves a
        // "Confirm 2FA" / "Verify face" affordance on the row to resume.
        if (result.face_required || result.reason === "face_id_required") {
          // Forced-face (id2): no typed code can clear it. Switch the add modal
          // to its face step — the selfie link + live status — instead of a
          // dead OTP box.
          void refreshAccounts();
          setFaceOfUserId(String(result.of_user_id ?? ""));
          setFaceUrl(null);
          setFaceStatus("required");
          setFaceStep(true);
          return;
        }

        // Code factor(s) — the inline OTP step.
        setOtp2faMethods(result.otp_methods ?? []);
        setOtpStep(true);
        setOtpEmail(result.email || email);
        setOtpCode("");
        return;
      }
      // Fansly accounts can come back needing email verification — surface the
      // backend's guidance instead of treating it as a hard failure.
      if (result.success === false) {
        if (result.requires_verification) {
          setAddNotice(
            result.error ||
              "This Fansly account needs email verification. Connect with an auth token instead."
          );
        } else {
          failAdd(result.error || "Failed to add account");
        }
        return;
      }
      await refreshAccounts();
      resetAddForm();
      onAddClose();
    } catch (err: any) {
      failAdd(err.message || "Failed to add account", err?.data?.suggestion);
    } finally {
      setAddLoading(false);
      setConnectStartedAt(null);
    }
  };

  // Kick off the id2 selfie for the account being added, and open OnlyFans'
  // verification page. The check itself is watched server-side; the effect
  // below polls its status and closes the modal on success.
  const startFaceInAdd = async () => {
    if (!api || !faceOfUserId) return;
    setFaceStarting(true);
    setAddError("");
    try {
      const res = await api.startFaceId(faceOfUserId, "regular");
      setFaceUrl(res.verify_url);
      if (res.status?.status) setFaceStatus(res.status.status);
      window.open(res.verify_url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      failAdd(err?.message || "Could not start face verification.");
    } finally {
      setFaceStarting(false);
    }
  };

  // While the add modal sits on its face step, poll the server-side watcher.
  // A 200 from OnlyFans (gate lifted) flips status to "approved" — then we
  // refresh and close. Runs only while faceStep is open.
  useEffect(() => {
    if (!faceStep || !faceOfUserId || !api) return;
    let active = true;
    const tick = async () => {
      try {
        const s = await api.getFaceIdStatus(faceOfUserId);
        if (!active) return;
        setFaceStatus(s.status);
        if (s.status === "approved") {
          toast.success("Account verified and connected");
          await refreshAccounts();
          resetAddForm();
          onAddClose();
        }
      } catch {
        // transient — the next tick recovers
      }
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceStep, faceOfUserId, api]);

  const handleVerifyOtp = async () => {
    if (!api || !otpCode || !otpEmail) return;
    setAddError("");
    setAddLoading(true);

    try {
      await api.verifyOtp(otpEmail, otpCode, platform);
      await refreshAccounts();
      resetAddForm();
      onAddClose();
    } catch (err: any) {
      // A blocked proxy killed the parked challenge server-side; back to the
      // form so the proxy can be changed before starting over.
      if (err?.data?.reason === "proxy_blocked") setOtpStep(false);
      failAdd(err.message || "Failed to verify OTP code", err?.data?.suggestion);
    } finally {
      setAddLoading(false);
    }
  };

  const handleAddClose = () => {
    setAddError("");
    resetAddForm();
    onAddClose();
  };

  const [pollingInfo, setPollingInfo] = useState<any | null>(null);
  const [pollingInterval, setPollingInterval] = useState<string>("300");
  // Backend-emitted caveat from PATCH /polling — e.g. "Fansly polling is
  // disabled server-side". Previously discarded, which left the switch
  // claiming a poller that never runs.
  const [pollingWarning, setPollingWarning] = useState<string>("");

  const openManage = async (account: any) => {
    setManageAccount(account);
    setEditProxy(account.proxy || "");
    setEditPrice("");
    setManageError("");
    setManageSuccess("");
    setPollingInfo(null);
    setPollingWarning("");
    onManageOpen();
    if (api) {
      try {
        const res = await api.getAccountPolling(account.of_user_id);
        setPollingInfo(res.polling);
        setPollingInterval(String(res.polling?.polling_interval_seconds || 120));
      } catch {
        // ignore — account just created might not have row yet
      }
    }
  };

  const openReconnect = (account: OfAccount) => {
    setPlatform(account.platform || "onlyfans");
    setEmail(account.email || "");
    setPassword("");
    setProxy(account.proxy || "");
    failAdd("");
    setAddNotice("");
    setAddAttempted(false);
    setTouched({ email: false, password: false, proxy: false });
    setProxyResult(null);
    setOtpStep(false);
    setFaceStep(false);
    onAddOpen();
  };

  const handleUpdatePolling = async (patch: {
    enabled?: boolean;
    interval_seconds?: number;
    allow_of_write_actions?: boolean;
  }) => {
    if (!api || !manageAccount) return;
    setManageLoading(true);
    setManageError("");
    setManageSuccess("");
    try {
      const patched = await api.updateAccountPolling(
        manageAccount.of_user_id,
        patch,
      );
      const res = await api.getAccountPolling(manageAccount.of_user_id);
      setPollingInfo(res.polling);
      // Surface the backend's caveat rather than dropping it on the floor.
      setPollingWarning(patched?.warning || "");
      setManageSuccess("Polling settings updated");
      // The row's status indicator reads polling_enabled / last_polled_at off
      // the list response, so it has to be re-read after a toggle.
      refreshAccounts();
    } catch (err: any) {
      setManageError(err?.message || "Failed to update polling");
    } finally {
      setManageLoading(false);
    }
  };

  const handleUpdateProxy = async () => {
    if (!api || !manageAccount) return;
    setManageLoading(true);
    setManageError("");
    setManageSuccess("");
    try {
      await api.updateProxy(
        manageAccount.of_user_id,
        editProxy || null
      );
      await refreshAccounts();
      setManageSuccess("Proxy updated successfully");
    } catch (err: any) {
      setManageError(err.message || "Failed to update proxy");
    } finally {
      setManageLoading(false);
    }
  };

  const handleUpdatePrice = async () => {
    if (!api || !manageAccount || !editPrice) return;
    setManageLoading(true);
    setManageError("");
    setManageSuccess("");
    try {
      await api.updateSubscriptionPrice(
        manageAccount.of_user_id,
        parseFloat(editPrice)
      );
      setManageSuccess("Subscription price updated successfully");
    } catch (err: any) {
      // WRITES_DISABLED is handled globally (WritesDisabledWatcher shows a
      // one-click enable toast) — don't also print the raw 403 inline.
      if (err?.data?.code === "WRITES_DISABLED") return;
      if (isPlatformNotSupported(err)) {
        setManageError(platformUnsupportedMessage(err.data?.feature, err.data?.platform));
      } else {
        setManageError(err.message || "Failed to update price");
      }
    } finally {
      setManageLoading(false);
    }
  };

  if (loading && !isTourActive) {
    return (
      <div className="flex items-center justify-center h-64">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <PixelSpinner />
          <p className="text-sm text-muted-foreground">Loading accounts...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="heading-2">Connected Accounts</h2>
          <p className="text-sm text-default-500 mt-1">
            Manage your connected accounts
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk import lives here rather than in the sidebar: it is an action
              you take ON your accounts, and it belongs next to the single-account
              equivalent so the choice between "one" and "many" is visible at the
              moment you make it. The route is still deep-linkable. */}
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              as={Link}
              href="/dashboard/import"
              variant="bordered"
              className="border-white/[0.14] text-default-300 hover:text-white hover:border-white/30 rounded-none uppercase tracking-wider font-bold"
              startContent={<PxUsers className="h-4 w-4" />}
            >
              Bulk import
              {pending2faCount > 0 && (
                <span
                  className="ml-2 inline-flex h-5 min-w-5 items-center justify-center
                             px-1.5 text-[0.6875rem] font-bold leading-none
                             bg-amber-500/15 text-amber-300 border border-amber-500/30"
                  title={`${pending2faCount} login${pending2faCount === 1 ? "" : "s"} waiting for a 2FA code`}
                >
                  {pending2faCount}
                </span>
              )}
            </Button>
          </motion.div>
          {accounts.length > 0 && (
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                variant="bordered"
                className="border-white/[0.14] text-default-300 hover:text-white hover:border-white/30 rounded-none uppercase tracking-wider font-bold"
                startContent={<PxRefresh className="h-4 w-4" />}
                onPress={handleEnableAllPolling}
                isLoading={enableAllLoading}
                title="Turn background polling on for every supported account so they fetch new data automatically"
              >
                Enable polling for all
              </Button>
            </motion.div>
          )}
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} data-tour="accounts-add">
            <Button
              className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold"
              startContent={<PxPlus className="h-4 w-4" />}
              onPress={tryOpenAddAccount}
            >
              Add Account
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* Search + tag filter. Hidden only when the panel has no accounts at
          all — once there are rows the controls stay put, so a filter that
          matches nothing can still be cleared. */}
      {(realAccounts.length > 0 || isTourActive) && (
        <DataTableToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder='Search username or email (press "/")'
          showClear={!!(search || tagFilter)}
          onClear={clearFilters}
          className="justify-start"
        >
          {allTags.length > 0 && (
            <Select
              size="sm"
              placeholder="Any tag"
              selectedKeys={tagFilter ? new Set([tagFilter]) : new Set()}
              onSelectionChange={(k) => {
                const v = Array.from(k as Set<string>)[0];
                setTagFilter(v || "");
              }}
              variant="bordered"
              radius="none"
              className="max-w-[180px]"
              aria-label="Filter by tag"
            >
              {allTags.map((t) => (
                <SelectItem key={t}>{t}</SelectItem>
              ))}
            </Select>
          )}
          {filtersActive && (
            <span className="text-xs text-default-500">
              {filtering
                ? "Filtering…"
                : `${accounts.length} of ${realAccounts.length}`}
            </span>
          )}
        </DataTableToolbar>
      )}

      {/* Two failure sources feed one gate: the provider's GET /accounts and,
          when a filter is active, this page's own filtered GET. Either one
          failing must show the failure, never "No accounts yet". */}
      <DataState
        loading={isTourActive ? false : filtersActive ? filtering : loading}
        error={
          isTourActive
            ? null
            : filtersActive
              ? filterError
              : loaded
                ? null
                : accountsError
        }
        isEmpty={accounts.length === 0}
        onRetry={filtersActive ? clearFilters : refreshAccounts}
        noun="accounts"
        icon={
          filtersActive ? (
            <PxSearch className="h-8 w-8" />
          ) : (
            <PxMail className="h-8 w-8" />
          )
        }
        title={filtersActive ? "No accounts match" : "No accounts yet"}
        description={
          filtersActive
            ? "No connected account matches this search and tag combination."
            : "Connect an OnlyFans or Fansly account to start managing it from the dashboard."
        }
        actionLabel={filtersActive ? "Clear filters" : "Add Account"}
        onAction={filtersActive ? clearFilters : tryOpenAddAccount}
      >
        <GlassCard animate={false} pattern="grid">
          {/* Adding TAGS pushes the row past a 1440px viewport by ~130px.
              HeroUI's own `wrapper` slot is already overflow-x:auto, so the
              ACTIONS column stays reachable by scrolling the table inside its
              card (the same behaviour as the Fans table); `styled-scrollbar`
              just makes that scrollbar match the dashboard. */}
          <Table
            aria-label="Accounts table"
            className="min-h-[200px]"
            classNames={{ wrapper: "styled-scrollbar" }}
            data-tour="accounts-list"
          >
            <TableHeader>
              <TableColumn>USERNAME</TableColumn>
              <TableColumn>EMAIL</TableColumn>
              <TableColumn>TAGS</TableColumn>
              <TableColumn>PROXY</TableColumn>
              <TableColumn>
                <Tooltip
                  content="The last time this account was connected or reconnected on the platform — not the creator's own OnlyFans login, and not affected by background polling."
                  placement="top"
                  delay={300}
                  classNames={{ content: "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs max-w-[240px]" }}
                >
                  <span className="cursor-help border-b border-dotted border-white/20">LAST CONNECTED</span>
                </Tooltip>
              </TableColumn>
              <TableColumn>STATUS</TableColumn>
              <TableColumn>ACTIONS</TableColumn>
            </TableHeader>
            <TableBody>
              {accounts.map((account, index) => (
                <TableRow 
                  key={account.of_user_id}
                  className={cn(
                    "transition-colors hover:bg-accent/5",
                    index !== accounts.length - 1 && "border-b border-white/[0.04]"
                  )}
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/accounts/${account.of_user_id}`}
                      className="inline-flex items-center gap-2.5 hover:underline hover:text-[color:var(--theme-accent,#f54900)]"
                    >
                      <Avatar
                        src={account.avatar || undefined}
                        name={account.username || account.email}
                        size="sm"
                        radius="full"
                        className="flex-shrink-0 w-7 h-7 text-tiny"
                      />
                      <span>{account.username || "—"}</span>
                      <PlatformBadge platform={account.platform} />
                      {account.profile_country_code && (
                        <span
                          className="text-sm leading-none"
                          title={`${account.profile_country || account.profile_country_code} · OnlyFans banking country`}
                        >
                          {countryCodeToFlag(account.profile_country_code)}
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell>{account.email}</TableCell>
                  {/* Capped so a heavily-tagged account wraps its chips
                      instead of stretching the row for every other account. */}
                  <TableCell className="max-w-[160px]">
                    <AccountTagEditor
                      ofUserId={String(account.of_user_id)}
                      tags={account.tags || []}
                      onChange={(next) =>
                        setAccountTags(String(account.of_user_id), next)
                      }
                      disabled={isTourActive}
                      compact
                    />
                  </TableCell>
                  <TableCell>
                    <ProxyCell account={account} />
                  </TableCell>
                  <TableCell className="text-default-500">
                    {account.last_login
                      ? new Date(account.last_login).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {account.connection_state === "login_failed" || account.needs_reconnect ? (
                        <div className="flex max-w-[250px] flex-col items-start gap-1">
                          <Chip
                            size="sm"
                            variant="flat"
                            color="danger"
                            className="bg-red-500/10 text-red-400 rounded-none"
                            title={account.login_failure?.message || account.relogin_block_reason || "OnlyFans rejected the saved login details."}
                          >
                            Login failed
                          </Chip>
                          <p className="text-[11px] leading-4 text-red-300">
                            {account.login_failure?.message ||
                              account.relogin_block_reason ||
                              "OnlyFans rejected the saved login details."}
                          </p>
                          {(!account.login_failure || account.login_failure.action === "reconnect") && (
                            <button
                              type="button"
                              onClick={() => openReconnect(account)}
                              className="text-[11px] font-semibold text-[color:var(--theme-accent,#f54900)] underline underline-offset-2"
                            >
                              Reconnect account
                            </button>
                          )}
                          {account.login_failure?.action === "contact_support" && (
                            <a
                              href="https://github.com/XceleratorCRM/onlyfans-api/issues"
                              className="text-[11px] font-semibold text-[color:var(--theme-accent,#f54900)] underline underline-offset-2"
                            >
                              Contact support
                            </a>
                          )}
                          {account.login_failure?.action === "remove_account" && (
                            <span className="text-[11px] text-default-400">
                              Remove this account from Actions if it was permanently deleted.
                            </span>
                          )}
                        </div>
                      ) : account.needs_verification || account.connection_state === "verification_required" ? (
                        /* Not "Connected" and not "Reconnect needed": the
                           credentials are fine, OnlyFans wants a second factor.
                           A face-only gate opens the selfie flow; anything with
                           a code factor opens the 2FA confirm modal. */
                        <button
                          type="button"
                          onClick={() =>
                            account.verification?.face_required
                              ? setVerifyAccount(account)
                              : setTwoFaAccount(account)
                          }
                          className="inline-flex w-fit items-center gap-1.5 rounded-none border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
                          title={account.verification?.reason || "OnlyFans requires 2FA confirmation"}
                        >
                          {account.verification?.face_required ? "Verify face" : "Confirm 2FA"}
                        </button>
                      ) : account.connection_state && account.connection_state !== "connected" ? (
                        <div className="flex max-w-[250px] flex-col items-start gap-1">
                          <Chip
                            size="sm"
                            variant="flat"
                            color={account.connection_state === "rate_limited" || account.connection_state === "temporary_error" ? "warning" : "danger"}
                            className="rounded-none"
                            title={account.connection_error?.message}
                          >
                            {account.connection_state === "proxy_error"
                              ? "Proxy error"
                              : account.connection_state === "rate_limited"
                                ? "Rate limited"
                                : account.connection_state === "sync_blocked"
                                  ? "Sync blocked"
                                  : account.connection_state === "temporary_error"
                                    ? "Temporary error"
                                    : "Not connected"}
                          </Chip>
                          {account.connection_error?.message && (
                            <p className="text-[11px] leading-4 text-default-400">
                              {account.connection_error.message}
                            </p>
                          )}
                        </div>
                      ) : (
                        <Chip
                          size="sm"
                          variant="flat"
                          color="success"
                          className="bg-green-500/10 text-green-400 rounded-none"
                        >
                          Connected
                        </Chip>
                      )}
                      {/* Polling state per row — derived entirely from fields
                          already on this list response (no per-account call),
                          and gated on capabilities.polling so a Fansly account
                          can never show as live while the server-side poller
                          is off. See components/dashboard/AccountStatus.tsx. */}
                      <AccountStatusLine account={account} />
                    </div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const uid = String(account.of_user_id);
                      const subsJob = refreshJobs.get(uid, "subs");
                      const txJob = refreshJobs.get(uid, "tx");
                      const subsBusy = !!subsJob && subsJob.phase !== "complete";
                      const txBusy = !!txJob && txJob.phase !== "complete";
                      return (
                        <div className="flex flex-col gap-1.5 min-w-[320px]">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="bordered"
                              as={Link}
                              href={`/dashboard/accounts/${account.of_user_id}`}
                              className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                            >
                              View
                            </Button>
                            {/* Ledger refresh follows the backend-emitted
                                transactions_refresh capability — hidden for
                                fansly until its wallet-tx sync lands, then it
                                appears without a frontend change. */}
                            {accountSupports(account, "transactions_refresh") && (
                              <Button
                                size="sm"
                                variant="bordered"
                                isDisabled={txBusy}
                                isLoading={txBusy}
                                startContent={!txBusy ? <PxRefresh className="h-3 w-3" /> : undefined}
                                onPress={() => handleRefreshSpending(account)}
                                title="Refresh transaction ledger now (delta walk, cheap; also runs on its configured schedule)"
                                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                              >
                                Refresh spending
                              </Button>
                            )}
                            {/* Both platforms enumerate subscribers now (Fansly
                                via GET /api/v1/subscribers); the gate only hides
                                the button on stale capability payloads. */}
                            {accountSupports(account, "subscribers") && (
                              <Button
                                size="sm"
                                variant="bordered"
                                isDisabled={subsBusy}
                                isLoading={subsBusy}
                                startContent={!subsBusy ? <PxRefresh className="h-3 w-3" /> : undefined}
                                onPress={() => handleRefreshSubscribers(account)}
                                title="Refresh full subscriber list now (heavy walk on large accounts; also runs on its configured schedule)"
                                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                              >
                                Refresh subs
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="bordered"
                              startContent={<PxSettings className="h-3 w-3" />}
                              onPress={() => openManage(account)}
                              className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                            >
                              Manage
                            </Button>
                          </div>
                          {/* Progress bars live directly below the button row.
                              Each renders null when its job state is null, so the
                              row only grows when a refresh is in flight. */}
                          <RefreshProgressBar
                            state={txJob}
                            label="Spending"
                            compact
                            onFixProxy={() =>
                              openProxyFix(account, txJob?.error, () =>
                                handleRefreshSpending(account),
                              )
                            }
                          />
                          <RefreshProgressBar
                            state={subsJob}
                            label="Subscribers"
                            compact
                            onFixProxy={() =>
                              openProxyFix(account, subsJob?.error, () =>
                                handleRefreshSubscribers(account),
                              )
                            }
                          />
                        </div>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </GlassCard>
      </DataState>

      {/* Add Account Modal */}
      <Modal isOpen={isAddOpen} onClose={handleAddClose} placement="center">
        <ModalContent>
          <ModalHeader>
            {faceStep
              ? "Verify Face"
              : otpStep
                ? "Enter Verification Code"
                : "Add Account"}
          </ModalHeader>
          <ModalBody>
            {addError && (
              <div className="dashboard-error">
                {addError}
                {addSuggestion && (
                  <p className="mt-1.5 text-[13px] text-white/70">
                    <span className="font-medium text-white/90">Suggestion:</span> {addSuggestion}
                  </p>
                )}
              </div>
            )}
            {connectStartedAt !== null && !otpStep && !faceStep && (
              <div
                className="flex items-center gap-2 border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[13px] text-white/80"
                role="status"
                aria-live="polite"
              >
                <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border border-current border-t-transparent" />
                <span>
                  {connectElapsed < 60
                    ? `Signing in to ${platform === "fansly" ? "Fansly" : "OnlyFans"} through your proxy… ${connectElapsed}s. This usually takes 10–40 seconds — keep this window open.`
                    : `Still working (${connectElapsed}s) — the platform is slow to answer. You can keep waiting.`}
                </span>
              </div>
            )}
            {addNotice && !addError && (
              <div className="text-[13px] border border-amber-500/30 bg-amber-500/[0.06] text-amber-300 px-3 py-2">
                {addNotice}
              </div>
            )}
            {faceStep ? (
              <>
                <p className="text-sm text-default-500">
                  OnlyFans requires a <span className="text-amber-300">face verification</span>{" "}
                  for this account (common on higher-tier models). No code can
                  clear it — someone has to pass a short selfie check on
                  OnlyFans&apos; identity provider.
                </p>
                <div className="border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-[13px] leading-relaxed text-amber-200/90">
                  <span className="font-medium">
                    Open the link from this account&apos;s own IP.
                  </span>{" "}
                  OnlyFans checks that the browser doing the selfie is on the
                  same address as the session. A different connection fails the
                  check and spends one of three attempts.
                </div>

                {faceUrl && (
                  <div className="border border-white/[0.08] bg-white/[0.02] px-3 py-2">
                    <div className="mb-1 text-xs uppercase tracking-wider text-default-400">
                      Verification link
                    </div>
                    <code className="block break-all text-xs text-default-300">
                      {faceUrl}
                    </code>
                  </div>
                )}

                <div className="text-[13px] text-default-400">
                  {faceStatus === "pending" || faceStatus === "required"
                    ? faceUrl
                      ? "Waiting for OnlyFans to lift the check — this stays open. Complete the selfie in the tab that opened."
                      : "Click below to start; the OnlyFans verification page opens in a new tab."
                    : faceStatus === "approved"
                      ? "Verified — connecting…"
                      : `Status: ${faceStatus}. Start it again when ready.`}
                </div>
              </>
            ) : otpStep ? (
              <>
                <p className="text-sm text-default-500">
                  {otp2faMethods.includes("app") && !otp2faMethods.includes("email")
                    ? "Enter the current 6-digit code from this account's authenticator app."
                    : otp2faMethods.includes("email") || otp2faMethods.includes("sms")
                      ? "OnlyFans sent a verification code to the account. Enter it below."
                      : "Enter the 6-digit verification code for this account."}
                </p>
                <Input
                  label="OTP Code"
                  type="text"
                  value={otpCode}
                  onValueChange={setOtpCode}
                  startContent={<PxLock className="h-4 w-4 text-default-400" />}
                  isRequired
                  autoFocus
                  placeholder="Enter 6-digit code"
                  variant="bordered"
                  classNames={{
                    inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                  }}
                />
              </>
            ) : (
              <>
                {/* Platform selector */}
                <div>
                  <label className="text-xs text-default-500 mb-1.5 block">
                    Platform
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["onlyfans", "fansly"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setPlatform(p);
                          setAddError("");
                          setAddNotice("");
                        }}
                        className={cn(
                          "border px-3 py-2 text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2",
                          platform === p
                            ? "border-accent bg-accent/10 text-white"
                            : "border-white/[0.08] text-default-400 hover:border-white/[0.2]"
                        )}
                      >
                        <PlatformBadge platform={p} />
                        {p === "onlyfans" ? "OnlyFans" : "Fansly"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fansly connect-method toggle */}
                {platform === "fansly" && (
                  <div>
                    <label className="text-xs text-default-500 mb-1.5 block">
                      Connect with
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["password", "Email & Password"],
                        ["token", "Auth Token"],
                      ] as const).map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setFanslyMethod(m);
                            setAddError("");
                            setAddNotice("");
                          }}
                          className={cn(
                            "border px-3 py-2 text-xs uppercase tracking-wider transition-colors",
                            fanslyMethod === m
                              ? "border-accent bg-accent/10 text-white"
                              : "border-white/[0.08] text-default-400 hover:border-white/[0.2]"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {platform === "fansly" && fanslyMethod === "token" ? (
                  <>
                    <Input
                      label="Auth Token"
                      type="text"
                      value={fanslyAuthToken}
                      onValueChange={setFanslyAuthToken}
                      startContent={<PxLock className="h-4 w-4 text-default-400" />}
                      endContent={
                        <FieldActionButton
                          icon={<PxCopy className="h-3 w-3" />}
                          onPress={() => pasteInto(setFanslyAuthToken)}
                          title="Paste from clipboard"
                        />
                      }
                      isRequired
                      variant="bordered"
                      placeholder="authorization header value"
                      classNames={{
                        inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                      }}
                    />
                    <Input
                      label="Session ID"
                      type="text"
                      value={fanslySessionId}
                      onValueChange={setFanslySessionId}
                      startContent={<PxLock className="h-4 w-4 text-default-400" />}
                      endContent={
                        <FieldActionButton
                          icon={<PxCopy className="h-3 w-3" />}
                          onPress={() => pasteInto(setFanslySessionId)}
                          title="Paste from clipboard"
                        />
                      }
                      isRequired
                      variant="bordered"
                      placeholder="fansly-session-id header value"
                      classNames={{
                        inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                      }}
                    />
                    <Input
                      label="Client ID (optional)"
                      type="text"
                      value={fanslyClientId}
                      onValueChange={setFanslyClientId}
                      startContent={<PxGlobe className="h-4 w-4 text-default-400" />}
                      endContent={
                        <FieldActionButton
                          icon={<PxCopy className="h-3 w-3" />}
                          onPress={() => pasteInto(setFanslyClientId)}
                          title="Paste from clipboard"
                        />
                      }
                      variant="bordered"
                      placeholder="fansly-client-id header value"
                      classNames={{
                        inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                      }}
                    />
                    <p className="text-[11px] text-default-500 leading-relaxed">
                      On fansly.com (logged in), open DevTools → Network → pick any
                      request to apiv3.fansly.com and copy the{" "}
                      <code className="text-default-400">authorization</code>,{" "}
                      <code className="text-default-400">fansly-session-id</code> and{" "}
                      <code className="text-default-400">fansly-client-id</code>{" "}
                      request headers.
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      label={platform === "fansly" ? "Username or Email" : "Email"}
                      type={platform === "fansly" ? "text" : "email"}
                      value={email}
                      onValueChange={(v) => { setEmail(v); editedAddField(); }}
                      onBlur={() => touch("email")}
                      startContent={<PxMail className="h-4 w-4 text-default-400" />}
                      endContent={
                        <FieldActionButton
                          icon={<PxCopy className="h-3 w-3" />}
                          onPress={() => pasteInto((v) => { setEmail(v.trim()); touch("email"); editedAddField(); })}
                          title="Paste from clipboard"
                        />
                      }
                      isRequired
                      validationBehavior="aria"
                      isInvalid={showFieldError("email") && !!emailError}
                      errorMessage={emailError}
                      variant="bordered"
                      classNames={{
                        inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                      }}
                    />
                    <Input
                      label="Password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onValueChange={(v) => { setPassword(v); editedAddField(); }}
                      onBlur={() => touch("password")}
                      startContent={<PxLock className="h-4 w-4 text-default-400" />}
                      endContent={
                        <div className="flex items-center gap-1">
                          <FieldActionButton
                            icon={<PxCopy className="h-3 w-3" />}
                            onPress={() => pasteInto((v) => { setPassword(v); touch("password"); editedAddField(); })}
                            title="Paste from clipboard"
                          />
                          <FieldActionButton
                            icon={<PxEye className="h-3 w-3" />}
                            onPress={() => setShowPassword((s) => !s)}
                            title={showPassword ? "Hide password" : "Show password"}
                            active={showPassword}
                          />
                        </div>
                      }
                      isRequired
                      validationBehavior="aria"
                      isInvalid={showFieldError("password") && !!passwordError}
                      errorMessage={passwordError}
                      variant="bordered"
                      classNames={{
                        inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                      }}
                    />
                  </>
                )}
                <div className="space-y-1.5">
                  <Input
                    label="Proxy"
                    type="text"
                    value={proxy}
                    onValueChange={(v) => { setProxy(v); editedAddField(); }}
                    onBlur={() => { touch("proxy"); autoTestProxy(proxy); }}
                    onPaste={(e) => {
                      // Auto-test when the user pastes — works for both
                      // Cmd-V and right-click → Paste. We pre-empt the
                      // default so the pasted text replaces the field instead
                      // of being spliced into whatever was there.
                      const t = e.clipboardData?.getData("text") ?? "";
                      if (!t.trim()) return;
                      e.preventDefault();
                      setProxy(t.trim());
                      touch("proxy");
                      editedAddField();
                      autoTestProxy(t);
                    }}
                    startContent={<PxGlobe className="h-4 w-4 text-default-400" />}
                    endContent={
                      <FieldActionButton
                        icon={<PxCopy className="h-3 w-3" />}
                        onPress={pasteProxy}
                        title="Paste & auto-test"
                      />
                    }
                    placeholder="http://user:pass@host:port"
                    isRequired={platform === "onlyfans"}
                    validationBehavior="aria"
                    isInvalid={showFieldError("proxy") && !!proxyError}
                    errorMessage={proxyError}
                    variant="bordered"
                    classNames={{
                      inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                    }}
                  />
                  {proxyCheck?.ok && (
                    <div className="text-[11px] font-mono text-default-400 break-all">
                      <span className="text-green-400">✓ Format OK</span> · will connect through{" "}
                      <span className="text-default-300">{proxyCheck.masked}</span>
                      {proxyCheck.fixes.length > 0 && (
                        <span className="block font-sans text-default-500">
                          Auto-fixed: {proxyCheck.fixes.join(", ")}.
                        </span>
                      )}
                      {proxyCheck.noAuth && (
                        <span className="block font-sans text-amber-300">
                          No username/password — this only works if the proxy allows our server&apos;s IP.
                        </span>
                      )}
                    </div>
                  )}
                  <ProxyFormatHint />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-[color:var(--theme-accent,#f54900)] flex-1">
                      {platform === "fansly"
                        ? "Optional — use one matching the account's usual country for safety."
                        : "Required — OnlyFans blocks logins without a proxy. Use one matching the account's usual country."}
                    </span>
                    <button
                      type="button"
                      disabled={!proxyCheck?.ok || proxyTesting}
                      onClick={handleTestProxy}
                      className="shrink-0 border border-white/[0.08] hover:border-white/[0.2] disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors flex items-center gap-1.5"
                    >
                      {proxyTesting ? (
                        <span className="inline-block h-2.5 w-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                      ) : null}
                      <span>{proxyTesting ? "Testing…" : "Test proxy"}</span>
                    </button>
                  </div>
                  {currentProxyResult && (
                    <div
                      className={cn(
                        "text-[11px] font-mono px-2 py-1.5 border",
                        !currentProxyResult.ok
                          ? "text-red-400 border-red-500/30 bg-red-500/[0.04]"
                          : currentProxyResult.ofBlocked
                            ? "text-amber-300 border-amber-500/30 bg-amber-500/[0.06]"
                            : "text-green-400 border-green-500/30 bg-green-500/[0.04]",
                      )}
                    >
                      {currentProxyResult.ok ? (
                        <div className="space-y-0.5">
                          <div>
                            ✓ Proxy works
                            {currentProxyResult.ip ? ` · IP ${currentProxyResult.ip}` : ""}
                            {typeof currentProxyResult.latency_ms === "number"
                              ? ` · ${currentProxyResult.latency_ms}ms`
                              : ""}
                          </div>
                          {currentProxyResult.geo && (currentProxyResult.geo.country || currentProxyResult.geo.city || currentProxyResult.geo.isp) && (
                            <div className="text-default-500 normal-case">
                              {[
                                currentProxyResult.geo.city,
                                currentProxyResult.geo.region,
                                currentProxyResult.geo.country,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                              {currentProxyResult.geo.isp ? ` · ${currentProxyResult.geo.isp}` : ""}
                            </div>
                          )}
                          {currentProxyResult.ofBlocked && (
                            <div className="normal-case font-sans pt-0.5">
                              ⚠ {currentProxyResult.ofWarning ||
                                "OnlyFans is blocking logins from this proxy's IP — a connection through it will fail. Use a different proxy."}
                            </div>
                          )}
                        </div>
                      ) : (
                        <>✗ {currentProxyResult.error}</>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={handleAddClose}>
              Cancel
            </Button>
            <Button
              className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold"
              isLoading={addLoading || faceStarting}
              isDisabled={faceStep && faceStatus === "approved"}
              onPress={
                faceStep
                  ? startFaceInAdd
                  : otpStep
                    ? handleVerifyOtp
                    : handleAddAccount
              }
            >
              {faceStep
                ? faceUrl
                  ? "Reopen check"
                  : "Start verification"
                : otpStep
                  ? "Verify Code"
                  : "Connect Account"}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Manage Account Modal */}
      <Modal isOpen={isManageOpen} onClose={onManageClose} placement="center" size="lg">
        <ModalContent>
          <ModalHeader>
            Manage Account — {manageAccount?.username || manageAccount?.email}
          </ModalHeader>
          <ModalBody className="space-y-4">
            {manageError && (
              <div className="dashboard-error">
                {manageError}
              </div>
            )}
            {manageSuccess && (
              <div className="dashboard-success">
                {manageSuccess}
              </div>
            )}

            {/* Proxy Section */}
            <GlassCard hover={false} animate={false} className="p-4" pattern="dots">
              <h4 className="text-sm font-semibold mb-3">Proxy Settings</h4>
              <div className="space-y-2">
                <Input
                  label="Proxy URL"
                  type="text"
                  value={editProxy}
                  onValueChange={setEditProxy}
                  startContent={
                    <PxGlobe className="h-4 w-4 text-default-400" />
                  }
                  placeholder="http://user:pass@host:port"
                  variant="bordered"
                  classNames={{
                    inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                  }}
                />
                <ProxyFormatHint />
                <Button
                  className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold self-end"
                  isLoading={manageLoading}
                  onPress={handleUpdateProxy}
                >
                  Update
                </Button>
              </div>
            </GlassCard>

            {/* Polling Section */}
            <GlassCard hover={false} animate={false} className="p-4" pattern="circuit">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <PxActivity className="h-4 w-4" />
                  Background polling
                </h4>
                <Switch
                  size="sm"
                  // Gated on the backend capability matrix: when the platform's
                  // poller is off deployment-wide (Fansly with
                  // FANSLY_POLLING_ENABLED=false, the shipped default), turning
                  // this on only schedules a job that no-ops. An ungated switch
                  // here is what put a green "Polling on" over empty feeds.
                  isDisabled={!accountSupports(manageAccount, "polling")}
                  isSelected={
                    !!pollingInfo?.polling_enabled &&
                    accountSupports(manageAccount, "polling")
                  }
                  onValueChange={(enabled) =>
                    handleUpdatePolling({ enabled, interval_seconds: Math.min(3600, Math.max(60, Number(pollingInterval) || 120)) })
                  }
                >
                  <span className="text-xs">
                    {!accountSupports(manageAccount, "polling")
                      ? "Unavailable"
                      : pollingInfo?.polling_enabled
                        ? "On"
                        : "Off"}
                  </span>
                </Switch>
              </div>
              {!accountSupports(manageAccount, "polling") && (
                <div className="text-[13px] border border-amber-500/30 bg-amber-500/[0.06] text-amber-300 px-3 py-2 mb-3">
                  Background polling is disabled server-side for{" "}
                  {platformLabel(manageAccount?.platform)} accounts, so no events
                  would arrive.
                  {!!pollingInfo?.polling_enabled && (
                    <> This account has it switched on, but nothing is polling it.</>
                  )}
                </div>
              )}
              {pollingWarning && (
                <div className="text-[13px] border border-amber-500/30 bg-amber-500/[0.06] text-amber-300 px-3 py-2 mb-3">
                  {pollingWarning}
                </div>
              )}
              <p className="text-xs text-default-500 mb-3">
                Watch this account for tips, new subscribers, purchases and messages.
                Events are pushed to webhooks and automations you&apos;ve set up.
              </p>
              <div className="flex gap-2 items-end">
                <Input
                  label="Interval (seconds)"
                  type="number"
                  min={60}
                  max={3600}
                  step={10}
                  value={pollingInterval}
                  onValueChange={setPollingInterval}
                  onBlur={() => {
                    const n = Number(pollingInterval);
                    if (!Number.isFinite(n) || n < 60) setPollingInterval("60");
                    else if (n > 3600) setPollingInterval("3600");
                  }}
                  variant="bordered"
                  className="flex-1"
                  classNames={{
                    inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                  }}
                />
                <Button
                  className="bg-accent text-white hover:bg-accent-hover rounded-none uppercase tracking-wider font-bold"
                  isLoading={manageLoading}
                  onPress={() =>
                    handleUpdatePolling({ interval_seconds: Math.min(3600, Math.max(60, Number(pollingInterval) || 120)) })
                  }
                >
                  Apply
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold">
                    Allow {platformLabel(manageAccount?.platform)} write actions
                  </p>
                  <p className="text-[11px] text-default-400">
                    Required for &apos;send DM&apos; automations. Leave off for read-only safety.
                  </p>
                </div>
                <Switch
                  size="sm"
                  isSelected={!!pollingInfo?.allow_of_write_actions}
                  onValueChange={(allow_of_write_actions) =>
                    handleUpdatePolling({ allow_of_write_actions })
                  }
                />
              </div>
              {pollingInfo?.last_polled_at && (
                <p className="text-[11px] text-default-400 mt-2">
                  Last polled: {parseUtc(pollingInfo.last_polled_at)?.toLocaleString() ?? "—"}
                  {pollingInfo.polling_failure_count > 0 &&
                    ` · ${pollingInfo.polling_failure_count} recent failures`}
                </p>
              )}
            </GlassCard>

            {/* Subscription Price Section — two capability gates:
                - subscription_price (read): no read surface → plain note.
                - subscription_price_update (write): readable but not updatable
                  (Fansly) → show the current price read-only with a clean note
                  instead of a form that would 501 on submit. */}
            {!accountSupports(manageAccount, "subscription_price") ? (
              <GlassCard hover={false} animate={false} className="p-4" pattern="waves">
                <h4 className="text-sm font-semibold mb-2">Subscription Price</h4>
                <p className="text-xs text-default-500">
                  Subscription price isn&apos;t available for{" "}
                  {platformLabel(manageAccount?.platform)} accounts yet.
                </p>
              </GlassCard>
            ) : !accountSupports(manageAccount, "subscription_price_update") ? (
              <GlassCard hover={false} animate={false} className="p-4" pattern="waves">
                <h4 className="text-sm font-semibold mb-2">Subscription Price</h4>
                <div className="flex items-baseline gap-2 mb-2">
                  {readOnlyPriceLoading ? (
                    <span className="text-xs text-default-500">Loading…</span>
                  ) : readOnlyPrice != null ? (
                    <>
                      <span className="text-lg font-semibold">
                        ${readOnlyPrice.toFixed(2)}
                      </span>
                      <span className="text-xs text-default-500">
                        {readOnlyPrice <= 0 ? "free page" : "/ 30 days (base tier)"}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-default-500">—</span>
                  )}
                </div>
                <p className="text-xs text-default-500">
                  Price updates aren&apos;t available for{" "}
                  {platformLabel(manageAccount?.platform)} accounts yet — change
                  it in {platformLabel(manageAccount?.platform)} directly.
                </p>
              </GlassCard>
            ) : (
            <GlassCard hover={false} animate={false} className="p-4" pattern="waves">
              <h4 className="text-sm font-semibold mb-3">Subscription Price</h4>
              <div className="flex gap-2">
                <Input
                  label="New Price ($)"
                  type="number"
                  value={editPrice}
                  onValueChange={setEditPrice}
                  startContent={
                    <PxDollarSign className="h-4 w-4 text-default-400" />
                  }
                  placeholder="9.99"
                  variant="bordered"
                  className="flex-1"
                  min={0}
                  step={0.01}
                  classNames={{
                    inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
                  }}
                />
                <Button
                  className="bg-accent text-white hover:bg-accent-hover dashboard-btn-primary rounded-none uppercase tracking-wider font-bold self-end"
                  isLoading={manageLoading}
                  onPress={handleUpdatePrice}
                >
                  Update
                </Button>
              </div>
            </GlassCard>
            )}
          </ModalBody>
          <ModalFooter className="flex justify-between">
            <Button
              variant="light"
              className="text-red-500 hover:text-red-400"
              onPress={async () => {
                if (!api || !manageAccount) return;
                if (
                  !(await confirm({
                    title: "Disconnect account?",
                    // Platform-neutral: the backend removes the stored session
                    // and unschedules background jobs for OnlyFans and Fansly alike.
                    body: "This removes the saved session and stops background polling for this account.",
                    confirmLabel: "Disconnect",
                    danger: true,
                  }))
                )
                  return;
                setManageLoading(true);
                try {
                  await api.deleteAccount(manageAccount.of_user_id);
                  toast.success("Account disconnected");
                  await refreshAccounts();
                  onManageClose();
                } catch (err: any) {
                  toast.error(err?.message || "Failed to disconnect account");
                } finally {
                  setManageLoading(false);
                }
              }}
              isLoading={manageLoading}
            >
              Disconnect Account
            </Button>
            <Button variant="light" onPress={onManageClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <FaceVerifyModal
        account={verifyAccount}
        api={api}
        onClose={() => setVerifyAccount(null)}
        onVerified={() => void refreshAccounts()}
      />

      <TwoFactorModal
        account={twoFaAccount}
        api={api}
        onClose={() => setTwoFaAccount(null)}
        onConfirmed={() => void refreshAccounts()}
        onUseFace={(acc) => {
          setTwoFaAccount(null);
          setVerifyAccount(acc);
        }}
      />
    </div>
  );
}
