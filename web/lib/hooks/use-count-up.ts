"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animate a number from its previous value toward ``target`` with a cubic
 * ease-out curve. Returns the intermediate value on each frame. No animation
 * library required.
 */
export function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(target);
  const prev = useRef(target);

  useEffect(() => {
    const start = prev.current;
    const diff = target - start;
    if (diff === 0) {
      setValue(target);
      return;
    }
    const startTime = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setValue(start + diff * ease);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        setValue(target);
        prev.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
