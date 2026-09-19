"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

import { PxActivity } from "@/components/ui/PixelIcons";
import { DataState } from "@/components/dashboard/DataState";
import { RealtimeIndicator } from "@/components/dashboard/RealtimeStatus";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useSSE, type LiveEvent } from "@/lib/hooks/use-sse";
import { useTour } from "@/lib/tour-context";
import { TOUR_EVENTS } from "@/lib/tour-fake-data";
import { parseUtc } from "@/lib/chat-utils";

const EVENT_TYPES = [
  { value: "new_subscriber", label: "New subscriber" },
  { value: "renewed_subscriber", label: "Renewed subscriber" },
  { value: "expired_subscriber", label: "Expired subscriber" },
  { value: "new_tip", label: "Tip" },
  { value: "new_message", label: "Message" },
  { value: "new_purchase", label: "Purchase" },
  { value: "balance_increased", label: "Balance increased" },
  { value: "polling_paused", label: "Polling paused" },
];

const CHIP_COLOR: Record<string, "success" | "warning" | "danger" | "primary" | "default"> = {
  new_subscriber: "success",
  renewed_subscriber: "primary",
  expired_subscriber: "danger",
  new_tip: "warning",
  new_message: "primary",
  new_purchase: "success",
  balance_increased: "success",
  polling_paused: "danger",
};

function formatEventLine(e: LiveEvent): string {
  const fan = e.payload?.fan || {};
  // Fansly events can carry only the sender id (username/display_name are null
  // until the next poll enriches the fan row) — show the id rather than an
  // anonymous "someone" so fans stay distinguishable. Mirrors LiveActivityCard.
  const who =
    fan.username ||
    fan.display_name ||
    (fan.id != null && fan.id !== "" ? String(fan.id) : "someone");
  const amt = e.payload?.amount;
  switch (e.event_type) {
    case "new_subscriber":
      return `${who} subscribed`;
    case "renewed_subscriber":
      return `${who} renewed`;
    case "expired_subscriber":
      return `${e.payload?.delta ?? 0} subscriber(s) expired`;
    case "new_tip":
      return `${who} tipped${amt ? ` $${amt}` : ""}`;
    case "new_message":
      return `${who} sent a message`;
    case "new_purchase":
      return `${who} purchased${amt ? ` for $${amt}` : ""}`;
    case "balance_increased":
      return `Balance increased by $${Number(e.payload?.delta || 0).toFixed(2)} (now $${Number(e.payload?.available || 0).toFixed(2)})`;
    case "polling_paused":
      return `Polling auto-paused (${e.payload?.failures || 0} failures)`;
    default:
      return e.payload?.text || e.event_type;
  }
}

export default function ActivityPage() {
  const api = useApiClient();
  const { isActive: isTourActive } = useTour();
  const [filter, setFilter] = useState<Set<string>>(new Set());
  const filterArray = useMemo(() => Array.from(filter), [filter]);
  const [history, setHistory] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  // A failed history fetch must not read as "no activity yet" — that sentence
  // is a claim about the operator's accounts, not about our request.
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const live = useSSE({
    types: filterArray.length ? filterArray : undefined,
    disabled: isTourActive,
  });

  useEffect(() => {
    if (isTourActive) {
      const filtered = filterArray.length
        ? TOUR_EVENTS.filter((e) => filterArray.includes(e.event_type))
        : TOUR_EVENTS;
      setHistory(filtered);
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      if (!api) return;
      setLoading(true);
      try {
        const data = await api.listEvents({
          types: filterArray.length ? filterArray : undefined,
          limit: 100,
        });
        if (!cancelled) {
          setHistory(data.events || []);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err);
          toast.error(err?.message || "Failed to load activity");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, filterArray.join(","), isTourActive, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge live events into history by id, newest first
  const merged = useMemo(() => {
    const seen = new Set<string>();
    const out: LiveEvent[] = [];
    const push = (e: LiveEvent) => {
      // Drop no-op balance_increased events (delta 0 / missing) — they render as
      // "$0.00 (now $0.00)" and drown out real activity. Mirrors the same guard
      // in LiveActivityCard.
      if (e.event_type === "balance_increased" && !Number(e.payload?.delta)) return;
      const key = String(e.id ?? `${e.event_type}:${e.source_event_id}`);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(e);
    };
    live.events.forEach(push);
    history.forEach(push);
    return out.slice(0, 250);
  }, [live.events, history]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2">Live activity</h2>
          <p className="text-sm text-default-500 mt-1">
            Events detected by the background poller across your accounts.{" "}
            <RealtimeIndicator />
          </p>
        </div>
        <Select
          data-tour="activity-filter"
          label="Filter"
          placeholder="All event types"
          selectionMode="multiple"
          selectedKeys={filter}
          onSelectionChange={(keys) => setFilter(new Set(keys as Set<string>))}
          className="w-64"
          size="sm"
        >
          {EVENT_TYPES.map((t) => (
            <SelectItem key={t.value}>{t.label}</SelectItem>
          ))}
        </Select>
      </div>

      <DataState
        loading={loading}
        error={error}
        isEmpty={merged.length === 0}
        onRetry={() => setReloadKey((k) => k + 1)}
        noun="activity"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={8} rowHeight={64} />
          </div>
        }
        icon={<PxActivity className="h-8 w-8" />}
        title="No activity yet"
        description="Enable polling on at least one account to start seeing events here."
      >
        <motion.div
          data-tour="activity-feed"
          className="space-y-2"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.02 } },
          }}
        >
          <AnimatePresence initial={false}>
            {merged.map((e) => (
              <motion.div
                key={String(e.id ?? `${e.event_type}:${e.source_event_id}`)}
                layout
                variants={{
                  hidden: { opacity: 0, y: -6 },
                  visible: { opacity: 1, y: 0 },
                }}
              >
                <Card className="bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none">
                  <CardBody className="p-3">
                    <button
                      className="w-full text-left flex items-center gap-3"
                      onClick={() =>
                        setExpanded((x) => (x === e.id ? null : e.id))
                      }
                    >
                      <Chip
                        size="sm"
                        variant="flat"
                        color={CHIP_COLOR[e.event_type] || "default"}
                      >
                        {e.event_type.replace(/_/g, " ")}
                      </Chip>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{formatEventLine(e)}</p>
                      </div>
                      <span className="text-xs text-default-400 whitespace-nowrap">
                        {(() => {
                          // parseUtc: the backend sends these without a
                          // timezone, and JS reads an offset-less date-TIME as
                          // LOCAL, shifting every event by the viewer's offset.
                          const ts = e.occurred_at || e.created_at;
                          return parseUtc(ts)?.toLocaleTimeString() ?? "";
                        })()}
                      </span>
                    </button>
                    {expanded === e.id && (
                      <pre className="mt-3 text-[11px] bg-black/40 p-3 overflow-x-auto border border-white/[0.06]">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    )}
                  </CardBody>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      </DataState>
    </div>
  );
}
