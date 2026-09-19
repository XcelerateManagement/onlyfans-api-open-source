"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import toast from "react-hot-toast";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { PxShield, PxLock, PxKey, PxGlobe } from "@/components/ui/PixelIcons";
import { useConfirm } from "@/lib/hooks/use-confirm";
import { cn } from "@/lib/utils";

const inputClassNames = {
  inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
};
const buttonClass = "rounded-none uppercase tracking-wider font-bold text-xs";
const primaryClass = cn(buttonClass, "bg-accent text-white hover:bg-accent-hover");

type SignedInSession = {
  id: number;
  method: "password" | "sso" | "legacy";
  ip: string;
  country: string;
  user_agent: string;
  created_at: number;
  last_seen_at: number;
  current: boolean;
};

type Status = {
  available: boolean;
  mfa: { enabled: boolean; recovery_codes_remaining: number };
  sessions: SignedInSession[];
};

type Step = "idle" | "password" | "scan" | "codes" | "disable" | "regenerate";

async function call<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`/api/user/security/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data as T;
}

function describeDevice(ua: string) {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || "Unknown device";
}

function countryName(code: string) {
  if (!code || code === "Unknown") return "Unknown location";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

const formatTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * Settings → Account security: authenticator-app 2FA for the Only API login,
 * and the list of browsers currently signed in to this dashboard.
 */
export function AccountSecurityCard() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setStatus(await call<Status>("status"));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reset = (next: Step = "idle") => {
    setStep(next);
    setError("");
    setPassword("");
    setCode("");
    setUseRecovery(false);
    if (next === "idle") setSetup(null);
  };

  // Runs a request with shared busy/error handling. Returns null on failure.
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(() => call<{ secret: string; qr: string }>("2fa/setup", { password }));
    if (!result) return;
    setSetup(result);
    reset("scan");
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(() => call<{ recovery_codes: string[] }>("2fa/enable", { code }));
    if (!result) return;
    setRecoveryCodes(result.recovery_codes);
    setSetup(null);
    reset("codes");
    toast.success("Two-factor authentication is on");
    load();
  };

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(() =>
      call("2fa/disable", { password, code, recovery: useRecovery })
    );
    if (!result) return;
    reset();
    toast.success("Two-factor authentication is off");
    load();
  };

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(() =>
      call<{ recovery_codes: string[] }>("recovery/regenerate", { code, recovery: useRecovery })
    );
    if (!result) return;
    setRecoveryCodes(result.recovery_codes);
    reset("codes");
    load();
  };

  const copy = (text: string, message: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(message))
      .catch(() => toast.error("Couldn't copy. Select the text and copy it manually."));

  const revoke = async (mode: "one" | "others" | "all", target?: SignedInSession) => {
    const prompts = {
      one: target?.current
        ? { title: "Sign out of this browser?", body: "You'll need to sign in again here.", label: "Sign out" }
        : {
            title: "Sign out this session?",
            body: `${describeDevice(target?.user_agent || "")} will be signed out within 30 seconds.`,
            label: "Sign out",
          },
      others: {
        title: "Sign out all other sessions?",
        body: "Every other browser signed in to this dashboard will be signed out within 30 seconds. This browser stays signed in. API keys are not affected.",
        label: "Sign out others",
      },
      all: {
        title: "Sign out everywhere?",
        body: "Every browser, including this one, will be signed out. API keys are not affected.",
        label: "Sign out everywhere",
      },
    }[mode];
    if (!(await confirm({ title: prompts.title, body: prompts.body, confirmLabel: prompts.label, danger: true }))) {
      return;
    }
    const result = await run(() =>
      call<{ revoked: number; current_revoked: boolean }>("sessions/revoke", { mode, targetId: target?.id })
    );
    if (!result) return;
    if (result.current_revoked) {
      await signOut({ callbackUrl: "/login" });
      return;
    }
    toast.success(mode === "others" ? "Other sessions signed out" : "Session signed out");
    load();
  };

  // Not rolled out to this panel (or still loading): show nothing.
  if ((!status && !loadError) || status?.available === false) return null;

  const mfa = status?.mfa;
  const codeInput = (autoFocus = false) => (
    <div className="space-y-2">
      <Input
        label={useRecovery ? "Recovery code" : "6-digit code from your authenticator app"}
        variant="bordered"
        size="sm"
        value={code}
        onValueChange={setCode}
        autoComplete="one-time-code"
        inputMode={useRecovery ? "text" : "numeric"}
        autoFocus={autoFocus}
        isRequired
        classNames={inputClassNames}
      />
      <button
        type="button"
        className="text-xs text-default-400 hover:text-white transition-colors"
        onClick={() => {
          setUseRecovery(!useRecovery);
          setCode("");
        }}
      >
        {useRecovery ? "Use a code from your app instead" : "Lost your phone? Use a recovery code"}
      </button>
    </div>
  );
  const passwordInput = (
    <Input
      type="password"
      label="Your password"
      variant="bordered"
      size="sm"
      value={password}
      onValueChange={setPassword}
      autoComplete="current-password"
      autoFocus
      isRequired
      classNames={inputClassNames}
    />
  );
  const cancelButton = (
    <Button type="button" size="sm" variant="light" className={buttonClass} onPress={() => reset()} isDisabled={busy}>
      Cancel
    </Button>
  );

  return (
    <GlassCard delay={0.05}>
      <GlassCardHeader>
        <div className="flex items-center gap-3">
          <PxShield className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
          <h3 className="text-lg font-semibold">Account Security</h3>
        </div>
      </GlassCardHeader>
      <GlassCardBody>
        <div className="space-y-6">
          {loadError && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-red-400">
              {loadError}
              <Button size="sm" variant="bordered" className={buttonClass} onPress={load}>
                Retry
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}

          {/* Password */}
          <section className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <PxLock className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
                Password
              </h4>
              <p className="text-xs text-default-500 mt-1">
                Your password signs you in to this panel</p>
            </div>
            <Button
              as="a"
              href="/api/sso/dashboard?to=%2Fdashboard%2Faccount%3Ftab%3Dsecurity"
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              variant="bordered"
              className={buttonClass}
            >
              Change password
            </Button>
          </section>

          {/* Two-factor authentication */}
          <section className="space-y-4 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <PxKey className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
                  Two-factor authentication
                  <span
                    className={cn(
                      "border px-2 py-0.5 text-[10px] uppercase tracking-wider",
                      mfa?.enabled
                        ? "border-green-500/20 bg-green-500/10 text-green-400"
                        : "border-white/[0.08] text-default-400"
                    )}
                  >
                    {!mfa ? "Loading" : mfa.enabled ? "On" : "Off"}
                  </span>
                </h4>
                <p className="text-xs text-default-500 mt-1">
                  {mfa?.enabled
                    ? `Signing in asks for a code from your authenticator app. ${mfa.recovery_codes_remaining} recovery code${mfa.recovery_codes_remaining === 1 ? "" : "s"} left.`
                    : "Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy…) whenever you sign in."}
                </p>
              </div>
              {step === "idle" && mfa && (
                <div className="flex flex-wrap gap-2">
                  {mfa.enabled ? (
                    <>
                      <Button size="sm" variant="bordered" className={buttonClass} onPress={() => reset("regenerate")}>
                        New recovery codes
                      </Button>
                      <Button
                        size="sm"
                        variant="bordered"
                        className={cn(buttonClass, "border-red-500/30 text-red-400")}
                        onPress={() => reset("disable")}
                      >
                        Turn off
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" className={primaryClass} onPress={() => reset("password")}>
                      Set up
                    </Button>
                  )}
                </div>
              )}
            </div>


            {step === "password" && (
              <form onSubmit={startSetup} className="space-y-3 max-w-md">
                <p className="text-sm text-default-400">Confirm your password to continue.</p>
                {passwordInput}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className={primaryClass} isLoading={busy}>
                    Continue
                  </Button>
                  {cancelButton}
                </div>
              </form>
            )}

            {step === "scan" && setup && (
              <form onSubmit={confirmSetup} className="grid gap-5 md:grid-cols-[auto_1fr] items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={setup.qr}
                  alt="QR code for your authenticator app"
                  width={200}
                  height={200}
                  className="bg-white p-2"
                />
                <div className="space-y-3 max-w-md">
                  <p className="text-sm text-default-400">
                    1. Scan this QR code with your authenticator app. Can&apos;t scan it? Enter this key instead:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="break-all border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs font-mono">
                      {setup.secret.match(/.{1,4}/g)?.join(" ")}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="light"
                      className={buttonClass}
                      onPress={() => copy(setup.secret, "Key copied")}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-sm text-default-400">2. Enter the 6-digit code the app shows.</p>
                  <Input
                    label="6-digit code"
                    variant="bordered"
                    size="sm"
                    value={code}
                    onValueChange={setCode}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    isRequired
                    classNames={inputClassNames}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" className={primaryClass} isLoading={busy}>
                      Turn on
                    </Button>
                    {cancelButton}
                  </div>
                </div>
              </form>
            )}

            {step === "codes" && recoveryCodes.length > 0 && (
              <div className="space-y-3 border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] bg-white/[0.02] p-4 max-w-md">
                <p className="text-sm">
                  Save these recovery codes somewhere safe, like a password manager. Each works once if you lose
                  your phone. They won&apos;t be shown again.
                </p>
                <pre className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm font-mono">
                  {recoveryCodes.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </pre>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="bordered"
                    className={buttonClass}
                    onPress={() => copy(recoveryCodes.join("\n"), "Recovery codes copied")}
                  >
                    Copy codes
                  </Button>
                  <Button
                    size="sm"
                    className={primaryClass}
                    onPress={() => {
                      setRecoveryCodes([]);
                      reset();
                    }}
                  >
                    I&apos;ve saved them
                  </Button>
                </div>
              </div>
            )}

            {step === "disable" && (
              <form onSubmit={turnOff} className="space-y-3 max-w-md">
                <p className="text-sm text-default-400">
                  Turning this off means signing in only needs your password.
                </p>
                {passwordInput}
                {codeInput()}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    className={cn(buttonClass, "bg-red-500/80 text-white")}
                    isLoading={busy}
                  >
                    Turn off
                  </Button>
                  {cancelButton}
                </div>
              </form>
            )}

            {step === "regenerate" && (
              <form onSubmit={regenerate} className="space-y-3 max-w-md">
                <p className="text-sm text-default-400">
                  New codes replace all your old recovery codes.
                </p>
                {codeInput(true)}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className={primaryClass} isLoading={busy}>
                    Get new codes
                  </Button>
                  {cancelButton}
                </div>
              </form>
            )}
          </section>

          {/* Signed-in sessions */}
          <section className="space-y-3 border-t border-white/[0.06] pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <PxGlobe className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
                  Signed-in sessions
                </h4>
                <p className="text-xs text-default-500 mt-1">
                  Browsers signed in to this dashboard. Locations are approximate, based on the network address.
                </p>
              </div>
              <Button size="sm" variant="light" className={buttonClass} onPress={load} isDisabled={busy}>
                Refresh
              </Button>
            </div>

            {!status ? (
              !loadError && <p className="text-sm text-default-500">Loading sessions…</p>
            ) : status.sessions.length === 0 ? (
              <p className="text-sm text-default-500">No sessions to show yet.</p>
            ) : (
              <div className="divide-y divide-white/[0.06] border border-white/[0.06]">
                {status.sessions.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0 text-sm">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {describeDevice(s.user_agent)}
                        {s.current && (
                          <span className="border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-green-400">
                            This browser
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-default-500">
                        {countryName(s.country)}
                        {s.ip !== "Unknown" && ` · ${s.ip}`}
                        {s.method === "sso" && " · via billing dashboard"}
                      </p>
                      <p className="text-xs text-default-500">
                        {s.method === "legacy" ? "Signed in before this list existed" : `Signed in ${formatTime(s.created_at)}`}
                        {" · "}Last active {formatTime(s.last_seen_at)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="bordered"
                      className={cn(buttonClass, "border-red-500/30 text-red-400")}
                      isDisabled={busy}
                      onPress={() => revoke("one", s)}
                    >
                      Sign out
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="bordered"
                className={buttonClass}
                isDisabled={busy || !status}
                onPress={() => revoke("others")}
              >
                Sign out all other sessions
              </Button>
              <Button
                size="sm"
                variant="bordered"
                className={cn(buttonClass, "border-red-500/30 text-red-400")}
                isDisabled={busy || !status}
                onPress={() => revoke("all")}
              >
                Sign out everywhere
              </Button>
            </div>
          </section>
        </div>
      </GlassCardBody>
    </GlassCard>
  );
}
