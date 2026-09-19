"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Button } from "@heroui/button";
import toast from "react-hot-toast";

import { PxUsers, PxSearch } from "@/components/ui/PixelIcons";
import { DataState } from "@/components/dashboard/DataState";
import { RealtimeIndicator } from "@/components/dashboard/RealtimeStatus";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { FanTagEditor } from "@/components/dashboard/FanTagEditor";
import { OfListBadges } from "@/components/dashboard/OfListBadges";
import { FanDrawer } from "@/components/dashboard/FanDrawer";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useSSE } from "@/lib/hooks/use-sse";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { parseUtc } from "@/lib/chat-utils";
import { useTour } from "@/lib/tour-context";
import { TOUR_ACCOUNTS, TOUR_FANS } from "@/lib/tour-fake-data";

type SortKey = "last_seen" | "first_seen" | "tips" | "spend" | "events";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "tips", label: "Most tips" },
  { key: "spend", label: "Highest spend" },
  { key: "events", label: "Most engaged" },
  { key: "last_seen", label: "Recently active" },
  { key: "first_seen", label: "Newest" },
];

function formatDollars(n: number | undefined | null): string {
  return (Number(n) || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatRelative(iso: string | null | undefined): string {
  const d = parseUtc(iso);
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString();
}

export default function FansPage() {
  const api = useApiClient();
  const { accounts: realAccounts } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const accounts = isTourActive ? TOUR_ACCOUNTS : realAccounts;
  const [fans, setFans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Kept so an empty list is never rendered as "no fans" when the request
  // simply failed (a 429 on click-through is the common case).
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [sort, setSort] = useState<SortKey>("tips");
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [drawerFan, setDrawerFan] = useState<any | null>(null);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const f of fans) {
      for (const t of f.tags || []) s.add(t);
      for (const t of f.of_lists || []) s.add(t); // auto-imported OF groups
    }
    return Array.from(s).sort();
  }, [fans]);

  const refresh = useCallback(async () => {
    if (isTourActive) {
      // Local filter/sort over the canned data so the controls still feel live.
      let result = [...TOUR_FANS];
      if (accountFilter) result = result.filter((f) => f.of_user_id === accountFilter);
      if (tagFilter) result = result.filter((f) => (f.tags || []).includes(tagFilter));
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.toLowerCase().trim();
        result = result.filter(
          (f) =>
            f.username.toLowerCase().includes(q) ||
            (f.display_name || "").toLowerCase().includes(q),
        );
      }
      const sortKey = sort;
      result.sort((a, b) => {
        if (sortKey === "tips") return b.total_tips - a.total_tips;
        if (sortKey === "spend") return b.total_spend - a.total_spend;
        if (sortKey === "events") return b.total_events - a.total_events;
        if (sortKey === "first_seen") {
          return new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
        }
        return new Date(b.last_event_at).getTime() - new Date(a.last_event_at).getTime();
      });
      setFans(result);
      setLoading(false);
      return;
    }
    if (!api) return;
    setLoading(true);
    try {
      const res = await api.listFans({
        sort,
        of_user_id: accountFilter || undefined,
        search: debouncedSearch.trim() || undefined,
        tag: tagFilter || undefined,
        limit: 200,
      });
      setFans(res.fans || []);
      setError(null);
    } catch (err: any) {
      setError(err);
      toast.error(err?.message || "Failed to load fans");
    } finally {
      setLoading(false);
    }
  }, [api, sort, accountFilter, debouncedSearch, tagFilter, isTourActive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // "/" keyboard shortcut focuses the search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[data-fans-search="1"]')?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Live refresh on any event that could create/update fans
  const { events } = useSSE({
    types: ["new_tip", "new_subscriber", "renewed_subscriber", "new_purchase", "new_message"],
    bufferSize: 10,
    disabled: isTourActive,
  });
  const lastEventId = events[0]?.id ?? null;
  useEffect(() => {
    if (lastEventId) refresh();
  }, [lastEventId]); // eslint-disable-line react-hooks/exhaustive-deps

  function patchFan(updated: any) {
    setFans((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    if (drawerFan && drawerFan.id === updated.id) setDrawerFan(updated);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2">Fans</h2>
          <p className="text-sm text-default-500 mt-1">
            {fans.length} tracked across{" "}
            {accounts.length} account{accounts.length === 1 ? "" : "s"} ·{" "}
            {/* Scoped to the account filter when one is set, so the badge
                describes the feed the operator is actually looking at. */}
            <RealtimeIndicator scope={accountFilter || undefined} />
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2" data-tour="fans-search">
        <Input
          placeholder='Search username (press "/")'
          value={search}
          onValueChange={setSearch}
          startContent={<PxSearch className="h-4 w-4 text-default-400" />}
          size="sm"
          variant="bordered"
          data-fans-search="1"
          classNames={{
            inputWrapper: "bg-black/20 border-white/[0.08] !rounded-none",
          }}
          className="max-w-xs"
        />
        <Select
          size="sm"
          selectedKeys={new Set([sort])}
          onSelectionChange={(k) => {
            const v = Array.from(k as Set<string>)[0] as SortKey;
            if (v) setSort(v);
          }}
          variant="bordered"
          radius="none"
          className="max-w-[180px]"
          aria-label="Sort"
        >
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.key}>{o.label}</SelectItem>
          ))}
        </Select>
        <Select
          size="sm"
          placeholder="All accounts"
          selectedKeys={accountFilter ? new Set([accountFilter]) : new Set()}
          onSelectionChange={(k) => {
            const v = Array.from(k as Set<string>)[0];
            setAccountFilter(v || "");
          }}
          variant="bordered"
          radius="none"
          className="max-w-[200px]"
          aria-label="Account"
        >
          {accounts.map((a) => (
            <SelectItem key={a.of_user_id}>
              {a.username || a.email}
            </SelectItem>
          ))}
        </Select>
        {allTags.length > 0 && (
          <Select
            size="sm"
            placeholder="Any tag"
            selectedKeys={tagFilter ? new Set([tagFilter]) : new Set()}
            onSelectionChange={(k) => {
              const v = Array.from(k as Set<string>)[0];
              setTagFilter(v || "");
            }}
            variant="bordered"
            radius="none"
            className="max-w-[160px]"
            aria-label="Tag"
          >
            {allTags.map((t) => (
              <SelectItem key={t}>{t}</SelectItem>
            ))}
          </Select>
        )}
        {(search || accountFilter || tagFilter) && (
          <Button
            size="sm"
            variant="flat"
            radius="none"
            onPress={() => {
              setSearch("");
              setAccountFilter("");
              setTagFilter("");
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <DataState
        loading={loading}
        error={error}
        isEmpty={fans.length === 0}
        onRetry={refresh}
        noun="fans"
        skeleton={
          <div className="border border-white/[0.06] bg-[#0d0d0d]">
            <SkeletonList rows={8} rowHeight={56} />
          </div>
        }
        icon={<PxUsers className="h-8 w-8" />}
        title={search || tagFilter ? "No fans match your filters" : "No fans tracked yet"}
        description={
          search || tagFilter
            ? "Try clearing the filters."
            : "Fans appear here as the poller detects tips, messages, and subscriptions."
        }
      >
        <div className="border border-white/[0.06] bg-[#0d0d0d] overflow-x-auto overflow-y-hidden max-w-[1100px]" data-tour="fans-list">
          <div className="min-w-[640px]">
          {/* Column header */}
          <div className="grid grid-cols-[auto_minmax(160px,280px)_auto_1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/[0.06] text-[10px] uppercase tracking-wider text-default-500 font-semibold">
            <span></span>
            <span>Fan</span>
            <span>Tags</span>
            <span aria-hidden></span>
            <span className="text-right w-20">Spend</span>
            <span className="text-right w-16">Tips</span>
            <span className="text-right w-24">Last</span>
          </div>
          <motion.div
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.02 } },
            }}
          >
            <AnimatePresence initial={false}>
              {fans.map((f) => (
                <motion.button
                  key={f.id}
                  variants={{
                    hidden: { opacity: 0, y: 4 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDrawerFan(f)}
                  className="w-full grid grid-cols-[auto_minmax(160px,280px)_auto_1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors text-left last:border-b-0"
                >
                  <FanAvatar
                    username={f.username}
                    displayName={f.display_name}
                    avatar={f.avatar}
                    size={28}
                  />
                  <div className="min-w-0">
                    {f.display_name || f.username ? (
                      <>
                        <p className="text-sm font-medium truncate">
                          {f.display_name || f.username}
                        </p>
                        <p
                          className="text-[11px] text-default-400 truncate"
                          title={f.username ? undefined : `Fan ID ${f.fan_of_user_id}`}
                        >
                          {f.username ? `@${f.username}` : "—"}
                        </p>
                      </>
                    ) : (
                      /* Fansly fans harvested from wallet transactions can carry
                         only a numeric snowflake id — don't print it as a name. */
                      <p
                        className="text-sm font-medium text-default-500 truncate"
                        title={`Fan ID ${f.fan_of_user_id}`}
                      >
                        Unknown fan
                      </p>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1 flex-wrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <OfListBadges
                      lists={f.of_lists}
                      onListClick={(n) =>
                        setTagFilter((cur) => (cur === n ? "" : n))
                      }
                      activeTag={tagFilter}
                      compact
                    />
                    <FanTagEditor
                      fanOfUserId={f.fan_of_user_id}
                      ofUserId={f.of_user_id}
                      tags={f.tags || []}
                      onChange={(tags) => patchFan({ ...f, tags })}
                      onTagClick={(t) =>
                        setTagFilter((cur) => (cur === t ? "" : t))
                      }
                      activeTag={tagFilter}
                      compact
                    />
                  </div>
                  <span aria-hidden />
                  <span
                    className="text-sm tabular-nums text-right w-20"
                    title={
                      f.spend_known
                        ? undefined
                        : accounts.find(
                              (a) => String(a.of_user_id) === String(f.of_user_id)
                            )?.platform === "fansly"
                          ? "Fansly has no subscriber-list sync — spend is captured from tips/purchases as they arrive"
                          : "Spend not synced for this account — run a subscriber refresh"
                    }
                  >
                    {f.spend_known ? (
                      formatDollars(f.total_spend)
                    ) : (
                      <span className="text-default-500">—</span>
                    )}
                  </span>
                  <span
                    className="text-sm tabular-nums text-right w-16"
                    style={{
                      color:
                        f.spend_known && Number(f.total_tips) > 0
                          ? "var(--theme-accent, #f54900)"
                          : undefined,
                    }}
                  >
                    {f.spend_known ? (
                      formatDollars(f.total_tips)
                    ) : (
                      <span className="text-default-500">—</span>
                    )}
                  </span>
                  <span className="text-xs text-default-400 text-right w-24 tabular-nums">
                    {formatRelative(f.last_event_at || f.last_seen_at)}
                  </span>
                </motion.button>
              ))}
            </AnimatePresence>
          </motion.div>
          </div>
        </div>
      </DataState>

      <FanDrawer
        fan={drawerFan}
        onClose={() => setDrawerFan(null)}
        onUpdate={patchFan}
        // Platform of the account this fan belongs to — drives the drawer's
        // lists heading ("Fansly lists" vs "OnlyFans lists") and the
        // spend-unknown tooltip copy. Undefined → OnlyFans copy.
        platform={
          accounts.find(
            (a) => String(a.of_user_id) === String(drawerFan?.of_user_id)
          )?.platform
        }
      />
    </div>
  );
}
