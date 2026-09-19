"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@heroui/button";

import { ApiError } from "@/lib/api-client";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { SkeletonList } from "@/components/dashboard/Skeleton";
import { PxZap, PxRefresh } from "@/components/ui/PixelIcons";

/**
 * One place that decides which of four things a data-backed view shows.
 *
 * The bug this fixes: every list page rendered
 *
 *     loading && rows.length === 0 ? <Skeleton/>
 *   : rows.length === 0            ? <EmptyState/>
 *   :                                <rows/>
 *
 * with the fetch's `catch` doing nothing but a toast. A 429, a dropped
 * connection or a 500 therefore left `rows` at `[]` and the page confidently
 * announced "No fans tracked yet" / "No webhooks configured" — a factual claim
 * about the operator's account that we had no evidence for. Toasts vanish in
 * four seconds; the false claim stays on screen.
 *
 * The rule, in precedence order:
 *
 *   1. loading with nothing to show  → skeleton
 *   2. we have rows                  → show them, even if the LAST refresh
 *                                      failed. Stale data beats a wall of
 *                                      error, and the dashboard-wide
 *                                      RateLimitBanner already narrates 429s.
 *   3. the fetch failed              → say so, offer a retry. Never an empty
 *                                      state.
 *   4. loaded and genuinely empty    → the empty state, which is now a claim
 *                                      we can actually stand behind.
 */

export interface DataStateProps {
  /** A request is in flight. */
  loading: boolean;
  /** Whatever the fetch's catch received, or null. Typically an ApiError. */
  error: unknown;
  /** True when there is nothing to render. Callers pass e.g. rows.length === 0. */
  isEmpty: boolean;
  /** Re-run the fetch. Renders a Retry button when provided. */
  onRetry?: () => void;

  /** Loading placeholder. Defaults to an 8-row skeleton list. */
  skeleton?: ReactNode;

  /** Render inline (one line of text) instead of a full bordered panel. For
   *  surfaces already inside a card, where a second bordered box reads as a
   *  layout bug. */
  compact?: boolean;

  /** Empty-state content — used only when the fetch actually succeeded.
   *  `emptyContent` overrides the default EmptyState panel wholesale, for
   *  places that render their empty case as a line of text. */
  icon?: ReactNode;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  emptyContent?: ReactNode;

  /** What this view is called, for the failure copy: "Couldn't load {noun}". */
  noun?: string;

  children: ReactNode;
}

/** Human sentence for why a fetch failed, from the error we actually caught. */
export function describeFetchError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isRateLimit) {
      const wait = error.retryAfter && error.retryAfter > 0
        ? ` Try again in ${error.retryAfter}s.`
        : " Try again in a moment.";
      return `The API rate limit for your key was reached, so this request was refused.${wait}`;
    }
    if (error.status === 0) {
      return "The request never reached the API — the panel may be offline, or the connection dropped.";
    }
    if (error.status >= 500) {
      return `The API returned a ${error.status}. This is a server-side failure, not a problem with your account.`;
    }
    if (error.status === 401 || error.status === 403) {
      return "The API rejected this request as unauthorised. Your session or API key may have expired.";
    }
    return error.message || `The request failed with status ${error.status}.`;
  }
  if (error instanceof Error && error.message) return error.message;
  return "The request failed for an unknown reason.";
}

/**
 * "We could not load this" — deliberately NOT shaped like the empty state, so
 * the two are never mistaken for each other at a glance. Amber + the word
 * "couldn't load" + a triangle: the state is never carried by colour alone.
 */
export function FetchFailed({
  noun = "this data",
  error,
  onRetry,
  compact,
}: {
  noun?: string;
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div role="alert" className="py-6 text-center text-sm">
        <p className="text-amber-300">
          <span aria-hidden="true">⚠ </span>
          Couldn&apos;t load {noun}
        </p>
        <p className="mt-1 text-xs text-default-500 px-4">
          {describeFetchError(error)} This is a failed request, not an empty
          list.
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-[11px] uppercase tracking-wider text-amber-200/70 hover:text-amber-200 underline underline-offset-2"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      role="alert"
      className="relative overflow-hidden flex flex-col items-center justify-center py-14 text-center bg-[#0d0d0d] border border-amber-500/25"
    >
      <CornerBrackets size={8} />
      <div className="relative z-10 mb-4">
        <div className="flex h-16 w-16 items-center justify-center bg-amber-500/[0.06] border border-amber-500/25">
          <PxZap className="h-8 w-8 text-amber-400" />
        </div>
      </div>

      <h3 className="text-lg font-semibold text-amber-200">
        Couldn&apos;t load {noun}
      </h3>
      <p className="mt-1 text-sm text-default-500 max-w-md px-6 leading-relaxed">
        {describeFetchError(error)}
      </p>
      <p className="mt-2 text-[11px] text-default-600 max-w-md px-6">
        This is a failed request, not an empty {noun} list — nothing here says
        anything about what your account contains.
      </p>

      {onRetry && (
        <Button
          size="sm"
          variant="bordered"
          radius="none"
          onPress={onRetry}
          startContent={<PxRefresh className="h-3.5 w-3.5" />}
          className="mt-4 border-amber-500/30 text-amber-200 uppercase tracking-wider text-[11px]"
        >
          Retry
        </Button>
      )}
    </motion.div>
  );
}

export function DataState({
  loading,
  error,
  isEmpty,
  onRetry,
  skeleton,
  compact,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  emptyContent,
  noun,
  children,
}: DataStateProps) {
  if (loading && isEmpty) {
    if (skeleton !== undefined) return <>{skeleton}</>;
    if (compact) {
      return (
        <div className="py-6 text-center text-sm text-default-400">Loading…</div>
      );
    }
    return (
      <div className="border border-white/[0.06] bg-[#0d0d0d]">
        <SkeletonList rows={8} rowHeight={56} />
      </div>
    );
  }

  // Rows we already have beat an error banner — a transient 429 must not blank
  // a page that was rendering fine a second ago.
  if (!isEmpty) return <>{children}</>;

  if (error) {
    return (
      <FetchFailed
        noun={noun}
        error={error}
        onRetry={onRetry}
        compact={compact}
      />
    );
  }

  if (emptyContent !== undefined) return <>{emptyContent}</>;

  return (
    <EmptyState
      icon={icon}
      title={title ?? "Nothing here yet"}
      description={description ?? ""}
      actionLabel={actionLabel}
      onAction={onAction}
    />
  );
}
