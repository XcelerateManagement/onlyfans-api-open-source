"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";

import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import {
  PxActivity,
  PxDollarSign,
  PxUser,
  PxUsers,
  PxMail,
  PxBanknote,
  PxTrendingUp,
  PxChevronDown,
  PxCopy,
  PxCheck,
} from "@/components/ui/PixelIcons";
import { RealtimeChip } from "@/components/dashboard/RealtimeStatus";
import { accordionVariants } from "@/lib/animations";
import { useSSE, type LiveEvent } from "@/lib/hooks/use-sse";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useTour } from "@/lib/tour-context";
import { TOUR_EVENTS } from "@/lib/tour-fake-data";
import { parseUtc } from "@/lib/chat-utils";

function FanTag({
  fan,
}: {
  fan: { id?: string | number | null; username?: string; display_name?: string };
}) {
  // Fansly WS events carry only the sender id (username/display_name are null
  // until the next poll enriches the fan row) — show the id rather than an
  // anonymous "someone" so fans stay distinguishable in the feed.
  const rawId = fan.id != null && fan.id !== "" ? String(fan.id) : null;
  const handle =
    fan.username ||
    fan.display_name ||
    (rawId && rawId.length > 10 ? rawId.slice(0, 8) + "…" : rawId) ||
    "someone";
  const known = !!(fan.username || fan.display_name);
  return (
    <span
      className="inline-flex items-baseline font-mono font-semibold align-baseline"
      style={{
        color: known ? "var(--theme-accent, #f54900)" : "rgb(115,115,115)",
      }}
    >
      {handle}
    </span>
  );
}

function Money({ value }: { value: number | string | undefined }) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (isNaN(n)) return null;
  return (
    <span className="font-mono font-semibold tabular-nums text-white">
      ${n.toFixed(2)}
    </span>
  );
}

function formatLine(e: LiveEvent): React.ReactNode {
  const fan = (e.payload?.fan || {}) as {
    id?: string | number | null;
    username?: string;
    display_name?: string;
  };
  const amt = e.payload?.amount;
  switch (e.event_type) {
    case "new_subscriber":
      return (
        <>
          <FanTag fan={fan} /> <span className="text-white/75">subscribed</span>
        </>
      );
    case "renewed_subscriber":
      return (
        <>
          <FanTag fan={fan} /> <span className="text-white/75">renewed</span>
        </>
      );
    case "expired_subscriber":
      return (
        <span className="text-white/75">
          <span className="font-mono font-semibold text-white">
            {e.payload?.delta ?? 0}
          </span>{" "}
          subscriber(s) expired
        </span>
      );
    case "new_tip":
      return (
        <>
          <FanTag fan={fan} /> <span className="text-white/75">tipped</span>
          {amt ? (
            <>
              {" "}
              <Money value={amt} />
            </>
          ) : null}
        </>
      );
    case "new_message":
      return (
        <>
          <FanTag fan={fan} /> <span className="text-white/75">sent a message</span>
        </>
      );
    case "new_purchase":
      return (
        <>
          <FanTag fan={fan} /> <span className="text-white/75">purchased</span>
          {amt ? (
            <>
              {" "}
              <span className="text-white/75">for</span> <Money value={amt} />
            </>
          ) : null}
        </>
      );
    case "balance_increased":
      return (
        <>
          <span className="text-white/75">Balance</span>{" "}
          <span className="font-mono font-semibold text-green-400">
            +${Number(e.payload?.delta || 0).toFixed(2)}
          </span>
        </>
      );
    default:
      return (
        <span className="text-white/75">
          {e.event_type.replace(/_/g, " ")}
        </span>
      );
  }
}

function eventIcon(type: string) {
  switch (type) {
    case "new_tip":
      return <PxDollarSign className="h-3.5 w-3.5" />;
    case "new_subscriber":
      return <PxUser className="h-3.5 w-3.5" />;
    case "renewed_subscriber":
      return <PxUsers className="h-3.5 w-3.5" />;
    case "expired_subscriber":
      return <PxUsers className="h-3.5 w-3.5" />;
    case "new_message":
      return <PxMail className="h-3.5 w-3.5" />;
    case "new_purchase":
      return <PxBanknote className="h-3.5 w-3.5" />;
    case "balance_increased":
      return <PxTrendingUp className="h-3.5 w-3.5" />;
    default:
      return <PxActivity className="h-3.5 w-3.5" />;
  }
}

