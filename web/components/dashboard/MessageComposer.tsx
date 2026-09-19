"use client";

import { useEffect, useMemo, useRef, useState, KeyboardEvent, ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import {
  PxSend,
  PxSmile,
  PxPaperclip,
  PxDollarSign,
  PxPlus,
} from "@/components/ui/PixelIcons";
import { stripHtml } from "@/lib/chat-utils";
import {
  accountSupports,
  platformLabel,
  type PlatformFeature,
} from "@/lib/platform-capabilities";
import type { Platform } from "@/lib/hooks/use-selected-account";

const EMOJIS = [
  "😊","😂","🥰","😍","😘","🤔","😏","😈","🔥","💦",
  "💋","💕","❤️","💎","💰","🎁","👀","🍑","🍆","💯",
  "🙈","😉","😋","😇","🤤","🫦","👉","👈","👆","👇",
];

const PRICE_MIN = 1;
const PRICE_MAX = 200;

export interface ReplyTarget {
  id: string | number | null;
  username?: string;
  text?: string;
}

export interface SendPayload {
  text: string;
  price: number;
  attachmentNames: string[];
  replyTo: ReplyTarget | null;
}

interface Props {
  draft: string;
  onDraftChange: (value: string) => void;
  replyTo: ReplyTarget | null;
  onClearReply: () => void;
  onSend: (payload: SendPayload) => Promise<void> | void;
  disabled?: boolean;
  /** The selected account — gates Attach (send_attachments capability) and
   * the PPV toggle (unverified on Fansly). Undefined → safe defaults apply. */
  account?: {
    platform?: Platform;
    capabilities?: Partial<Record<PlatformFeature, boolean>>;
  } | null;
}

export function MessageComposer({
  draft,
  onDraftChange,
  replyTo,
  onClearReply,
  onSend,
  disabled,
  account,
}: Props) {
  const [isPpv, setIsPpv] = useState(false);
  const [price, setPrice] = useState<number>(10);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // No upload pipeline exists yet on either platform — a "successful" send
  // would deliver text-only while the UI shows attachment chips (worst case:
  // a fan pays to unlock a PPV containing no media). Capability-gated so it
  // flips on per-platform the moment a real upload path ships.
  const allowAttachments = accountSupports(account, "send_attachments");
  // The fansly PPV send path (dollars → cents) is wired backend-side but
  // stays unverified against the live API by policy — hide the toggle until
  // a send is live-verified.
  const ppvBlocked = account?.platform === "fansly";
  const attachTooltip = `Attachments can't be sent on ${platformLabel(
    account?.platform
  )} yet — media uploads aren't wired, so files would be silently dropped`;

  // Safety: if the gate flips while state is set (e.g. account switch),
  // clear anything the new platform can't send.
  useEffect(() => {
    if (ppvBlocked) setIsPpv(false);
  }, [ppvBlocked]);
  useEffect(() => {
    if (!allowAttachments) setAttachments([]);
  }, [allowAttachments]);

  const canSend = useMemo(() => {
    if (sending || disabled) return false;
    if (isPpv && (price < PRICE_MIN || price > PRICE_MAX)) return false;
    return draft.trim().length > 0 || attachments.length > 0 || isPpv;
  }, [draft, attachments, isPpv, price, sending, disabled]);

  // Auto-grow the textarea up to 5 rows
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const lineHeight = 20;
    const max = lineHeight * 5 + 16; // padding
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, [draft]);

  async function doSend() {
    if (!canSend) return;
    if (attachments.length > 0 && !allowAttachments) {
      // Belt-and-braces: the picker is disabled when unsupported, but never
      // let a send go out that would silently drop its media.
      toast.error(
        `Attachments aren't supported on ${platformLabel(account?.platform)} yet — remove them to send this message.`
      );
      return;
    }
    setSending(true);
    try {
      await onSend({
        text: draft.trim(),
        price: isPpv ? price : 0,
        attachmentNames: attachments.map((f) => f.name),
        replyTo,
      });
      onDraftChange("");
      setAttachments([]);
      setIsPpv(false);
      setEmojiOpen(false);
      onClearReply();
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    } else if (e.key === "Escape") {
      if (replyTo) {
        onClearReply();
      } else if (emojiOpen) {
        setEmojiOpen(false);
      } else if (isPpv) {
        setIsPpv(false);
      } else if (draft) {
        onDraftChange("");
      }
    }
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current;
    if (!el) {
      onDraftChange(draft + emoji);
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + emoji + draft.slice(end);
    onDraftChange(next);
    // Re-focus and place caret after the inserted emoji
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...files].slice(0, 10));
    }
    // Reset so the same file can be picked again after remove
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="border-t border-white/[0.06] bg-[#0d0d0d]">
      {/* Reply-to preview */}
      <AnimatePresence initial={false}>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/[0.06]"
          >
            <div className="flex items-start gap-2 px-4 py-2 text-xs">
              <span
                className="text-[10px] uppercase tracking-wider font-semibold"
                style={{ color: "var(--theme-accent, #f54900)" }}
              >
                ↩ Reply
              </span>
              <span className="flex-1 truncate">
                {replyTo.username && (
                  <span className="text-default-400">@{replyTo.username}: </span>
                )}
                <span className="text-default-200">{stripHtml(replyTo.text) || "…"}</span>
              </span>
              <button
                onClick={onClearReply}
                className="text-default-500 hover:text-foreground text-[14px] leading-none"
                aria-label="Cancel reply"
              >
                ×
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment chips */}
      <AnimatePresence initial={false}>
        {attachments.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/[0.06]"
          >
            <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
              {attachments.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 text-[11px] px-2 py-1 bg-white/[0.04] border border-white/[0.08]"
                >
                  <PxPaperclip className="h-3 w-3 text-default-400" />
                  <span className="max-w-[160px] truncate">{f.name}</span>
                  <button
                    onClick={() => removeAttachment(i)}
                    className="text-default-500 hover:text-foreground ml-0.5"
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emoji grid */}
      <AnimatePresence initial={false}>
        {emojiOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-white/[0.06]"
          >
            <div className="grid grid-cols-10 gap-1 px-3 py-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => insertEmoji(e)}
                  className="h-8 w-8 flex items-center justify-center text-lg hover:bg-white/[0.06] transition-colors"
                  aria-label={`Insert emoji ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main row */}
      <div className="flex items-end gap-2 px-3 py-2">
        {/* Left action buttons */}
        <div className="flex gap-1 mb-1">
          <ComposeButton
            label="Emoji"
            active={emojiOpen}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <PxSmile className="h-4 w-4" />
          </ComposeButton>
          <ComposeButton
            label="Attach"
            onClick={() => fileRef.current?.click()}
            disabled={!allowAttachments}
            title={allowAttachments ? undefined : attachTooltip}
          >
            <PxPaperclip className="h-4 w-4" />
          </ComposeButton>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPickFiles}
            accept="image/*,video/*"
          />
          <ComposeButton
            label="PPV"
            active={isPpv}
            onClick={() => setIsPpv((v) => !v)}
            disabled={ppvBlocked}
            title={ppvBlocked ? "PPV coming soon for Fansly" : undefined}
          >
            <PxDollarSign className="h-4 w-4" />
          </ComposeButton>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={isPpv ? "Write the caption for the PPV…" : "Type a message…"}
          rows={1}
          disabled={disabled || sending}
          className={cn(
            "flex-1 min-w-0 resize-none bg-black/20 border border-white/[0.08] px-3 py-2",
            "text-sm leading-5 outline-none transition-colors",
            "focus:border-[color:var(--theme-accent,#f54900)]",
            "disabled:opacity-50"
          )}
        />

        {/* PPV price */}
        <AnimatePresence initial={false}>
          {isPpv && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: "auto", opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1 border border-white/[0.08] px-2 py-1.5 mb-1">
                <span className="text-default-400 text-xs">$</span>
                <input
                  type="number"
                  min={PRICE_MIN}
                  max={PRICE_MAX}
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value) || 0)}
                  className="w-14 bg-transparent text-sm tabular-nums outline-none font-bold"
                  style={{ color: "var(--theme-accent, #f54900)" }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Send button */}
        <button
          onClick={doSend}
          disabled={!canSend}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-2 mb-1 text-white text-xs font-bold uppercase tracking-wider",
            "transition-opacity",
            !canSend && "opacity-40 cursor-not-allowed"
          )}
          style={{ backgroundColor: "var(--theme-accent, #f54900)" }}
          title={
            isPpv && (price < PRICE_MIN || price > PRICE_MAX)
              ? `Price must be ${PRICE_MIN}-${PRICE_MAX}`
              : undefined
          }
        >
          <PxSend className="h-3.5 w-3.5" />
          {isPpv ? `Send PPV · $${price}` : "Send"}
        </button>
      </div>
    </div>
  );
}

function ComposeButton({
  label,
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Overrides the default `label` tooltip — used for "why is this disabled" copy. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      aria-label={label}
      aria-disabled={disabled || undefined}
      title={title ?? label}
      className={cn(
        "h-8 w-8 flex items-center justify-center transition-colors",
        active
          ? "text-white"
          : "text-default-400 hover:text-foreground hover:bg-white/[0.04]",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-default-400"
      )}
      style={active ? { backgroundColor: "var(--theme-accent, #f54900)" } : undefined}
    >
      {children}
    </button>
  );
}
