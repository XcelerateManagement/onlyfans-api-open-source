"use client";

import { platformLabel } from "@/lib/platform-capabilities";
import type { Platform } from "@/lib/hooks/use-selected-account";

/**
 * Read-only badges for a fan's platform custom-list memberships (the creator's
 * own "Whales"/"VIP"/… groups, auto-imported from OF's listsStates during the
 * subscriber sync). Styled in the accent colour to distinguish them from manual
 * tags, and optionally clickable to filter the list by that group.
 */
export function OfListBadges({
  lists,
  onListClick,
  activeTag,
  compact = false,
  platform,
}: {
  lists?: string[] | null;
  onListClick?: (name: string) => void;
  activeTag?: string | null;
  compact?: boolean;
  /** Platform the lists came from — labels the tooltip. Undefined → OnlyFans. */
  platform?: Platform;
}) {
  if (!lists || lists.length === 0) return null;
  return (
    <>
      {lists.map((name) => {
        const active = activeTag === name;
        return (
          <button
            key={name}
            type="button"
            title={`${platformLabel(platform)} list: ${name}`}
            onClick={
              onListClick
                ? (e) => {
                    e.stopPropagation();
                    onListClick(name);
                  }
                : undefined
            }
            className={
              "inline-flex items-center gap-1 rounded-none border px-1.5 py-0.5 text-[10px] leading-none whitespace-nowrap transition-colors " +
              (compact ? "max-w-[150px] truncate " : "") +
              (active
                ? "border-[color:var(--theme-accent,#f54900)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.2)] text-[color:var(--theme-accent,#f54900)] "
                : "border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.35)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.08)] text-[color:rgba(var(--theme-accent-rgb,245,73,0),0.9)] ") +
              (onListClick ? "cursor-pointer hover:opacity-80" : "cursor-default")
            }
          >
            <span aria-hidden className="opacity-60">▦</span>
            <span className="truncate">{name}</span>
          </button>
        );
      })}
    </>
  );
}
