"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@heroui/button";
import { Tooltip } from "@heroui/tooltip";
import {
  PxKey,
  PxEye,
  PxLock,
  PxCopy,
  PxCheck,
} from "@/components/ui/PixelIcons";

// 60s gives the user time to actually paste into a config file. 30s was
// too aggressive — token disappeared mid-paste on a slow editor.
const DEFAULT_REVEAL_DURATION = 60;

function defaultMask(value: string): string {
  if (!value) return "••••••••••••••••";
  if (value.length <= 8) return "•".repeat(value.length);
  return `${value.slice(0, 3)}${"•".repeat(10)}${value.slice(-3)}`;
}

interface SecretFieldProps {
  /** Pixel-icon label header (e.g. "Key", "Bearer Token"). */
  label?: string;
  /** The secret string itself. Empty string disables reveal/copy. */
  value: string;
  /** Optional masking function. Defaults to first 3 + dots + last 3. */
  mask?: (value: string) => string;
  /** Seconds after reveal before auto-hiding. Default 30. */
  revealDurationSec?: number;
  /** Optional copy button id used to disambiguate copy feedback when several
   * SecretField instances live in one parent. */
  copyId?: string;
}

/**
 * Reveal/auto-hide secret display with copy-to-clipboard.
 * Single source of truth for the 30-second reveal contract used by both
 * ApiKeyWidget (Overview page) and the MCP setup page.
 */
export function SecretField({
  label = "Secret",
  value,
  mask = defaultMask,
  revealDurationSec = DEFAULT_REVEAL_DURATION,
}: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(revealDurationSec);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hide = useCallback(() => {
    setRevealed(false);
    setSecondsLeft(revealDurationSec);
    if (timerRef.current) clearInterval(timerRef.current);
  }, [revealDurationSec]);

  useEffect(() => {
    if (!revealed) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          hide();
          return revealDurationSec;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [revealed, hide, revealDurationSec]);

  const onCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const progressPct = (secondsLeft / revealDurationSec) * 100;
  const displayed = revealed ? value : mask(value);

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5 text-default-500">
        <PxKey className="h-3 w-3" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-stretch gap-1.5">
        <div className="relative flex-1 min-w-0 bg-black/40 border border-white/[0.08] px-2.5 py-2 font-mono text-xs overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.span
              key={revealed ? "revealed" : "hidden"}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className={`block truncate ${
                revealed
                  ? "text-white cursor-text"
                  : "text-default-500 select-none cursor-default"
              }`}
              title={revealed ? value : undefined}
            >
              {displayed || "—"}
            </motion.span>
          </AnimatePresence>
          <AnimatePresence>
            {revealed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute left-0 right-0 bottom-0 h-[2px] bg-white/[0.04]"
              >
                <motion.div
                  className="h-full"
                  style={{
                    backgroundColor: "var(--theme-accent, #f54900)",
                    width: `${progressPct}%`,
                  }}
                  transition={{ duration: 0.3 }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <Tooltip
          content={revealed ? `Hide (${secondsLeft}s)` : "Reveal"}
          placement="top"
          delay={300}
          classNames={{
            content:
              "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs",
          }}
        >
          <Button
            isIconOnly
            size="sm"
            variant="bordered"
            onPress={() => (revealed ? hide() : setRevealed(true))}
            className="!rounded-none border-white/[0.08] min-w-8 w-8 h-8"
            isDisabled={!value}
          >
            {revealed ? (
              <PxLock className="h-3 w-3 text-[color:var(--theme-accent,#f54900)]" />
            ) : (
              <PxEye className="h-3 w-3" />
            )}
          </Button>
        </Tooltip>
        <Tooltip
          content={copied ? "Copied!" : "Copy"}
          placement="top"
          delay={300}
          classNames={{
            content:
              "!rounded-none bg-[#0d0d0d] border border-white/[0.08] text-xs",
          }}
        >
          <Button
            isIconOnly
            size="sm"
            variant="bordered"
            onPress={onCopy}
            className="!rounded-none border-white/[0.08] min-w-8 w-8 h-8"
            isDisabled={!value}
          >
            {copied ? (
              <PxCheck className="h-3 w-3 text-green-400" />
            ) : (
              <PxCopy className="h-3 w-3" />
            )}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
