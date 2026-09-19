"use client";

/** Horizontal rule with a centered uppercase pill — groups messages by day. */
export function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-3 select-none">
      <span className="flex-1 h-px bg-white/[0.06]" aria-hidden />
      <span className="text-[10px] uppercase tracking-wider text-default-500 font-semibold px-2 py-0.5 bg-black/40 border border-white/[0.06]">
        {label}
      </span>
      <span className="flex-1 h-px bg-white/[0.06]" aria-hidden />
    </div>
  );
}
