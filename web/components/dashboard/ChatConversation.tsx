"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";

import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { DayDivider } from "@/components/dashboard/DayDivider";
import {
  MessageBubble,
  type BubbleMessage,
  type SendStatus,
} from "@/components/dashboard/MessageBubble";
import {
  MessageComposer,
  type ReplyTarget,
  type SendPayload,
} from "@/components/dashboard/MessageComposer";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { useApiClient } from "@/lib/hooks/use-api-client";
import { groupByDay, sameSenderRecently, senderIdOf, stripHtml } from "@/lib/chat-utils";
import { useTour } from "@/lib/tour-context";
import { TOUR_THREAD_MESSAGES } from "@/lib/tour-fake-data";
import type { Platform } from "@/lib/hooks/use-selected-account";
import type { PlatformFeature } from "@/lib/platform-capabilities";

interface Props {
  ofUserId: string;
  ofSelfId: string;
  chat: any;
  liveSignal?: number;
  onBack?: () => void;
  connected?: boolean;
  /** The selected account (platform + backend-emitted capabilities) — threaded
   * down to the composer so Attach/PPV can be capability-gated per platform. */
  account?: {
    platform?: Platform;
    capabilities?: Partial<Record<PlatformFeature, boolean>>;
  } | null;
}

export function ChatConversation({
  ofUserId,
  ofSelfId,
  chat,
  liveSignal,
  onBack,
  connected,
  account,
}: Props) {
  const api = useApiClient();
  const { isActive: isTourActive } = useTour();
  const [messages, setMessages] = useState<BubbleMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const fanUser = chat?.withUser || chat?.user || {};
  const fanId = String(fanUser.id || "");
  // The id used to fetch/send messages. Fansly keys its messages + send
  // endpoints on the conversation groupId (surfaced as `messageRouteId`), NOT
  // the partner account id. OF rows have no messageRouteId → falls back to
  // fanId, which is correct for OnlyFans.
  const convId = String((chat as any)?.messageRouteId || fanUser.id || "");

  // Draft is per-conversation — clear when the chat switches
  useEffect(() => {
    setDraft("");
    setReplyTo(null);
  }, [fanId]);

  // Fetch message history. Re-runs when chat changes OR the live signal bumps
  // (parent increments liveSignal when an SSE new_message for this account arrives).
  useEffect(() => {
    if (isTourActive) {
      // Re-key the demo thread so the bubbles are unique per conversation
      // (otherwise React key collisions across chat switches).
      const fanFirstName = (chat?.withUser?.name || chat?.withUser?.username || "").split(" ")[0];
      setMessages(
        TOUR_THREAD_MESSAGES.map((m) => ({
          ...m,
          // Make outgoing bubbles attribute to the active "self" account.
          fromUser:
            String(m.fromUser?.id) === "9999001"
              ? { id: ofSelfId }
              : { ...m.fromUser, id: fanId },
          // Personalise lightly so each thread feels distinct.
          text:
            m.text && fanFirstName && m.text.includes("Sarah")
              ? m.text.replace(/Sarah/g, fanFirstName)
              : m.text,
        })) as unknown as BubbleMessage[],
      );
      setLoading(false);
      return;
    }
    if (!api || !fanId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await api!.listChatMessages(ofUserId, convId, { limit: 60 });
        if (cancelled) return;
        const fetched = (res.messages || []).slice().reverse(); // oldest-first
        setMessages((prev) => {
          // Preserve optimistic / failed local messages that haven't been
          // replaced by a server-side twin yet.
          const optimistic = prev.filter(
            (m) => typeof m.id === "string" && String(m.id).startsWith("local-")
          );
          return [...fetched, ...optimistic];
        });
      } catch (err: any) {
        if (!cancelled) toast.error(err?.message || "Failed to load messages");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api, ofUserId, fanId, liveSignal, isTourActive, ofSelfId, chat]);

  // Auto-scroll to bottom when a new message arrives AND user is already at bottom
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJumpToBottom(false);
    } else {
      setShowJumpToBottom(true);
    }
  }, [messages]);

  // Track scroll position to decide whether to auto-scroll future messages
  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const threshold = 100; // px from bottom
    const distanceFromBottom =
      el.scrollHeight - (el.scrollTop + el.clientHeight);
    atBottomRef.current = distanceFromBottom < threshold;
    if (atBottomRef.current) setShowJumpToBottom(false);
  }

  function jumpToBottom() {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setShowJumpToBottom(false);
  }

  const grouped = useMemo(() => groupByDay(messages), [messages]);

  const handleSend = useCallback(
    async (payload: SendPayload) => {
      if (!api) return;
      const localId = `local-${Date.now()}`;
      const optimistic: BubbleMessage = {
        id: localId,
        text: payload.text,
        createdAt: new Date().toISOString(),
        price: payload.price,
        isOpened: false,
        media: payload.attachmentNames.length
          ? payload.attachmentNames.map((name) => ({ name }))
          : [],
        fromUser: { id: ofSelfId },
        _sendStatus: "pending",
        _replyTo: payload.replyTo
          ? { text: payload.replyTo.text, username: payload.replyTo.username }
          : null,
      };
      setMessages((prev) => [...prev, optimistic]);
      atBottomRef.current = true;

      try {
        await api.sendMessage(ofUserId, convId, {
          text: payload.text,
          price: payload.price,
          attachmentNames: payload.attachmentNames,
          replyToId:
            payload.replyTo?.id != null
              ? String(payload.replyTo.id)
              : undefined,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId ? { ...m, _sendStatus: "sent" as SendStatus } : m
          )
        );
      } catch (err: any) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === localId ? { ...m, _sendStatus: "failed" as SendStatus } : m
          )
        );
        // WRITES_DISABLED is handled globally (WritesDisabledWatcher shows a
        // one-click enable toast); suppress the redundant generic toast for it.
        if (err?.data?.code === "WRITES_DISABLED") return;
        const msg = err?.message || "Send failed";
        if (err?.status === 501 || /not wired/i.test(msg)) {
          toast(
            "✈️ Compose UI is ready, but the send path isn't wired yet — your real chat components land here.",
            { duration: 4500 }
          );
        } else {
          toast.error(msg);
        }
      }
    },
    [api, ofSelfId, ofUserId, fanId]
  );

  const onReply = useCallback((m: BubbleMessage) => {
    setReplyTo({
      id: m.id,
      username: m.fromUser?.username,
      text: stripHtml(m.text),
    });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#0d0d0d] shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="md:hidden text-default-400 hover:text-foreground text-xs"
          >
            ← Back
          </button>
        )}
        <FanAvatar
          username={fanUser.username}
          displayName={fanUser.name}
          avatar={fanUser.avatar}
          size={40}
        />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">
            {fanUser.name || fanUser.username || "Unknown"}
          </p>
          <p className="text-[11px] text-default-400 truncate">
            @{fanUser.username || fanId}
          </p>
        </div>
        {connected && (
          <span className="text-[10px] text-success-500 flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-success-500 animate-pulse"
              aria-hidden
            />
            Live
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto py-3 relative styled-scrollbar"
      >
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <PixelSpinner />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-default-400 text-center py-12">
            No messages yet in this conversation.
          </p>
        ) : (
          <>
            {grouped.map((group) => {
              let prev: BubbleMessage | null = null;
              return (
                <div key={group.day}>
                  <DayDivider label={group.day} />
                  <AnimatePresence initial={false}>
                    {group.items.map((m, idx) => {
                      // Prefer the normalizer's explicit flag (fansly rows
                      // carry isFromSelf but no fromUser object), then fall
                      // back to comparing sender ids across both shapes
                      // (fromUser.id / senderId / fromUserId).
                      const fromSelf =
                        typeof m.isFromSelf === "boolean"
                          ? m.isFromSelf
                          : senderIdOf(m) === String(ofSelfId);
                      const continuation = sameSenderRecently(m, prev);
                      const next = group.items[idx + 1];
                      const lastInRun = !sameSenderRecently(next, m);
                      prev = m;
                      return (
                        <MessageBubble
                          key={String(m.id ?? `k-${idx}`)}
                          message={m}
                          fromSelf={fromSelf}
                          continuation={continuation}
                          lastInRun={lastInRun}
                          fanUser={fanUser}
                          onReply={onReply}
                        />
                      );
                    })}
                  </AnimatePresence>
                </div>
              );
            })}
          </>
        )}

        {/* Jump-to-bottom pill */}
        <AnimatePresence>
          {showJumpToBottom && (
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              onClick={jumpToBottom}
              className="sticky bottom-3 mx-auto block px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white shadow-lg"
              style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
            >
              ↓ New messages
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <MessageComposer
        draft={draft}
        onDraftChange={setDraft}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSend={handleSend}
        account={account}
      />
    </div>
  );
}
