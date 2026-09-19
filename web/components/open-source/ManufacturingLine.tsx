"use client";

import type { ReactNode } from "react";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";

import { CornerBrackets } from "@/components/ui/CornerBrackets";
import {
  AuditGutterGlyph,
  DiskRetentionGlyph,
  ForkMergeGlyph,
  FlatRateGlyph,
} from "@/components/open-source/icons";
import { DecodeText } from "@/components/open-source/DecodeText";

/**
 * The manufacturing line: a scroll-pinned stage showing ONE plate at a time.
 * Each scroll step slides the current plate out to the left and the next in
 * from the right, like parts moving along a conveyor.
 *
 * ── Why the geometry is not in this file ──────────────────────────────────
 * The pin lives entirely in `.line-track` / `.line-stage` in globals.css,
 * behind one media query. That gives no hydration flash, no CLS, and the touch
 * / short-viewport / reduced-motion fallbacks for free. This component only
 * reads scroll progress and decides which plate shows; it never measures or
 * sets a height.
 *
 * ── One at a time, not a grid ─────────────────────────────────────────────
 * An earlier version accumulated four plates into a 2x2 grid. Swapping reads
 * better: one plate can carry display-scale type instead of being a
 * quarter-sized card, so each claim lands on its own. The cost is that the
 * whole argument is never on screen at once — which is why the sr-only list
 * below is not merely an accessibility nicety. It is the only place all four
 * claims exist together, for crawlers and assistive tech alike.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 * One passive scroll listener, one continuously scroll-linked value (the rail
 * fill, written straight to style), and at most four React re-renders across
 * the whole track. If a change breaks that, the change is wrong.
 */

const PLATE_GLYPHS = {
  audit: AuditGutterGlyph,
  disk: DiskRetentionGlyph,
  fork: ForkMergeGlyph,
  rate: FlatRateGlyph,
} as const;

export type PlateGlyph = keyof typeof PLATE_GLYPHS;

export type LineBlock = {
  icon: PlateGlyph;
  /** ≤ 48 chars — past that the decode reads as noise, not as resolving. */
  title: string;
  lead: string;
  proof: string;
};

const HOUSE_EASE = [0.25, 0.4, 0.25, 1] as const;

/** One plate. `standalone` renders it as a plain card for the unpinned and
 *  reduced-motion paths, where there is no swap to animate. */
function Plate({
  block,
  index,
  total,
  animate,
}: {
  block: LineBlock;
  index: number;
  total: number;
  animate: boolean;
}) {
  const { icon, title, lead, proof } = block;
  const Icon = PLATE_GLYPHS[icon];

  return (
    <div className="relative h-full border border-[#f54900]/40 bg-[#100b08]/60 p-6 sm:p-8 lg:p-10">
      <CornerBrackets opacity={0.5} size={8} />

      <span className="absolute top-5 right-6 [font-family:var(--font-mono)] text-[11px] tabular-nums text-[#f54900]/50">
        {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>

      <motion.span
        animate={animate ? { x: 0, opacity: 1 } : undefined}
        className={`${animate ? "glyph-draw" : ""} grid place-items-center w-12 h-12 rounded-lg border border-[#f54900]/45 bg-[#f54900]/[0.08] text-[#f54900] mb-6`}
        initial={animate ? { x: -28, opacity: 0 } : false}
        transition={{ duration: 0.45, delay: 0.1, ease: HOUSE_EASE }}
      >
        <Icon className="w-5 h-5" />
      </motion.span>

      {/* One plate at a time means there is room for display type. This is the
          size the claim deserves; a quarter-grid card could never carry it. */}
      <motion.h3
        animate={animate ? { x: 0, opacity: 1 } : undefined}
        className="font-bold tracking-[-0.025em] leading-[1.03] text-[clamp(1.75rem,3.4vw,3rem)] text-foreground mb-4"
        initial={animate ? { x: -36, opacity: 0 } : false}
        transition={{ duration: 0.45, delay: 0.18, ease: HOUSE_EASE }}
      >
        <DecodeText enabled={animate} text={title} />
      </motion.h3>

      <motion.div
        animate={animate ? { x: 0, opacity: 1 } : undefined}
        initial={animate ? { x: -20, opacity: 0 } : false}
        transition={{ duration: 0.5, delay: 0.28, ease: HOUSE_EASE }}
      >
        {/* The lead decodes as well as the title — the matrix runs through
            each plate, not just its headline. maxChars is raised for this line
            only; the proof paragraph below stays plain, because scrambling a
            full paragraph is noise rather than effect and costs a DOM write
            per character per frame. */}
        <p className="text-[17px] sm:text-[19px] leading-[1.45] text-default-200 mb-3 max-w-[44ch]">
          <DecodeText enabled={animate} maxChars={140} text={lead} />
        </p>
        <p className="text-[14px] sm:text-[15px] leading-[1.6] text-default-400 max-w-[58ch]">
          {proof}
        </p>
      </motion.div>
    </div>
  );
}

/**
 * Is the stage actually pinned right now?
 *
 * Reads the COMPUTED position rather than re-declaring the media query in JS.
 * The query is long (width, height, hover, pointer, reduced-motion) and
 * duplicating it here would be two sources of truth that drift the first time
 * one is edited. Asking the browser what it applied cannot drift.
 */
function usePinnedStage(ref: React.RefObject<HTMLDivElement | null>) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const read = () => {
      const el = ref.current;

      if (el) setPinned(getComputedStyle(el).position === "sticky");
    };

    read();
    window.addEventListener("resize", read, { passive: true });

    return () => window.removeEventListener("resize", read);
  }, [ref]);

  return pinned;
}

