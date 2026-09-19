"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from "@heroui/table";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Chip } from "@heroui/chip";
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "@heroui/modal";
import { useDisclosure } from "@heroui/use-disclosure";
import { PxMegaphone, PxPlus, PxEye, PxCopy, PxCheck, PxRefresh } from "@/components/ui/PixelIcons";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { useAccounts } from "@/lib/hooks/use-selected-account";
import { useRefreshJobs } from "@/lib/hooks/use-refresh-jobs";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useTour } from "@/lib/tour-context";
import {
  TOUR_ACCOUNTS,
  TOUR_CAMPAIGNS,
  TOUR_CAMPAIGNS_CACHE,
  TOUR_CAMPAIGNS_EARNINGS,
} from "@/lib/tour-fake-data";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { DataState } from "@/components/dashboard/DataState";
import { RefreshProgressBar } from "@/components/dashboard/RefreshProgressBar";
import { ClaimerDetailDrawer } from "@/components/dashboard/ClaimerDetailDrawer";
import { CampaignTagEditor } from "@/components/dashboard/CampaignTagEditor";
import { DataTableToolbar } from "@/components/dashboard/DataTableToolbar";
import { accountSupports, platformLabel } from "@/lib/platform-capabilities";
import type { CampaignEarnings } from "@/lib/api-client";
import toast from "react-hot-toast";

type SortKey = "created" | "name" | "clicks" | "subscribers" | "earnings";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "created", label: "Newest" },
  { key: "name", label: "Name (A-Z)" },
  { key: "clicks", label: "Most clicks" },
  { key: "subscribers", label: "Most subscribers" },
  { key: "earnings", label: "Top earnings" },
];

/** Walk no more than this many campaigns up front before falling back to the
 *  manual "Load More" button. Keeps client-side filtering instant for the
 *  common case without an unbounded fan-out for the rare huge account. */
const AUTO_LOAD_CAP = 300;

// Campaign stat accessors — OF returns either a number or a {count} object.
const subsOf = (c: any): number =>
  typeof c?.countSubscribers === "object"
    ? c.countSubscribers?.count ?? 0
    : c?.countSubscribers ?? 0;
const clicksOf = (c: any): number =>
  typeof c?.countTransitions === "object"
    ? c.countTransitions?.count ?? 0
    : c?.countTransitions ?? 0;

