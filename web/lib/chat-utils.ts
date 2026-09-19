/** Chat-specific formatting + grouping helpers. Pure functions, no React. */

export function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

export function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Parse an ISO string, treating naive (no tz) timestamps as UTC — the backend
 *  emits `datetime.utcnow().isoformat()` which lacks a tz suffix, and
 *  `new Date(...)` would otherwise parse it as local time. */
export function parseUtc(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : iso + "Z");
}

export function formatRelative(iso: string | null | undefined): string {
  const d = parseUtc(iso);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.round(days / 7)}w`;
  return d.toLocaleDateString();
}

export interface MessageGroup<T> {
  day: string;
  items: T[];
}

/** Group messages by formatted day (`Today`/`Yesterday`/long-date). Assumes
 * input is sorted oldest-first; keeps that order. */
export function groupByDay<T extends { createdAt?: string | null }>(
  messages: T[]
): MessageGroup<T>[] {
  const groups: MessageGroup<T>[] = [];
  let current = "";
  for (const m of messages) {
    const day = formatDay(m.createdAt);
    if (day !== current) {
      groups.push({ day, items: [] });
      current = day;
    }
    groups[groups.length - 1].items.push(m);
  }
  return groups;
}

/** True when the string has nothing but emoji/whitespace. Used to upsize
 * text in single-reaction messages. Avoids the Unicode property escape `\p{}`
 * so we don't need ES2018 regex support — instead, reject anything that
 * contains a plain ASCII letter, digit, or common punctuation. */
export function isOnlyEmoji(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  // If the string contains any word-ish character, it's not emoji-only
  if (/[\w.,!?;:'"\-()[\]/\\@#$%^&*+=<>{}|~`]/.test(t)) return false;
  // Must have at least one high-codepoint character (U+2000+) to count as emoji
  for (let i = 0; i < t.length; i++) {
    if (t.charCodeAt(i) >= 0x2000) return true;
  }
  return false;
}

interface SenderAwareMessage {
  createdAt?: string | null;
  fromUser?: { id?: string | number | null } | null;
  senderId?: string | number | null;
  /** Fansly-normalized messages carry a bare sender id instead of fromUser. */
  fromUserId?: string | number | null;
}

/** Resolve a message's sender id across the OF shape (`fromUser.id` /
 * `senderId`) and the fansly-normalized shape (`fromUserId`). */
export function senderIdOf(m: SenderAwareMessage | undefined | null): string {
  if (!m) return "";
  return String(m.fromUser?.id ?? m.senderId ?? m.fromUserId ?? "");
}

/** True when ``m`` is from the same sender as ``prev`` within ``windowMs``.
 * Lets the conversation pane visually tighten consecutive bubbles.
 * Both arguments are nullable so callers can pass ``items[idx+1]`` safely
 * when checking "is this the last bubble in a run". */
export function sameSenderRecently(
  m: SenderAwareMessage | undefined | null,
  prev: SenderAwareMessage | undefined | null,
  windowMs = 2 * 60 * 1000
): boolean {
  if (!m || !prev) return false;
  const a = senderIdOf(m);
  const b = senderIdOf(prev);
  if (!a || a !== b) return false;
  if (!m.createdAt || !prev.createdAt) return false;
  const delta = new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return delta >= 0 && delta <= windowMs;
}

/** Render a compact preview for a message in the chat list — falls through
 * text → PPV price → media indicator → em dash. Reads both the OF `media`
 * array and the fansly-normalized `attachments` array. */
export function previewLine(last: any): string {
  const txt = stripHtml(last?.text);
  if (txt) return txt;
  const price = Number(last?.price || 0);
  if (price > 0) return `💰 $${price.toFixed(2)}`;
  if (
    last?.isMediaReady ||
    (last?.media && last.media.length) ||
    (last?.attachments && last.attachments.length)
  )
    return "📎 Media";
  return "—";
}
