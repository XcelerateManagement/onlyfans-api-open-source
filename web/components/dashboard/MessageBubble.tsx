"use client";

import { motion } from "framer-motion";
import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { PxLock, PxPaperclip, PxDollarSign } from "@/components/ui/PixelIcons";
import { formatMessageTime, isOnlyEmoji, stripHtml } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

export type SendStatus = "pending" | "sent" | "failed";

export interface BubbleMessage {
  id: string | number | null;
  text?: string | null;
  createdAt?: string | null;
  price?: number | null;
  isOpened?: boolean | null;
  media?: any[] | null;
  /** Fansly-normalized messages carry media as `attachments` instead of `media`. */
  attachments?: any[] | null;
  fromUser?: { id?: string | number | null; username?: string; name?: string; avatar?: string | null } | null;
  senderId?: string | number | null;
  /** Fansly-normalized sender id (no `fromUser` object is emitted). */
  fromUserId?: string | number | null;
  /** Fansly-normalized "this message is mine" flag — authoritative when present. */
  isFromSelf?: boolean | null;
  /** For optimistic local messages — not present on messages fetched from OF */
  _sendStatus?: SendStatus;
  /** Reply ribbon preview — populated only on optimistic messages for now */
  _replyTo?: { text?: string; username?: string } | null;
}

interface Props {
  message: BubbleMessage;
  /** True if this bubble is from the creator themselves (render on right). */
  fromSelf: boolean;
  /** True if the previous bubble in the timeline is from the same sender and
   * within ~2 min — lets us tighten vertical gaps and hide repeat avatars. */
  continuation: boolean;
  /** True if this bubble is the LAST in a run (show avatar / timestamp). */
  lastInRun: boolean;
  /** The conversation partner — avatar fallback for incoming bubbles whose
   * message rows carry no `fromUser` object (fansly-normalized messages). */
  fanUser?: { username?: string | null; name?: string | null; avatar?: string | null } | null;
  onReply?: (m: BubbleMessage) => void;
}

export function MessageBubble({
  message,
  fromSelf,
  continuation,
  lastInRun,
  fanUser,
  onReply,
}: Props) {
  const text = stripHtml(message.text);
  const price = Number(message.price || 0);
  const isPpv = price > 0;
  // OF emits `media`, fansly-normalized rows emit `attachments`.
  const mediaCount = (message.media || message.attachments || []).length;
  const emojiOnly = !isPpv && !mediaCount && isOnlyEmoji(text);
  const status = message._sendStatus;
  const reply = message._replyTo;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn(
        "flex gap-2 px-2",
        fromSelf ? "justify-end" : "justify-start",
        continuation ? "mt-0.5" : "mt-3"
      )}
    >
      {/* Left-side avatar gutter for incoming messages */}
      {!fromSelf && (
        <div className="w-8 shrink-0">
          {lastInRun ? (
            <FanAvatar
              username={message.fromUser?.username ?? fanUser?.username}
              displayName={message.fromUser?.name ?? fanUser?.name}
              avatar={message.fromUser?.avatar ?? fanUser?.avatar ?? null}
              size={28}
            />
          ) : null}
        </div>
      )}

      <div
        className={cn("max-w-[75%] min-w-0", fromSelf && "items-end")}
        onDoubleClick={() => onReply?.(message)}
      >
        {/* Reply ribbon */}
        {reply && (
          <div
            className={cn(
              "text-[10px] px-2 py-1 mb-0.5 border-l-2 bg-white/[0.03] truncate",
              fromSelf ? "ml-auto" : ""
            )}
            style={{ borderColor: "var(--theme-accent, #f54900)" }}
          >
            <span className="text-default-400">
              ↩ {reply.username ? `@${reply.username}` : "reply"}:
            </span>{" "}
            <span className="text-default-300">{stripHtml(reply.text)}</span>
          </div>
        )}

        {/* Emoji-only: big centered glyph, no bubble */}
        {emojiOnly ? (
          <p
            className={cn(
              "text-[32px] leading-tight",
              fromSelf ? "text-right" : "text-left"
            )}
          >
            {text}
          </p>
        ) : (
          <div
            className={cn(
              "px-3 py-2 text-sm relative",
              fromSelf ? "text-white" : "text-foreground border",
              isPpv && "border-2 border-dashed"
            )}
            style={
              isPpv
                ? {
                    borderColor: "var(--theme-accent, #f54900)",
                    background: fromSelf
                      ? "linear-gradient(135deg, rgba(245,73,0,0.85), rgba(245,73,0,0.6))"
                      : "linear-gradient(135deg, rgba(245,73,0,0.15), rgba(245,73,0,0.04))",
                  }
                : fromSelf
                  ? { backgroundColor: "var(--theme-accent, #f54900)" }
                  : { backgroundColor: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.06)" }
            }
          >
            {/* PPV header */}
            {isPpv && (
              <div
                className={cn(
                  "flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold mb-1.5",
                  fromSelf ? "text-white/90" : "text-warning-500"
                )}
              >
                <PxLock className="h-3 w-3" />
                <span>PPV · ${price.toFixed(2)}</span>
                <span
                  className={cn(
                    "ml-auto px-1.5 py-0.5 text-[9px]",
                    message.isOpened
                      ? "bg-success-500/20 text-success-500"
                      : "bg-white/10"
                  )}
                >
                  {message.isOpened ? "unlocked" : "locked"}
                </span>
              </div>
            )}

            {/* PPV media placeholder */}
            {isPpv && (
              <div
                className={cn(
                  "h-24 mb-2 flex items-center justify-center text-[11px] uppercase tracking-wider",
                  "border border-dashed backdrop-blur-sm"
                )}
                style={{
                  borderColor: "rgba(255,255,255,0.15)",
                  background:
                    "radial-gradient(circle at 30% 30%, rgba(245,73,0,0.25), rgba(0,0,0,0.4))",
                  color: fromSelf ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.4)",
                }}
              >
                {message.isOpened ? "media preview" : "🔒 locked media"}
              </div>
            )}

            {/* Regular media attachments (non-PPV) */}
            {!isPpv && mediaCount > 0 && (
              <div
                className={cn(
                  "flex items-center gap-1.5 text-[11px] uppercase tracking-wider mb-1 opacity-70"
                )}
              >
                <PxPaperclip className="h-3 w-3" />
                {mediaCount} attachment{mediaCount === 1 ? "" : "s"}
              </div>
            )}

            {text && (
              <p className="whitespace-pre-wrap break-words leading-snug">
                {text}
              </p>
            )}

            {/* Bottom line: timestamp + send status */}
            <div
              className={cn(
                "flex items-center gap-1 mt-1 text-[10px]",
                fromSelf ? "text-white/70 justify-end" : "text-default-400"
              )}
            >
              <span className="tabular-nums">
                {formatMessageTime(message.createdAt)}
              </span>
              {status && fromSelf && (
                <SendStatusIcon status={status} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right-side spacer for outgoing messages (keeps alignment tidy) */}
      {fromSelf && <div className="w-1 shrink-0" aria-hidden />}
    </motion.div>
  );
}

function SendStatusIcon({ status }: { status: SendStatus }) {
  if (status === "pending") {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full border border-white/60 border-t-transparent animate-spin"
        aria-label="sending"
      />
    );
  }
  if (status === "failed") {
    return (
      <span className="text-red-300 font-bold" aria-label="failed" title="Send failed">
        !
      </span>
    );
  }
  return <span aria-label="sent">✓</span>;
}