function money(n?: number | null): string {
  const v = Number(n ?? 0);
  if (!isFinite(v) || v === 0) return "$0";
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "—";
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function CampaignsPage() {
  const api = useApiClient();
  const { selectedAccount: realSelectedAccount } = useAccounts();
  const { isActive: isTourActive } = useTour();
  const selectedAccount = isTourActive
    ? (realSelectedAccount ?? TOUR_ACCOUNTS[0])
    : realSelectedAccount;
  const { isOpen, onOpen, onClose } = useDisclosure();
  const refreshJobs = useRefreshJobs();

  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Separates "this account has no tracking links" from "we couldn't ask it".
  const [error, setError] = useState<unknown>(null);
  const [offset, setOffset] = useState(0);

  const [newName, setNewName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Search / filter / sort (all client-side over the eager-loaded set)
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const [sort, setSort] = useState<SortKey>("created");
  const [tagFilter, setTagFilter] = useState<string>("");

  // Campaign tags — { campaign_id: [tag, ...] }, loaded once per account.
  const [tagsByCampaign, setTagsByCampaign] = useState<Record<string, string[]>>({});

  // Earnings (from the JOIN) — keyed by campaign_id string so we can merge
  // into each live-campaign row.
  const [earningsByCampaign, setEarningsByCampaign] = useState<
    Record<string, CampaignEarnings>
  >({});
  const [earningsCacheMeta, setEarningsCacheMeta] = useState<{
    campaigns: number; claimers: number; last_refreshed_at: string | null;
  } | null>(null);

  // Claimers modal
  const {
    isOpen: isClaimersOpen,
    onOpen: onClaimersOpen,
    onClose: onClaimersClose,
  } = useDisclosure();
  const [claimersCampaign, setClaimersCampaign] = useState<any>(null);
  const [claimers, setClaimers] = useState<any[]>([]);
  const [claimersLoading, setClaimersLoading] = useState(false);
  const [claimersHasMore, setClaimersHasMore] = useState(false);
  const [claimersOffset, setClaimersOffset] = useState(0);

  // Fan detail drawer (opens on claimer click)
  const [activeClaimer, setActiveClaimer] = useState<any | null>(null);

  const uid = selectedAccount?.of_user_id ? String(selectedAccount.of_user_id) : null;
  // Campaign LISTING is capability-gated (both platforms serve it now: OF
  // campaigns, Fansly live tracking links). CREATION is a separate capability —
  // the backend 501s POST /campaigns for Fansly (never POSTs to Fansly), so the
  // create affordances swap to a clean note when campaigns_create is false.
  const campaignsSupported = accountSupports(selectedAccount, "campaigns");
  const campaignsCreateOk = accountSupports(selectedAccount, "campaigns_create");
  // Known connection failures are actionable account states, not a reason to
  // keep issuing live campaign reads every time this page mounts.
  const connectionState = selectedAccount?.connection_state as string | undefined;
  const connectionHealthy = !connectionState || connectionState === "connected";
  const campaignsLoadable = campaignsSupported && connectionHealthy;
  // Presentation split: the claimer-cache machinery (Refresh earnings, the
  // claimers modal, OF-style share links) is OF-only — Fansly serves earnings
  // live per link with no claimer enumeration (claimers route 501s) and no
  // public link code on the row.
  const isFansly = selectedAccount?.platform === "fansly";
  const campaignsJob = uid ? refreshJobs.get(uid, "campaigns") : null;
  const campaignsBusy = !!campaignsJob && campaignsJob.phase !== "complete";
  const subsJob = uid ? refreshJobs.get(uid, "subs") : null;

  const buildCampaignLink = (c: any) => {
    // OF-only URL scheme — Fansly rows carry no shareable code (campaignCode
    // is null), and falling through to `c.id` would fabricate a bogus link.
    if (isFansly) return null;
    const code = c?.campaignCode || c?.shortLink || c?.id;
    const username = selectedAccount?.username;
    if (!username || !code) return null;
    return `https://onlyfans.com/${username}/c${code}`;
  };

  const copyLink = async (c: any) => {
    const link = buildCampaignLink(c);
    if (!link) {
      toast.error("Link unavailable");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(String(c.id));
      toast.success("Link copied");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const fetchCampaigns = useCallback(async (newOffset = 0) => {
    if (isTourActive) {
      setCampaigns(TOUR_CAMPAIGNS);
      setHasMore(false);
      setOffset(TOUR_CAMPAIGNS.length);
      setLoading(false);
      return;
    }
    if (!api || !uid || !campaignsLoadable) return;
    setLoading(true);
    try {
      if (newOffset === 0) {
        // Eager-walk every page so client-side search/filter/sort covers the
        // full set (campaigns are OF-paged with no searchable endpoint).
        // Progressive setCampaigns fills the table as pages arrive.
        let acc: any[] = [];
        let off = 0;
        let more = true;
        while (more && acc.length < AUTO_LOAD_CAP) {
          const data = await api.getCampaigns(uid, 50, off);
          const page = data.campaigns ?? [];
          acc = [...acc, ...page];
          off += page.length;
          more = !!data.hasMore && page.length > 0;
          setCampaigns(acc);
        }
        // hasMore stays true only if we stopped at the cap with rows remaining.
        setHasMore(more);
        setOffset(off);
      } else {
        const data = await api.getCampaigns(uid, 50, newOffset);
        setCampaigns((prev) => [...prev, ...(data.campaigns ?? [])]);
        setHasMore(data.hasMore);
        setOffset(newOffset + (data.campaigns?.length ?? 0));
      }
      setError(null);
    } catch (err: any) {
      setError(err);
      toast.error(err?.message || "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [api, uid, isTourActive, campaignsLoadable]);

  const fetchCampaignTags = useCallback(async () => {
    if (isTourActive) {
      setTagsByCampaign({});
      return;
    }
    if (!api || !uid || !campaignsLoadable) return;
    try {
      const res = await api.getCampaignTags(uid);
      setTagsByCampaign(res.tags || {});
    } catch {
      // Non-fatal — the TAGS column just shows the "+ tag" affordance.
    }
  }, [api, uid, isTourActive, campaignsLoadable]);

  const fetchEarnings = useCallback(async () => {
    if (isTourActive) {
      const map: Record<string, CampaignEarnings> = {};
      for (const row of TOUR_CAMPAIGNS_EARNINGS) map[String(row.campaign_id)] = row;
      setEarningsByCampaign(map);
      setEarningsCacheMeta(TOUR_CAMPAIGNS_CACHE);
      return;
    }
    if (!api || !uid || !campaignsLoadable) return;
    try {
      const res = await api.getCampaignsEarnings(uid);
      const map: Record<string, CampaignEarnings> = {};
      for (const row of res.earnings) map[String(row.campaign_id)] = row;
      setEarningsByCampaign(map);
      setEarningsCacheMeta(res.cache);
    } catch {
      // Non-fatal — earnings column just shows "—"
    }
  }, [api, uid, isTourActive, campaignsLoadable]);

  useEffect(() => {
    setCampaigns([]);
    setOffset(0);
    setTagsByCampaign({});
    setEarningsByCampaign({});
    setEarningsCacheMeta(null);
    // Unsupported platform (e.g. Fansly): fire NO requests — the capability
    // EmptyState below is the only surface, never a raw 501 toast.
    if (!campaignsLoadable) return;
    fetchCampaigns(0);
    fetchEarnings();
    fetchCampaignTags();
  }, [uid, campaignsLoadable]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a campaigns refresh job completes, re-fetch earnings
  const campaignsCompletedAt =
    campaignsJob?.phase === "complete" ? campaignsJob.completed_at : null;
  useEffect(() => {
    if (campaignsCompletedAt) fetchEarnings();
  }, [campaignsCompletedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-trigger a campaigns refresh after a successful subs refresh.
  // Rationale: a fresh subs_cache is useless for the earnings JOIN until
  // campaign_claimers_cache is also populated. Users who click "Refresh subs"
  // on the accounts page and then navigate here would otherwise see stale
  // earnings until they also click "Refresh earnings" — which they keep
  // forgetting. We auto-kick only if there's meaningful work to do.
  const subsCompletedAt =
    subsJob?.phase === "complete" && subsJob.success ? subsJob.completed_at : null;
  useEffect(() => {
    if (!subsCompletedAt || !api || !uid || !campaignsLoadable) return;
    // Don't auto-kick if a campaigns job is already running, or if there are
    // no campaigns with active subscribers to bother walking.
    if (campaignsBusy) return;
    const hasLiveCampaign = campaigns.some((c) => {
      const subs = typeof c.countSubscribers === "object"
        ? c.countSubscribers?.count ?? 0
        : c.countSubscribers ?? 0;
      return subs > 0;
    });
    if (!hasLiveCampaign) return;
    (async () => {
      try {
        const res = await api.refreshAllCampaigns(uid);
        if (!res.already_running) {
          toast("Subs updated — recomputing campaign earnings", { icon: "↻" });
        }
      } catch {
        // non-fatal — user can click Refresh earnings manually
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsCompletedAt]);

  const openClaimers = async (campaign: any) => {
    setClaimersCampaign(campaign);
    setClaimers([]);
    setClaimersOffset(0);
    onClaimersOpen();
    await fetchClaimers(campaign.id, 0);
  };

  /** Pulls from the cached endpoint first (rich: joined with subs_cache +
   *  tx_cache). Falls back to the live endpoint if the cache is empty for
   *  this campaign. */
  const fetchClaimers = async (campaignId: string, newOffset: number) => {
    if (!api || !uid) return;
    setClaimersLoading(true);
    try {
      const cached = await api.getCachedCampaignClaimers(uid, campaignId, {
        limit: 50, offset: newOffset,
      });
      if (cached.total > 0) {
        setClaimers((prev) => (newOffset === 0 ? cached.list : [...prev, ...cached.list]));
        setClaimersHasMore(cached.hasMore);
        setClaimersOffset(newOffset + (cached.list?.length ?? 0));
      } else {
        // Cache empty → live fetch (shape differs, no spending per row)
        const live = await api.getCampaignClaimers(uid, campaignId, 50, newOffset);
        // Normalise shape minimally so the table renders
        const rows = (live.claimers || []).map((c: any) => ({
          fan_of_user_id: String(c.id),
          fan_username: c.username,
          display_name: c.name,
          avatar: c.avatar,
          subscribed_at: c.subscribedAt || c.startDate || null,
          total_spent: null,
          spent_messages: null, spent_tips: null, spent_posts: null, spent_streams: null,
          mapped_spent: 0,
          _live_only: true,
        }));
        setClaimers((prev) => (newOffset === 0 ? rows : [...prev, ...rows]));
        setClaimersHasMore(live.hasMore);
        setClaimersOffset(newOffset + rows.length);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to load campaign claimers");
    } finally {
      setClaimersLoading(false);
    }
  };

  const handleRefreshCampaigns = async () => {
    if (!api || !uid) return;
    try {
      const res = await api.refreshAllCampaigns(uid);
      if (res.already_running) toast("Already refreshing…");
      else toast.success("Campaigns refresh started");
    } catch (err: any) {
      toast.error(err?.message || "Refresh failed");
    }
  };

  const handleCreate = async () => {
    if (!api || !uid || !newName) return;
    setCreateLoading(true);
    try {
      const result: any = await api.createCampaign(uid, newName);
      const created = result?.campaigns || result?.campaign || result;
      const link = buildCampaignLink(created);
      if (link) {
        try {
          await navigator.clipboard.writeText(link);
          toast.success("Campaign created — link copied");
        } catch {
          toast.success("Campaign created!");
        }
      } else {
        toast.success("Campaign created!");
      }
      setNewName("");
      onClose();
      fetchCampaigns(0);
    } catch (err: any) {
      // WRITES_DISABLED is handled globally (WritesDisabledWatcher) — skip the
      // redundant generic toast.
      if (err?.data?.code === "WRITES_DISABLED") return;
      toast.error(err?.message || "Failed to create campaign");
    } finally {
      setCreateLoading(false);
    }
  };

  // Aggregates for the header
  const agg = useMemo(() => {
    const vals = Object.values(earningsByCampaign);
    const total = vals.reduce((s, e) => s + (e.total_spent || 0), 0);
    const claimers = vals.reduce((s, e) => s + (e.claimers_count || 0), 0);
    return { total, claimers, campaignsWithEarnings: vals.filter(e => e.total_spent > 0).length };
  }, [earningsByCampaign]);

  // Distinct tag universe for the filter dropdown (mirrors fans/page.tsx).
  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const arr of Object.values(tagsByCampaign)) for (const t of arr) s.add(t);
    return Array.from(s).sort();
  }, [tagsByCampaign]);

  // Client-side search + tag filter + sort over the eager-loaded set.
  const filteredCampaigns = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let result = campaigns.filter((c) => {
      if (q) {
        const name = String(c.campaignName ?? "").toLowerCase();
        const code = String(c.campaignCode ?? "").toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      if (tagFilter && !(tagsByCampaign[String(c.id)] || []).includes(tagFilter)) {
        return false;
      }
      return true;
    });
    result = [...result].sort((a, b) => {
      switch (sort) {
        case "name":
          return String(a.campaignName ?? "").localeCompare(String(b.campaignName ?? ""));
        case "clicks":
          return clicksOf(b) - clicksOf(a);
        case "subscribers":
          return subsOf(b) - subsOf(a);
        case "earnings":
          return (earningsByCampaign[String(b.id)]?.total_spent ?? 0) -
            (earningsByCampaign[String(a.id)]?.total_spent ?? 0);
        case "created":
        default: {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        }
      }
    });
    return result;
  }, [campaigns, debouncedSearch, tagFilter, sort, tagsByCampaign, earningsByCampaign]);

  const hasFilters = !!(search || tagFilter);
  const clearFilters = () => {
    setSearch("");
    setTagFilter("");
  };

  if (!selectedAccount) {
    return (
      <EmptyState
        icon={<PxMegaphone className="h-8 w-8" />}
        title="No account selected"
        description="Select an account from the header dropdown to view campaigns."
      />
    );
  }

  // Campaigns (tracking links) aren't wired for this platform yet — the
  // effect above already skipped every fetch, so this is the only surface.
  if (!campaignsSupported) {
    return (
      <EmptyState
        icon={<PxMegaphone className="h-8 w-8" />}
        title={`Not available on ${platformLabel(selectedAccount.platform)} yet`}
        description={`Campaign tracking links aren't available for ${platformLabel(selectedAccount.platform)} accounts yet. They're on the roadmap.`}
      />
    );
  }

  if (!connectionHealthy) {
    const title = connectionState === "login_failed"
      ? "Login failed"
      : connectionState === "verification_required"
        ? "Verification required"
        : connectionState === "proxy_error"
          ? "Proxy error"
          : connectionState === "rate_limited"
            ? "Rate limited"
            : connectionState === "sync_blocked"
              ? "Sync blocked"
              : "Account temporarily unavailable";
    const description = selectedAccount?.login_failure?.message
      || selectedAccount?.connection_error?.message
      || "Resolve this account on the Accounts page before loading live campaigns.";
    return (
      <EmptyState
        icon={<PxMegaphone className="h-8 w-8" />}
        title={title}
        description={description}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="heading-2">Campaigns</h2>
          <p className="text-sm text-default-500 mt-1">
            {agg.total > 0 ? (
              <>
                Tracking links for{" "}
                {selectedAccount.username || selectedAccount.email}
                {" · "}
                <span className="font-semibold text-foreground/80">
                  {money(agg.total)}
                </span>{" "}
                attributed earnings across{" "}
                <span className="font-semibold text-foreground/80">
                  {agg.claimers.toLocaleString()}
                </span>{" "}
                claimers{earningsCacheMeta?.last_refreshed_at ? (
                  <>
                    {" · "}
                    <span className="text-default-400">
                      cached {relativeTime(earningsCacheMeta.last_refreshed_at)}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <>Tracking links for {selectedAccount.username || selectedAccount.email}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* OF-only: Fansly earnings come live per tracking link — there is
              no claimer cache to walk (the backend refresh is a no-op). */}
          {!isFansly && (
            <Button
              size="sm"
              variant="bordered"
              isDisabled={campaignsBusy}
              isLoading={campaignsBusy}
              startContent={!campaignsBusy ? <PxRefresh className="h-3 w-3" /> : undefined}
              onPress={handleRefreshCampaigns}
              title="Walk every non-empty campaign's claimer list, cache them, recompute earnings via JOIN with subscribers_cache"
              className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
            >
              Refresh earnings
            </Button>
          )}
          {campaignsCreateOk ? (
            <Button
              data-tour="campaigns-create"
              className="dashboard-btn-primary text-white rounded-none uppercase tracking-wider font-bold"
              startContent={<PxPlus className="h-4 w-4" />}
              onPress={onOpen}
            >
              Create Campaign
            </Button>
          ) : (
            <p className="text-xs text-default-500 max-w-[260px] text-right">
              Creating tracking links isn&apos;t available for{" "}
              {platformLabel(selectedAccount.platform)} accounts yet — manage
              them in {platformLabel(selectedAccount.platform)} directly.
            </p>
          )}
        </div>
      </div>

      {/* Search / filter / sort toolbar — shown once there are campaigns to
          filter. Client-side over the eager-loaded set. */}
      {campaigns.length > 0 && (
        <DataTableToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder='Search name or code ("/")'
          showClear={hasFilters}
          onClear={clearFilters}
        >
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
            aria-label="Sort campaigns"
          >
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.key}>{o.label}</SelectItem>
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
              aria-label="Filter by tag"
            >
              {allTags.map((t) => (
                <SelectItem key={t}>{t}</SelectItem>
              ))}
            </Select>
          )}
        </DataTableToolbar>
      )}

      {/* Empty-claimers-cache banner.
          Fires when there's at least one campaign with active subscribers BUT
          we have zero cached claimer rows — the JOIN-based earnings are
          meaningless in that state. Prompts the user to kick a refresh (or
          just does it for them on click). */}
      {(() => {
        const haveClaimers = (earningsCacheMeta?.claimers ?? 0) > 0;
        const liveCampaigns = campaigns.filter((c) => {
          const subs = typeof c.countSubscribers === "object"
            ? c.countSubscribers?.count ?? 0
            : c.countSubscribers ?? 0;
          return subs > 0;
        });
        // Fansly earnings are live (no claimer cache) — the nag never applies.
        const shouldNag = !isFansly && !haveClaimers && liveCampaigns.length > 0 && !campaignsBusy;
        if (!shouldNag) return null;
        return (
          <div className="flex items-start justify-between gap-4 border border-amber-500/30 bg-amber-500/[0.04] p-4">
            <div className="text-sm">
              <div className="font-semibold text-amber-400 mb-1">
                Campaign earnings not computed yet
              </div>
              <div className="text-default-400 text-xs leading-relaxed">
                You have{" "}
                <span className="font-semibold text-foreground/80">
                  {liveCampaigns.length}
                </span>{" "}
                campaign{liveCampaigns.length === 1 ? "" : "s"} with active
                subscribers, but no claimer data is cached yet. The EARNINGS
                column stays empty until we walk{" "}
                <code className="text-[11px]">/campaigns/&#123;id&#125;/claimers</code>{" "}
                once — typically 1-2 minutes.
              </div>
            </div>
            <Button
              size="sm"
              className="dashboard-btn-primary text-white rounded-none uppercase tracking-wider font-bold whitespace-nowrap"
              startContent={<PxRefresh className="h-3 w-3" />}
              onPress={handleRefreshCampaigns}
            >
              Refresh earnings
            </Button>
          </div>
        );
      })()}

      <RefreshProgressBar state={campaignsJob} label="Campaigns" />

      {/* Two genuine empty states (nothing at all vs nothing matching) are
          folded into one DataState so neither can be shown for a failed fetch. */}
      <DataState
        loading={loading}
        error={error}
        isEmpty={filteredCampaigns.length === 0}
        onRetry={() => fetchCampaigns(0)}
        noun={isFansly ? "tracking links" : "campaigns"}
        icon={<PxMegaphone className="h-8 w-8" />}
        title={
          campaigns.length === 0
            ? isFansly
              ? "No tracking links"
              : "No campaigns"
            : "No campaigns match your filters"
        }
        description={
          campaigns.length === 0
            ? campaignsCreateOk
              ? "Create a tracking link campaign to start measuring performance."
              : `No tracking links on this ${platformLabel(selectedAccount.platform)} account yet — create them in ${platformLabel(selectedAccount.platform)} and they'll show up here.`
            : "Try clearing the search or the tag filter."
        }
        actionLabel={
          campaigns.length === 0
            ? campaignsCreateOk
              ? "Create Campaign"
              : undefined
            : "Clear filters"
        }
        onAction={
          campaigns.length === 0
            ? campaignsCreateOk
              ? onOpen
              : undefined
            : clearFilters
        }
      >
        <>
          <Table
            aria-label="Campaigns table"
            className="border border-white/[0.06] bg-[#0d0d0d]"
            data-tour="campaigns-list"
          >
            <TableHeader>
              <TableColumn>NAME</TableColumn>
              <TableColumn>CODE</TableColumn>
              <TableColumn>CLICKS</TableColumn>
              <TableColumn>SUBSCRIBERS</TableColumn>
              <TableColumn>EARNINGS</TableColumn>
              <TableColumn>TAGS</TableColumn>
              <TableColumn>CREATED</TableColumn>
              <TableColumn>ACTIONS</TableColumn>
            </TableHeader>
            <TableBody>
              {filteredCampaigns.map((c) => {
                const subs = subsOf(c);
                const clicks = clicksOf(c);
                const earn = earningsByCampaign[String(c.id)];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.campaignName}
                    </TableCell>
                    <TableCell>
                      {c.campaignCode ??
                        (c.linkType ? (
                          // Fansly rows have no shareable code — show the link
                          // kind instead (link = clickable, claim = promo-code
                          // style attribution source).
                          <span className="text-default-400 text-xs uppercase tracking-wider">
                            {c.linkType}
                          </span>
                        ) : (
                          <span className="text-default-400">—</span>
                        ))}
                    </TableCell>
                    <TableCell>{clicks}</TableCell>
                    <TableCell>{subs}</TableCell>
                    <TableCell>
                      {earn && earn.claimers_count > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">
                            {money(earn.total_spent)}
                          </span>
                          {earn.coverage_pct < 100 && (
                            <Chip
                              size="sm"
                              variant="flat"
                              className="rounded-none bg-amber-500/10 text-amber-400 text-[10px]"
                              title={`${earn.mapped_claimers_count} of ${earn.claimers_count} claimers mapped to subscribers_cache. Refresh subs to improve coverage.`}
                            >
                              {earn.coverage_pct}%
                            </Chip>
                          )}
                        </div>
                      ) : subs > 0 && !isFansly ? (
                        <span className="text-default-400 text-xs">
                          Not synced yet — click Refresh earnings
                        </span>
                      ) : (
                        <span className="text-default-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {uid ? (
                        <CampaignTagEditor
                          ofUserId={uid}
                          campaignId={String(c.id)}
                          tags={tagsByCampaign[String(c.id)] || []}
                          onChange={(next) =>
                            setTagsByCampaign((m) => ({
                              ...m,
                              [String(c.id)]: next,
                            }))
                          }
                          compact
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-default-500">
                      {c.createdAt
                        ? new Date(c.createdAt).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {/* OF-only actions: Fansly rows carry no shareable link
                          and the claimers route 501s (no per-link subscriber
                          enumeration on Fansly). */}
                      {isFansly ? (
                        <span className="text-default-400">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="bordered"
                            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                            startContent={
                              copiedId === String(c.id) ? (
                                <PxCheck className="h-3 w-3 text-green-400" />
                              ) : (
                                <PxCopy className="h-3 w-3" />
                              )
                            }
                            onPress={() => copyLink(c)}
                          >
                            {copiedId === String(c.id) ? "Copied" : "Copy Link"}
                          </Button>
                          <Button
                            size="sm"
                            variant="bordered"
                            isDisabled={subs === 0}
                            className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                            startContent={<PxEye className="h-3 w-3" />}
                            onPress={() => openClaimers(c)}
                          >
                            Claimers{subs ? ` (${subs})` : ""}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="bordered"
                isLoading={loading}
                className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                onPress={() => fetchCampaigns(offset)}
              >
                Load More
              </Button>
            </div>
          )}
        </>
      </DataState>

      {/* Create Campaign Modal */}
      <Modal isOpen={isOpen} onClose={onClose} placement="center">
        <ModalContent>
          <ModalHeader>Create Campaign</ModalHeader>
          <ModalBody>
            <Input
              label="Campaign Name"
              value={newName}
              onValueChange={setNewName}
              isRequired
              variant="bordered"
              classNames={{ inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none" }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              Cancel
            </Button>
            <Button
              className="dashboard-btn-primary text-white rounded-none uppercase tracking-wider font-bold"
              isLoading={createLoading}
              onPress={handleCreate}
            >
              Create
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Enhanced Claimers Modal */}
      <Modal
        isOpen={isClaimersOpen}
        onClose={onClaimersClose}
        placement="center"
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div>Claimers — {claimersCampaign?.campaignName}</div>
            {claimersCampaign && earningsByCampaign[String(claimersCampaign.id)] ? (
              <div className="text-xs text-default-500 font-normal">
                {(() => {
                  const e = earningsByCampaign[String(claimersCampaign.id)];
                  return (
                    <>
                      <span className="font-semibold text-foreground/80">{money(e.total_spent)}</span>{" "}
                      earnings across{" "}
                      <span className="font-semibold text-foreground/80">{e.claimers_count}</span>{" "}
                      claimers · <span className="font-semibold text-foreground/80">{e.mapped_claimers_count}</span> mapped ({e.coverage_pct}%)
                    </>
                  );
                })()}
              </div>
            ) : null}
          </ModalHeader>
          <ModalBody>
            {claimers.length === 0 && !claimersLoading ? (
              <p className="text-sm text-default-500 text-center py-8">
                No claimers cached yet — click &quot;Refresh earnings&quot; up top.
              </p>
            ) : (
              <Table aria-label="Claimers table">
                <TableHeader>
                  <TableColumn>USER</TableColumn>
                  <TableColumn>USERNAME</TableColumn>
                  <TableColumn>TOTAL SPENT</TableColumn>
                  <TableColumn>MAPPED SPENT</TableColumn>
                  <TableColumn>SUBSCRIBED</TableColumn>
                </TableHeader>
                <TableBody>
                  {claimers.map((c, i) => (
                    <TableRow
                      key={c.fan_of_user_id || c.id || i}
                      className="cursor-pointer hover:bg-accent/5"
                      onClick={() => setActiveClaimer(c)}
                    >
                      <TableCell className="font-medium">
                        {c.display_name || c.name || c.fan_username || `User ${c.fan_of_user_id}`}
                      </TableCell>
                      <TableCell className="text-default-500">
                        @{c.fan_username || "—"}
                      </TableCell>
                      <TableCell>
                        {c.total_spent != null ? (
                          <span className={c.total_spent > 0 ? "font-semibold" : "text-default-400"}>
                            {money(c.total_spent)}
                          </span>
                        ) : (
                          <span className="text-default-400 text-xs" title="Not in subscribers_cache yet — run Refresh subs on accounts page">
                            unmapped
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {c.mapped_spent > 0 ? money(c.mapped_spent) : <span className="text-default-400">$0</span>}
                      </TableCell>
                      <TableCell className="text-default-500">
                        {c.subscribed_at
                          ? new Date(c.subscribed_at).toLocaleDateString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {claimersHasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="bordered"
                  size="sm"
                  isLoading={claimersLoading}
                  className="bg-transparent border border-white/[0.08] rounded-none hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)]"
                  onPress={() =>
                    fetchClaimers(claimersCampaign?.id, claimersOffset)
                  }
                >
                  Load More
                </Button>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClaimersClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Fan detail drawer */}
      {uid && (
        <ClaimerDetailDrawer
          claimer={activeClaimer}
          ofUserId={uid}
          onClose={() => setActiveClaimer(null)}
          onSpendingRefreshed={(fanId, fresh) => {
            // Bump the row's total_spent locally so the modal reflects reality
            setClaimers((prev) =>
              prev.map((r) =>
                r.fan_of_user_id === fanId ? { ...r, total_spent: fresh } : r
              )
            );
            // Also re-fetch campaign-level earnings (the JOIN can change)
            fetchEarnings();
          }}
        />
      )}
    </div>
  );
}
