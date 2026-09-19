"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

export function FloatingParticles() {
  const particles = useMemo(() => {
    const pts: {
      x: number;
      y: number;
      size: number;
      color: string;
      duration: number;
      delay: number;
    }[] = [];
    for (let i = 0; i < 18; i++) {
      const s1 = Math.sin(i * 173.7 + 29.1) * 43758.5453;
      const s2 = Math.sin(i * 337.1 + 117.3) * 43758.5453;
      const s3 = Math.sin(i * 521.9 + 213.7) * 43758.5453;
      const frac1 = s1 - Math.floor(s1);
      const frac2 = s2 - Math.floor(s2);
      const frac3 = s3 - Math.floor(s3);
      pts.push({
        x: frac1 * 100,
        y: 65 + frac2 * 35, // bottom third
        size: 2 + frac3 * 2,
        color:
          i % 3 === 0
            ? "rgba(245,73,0,0.3)"
            : "rgba(255,255,255,0.15)",
        duration: 3 + frac3 * 4,
        delay: frac1 * 3,
      });
    }
    return pts;
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full will-change-transform ${i >= 10 ? "hidden sm:block" : ""}`}
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
          }}
          animate={{
            y: [0, -20, 0],
            opacity: [0.2, 0.7, 0.2],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay: p.delay,
          }}
        />
      ))}
    </div>
  );
}
