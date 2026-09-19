"use client";

import { motion } from "framer-motion";
import { FanAvatar } from "@/components/dashboard/FanAvatar";
import { formatRelative, previewLine } from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

interface ChatListItemProps {
  chat: any;
  selected: boolean;
  onSelect: () => void;
  /** The creator's own OF user id — lets us draw direction arrows on outgoing last-messages. */
  ofSelfId?: string | null;
}

export function ChatListItem({ chat, selected, onSelect, ofSelfId }: ChatListItemProps) {
  const user = chat.withUser || chat.user || {};
  const last = chat.lastMessage || {};
  const unread = Number(chat.unreadMessagesCount || chat.count_unread || 0);
  const preview = previewLine(last);

  // Direction: is the last message from the creator themselves?
  const fromId = String(
    last.fromUser?.id ?? last.senderId ?? last.userId ?? ""
  );
  const isOutgoing = !!ofSelfId && fromId && fromId === String(ofSelfId);

  return (
    <motion.button
      layout
      variants={{
        hidden: { opacity: 0, x: -6 },
        visible: { opacity: 1, x: 0 },
      }}
      onClick={onSelect}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors relative",
        selected ? "bg-white/[0.04]" : "hover:bg-white/[0.02]"
      )}
      style={
        selected
          ? { borderLeft: "2px solid var(--theme-accent, #f54900)" }
          : { borderLeft: "2px solid transparent" }
      }
    >
      <FanAvatar
        username={user.username}
        displayName={user.name}
        avatar={user.avatar}
        size={40}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-semibold text-sm truncate">
            {user.name || user.username || "Unknown"}
          </p>
          <span className="text-[10px] text-default-400 tabular-nums shrink-0">
            {formatRelative(last.createdAt || chat.lastMessageAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {isOutgoing && (
            <span
              className="text-[11px] font-semibold shrink-0"
              style={{ color: "var(--theme-accent, #f54900)" }}
              title="You sent the last message"
            >
              →
            </span>
          )}
          <p
            className={cn(
              "text-xs truncate flex-1 leading-tight",
              unread > 0 && !isOutgoing
                ? "text-foreground font-medium"
                : "text-default-400"
            )}
          >
            {preview}
          </p>
          {unread > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="inline-flex items-center justify-center text-[10px] font-bold text-white px-1.5 h-4 min-w-[16px] rounded-full"
              style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
            >
              {unread > 99 ? "99+" : unread}
            </motion.span>
          )}
        </div>
        {user.username && user.name && user.name !== user.username && (
          <p className="text-[10px] text-default-500 truncate mt-0.5">
            @{user.username}
          </p>
        )}
      </div>
    </motion.button>
  );
}
