"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@heroui/avatar";
import { Input } from "@heroui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/popover";

import PlatformBadge from "@/components/dashboard/PlatformBadge";
import { PxSearch, PxChevronDown, PxCheck } from "@/components/ui/PixelIcons";
import type { OfAccount } from "@/lib/hooks/use-selected-account";
import { cn } from "@/lib/utils";

/**
 * Account picker for the dashboard header.
 *
 * Replaces a plain <Select> that rendered every account as an option. That is
 * fine for five and unusable for the ~600 a single client is bringing: no way
 * to find a name, 600 DOM nodes on every open, and no way to narrow by
 * platform or tag.
 *
 * Three deliberate choices:
 *
 *  - Search matches username, email AND of_user_id. Operators paste ids out of
 *    logs and support tickets as often as they type names.
 *  - The rendered list is CAPPED (see RENDER_LIMIT) with an explicit "refine
 *    your search" line rather than silently truncated. A picker that quietly
 *    omits the account you are looking for is worse than one that says it did.
 *  - Selection stays SINGLE. Every dashboard page reads one active account;
 *    making this multi-select is a change to that contract, not to this
 *    component. The filters below are how you narrow 600 down, not a way to
 *    view several at once.
 */

/** Rows drawn at once. Above this, the list asks you to narrow instead. */
const RENDER_LIMIT = 50;

type PlatformFilter = "all" | "onlyfans" | "fansly";

function accountName(a: OfAccount): string {
  return a.username || a.email || a.of_user_id;
}

function matches(a: OfAccount, needle: string): boolean {
  if (!needle) return true;
  const q = needle.toLowerCase();
  return (
    (a.username || "").toLowerCase().includes(q) ||
    (a.email || "").toLowerCase().includes(q) ||
    String(a.of_user_id).toLowerCase().includes(q) ||
    (a.tags || []).some((t) => t.toLowerCase().includes(q))
  );
}

