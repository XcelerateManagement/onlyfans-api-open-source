"use client";

import { useEffect, useMemo, useState } from "react";

import type { ImportPreviewRow } from "@/lib/api-client";
import {
  IMPORT_STATE_META,
  maskProxy,
  stateChipClass,
  stateLabel,
} from "@/lib/import-format";
import { PxChevronLeft, PxChevronRight } from "@/components/ui/PixelIcons";

const PAGE_SIZE = 50;

type Filter = "all" | "pending" | "problem" | "manual2fa";

/** Anything that will not be attempted. */
function isProblem(row: ImportPreviewRow): boolean {
  return row.state !== "pending";
}

/**
 * Left-edge accent per outcome. This is the "visibly distinct" requirement: at
 * a glance, down the left edge, you can see which lines are going to be tried.
 */
function rowAccent(row: ImportPreviewRow): string {
  switch (row.state) {
    case "invalid":
      return "border-l-2 border-l-red-500/60 bg-red-500/[0.03]";
    case "skipped":
      return "border-l-2 border-l-white/10 bg-white/[0.015] opacity-60";
    case "slot_exhausted":
      return "border-l-2 border-l-amber-500/60 bg-amber-500/[0.03]";
    default:
      return "border-l-2 border-l-transparent";
  }
}

/**
 * What `/import/preview` says will happen, before anything happens.
 *
 * Two properties this table must hold:
 *
 *  1. **No credentials on screen.** The operator screenshots this to check
 *     their list. The server sends neither password nor TOTP secret — only
 *     whether each was present — and the proxy is shown host-only. What is
 *     rendered here is what may safely end up in a screenshot.
 *
 *  2. **"Will be tried" is visually separate from "won't be."** Skipped and
 *     rejected lines carry a coloured left edge and are dimmed, so a 600-row
 *     paste doesn't need reading line by line to see what got through.
 */
export function ImportPreviewTable({ rows }: { rows: ImportPreviewRow[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    switch (filter) {
      case "pending":
        return rows.filter((r) => !isProblem(r));
      case "problem":
        return rows.filter(isProblem);
      case "manual2fa":
        return rows.filter((r) => !isProblem(r) && !r.has_totp_secret);
      default:
        return rows;
    }
  }, [rows, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  const start = page * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  const counts = useMemo(() => {
    let ok = 0;
    let problem = 0;
    let manual = 0;
    for (const r of rows) {
      if (isProblem(r)) problem++;
      else {
        ok++;
        if (!r.has_totp_secret) manual++;
      }
    }
    return { ok, problem, manual };
  }, [rows]);

  const options: { key: Filter; label: string; n: number }[] = [
    { key: "all", label: "All lines", n: rows.length },
    { key: "pending", label: "Will import", n: counts.ok },
    { key: "problem", label: "Won't import", n: counts.problem },
    { key: "manual2fa", label: "Needs typed code", n: counts.manual },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-white/[0.06]">
        {options.map((o) => {
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
          No lines in this group.
        </p>
      ) : (
        <div className="overflow-x-auto styled-scrollbar">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-default-500">
                <th className="font-medium px-5 py-2 w-14">Line</th>
                <th className="font-medium px-3 py-2">Email</th>
                <th className="font-medium px-3 py-2 w-24">Password</th>
                <th className="font-medium px-3 py-2 w-24">Platform</th>
                <th className="font-medium px-3 py-2 w-40">Proxy</th>
                <th className="font-medium px-3 py-2 w-28">2FA</th>
                <th className="font-medium px-3 py-2 w-28">Outcome</th>
                <th className="font-medium px-5 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const meta = IMPORT_STATE_META[row.state];
                const notes = [
                  ...(row.errors ?? []),
                  ...(row.warnings ?? []),
                ].filter(Boolean);
                return (
                  <tr
                    key={`${row.line}-${row.email ?? ""}`}
                    className={`border-b border-white/[0.04] transition-colors hover:bg-accent/5 ${rowAccent(
                      row
                    )}`}
                  >
                    <td className="px-5 py-2 text-[11px] tabular-nums text-default-500">
                      {row.line}
                    </td>
                    <td className="px-3 py-2 text-[12px] text-foreground/90 max-w-[240px] truncate">
                      {row.email || (
                        <span className="text-red-400/80 italic">missing</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {row.has_password ? (
                        // Never the value — only that there is one.
                        <span
                          className="font-mono text-default-500"
                          title="Password supplied (never displayed)"
                        >
                          ••••••••
                        </span>
                      ) : (
                        <span className="text-red-400/80 italic">missing</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-default-400 capitalize">
                      {row.platform || (
                        <span className="text-default-500">default</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-default-500 font-mono max-w-[180px] truncate">
                      {row.proxy ? maskProxy(row.proxy) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[11px]">
                      {row.has_totp_secret ? (
                        <span
                          className="text-green-400/90"
                          title="A TOTP secret was supplied — codes are generated automatically, no typing"
                        >
                          automatic
                        </span>
                      ) : isProblem(row) ? (
                        <span className="text-default-500">—</span>
                      ) : (
                        <span
                          className="text-amber-400/90"
                          title="No TOTP secret — if this account asks for a code you will have to type it"
                        >
                          type by hand
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        title={meta?.help}
                        className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${stateChipClass(
                          row.state
                        )}`}
                      >
                        {row.state === "pending"
                          ? "Will import"
                          : stateLabel(row.state)}
                      </span>
                    </td>
                    <td className="px-5 py-2 text-[11px] text-default-500 max-w-[320px]">
                      {notes.length > 0 ? (
                        <span
                          className={
                            (row.errors?.length ?? 0) > 0
                              ? "text-red-400/90"
                              : "text-default-500"
                          }
                        >
                          {notes.join(" · ")}
                        </span>
                      ) : (
                        ""
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
