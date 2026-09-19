"use client";

import { motion } from "framer-motion";

/** Single floating orange particle. Spawns into view, drifts up a bit,
 *  then fades — looped infinitely. Cheap CSS-only animation. */
function Particle({
  delay,
  duration,
  x,
  y,
  size,
}: {
  delay: number;
  duration: number;
  x: string;
  y: string;
  size: number;
}) {
  return (
    <motion.div
      className="absolute rounded-full bg-[#f54900]"
      style={{ left: x, top: y, width: size, height: size }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{
        opacity: [0, 0.15, 0.05, 0.15, 0],
        scale: [0, 1, 0.8, 1, 0],
        y: [0, -30, -10, -40, -60],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    />
  );
}

/** Faint grid lines that draw in on mount (horizontal then vertical) and
 *  stay. Subtle white/[0.02] so they read as architectural, not decorative. */
function GridLines() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={`h-${i}`}
          className="absolute left-0 right-0 h-px bg-white/[0.02]"
          style={{ top: `${(i + 1) * 12}%` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.5, delay: i * 0.08, ease: "easeOut" }}
        />
      ))}
      {Array.from({ length: 6 }).map((_, i) => (
        <motion.div
          key={`v-${i}`}
          className="absolute top-0 bottom-0 w-px bg-white/[0.02]"
          style={{ left: `${(i + 1) * 16}%` }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 1.5, delay: 0.3 + i * 0.08, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

// Fixed-seed particle layout — using random positions would re-shuffle on
// every render and looks chaotic. Hard-coded coordinates keep the field
// stable across mounts while still feeling alive due to the per-particle
// timing offsets.
const PARTICLES = [
  { delay: 0, duration: 4, x: "15%", y: "60%", size: 3 },
  { delay: 1.2, duration: 5, x: "75%", y: "70%", size: 2 },
  { delay: 0.5, duration: 4.5, x: "40%", y: "80%", size: 4 },
  { delay: 2, duration: 3.5, x: "85%", y: "50%", size: 2 },
  { delay: 0.8, duration: 5.5, x: "25%", y: "40%", size: 3 },
  { delay: 1.5, duration: 4, x: "60%", y: "75%", size: 2 },
  { delay: 3, duration: 4.5, x: "50%", y: "30%", size: 3 },
  { delay: 0.3, duration: 5, x: "90%", y: "25%", size: 2 },
];

const STREAKS = [0, 1, 2];

/** Full-screen black backdrop with the radial orange glow, the drawn-in
 *  grid, the floating particles, and the diagonal streak lines used by
 *  /login and /register. Pure-decoration; pointer-events disabled. */
export function AuthBackground() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Centred radial glow that gently pulses */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(245,73,0,0.08) 0%, rgba(245,73,0,0.02) 40%, transparent 70%)",
        }}
        animate={{
          scale: [1, 1.05, 1],
          opacity: [0.8, 1, 0.8],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <GridLines />

      {PARTICLES.map((p, i) => (
        <Particle key={i} {...p} />
      ))}

      {/* Diagonal streak lines — sweep across the frame on a 7s cycle. */}
      {STREAKS.map((i) => (
        <motion.div
          key={`streak-${i}`}
          className="absolute h-px bg-gradient-to-r from-transparent via-[#f54900]/10 to-transparent"
          style={{
            width: "300px",
            left: `${20 + i * 25}%`,
            top: `${30 + i * 15}%`,
            transform: "rotate(-35deg)",
          }}
          initial={{ opacity: 0, x: -100 }}
          animate={{ opacity: [0, 0.4, 0], x: [100, 300] }}
          transition={{
            duration: 3,
            delay: 1 + i * 1.5,
            repeat: Infinity,
            repeatDelay: 4,
            ease: "easeOut",
          }}
        />
      ))}
    </div>
  );
}