function relativeTime(ts?: string | null): string {
  if (!ts) return "";
  // parseUtc, not `new Date(ts)`. The backend sends timestamps without a
  // timezone ("2026-08-05T16:19:13"), and JS parses a date-TIME string with no
  // offset as LOCAL time — so in UTC+2 every event read two hours older than it
  // was, and the clock times beside them were wrong by the same amount.
  const at = parseUtc(ts);
  if (!at) return "";
  const diff = Date.now() - at.getTime();
  if (diff < 0 || isNaN(diff)) return "";
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * How far `occurred_at` may lag `created_at` before we stop calling it live.
 *
 * A poll can only notice something after it happened, so a few minutes of gap
 * is normal. A gap of hours or days means we learned about it in bulk — a first
 * poll seeding, a backfill, a re-sync — and presenting that as live activity is
 * how a two-week-old purchase ended up at the top of a feed labelled "Live".
 */
const BACKFILL_GAP_MS = 60 * 60 * 1000;

/** True when this row is history we only just learned about, not live activity. */
function isBackfilled(e: LiveEvent): boolean {
  const happened = parseUtc(e.occurred_at);
  const learned = parseUtc(e.created_at);
  if (!happened || !learned) return false;
  return learned.getTime() - happened.getTime() > BACKFILL_GAP_MS;
}

function eventKey(e: LiveEvent): string {
  return String(e.id ?? `${e.event_type}:${e.source_event_id ?? ""}`);
}

export function LiveActivityCard() {
  const api = useApiClient();
  const { isActive: isTourActive } = useTour();
  const { events: liveEvents } = useSSE({
    bufferSize: 10,
    disabled: isTourActive,
  });
  const [seed, setSeed] = useState<LiveEvent[]>([]);
  const [pulseKey, setPulseKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (isTourActive) {
      setSeed(TOUR_EVENTS);
      return;
    }
    if (!api) return;
    let cancelled = false;
    api
      .listEvents({ limit: 100 })
      .then((r) => {
        // 100, not 12: the feed shows 12 but filters history out first, and a
        // first-poll flood can easily be 100+ backdated rows deep. Fetching only
        // a page of 12 would leave the card empty while real live events sat
        // just below the cut.
        if (!cancelled) setSeed((r.events || []) as LiveEvent[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, isTourActive]);

  // Tick once a minute so relative timestamps refresh.
  useEffect(() => {
    const t = setInterval(() => forceTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // How many rows the backfill filter removed — lets the empty state say
  // "nothing has happened YET" instead of the misleading "no events yet",
  // which reads as though polling were off.
  let hiddenHistory = 0;

  const events = (() => {
    const byId = new Map<string, LiveEvent>();
    for (const e of [...liveEvents, ...seed]) {
      const k = eventKey(e);
      if (!byId.has(k)) byId.set(k, e);
    }
    const sorted = Array.from(byId.values())
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    const filtered: LiveEvent[] = [];
    let seenPollingPaused = false;
    for (const ev of sorted) {
      // History does not belong in a card called "Live". A first poll, a
      // re-sync or a backfill can hand us weeks-old purchases with brand-new
      // ids, which is how a 13-day-old row ended up at the top of this feed.
      // Those events are real and are kept everywhere else — the Activity
      // page, fans, earnings — they are simply not live activity.
      if (isBackfilled(ev)) {
        hiddenHistory += 1;
        continue;
      }
      if (ev.event_type === "balance_increased" && !Number(ev.payload?.delta)) continue;
      if (ev.event_type === "polling_paused") {
        if (seenPollingPaused) continue;
        seenPollingPaused = true;
      }
      filtered.push(ev);
      if (filtered.length >= 12) break;
    }
    return filtered;
  })();

  const lastId = liveEvents[0]?.id ?? null;
  useEffect(() => {
    if (lastId) setPulseKey((k) => k + 1);
  }, [lastId]);

  const copyJson = (e: LiveEvent) => {
    const k = eventKey(e);
    navigator.clipboard.writeText(JSON.stringify(e.payload ?? {}, null, 2));
    setCopiedId(k);
    setTimeout(() => setCopiedId((c) => (c === k ? null : c)), 1800);
  };

  return (
    <GlassCard delay={0.07} className="flex flex-col">
      <GlassCardHeader className="!px-4 !py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PxActivity className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">
              Live activity
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Panel-wide: this card aggregates every account's events. The
                chip reports whether any account can actually produce one, not
                merely whether our own SSE socket is open. */}
            <RealtimeChip pulseKey={pulseKey} />
            <Link
              href="/dashboard/activity"
              className="text-[10px] text-[color:var(--theme-accent,#f54900)] hover:underline font-semibold uppercase tracking-wider"
            >
              View all →
            </Link>
          </div>
        </div>
      </GlassCardHeader>

      <GlassCardBody className="!p-0 flex flex-col">
        {events.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-10">
            <p className="text-xs text-default-500 text-center max-w-[22rem] leading-relaxed">
              {hiddenHistory > 0 ? (
                <>
                  Nothing has happened yet since polling started.
                  <span className="block mt-1 text-default-600">
                    {hiddenHistory} older {hiddenHistory === 1 ? "event" : "events"} from
                    before that are on the{" "}
                    <Link
                      href="/dashboard/activity"
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      activity page
                    </Link>
                    . New tips, purchases and subscribers will appear here as they land.
                  </span>
                </>
              ) : (
                <>No events yet. Enable polling on an account to see activity here.</>
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-y-auto styled-scrollbar max-h-[34rem]">
            <AnimatePresence initial={false}>
              {events.map((e) => {
                const k = eventKey(e);
                const isOpen = expandedId === k;
                const ts = e.occurred_at || e.created_at;
                return (
                  <motion.div
                    key={k}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="border-b border-white/[0.04] last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : k)}
                      className="w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <span
                        className="shrink-0 flex items-center justify-center h-7 w-7 border"
                        style={{
                          backgroundColor:
                            "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.08)",
                          borderColor: "rgba(255,255,255,0.06)",
                          color: "var(--theme-accent, #f54900)",
                        }}
                      >
                        {eventIcon(e.event_type)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm leading-snug whitespace-nowrap overflow-hidden text-ellipsis">
                          {formatLine(e)}
                        </span>
                        <span className="block text-[10px] text-default-400 uppercase tracking-wider mt-0.5 truncate">
                          {e.event_type.replace(/_/g, " ")}
                          {ts && (
                            <>
                              <span className="mx-1.5 opacity-50">·</span>
                              {relativeTime(ts)}
                            </>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 flex items-center gap-2 pt-0.5">
                        <span className="text-[11px] font-mono text-default-400 tabular-nums">
                          {parseUtc(ts)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? ""}
                        </span>
                        <motion.span
                          animate={{ rotate: isOpen ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                          className="text-default-400"
                        >
                          <PxChevronDown className="h-3 w-3" />
                        </motion.span>
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial="closed"
                          animate="open"
                          exit="closed"
                          variants={accordionVariants}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-3 pt-1 space-y-2">
                            <div className="text-[10px] font-mono text-default-500 leading-relaxed break-all">
                              <span className="text-default-400">id:</span>{" "}
                              {e.id ?? "—"}
                              <span className="mx-1.5 opacity-50">·</span>
                              <span className="text-default-400">type:</span>{" "}
                              {e.event_type}
                              <span className="mx-1.5 opacity-50">·</span>
                              <span className="text-default-400">src:</span>{" "}
                              {e.source_event_id ?? "—"}
                              {ts && (
                                <>
                                  <span className="mx-1.5 opacity-50">·</span>
                                  <span className="text-default-400">at:</span>{" "}
                                  {parseUtc(ts)?.toISOString() ?? "—"}
                                </>
                              )}
                            </div>
                            <div className="relative">
                              <pre className="text-[11px] font-mono bg-black/40 border border-white/[0.08] p-2.5 max-h-48 overflow-auto whitespace-pre text-white/80">
                                {JSON.stringify(e.payload ?? {}, null, 2)}
                              </pre>
                              <Tooltip
                                content={copiedId === k ? "Copied!" : "Copy JSON"}
                                placement="top"
                                delay={300}
                                classNames={{
                                  content:
                                    "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs",
                                }}
                              >
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="bordered"
                                  onPress={() => copyJson(e)}
                                  className="!rounded-none border-white/[0.08] min-w-7 w-7 h-7 absolute top-1.5 right-1.5 bg-[#0d0d0d]"
                                >
                                  {copiedId === k ? (
                                    <PxCheck className="h-3 w-3 text-green-400" />
                                  ) : (
                                    <PxCopy className="h-3 w-3" />
                                  )}
                                </Button>
                              </Tooltip>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </GlassCardBody>
    </GlassCard>
  );
}
