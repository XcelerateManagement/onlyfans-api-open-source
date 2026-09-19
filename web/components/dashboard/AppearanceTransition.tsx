"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppearance } from "@/lib/hooks/use-appearance";

export function AppearanceTransition() {
  const { transition, clearTransition } = useAppearance();
  const [show, setShow] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0, color: "#f54900" });

  useEffect(() => {
    if (transition) {
      setOrigin(transition);
      setShow(true);
    }
  }, [transition]);

  return (
    <AnimatePresence>
      {show && (
        <>
          {/* Ripple circle expanding from click origin */}
          <motion.div
            className="fixed inset-0 z-[9999] pointer-events-none"
            initial={{
              clipPath: `circle(0% at ${origin.x}px ${origin.y}px)`,
            }}
            animate={{
              clipPath: `circle(150vmax at ${origin.x}px ${origin.y}px)`,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            onAnimationComplete={() => {
              setShow(false);
              clearTransition();
            }}
            style={{ backgroundColor: origin.color }}
          >
            <div className="w-full h-full" style={{ backgroundColor: origin.color, opacity: 0.12 }} />
          </motion.div>

          {/* Scanline sweep */}
          <motion.div
            className="fixed inset-0 z-[9998] pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <motion.div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, transparent 0%, ${origin.color}20 48%, ${origin.color}40 50%, ${origin.color}20 52%, transparent 100%)`,
                backgroundSize: "100% 200%",
              }}
              initial={{ backgroundPosition: "0% -100%" }}
              animate={{ backgroundPosition: "0% 200%" }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            />
          </motion.div>

          {/* Brief flash overlay */}
          <motion.div
            className="fixed inset-0 z-[9997] pointer-events-none"
            style={{ backgroundColor: origin.color }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.08, 0] }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </>
      )}
    </AnimatePresence>
  );
}
