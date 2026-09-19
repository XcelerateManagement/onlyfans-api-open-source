"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";

import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { PxShield } from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";

/**
 * Per-panel captcha provider key.
 *
 * OnlyFans gates login behind a Cloudflare Turnstile challenge and the login
 * flow pays a provider for a solve every time. The server has one key set in
 * its environment; this card lets a panel spend against its own balance
 * instead.
 *
 * The key is write-only: the API stores it encrypted and never returns it, so
 * there is nothing to reveal here — only a masked preview and whether one is
 * set.
 */
export function CaptchaKeyCard() {
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;

    try {
      const data = await api.getCaptchaSettings();
      setConfigured(Boolean(data?.configured));
      setPreview(data?.preview ?? null);
    } catch {
      // Non-fatal: the rest of Settings must still render.
      setError("Could not load captcha settings.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!api) return;

    const key = value.trim();

    if (!key) {
      setError("Paste your key first.");

      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      // The backend checks the key with the provider before storing it, so a
      // typo or an empty balance surfaces here rather than mid-login.
      const res = await api.setCaptchaKey(key);

      setValue("");
      setNotice(
        typeof res?.balance === "number"
          ? `Saved. Provider balance: $${res.balance.toFixed(2)}.`
          : "Saved.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that key.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!api) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.clearCaptchaKey();
      setNotice("Removed. Logins now use the key configured on the server.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard>
      <GlassCardHeader>
        <div className="flex items-center gap-2">
          <PxShield className="w-4 h-4 text-[#f54900]" />
          <div>
            <h3 className="text-sm font-medium text-white">Captcha provider</h3>
            <p className="text-xs text-white/40">
              Used every time an OnlyFans account logs in
            </p>
          </div>
        </div>
      </GlassCardHeader>
      <GlassCardBody>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {loading ? (
              <Chip size="sm" variant="flat">
                Checking…
              </Chip>
            ) : configured ? (
              <>
                <Chip color="success" size="sm" variant="flat">
                  Your own key
                </Chip>
                {preview ? (
                  <span className="text-xs text-white/40 font-mono">{preview}</span>
                ) : null}
              </>
            ) : (
              <Chip size="sm" variant="flat">
                Using the server&apos;s key
              </Chip>
            )}
          </div>

          <p className="text-sm text-white/50">
            OnlyFans puts a Cloudflare Turnstile challenge in front of login, and
            each attempt pays a provider to solve it. Add a{" "}
            <a
              className="text-[#f54900] hover:underline"
              href="https://2captcha.com/"
              rel="noopener noreferrer"
              target="_blank"
            >
              2captcha
            </a>{" "}
            key here to spend against your own balance instead of the one
            configured on this server. Keep it topped up — a zero balance means
            no account can log in.
          </p>

          <Input
            autoComplete="off"
            description="Stored encrypted. It is never shown again after saving."
            isDisabled={busy}
            label="2captcha API key"
            placeholder={configured ? "Enter a new key to replace the current one" : "Paste your key"}
            type="password"
            value={value}
            onValueChange={setValue}
          />

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {notice ? <p className="text-sm text-success">{notice}</p> : null}

          <div className="flex gap-2">
            <Button
              color="primary"
              isDisabled={busy || !value.trim()}
              isLoading={busy}
              size="sm"
              onPress={save}
            >
              {configured ? "Replace key" : "Save key"}
            </Button>
            {configured ? (
              <Button isDisabled={busy} size="sm" variant="flat" onPress={clear}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </GlassCardBody>
    </GlassCard>
  );
}
