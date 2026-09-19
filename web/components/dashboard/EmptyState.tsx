"use client";

import { motion } from "framer-motion";
import { Button } from "@heroui/button";
import { cn } from "@/lib/utils";
import { CornerBrackets } from "@/components/ui/CornerBrackets";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  pattern?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={cn(
        "relative overflow-hidden flex flex-col items-center justify-center py-16 text-center",
        "bg-[#0d0d0d] border border-white/[0.06]",
        className
      )}
    >
      <CornerBrackets size={8} />
      <div className="relative z-10 mb-4">
        <div className="flex h-16 w-16 items-center justify-center bg-white/[0.03] border border-white/[0.08]">
          <div className="text-muted-foreground/60">
            {icon}
          </div>
        </div>
      </div>

      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-default-500 max-w-sm">{description}</p>

      {actionLabel && onAction && (
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="mt-4"
        >
          <Button
            className="text-white rounded-none uppercase tracking-wider font-bold dashboard-btn-primary"
            onPress={onAction}
          >
            {actionLabel}
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
