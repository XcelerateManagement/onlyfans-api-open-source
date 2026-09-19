"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import toast from "react-hot-toast";
import { Button } from "@heroui/button";
import { Textarea } from "@heroui/input";

import { useApiClient } from "@/lib/hooks/use-api-client";
import type { ApiErrorRow } from "@/lib/api-client";
import { accordionVariants } from "@/lib/animations";
import { parseUtc } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";
import {
  PxChevronDown,
  PxCopy,
  PxCheck,
  PxSend,
} from "@/components/ui/PixelIcons";

/**
 * The individual failures behind the error-rate number.
 *
 * The metrics card above it can only ever say "4 failed" — api_metrics stores
 * counters, not payloads. This reads api_error_log, which keeps the response
 * body, so the operator can see what actually broke, copy it verbatim, and
 * send it to us without translating it into prose first.
 */


function statusTone(status: number): string {
  if (status >= 500) return "text-red-400 border-red-500/30";
  if (status === 429) return "text-amber-300 border-amber-400/30";
  return "text-orange-300 border-orange-400/30";
}

/** Everything an engineer needs, in one paste. */
function asReportText(e: ApiErrorRow): string {
  const lines = [
    `${e.method} ${e.route}`,
    `Status:  ${e.status_code}${e.error_code ? ` (${e.error_code})` : ""}`,
    `When:    ${e.occurred_at} UTC`,
  ];
  if (e.path && e.path !== e.route) lines.push(`Path:    ${e.path}`);
  if (e.of_user_id) lines.push(`Account: ${e.of_user_id}`);
  if (e.latency_ms != null) lines.push(`Took:    ${Math.round(e.latency_ms)} ms`);
  if (e.message) lines.push(`Message: ${e.message}`);
  if (e.body) lines.push("", "Response:", e.body);
  return lines.join("\n");
}

export function ApiErrorList() {
  const api = useApiClient();
  const [rows, setRows] = useState<ApiErrorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canReport, setCanReport] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!api) return;
    setLoading(true);
    api
      .getRecentErrors({ limit: 25 })
      .then((r) => {
        setRows(r.errors || []);
        setCanReport(!!r.reporting_available);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => load(), [load]);

  const copy = async (e: ApiErrorRow) => {
    try {
      await navigator.clipboard.writeText(asReportText(e));
      setCopiedId(e.id);
      setTimeout(() => setCopiedId((c) => (c === e.id ? null : c)), 1600);
    } catch {
      toast.error("Could not copy — select the text and copy manually");
    }
  };

  const report = async (e: ApiErrorRow) => {
    if (!api) return;
    setSending(e.id);
    try {
      await api.reportError(e.id, note.trim() || undefined);
      toast.success("Sent to the team");
      setRows((prev) =>
        prev.map((r) => (r.id === e.id ? { ...r, reported: true } : r)),
      );
      setNote("");
    } catch (err: any) {
      toast.error(err?.message || "Could not send the report");
    } finally {
      setSending(null);
    }
  };

  if (loading) {
    return (
      <p className="text-[11px] text-default-500 px-1 py-2">Loading errors…</p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-default-500 px-1 py-2">
        No failed requests recorded.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {rows.map((e) => {
        const isOpen = openId === e.id;
        return (
          <div
            key={e.id}
            className="border border-white/[0.05] bg-white/[0.02]"
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : e.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
            >
              <span
                className={cn(
                  "shrink-0 border px-1.5 py-0.5 text-[10px] font-mono tabular-nums",
                  statusTone(e.status_code),
                )}
              >
                {e.status_code}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-mono text-[11px] text-default-300 truncate">
                  <span className="text-default-500">{e.method}</span> {e.route}
                </span>
                {e.message && (
                  <span className="block text-[10px] text-default-500 truncate">
                    {e.message}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[10px] text-default-500 tabular-nums">
                {parseUtc(e.occurred_at)?.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                }) ?? ""}
              </span>
              {e.reported && (
                <span className="shrink-0 text-[10px] text-green-400">sent</span>
              )}
              <motion.span
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0 text-default-400"
              >
                <PxChevronDown className="h-3 w-3" />
              </motion.span>
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
                  <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04] pt-2">
                    <pre className="text-[10px] font-mono leading-relaxed text-default-400 bg-black/40 border border-white/[0.05] p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64">
                      {asReportText(e)}
                    </pre>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="bordered"
                        radius="none"
                        className="border-white/[0.14] text-default-300 h-7 text-[11px]"
                        startContent={
                          copiedId === e.id ? (
                            <PxCheck className="h-3 w-3" />
                          ) : (
                            <PxCopy className="h-3 w-3" />
                          )
                        }
                        onPress={() => copy(e)}
                      >
                        {copiedId === e.id ? "Copied" : "Copy details"}
                      </Button>

                      {canReport ? (
                        <Button
                          size="sm"
                          radius="none"
                          isLoading={sending === e.id}
                          className="bg-accent text-white h-7 text-[11px]"
                          startContent={
                            sending === e.id ? undefined : (
                              <PxSend className="h-3 w-3" />
                            )
                          }
                          onPress={() => report(e)}
                        >
                          {e.reported ? "Report again" : "Report to admin"}
                        </Button>
                      ) : (
                        // Say why rather than showing a button that would drop
                        // the report on the floor.
                        <span className="text-[10px] text-default-500">
                          Reporting is not configured on this server.
                        </span>
                      )}
                    </div>

                    {canReport && (
                      <Textarea
                        size="sm"
                        radius="none"
                        minRows={1}
                        maxRows={3}
                        value={note}
                        onValueChange={setNote}
                        placeholder="What were you doing when this happened? (optional)"
                        classNames={{
                          inputWrapper:
                            "bg-white/[0.03] border-white/[0.08] !rounded-none",
                          input: "text-[11px]",
                        }}
                      />
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
