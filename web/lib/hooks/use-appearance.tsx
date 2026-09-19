"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

export type AsciiMode = "wave" | "matrix" | "pulse" | "spiral";

export interface ColorPreset {
  name: string;
  hex: string;
  hoverHex: string;
}

export const COLOR_PRESETS: ColorPreset[] = [
  { name: "Orange", hex: "#f54900", hoverHex: "#ff7a30" },
  { name: "Blue", hex: "#3b82f6", hoverHex: "#60a5fa" },
  { name: "Green", hex: "#22c55e", hoverHex: "#4ade80" },
  { name: "Purple", hex: "#8b5cf6", hoverHex: "#a78bfa" },
  { name: "Red", hex: "#ef4444", hoverHex: "#f87171" },
  { name: "Cyan", hex: "#06b6d4", hoverHex: "#22d3ee" },
  { name: "Pink", hex: "#ec4899", hoverHex: "#f472b6" },
  { name: "Amber", hex: "#f59e0b", hoverHex: "#fbbf24" },
];

export const ASCII_MODES: { key: AsciiMode; label: string }[] = [
  { key: "wave", label: "Wave" },
  { key: "matrix", label: "Matrix" },
  { key: "pulse", label: "Pulse" },
  { key: "spiral", label: "Spiral" },
];

interface TransitionOrigin {
  x: number;
  y: number;
  color: string;
}

interface AppearanceContextType {
  accentColor: ColorPreset;
  setAccentColor: (color: ColorPreset, origin?: { x: number; y: number }) => void;
  backgroundMode: AsciiMode;
  setBackgroundMode: (mode: AsciiMode, origin?: { x: number; y: number }) => void;
  transition: TransitionOrigin | null;
  clearTransition: () => void;
}

const AppearanceContext = createContext<AppearanceContextType>({
  accentColor: COLOR_PRESETS[0],
  setAccentColor: () => {},
  backgroundMode: "wave",
  setBackgroundMode: () => {},
  transition: null,
  clearTransition: () => {},
});

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

function hexToRgbSpaced(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function applyColorVars(color: ColorPreset) {
  const el = document.querySelector<HTMLElement>(".dashboard-context");
  if (!el) return;
  el.style.setProperty("--theme-accent", color.hex);
  el.style.setProperty("--theme-accent-rgb", hexToRgb(color.hex));
  el.style.setProperty("--theme-accent-tw", hexToRgbSpaced(color.hex));
  el.style.setProperty("--theme-accent-hover", color.hoverHex);
  el.style.setProperty("--theme-accent-hover-rgb", hexToRgb(color.hoverHex));
  el.style.setProperty("--theme-accent-hover-tw", hexToRgbSpaced(color.hoverHex));
  el.style.setProperty("--theme-accent-dark", darkenHex(color.hex, 0.15));
}

const STORAGE_KEY = "dashboard-appearance";

interface StoredAppearance {
  colorName: string;
  backgroundMode: AsciiMode;
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [accentColor, setAccentColorState] = useState<ColorPreset>(COLOR_PRESETS[0]);
  const [backgroundMode, setBackgroundModeState] = useState<AsciiMode>("wave");
  const [transition, setTransition] = useState<TransitionOrigin | null>(null);
  const initialized = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredAppearance = JSON.parse(stored);
        const color = COLOR_PRESETS.find((c) => c.name === parsed.colorName) || COLOR_PRESETS[0];
        setAccentColorState(color);
        setBackgroundModeState(parsed.backgroundMode || "wave");
        applyColorVars(color);
      }
    } catch {}
    initialized.current = true;
  }, []);

  const persist = useCallback((color: ColorPreset, mode: AsciiMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ colorName: color.name, backgroundMode: mode }));
    } catch {}
  }, []);

  const setAccentColor = useCallback(
    (color: ColorPreset, origin?: { x: number; y: number }) => {
      if (origin) {
        setTransition({ x: origin.x, y: origin.y, color: color.hex });
      }
      setAccentColorState(color);
      applyColorVars(color);
      persist(color, backgroundMode);
    },
    [backgroundMode, persist]
  );

  const setBackgroundMode = useCallback(
    (mode: AsciiMode, origin?: { x: number; y: number }) => {
      if (origin) {
        setTransition({ x: origin.x, y: origin.y, color: accentColor.hex });
      }
      setBackgroundModeState(mode);
      persist(accentColor, mode);
    },
    [accentColor, persist]
  );

  const clearTransition = useCallback(() => setTransition(null), []);

  return (
    <AppearanceContext.Provider
      value={{ accentColor, setAccentColor, backgroundMode, setBackgroundMode, transition, clearTransition }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}

export const useAppearance = () => useContext(AppearanceContext);
