import type { RequestMetrics } from "@/lib/api-client";

/**
 * Guided-tour fixture for `ApiMetricsCard`. Deliberately shaped exactly like
 * `GET /metrics/requests` — including a couple of empty buckets that carry
 * `avg_latency_ms: null`, so the tour exercises the same gap-drawing path the
 * real payload does.
 */
function buildSeries() {
  const now = Date.now();
  const step = 3600_000;
  const volume = [
    412, 388, 301, 254, 190, 143, 121, 0, 0, 96, 188, 274, 361, 448, 512, 486,
    533, 604, 571, 498, 462, 517, 589, 421,
  ];
  return volume.map((total, i) => {
    const bucket = new Date(now - (volume.length - 1 - i) * step).toISOString();
    if (total === 0) {
      return {
        bucket,
        total: 0,
        "1xx": 0,
        "2xx": 0,
        "3xx": 0,
        "4xx": 0,
        "5xx": 0,
        errors: 0,
        error_rate: 0,
        avg_latency_ms: null,
        max_latency_ms: 0,
        slow_requests: 0,
      };
    }
    const c4 = i % 5 === 0 ? Math.round(total * 0.02) : 0;
    const c5 = i === 14 || i === 15 ? Math.round(total * 0.04) : 0;
    const errors = c4 + c5;
    return {
      bucket,
      total,
      "1xx": 0,
      "2xx": total - errors,
      "3xx": 0,
      "4xx": c4,
      "5xx": c5,
      errors,
      error_rate: Number((errors / total).toFixed(6)),
      avg_latency_ms: Number((120 + (i % 7) * 34 + (c5 ? 380 : 0)).toFixed(1)),
      max_latency_ms: 340 + (i % 7) * 90 + (c5 ? 1600 : 0),
      slow_requests: c5 ? Math.round(total * 0.01) : 0,
    };
  });
}

const series = buildSeries();
const requests = series.reduce((s, b) => s + b.total, 0);
const errors = series.reduce((s, b) => s + b.errors, 0);
const clientErrors = series.reduce((s, b) => s + b["4xx"], 0);
const serverErrors = series.reduce((s, b) => s + b["5xx"], 0);
const slow = series.reduce((s, b) => s + b.slow_requests, 0);

export const TOUR_REQUEST_METRICS: RequestMetrics = {
  range: {
    since: series[0].bucket,
    until: series[series.length - 1].bucket,
    hours: 24,
    granularity: "1h",
    bucket_seconds: 3600,
    buckets: series.length,
    crm_id: "crm_demo",
  },
  totals: {
    requests,
    errors,
    client_errors: clientErrors,
    server_errors: serverErrors,
    error_rate: Number((errors / requests).toFixed(6)),
    server_error_rate: Number((serverErrors / requests).toFixed(6)),
    avg_latency_ms: 214.7,
    max_latency_ms: 2140,
    slow_requests: slow,
    slow_rate: Number((slow / requests).toFixed(6)),
    slow_threshold_ms: 1000,
  },
  series,
  status_codes: [
    { status: 200, status_class: "2xx", count: requests - errors },
    { status: 429, status_class: "4xx", count: clientErrors },
    { status: 500, status_class: "5xx", count: serverErrors },
  ],
  top_routes: [
    {
      route: "/api/crm/<crm_id>/accounts",
      method: "GET",
      requests: 2841,
      errors: 12,
      client_errors: 12,
      server_errors: 0,
      error_rate: 0.004224,
      avg_latency_ms: 82.6,
      max_latency_ms: 210,
      slow_requests: 0,
    },
    {
      route: "/api/crm/<crm_id>/subscribers/cached",
      method: "GET",
      requests: 1904,
      errors: 0,
      client_errors: 0,
      server_errors: 0,
      error_rate: 0,
      avg_latency_ms: 141.2,
      max_latency_ms: 388,
      slow_requests: 0,
    },
    {
      route: "/api/crm/<crm_id>/earnings/summary",
      method: "GET",
      requests: 1188,
      errors: 41,
      client_errors: 0,
      server_errors: 41,
      error_rate: 0.034512,
      avg_latency_ms: 604.9,
      max_latency_ms: 2140,
      slow_requests: 37,
    },
  ],
  slowest_routes: [],
  top_error_routes: [
    {
      route: "/api/crm/<crm_id>/earnings/summary",
      method: "GET",
      requests: 1188,
      errors: 41,
      client_errors: 0,
      server_errors: 41,
      error_rate: 0.034512,
      avg_latency_ms: 604.9,
      max_latency_ms: 2140,
      slow_requests: 37,
    },
    {
      route: "/api/crm/<crm_id>/accounts",
      method: "GET",
      requests: 2841,
      errors: 12,
      client_errors: 12,
      server_errors: 0,
      error_rate: 0.004224,
      avg_latency_ms: 82.6,
      max_latency_ms: 210,
      slow_requests: 0,
    },
  ],
  top_tenants: [],
  collector: {
    recorded: 0,
    dropped: 0,
    flushed_rows: 0,
    pending_buckets: 0,
    pending_requests: 0,
    last_flush_at: null,
    last_flush_error: null,
    bucket_seconds: 300,
    slow_ms: 1000,
    retention_days: 30,
    enabled: true,
  },
};
