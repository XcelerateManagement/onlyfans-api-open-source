"use client";

import { Card, CardHeader, CardBody, CardFooter } from "@heroui/card";
import { motion } from "framer-motion";
import clsx from "clsx";

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  isHoverable?: boolean;
  isPressable?: boolean;
  variant?: "default" | "elevated" | "subtle" | "glow";
  onPress?: () => void;
}

const variants = {
  default: "glass-card",
  elevated: "glass-elevated",
  subtle: "glass-subtle",
  glow: "glass-card glass-glow",
};

export function GlassCard({
  children,
  className,
  isHoverable = true,
  isPressable = false,
  variant = "default",
  onPress,
}: GlassCardProps) {
  return (
    <motion.div
      whileHover={isHoverable ? { y: -6, scale: 1.015 } : undefined}
      whileTap={isPressable ? { scale: 0.98 } : undefined}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={clsx(
        "h-full relative group/card",
        isHoverable && "card-press-mobile",
        isPressable && "mobile-interactive"
      )}
    >
      {/* Subtle glow effect on hover */}
      {isHoverable && (
        <div className="absolute -inset-1 bg-gradient-to-r from-primary-500/0 via-primary-500/5 to-brand-500/0 rounded-2xl blur-xl opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none" />
      )}
      <Card
        className={clsx(variants[variant], "h-full relative overflow-hidden", className)}
        isPressable={isPressable}
        onPress={onPress}
      >
        {/* Shimmer effect on hover */}
        {isHoverable && (
          <div className="absolute inset-0 opacity-0 group-hover/card:opacity-100 transition-opacity duration-500 pointer-events-none overflow-hidden">
            <div className="absolute inset-0 -translate-x-full group-hover/card:translate-x-full transition-transform duration-1000 ease-out bg-gradient-to-r from-transparent via-white/5 to-transparent" />
          </div>
        )}
        {children}
      </Card>
    </motion.div>
  );
}

export function GlassCardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <CardHeader className={className}>{children}</CardHeader>;
}

export function GlassCardBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <CardBody className={className}>{children}</CardBody>;
}

export function GlassCardFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <CardFooter className={className}>{children}</CardFooter>;
}
