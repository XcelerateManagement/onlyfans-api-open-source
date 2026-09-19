"use client";

import { useState } from "react";

import { CopyIcon, CheckIcon, DownloadIcon } from "@/components/icons";

/**
 * The interactive "AI Agent Setup" panel.
 *
 * A terminal-style window with a tab per AI client. Switching tabs swaps the
 * setup prompt and the download target with no navigation. Copy flips to
 * "Copied" for two seconds.
 *
 * Client component because of the tab and copy state; the page around it stays
 * a Server Component.
 *
 * Brand marks are CC0 Simple Icons served from /logos and rendered through a
 * CSS mask so they inherit currentColor — the raw files have no fill and would
 * be invisible on this background as a plain <img>.
 */

export type AgentTab = {
  id: string;
  label: string;
  /** Path under /logos, or null for the generic "Any AI" tab. */
  mark: string | null;
  /** The vendor's own brand colour, used for the mark only. Marks are masked
   *  to this rather than to the site accent so the row reads as a row of real
   *  products; the surrounding chrome stays orange. */
  color: string;
  /** Filename the download produces, e.g. CLAUDE.md */
  file: string;
  prompt: string;
};

function Mark({ src, className = "" }: { src: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        backgroundColor: "currentColor",
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

/** Generic glyph for the "Any AI" tab — no brand, so no mark. */
function AnyAiGlyph({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

export function AgentSetup({ tabs }: { tabs: AgentTab[] }) {
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [copied, setCopied] = useState(false);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked (insecure context / denied permission). The prompt is
         selectable in the panel, so this degrades to a manual copy rather than
         an error the visitor can do nothing about. */
    }
  };

  return (
    <div className="relative">
      {/* Two blooms behind the glass, warm and layered: an amber one low-left
          and a deeper orange low-right. A single centred glow reads flat once
          the surface is this transparent — offsetting them is what gives the
          panel a direction of light. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -bottom-14 top-6 blur-3xl opacity-80 [background:radial-gradient(ellipse_at_25%_100%,rgba(255,167,38,0.4),transparent_60%),radial-gradient(ellipse_at_80%_90%,rgba(245,73,0,0.45),transparent_62%)]"
      />

      {/* The glass itself. `p-px` + the gradient makes a hairline edge that is
          bright at the top-left and fades out — a lit rim rather than a flat
          1px border, which is what sells the material. */}
      <div className="relative p-px bg-gradient-to-br from-white/[0.18] via-[#f54900]/25 to-transparent shadow-[0_28px_90px_-24px_rgba(0,0,0,0.95)]">
        <div className="relative bg-gradient-to-b from-[#1a1108]/80 via-[#0c0a09]/85 to-[#0c0a09]/75 backdrop-blur-2xl">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] bg-white/[0.02] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="flex-1 text-center text-xs font-medium text-default-400 pr-12">
          AI Agent Setup
        </span>
      </div>

      <div className="p-4 sm:p-5">
        {/* Tabs */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5"
          role="tablist"
          aria-label="AI client"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === activeId;

            return (
              <button
                key={tab.id}
                aria-selected={isActive}
                className={[
                  "flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium border transition-colors",
                  isActive
                    ? "border-[#f54900] text-[#f54900] bg-[#f54900]/10"
                    : "border-white/[0.08] bg-white/[0.02] text-default-400 hover:text-foreground hover:border-white/20",
                ].join(" ")}
                role="tab"
                type="button"
                onClick={() => {
                  setActiveId(tab.id);
                  setCopied(false);
                }}
              >
                {/* inline-flex, not a bare span: a plain <span> is inline, so
                    the mask's w-4/h-4 would be ignored and the logo would
                    collapse to nothing. */}
                <span
                  className="inline-flex shrink-0"
                  style={{ color: tab.color }}
                >
                  {tab.mark ? (
                    <Mark className="block w-4 h-4" src={tab.mark} />
                  ) : (
                    <AnyAiGlyph className="block w-4 h-4" />
                  )}
                </span>
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Prompt header */}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Setup prompt for {active.label}
            </p>
            <p className="text-xs text-default-500 mt-0.5">
              Paste this into {active.label} to connect it to The Only API.
            </p>
          </div>
          <button
            className="shrink-0 inline-flex items-center gap-2 border border-[#f54900]/50 text-[#f54900] px-3 py-1.5 text-xs font-bold uppercase tracking-wider hover:bg-[#f54900]/10 transition-colors"
            type="button"
            onClick={copy}
          >
            {copied ? (
              <>
                <CheckIcon className="w-3.5 h-3.5" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                Copy to agent
              </>
            )}
          </button>
        </div>

        {/* Prompt body */}
        <pre className="overflow-auto max-h-64 border border-white/[0.08] bg-black/40 p-4 text-[11px] sm:text-xs leading-relaxed text-default-300 whitespace-pre-wrap">
          <code>{active.prompt}</code>
        </pre>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <a
            className="flex-1 inline-flex items-center justify-center gap-2 bg-[#f54900] text-white font-bold uppercase tracking-wider text-xs px-4 py-3 hover:bg-[#d63e00] transition-colors"
            download={active.file}
            href={`/agent/${active.file}`}
          >
            <DownloadIcon className="w-3.5 h-3.5" />
            Download {active.file}
          </a>
          <button
            className="flex-1 inline-flex items-center justify-center gap-2 border border-white/[0.12] text-white/90 font-bold uppercase tracking-wider text-xs px-4 py-3 hover:bg-white/[0.06] transition-colors"
            type="button"
            onClick={copy}
          >
            {copied ? (
              <>
                <CheckIcon className="w-3.5 h-3.5 text-[#f54900]" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon size={14} />
                Copy to clipboard
              </>
            )}
          </button>
        </div>
      </div>
        </div>
      </div>
    </div>
  );
}
