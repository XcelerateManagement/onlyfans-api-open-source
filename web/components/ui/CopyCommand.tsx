"use client";

import { useState } from "react";
import { CopyIcon, CheckIcon } from "@/components/icons";

/**
 * Radius-0 command block matching the `#0c0a09` code rhythm used across the
 * marketing pages, with a small copy affordance in the top-right corner.
 * Deliberately not `CodeBlock.tsx` — that component is from an older design
 * era (rounded corners, Prism, light borders) and breaks the rhythm.
 */
export function CopyCommand({
  command,
  label,
}: {
  command: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (insecure context / denied permission) — no-op */
    }
  };

  return (
    <div className="relative">
      {label ? (
        <p className="text-[10px] uppercase tracking-widest text-default-500 mb-2">
          {label}
        </p>
      ) : null}
      <pre className="overflow-x-auto border border-white/[0.08] bg-[#0c0a09] p-5 pr-14 text-xs sm:text-sm text-default-300 leading-relaxed">
        <code>{command}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        className="absolute right-2 top-2 p-2 text-default-500 hover:text-[#f54900] transition-colors"
        style={{ top: label ? "1.75rem" : "0.5rem" }}
      >
        {copied ? (
          <CheckIcon className="w-4 h-4 text-[#f54900]" />
        ) : (
          <CopyIcon size={16} />
        )}
      </button>
    </div>
  );
}
