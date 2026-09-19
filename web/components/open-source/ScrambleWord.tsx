"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Matrix-style scramble for the rotating tail of the hero headline.
 *
 * Each character decodes independently: it holds the outgoing glyph, then
 * cycles random glyphs for a randomised window, then settles on its final
 * letter. Characters have staggered start/end frames, so the word resolves
 * left-to-right in a ragged wave rather than all at once — that raggedness is
 * what reads as "decoding" instead of "flickering".
 *
 * Decisions that matter:
 *
 *  - SSR renders the canonical word as plain text. Random glyphs are generated
 *    only after mount, so there is no hydration mismatch.
 *  - The canonical word also lives in a visually-hidden span for crawlers and
 *    screen readers; the animated layer is aria-hidden. An H1 that reads
 *    "ⱯϾM·" to a screen reader would be a real regression.
 *  - Width is reserved by rendering the longest word invisibly, so the rest of
 *    the headline never reflows mid-scramble.
 *  - prefers-reduced-motion pins it to the first word with no animation and no
 *    timers.
 */

import { randomGlyph } from "@/components/open-source/glyphs";

type Cell = { from: string; to: string; start: number; end: number };

export function ScrambleWord({
  words,
  holdMs = 2600,
}: {
  words: string[];
  holdMs?: number;
}) {
  const [index, setIndex] = useState(0);
  const [display, setDisplay] = useState<{ char: string; settled: boolean }[]>(
    () => words[0].split("").map((char) => ({ char, settled: true })),
  );

  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRef = useRef(words[0]);

  useEffect(() => {
    if (words.length < 2) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let cancelled = false;

    const scrambleTo = (next: string) => {
      const from = currentRef.current;
      const length = Math.max(from.length, next.length);
      const cells: Cell[] = [];

      for (let i = 0; i < length; i++) {
        // Staggered windows: later characters start later and run longer, so
        // the word resolves in a wave.
        const start = Math.floor(Math.random() * 12) + i * 1.6;
        const end = start + Math.floor(Math.random() * 14) + 8;

        cells.push({
          from: from[i] ?? "",
          to: next[i] ?? "",
          start,
          end,
        });
      }

      let frame = 0;

      const tick = () => {
        if (cancelled) return;
        let settledCount = 0;
        const out = cells.map((cell) => {
          if (frame >= cell.end) {
            settledCount++;

            return { char: cell.to, settled: true };
          }
          if (frame >= cell.start) {
            // Re-roll only some frames so glyphs are legible rather than a blur.
            return { char: randomGlyph(), settled: false };
          }

          return { char: cell.from, settled: true };
        });

        setDisplay(out.filter((c) => c.char !== ""));

        if (settledCount === cells.length) {
          currentRef.current = next;
          frameRef.current = null;

          return;
        }
        frame++;
        frameRef.current = requestAnimationFrame(tick);
      };

      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(tick);
    };

    const advance = () => {
      setIndex((i) => {
        const next = (i + 1) % words.length;

        scrambleTo(words[next]);

        return next;
      });
      timerRef.current = setTimeout(advance, holdMs);
    };

    timerRef.current = setTimeout(advance, holdMs);

    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [words, holdMs]);

  const widest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span className="relative inline-block align-bottom text-[#f54900]">
      {/* Canonical text for assistive tech and crawlers. */}
      <span className="sr-only">{words[0]}</span>

      {/* Reserves the widest word's width so the headline never reflows. */}
      <span aria-hidden="true" className="invisible whitespace-nowrap">
        {widest}
      </span>

      <span
        aria-hidden="true"
        className="absolute inset-0 whitespace-nowrap tabular-nums"
      >
        {display.map((cell, i) => (
          <span
            key={i}
            className={
              cell.settled
                ? ""
                : // Mid-decode glyphs sit brighter and slightly transparent —
                  // the "hot" leading edge of a Matrix column.
                  "text-[#ff7a3d] opacity-80 [text-shadow:0_0_12px_rgba(245,73,0,0.85)]"
            }
          >
            {cell.char}
          </span>
        ))}
      </span>
    </span>
  );
}
