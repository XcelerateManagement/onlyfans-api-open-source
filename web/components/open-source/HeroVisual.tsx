import { Caveat } from "next/font/google";

import { CornerBrackets } from "@/components/ui/CornerBrackets";
import {
  ServerGlyph,
  CloudGlyph,
  CodeGlyph,
  DatabaseGlyph,
} from "@/components/open-source/icons";

/**
 * Hero composition for /open-source: a terminal window, four capability
 * cards wired to it, and a dashboard sliver peeking out from underneath.
 *
 * Server component — every layer is markup and CSS, no JS ships for it.
 *
 * Layering strategy, because this is an intricate composition:
 *   - The code window is IN FLOW. It is the one element that must survive at
 *     every width, so everything else is positioned relative to it.
 *   - The four cards, the connectors and the dashboard sliver are absolutely
 *     positioned and only appear at `xl` and up, where there is genuinely
 *     room. Below that the window stands alone, which reads as deliberate
 *     rather than broken.
 */

// Scoped to this component so the accent face is not loaded site-wide for a
// single line of text.
const fontScript = Caveat({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

/** Terminal syntax palette. Restrained: orange keywords carry the brand, one
 *  green for strings, one amber for literals. Anything more turns confetti. */
const T = {
  comment: "text-[#6b6560]",
  keyword: "text-[#f54900]",
  string: "text-[#7ec699]",
  literal: "text-[#f59e0b]",
  plain: "text-[#d6d3d1]",
  dim: "text-[#8a8580]",
};

function FloatingCard({
  icon,
  title,
  lines,
  className = "",
  delay = "0.4s",
  duration = "6s",
}: {
  icon: React.ReactNode;
  title: string;
  lines: [string, string];
  className?: string;
  /** Staggered so the four never drift in lockstep — in lockstep they read as
   *  a carousel rather than objects hanging in space. */
  delay?: string;
  duration?: string;
}) {
  // NOTE: no `relative` in the base classes. Every caller positions this with
  // `absolute`, and Tailwind emits `.relative` AFTER `.absolute` in its
  // stylesheet — same specificity, so a base `relative` would silently win and
  // drop the cards back into normal flow at full width. `absolute` already
  // establishes the containing block CornerBrackets needs.
  return (
    <div
      className={`hero-float w-max max-w-[15rem] rounded-2xl bg-[#100b08]/95 border border-[#f54900]/35 backdrop-blur-sm px-4 py-3.5 shadow-[0_0_28px_-6px_rgba(245,73,0,0.5),inset_0_0_20px_-14px_rgba(245,73,0,0.8)] ${className}`}
      style={
        {
          "--float-delay": delay,
          "--float-dur": duration,
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 grid place-items-center w-9 h-9 rounded-lg border border-[#f54900]/45 bg-[#f54900]/[0.08] text-[#f54900]">
          {icon}
        </span>
        <span className="text-[15px] font-semibold text-foreground whitespace-nowrap">
          {title}
        </span>
      </div>
      <p className="mt-2 pl-12 text-[11px] leading-snug text-default-400 whitespace-nowrap">
        {lines[0]}
        <br />
        {lines[1]}
      </p>
    </div>
  );
}

export function HeroVisual() {
  return (
    // Reserve the band above the window with PADDING, not a margin on the
    // window itself: the container has no border or padding of its own, so a
    // child's top margin collapses out of it and moves the whole container
    // down instead of making room inside it — which drops the script accent
    // straight onto the code.
    <div className="relative w-full select-none xl:pt-28" aria-hidden="true">
      {/* Ambient glow behind the whole composition */}
      <div className="pointer-events-none absolute -inset-16 opacity-60 [background:radial-gradient(ellipse_at_60%_40%,rgba(245,73,0,0.18),transparent_65%)]" />

      {/* Connectors. Deliberately NOT a stretched SVG — with
          preserveAspectRatio="none" over a fluid container the paths drift out
          of alignment with the cards at every width. These are plain divs
          pinned to the same coordinates the cards use, so they track them. */}
      <div className="pointer-events-none hidden xl:block">
        {/* Self-Host card down into the window */}
        <span className="absolute top-[4.5rem] left-[46%] h-[3.25rem] w-px bg-gradient-to-b from-[#f54900] to-transparent shadow-[0_0_10px_1px_rgba(245,73,0,0.7)]" />
        {/* Spine linking the three right-hand cards */}
        <span className="absolute top-[7rem] bottom-[14%] -right-[0.5rem] w-px bg-gradient-to-b from-[#f54900] via-[#f54900]/35 to-[#f54900] shadow-[0_0_10px_1px_rgba(245,73,0,0.55)]" />
      </div>

      {/* Handwritten accent — sits in the gap above the window, left of the
          first card. */}
      <p
        className={`${fontScript.className} pointer-events-none absolute top-1 left-0 hidden xl:block text-[#f54900] text-[1.7rem] leading-[1.1] -rotate-6 z-20`}
      >
        Build.
        <br />
        Automate.
        <br />
        Scale.
        <br />
        Your way.
        <span className="block mt-1 h-[2px] w-20 bg-[#f54900]/70" />
      </p>

      {/* Capability cards. Two sit above the window, two hang off its right
          edge in the page gutter — the window stays readable. */}
      <FloatingCard
        className="absolute top-0 left-[42%] hidden xl:block z-20"
        icon={<ServerGlyph className="w-[18px] h-[18px]" />}
        lines={["Your server", "Your rules"]}
        delay="0.35s"
        duration="6.5s"
        title="Self-Host"
      />
      <FloatingCard
        className="absolute top-14 -right-10 hidden xl:block z-20"
        icon={<CloudGlyph className="w-[18px] h-[18px]" />}
        lines={["Same software", "Anywhere"]}
        delay="0.55s"
        duration="7.4s"
        title="Cloud Ready"
      />
      <FloatingCard
        className="absolute top-[54%] -right-16 hidden xl:block z-20"
        icon={<CodeGlyph className="w-[18px] h-[18px]" />}
        lines={["200+ endpoints", "One API key"]}
        delay="0.75s"
        duration="5.8s"
        title="API"
      />
      <FloatingCard
        className="absolute top-[78%] -right-8 hidden xl:block z-20"
        icon={<DatabaseGlyph className="w-[18px] h-[18px]" />}
        lines={["Never leaves", "your disk"]}
        delay="0.95s"
        duration="6.9s"
        title="Your Data"
      />

      {/* ── The code window: the one element that survives every breakpoint.
             The top margin at xl reserves the band the script accent and the
             Self-Host card occupy. ── */}
      <div className="relative z-10 rounded-xl overflow-hidden bg-[#0c0a09]/95 border border-white/[0.1] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-sm">
        <CornerBrackets opacity={0.4} size={8} />

        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-2.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-xs text-default-500">
            onlyfans-api
          </span>
        </div>

        {/* Code body. Line numbers are a sibling column so the code can scroll
            horizontally on narrow screens without dragging them along. */}
        <div className="flex overflow-x-auto font-mono text-[11px] sm:text-xs leading-[1.9]">
          <div className="select-none border-r border-white/[0.06] px-3 py-4 text-right text-[#4a4643]">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <pre className="px-4 py-4 whitespace-pre">
            <code>
              <span className={T.comment}>
                {"// Your server. Your data. Your keys."}
              </span>
              {"\n"}
              <span className={T.keyword}>const</span>
              <span className={T.plain}> api </span>
              <span className={T.dim}>=</span>
              <span className={T.string}> &quot;http://localhost:5000&quot;</span>
              <span className={T.dim}>;</span>
              {"\n\n"}
              <span className={T.keyword}>const</span>
              <span className={T.plain}> res </span>
              <span className={T.dim}>=</span>
              <span className={T.keyword}> await</span>
              <span className={T.plain}> fetch</span>
              <span className={T.dim}>(</span>
              {"\n"}
              <span className={T.string}>
                {"  `${api}/api/crm/${crmId}/accounts`"}
              </span>
              <span className={T.dim}>,</span>
              {"\n"}
              <span className={T.dim}>{"  { headers: { "}</span>
              <span className={T.string}>&quot;X-API-Key&quot;</span>
              <span className={T.dim}>: </span>
              <span className={T.plain}>key</span>
              <span className={T.dim}>{" } }"}</span>
              {"\n"}
              <span className={T.dim}>);</span>
              {"\n\n"}
              <span className={T.keyword}>const</span>
              <span className={T.dim}>{" { accounts } = "}</span>
              <span className={T.keyword}>await</span>
              <span className={T.plain}> res</span>
              <span className={T.dim}>.</span>
              <span className={T.plain}>json</span>
              <span className={T.dim}>();</span>
              {"\n"}
              <span className={T.plain}>console</span>
              <span className={T.dim}>.</span>
              <span className={T.plain}>log</span>
              <span className={T.dim}>(</span>
              <span className={T.plain}>accounts</span>
              <span className={T.dim}>.</span>
              <span className={T.literal}>length</span>
              <span className={T.dim}>, </span>
              <span className={T.string}>&quot;on your box&quot;</span>
              <span className={T.dim}>);</span>
            </code>
          </pre>
        </div>
      </div>

      {/* Dashboard sliver, tucked under the window */}
      <div className="relative z-0 -mt-3 ml-6 mr-2 hidden lg:block rounded-xl overflow-hidden bg-[#0d0d0d]/95 border border-white/[0.08] backdrop-blur-sm">
        <div className="grid grid-cols-[120px_1fr]">
          {/* Sidebar */}
          <div className="border-r border-white/[0.06] p-3">
            <p className="text-[10px] font-semibold text-foreground leading-none">
              The Only API
            </p>
            <p className="text-[8px] text-default-500 mt-1 tracking-wider">
              SELF-HOSTED
            </p>
            <div className="mt-3 space-y-1.5">
              {["Dashboard", "Creators", "Automation", "Analytics"].map(
                (item, i) => (
                  <div
                    key={item}
                    className={`text-[9px] leading-none py-1 px-1.5 ${
                      i === 0
                        ? "text-[#f54900] bg-[#f54900]/10"
                        : "text-default-500"
                    }`}
                  >
                    {item}
                  </div>
                ),
              )}
            </div>
          </div>

          {/* Panel */}
          <div className="p-3">
            <p className="text-[10px] font-semibold text-foreground">
              Creator Operations
            </p>
            <div className="mt-2 grid grid-cols-[1fr_120px] gap-3">
              {/* Sparkline */}
              <svg
                className="h-12 w-full text-[#f54900]"
                fill="none"
                preserveAspectRatio="none"
                viewBox="0 0 200 48"
              >
                <path
                  d="M0 40 L30 34 L60 36 L90 22 L120 26 L150 12 L200 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M0 40 L30 34 L60 36 L90 22 L120 26 L150 12 L200 6 L200 48 L0 48 Z"
                  fill="currentColor"
                  opacity="0.12"
                />
              </svg>
              {/* Stats */}
              <div className="space-y-1">
                {[
                  ["Accounts", "248"],
                  ["API calls", "1.2M"],
                  ["Polling", "Active"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between text-[9px]"
                  >
                    <span className="text-default-500">{label}</span>
                    <span className="text-foreground tabular-nums">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Closing stamp */}
      <p className="absolute -bottom-12 right-0 hidden xl:block text-[10px] font-semibold tracking-[0.2em] leading-tight text-default-500 text-right">
        SAME
        <br />
        SOFTWARE.
        <br />
        MORE
        <br />
        FREEDOM.
        <span className="block mt-2 ml-auto h-[2px] w-10 bg-[#f54900]" />
      </p>
    </div>
  );
}
