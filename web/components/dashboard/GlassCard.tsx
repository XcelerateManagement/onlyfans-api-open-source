"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CornerBrackets } from "@/components/ui/CornerBrackets";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  animate?: boolean;
  delay?: number;
  pattern?: string;
}

export function GlassCard({
  children,
  className,
  hover = true,
  animate = true,
  delay = 0,
}: GlassCardProps) {
  const cardContent = (
    <div
      className={cn(
        "relative overflow-hidden",
        "bg-[#0d0d0d] border border-white/[0.06]",
        hover && "group transition-colors duration-300 hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.2)]",
        className
      )}
    >
      <CornerBrackets size={8} />
      <div className="relative flex-1 flex flex-col">{children}</div>
    </div>
  );

  if (animate) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay }}
        className="h-full"
      >
        {cardContent}
      </motion.div>
    );
  }

  return cardContent;
}

interface GlassCardHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassCardHeader({ children, className }: GlassCardHeaderProps) {
  return (
    <div className={cn("px-5 py-4 border-b border-white/[0.06]", className)}>
      {children}
    </div>
  );
}

interface GlassCardBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassCardBody({ children, className }: GlassCardBodyProps) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

interface GlassIconBoxProps {
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function GlassIconBox({ children, className, size = "md" }: GlassIconBoxProps) {
  const sizeClasses = {
    sm: "h-8 w-8 p-1.5",
    md: "h-12 w-12 p-2",
    lg: "h-16 w-16 p-3",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        "border border-white/[0.08]",
        sizeClasses[size],
        className
      )}
      style={{
        backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)",
        color: "var(--theme-accent, #f54900)",
      }}
    >
      {children}
    </div>
  );
}
