"use client";

import { useEffect, useRef, useState } from "react";

import { randomGlyph } from "@/components/open-source/glyphs";

/**
 * One-shot matrix decode, for a line of text that resolves once and stays.
 *
 * Sibling to ScrambleWord rather than a mode of it: ScrambleWord exists to
 * loop — it owns a hold timer, a word list and a rotating index. Bolting a
 * one-shot path into that rAF loop would give one component two lifecycles.
 * They share the alphabet (./glyphs) and nothing else.
 *
 * Contracts kept from ScrambleWord, for the same reasons:
 *  - SSR renders the plain text; glyphs are generated only after mount, so
 *    there is no hydration mismatch.
 *  - prefers-reduced-motion returns plain text with no timers at all. The
 *    global CSS reduced-motion rule cannot stop a rAF loop, so this check is
 *    the only thing standing between a motion-sensitive user and 40 frames of
 *    cycling katakana.
 *
 * `maxChars` is a hard cap, not a suggestion: past roughly 48 characters a
 * decode stops reading as "resolving" and starts reading as noise, and it costs
 * a DOM write per character per frame. Titles only — never body copy.
 */
export function DecodeText({
  text,
  className = "",
  enabled = true,
  maxChars = 48,
}: {
  text: string;
  className?: string;
  /** false → render plain text immediately (reduced motion, instant step jumps). */
  enabled?: boolean;
  maxChars?: number;
}) {
  const [cells, setCells] = useState<{ char: string; settled: boolean }[]>(() =>
    text.split("").map((char) => ({ char, settled: true })),
  );
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || text.length > maxChars) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let cancelled = false;

    // Staggered windows so the line resolves left-to-right in a ragged wave.
    // The raggedness is the point — a uniform window reads as a flicker.
    const windows = text.split("").map((_, i) => {
      const start = i * 1.1;

      return { start, end: start + 6 + Math.floor(Math.random() * 8) };
    });

    let frame = 0;

    const tick = () => {
      if (cancelled) return;
      let settledCount = 0;

      const out = text.split("").map((char, i) => {
        const w = windows[i];

        // Whitespace never scrambles: cycling glyphs through the gaps between
        // words destroys the shape of the line and makes it unreadable.
        if (frame >= w.end || char === " ") {
          settledCount++;

          return { char, settled: true };
        }
        if (frame >= w.start) return { char: randomGlyph(), settled: false };

        return { char: "", settled: false };
      });

      setCells(out);

      if (settledCount === text.length) {
        frameRef.current = null;

        return;
      }
      frame++;
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [text, enabled, maxChars]);

  return (
    <span className={className}>
      {/* Canonical text for assistive tech and crawlers, always complete. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {cells.map((cell, i) => (
          <span
            key={i}
            className={
              cell.settled
                ? ""
                : // The hot leading edge of a Matrix column.
                  "text-[#ff7a3d] [text-shadow:0_0_12px_rgba(245,73,0,0.85)]"
            }
          >
            {cell.char}
          </span>
        ))}
      </span>
    </span>
  );
}