export function ManufacturingLine({
  eyebrow,
  heading,
  deck,
  blocks,
}: {
  eyebrow: string;
  heading: ReactNode;
  deck: ReactNode;
  blocks: readonly LineBlock[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLDivElement>(null);

  // useReducedMotion() returns false on the server and true on a reduced-motion
  // client, so branching the render on it directly produces a hydration
  // mismatch. Gate it behind a mount flag so the first client render matches
  // the server exactly, then settle. Costs one render; buys clean hydration.
  const prefersReduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  const reduce = mounted && prefersReduced;

  // `["start start", "end end"]` is the only offset pair where the progress
  // range and the PINNED range are identical — 0 on the frame the stage pins,
  // 1 on the frame it releases. No dead zone, no compensating arithmetic.
  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ["start start", "end end"],
  });

  // Deliberately NOT useSpring: a spring overshoots around a step boundary and
  // re-fires the swap even with hysteresis, and it runs a rAF loop that never
  // idles. Same reasoning as GlassNavbar's "single transform, no spring".
  const railFill = useTransform(scrollYProgress, [0, 0.875], [0, 1]);

  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [instant, setInstant] = useState(false);
  const stepRef = useRef(0);
  const firstRef = useRef(true);

  const last = blocks.length - 1;
  const STEP = 1 / blocks.length;
  const HYST = 0.02; // ≈7vh — about 20x the sub-pixel scroll jitter.

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (reduce) return;

    const raw = Math.min(last, Math.max(0, Math.floor(p / STEP)));
    const cur = stepRef.current;

    // Deadband: require progress to travel past a boundary before committing,
    // clamped to ±1 so a genuine fling still resolves in one event.
    let target = raw;

    if (raw > cur && p < raw * STEP + HYST) target = raw - 1;
    if (raw < cur && p > (raw + 1) * STEP - HYST) target = raw + 1;
    target = Math.min(last, Math.max(0, target));

    if (target === cur) return;

    // More than one step at once means a smooth-scroll traverse, a deep link or
    // scroll restoration — land on it rather than playing every swap in 700ms.
    // NOT optional: globals.css sets `scroll-behavior: smooth` and the hero CTA
    // targets an anchor below this section.
    const jumped = firstRef.current || Math.abs(target - cur) > 1;

    firstRef.current = false;
    setDir(target > cur ? 1 : -1);
    stepRef.current = target;
    setInstant(jumped);
    setStep(target);
  });

  const pinned = usePinnedStage(staticRef);
  const staticInView = useInView(staticRef, { once: true, margin: "-80px" });
  const swapping = pinned && !reduce;

  return (
    <section
      aria-labelledby="oss-line-heading"
      className="border-t border-white/[0.06]"
    >
      <div
        ref={trackRef}
        className="line-track"
        style={{ ["--line-steps" as string]: blocks.length }}
      >
        {/* Snap markers — one per step, at each viewport boundary, so a single
            scroll gesture lands on exactly one plate rather than sailing
            through several. Zero-size and absolutely positioned, so they add
            snap points without changing the track's height. */}
        {blocks.map((b, i) => (
          <span
            key={`snap-${b.title}`}
            aria-hidden="true"
            className="line-snap"
            style={{ top: `${i * 100}vh` }}
          />
        ))}
        <div ref={staticRef} className="line-stage py-16 lg:py-0">
          <div className="container-section w-full">
            <div className="lg:grid lg:grid-cols-[92px_minmax(0,1fr)] lg:gap-8">
              {/* Progress rail — a descendant of the changelog timeline, so a
                  returning visitor reads it as the same system. */}
              <div aria-hidden="true" className="relative hidden lg:block">
                <span className="absolute left-[7px] top-1 bottom-1 border-l border-dashed border-[#f54900]/20" />
                <motion.span
                  className="absolute left-[7px] top-1 w-px bg-[#f54900] origin-top"
                  style={{ height: "calc(100% - 0.5rem)", scaleY: railFill }}
                />
                {blocks.map((b, i) => (
                  <div
                    key={b.title}
                    className="absolute flex items-center gap-3"
                    style={{ top: `${(i / last) * 92}%` }}
                  >
                    <span
                      className={`w-[7px] h-[7px] rounded-full transition-colors duration-300 ${
                        i < step
                          ? "bg-[#f54900]"
                          : i === step
                            ? "timeline-dot"
                            : "bg-[#f54900]/25"
                      }`}
                    />
                    <span
                      className={`[font-family:var(--font-mono)] text-[11px] tabular-nums transition-colors duration-300 ${
                        i <= step ? "text-[#f54900]" : "text-white/25"
                      }`}
                    >
                      {String(i + 1).padStart(2, "0")}.
                    </span>
                  </div>
                ))}
              </div>

              {/* NOT aria-hidden. It used to be, which broke two things at
                  once: the <h2> this section names itself by
                  (aria-labelledby="oss-line-heading") was itself removed from
                  the accessibility tree, and the sr-only <h3> list below had no
                  <h2> above it in the outline. aria-hidden now sits on the plate
                  containers only — the plates are the part the sr-only list
                  duplicates, and the heading block is not duplicated anywhere. */}
              <div>
                {/* The heading lives INSIDE the stage. Outside it, it scrolls
                    away and the reader stares at an unlabelled plate. */}
                <p className="[font-family:var(--font-mono)] text-[11px] sm:text-[12px] font-medium uppercase tracking-[0.2em] text-[#f54900] inline-block border-t-2 border-[#f54900] pt-2 mb-4">
                  {eyebrow}
                </p>
                <h2
                  className="font-bold tracking-tight leading-[1.02] text-[clamp(2rem,4.2vw,3.25rem)] mb-3"
                  id="oss-line-heading"
                >
                  {heading}
                </h2>
                <p className="text-default-300 text-[15px] sm:text-[17px] leading-[1.6] max-w-[52ch] mb-6 lg:mb-8">
                  {deck}
                </p>

                {swapping ? (
                  // Fixed height with the plate absolutely positioned, so the
                  // outgoing and incoming cards overlap during the swap rather
                  // than the container collapsing between them.
                  <div
                    aria-hidden="true"
                    className="relative h-[clamp(19rem,42vh,24rem)]"
                  >
                    <AnimatePresence custom={dir} initial={false} mode="popLayout">
                      <motion.div
                        key={step}
                        animate={{ x: 0, opacity: 1 }}
                        className="absolute inset-0"
                        custom={dir}
                        exit={{
                          x: dir > 0 ? -70 : 70,
                          opacity: 0,
                          transition: { duration: 0.28, ease: HOUSE_EASE },
                        }}
                        initial={
                          instant
                            ? false
                            : { x: dir > 0 ? 90 : -90, opacity: 0 }
                        }
                        transition={{ duration: 0.45, ease: HOUSE_EASE }}
                      >
                        <Plate
                          animate={!instant}
                          block={blocks[step]}
                          index={step}
                          total={blocks.length}
                        />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                ) : (
                  // Unpinned / reduced motion: no swap to drive, so every plate
                  // is shown stacked. Nothing is hidden behind a scroll position
                  // the visitor cannot reach.
                  <div aria-hidden="true" className="grid grid-cols-1 gap-4">
                    {blocks.map((b, i) => (
                      <Plate
                        key={b.title}
                        animate={staticInView && !reduce}
                        block={b}
                        index={i}
                        total={blocks.length}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Canonical content: always present, always complete, never animated.
          With one plate on screen at a time this is the ONLY place all four
          claims exist together, so it carries real weight — not just a nicety.

          It sits AFTER the track, not before it, because the <h2> it belongs
          under lives inside the stage. In front of the track these <h3>s
          preceded their own <h2> in the DOM and followed the page <h1>
          directly, so a crawler read the outline as h1 → h3 → h2 — a skipped
          level and an out-of-order one. Moving it here makes the section read
          h2 → h3 ×4 with nothing skipped. Do not hoist it back. */}
      <ul className="sr-only">
        {blocks.map((b) => (
          <li key={b.title}>
            <h3>{b.title}</h3>
            <p>{b.lead}</p>
            <p>{b.proof}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
