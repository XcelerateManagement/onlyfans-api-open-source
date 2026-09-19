"use client";

import React from "react";
import { Popover, PopoverTrigger, PopoverContent } from "@heroui/popover";
import { cn } from "@/lib/utils";
import { PxPalette } from "@/components/ui/PixelIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import {
  useAppearance,
  COLOR_PRESETS,
  ASCII_MODES,
  type ColorPreset,
  type AsciiMode,
} from "@/lib/hooks/use-appearance";

const MODE_ICONS: Record<AsciiMode, string> = {
  wave: "~ ~",
  matrix: "| |",
  pulse: "(o)",
  spiral: "@ @",
};

export function AppearancePopover() {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const { accentColor, setAccentColor, backgroundMode, setBackgroundMode } = useAppearance();

  const handleColorClick = (color: ColorPreset, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setAccentColor(color, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const handleModeClick = (mode: AsciiMode, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setBackgroundMode(mode, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  const triggerButton = expanded ? (
    <Button
      variant="ghost"
      className="w-full justify-start gap-3 px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-white/[0.03] rounded-none"
    >
      <PxPalette className="h-5 w-5 shrink-0" />
      <span className="text-sm">Appearance</span>
    </Button>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 text-muted-foreground hover:text-foreground hover:bg-white/[0.03] rounded-none"
        >
          <PxPalette className="h-5 w-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Appearance</TooltipContent>
    </Tooltip>
  );

  return (
    <Popover placement="right" offset={12}>
      <PopoverTrigger>{triggerButton}</PopoverTrigger>
      <PopoverContent className="w-[260px] bg-[#0d0d0d] border border-white/[0.08] rounded-none p-0 shadow-2xl">
        <div className="p-4 space-y-4">
          {/* Theme Color Section */}
          <div>
            <p className="text-[10px] font-bold tracking-wider uppercase text-neutral-500 mb-3">
              Theme Color
            </p>
            <div className="grid grid-cols-4 gap-2">
              {COLOR_PRESETS.map((color) => {
                const isActive = accentColor.name === color.name;
                return (
                  <button
                    key={color.name}
                    onClick={(e) => handleColorClick(color, e)}
                    className={cn(
                      "group flex flex-col items-center gap-1.5 p-1.5 transition-all hover:bg-white/[0.03]",
                      isActive && "bg-white/[0.05]"
                    )}
                  >
                    <div
                      className={cn(
                        "w-7 h-7 transition-all",
                        isActive
                          ? "ring-2 ring-white/60 ring-offset-2 ring-offset-[#0d0d0d] scale-110"
                          : "group-hover:scale-105"
                      )}
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className="text-[9px] text-neutral-500 group-hover:text-neutral-300 transition-colors">
                      {color.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.06]" />

          {/* Background Pattern Section */}
          <div>
            <p className="text-[10px] font-bold tracking-wider uppercase text-neutral-500 mb-3">
              Background
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {ASCII_MODES.map((mode) => {
                const isActive = backgroundMode === mode.key;
                return (
                  <button
                    key={mode.key}
                    onClick={(e) => handleModeClick(mode.key, e)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 text-left transition-all",
                      isActive
                        ? "border text-foreground"
                        : "border border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-white/[0.03]"
                    )}
                    style={isActive ? {
                      borderColor: `rgba(var(--theme-accent-rgb, 245, 73, 0), 0.4)`,
                      backgroundColor: `rgba(var(--theme-accent-rgb, 245, 73, 0), 0.08)`,
                    } : undefined}
                  >
                    <span className="font-mono text-[10px] opacity-60 w-6 text-center">
                      {MODE_ICONS[mode.key]}
                    </span>
                    <span className="text-xs font-medium">{mode.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
