"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ProxyFixModal, type ProxyFixAccount } from "@/components/dashboard/ProxyFixModal";

interface PromptArgs {
  account: ProxyFixAccount;
  /** Message shown for context (the 407 / proxy error that triggered it). */
  reason?: string | null;
  /** Run after the proxy is saved — typically retries the failed action. */
  onFixed?: () => void;
}

interface Ctx {
  promptProxyFix: (args: PromptArgs) => void;
}

const ProxyFixContext = createContext<Ctx | null>(null);

/**
 * Provides a single shared "fix proxy" wizard for the whole dashboard. Any page
 * can call `useProxyFix().promptProxyFix({ account, reason, onFixed })` when it
 * detects a proxy/407 error (see lib/proxy-error.ts).
 */
export function ProxyFixProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<PromptArgs | null>(null);

  const promptProxyFix = useCallback((next: PromptArgs) => setArgs(next), []);
  const close = useCallback(() => setArgs(null), []);

  return (
    <ProxyFixContext.Provider value={{ promptProxyFix }}>
      {children}
      <ProxyFixModal
        isOpen={!!args}
        account={args?.account ?? null}
        reason={args?.reason ?? null}
        onClose={close}
        onFixed={() => {
          args?.onFixed?.();
          close();
        }}
      />
    </ProxyFixContext.Provider>
  );
}

export function useProxyFix(): Ctx {
  const ctx = useContext(ProxyFixContext);
  // No-op fallback so calling outside the provider never throws.
  return ctx ?? { promptProxyFix: () => {} };
}
