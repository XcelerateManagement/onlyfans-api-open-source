"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { ImportCounts, ImportJobRow, ImportRowState } from "@/lib/api-client";
import {
  IMPORT_STATE_META,
  IMPORT_STATE_ORDER,
  countOf,
  stateChipClass,
  stateDotClass,
  stateLabel,
} from "@/lib/import-format";
import { ImportOtpRow, type OtpActions } from "@/components/dashboard/ImportOtpRow";
import { PxChevronLeft, PxChevronRight, PxRefresh } from "@/components/ui/PixelIcons";

/** Rows rendered at once. The table is capped rather than virtualized: a
 *  1000-row job would otherwise put 1000 rows — each with its own input and
 *  countdown — into the DOM, which is the difference between a page that
 *  scrolls and a page that stutters. */
const PAGE_SIZE = 50;

type Filter = ImportRowState | "all" | "attention";

/** States where the operator, not the importer, is the blocker. */
const ATTENTION: ImportRowState[] = [
  "needs_2fa",
  "needs_2fa_expired",
  "failed",
  "slot_exhausted",
];

function matches(row: ImportJobRow, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "attention") return ATTENTION.includes(row.state);
  return row.state === filter;
}

/**
 * The full per-row view of a running import.
 *
 * Deliberately boring: fixed page size, stable sort by source line, one chip
 * per state. The only interactive cell is the action column, and only for rows
 * that are genuinely waiting on a human.
 *
 * Nothing in here fires a request. Actions are handed up to the job hook, which
 * owns the single polled endpoint — a table that fetched per row would be the
 * N+1 this dashboard has already grown twice.
 */
export function ImportRowsTable({
  rows,
  counts,
  now,
  onSubmitOtp,
  onRetry,
  defaultFilter = "all",
}: {
  rows: ImportJobRow[];
  counts: ImportCounts;
  now: number;
  defaultFilter?: Filter;
} & OtpActions) {
  const [filter, setFilter] = useState<Filter>(defaultFilter);
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () => rows.filter((r) => matches(r, filter)),
    [rows, filter]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp when the filtered set shrinks under a live import.
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const start = page * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  const attentionTotal = ATTENTION.reduce((n, s) => n + countOf(counts, s), 0);

  const filterOptions: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All", n: rows.length },
    { key: "attention", label: "Needs you", n: attentionTotal },
    ...IMPORT_STATE_ORDER.map((s) => ({
      key: s as Filter,
      label: stateLabel(s),
      n: countOf(counts, s),
    })).filter((o) => o.n > 0),
  ];

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-white/[0.06]">
        {filterOptions.map((o) => {
          const on = filter === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                setFilter(o.key);
                setPage(0);
              }}
              className={`border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                on
                  ? "border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.5)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.1)] text-foreground"
                  : "border-white/[0.08] text-default-400 hover:border-white/[0.2] hover:text-foreground"
              }`}
            >
              {o.label}
              <span className="ml-1.5 tabular-nums opacity-60">{o.n}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12px] text-default-500">
          No rows in this state.
        </p>
      ) : (
        <div className="overflow-x-auto styled-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-default-500">
                <th className="font-medium px-5 py-2 w-14">Line</th>
                <th className="font-medium px-3 py-2">Account</th>
                <th className="font-medium px-3 py-2 w-28">Platform</th>
                <th className="font-medium px-3 py-2 w-32">Status</th>
                <th className="font-medium px-5 py-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const meta = IMPORT_STATE_META[row.state];
                const parked =
                  row.state === "needs_2fa" || row.state === "needs_2fa_expired";
                return (
                  <tr
                    key={row.row_id}
                    className="border-b border-white/[0.04] transition-colors hover:bg-accent/5 align-top"
                  >
                    <td className="px-5 py-2.5 text-[11px] tabular-nums text-default-500">
                      {row.line}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-foreground/90 max-w-[260px] truncate">
                      {row.of_user_id ? (
                        <Link
                          href={`/dashboard/accounts/${row.of_user_id}`}
                          className="hover:underline hover:text-[color:var(--theme-accent,#f54900)]"
                        >
                          {row.username || row.email || "—"}
                        </Link>
                      ) : (
                        row.email || <span className="text-default-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-default-500 capitalize">
                      {row.platform || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        title={meta?.help}
                        className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${stateChipClass(
                          row.state
                        )}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 ${stateDotClass(row.state)} ${
                            row.state === "running" ? "animate-pulse" : ""
                          }`}
                        />
                        {stateLabel(row.state)}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      {parked ? (
                        <ImportOtpRow
                          row={row}
                          now={now}
                          onSubmitOtp={onSubmitOtp}
                          onRetry={onRetry}
                          compact
                        />
                      ) : row.state === "failed" ? (
                        <div className="space-y-1">
                          <p className="text-[11px] text-red-400/90 max-w-[420px]">
                            {row.error || "Login was rejected."}
                          </p>
                          <button
                            type="button"
                            onClick={() => void onRetry(row.row_id)}
                            className="inline-flex items-center gap-1.5 border border-white/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground transition-colors"
                          >
                            <PxRefresh className="h-3 w-3" />
                            Retry
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-default-500">
                          {row.error || meta?.help || ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pager */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
          <span className="text-[11px] text-default-500 tabular-nums">
            {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of{" "}
            {filtered.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 border border-white/[0.08] px-2 py-1 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <PxChevronLeft className="h-3 w-3" />
              Prev
            </button>
            <span className="text-[11px] text-default-500 tabular-nums px-1">
              {page + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
              className="flex items-center gap-1 border border-white/[0.08] px-2 py-1 text-[10px] uppercase tracking-wider text-default-400 hover:border-white/[0.2] hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <PxChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
