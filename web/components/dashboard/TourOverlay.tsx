"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@heroui/button";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

import { useTour, TOUR_CHAPTERS } from "@/lib/tour-context";
import {
  PxChevronRight,
  PxChevronLeft,
  PxBookOpen,
  PxCheck,
  PxZap,
} from "@/components/ui/PixelIcons";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const POPOVER_W = 360;
const POPOVER_GAP = 14;
const PAD = 12;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Tour step selectors are comma-separated as "primary, fallback1, fallback2".
// document.querySelector with a comma-separated list returns whichever match
// appears FIRST IN DOM ORDER — not the primary. That made every step that
// listed a sidebar fallback land on the sidebar even when the real target
// existed. Split and try in priority order instead.
function querySelectorPriority<T extends Element = Element>(
  selector: string
): T | null {
  for (const part of selector.split(",").map((s) => s.trim()).filter(Boolean)) {
    const el = document.querySelector<T>(part);
    if (el) return el;
  }
  return null;
}

function computePopover(
  target: Rect,
  placement: string | undefined,
  vw: number,
  vh: number,
  popH: number
): { top: number; left: number; arrow: "top" | "bottom" | "left" | "right" } {
  const tries: Array<"bottom" | "top" | "right" | "left"> =
    placement && placement !== "auto"
      ? [
          placement as "bottom" | "top" | "right" | "left",
          "bottom",
          "top",
          "right",
          "left",
        ]
      : ["bottom", "top", "right", "left"];

  for (const p of tries) {
    let top = 0;
    let left = 0;
    if (p === "bottom") {
      top = target.top + target.height + POPOVER_GAP;
      left = target.left + target.width / 2 - POPOVER_W / 2;
    } else if (p === "top") {
      top = target.top - popH - POPOVER_GAP;
      left = target.left + target.width / 2 - POPOVER_W / 2;
    } else if (p === "right") {
      top = target.top + target.height / 2 - popH / 2;
      left = target.left + target.width + POPOVER_GAP;
    } else {
      top = target.top + target.height / 2 - popH / 2;
      left = target.left - POPOVER_W - POPOVER_GAP;
    }
    const fits =
      top >= PAD &&
      left >= PAD &&
      top + popH <= vh - PAD &&
      left + POPOVER_W <= vw - PAD;
    if (fits) {
      const arrow =
        p === "bottom"
          ? "top"
          : p === "top"
            ? "bottom"
            : p === "right"
              ? "left"
              : "right";
      return { top, left, arrow };
    }
  }
  // Fallback: center on screen
  return {
    top: clamp(vh / 2 - popH / 2, PAD, vh - popH - PAD),
    left: clamp(vw / 2 - POPOVER_W / 2, PAD, vw - POPOVER_W - PAD),
    arrow: "top",
  };
}

/**
 * Friendly toast on dismiss — reassures the user the tour isn't gone forever
 * and they can poke at the demo data they were just looking at.
 */
function showDismissToast() {
  toast(
    (t) => (
      <div className="flex items-center gap-3">
        <span
          className="flex items-center justify-center h-7 w-7 border shrink-0"
          style={{
            color: "var(--theme-accent,#f54900)",
            borderColor: "rgba(var(--theme-accent-rgb,245,73,0),0.3)",
            backgroundColor: "rgba(var(--theme-accent-rgb,245,73,0),0.08)",
          }}
        >
          <PxBookOpen className="h-3.5 w-3.5" />
        </span>
        <div className="text-xs leading-snug">
          <p className="text-white font-semibold">Tour paused</p>
          <p className="text-default-400 mt-0.5">
            Restart anytime from{" "}
            <span className="text-[color:var(--theme-accent,#f54900)] font-mono">
              /dashboard/tutorial
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => toast.dismiss(t.id)}
          className="ml-2 text-default-500 hover:text-white text-sm leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    ),
    { duration: 4500 }
  );
}

