"use client";

import { motion } from "framer-motion";

interface PixelSpinnerProps {
  size?: "sm" | "md" | "lg";
}

const sizeConfig = {
  sm: { container: 32, blockSize: 5, radius: 12 },
  md: { container: 52, blockSize: 8, radius: 20 },
  lg: { container: 72, blockSize: 10, radius: 28 },
};

export function PixelSpinner({ size = "md" }: PixelSpinnerProps) {
  const blocks = 8;
  const { container, blockSize, radius } = sizeConfig[size];
  const center = container / 2;

  return (
    <div className="relative" style={{ width: container, height: container }}>
      {[...Array(blocks)].map((_, i) => {
        const angle = (i / blocks) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius + center - blockSize / 2;
        const y = Math.sin(angle) * radius + center - blockSize / 2;

        return (
          <motion.div
            key={i}
            className="absolute"
            style={{ left: x, top: y, width: blockSize, height: blockSize, backgroundColor: "var(--theme-accent, #f54900)" }}
            animate={{
              opacity: [0.15, 1, 0.15],
              scale: [0.6, 1, 0.6],
            }}
            transition={{
              duration: 0.9,
              delay: (i / blocks) * 0.9,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        );
      })}
    </div>
  );
}
