"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * The four steps to a running install, in the hero.
 *
 * Replaces a static capability strip ("Your data stays yours", "Scalable
 * operations"). Those were claims; these are instructions — a visitor can see
 * the whole job before committing to it, which is a better use of the space
 * directly under the headline.
 *
 * The badge carries the step NUMBER, not an icon. Four different glyphs at
 * 17px read as decoration and give the eye four things to decode; a numeral
 * says "first, then, then, then" instantly, which is the only thing this strip
 * has to communicate.
 *
 * A marker walks the steps on a loop — a single `active` index rather than four
 * independent animations, so it always reads as one sequence and can never show
 * two steps lit at once.
 *
 * Reduced motion: no timer, no walk. Every step renders in its resting state,
 * which is legible and complete — the content was never carried by the motion.
 */

/* Short labels on purpose: each must sit on one line at four columns, or the
   row becomes four ragged blocks of different heights. */
const STEPS = [
  { n: "01", title: "Clone repo", sub: "One command" },
  { n: "02", title: "Host it", sub: "Any Docker box" },
  { n: "03", title: "Add proxy", sub: "+ captcha key" },
  { n: "04", title: "Connect", sub: "OF + Fansly" },
];

const HOUSE_EASE = [0.25, 0.4, 0.25, 1] as const;

export function LaunchSteps() {
  const prefersReduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);

  // useReducedMotion() differs between server and client, so gate the branch
  // behind mount or the first client render will not match the server.
  useEffect(() => setMounted(true), []);
  const reduce = mounted && prefersReduced;

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setActive((i) => (i + 1) % STEPS.length), 1600);

    return () => clearInterval(id);
  }, [reduce]);

  return (
    <ol className="grid grid-cols-4 gap-x-2 sm:gap-x-4 mb-9 max-w-xl">
      {STEPS.map((step, i) => {
        const lit = !reduce && i === active;

        return (
          <li key={step.n} className="relative flex flex-col items-center text-center">
            {/* Connector sits at the badge's vertical centre (badge is 2.5rem,
                so 1.25rem down) and spans the gap to the next badge. Hidden on
                the last step, where it would point at nothing. */}
            {i < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-5 left-[calc(50%+1.5rem)] right-[calc(-50%+1.5rem)] h-px bg-[#f54900]/25"
              />
            ) : null}

            <span className="relative">
              <motion.span
                animate={{
                  borderColor: lit
                    ? "rgba(245,73,0,0.9)"
                    : "rgba(245,73,0,0.3)",
                  backgroundColor: lit
                    ? "rgba(245,73,0,0.16)"
                    : "rgba(245,73,0,0.04)",
                  color: lit ? "rgb(255,255,255)" : "rgba(245,73,0,0.85)",
                }}
                className="grid place-items-center w-10 h-10 rounded-md border [font-family:var(--font-mono)] text-[13px] font-medium tabular-nums"
                transition={{ duration: 0.35, ease: HOUSE_EASE }}
              >
                {step.n}
              </motion.span>

              {lit ? (
                <motion.span
                  animate={{ opacity: 1, scale: 1 }}
                  aria-hidden="true"
                  className="absolute -inset-1 rounded-lg border border-[#f54900]/50"
                  initial={{ opacity: 0, scale: 0.88 }}
                  transition={{ duration: 0.35, ease: HOUSE_EASE }}
                />
              ) : null}
            </span>

            <span className="mt-3 block text-[13px] leading-tight text-default-200 whitespace-nowrap">
              {step.title}
            </span>
            <span className="mt-0.5 block text-[12px] leading-tight text-default-500 whitespace-nowrap">
              {step.sub}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
