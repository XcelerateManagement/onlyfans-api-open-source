"use client";

interface SparklineProps {
  data: number[];
  /** Accepts px number or CSS string ("100%"). Defaults to 160. */
  width?: number | string;
  height?: number;
  strokeWidth?: number;
  color?: string;
  fill?: boolean;
}

/** Lightweight inline-SVG sparkline — no chart library. Uses viewBox so the
 * stroke scales cleanly when the container's width is fluid (e.g. "100%"). */
export function Sparkline({
  data,
  width = 160,
  height = 40,
  strokeWidth = 1.5,
  color = "var(--theme-accent, #f54900)",
  fill = true,
}: SparklineProps) {
  // Use a fixed internal coordinate space so the SVG scales responsively
  const VB_W = 200;
  if (!data.length) {
    return (
      <svg
        viewBox={`0 0 ${VB_W} ${height}`}
        width={width}
        height={height}
        preserveAspectRatio="none"
        aria-hidden
      />
    );
  }
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const step = data.length > 1 ? VB_W / (data.length - 1) : VB_W;
  const pts = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const areaPts = `0,${height} ${pts} ${(data.length - 1) * step},${height}`;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      aria-hidden
    >
      {fill && <polygon points={areaPts} fill={color} opacity={0.12} />}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
