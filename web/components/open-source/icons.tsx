/**
 * Line glyphs for /open-source.
 *
 * Deliberately NOT the site's PixelIcons: this page's hero uses outlined
 * stroke icons (1.5px, square caps) to match the approved design. Shared
 * between the capability strip in the page and the floating cards in
 * HeroVisual so the two never drift apart.
 *
 * All of them inherit `currentColor` and expect a size class from the caller.
 */

type GlyphProps = { className?: string };

const base = {
  "aria-hidden": true as const,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "square" as const,
  strokeLinejoin: "miter" as const,
  strokeWidth: 1.5,
  viewBox: "0 0 24 24",
};

/** Padlock — "your data stays yours". */
export function LockGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <rect height="10" rx="1" width="14" x="5" y="11" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
      <path d="M12 15v2" />
    </svg>
  );
}

/** Isometric cube — "self-hosted or cloud", a unit you can pick up and move. */
export function CubeGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <path d="M12 2.5 21 7v10l-9 4.5L3 17V7l9-4.5Z" />
      <path d="M3 7l9 4.5L21 7" />
      <path d="M12 11.5V21.5" />
    </svg>
  );
}

/** Lightning bolt — "scalable operations". Filled: it is the one glyph in the
 *  strip that should read as energy rather than structure. */
export function BoltGlyph({ className = "" }: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M13.5 2 4 13.5h6L9.5 22 20 10.5h-6.5L13.5 2Z" />
    </svg>
  );
}

/** Stacked rack units — "self-host" / "secure automation". */
export function ServerGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <rect height="7" rx="1" width="18" x="3" y="3.5" />
      <rect height="7" rx="1" width="18" x="3" y="13.5" />
      <path d="M6.5 7h.01M6.5 17h.01" />
    </svg>
  );
}

/** Cloud — "cloud ready". */
export function CloudGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <path d="M6.5 18.5h10.5a3.75 3.75 0 0 0 .4-7.48A6 6 0 0 0 6.6 11.5a3.5 3.5 0 0 0-.1 7Z" />
    </svg>
  );
}

/** Angle brackets — "API". */
export function CodeGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5" />
    </svg>
  );
}

/** Stacked cylinder — "your data". */
export function DatabaseGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" />
      <path d="M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Plate glyphs — the four "manufacturing line" blocks.
 *
 * Stroke-only and deliberately concept-specific rather than a generic
 * lock/shield/bolt set: each one draws the mechanism its plate argues about.
 *
 * Path order is meaningful. Every glyph is written structure-first and
 * verdict-last so a `stroke-dashoffset` draw-on has a real final beat — the
 * check, the floor, the commits, the flat line. Each path carries
 * `pathLength={1}` so a draw-on can dash from 1 → 0 without measuring
 * geometry, which is what makes these safe to animate at any size.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Source gutter, code lines, and a check struck in the gutter — reading the
 *  code line by line and signing it off. Plate 01, "auditable". */
export function AuditGutterGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <path d="M6.5 3v18" pathLength={1} />
      <path d="M9.5 6.5h11M9.5 10.5h7.5M9.5 14.5h9.5M9.5 18.5h5" pathLength={1} />
      <path d="m2.5 10.25 1.6 1.6L6.4 8.6" pathLength={1} />
    </svg>
  );
}

/** A cylinder emptying downward onto a floor rule that arrives last — rows
 *  leaving our shape and landing on your disk. Plate 02, "your rows outlive us". */
export function DiskRetentionGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <ellipse cx="12" cy="4.75" pathLength={1} rx="6.25" ry="2.25" />
      <path
        d="M5.75 4.75v4.75c0 1.24 2.8 2.25 6.25 2.25s6.25-1.01 6.25-2.25V4.75"
        pathLength={1}
      />
      <path d="M12 12v6.25" pathLength={1} />
      <path d="m8.6 15.4 3.4 3.4 3.4-3.4" pathLength={1} />
      <path d="M3.5 21.5h17" pathLength={1} />
    </svg>
  );
}

/** Trunk, a branch that leaves and merges back, square commits — the ecosystem
 *  drawn as the mechanism that produces it. Plate 03.
 *
 *  The two rects should scale in rather than draw: a stroked rectangle
 *  animating its dash offset reads as a wobble, not a commit. */
export function ForkMergeGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <path d="M7 2.5v19" pathLength={1} />
      <path d="M7 7.5h5.25a3.25 3.25 0 0 1 3.25 3.25v1.5" pathLength={1} />
      <path d="M15.5 15.5v1.25A3.25 3.25 0 0 1 12.25 20H7" pathLength={1} />
      <rect height="3" width="3" x="5.5" y="12" />
      <rect height="3" width="3" x="14" y="12.25" />
    </svg>
  );
}

/** An axis, a rising credit staircase, and a flat line straight through it —
 *  the pricing argument itself rather than a coin or a tag. Plate 04.
 *
 *  The flat line is last and is the only stroke that reaches the right edge. */
export function FlatRateGlyph({ className = "" }: GlyphProps) {
  return (
    <svg className={className} {...base}>
      <path d="M3.5 2.5v18h17" pathLength={1} />
      <path d="M6 17.5h3v-3.5h3v-3.5h3V7h3V4" pathLength={1} />
      <path d="M4.5 13.5h17" pathLength={1} />
    </svg>
  );
}