export function AccountPicker({
  accounts,
  selected,
  onSelect,
  disabled,
}: {
  accounts: OfAccount[];
  selected: OfAccount | null;
  onSelect: (a: OfAccount) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [tag, setTag] = useState<string>("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset the query on close so reopening does not resume someone else's
  // half-typed search, but KEEP the filters — those read as a deliberate
  // narrowing the operator set up, not as transient input.
  useEffect(() => {
    if (!open) setQuery("");
    else setTimeout(() => searchRef.current?.focus(), 40);
  }, [open]);

  const platforms = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) s.add(a.platform || "onlyfans");
    return s;
  }, [accounts]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const a of accounts) for (const t of a.tags || []) s.add(t);
    return Array.from(s).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      if (platform !== "all" && (a.platform || "onlyfans") !== platform) return false;
      if (tag && !(a.tags || []).includes(tag)) return false;
      return matches(a, query.trim());
    });
  }, [accounts, platform, tag, query]);

  const shown = filtered.slice(0, RENDER_LIMIT);
  const hidden = filtered.length - shown.length;
  const narrowed = platform !== "all" || !!tag || !!query.trim();

  return (
    <Popover
      isOpen={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={6}
      isDismissable
    >
      <PopoverTrigger>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 w-56 px-2.5 py-1.5 text-left",
            "border border-white/[0.14] hover:border-white/30 transition-colors",
            "text-sm disabled:opacity-50",
          )}
        >
          {selected ? (
            <>
              <Avatar
                src={selected.avatar || undefined}
                name={accountName(selected)}
                size="sm"
                radius="full"
                className="flex-shrink-0 w-5 h-5 text-tiny"
              />
              <span className="truncate flex-1">{accountName(selected)}</span>
            </>
          ) : (
            <span className="truncate flex-1 text-default-500">Select account</span>
          )}
          <PxChevronDown className="h-3 w-3 shrink-0 text-default-400" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-0 w-[22rem] bg-[#0d0d0d] border border-white/[0.08] rounded-none">
        <div className="w-full">
          <div className="p-2 border-b border-white/[0.06]">
            <Input
              ref={searchRef}
              size="sm"
              variant="bordered"
              radius="none"
              placeholder="Search name, email or id…"
              value={query}
              onValueChange={setQuery}
              startContent={<PxSearch className="h-3.5 w-3.5 text-default-400" />}
              classNames={{
                // Match every other dashboard field. The global
                // .dashboard-context rules force the flat dark treatment and
                // square corners anyway; spelling it out keeps this consistent
                // with DataTableToolbar / ProfileCard / the export form rather
                // than relying on a cascade that could be scoped differently
                // later.
                inputWrapper: "bg-white/[0.03] border-white/[0.08] !rounded-none",
              }}
            />

            {(platforms.size > 1 || allTags.length > 0) && (
              <div className="flex flex-wrap items-center gap-1 mt-2">
                {platforms.size > 1 &&
                  (["all", "onlyfans", "fansly"] as PlatformFilter[])
                    .filter((p) => p === "all" || platforms.has(p))
                    .map((p) => (
                      <FilterChip
                        key={p}
                        active={platform === p}
                        onPress={() => setPlatform(p)}
                        label={p === "all" ? "All" : p === "onlyfans" ? "OnlyFans" : "Fansly"}
                      />
                    ))}
                {allTags.length > 0 && (
                  <select
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    className={cn(
                      "text-[11px] uppercase tracking-wider px-1.5 py-1 bg-transparent",
                      "border outline-none cursor-pointer",
                      tag
                        ? "border-[color:var(--theme-accent,#f54900)]/50 text-[color:var(--theme-accent,#f54900)]"
                        : "border-white/[0.1] text-default-400",
                    )}
                  >
                    <option value="">All tags</option>
                    {allTags.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="max-h-[19rem] overflow-y-auto styled-scrollbar">
            {shown.length === 0 ? (
              <p className="px-3 py-6 text-xs text-default-500 text-center">
                {narrowed
                  ? "No account matches this search."
                  : "No accounts connected yet."}
              </p>
            ) : (
              shown.map((a) => {
                const isSel = selected?.of_user_id === a.of_user_id;
                return (
                  <button
                    key={a.of_user_id}
                    type="button"
                    onClick={() => {
                      onSelect(a);
                      setOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                      "hover:bg-white/[0.04]",
                      isSel && "bg-white/[0.06]",
                    )}
                  >
                    <Avatar
                      src={a.avatar || undefined}
                      name={accountName(a)}
                      size="sm"
                      radius="full"
                      className="flex-shrink-0 w-6 h-6 text-tiny"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{accountName(a)}</span>
                      {(a.tags || []).length > 0 && (
                        <span className="block text-[10px] text-default-500 truncate">
                          {(a.tags || []).join(" · ")}
                        </span>
                      )}
                    </span>
                    <PlatformBadge platform={a.platform} />
                    {isSel && (
                      <PxCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--theme-accent,#f54900)]" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {(hidden > 0 || filtered.length !== accounts.length) && (
            <div className="px-3 py-1.5 border-t border-white/[0.06] text-[10px] text-default-500">
              {hidden > 0 ? (
                // Say it out loud. A picker that silently drops the account you
                // are looking for is worse than one that admits it capped.
                <>
                  Showing {shown.length} of {filtered.length} — keep typing to narrow.
                </>
              ) : (
                <>
                  {filtered.length} of {accounts.length} accounts
                </>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        "text-[11px] uppercase tracking-wider px-1.5 py-1 border transition-colors",
        active
          ? "border-[color:var(--theme-accent,#f54900)]/50 text-[color:var(--theme-accent,#f54900)]"
          : "border-white/[0.1] text-default-400 hover:text-white hover:border-white/25",
      )}
    >
      {label}
    </button>
  );
}
