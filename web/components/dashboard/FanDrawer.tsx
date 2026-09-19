"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Chip } from "@heroui/chip";

import toast from "react-hot-toast";

import { useApiClient } from "@/lib/hooks/use-api-client";
import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { FanTagEditor } from "@/components/dashboard/FanTagEditor";
import { OfListBadges } from "@/components/dashboard/OfListBadges";
import { PxActivity } from "@/components/ui/PixelIcons";
import { parseUtc } from "@/lib/chat-utils";
import { platformLabel } from "@/lib/platform-capabilities";
import type { Platform } from "@/lib/hooks/use-selected-account";

function formatRelative(iso: string | null | undefined): string {
  const d = parseUtc(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatDollars(n: number): string {
  return (n || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

const EVENT_COLOR: Record<string, string> = {
  new_subscriber: "text-success-500",
  renewed_subscriber: "text-primary-500",
  expired_subscriber: "text-danger-500",
  new_tip: "text-warning-500",
  new_message: "text-primary-500",
  new_purchase: "text-success-500",
};

export function FanDrawer({
  fan,
  onClose,
  onUpdate,
  platform,
}: {
  fan: any | null;
  onClose: () => void;
  onUpdate: (fan: any) => void;
  /** Platform of the account this fan belongs to — drives the lists heading
   * and the spend-tile tooltips. Undefined defaults to OnlyFans copy. */
  platform?: Platform;
}) {
  const api = useApiClient();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsError, setEventsError] = useState(false);
  const [note, setNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Only re-fetch when the drawer switches to a different fan — not on
  // every tag edit (which recreates the fan object).
  const fanId = fan?.id;
  const ofUserId = fan?.of_user_id;
  const fanOfUserId = fan?.fan_of_user_id;

  // Sync the note editor when the drawer switches fans (keyed on fanId so a
  // tag edit — which rebuilds the fan object — doesn't clobber an in-progress edit).
  useEffect(() => {
    setNote(fan?.note || "");
  }, [fanId]); // eslint-disable-line react-hooks/exhaustive-deps

  const noteDirty = note !== (fan?.note || "");
  const saveNote = async () => {
    if (!api || !fan) return;
    setNoteSaving(true);
    try {
      await api.setFanNote(fan.fan_of_user_id, fan.of_user_id, note);
      onUpdate({ ...fan, note });
      toast.success("Note saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save note");
    } finally {
      setNoteSaving(false);
    }
  };
  useEffect(() => {
    if (!fanId || !api || !ofUserId || !fanOfUserId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setEventsError(false);
      try {
        const res = await api!.listEvents({
          of_user_id: ofUserId,
          limit: 200,
        });
        if (!cancelled) {
          const filtered = (res.events || []).filter(
            (e: any) => String(e.payload?.fan?.id || "") === String(fanOfUserId)
          );
          setEvents(filtered);
        }
      } catch {
        // Distinguish "the fetch failed" (rate limit, transient network) from
        // the genuine "no events yet" empty state.
        if (!cancelled) {
          setEvents([]);
          setEventsError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, fanId, ofUserId, fanOfUserId]);

  // Esc closes the drawer
  useEffect(() => {
    if (!fan) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fan, onClose]);

  return (
    <AnimatePresence>
      {fan && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed top-0 right-0 h-full w-full sm:w-[460px] bg-[#0a0a0a] border-l border-white/[0.08] z-50 overflow-y-auto"
          >
            <div className="p-5 border-b border-white/[0.06]">
              <button
                onClick={onClose}
                className="text-xs text-default-400 hover:text-foreground mb-4"
              >
                ← Close
              </button>
              <div className="flex items-center gap-3">
                <FanAvatar
                  username={fan.username}
                  displayName={fan.display_name}
                  avatar={fan.avatar}
                  size={48}
                />
                <div className="min-w-0">
                  <p className="font-bold truncate">
                    {fan.display_name || fan.username || fan.fan_of_user_id}
                  </p>
                  <p className="text-xs text-default-400 truncate">
                    @{fan.username || fan.fan_of_user_id}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-5">
                <Stat
                  label="Tips"
                  value={fan.spend_known ? formatDollars(fan.total_tips) : "—"}
                  title={fan.spend_known ? undefined : spendUnknownTooltip(platform)}
                />
                <Stat
                  label="Spend"
                  value={fan.spend_known ? formatDollars(fan.total_spend) : "—"}
                  title={fan.spend_known ? undefined : spendUnknownTooltip(platform)}
                />
                <Stat label="Events" value={String(fan.event_count ?? 0)} />
              </div>

              {fan.of_lists?.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold mb-2">
                    {platformLabel(platform)} lists
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <OfListBadges lists={fan.of_lists} platform={platform} />
                  </div>
                </div>
              )}

              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold mb-2">
                  Tags
                </p>
                <FanTagEditor
                  fanOfUserId={fan.fan_of_user_id}
                  ofUserId={fan.of_user_id}
                  tags={fan.tags || []}
                  onChange={(tags) => onUpdate({ ...fan, tags })}
                />
              </div>

              <div className="mt-4">
                <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold mb-2">
                  Note
                </p>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Private note to self…"
                  rows={3}
                  className="w-full bg-white/[0.03] border border-white/[0.08] rounded-none px-2.5 py-2 text-sm outline-none resize-y focus:border-[color:var(--theme-accent,#f54900)] placeholder:text-default-500"
                />
                {noteDirty && (
                  <div className="flex justify-end mt-1.5">
                    <button
                      onClick={saveNote}
                      disabled={noteSaving}
                      className="inline-flex items-center border border-white/[0.08] px-3 py-1 text-[11px] uppercase tracking-wider font-semibold text-default-300 hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.4)] hover:text-foreground disabled:opacity-50"
                    >
                      {noteSaving ? "Saving…" : "Save note"}
                    </button>
                  </div>
                )}
              </div>

              <p className="text-[11px] text-default-500 mt-4">
                First seen {formatRelative(fan.first_seen_at)} · Last active{" "}
                {formatRelative(fan.last_seen_at)}
              </p>
            </div>

            <div className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <PxActivity className="h-4 w-4" />
                <p className="text-[11px] uppercase tracking-wider text-default-500 font-semibold">
                  Event history
                </p>
              </div>

              {loading ? (
                <p className="text-xs text-default-400">Loading…</p>
              ) : eventsError ? (
                <p className="text-xs text-danger-400">
                  Couldn&apos;t load event history — try reopening the drawer.
                </p>
              ) : events.length === 0 ? (
                <p className="text-xs text-default-400">
                  No events recorded for this fan yet.
                </p>
              ) : (
                <motion.div
                  className="space-y-2"
                  initial="hidden"
                  animate="visible"
                  variants={{
                    hidden: {},
                    visible: { transition: { staggerChildren: 0.03 } },
                  }}
                >
                  {events.map((e) => (
                    <motion.div
                      key={e.id}
                      variants={{
                        hidden: { opacity: 0, x: 8 },
                        visible: { opacity: 1, x: 0 },
                      }}
                    >
                      <div className="border border-white/[0.06] p-3 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`font-semibold ${
                              EVENT_COLOR[e.event_type] || "text-foreground"
                            }`}
                          >
                            {e.event_type.replace(/_/g, " ")}
                          </span>
                          <span className="text-default-400">
                            {formatRelative(e.occurred_at || e.created_at)}
                          </span>
                        </div>
                        {e.payload?.amount ? (
                          <p className="text-default-300">
                            {formatDollars(Number(e.payload.amount))}
                          </p>
                        ) : null}
                        {e.payload?.text ? (
                          <p className="text-default-400 truncate">
                            {e.payload.text}
                          </p>
                        ) : null}
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Why the Tips/Spend tiles show "—" — same copy as the fans list column
 * (app/dashboard/fans/page.tsx). */
function spendUnknownTooltip(platform?: Platform): string {
  return platform === "fansly"
    ? "Fansly has no subscriber-list sync — spend is captured from tips/purchases as they arrive"
    : "Spend not synced for this account — run a subscriber refresh";
}

function Stat({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="border border-white/[0.06] p-2 text-center" title={title}>
      <p className="text-[10px] uppercase tracking-wider text-default-500">
        {label}
      </p>
      <p className="text-sm font-bold tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
