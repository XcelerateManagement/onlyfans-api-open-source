"use client";

import Image from "next/image";
import { motion } from "framer-motion";

interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
  index: number;
}

export function FeatureCard({ icon, title, description, index }: FeatureCardProps) {
  return (
    <motion.div
      className="relative bg-[#0d0d0d] border border-white/[0.06] p-6 h-full flex flex-col overflow-hidden group"
      whileHover={{ y: -6 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      {/* Orange accent line top */}
      <motion.div
        className="absolute top-0 left-0 h-[2px] bg-[#f54900]"
        initial={{ width: "0%" }}
        whileInView={{ width: "100%" }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: index * 0.1 + 0.3 }}
      />

      {/* Hover glow border */}
      <div className="absolute inset-0 border border-[#f54900]/0 group-hover:border-[#f54900]/30 transition-colors duration-300 pointer-events-none" />
      <div className="absolute inset-0 shadow-none group-hover:shadow-[0_0_30px_rgba(245,73,0,0.08)] transition-shadow duration-300 pointer-events-none" />

      {/* Index number */}
      <span className="absolute top-4 right-4 text-white/10 text-xs font-mono">
        {String(index + 1).padStart(2, "0")}
      </span>

      {/* Icon */}
      <motion.div
        className="w-12 h-12 flex items-center justify-center bg-[#f54900]/10 mb-4"
        whileHover={{ rotate: 12, scale: 1.1 }}
        transition={{ type: "spring", stiffness: 300, damping: 15 }}
      >
        <Image src={icon} alt="" width={32} height={32} />
      </motion.div>

      {/* Content */}
      <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
      <p className="text-neutral-500 text-sm flex-grow">{description}</p>
    </motion.div>
  );
}
