"use client";

import { ReactNode, useEffect, useRef } from "react";
import { Input } from "@heroui/input";
import { Button } from "@heroui/button";

import { PxSearch } from "@/components/ui/PixelIcons";

/**
 * Reusable filter toolbar extracted from the Fans page pattern: a debounced-by-
 * the-caller search Input with a "/" focus shortcut, arbitrary filter/sort slots
 * (children), and a Clear button shown when any filter is active.
 *
 * Debouncing stays in the page (pass the raw value + setter); this component is
 * purely presentational + the "/" shortcut wiring so every data page gets the
 * same affordance and muscle memory.
 */
export function DataTableToolbar({
  search,
  onSearch,
  searchPlaceholder = 'Search (press "/")',
  onClear,
  showClear = false,
  children,
  className = "",
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;
  /** Reset handler; the Clear button is only rendered when showClear is true. */
  onClear?: () => void;
  showClear?: boolean;
  /** Filter/sort controls (e.g. <Select>) rendered after the search box. */
  children?: ReactNode;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search box, unless the user is already typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Input
        ref={inputRef}
        placeholder={searchPlaceholder}
        value={search}
        onValueChange={onSearch}
        startContent={<PxSearch className="h-4 w-4 text-default-400" />}
        size="sm"
        variant="bordered"
        classNames={{
          inputWrapper: "bg-black/20 border-white/[0.08] !rounded-none",
        }}
        className="max-w-xs"
      />
      {children}
      {showClear && onClear && (
        <Button size="sm" variant="flat" radius="none" onPress={onClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
