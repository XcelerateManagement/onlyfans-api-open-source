"use client";

import { cn } from "@/lib/utils";

/** Basic shimmer block. Use it directly or via the list helpers below. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn("relative overflow-hidden bg-white/[0.03]", className)}
      style={style}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
      <style jsx>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}

/** Renders ``n`` stacked shimmer rows for list-like layouts. */
export function SkeletonList({ rows = 6, rowHeight = 56 }: { rows?: number; rowHeight?: number }) {
  return (
    <div className="divide-y divide-white/[0.04]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4" style={{ height: rowHeight }}>
          <Skeleton className="h-8 w-8 rounded-none shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}
