"use client";

import { useMemo } from "react";

export function StarsBackground() {
  const stars = useMemo(() => {
    const pts: { x: number; y: number; r: number; opacity: number }[] = [];
    for (let i = 0; i < 120; i++) {
      const s1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const s2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
      const s3 = Math.sin(i * 419.2 + 371.9) * 43758.5453;
      const s4 = Math.sin(i * 631.4 + 97.1) * 43758.5453;
      pts.push({
        x: (s1 - Math.floor(s1)) * 100,
        y: (s2 - Math.floor(s2)) * 100,
        r: 1 + (s3 - Math.floor(s3)) * 1.5,
        opacity: 0.15 + (s4 - Math.floor(s4)) * 0.25,
      });
    }
    return pts;
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {stars.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r,
            height: s.r,
            opacity: s.opacity,
          }}
        />
      ))}
    </div>
  );
}
