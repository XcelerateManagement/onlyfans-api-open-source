"use client";

import { useId } from "react";

export type PatternType =
  | "dots"
  | "waves"
  | "hexagon"
  | "circuit"
  | "grid"
  | "rings"
  | "crosshatch"
  | "triangles"
  | "stars"
  | "bubbles"
  | "diagonalStripes"
  | "zigzag"
  | "moroccan"
  | "checkerboard";

interface PatternBackgroundProps {
  pattern: PatternType;
  className?: string;
}

export function PatternBackground({ pattern, className }: PatternBackgroundProps) {
  const uniqueId = useId().replace(/:/g, "");
  const svgClass = `absolute inset-0 w-full h-full pointer-events-none ${className || ""}`;

  const patternMap: Record<PatternType, React.ReactNode> = {
    dots: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`dots-${uniqueId}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="currentColor" className="text-accent" opacity="0.04" />
            <circle cx="12" cy="12" r="1" fill="currentColor" className="text-accent" opacity="0.04" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#dots-${uniqueId})`} />
      </svg>
    ),
    waves: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`waves-${uniqueId}`} x="0" y="0" width="40" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 4 Q 10 0 20 4 Q 30 8 40 4" stroke="currentColor" className="text-accent" strokeWidth="0.5" fill="none" opacity="0.04" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#waves-${uniqueId})`} />
      </svg>
    ),
    hexagon: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`hexagon-${uniqueId}`} x="0" y="0" width="30" height="26" patternUnits="userSpaceOnUse">
            <polygon points="15,1 27,7 27,19 15,25 3,19 3,7" fill="none" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.04" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#hexagon-${uniqueId})`} />
      </svg>
    ),
    circuit: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`circuit-${uniqueId}`} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 20 h10 m5 0 h5 m5 0 h15 M20 0 v10 m0 5 v5 m0 5 v15" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.04" />
            <circle cx="20" cy="20" r="2" fill="currentColor" className="text-accent" opacity="0.05" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#circuit-${uniqueId})`} />
      </svg>
    ),
    grid: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`grid-${uniqueId}`} x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.03" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#grid-${uniqueId})`} />
      </svg>
    ),
    rings: (
      <svg className={svgClass}>
        <g transform="translate(80%, 30%)">
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx="0"
              cy="0"
              r={20 + i * 15}
              fill="none"
              stroke="currentColor"
              className="text-accent"
              strokeWidth="0.5"
              opacity={0.04 - i * 0.01}
            />
          ))}
        </g>
      </svg>
    ),
    crosshatch: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`crosshatch-${uniqueId}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M0,0 L20,20 M20,0 L0,20" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.03" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#crosshatch-${uniqueId})`} />
      </svg>
    ),
    triangles: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`triangles-${uniqueId}`} x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <polygon points="20,5 35,30 5,30" fill="none" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.04" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#triangles-${uniqueId})`} />
      </svg>
    ),
    stars: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`stars-${uniqueId}`} x="0" y="0" width="50" height="50" patternUnits="userSpaceOnUse">
            <path
              d="M25,10 L28,20 L38,20 L30,26 L33,36 L25,30 L17,36 L20,26 L12,20 L22,20 Z"
              fill="none"
              stroke="currentColor"
              className="text-accent"
              strokeWidth="0.5"
              opacity="0.04"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#stars-${uniqueId})`} />
      </svg>
    ),
    bubbles: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`bubbles-${uniqueId}`} x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
            <circle cx="15" cy="60" r="8" fill="currentColor" className="text-accent" opacity="0.03" />
            <circle cx="50" cy="40" r="12" fill="currentColor" className="text-accent" opacity="0.02" />
            <circle cx="70" cy="15" r="6" fill="currentColor" className="text-accent" opacity="0.03" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#bubbles-${uniqueId})`} />
      </svg>
    ),
    diagonalStripes: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`diagonal-${uniqueId}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="20" stroke="currentColor" className="text-accent" strokeWidth="1" opacity="0.03" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#diagonal-${uniqueId})`} />
      </svg>
    ),
    zigzag: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`zigzag-${uniqueId}`} x="0" y="0" width="60" height="20" patternUnits="userSpaceOnUse">
            <path
              d="M0,10 L15,0 L30,10 L45,0 L60,10 L60,20 L45,10 L30,20 L15,10 L0,20 Z"
              fill="currentColor"
              className="text-accent"
              opacity="0.02"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#zigzag-${uniqueId})`} />
      </svg>
    ),
    moroccan: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`moroccan-${uniqueId}`} x="0" y="0" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M30,0 L45,15 L30,30 L15,15 Z" fill="none" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.03" />
            <circle cx="30" cy="15" r="8" fill="none" stroke="currentColor" className="text-accent" strokeWidth="0.5" opacity="0.03" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#moroccan-${uniqueId})`} />
      </svg>
    ),
    checkerboard: (
      <svg className={svgClass}>
        <defs>
          <pattern id={`checker-${uniqueId}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="10" height="10" fill="currentColor" className="text-accent" opacity="0.02" />
            <rect x="10" y="10" width="10" height="10" fill="currentColor" className="text-accent" opacity="0.02" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#checker-${uniqueId})`} />
      </svg>
    ),
  };

  return <>{patternMap[pattern]}</>;
}
