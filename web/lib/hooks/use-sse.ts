"use client";

import { useEffect, useRef, useState } from "react";

export interface LiveEvent {
  id: number | null;
  crm_id: string;
  of_user_id: string | null;
  event_type: string;
  source_event_id?: string | null;
  payload: Record<string, any>;
  occurred_at?: string | null;
  created_at?: string;
}

export interface UseSSEOptions {
  /** Max events to retain in the buffer. Default: 200 */
  bufferSize?: number;
  /** Optional event-type filter. When set, non-matching events are dropped. */
  types?: string[];
  /** Disable the subscription. */
  disabled?: boolean;
}

/**
 * Shared singleton EventSource. Dashboard pages mount many `useLiveData`
 * (each calling `useSSE`); browsers cap EventSource at ~6 per origin, so a
 * separate connection per hook quickly exceeds the limit and silently breaks
 * the page. One connection, refcounted, fans out to all subscribers.
 */
type Listener = (ev: LiveEvent) => void;
type StatusListener = (connected: boolean) => void;

const KNOWN_EVENT_TYPES = [
  "new_subscriber",
  "renewed_subscriber",
  "expired_subscriber",
  "new_tip",
  "new_message",
  "new_purchase",
  "balance_increased",
  "payout_completed",
  "polling_paused",
  // Non-persisted progress events (refresh_state.py in the backend).
  "refresh.progress",
  "refresh.complete",
  // Data-export job progress (export_runner.py in the backend).
  "export.progress",
  "export.complete",
  // Account 2FA / verification gate transitions (of_client / of_faceid).
  "verification.required",
  "verification.approved",
  "verification.failed",
];

class SSESingleton {
  private source: EventSource | null = null;
  private retryDelay = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribers = new Set<Listener>();
  private statusSubscribers = new Set<StatusListener>();
  private dynamicTypes = new Set<string>();
  private connected = false;

  subscribe(listener: Listener): () => void {
    this.subscribers.add(listener);
    if (this.subscribers.size === 1) this.connect();
    return () => {
      this.subscribers.delete(listener);
      if (this.subscribers.size === 0 && this.statusSubscribers.size === 0) {
        this.disconnect();
      }
    };
  }

  subscribeStatus(listener: StatusListener): () => void {
    this.statusSubscribers.add(listener);
    listener(this.connected);
    return () => {
      this.statusSubscribers.delete(listener);
    };
  }

  registerType(type: string): void {
    if (KNOWN_EVENT_TYPES.includes(type) || this.dynamicTypes.has(type)) return;
    this.dynamicTypes.add(type);
    if (this.source) this.attachListener(this.source, type);
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    for (const fn of this.statusSubscribers) fn(value);
  }

  private dispatch = (raw: string) => {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as LiveEvent;
      for (const fn of this.subscribers) fn(parsed);
    } catch {
      // non-JSON heartbeats / comments
    }
  };

  private attachListener(source: EventSource, type: string) {
    source.addEventListener(type, (ev: MessageEvent) => this.dispatch(ev.data));
  }

  private connect = () => {
    if (this.source || this.subscribers.size === 0) return;
    const source = new EventSource("/api/events/stream");
    this.source = source;

    source.onopen = () => {
      this.retryDelay = 1000;
      this.setConnected(true);
    };

    source.onmessage = (ev) => this.dispatch(ev.data);

    for (const t of KNOWN_EVENT_TYPES) this.attachListener(source, t);
    for (const t of this.dynamicTypes) this.attachListener(source, t);

    source.onerror = () => {
      this.setConnected(false);
      source.close();
      if (this.source === source) this.source = null;
      if (this.subscribers.size === 0) return;
      this.retryTimer = setTimeout(this.connect, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    };
  };

  private disconnect = () => {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
    this.setConnected(false);
  };
}

const sseHub = typeof window !== "undefined" ? new SSESingleton() : null;

/**
 * Subscribe to the dashboard's live event stream. All consumers share a single
 * underlying EventSource (refcounted) so the page doesn't hit the browser's
 * ~6-per-origin connection cap.
 */
export function useSSE(options: UseSSEOptions = {}) {
  const { bufferSize = 200, types, disabled } = options;
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  const typesRef = useRef(types);
  typesRef.current = types;
  const bufferSizeRef = useRef(bufferSize);
  bufferSizeRef.current = bufferSize;

  useEffect(() => {
    if (disabled || !sseHub) return;

    // Register any caller-supplied custom types so they get a listener attached
    // (the shared EventSource only auto-attaches the known set).
    for (const t of types ?? []) sseHub.registerType(t);

    const onEvent: Listener = (parsed) => {
      const filter = typesRef.current;
      if (filter && filter.length && !filter.includes(parsed.event_type)) return;
      setEvents((prev) => {
        if (parsed.id && prev.some((e) => e.id === parsed.id)) return prev;
        const next = [parsed, ...prev];
        return next.length > bufferSizeRef.current
          ? next.slice(0, bufferSizeRef.current)
          : next;
      });
      setLastEventAt(parsed.created_at || new Date().toISOString());
    };

    const unsubEvent = sseHub.subscribe(onEvent);
    const unsubStatus = sseHub.subscribeStatus(setConnected);

    return () => {
      unsubEvent();
      unsubStatus();
    };
    // `types` is captured into the ref above; we only need to re-subscribe
    // when `disabled` flips. The types content can change freely without
    // tearing down the connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return { events, connected, lastEventAt, clear: () => setEvents([]) };
}
