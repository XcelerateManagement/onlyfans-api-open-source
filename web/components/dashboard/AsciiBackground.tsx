"use client";

import { useRef, useEffect } from "react";
import type { AsciiMode } from "@/lib/hooks/use-appearance";

const ASCII_CHARS = [
  ".", "·", "+", "×", "*", ":", ";", "=", "#", "@",
  "░", "▒", "▓", "█", "◊", "○", "●", "□", "■", "△",
];

interface AsciiBackgroundProps {
  mode?: AsciiMode;
}

export function AsciiBackground({ mode = "wave" }: AsciiBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const matrixColumnsRef = useRef<Float64Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Reset matrix columns on resize
      matrixColumnsRef.current = null;
    }

    resize();

    const handleResize = () => {
      clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = setTimeout(resize, 150);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);

    const spacing = window.innerWidth < 768 ? 24 : 18;
    const fontSize = window.innerWidth < 768 ? 11 : 9;

    // Read accent color from CSS variable
    function getAccentRgb(): [number, number, number] {
      const el = document.querySelector(".dashboard-context") as HTMLElement | null;
      if (!el) return [255, 255, 255];
      const val = getComputedStyle(el).getPropertyValue("--theme-accent-rgb").trim();
      if (!val) return [255, 255, 255];
      const parts = val.split(",").map((s) => parseInt(s.trim(), 10));
      if (parts.length === 3 && parts.every((n) => !isNaN(n))) return parts as [number, number, number];
      return [255, 255, 255];
    }

    function renderWave(time: number) {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = time * 0.001;

      ctx.clearRect(0, 0, w, h);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const cols = Math.ceil(w / spacing) + 1;
      const rows = Math.ceil(h / spacing) + 1;

      for (let row = 0; row < rows; row++) {
        const y = row * spacing;
        for (let col = 0; col < cols; col++) {
          const x = col * spacing;

          let waveVal = 0;
          if (!prefersReducedMotion) {
            waveVal =
              Math.sin(x * 0.015 + t * 0.4) * 0.35 +
              Math.sin(y * 0.02 + t * 0.3) * 0.25 +
              Math.sin((x + y) * 0.01 + t * 0.5) * 0.2 +
              Math.sin(x * 0.008 - y * 0.012 + t * 0.2) * 0.2;
            waveVal = (waveVal + 1) * 0.5;
          } else {
            waveVal = 0.3;
          }

          const opacity = Math.min(0.18, 0.04 + waveVal * 0.12);
          const charIdx = Math.min(
            ASCII_CHARS.length - 1,
            Math.floor(waveVal * ASCII_CHARS.length * 0.5)
          );

          ctx.fillStyle = `rgba(255,255,255,${opacity})`;
          ctx.fillText(ASCII_CHARS[charIdx], x, y);
        }
      }
    }

    function renderMatrix(time: number) {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = time * 0.001;

      const cols = Math.ceil(w / spacing);
      const rows = Math.ceil(h / spacing);

      // Initialize matrix columns with random positions
      if (!matrixColumnsRef.current || matrixColumnsRef.current.length !== cols) {
        matrixColumnsRef.current = new Float64Array(cols);
        for (let i = 0; i < cols; i++) {
          matrixColumnsRef.current[i] = Math.random() * rows;
        }
      }

      // Semi-transparent clear for trail effect
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const [ar, ag, ab] = getAccentRgb();

      for (let col = 0; col < cols; col++) {
        const x = col * spacing;
        const speed = 0.5 + (col % 5) * 0.3;
        matrixColumnsRef.current[col] += speed * 0.06;

        if (matrixColumnsRef.current[col] > rows + 8) {
          matrixColumnsRef.current[col] = -Math.random() * 10;
        }

        const headRow = matrixColumnsRef.current[col];
        const tailLength = 8 + (col % 6);

        for (let i = 0; i < tailLength; i++) {
          const row = Math.floor(headRow) - i;
          if (row < 0 || row >= rows) continue;
          const y = row * spacing;

          const fade = 1 - i / tailLength;
          const opacity = fade * 0.2;
          const charIdx = Math.floor(
            (Math.sin(col * 7.3 + row * 3.1 + t) * 0.5 + 0.5) * ASCII_CHARS.length * 0.5
          );

          if (i === 0) {
            ctx.fillStyle = `rgba(${ar},${ag},${ab},${Math.min(0.35, opacity + 0.15)})`;
          } else {
            ctx.fillStyle = `rgba(255,255,255,${opacity})`;
          }
          ctx.fillText(
            ASCII_CHARS[Math.min(charIdx, ASCII_CHARS.length - 1)],
            x,
            y
          );
        }
      }
    }

    function renderPulse(time: number) {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = time * 0.001;

      ctx.clearRect(0, 0, w, h);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const cx = w / 2;
      const cy = h / 2;
      const maxDist = Math.sqrt(cx * cx + cy * cy);
      const cols = Math.ceil(w / spacing) + 1;
      const rows = Math.ceil(h / spacing) + 1;

      for (let row = 0; row < rows; row++) {
        const y = row * spacing;
        for (let col = 0; col < cols; col++) {
          const x = col * spacing;

          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const normDist = dist / maxDist;

          let waveVal = 0;
          if (!prefersReducedMotion) {
            // Multiple concentric rings expanding outward
            waveVal =
              Math.sin(dist * 0.04 - t * 1.8) * 0.4 +
              Math.sin(dist * 0.02 - t * 0.9) * 0.3 +
              Math.sin(dist * 0.06 - t * 2.5) * 0.2;
            waveVal = (waveVal + 1) * 0.5;
            // Fade with distance
            waveVal *= 1 - normDist * 0.5;
          } else {
            waveVal = 0.3;
          }

          const opacity = Math.min(0.2, 0.03 + waveVal * 0.14);
          const charIdx = Math.min(
            ASCII_CHARS.length - 1,
            Math.floor(waveVal * ASCII_CHARS.length * 0.6)
          );

          ctx.fillStyle = `rgba(255,255,255,${opacity})`;
          ctx.fillText(ASCII_CHARS[charIdx], x, y);
        }
      }
    }

    function renderSpiral(time: number) {
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const t = time * 0.001;

      ctx.clearRect(0, 0, w, h);
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const cx = w / 2;
      const cy = h / 2;
      const cols = Math.ceil(w / spacing) + 1;
      const rows = Math.ceil(h / spacing) + 1;

      for (let row = 0; row < rows; row++) {
        const y = row * spacing;
        for (let col = 0; col < cols; col++) {
          const x = col * spacing;

          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          let waveVal = 0;
          if (!prefersReducedMotion) {
            // Spiral: combine angle and distance with time rotation
            waveVal =
              Math.sin(angle * 3 + dist * 0.02 - t * 1.2) * 0.35 +
              Math.sin(angle * 5 - dist * 0.015 + t * 0.8) * 0.25 +
              Math.sin(dist * 0.03 + t * 0.5) * 0.2 +
              Math.cos(angle * 2 + t * 0.6) * 0.2;
            waveVal = (waveVal + 1) * 0.5;
          } else {
            waveVal = 0.3;
          }

          const opacity = Math.min(0.18, 0.04 + waveVal * 0.12);
          const charIdx = Math.min(
            ASCII_CHARS.length - 1,
            Math.floor(waveVal * ASCII_CHARS.length * 0.5)
          );

          ctx.fillStyle = `rgba(255,255,255,${opacity})`;
          ctx.fillText(ASCII_CHARS[charIdx], x, y);
        }
      }
    }

    const renderFn =
      mode === "matrix" ? renderMatrix :
      mode === "pulse" ? renderPulse :
      mode === "spiral" ? renderSpiral :
      renderWave;

    function render(time: number) {
      renderFn(time);
      if (!prefersReducedMotion) {
        rafRef.current = requestAnimationFrame(render);
      }
    }

    if (prefersReducedMotion) {
      render(0);
    } else {
      rafRef.current = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(resizeTimerRef.current);
      resizeObserver.disconnect();
    };
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
      aria-hidden="true"
    />
  );
}
