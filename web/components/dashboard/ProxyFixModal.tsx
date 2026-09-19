"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import toast from "react-hot-toast";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { ProxyFormatHint } from "@/components/dashboard/ProxyFormatHint";

export type ProxyFixAccount = {
  of_user_id: string | number;
  username?: string | null;
  proxy?: string | null;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  account: ProxyFixAccount | null;
  /** The error message that triggered the wizard (shown for context). */
  reason?: string | null;
  /** Called after the proxy is saved successfully — use it to retry the action. */
  onFixed?: () => void;
}

/** Normalise the compact `host:port:user:pass` form into a proxy URL.
 *  URL-form proxies (http://, socks5://, …) pass through untouched. */
function normaliseProxy(raw: string): string {
  const t = raw.trim();
  if (!t.includes("://") && t.split(":").length === 4) {
    const [host, port, user, pass] = t.split(":");
    return `http://${user}:${pass}@${host}:${port}`;
  }
  return t;
}

type TestResult =
  | { ok: true; ip?: string; latency_ms?: number; city?: string; country?: string }
  | { ok: false; error: string };

/**
 * Inline "fix the proxy" wizard. Opens when a 407 / proxy auth error surfaces
 * (e.g. clicking Refresh Spending). Lets the user paste a new proxy, test it
 * against the backend, and save it on the account — then retry the action.
 */
export function ProxyFixModal({ isOpen, onClose, account, reason, onFixed }: Props) {
  const api = useApiClient();
  const [proxy, setProxy] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  // Reset state whenever the wizard is (re)opened for an account.
  useEffect(() => {
    if (isOpen) {
      setProxy(account?.proxy ? String(account.proxy) : "");
      setResult(null);
      setTesting(false);
      setSaving(false);
    }
  }, [isOpen, account]);

  const uid = account ? String(account.of_user_id) : null;

  const runTest = async () => {
    if (!api || !proxy.trim()) return;
    setTesting(true);
    setResult(null);
    try {
      const r = await api.testProxy(normaliseProxy(proxy));
      if (r.ok) {
        setResult({
          ok: true,
          ip: r.ip,
          latency_ms: r.latency_ms,
          city: r.geo?.city ?? undefined,
          country: r.geo?.country ?? undefined,
        });
      } else {
        setResult({ ok: false, error: r.error || "Proxy test failed." });
      }
    } catch (err) {
      const msg = (err as { message?: string })?.message || "";
      const isAuth = /407|authentication/i.test(msg);
      setResult({
        ok: false,
        error: isAuth
          ? "Proxy authentication failed — check username and password."
          : "Proxy test failed. Try again or use a different proxy.",
      });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!api || !uid || !proxy.trim()) return;
    setSaving(true);
    try {
      await api.updateProxy(uid, normaliseProxy(proxy));
      toast.success("Proxy updated — retrying");
      onFixed?.();
      onClose();
    } catch (err) {
      toast.error((err as { message?: string })?.message || "Failed to save proxy");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" placement="center">
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          Fix proxy{account?.username ? ` for @${account.username}` : ""}
        </ModalHeader>
        <ModalBody className="gap-3">
          {reason && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger-600">
              {reason}
            </div>
          )}
          <p className="text-xs text-default-500">
            A <span className="font-semibold">407</span> means the proxy username or
            password is wrong. Paste the correct proxy, test it, then save &amp; retry.
          </p>
          <Input
            label="Proxy"
            placeholder="http://user:pass@host:port"
            value={proxy}
            onValueChange={setProxy}
            variant="bordered"
            autoFocus
            classNames={{ input: "font-mono text-sm" }}
          />
          <ProxyFormatHint />
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              variant="flat"
              onPress={runTest}
              isLoading={testing}
              isDisabled={!proxy.trim() || testing}
            >
              Test proxy
            </Button>
            {result?.ok === true && (
              <span className="text-xs text-success-600">
                Working · {result.ip}
                {result.city ? ` · ${result.city}${result.country ? `, ${result.country}` : ""}` : ""}
                {result.latency_ms != null ? ` · ${result.latency_ms}ms` : ""}
              </span>
            )}
            {result?.ok === false && (
              <span className="text-xs text-danger-600">{result.error}</span>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose} isDisabled={saving}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={save}
            isLoading={saving}
            isDisabled={!proxy.trim() || saving}
          >
            Save &amp; retry
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
