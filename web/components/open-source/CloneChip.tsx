"use client";

import { useState } from "react";

import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { CopyIcon, CheckIcon } from "@/components/icons";

/**
 * The hero's `git clone` chip: the repository's front door.
 *
 * A light orbits the border continuously and a status dot pulses, so the block
 * reads as a live endpoint you can connect to rather than a static code
 * sample. Both animations are CSS (see `.repo-orbit-beam` / `.repo-live-dot`
 * in globals.css) and are stopped by the global prefers-reduced-motion rule.
 *
 * Structure matters here:
 *   - The outer element is a 1px rim. The rotating gradient fills it, and the
 *     inner panel's opaque background masks the centre, leaving only the rim
 *     lit. That is why the beam layer and the content are siblings.
 *   - `overflow-hidden` is on the beam layer ONLY, never the panel:
 *     CornerBrackets are positioned 1px OUTSIDE their parent and would be
 *     clipped away by an overflow on the panel itself.
 *
 * Client component because of the copy state; everything else in the hero
 * stays a Server Component.
 */
export function CloneChip({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (insecure context / denied permission) — the text is
         still selectable, so this degrades to a manual copy rather than an
         error the visitor can do nothing about. */
    }
  };

  return (
    <div className="relative p-px max-w-xl">
      {/* Orbiting light. 300% square so the rotation still sweeps the corners
          of a wide, short box. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden pointer-events-none"
      >
        <span className="repo-orbit-beam absolute left-1/2 top-1/2 aspect-square w-[300%] -translate-x-1/2 -translate-y-1/2" />
      </span>

      <div className="relative flex items-center gap-3 bg-[#0a0807] border border-dashed border-white/15 pl-4 pr-2 py-3.5 text-xs sm:text-sm font-mono text-foreground">
        <CornerBrackets size={7} />

        {/* Live status. aria-hidden on the dot, with the meaning carried by
            real text for assistive tech. */}
        <span className="flex items-center gap-2 shrink-0">
          <span
            aria-hidden="true"
            className="repo-live-dot h-1.5 w-1.5 rounded-full bg-[#f54900]"
          />
          <span className="text-default-500">CLONE</span>
        </span>

        {/* Scrolling lives on this span, not the panel: CornerBrackets sit at
            -1px, so an overflow on the panel both clips them and (because
            overflow-x:auto forces overflow-y:auto) raises a spurious vertical
            scrollbar off that 1px. */}
        <span className="select-all whitespace-nowrap min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {command}
        </span>

        <button
          aria-label={copied ? "Copied" : "Copy clone command"}
          className="shrink-0 p-2 text-default-500 hover:text-[#f54900] transition-colors"
          type="button"
          onClick={copy}
        >
          {copied ? (
            <CheckIcon className="w-4 h-4 text-[#f54900]" />
          ) : (
            <CopyIcon size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
