"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
  const [serverConfigured, setServerConfigured] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const needsKeyAttention =
    !loading && !configured && !serverConfigured && !value.trim();

  const load = useCallback(async () => {
    if (!api) return;

    try {
      const data = await api.getCaptchaSettings();
      setConfigured(Boolean(data?.configured));
      setServerConfigured(Boolean(data?.server_configured));
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
    <div id="captcha-provider" className="scroll-mt-20">
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
            ) : serverConfigured ? (
              <Chip size="sm" variant="flat">
                Using the server&apos;s key
              </Chip>
            ) : (
              <Chip color="danger" size="sm" variant="flat">
                Setup required
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
            key here to enable OnlyFans password login. Keep it topped up — a
            zero balance means no account can log in. If the server already has
            a shared key, your own key takes precedence.
          </p>

          <div className="border border-white/[0.08] bg-white/[0.02]">
            <div className="border-b border-white/[0.06] px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-wider text-white/80">
                How to set it up
              </p>
            </div>
            <ol className="divide-y divide-white/[0.06]">
              <li className="flex gap-3 px-4 py-3">
                <span className="font-mono text-xs font-bold text-[#f54900]">01</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Create a 2captcha account</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">
                    Open the provider site and create an account. 2captcha is a
                    separate paid service used to solve OnlyFans&apos; login challenge.
                  </p>
                  <a className="mt-2 inline-flex text-xs font-semibold text-[#f54900] hover:underline" href="https://2captcha.com/auth/register" rel="noopener noreferrer" target="_blank">
                    Open 2captcha sign up ↗
                  </a>
                  <Image
                    alt="Registration screen: enter an email and password, accept the terms, then create the account"
                    className="mt-3 h-auto w-full border border-white/[0.08]"
                    height={847}
                    src="/captcha-guide/step-1-sign-up.png"
                    width={1526}
                  />
                </div>
              </li>
              <li className="flex gap-3 px-4 py-3">
                <span className="font-mono text-xs font-bold text-[#f54900]">02</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Copy the key or add funds</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">
                    They are on the same dashboard bar. Select the copy icon beside
                    API Key to copy it. Select Top up to add balance.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <a className="inline-flex text-xs font-semibold text-[#f54900] hover:underline" href="https://2captcha.com/setting" rel="noopener noreferrer" target="_blank">
                      Open API key settings ↗
                    </a>
                    <a className="inline-flex text-xs font-semibold text-[#f54900] hover:underline" href="https://2captcha.com/pay" rel="noopener noreferrer" target="_blank">
                      Open Add funds ↗
                    </a>
                  </div>
                  <Image
                    alt="Real 2captcha dashboard with the email and key blurred; arrows point to Copy API Key and Add Funds on the same bar"
                    className="mt-3 h-auto w-full border border-white/[0.08]"
                    height={686}
                    src="/captcha-guide/step-2-dashboard-key-and-top-up.png"
                    width={2048}
                  />
                </div>
              </li>
              <li className="flex gap-3 px-4 py-3">
                <span className="font-mono text-xs font-bold text-[#f54900]">03</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Add about $5 credit</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">
                    Choose a payment method on the balance page. Solves are
                    usage-based, so keep a positive balance for the first
                    connection and future re-logins.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    <a className="inline-flex text-xs font-semibold text-[#f54900] hover:underline" href="https://2captcha.com/pay" rel="noopener noreferrer" target="_blank">
                      Open Add funds ↗
                    </a>
                    <a className="inline-flex text-xs font-semibold text-white/60 hover:text-white hover:underline" href="https://2captcha.com/pricing" rel="noopener noreferrer" target="_blank">
                      View current pricing ↗
                    </a>
                  </div>
                  <Image
                    alt="Real 2captcha balance page showing the available payment methods"
                    className="mt-3 h-auto w-full border border-white/[0.08]"
                    height={933}
                    src="/captcha-guide/step-3-payment-methods.png"
                    width={1427}
                  />
                </div>
              </li>
              <li className="flex gap-3 px-4 py-3">
                <span className="font-mono text-xs font-bold text-[#f54900]">04</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Paste and save it below</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">
                    The panel checks the key and its balance before saving it. The
                    key is encrypted and only a masked preview is returned later.
                  </p>
                  <Image
                    alt="Open-source panel Settings: paste the 2captcha API key and select Save key"
                    className="mt-3 h-auto w-full border border-white/[0.08]"
                    height={480}
                    src="/captcha-guide/step-4-save-key.svg"
                    width={880}
                  />
                </div>
              </li>
            </ol>
            <p className="border-t border-white/[0.06] px-4 py-3 text-[11px] leading-5 text-white/35">
              The funding and dashboard screenshots are from the current 2captcha
              customer interface; sensitive account details are blurred. 2captcha
              may move or rename controls later. If that happens, look for Top up
              and API Key in the customer Dashboard or Settings.
            </p>
          </div>

          <div className="space-y-2">
            {needsKeyAttention ? (
              <div className="flex items-center gap-2 border-l-2 border-red-400 bg-red-500/[0.08] px-3 py-2 text-xs font-semibold text-red-200">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-400" />
                Paste your 2captcha API key here
              </div>
            ) : null}
            <Input
              autoComplete="off"
              classNames={{
                inputWrapper: needsKeyAttention ? "captcha-key-attention" : "",
              }}
              description="Stored encrypted. It is never shown again after saving."
              isDisabled={busy}
              label="2captcha API key"
              placeholder={configured ? "Enter a new key to replace the current one" : "Paste your key here"}
              type="password"
              value={value}
              onValueChange={setValue}
            />
          </div>

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

          <div className="border-l-2 border-amber-400/60 bg-amber-400/[0.05] px-3 py-2.5 text-xs leading-5 text-amber-100/70">
            This key is used for OnlyFans password login and re-authentication.
            Normal dashboard browsing and cached-data reads do not spend captcha
            balance. Fansly connections do not require this key.
          </div>

          {configured || serverConfigured ? (
            <Link className="inline-flex text-xs font-semibold text-emerald-400 hover:underline" href="/dashboard/accounts">
              Captcha is ready — connect an account →
            </Link>
          ) : null}
        </div>
      </GlassCardBody>
    </GlassCard>
    </div>
  );
}
