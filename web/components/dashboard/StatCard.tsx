"use client";

import { motion } from "framer-motion";
import { Card, CardBody } from "@heroui/card";
import { cn } from "@/lib/utils";
import { CornerBrackets } from "@/components/ui/CornerBrackets";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  className?: string;
  pattern?: string;
}

export function StatCard({ label, value, icon, trend, className }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card
        className={cn(
          "relative group transition-colors duration-300 overflow-hidden hover:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.2)]",
          "bg-[#0d0d0d] border border-white/[0.06] rounded-none shadow-none",
          className
        )}
      >
        <CornerBrackets size={8} />
        <CardBody className="relative flex flex-row items-center gap-4 p-5">
          <div className="relative">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center border border-white/[0.08]" style={{ backgroundColor: "rgba(var(--theme-accent-rgb, 245, 73, 0), 0.1)", color: "var(--theme-accent, #f54900)" }}>
              {icon}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm text-default-500 font-medium">{label}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {trend && (
              <p className="text-xs text-default-400 mt-0.5">{trend}</p>
            )}
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}
