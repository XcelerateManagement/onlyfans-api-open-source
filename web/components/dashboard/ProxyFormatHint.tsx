import { cn } from "@/lib/utils";

const FORMATS = ["http://", "socks5://", "host:port:user:pass"];

/**
 * Muted "supported formats" chip row shown under proxy inputs, so the
 * placeholder can stay a single clean example instead of enumerating
 * every accepted scheme.
 */
export function ProxyFormatHint({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px]",
        className,
      )}
    >
      <span className="uppercase tracking-wider text-default-500">
        Supports
      </span>
      {FORMATS.map((f) => (
        <code
          key={f}
          className="px-1.5 py-0.5 font-mono text-default-400 border border-white/[0.08] bg-white/[0.03]"
        >
          {f}
        </code>
      ))}
    </div>
  );
}