export function TourOverlay() {
  const {
    isActive,
    stepIndex,
    steps,
    progress,
    next,
    prev,
    end,
    justCompleted,
    dismissCelebration,
  } = useTour();
  const [rect, setRect] = useState<Rect | null>(null);
  const [popoverRect, setPopoverRect] = useState<{
    top: number;
    left: number;
    arrow: "top" | "bottom" | "left" | "right";
  } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showChapterIntro, setShowChapterIntro] = useState(false);
  const [lastChapterId, setLastChapterId] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => setMounted(true), []);

  // Show a chapter intro card whenever we *enter* a new chapter (including the
  // very first one when the tour starts). Stays until the user clicks "Begin"
  // or hits Enter/→.
  useEffect(() => {
    if (!isActive) {
      setShowChapterIntro(false);
      setLastChapterId(null);
      return;
    }
    if (justCompleted) return;
    const currentChapterId = progress.chapter.id;
    if (currentChapterId !== lastChapterId) {
      setShowChapterIntro(true);
      setLastChapterId(currentChapterId);
    }
  }, [isActive, justCompleted, progress.chapter.id, lastChapterId]);

  // Poll for the target element so route changes / async content settle.
  useEffect(() => {
    if (!isActive || showChapterIntro || justCompleted) {
      // Pause spotlight tracking while the chapter intro / celebration is showing.
      setRect(null);
      setWaiting(false);
      return;
    }
    const step = steps[stepIndex];
    if (!step) return;

    let cancelled = false;
    let raf = 0;
    const start = performance.now();

    const measure = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    };

    // Try synchronously first. If the element is already on screen (typical
    // for same-route step transitions), we update rect immediately without
    // any blanking — popover stays visible and smoothly animates to the new
    // position. Only when the target genuinely isn't there yet do we drop
    // the spotlight and start polling.
    const immediate = querySelectorPriority<HTMLElement>(step.selector);
    if (immediate) {
      const r = measure(immediate);
      setRect(r);
      setWaiting(false);
      const out = r.top < 80 || r.top + r.height > window.innerHeight - 80;
      if (out) {
        immediate.scrollIntoView({ block: "center", behavior: "smooth" });
        setTimeout(() => {
          if (cancelled) return;
          setRect(measure(immediate));
        }, 350);
      }
      return () => {
        cancelled = true;
      };
    }

    // Target not found yet (cross-route navigation, async data, etc.) —
    // hide the spotlight (so we don't mislead with a stale highlight on a
    // different element) but keep the popover at its last known position
    // so the user has continuous visual feedback of their click.
    setRect(null);
    setWaiting(true);

    const find = () => {
      if (cancelled) return;
      const el = querySelectorPriority<HTMLElement>(step.selector);
      if (el) {
        const r = measure(el);
        setRect(r);
        const out = r.top < 80 || r.top + r.height > window.innerHeight - 80;
        if (out) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          setTimeout(() => {
            if (cancelled) return;
            setRect(measure(el));
            setWaiting(false);
          }, 350);
        } else {
          setWaiting(false);
        }
        return;
      }
      if (performance.now() - start > 5000) {
        // Give up waiting — keep popover where it is, no spotlight.
        setRect(null);
        setWaiting(false);
        return;
      }
      raf = window.setTimeout(find, 100) as unknown as number;
    };
    raf = window.setTimeout(find, 60) as unknown as number;

    return () => {
      cancelled = true;
      if (raf) clearTimeout(raf);
    };
  }, [isActive, stepIndex, steps, showChapterIntro, justCompleted]);

  // Keep target rect updated on resize / scroll
  useEffect(() => {
    if (!isActive || showChapterIntro || justCompleted) return;
    const step = steps[stepIndex];
    if (!step) return;
    const update = () => {
      const el = querySelectorPriority<HTMLElement>(step.selector);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isActive, stepIndex, steps, showChapterIntro, justCompleted]);

  // Compute popover position once we know both target rect AND popover height.
  // While `waiting` is true (transitioning to a new step whose target isn't
  // mounted yet), keep the popover at its previous position so the user has
  // continuous visual feedback that their click registered.
  useEffect(() => {
    if (!isActive) return;
    if (showChapterIntro || justCompleted) return;
    if (!popRef.current) return;
    const popH = popRef.current.offsetHeight || 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect) {
      const placement = steps[stepIndex]?.placement;
      setPopoverRect(computePopover(rect, placement, vw, vh, popH));
    } else if (!waiting) {
      setPopoverRect({
        top: vh / 2 - popH / 2,
        left: vw / 2 - POPOVER_W / 2,
        arrow: "top",
      });
    }
    // else: waiting for target, leave popoverRect untouched
  }, [
    isActive,
    rect,
    waiting,
    stepIndex,
    steps,
    showChapterIntro,
    justCompleted,
  ]);

  // ResizeObserver on the popover itself — when its content reflows
  // (step swap with different body length), recompute placement so we don't
  // overlap the spotlight or overflow the viewport.
  useEffect(() => {
    if (!isActive || showChapterIntro || justCompleted) return;
    const node = popRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const popH = node.offsetHeight || 220;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (rect) {
        const placement = steps[stepIndex]?.placement;
        setPopoverRect(computePopover(rect, placement, vw, vh, popH));
      } else if (!waiting) {
        setPopoverRect({
          top: vh / 2 - popH / 2,
          left: vw / 2 - POPOVER_W / 2,
          arrow: "top",
        });
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [
    isActive,
    rect,
    waiting,
    stepIndex,
    steps,
    showChapterIntro,
    justCompleted,
  ]);

  // Wrap end() so we always show the friendly dismissal toast on skip/escape
  // (but not after the celebration — that's a deliberate "you finished" close).
  // Pre-mortem the exit: send the user to /dashboard/tutorial so they always
  // land on a populated, helpful page instead of an empty real-data dashboard.
  const handleSkip = () => {
    showDismissToast();
    end("skipped");
    // Route home only if we're not already on the tutorial.
    if (typeof window !== "undefined" && window.location.pathname !== "/dashboard/tutorial") {
      router.push("/dashboard/tutorial");
    }
  };

  // Esc + arrow-keys
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (justCompleted) {
          dismissCelebration();
        } else {
          handleSkip();
        }
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (justCompleted) {
          dismissCelebration();
        } else if (showChapterIntro) {
          setShowChapterIntro(false);
        } else {
          next();
        }
      } else if (e.key === "ArrowLeft") {
        if (showChapterIntro || justCompleted) return;
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, next, prev, end, showChapterIntro, justCompleted]);

  if (!mounted) return null;

  const step = steps[stepIndex];
  const isVeryLastStep = stepIndex === steps.length - 1;

  // ── Chapter intro overlay (centered card before first step of each chapter) ──
  const renderChapterIntro = () => (
    <motion.div
      key="chapter-intro"
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -4 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
      style={{ width: 420 }}
    >
      <div className="relative bg-[#0d0d0d] border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.35)] shadow-2xl">
        <CornerBrackets />
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.08)] text-[color:var(--theme-accent,#f54900)]">
              <PxBookOpen className="h-2.5 w-2.5" />
              Chapter {progress.chapterNumber} of {progress.chapterTotal}
            </span>
            <button
              type="button"
              onClick={handleSkip}
              className="text-default-400 hover:text-white text-[10px] uppercase tracking-wider"
            >
              Pause
            </button>
          </div>

          {/* Goal-gradient: tiny "you just finished a chapter" pat-on-back. */}
          {progress.chapterNumber > 1 && (
            <div className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider mb-3 text-green-400/90">
              <PxCheck className="h-3 w-3" />
              Chapter {progress.chapterNumber - 1} complete
            </div>
          )}

          <h3 className="text-xl font-semibold text-white leading-snug mb-2">
            {progress.chapter.title}
          </h3>
          <p className="text-sm text-default-400 leading-relaxed">
            {progress.chapter.hook}
          </p>

          {/* Chapter pip strip — visualises pacing */}
          <div className="flex items-center gap-1 mt-5">
            {TOUR_CHAPTERS.map((c, i) => (
              <span
                key={c.id}
                className="h-[3px] flex-1 transition-colors"
                style={{
                  backgroundColor:
                    i + 1 === progress.chapterNumber
                      ? "var(--theme-accent,#f54900)"
                      : i + 1 < progress.chapterNumber
                        ? "rgba(var(--theme-accent-rgb,245,73,0),0.4)"
                        : "rgba(255,255,255,0.06)",
                }}
              />
            ))}
          </div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-default-500 mt-2">
            {progress.stepsInChapter} short steps · about{" "}
            {Math.max(1, Math.ceil(progress.stepsInChapter * 0.25))} min
          </p>

          <div className="grid grid-cols-[1fr_auto] gap-2 mt-6">
            <Button
              size="md"
              onPress={() => setShowChapterIntro(false)}
              className="!rounded-none text-[11px] uppercase tracking-wider font-bold h-10 text-white"
              style={{ backgroundColor: "var(--theme-accent,#f54900)" }}
              endContent={<PxChevronRight className="h-3.5 w-3.5" />}
            >
              {progress.chapterNumber === 1
                ? "Begin tour"
                : `Begin chapter ${progress.chapterNumber}`}
            </Button>
            <span className="self-center text-[10px] font-mono text-default-500 tracking-wider">
              ↵
            </span>
          </div>
          <p className="text-[10px] text-default-500 mt-3 text-center font-mono uppercase tracking-wider">
            Esc to leave · ↵ to begin
          </p>
        </div>
      </div>
    </motion.div>
  );

  // ── Final celebration card ──
  const renderCelebration = () => (
    <motion.div
      key="celebration"
      initial={{ opacity: 0, scale: 0.94, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto"
      style={{ width: 460 }}
    >
      <div className="relative bg-[#0d0d0d] border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.5)] shadow-2xl">
        <CornerBrackets />

        {/* Soft confetti dots — tasteful, no full-screen spam */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 14 }).map((_, i) => {
            const seed = (i * 137) % 100;
            const left = (seed * 7) % 100;
            const delay = (seed % 9) * 0.06;
            return (
              <motion.span
                key={i}
                className="absolute h-1 w-1"
                style={{
                  left: `${left}%`,
                  top: "0%",
                  backgroundColor:
                    i % 3 === 0
                      ? "var(--theme-accent,#f54900)"
                      : i % 3 === 1
                        ? "rgba(255,255,255,0.4)"
                        : "rgba(var(--theme-accent-rgb,245,73,0),0.5)",
                }}
                initial={{ y: -8, opacity: 0 }}
                animate={{ y: 220, opacity: [0, 1, 0] }}
                transition={{
                  duration: 1.6,
                  delay,
                  ease: "easeOut",
                }}
              />
            );
          })}
        </div>

        <div className="p-6 relative">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center justify-center h-9 w-9 border"
              style={{
                color: "var(--theme-accent,#f54900)",
                borderColor: "rgba(var(--theme-accent-rgb,245,73,0),0.4)",
                backgroundColor:
                  "rgba(var(--theme-accent-rgb,245,73,0),0.08)",
              }}
            >
              <PxZap className="h-4 w-4" />
            </span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.08)] text-[color:var(--theme-accent,#f54900)]">
              Tour complete
            </span>
          </div>
          <h3 className="text-2xl font-semibold text-white leading-tight mb-2">
            You're ready to roll.
          </h3>
          <p className="text-sm text-default-400 leading-relaxed">
            You've seen every page. The fastest way to get value from the
            panel is to connect a real OnlyFans or Fansly account — the dashboard wakes
            up the moment you do.
          </p>

          {/* Chapter recap — gentle reinforcement of completion */}
          <div className="mt-5 grid grid-cols-3 gap-1.5">
            {TOUR_CHAPTERS.map((c) => (
              <div
                key={c.id}
                className="border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.25)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.05)] px-2 py-1.5 flex items-center gap-1.5"
              >
                <PxCheck className="h-3 w-3 shrink-0 text-[color:var(--theme-accent,#f54900)]" />
                <span className="text-[9px] uppercase tracking-wider text-white/80 truncate">
                  {c.title}
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2 mt-6">
            <Button
              as="a"
              href="/dashboard/accounts"
              size="md"
              onPress={dismissCelebration}
              className="!rounded-none text-[11px] uppercase tracking-wider font-bold h-10 text-white"
              style={{ backgroundColor: "var(--theme-accent,#f54900)" }}
              endContent={<PxChevronRight className="h-3.5 w-3.5" />}
            >
              Add your first account
            </Button>
            <Button
              size="md"
              variant="bordered"
              onPress={dismissCelebration}
              className="!rounded-none border-white/[0.12] text-[11px] uppercase tracking-wider font-semibold h-10"
            >
              Look around
            </Button>
          </div>
          <p className="text-[10px] text-default-500 mt-3 text-center">
            Replay the tour anytime from{" "}
            <span className="font-mono text-default-400">
              /dashboard/tutorial
            </span>
          </p>
        </div>
      </div>
    </motion.div>
  );

  return createPortal(
    <AnimatePresence>
      {isActive && (step || justCompleted) && (
        <motion.div
          key="tour-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] pointer-events-none"
        >
          {/* Spotlight: a sized div with a huge box-shadow that dims everything around it */}
          {!showChapterIntro && !justCompleted && rect ? (
            <motion.div
              className="fixed pointer-events-none"
              initial={false}
              animate={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
              transition={{
                type: "spring",
                stiffness: 280,
                damping: 32,
                mass: 0.7,
              }}
              style={{
                boxShadow:
                  "0 0 0 9999px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.04) inset",
                outline: "2px solid var(--theme-accent, #f54900)",
                outlineOffset: "-2px",
                borderRadius: "1px",
              }}
            />
          ) : (
            <div className="fixed inset-0 bg-black/65 pointer-events-auto" />
          )}

          {/* Click-eater so user can't interact with page during tour */}
          <div
            className="fixed inset-0 pointer-events-auto"
            onClick={(e) => {
              // Click outside the popover dismisses
              if (popRef.current && popRef.current.contains(e.target as Node))
                return;
              // No-op — we want forced flow via buttons; but allow Esc.
            }}
          />

          {/* Pulsing ring on target — only when we have a real spotlight target */}
          {!showChapterIntro && !justCompleted && rect && (
            <motion.div
              className="fixed pointer-events-none"
              initial={false}
              animate={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
              transition={{
                type: "spring",
                stiffness: 280,
                damping: 32,
                mass: 0.7,
              }}
            >
              <motion.div
                className="absolute inset-0"
                animate={{
                  boxShadow: [
                    "0 0 0 0 rgba(var(--theme-accent-rgb,245,73,0),0.4)",
                    "0 0 0 14px rgba(var(--theme-accent-rgb,245,73,0),0)",
                  ],
                }}
                transition={{
                  duration: 1.8,
                  repeat: Infinity,
                  ease: "easeOut",
                }}
              />
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {showChapterIntro ? renderChapterIntro() : null}
            {justCompleted ? renderCelebration() : null}
          </AnimatePresence>

          {/* Step popover — hidden during chapter intro / celebration */}
          {!showChapterIntro && !justCompleted && (
            <motion.div
              ref={popRef}
              className="fixed pointer-events-auto"
              initial={false}
              animate={
                popoverRect
                  ? { top: popoverRect.top, left: popoverRect.left, opacity: 1 }
                  : { opacity: 0 }
              }
              transition={{
                type: "spring",
                stiffness: 320,
                damping: 34,
                mass: 0.7,
              }}
              style={{ width: POPOVER_W }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={stepIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="relative bg-[#0d0d0d] border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.35)] shadow-2xl"
                >
                  <CornerBrackets />

                  {popoverRect && rect && (
                    <Arrow placement={popoverRect.arrow} />
                  )}

                  <div className="p-4">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.3)] bg-[color:rgba(var(--theme-accent-rgb,245,73,0),0.08)] text-[color:var(--theme-accent,#f54900)] truncate">
                        <PxBookOpen className="h-2.5 w-2.5 shrink-0" />
                        <span className="truncate">
                          Ch {progress.chapterNumber}/{progress.chapterTotal}
                          <span className="opacity-60">
                            {" · "}
                            {progress.stepInChapter}/{progress.stepsInChapter}
                          </span>
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={handleSkip}
                        aria-label="Pause tour"
                        className="text-default-400 hover:text-white text-xs uppercase tracking-wider shrink-0"
                      >
                        Pause
                      </button>
                    </div>

                    <h3 className="text-base font-semibold text-white leading-snug mb-1.5">
                      {step?.title}
                    </h3>
                    <p
                      className="text-[10px] uppercase tracking-wider text-default-500 mb-2 truncate"
                      style={{ letterSpacing: "0.08em" }}
                    >
                      {progress.chapter.title}
                    </p>
                    <p className="text-xs text-default-300 leading-relaxed">
                      {step?.body}
                    </p>

                    {waiting && !rect && (
                      <p className="mt-3 text-[10px] text-yellow-400/70 italic flex items-center gap-2">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
                        Loading the page…
                      </p>
                    )}

                    {/* Per-chapter progress dots */}
                    <div className="flex items-center gap-1 mt-4">
                      {Array.from({ length: progress.stepsInChapter }).map(
                        (_, i) => (
                          <span
                            key={i}
                            className="h-[3px] flex-1 transition-colors"
                            style={{
                              backgroundColor:
                                i + 1 === progress.stepInChapter
                                  ? "var(--theme-accent,#f54900)"
                                  : i + 1 < progress.stepInChapter
                                    ? "rgba(var(--theme-accent-rgb,245,73,0),0.4)"
                                    : "rgba(255,255,255,0.06)",
                            }}
                          />
                        )
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 mt-4">
                      <Button
                        size="sm"
                        variant="bordered"
                        onPress={prev}
                        isDisabled={stepIndex === 0}
                        className="!rounded-none border-white/[0.08] text-[10px] uppercase tracking-wider font-semibold h-8"
                        startContent={<PxChevronLeft className="h-3 w-3" />}
                      >
                        Back
                      </Button>
                      <Button
                        size="sm"
                        onPress={next}
                        className="!rounded-none text-[10px] uppercase tracking-wider font-bold h-8 text-white"
                        style={{
                          backgroundColor: "var(--theme-accent,#f54900)",
                        }}
                        endContent={
                          isVeryLastStep ? (
                            <PxZap className="h-3 w-3" />
                          ) : progress.isChapterLast ? (
                            <PxCheck className="h-3 w-3" />
                          ) : (
                            <PxChevronRight className="h-3 w-3" />
                          )
                        }
                      >
                        {isVeryLastStep
                          ? "Finish tour"
                          : progress.isChapterLast
                            ? "Chapter done"
                            : "Next"}
                      </Button>
                    </div>

                    <p className="text-[9px] font-mono uppercase tracking-wider text-default-500 mt-3 text-center">
                      Esc · ←/→ · Enter
                    </p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function CornerBrackets() {
  const c = "absolute h-2 w-2 border-[color:var(--theme-accent,#f54900)]";
  return (
    <>
      <span className={`${c} top-0 left-0 border-l border-t`} />
      <span className={`${c} top-0 right-0 border-r border-t`} />
      <span className={`${c} bottom-0 left-0 border-l border-b`} />
      <span className={`${c} bottom-0 right-0 border-r border-b`} />
    </>
  );
}

function Arrow({ placement }: { placement: "top" | "bottom" | "left" | "right" }) {
  // Triangle made from a rotated bordered square
  const base =
    "absolute w-2 h-2 bg-[#0d0d0d] border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.35)] rotate-45";
  if (placement === "top") {
    return (
      <span
        className={`${base} -top-[5px] left-1/2 -translate-x-1/2 border-l border-t`}
      />
    );
  }
  if (placement === "bottom") {
    return (
      <span
        className={`${base} -bottom-[5px] left-1/2 -translate-x-1/2 border-r border-b`}
      />
    );
  }
  if (placement === "left") {
    return (
      <span
        className={`${base} -left-[5px] top-1/2 -translate-y-1/2 border-l border-b`}
      />
    );
  }
  return (
    <span
      className={`${base} -right-[5px] top-1/2 -translate-y-1/2 border-r border-t`}
    />
  );
}
