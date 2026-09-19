"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Switch } from "@heroui/switch";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";

import {
  GlassCard,
  GlassCardBody,
  GlassCardHeader,
} from "@/components/dashboard/GlassCard";
import {
  PxCheck,
  PxCopy,
  PxLink,
  PxSend,
  PxZap,
} from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";
import type {
  TelegramBotMode,
  TelegramIntegration,
} from "@/lib/api-client";

const inputClassNames = {
  inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
};

/** Wildcard is handled by the "All events" switch, so it isn't a checkbox. */
const SELECTABLE_EVENTS = [
  "new_subscriber",
  "renewed_subscriber",
  "expired_subscriber",
  "new_tip",
  "new_message",
  "new_purchase",
  "balance_increased",
  "payout_completed",
  "polling_paused",
];

const EVENT_LABELS: Record<string, string> = {
  new_subscriber: "New subscriber",
  renewed_subscriber: "Renewal",
  expired_subscriber: "Expiry",
  new_tip: "Tip",
  new_message: "Message",
  new_purchase: "Purchase",
  balance_increased: "Balance up",
  payout_completed: "Payout",
  polling_paused: "Polling paused",
};

export function TelegramIntegrationCard({ delay = 0 }: { delay?: number }) {
  const api = useApiClient();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [integration, setIntegration] = useState<TelegramIntegration | null>(null);
  const [sharedAvailable, setSharedAvailable] = useState(false);

  const [mode, setMode] = useState<TelegramBotMode>("shared");
  const [botToken, setBotToken] = useState("");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const data = await api.getTelegramIntegration();
      setIntegration(data.integration);
      setSharedAvailable(Boolean(data.shared_bot_available));
      if (data.integration) setMode(data.integration.bot_mode);
      else if (!data.shared_bot_available) setMode("custom");
    } catch (err: any) {
      toast.error(err?.message || "Failed to load Telegram settings");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While a pairing link is live, poll for the /start landing so the card
  // flips to "connected" without the user coming back to click something.
  useEffect(() => {
    if (!deepLink || !api) return;
    const id = setInterval(async () => {
      try {
        const data = await api.getTelegramIntegration();
        if (data.integration?.is_paired) {
          setIntegration(data.integration);
          setDeepLink(null);
          setLinkExpiresAt(null);
          toast.success("Telegram connected");
        }
      } catch {
        /* transient — the interval retries */
      }
    }, 2500);
    return () => clearInterval(id);
  }, [deepLink, api]);

  // A code that has expired can no longer resolve; drop the stale link rather
  // than leaving a button that quietly does nothing.
  useEffect(() => {
    if (!linkExpiresAt) return;
    const ms = new Date(linkExpiresAt + "Z").getTime() - Date.now();
    if (ms <= 0) {
      setDeepLink(null);
      return;
    }
    const id = setTimeout(() => {
      setDeepLink(null);
      setLinkExpiresAt(null);
    }, ms);
    return () => clearTimeout(id);
  }, [linkExpiresAt]);

  async function startPairing() {
    if (!api) return;
    setBusy(true);
    try {
      const res = await api.pairTelegram({
        bot_mode: mode,
        ...(mode === "custom" ? { bot_token: botToken.trim() } : {}),
      });
      setDeepLink(res.deep_link);
      setLinkExpiresAt(res.expires_at);
      setIntegration(res.integration);
      setBotToken(""); // never keep the secret in component state
      toast.success("Open the link and press Start in Telegram");
    } catch (err: any) {
      toast.error(err?.message || "Could not start pairing");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(next: boolean) {
    if (!api) return;
    try {
      const res = await api.updateTelegramIntegration({ is_active: next });
      setIntegration(res.integration);
    } catch (err: any) {
      toast.error(err?.message || "Update failed");
    }
  }

  async function setEventTypes(types: string[]) {
    if (!api || !types.length) return;
    try {
      const res = await api.updateTelegramIntegration({ event_types: types });
      setIntegration(res.integration);
    } catch (err: any) {
      toast.error(err?.message || "Update failed");
    }
  }

  async function sendTest() {
    if (!api) return;
    const t = toast.loading("Sending test message…");
    try {
      const res = await api.testTelegramIntegration();
      if (res.success) toast.success("Sent — check Telegram", { id: t });
      else toast.error(res.error || "Test failed", { id: t });
      setIntegration(res.integration);
    } catch (err: any) {
      toast.error(err?.message || "Test failed", { id: t });
    }
  }

  async function disconnect() {
    if (!api) return;
    setBusy(true);
    try {
      await api.deleteTelegramIntegration();
      setIntegration(null);
      setDeepLink(null);
      setLinkExpiresAt(null);
      toast.success("Telegram disconnected");
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!deepLink) return;
    navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const paired = Boolean(integration?.is_paired);
  const allEvents = (integration?.event_types || ["*"]).includes("*");

  return (
    <GlassCard delay={delay}>
      <GlassCardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PxSend className="h-5 w-5 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-lg font-semibold">Telegram Notifications</h3>
          </div>
          {paired && (
            <Chip
              size="sm"
              variant="flat"
              classNames={{
                base: integration?.is_active
                  ? "bg-green-500/10 border border-green-500/20 !rounded-none"
                  : "bg-white/[0.04] border border-white/[0.08] !rounded-none",
                content: integration?.is_active
                  ? "text-green-400 text-xs"
                  : "text-default-400 text-xs",
              }}
            >
              {integration?.is_active ? "Active" : "Paused"}
            </Chip>
          )}
        </div>
      </GlassCardHeader>

      <GlassCardBody className="space-y-5">
        {loading ? (
          <div className="h-24 bg-white/[0.02] animate-pulse" />
        ) : paired ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8">
              <Row label="Chat" value={integration?.chat_title || integration?.chat_id || "—"} />
              <Row
                label="Bot"
                value={
                  integration?.bot_mode === "shared"
                    ? `Shared bot (@${integration?.bot_username})`
                    : `Your bot (@${integration?.bot_username})`
                }
              />
              <Row
                label="Last sent"
                value={
                  integration?.last_delivery_at
                    ? new Date(integration.last_delivery_at + "Z").toLocaleString()
                    : "Never"
                }
              />
              <Row
                label="Failures"
                value={String(integration?.consecutive_failures ?? 0)}
              />
            </div>

            {integration?.last_error && (
              <p className="text-xs text-red-400 border border-red-500/20 bg-red-500/[0.06] p-2">
                Last error: {integration.last_error}
              </p>
            )}

            {!integration?.is_active && (integration?.consecutive_failures ?? 0) >= 5 && (
              <p className="text-xs text-amber-400">
                Auto-paused after 5 consecutive failures. Fix the chat, then
                re-enable below.
              </p>
            )}

            <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
              <div>
                <p className="text-sm text-white/90">Deliver notifications</p>
                <p className="text-xs text-default-400">
                  Turn off to pause without disconnecting
                </p>
              </div>
              <Switch
                size="sm"
                isSelected={Boolean(integration?.is_active)}
                onValueChange={toggleActive}
              />
            </div>

            <div className="border-t border-white/[0.06] pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/90">Events</span>
                <label className="flex items-center gap-2 text-xs text-default-400">
                  All events
                  <Switch
                    size="sm"
                    isSelected={allEvents}
                    onValueChange={(on) =>
                      setEventTypes(on ? ["*"] : ["new_subscriber", "new_tip"])
                    }
                  />
                </label>
              </div>
              <AnimatePresence initial={false}>
                {!allEvents && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex flex-wrap gap-2 overflow-hidden"
                  >
                    {SELECTABLE_EVENTS.map((evt) => {
                      const on = (integration?.event_types || []).includes(evt);
                      return (
                        <button
                          key={evt}
                          type="button"
                          onClick={() => {
                            const current = integration?.event_types || [];
                            const next = on
                              ? current.filter((e) => e !== evt)
                              : [...current, evt];
                            if (!next.length) {
                              toast.error("Pick at least one event");
                              return;
                            }
                            setEventTypes(next);
                          }}
                          className={`px-2.5 py-1 text-[11px] uppercase tracking-wider border transition-colors ${
                            on
                              ? "border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] text-[color:var(--theme-accent,#f54900)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.08)]"
                              : "border-white/[0.08] text-default-400 hover:text-white"
                          }`}
                        >
                          {EVENT_LABELS[evt] || evt}
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              <Button
                size="sm"
                variant="bordered"
                className="!rounded-none border-white/[0.08]"
                onPress={sendTest}
                startContent={<PxZap className="h-3.5 w-3.5" />}
              >
                Send test
              </Button>
              <Button
                size="sm"
                variant="bordered"
                className="!rounded-none border-white/[0.08]"
                isDisabled={busy}
                onPress={() => {
                  setDeepLink(null);
                  setIntegration(
                    integration ? { ...integration, is_paired: false, chat_id: null } : null
                  );
                }}
              >
                Change chat
              </Button>
              <Button
                size="sm"
                variant="bordered"
                className="!rounded-none border-red-500/20 text-red-400"
                isDisabled={busy}
                onPress={disconnect}
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-default-400">
              Get tips, purchases and new subscribers in Telegram. Choose a bot
              and open the link it gives you.
            </p>

            <div className="flex gap-2">
              {sharedAvailable && (
                <ModeTab
                  active={mode === "shared"}
                  label="shared bot"
                  hint="Nothing to set up"
                  onSelect={() => setMode("shared")}
                />
              )}
              <ModeTab
                active={mode === "custom"}
                label="Your own bot"
                hint="Paste a token from @BotFather"
                onSelect={() => setMode("custom")}
              />
            </div>

            {!sharedAvailable && (
              <p className="text-xs text-default-400">
                The shared shared bot isn&apos;t configured on this
                deployment, so connect your own bot below.
              </p>
            )}

            <AnimatePresence initial={false} mode="wait">
              {mode === "custom" && (
                <motion.div
                  key="token"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className="text-sm text-default-500 mb-1 block">
                    Bot token
                  </label>
                  <Input
                    type="password"
                    placeholder="123456789:AA…"
                    value={botToken}
                    onValueChange={setBotToken}
                    variant="bordered"
                    classNames={inputClassNames}
                    className="font-mono max-w-lg"
                  />
                  <p className="text-xs text-default-400 mt-1">
                    Stored encrypted. It is never shown again after you save it
                    {integration?.has_custom_token && " — a token is already stored"}
                    .
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {deepLink ? (
                <motion.div
                  key="link"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-3 border border-white/[0.08] bg-white/[0.02] p-4"
                >
                  <p className="text-sm text-white/90">
                    Open this link and press <strong>Start</strong>. To notify a
                    group instead, add the bot to it and send the link there.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={deepLink}
                      isReadOnly
                      variant="bordered"
                      classNames={inputClassNames}
                      className="font-mono flex-1"
                    />
                    <Button
                      isIconOnly
                      variant="bordered"
                      className="!rounded-none border-white/[0.08]"
                      onPress={copyLink}
                    >
                      {copied ? (
                        <PxCheck className="h-4 w-4 text-green-400" />
                      ) : (
                        <PxCopy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      as="a"
                      href={deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dashboard-btn-primary text-white font-bold uppercase tracking-wider !rounded-none"
                      startContent={<PxLink className="h-3.5 w-3.5" />}
                    >
                      Open
                    </Button>
                  </div>
                  <p className="text-xs text-default-400">
                    Waiting for you to press Start… the link is single-use and
                    expires shortly.
                  </p>
                </motion.div>
              ) : (
                <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <Button
                    className="dashboard-btn-primary text-white font-bold uppercase tracking-wider !rounded-none"
                    isDisabled={busy || (mode === "custom" && !botToken.trim())}
                    isLoading={busy}
                    onPress={startPairing}
                    startContent={!busy && <PxLink className="h-3.5 w-3.5" />}
                  >
                    Generate pairing link
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </GlassCardBody>
    </GlassCard>
  );
}

function ModeTab({
  active,
  label,
  hint,
  onSelect,
}: {
  active: boolean;
  label: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex-1 text-left px-3 py-2 border transition-colors ${
        active
          ? "border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.06)]"
          : "border-white/[0.08] hover:border-white/[0.16]"
      }`}
    >
      <span className="block text-sm font-semibold text-white">{label}</span>
      <span className="block text-xs text-default-400">{hint}</span>
      {active && (
        <motion.span
          layoutId="tg-mode-underline"
          transition={{ duration: 0.25 }}
          className="absolute left-0 bottom-0 h-[2px] w-full bg-[color:var(--theme-accent,#f54900)]"
        />
      )}
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between md:justify-start md:gap-4">
      <span className="text-sm text-default-500 min-w-[100px]">{label}</span>
      <span className="text-sm text-white/90 truncate">{value}</span>
    </div>
  );
}
