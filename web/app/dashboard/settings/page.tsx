"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { motion } from "framer-motion";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import {
  PxUser,
  PxShield,
  PxUsers,
  PxEye,
  PxLock,
  PxCopy,
  PxCheck,
  PxGlobe,
  PxKey,
} from "@/components/ui/PixelIcons";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { platformLabel } from "@/lib/platform-capabilities";
import { useApiKey } from "@/lib/hooks/use-api-key";
import Link from "next/link";
import { ProfileCard } from "@/components/dashboard/ProfileCard";
import { AccountSecurityCard } from "@/components/dashboard/AccountSecurityCard";
import { DataState } from "@/components/dashboard/DataState";
import PlatformBadge from "@/components/dashboard/PlatformBadge";
import { TelegramIntegrationCard } from "@/components/dashboard/TelegramIntegrationCard";
import { CaptchaKeyCard } from "@/components/dashboard/CaptchaKeyCard";

export default function SettingsPage() {
  const { data: session } = useSession();
  // `error`/`loaded` come from the provider so "No accounts connected" is only
  // printed once a fetch has actually succeeded.
  const {
    accounts,
    loading: accountsLoading,
    error: accountsError,
    loaded,
    refreshAccounts,
  } = useAccounts();
  const { apiKey: liveApiKey } = useApiKey();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Credentials lock state
  const [credentialsUnlocked, setCredentialsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [lockTimer, setLockTimer] = useState(60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lockCredentials = useCallback(() => {
    setCredentialsUnlocked(false);
    setPassword("");
    setShowApiKey(false);
    setLockTimer(60);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const unlockCredentials = () => {
    if (!password.trim()) return;
    setCredentialsUnlocked(true);
    setPassword("");
    setLockTimer(60);
  };

  useEffect(() => {
    if (!credentialsUnlocked) return;
    timerRef.current = setInterval(() => {
      setLockTimer((prev) => {
        if (prev <= 1) {
          lockCredentials();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [credentialsUnlocked, lockCredentials]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const inputClassNames = {
    inputWrapper:
      "bg-white/[0.03] border-white/[0.08] !rounded-none",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="heading-2">Settings</h2>
        <p className="text-sm text-default-500 mt-1">
          Manage your CRM panel configuration
        </p>
      </div>

      {/* Profile (avatar + email change) — owned by the user, not tied to a CRM panel */}
      <ProfileCard />

      {/* Two-factor authentication + signed-in sessions */}
      <AccountSecurityCard />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6 xl:items-stretch items-start">
        {/* Left column: Panel Overview + API Credentials */}
        <div className="flex flex-col gap-6">
          {/* Section 1: Panel Overview */}
          <GlassCard delay={0}>
            <GlassCardHeader>
              <div className="flex items-center gap-3">
                <PxUser className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
                <h3 className="text-lg font-semibold">Panel Overview</h3>
              </div>
            </GlassCardHeader>
            <GlassCardBody>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8">
                <InfoRow label="Name" value={session?.user?.name || "—"} />
                <InfoRow label="Email" value={session?.user?.email || "—"} />
                <div className="flex items-center justify-between md:justify-start md:gap-4">
                  <span className="text-sm text-default-500 min-w-[100px]">
                    CRM ID
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-white/90">
                      {session?.user?.crmId || "—"}
                    </span>
                    {session?.user?.crmId && (
                      <CopyBtn
                        field="crmId-overview"
                        value={session.user.crmId}
                        copiedField={copiedField}
                        onCopy={copyToClipboard}
                      />
                    )}
                  </div>
                </div>
                <InfoRow
                  label="Plan"
                  value={
                    <Chip
                      size="sm"
                      variant="flat"
                      classNames={{
                        base: "border !rounded-none",
                        content: "font-semibold text-xs",
                      }}
                      style={{
                        backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)",
                        borderColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.2)",
                        color: "var(--theme-accent, #f54900)",
                      }}
                    >
                      {(session?.user as any)?.subscription?.planName || "Free"}
                    </Chip>
                  }
                />
                <InfoRow
                  label="Connected Accounts"
                  value={String(accounts.length)}
                />
              </div>
            </GlassCardBody>
          </GlassCard>

          {/* Section 2: API Credentials (password-gated) */}
          <GlassCard delay={0.1} className="flex-1 flex flex-col">
            <GlassCardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <PxShield className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
                  <h3 className="text-lg font-semibold">API Credentials</h3>
                </div>
                <Link
                  href="/dashboard/console"
                  className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--theme-accent,#f54900)] hover:underline"
                >
                  <PxKey className="h-3 w-3" />
                  Open Console →
                </Link>
              </div>
            </GlassCardHeader>
            <GlassCardBody className="flex-1">
              {!credentialsUnlocked ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-default-400">
                    <PxLock className="h-5 w-5" />
                    <span className="text-sm">
                      Enter your password to view API credentials
                    </span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      unlockCredentials();
                    }}
                    className="flex gap-2 max-w-lg"
                  >
                    <Input
                      type="password"
                      placeholder="Password"
                      value={password}
                      onValueChange={setPassword}
                      variant="bordered"
                      classNames={inputClassNames}
                      className="flex-1"
                    />
                    <Button
                      type="submit"
                      className="dashboard-btn-primary text-white font-bold uppercase tracking-wider !rounded-none"
                      isDisabled={!password.trim()}
                    >
                      Unlock
                    </Button>
                  </form>
                  <p className="text-xs text-default-400">
                    Convenience lock to prevent shoulder surfing
                  </p>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  {/* API Key */}
                  <div>
                    <label className="text-sm text-default-500 mb-1 block">
                      API Key
                    </label>
                    <div className="flex gap-2 max-w-lg">
                      <Input
                        value={liveApiKey || ""}
                        variant="bordered"
                        isReadOnly
                        classNames={inputClassNames}
                        className="font-mono flex-1"
                        type={showApiKey ? "text" : "password"}
                      />
                      <Button
                        isIconOnly
                        variant="bordered"
                        className="!rounded-none border-white/[0.08]"
                        onPress={() => setShowApiKey(!showApiKey)}
                      >
                        <PxEye
                          className={`h-4 w-4 ${showApiKey ? "text-[color:var(--theme-accent,#f54900)]" : ""}`}
                        />
                      </Button>
                      <CopyBtn
                        field="apiKey"
                        value={liveApiKey || ""}
                        copiedField={copiedField}
                        onCopy={copyToClipboard}
                        asButton
                      />
                    </div>
                  </div>

                  {/* CRM ID */}
                  <div>
                    <label className="text-sm text-default-500 mb-1 block">
                      CRM ID
                    </label>
                    <div className="flex gap-2 max-w-lg">
                      <Input
                        value={session?.user?.crmId || ""}
                        variant="bordered"
                        isReadOnly
                        classNames={inputClassNames}
                        className="font-mono flex-1"
                      />
                      <CopyBtn
                        field="crmId"
                        value={session?.user?.crmId || ""}
                        copiedField={copiedField}
                        onCopy={copyToClipboard}
                        asButton
                      />
                    </div>
                  </div>

                  {/* Curl example */}
                  <div>
                    <label className="text-sm text-default-500 mb-1 block">
                      Example Request
                    </label>
                    <div className="dashboard-code-block relative">
                      <pre className="text-xs font-mono overflow-x-auto whitespace-pre p-3">
                        {`curl -X GET ${window.location.origin}/api/crm/${session?.user?.crmId || "<crm_id>"}/accounts \\
  -H "X-API-Key: ${liveApiKey || "<api_key>"}"`}
                      </pre>
                    </div>
                  </div>

                  {/* Lock controls */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                    <span className="text-xs text-default-400">
                      Auto-lock in {lockTimer}s
                    </span>
                    <Button
                      size="sm"
                      variant="bordered"
                      className="!rounded-none border-white/[0.08]"
                      onPress={lockCredentials}
                      startContent={<PxLock className="h-3.5 w-3.5" />}
                    >
                      Lock
                    </Button>
                  </div>
                </motion.div>
              )}
            </GlassCardBody>
          </GlassCard>
        </div>

        {/* Right column: Connected Accounts */}
        <GlassCard delay={0.2} className="h-full flex flex-col">
          <GlassCardHeader>
            <div className="flex items-center gap-3">
              <PxUsers className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
              <h3 className="text-lg font-semibold">Connected Accounts</h3>
            </div>
          </GlassCardHeader>
          <GlassCardBody className="!p-0 flex-1 flex flex-col">
            <DataState
              compact
              loading={accountsLoading}
              error={loaded ? null : accountsError}
              isEmpty={accounts.length === 0}
              onRetry={refreshAccounts}
              noun="connected accounts"
              emptyContent={
                <div className="p-5 text-center space-y-3 flex-1 flex flex-col items-center justify-center">
                  <p className="text-sm text-default-400">
                    No accounts connected
                  </p>
                  <Link href="/dashboard/accounts">
                    <Button
                      variant="bordered"
                      size="sm"
                      className="!rounded-none border-white/[0.08]"
                    >
                      Add Account
                    </Button>
                  </Link>
                </div>
              }
            >
              <div className="flex-1 flex flex-col">
                {accounts.map((account, i) => (
                  <div
                    key={account.id}
                    className={`px-5 py-3 flex items-center justify-between ${
                      i < accounts.length - 1
                        ? "border-b border-white/[0.06]"
                        : ""
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-white truncate">
                        <PlatformBadge platform={account.platform} size={14} />
                        {account.username || "Unknown"}
                      </span>
                      <span className="text-xs text-default-400 truncate">
                        {account.email}
                      </span>
                      {account.needs_reconnect && (
                        <span
                          className="text-[11px] text-red-400"
                          title={
                            account.relogin_block_reason ||
                            `The saved session was rejected — reconnect this ${platformLabel(account.platform)} account from the Accounts page.`
                          }
                        >
                          Login failed —{" "}
                          {account.login_failure?.message ||
                            account.relogin_block_reason ||
                            `reconnect this ${platformLabel(account.platform)} account`}
                        </span>
                      )}
                      {!account.needs_reconnect && account.connection_state && account.connection_state !== "connected" && (
                        <span
                          className="text-[11px] text-amber-400"
                          title={account.connection_error?.message}
                        >
                          {account.connection_state === "verification_required"
                            ? "Verification required"
                            : account.connection_state === "proxy_error"
                              ? "Proxy error"
                              : account.connection_state === "rate_limited"
                                ? "Rate limited"
                                : account.connection_state === "sync_blocked"
                                  ? "Sync blocked"
                                  : account.connection_state === "temporary_error"
                                    ? "Temporary sync error"
                                    : "Connection issue"}
                          {account.connection_error?.message ? ` — ${account.connection_error.message}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <Chip
                        size="sm"
                        variant="flat"
                        startContent={
                          <PxGlobe className="h-3 w-3 ml-1" />
                        }
                        classNames={{
                          base: account.proxy
                            ? "bg-green-500/10 border border-green-500/20"
                            : "bg-white/[0.04] border border-white/[0.08]",
                          content: account.proxy
                            ? "text-green-400 text-xs"
                            : "text-default-400 text-xs",
                        }}
                      >
                        {account.proxy ? "Active" : "None"}
                      </Chip>
                    </div>
                  </div>
                ))}
                <div className="mt-auto px-5 py-3 border-t border-white/[0.06]">
                  <Link href="/dashboard/accounts">
                    <Button
                      variant="light"
                      size="sm"
                      className="!rounded-none text-[color:var(--theme-accent,#f54900)] px-0"
                    >
                      Manage Accounts →
                    </Button>
                  </Link>
                </div>
              </div>
            </DataState>
          </GlassCardBody>
        </GlassCard>
      </div>

      {/* This panel's own captcha provider key. Optional — without one,
          logins spend against the key configured on the server. */}
      <CaptchaKeyCard />

      {/* Panel-level notification channel — one Telegram chat for this panel,
          independent of any single connected account. */}
      <TelegramIntegrationCard delay={0.3} />
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between md:justify-start md:gap-4">
      <span className="text-sm text-default-500 min-w-[100px]">{label}</span>
      {typeof value === "string" ? (
        <span className="text-sm text-white/90">{value}</span>
      ) : (
        value
      )}
    </div>
  );
}

function CopyBtn({
  field,
  value,
  copiedField,
  onCopy,
  asButton,
}: {
  field: string;
  value: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
  asButton?: boolean;
}) {
  if (asButton) {
    return (
      <Button
        isIconOnly
        variant="bordered"
        className="!rounded-none border-white/[0.08]"
        onPress={() => onCopy(value, field)}
      >
        {copiedField === field ? (
          <PxCheck className="h-4 w-4 text-green-400" />
        ) : (
          <PxCopy className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <button
      onClick={() => onCopy(value, field)}
      className="text-default-400 hover:text-white transition-colors"
    >
      {copiedField === field ? (
        <PxCheck className="h-3.5 w-3.5 text-green-400" />
      ) : (
        <PxCopy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
