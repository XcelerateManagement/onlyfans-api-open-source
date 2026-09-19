"use client";

import { RealtimeChip } from "./RealtimeStatus";

/**
 * Global live-stream freshness indicator. Mounted once in the dashboard Header
 * so every page inherits the signal. Subscribing here also keeps the shared
 * (refcounted) EventSource open on pages that don't otherwise subscribe —
 * giving those pages a live signal too.
 *
 * This used to render `useSSE().connected` directly, i.e. "the browser holds an
 * EventSource to our own backend". That is true on every panel, including one
 * whose accounts cannot emit a single event, so the most prominent badge in the
 * product asserted "Live" over a permanently silent feed. It now defers to
 * RealtimeStatus, which checks that some account actually has an event source
 * running before it says so.
 *
 * State stays inside RealtimeChip, so SSE events re-render the pill rather than
 * the whole Header.
 */
export function ConnectionStatus() {
  return <RealtimeChip className="hidden md:inline-flex" />;
}
