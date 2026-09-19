"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useApiClient } from "@/lib/hooks/use-api-client";
import { ApiErrorList } from "@/components/dashboard/ApiErrorList";
import { useTour } from "@/lib/tour-context";
import { ApiError, type RequestMetrics, type MetricsRouteRow } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PxActivity, PxCode2, PxZap, PxKey } from "@/components/ui/PixelIcons";
import {
  GlassCard,
  GlassCardHeader,
  GlassCardBody,
} from "@/components/dashboard/GlassCard";
import { TOUR_REQUEST_METRICS } from "@/components/dashboard/tour-request-metrics";

const RANGES = [
  { key: "24h", label: "24h", hours: 24 },
  { key: "7d", label: "7d", hours: 24 * 7 },
  { key: "30d", label: "30d", hours: 24 * 30 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

interface Usage {
  plan: string;
  api_calls_used: number;
  api_calls_limit: number;
}

const ACCENT = "var(--theme-accent, #f54900)";
// Status colours are the dashboard's existing reserved set. They are only ever
// used NEXT TO the class name in text ("5xx 6"), never as the sole carrier of
// identity — a green/amber/red triple fails CVD separation as a categorical
// palette (validated: green↔amber ΔE 5.7 protan), which is also why neither
// chart below encodes status by colour.
const CLASS_STYLE: Record<string, string> = {
  "2xx": "bg-green-500",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-400",
  "5xx": "bg-red-500",
};

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Fractions come back 0–1 at 6dp; render as a percentage with useful precision
 *  at the low end, because a 0.4% server-error rate still matters. */
function pct(fraction: number): string {
  const p = fraction * 100;
  if (p === 0) return "0%";
  if (p < 0.1) return "<0.1%";
  return `${p.toFixed(p < 10 ? 1 : 0)}%`;
}

function ms(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

/** Bucket label sized to the granularity the backend chose. */
function bucketLabel(iso: string, granularity: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  if (granularity === "1d" || granularity === "6h") {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortRoute(route: string): string {
  // Routes arrive as full templated paths; the /api/crm/<crm_id> prefix is the
  // same on every row and just eats width.
  return route.replace(/^\/api\/crm\/<crm_id>/, "") || route;
}

/**
 * Panel-wide request outcomes on the Overview — the "see all requests at scale
 * / are there any API failures" card.
 *
 * Cost: TWO requests, flat. `/metrics/requests` (volume + status classes +
 * error rate + latency + worst routes, all from local counters) and `/usage`
 * (monthly quota). Nothing scales with the number of connected accounts.
 *
 * If `/metrics/requests` isn't there yet — the route is newer than some
 * deployed backends — this degrades to the per-key call counters behind
 * `/api-keys`, which know volume but nothing about outcomes, and says so.
 */
export function ApiMetricsCard() {
  const api = useApiClient();
  const { isActive: isTourActive } = useTour();

  const [range, setRange] = useState<RangeKey>("24h");
  const [metrics, setMetrics] = useState<RequestMetrics | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  /** Set when the backend has no metrics route and we fell back to raw counts. */
  const [degraded, setDegraded] = useState(false);

  const hours = RANGES.find((r) => r.key === range)!.hours;

  const loadFallback = useCallback(async () => {
    // No outcome data exists on this backend. Rebuild volume-only from the
    // per-key daily counters so the card still answers "how much traffic",
    // and let the UI state say what's missing.
    const keyRes = await api!.listApiKeys();
    const rows = keyRes.keys || [];
    // The per-key counters are daily-only, so the range selector cannot be
    // honoured — a "24h" request would be a single bucket, which is not a
    // chart. Always serve the full 30-day daily series and hide the selector.
    const days = 30;
    const totals = new Array(days).fill(0) as number[];
    for (const k of rows) {
      const s = k.series || [];
      const tail = s.slice(Math.max(0, s.length - days));
      const offset = days - tail.length;
      tail.forEach((v, i) => {
        totals[offset + i] += v || 0;
      });
    }
    const today = new Date();
    const series = totals.map((total, i) => {
      const d = new Date(today.getTime() - (days - 1 - i) * 86_400_000);
      return {
        bucket: d.toISOString(),
        total,
        "1xx": 0,
        "2xx": total,
        "3xx": 0,
        "4xx": 0,
        "5xx": 0,
        errors: 0,
        error_rate: 0,
        avg_latency_ms: null,
        max_latency_ms: 0,
        slow_requests: 0,
      };
    });
    const sum = totals.reduce((a, b) => a + b, 0);
    setMetrics({
      range: {
        since: series[0]?.bucket ?? "",
        until: today.toISOString(),
        hours: days * 24,
        granularity: "1d",
        bucket_seconds: 86_400,
        buckets: series.length,
        crm_id: null,
      },
      totals: {
        requests: sum,
        errors: 0,
        client_errors: 0,
        server_errors: 0,
        error_rate: 0,
        server_error_rate: 0,
        avg_latency_ms: null,
        max_latency_ms: 0,
        slow_requests: 0,
        slow_rate: 0,
        slow_threshold_ms: 0,
      },
      series,
      status_codes: [],
      top_routes: [],
      slowest_routes: [],
      top_error_routes: [],
      top_tenants: [],
      collector: {
        recorded: 0,
        dropped: 0,
        flushed_rows: 0,
        pending_buckets: 0,
        pending_requests: 0,
        last_flush_at: null,
        last_flush_error: null,
        bucket_seconds: 86_400,
        slow_ms: 0,
        retention_days: 30,
        enabled: false,
      },
    });
    setDegraded(true);
  }, [api, hours]);

  useEffect(() => {
    if (isTourActive) {
      setMetrics(TOUR_REQUEST_METRICS);
      setUsage({ plan: "slots", api_calls_used: 39_811, api_calls_limit: -1 });
      setDegraded(false);
      setLoading(false);
      return;
    }
    if (!api) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const [m, u] = await Promise.all([
          api.getRequestMetrics({ hours, limit: 6 }).catch((e) => e as ApiError),
          api.getUsage().catch(() => null),
        ]);
        if (cancelled) return;

        if (u) {
          setUsage({
            plan: u.plan,
            api_calls_used: u.api_calls_used,
            api_calls_limit: u.api_calls_limit,
          });
        }

        if (m instanceof ApiError) {
          // A 404 means this backend predates the metrics route — that is a
          // capability gap, not an outage, so fall back instead of erroring.
          if (m.status === 404) {
            await loadFallback();
            if (!cancelled) setError(null);
          } else {
            throw m;
          }
        } else {
          setMetrics(m.metrics);
          setDegraded(false);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(
            e instanceof ApiError
              ? e
              : new ApiError(0, { error: e?.message || "Could not load API metrics" })
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, hours, isTourActive, loadFallback]);

  const chart = useMemo(() => {
    if (!metrics) return [];
    const g = metrics.range.granularity;
    return metrics.series.map((b) => ({
      label: bucketLabel(b.bucket, g),
      total: b.total,
      errors: b.errors,
      // null stays null so the latency line draws a gap in an empty bucket
      // instead of diving to a zero that never happened.
      latency: b.avg_latency_ms,
    }));
  }, [metrics]);

  const totals = metrics?.totals;
  const hasErrors = (totals?.errors ?? 0) > 0;
  const hasLatency = chart.some((p) => p.latency != null);
  // Show the routes that failed when anything failed; otherwise the busiest.
  const routeRows: MetricsRouteRow[] = hasErrors
    ? metrics!.top_error_routes.slice(0, 6)
    : (metrics?.top_routes ?? []).slice(0, 6);
  const routeMax = Math.max(
    ...routeRows.map((r) => (hasErrors ? r.errors : r.requests)),
    1
  );

  const quota =
    usage && usage.api_calls_limit > 0
      ? Math.min(100, (usage.api_calls_used / usage.api_calls_limit) * 100)
      : null;

  const tooltipStyle = {
    backgroundColor: "#0d0d0d",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 0,
    fontSize: 12,
  };

  return (
    <GlassCard delay={0.05}>
      <GlassCardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <PxActivity className="h-4 w-4 text-[color:var(--theme-accent,#f54900)]" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              API Requests
            </h3>
          </div>
          <div className="flex items-center gap-3">
            {/* Hidden in degraded mode: the fallback source is daily-only and
                cannot answer a 24h question, so offering the choice would lie. */}
            <div className={cn("flex border border-white/[0.08]", degraded && "hidden")}>
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  className={cn(
                    "px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors",
                    range === r.key
                      ? "text-white"
                      : "text-default-500 hover:text-foreground"
                  )}
                  style={
                    range === r.key
                      ? { backgroundColor: "rgba(var(--theme-accent-rgb,245,73,0),0.15)" }
                      : undefined
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Link
              href="/dashboard/api-keys"
              className="text-[10px] uppercase tracking-wider text-default-500 hover:text-foreground transition-colors"
            >
              Per-key detail →
            </Link>
          </div>
        </div>
      </GlassCardHeader>

      <GlassCardBody className="space-y-5">
        {error ? (
          <div
            className={cn(
              "flex items-start gap-2 border p-3",
              error.isRateLimit
                ? "border-amber-500/30 bg-amber-500/[0.06]"
                : "border-red-500/30 bg-red-500/[0.06]"
            )}
          >
            <PxZap
              className={cn(
                "h-3.5 w-3.5 mt-0.5 shrink-0",
                error.isRateLimit ? "text-amber-400" : "text-red-400"
              )}
            />
            <p className="text-[11px] text-default-400 leading-relaxed">
              {error.message} Metrics are unavailable right now — this is a
              failed request, not zero traffic.
            </p>
          </div>
        ) : loading || !metrics || !totals ? (
          <div className="py-10 text-center text-sm text-default-400">
            Loading metrics…
          </div>
        ) : (
          <>
            {/* Headline tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Tile
                label="Requests"
                value={fmt(totals.requests)}
                sub={
                  metrics.range.hours >= 48
                    ? `last ${Math.round(metrics.range.hours / 24)} days`
                    : `last ${metrics.range.hours}h`
                }
              />
              <Tile
                label="Error rate"
                value={degraded ? "—" : pct(totals.error_rate)}
                sub={
                  degraded
                    ? "not tracked"
                    : `${fmt(totals.errors)} failed · ${fmt(totals.server_errors)} 5xx`
                }
                tone={
                  degraded
                    ? undefined
                    : totals.server_errors > 0
                      ? "critical"
                      : totals.errors > 0
                        ? "warning"
                        : "good"
                }
              />
              <Tile
                label="Avg latency"
                value={degraded ? "—" : ms(totals.avg_latency_ms)}
                sub={degraded ? "not tracked" : `max ${ms(totals.max_latency_ms)}`}
              />
              <Tile
                // The threshold goes in `sub`, not the label — the label is
                // uppercased by CSS and "≥1.00S" is not a unit.
                label="Slow requests"
                value={degraded ? "—" : fmt(totals.slow_requests)}
                sub={
                  degraded
                    ? "not tracked"
                    : `${pct(totals.slow_rate)} over ${ms(totals.slow_threshold_ms)}`
                }
                tone={
                  !degraded && totals.slow_requests > 0 ? "warning" : undefined
                }
              />
            </div>

            {degraded && (
              <div className="flex items-start gap-2 border border-white/[0.08] bg-white/[0.02] p-3">
                <PxZap className="h-3.5 w-3.5 text-default-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-default-400 leading-relaxed">
                  This backend doesn&apos;t expose per-request metrics yet, so
                  only call volume is shown — from the per-key daily counters,
                  which record that a call happened but not how it finished.
                  Status codes, error rate and latency need a backend with{" "}
                  <code className="text-foreground">/metrics/requests</code>.
                </p>
              </div>
            )}

            {/* Status-class chips. The class NAME carries identity; the dot is
                decoration, so this is readable without colour vision. */}
            {!degraded && metrics.status_codes.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {Object.entries(
                  metrics.status_codes.reduce<Record<string, number>>((acc, s) => {
                    acc[s.status_class] = (acc[s.status_class] || 0) + s.count;
                    return acc;
                  }, {})
                )
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([klass, count]) => (
                    <span key={klass} className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0",
                          CLASS_STYLE[klass] || "bg-white/40"
                        )}
                      />
                      <span className="text-[11px] font-mono text-default-400">
                        {klass}
                      </span>
                      <span className="text-[11px] font-semibold tabular-nums">
                        {fmt(count)}
                      </span>
                    </span>
                  ))}
              </div>
            )}

            {/* Volume. Single series — no legend needed, the title names it. */}
            <div>
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-default-500 mb-2">
                <span>Requests per {metrics.range.granularity} bucket</span>
                <span className="text-default-600 normal-case tracking-normal">
                  {metrics.range.buckets} buckets
                </span>
              </div>
              <div className="h-44 w-full border border-white/[0.06] bg-black/30 p-2">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={{ width: 640, height: 160 }}
                >
                  <AreaChart data={chart}>
                    <defs>
                      <linearGradient id="apiReqGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.3} />
                        <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval={Math.max(0, Math.ceil(chart.length / 6) - 1)}
                    />
                    <YAxis tick={{ fontSize: 10 }} width={38} allowDecimals={false} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v: any) => [fmt(Number(v)), "requests"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke={ACCENT}
                      strokeWidth={2}
                      fill="url(#apiReqGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Failures get their own chart rather than a sliver inside the
                volume stack — a 1% error rate is invisible when stacked, and
                "are there failures" is the question this card exists for. */}
            {!degraded &&
              (hasErrors ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-default-500 mb-2">
                    Failed requests (4xx + 5xx)
                  </div>
                  <div className="h-28 w-full border border-red-500/20 bg-black/30 p-2">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      initialDimension={{ width: 640, height: 96 }}
                    >
                      <AreaChart data={chart}>
                        <defs>
                          <linearGradient id="apiErrGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 10 }}
                          interval={Math.max(0, Math.ceil(chart.length / 6) - 1)}
                        />
                        <YAxis tick={{ fontSize: 10 }} width={38} allowDecimals={false} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: any) => [fmt(Number(v)), "failed"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="errors"
                          stroke="#ef4444"
                          strokeWidth={2}
                          fill="url(#apiErrGradient)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 border border-green-500/20 bg-green-500/[0.04] px-3 py-2">
                  <span className="h-1.5 w-1.5 bg-green-500 shrink-0" />
                  <p className="text-[11px] text-green-400">
                    No failed requests in this window — {fmt(totals.requests)}{" "}
                    calls, all 2xx/3xx.
                  </p>
                </div>
              ))}

            {/* Latency over time. Separate chart, not a second axis on volume. */}
            {!degraded && hasLatency && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-default-500 mb-2">
                  Average latency · gaps are buckets with no traffic
                </div>
                <div className="h-28 w-full border border-white/[0.06] bg-black/30 p-2">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={{ width: 640, height: 96 }}
                  >
                    <LineChart data={chart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10 }}
                        interval={Math.max(0, Math.ceil(chart.length / 6) - 1)}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        width={44}
                        tickFormatter={(v: any) => `${Math.round(Number(v))}`}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v: any) => [ms(Number(v)), "avg latency"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="latency"
                        stroke="#38bdf8"
                        strokeWidth={2}
                        dot={false}
                        // An empty bucket has no latency; bridging it would
                        // invent data. Leave the gap.
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Route rollup — failing routes when there are any, else busiest. */}
            {hasErrors && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-default-500 mb-2">
                  <PxCode2 className="h-3 w-3" />
                  {/* The rows above aggregate; these are the actual failures,
                      with the response body, so the operator can read and
                      report one instead of guessing from a count. */}
                  <span>What failed</span>
                </div>
                <ApiErrorList />
              </div>
            )}

            {routeRows.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-default-500 mb-2">
                  <PxCode2 className="h-3 w-3" />
                  <span>{hasErrors ? "Routes with failures" : "Busiest routes"}</span>
                </div>
                <div className="space-y-1">
                  {routeRows.map((r, i) => {
                    const bar = hasErrors ? r.errors : r.requests;
                    return (
                      <motion.div
                        key={`${r.method} ${r.route}`}
                        initial={{ opacity: 0, x: 6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        className="relative border border-white/[0.04] bg-white/[0.02] px-3 py-1.5 overflow-hidden"
                      >
                        <div
                          className="absolute inset-y-0 left-0"
                          style={{
                            width: `${(bar / routeMax) * 100}%`,
                            backgroundColor: hasErrors
                              ? "rgba(239,68,68,0.12)"
                              : "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.10)",
                          }}
                        />
                        <div className="relative flex items-center justify-between gap-3">
                          <span className="font-mono text-[11px] text-default-400 truncate">
                            <span className="text-default-500">{r.method}</span>{" "}
                            {shortRoute(r.route)}
                          </span>
                          <span className="flex items-center gap-3 shrink-0 text-[11px] tabular-nums">
                            {hasErrors && (
                              <span className="text-red-400 font-semibold">
                                {fmt(r.errors)} err · {pct(r.error_rate)}
                              </span>
                            )}
                            <span className="text-default-500">{ms(r.avg_latency_ms)}</span>
                            <span className="font-semibold">{fmt(r.requests)}</span>
                          </span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quota bar — only meaningful on a metered plan */}
            {quota !== null && usage && (
              <div>
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-default-500 mb-1.5">
                  <span>Monthly quota · {usage.plan}</span>
                  <span className="tabular-nums">{quota.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 bg-white/[0.06]">
                  <motion.div
                    className="h-full"
                    style={{
                      backgroundColor: quota > 90 ? "#ef4444" : ACCENT,
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${quota}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>
              </div>
            )}

            {/* Provenance + the honest caveats */}
            <div className="flex items-start gap-2 pt-1 border-t border-white/[0.06]">
              <PxKey className="h-3 w-3 text-default-500 mt-1 shrink-0" />
              <p className="text-[10px] text-default-500 leading-relaxed pt-0.5">
                {degraded
                  ? "Volume is summed from per-key daily counters."
                  : `Every counted API call for this panel, excluding the /events/stream SSE endpoint (a long-lived connection would distort latency). Retained ${metrics.collector.retention_days} days. Latency is an average and a max — no percentiles are stored, so none are shown.`}
              </p>
            </div>
          </>
        )}
      </GlassCardBody>
    </GlassCard>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warning" | "critical";
}) {
  const toneClass =
    tone === "critical"
      ? "text-red-400"
      : tone === "warning"
        ? "text-amber-300"
        : tone === "good"
          ? "text-green-400"
          : "";
  return (
    <div className="border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-default-500 truncate">
        {label}
      </div>
      <div className={cn("text-lg font-bold mt-0.5 tabular-nums", toneClass)}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-default-500 truncate">{sub}</div>}
    </div>
  );
}
