"use client";

import { useState, KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Chip } from "@heroui/chip";
import toast from "react-hot-toast";

import { useApiClient } from "@/lib/hooks/use-api-client";
import { PxPlus } from "@/components/ui/PixelIcons";

/**
 * Inline optimistic tag chips for a campaign. Parallel to FanTagEditor — the
 * add/remove call signatures differ (campaignId vs fanOfUserId+ofUserId), so
 * this is a sibling component rather than a generalization.
 */
export function CampaignTagEditor({
  ofUserId,
  campaignId,
  tags,
  onChange,
  compact = false,
}: {
  ofUserId: string;
  campaignId: string;
  tags: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}) {
  const api = useApiClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function addTag() {
    const tag = draft.trim();
    if (!tag || !api) {
      setAdding(false);
      return;
    }
    if (tags.includes(tag)) {
      setDraft("");
      setAdding(false);
      return;
    }
    const next = [...tags, tag];
    onChange(next); // optimistic
    setBusy(true);
    try {
      await api.addCampaignTag(ofUserId, campaignId, tag);
    } catch (err: any) {
      onChange(tags); // revert
      toast.error(err?.message || "Failed to add tag");
    } finally {
      setBusy(false);
      setDraft("");
      setAdding(false);
    }
  }

  async function removeTag(tag: string) {
    if (!api) return;
    const next = tags.filter((t) => t !== tag);
    onChange(next); // optimistic
    try {
      await api.removeCampaignTag(ofUserId, campaignId, tag);
    } catch (err: any) {
      onChange(tags); // revert
      toast.error(err?.message || "Failed to remove tag");
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Escape") {
      setAdding(false);
      setDraft("");
    }
  }

  return (
    <div
      className="flex items-center gap-1 flex-wrap"
      onClick={(e) => e.stopPropagation()}
    >
      <AnimatePresence initial={false}>
        {tags.map((t) => (
          <motion.span
            key={t}
            layout
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7, width: 0, marginRight: 0 }}
            transition={{ duration: 0.15 }}
          >
            <Chip
              size="sm"
              variant="flat"
              onClose={() => removeTag(t)}
              className="rounded-none"
            >
              {t}
            </Chip>
          </motion.span>
        ))}
      </AnimatePresence>
      {adding ? (
        <motion.input
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 80, opacity: 1 }}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={addTag}
          disabled={busy}
          placeholder="tag…"
          className="bg-transparent border border-white/[0.15] px-2 py-0.5 text-xs outline-none focus:border-[color:var(--theme-accent,#f54900)]"
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 text-xs text-default-400 hover:text-foreground px-1.5 py-0.5 border border-white/[0.08] hover:border-white/[0.2]"
          title="Add tag"
        >
          <PxPlus className="h-3 w-3" />
          {!compact && <span>tag</span>}
        </button>
      )}
    </div>
  );
}
