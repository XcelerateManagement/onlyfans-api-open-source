"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { ApiError, type ImportJobRow } from "@/lib/api-client";
import { canAcceptCode, otpWindow } from "@/lib/import-format";
import { PxRefresh, PxCheck } from "@/components/ui/PixelIcons";

const CODE_LENGTH = 6;

export interface OtpActions {
  onSubmitOtp: (rowId: string, code: string) => Promise<void>;
  onRetry: (rowId: string) => Promise<void>;
}

/**
 * The control for one parked login.
 *
 * The rule this component exists to enforce: **a code box is only ever shown
 * when a code can actually work.** The server gives each parked row a 600s
 * window; once it closes, the challenge is gone and posting a code returns an
 * error that reads like the operator mistyped. So the countdown is not
 * decoration — when it reaches zero the input is *replaced* by the re-login
 * action, before any server round trip confirms it.
 *
 * `now` is passed in rather than read here so that one timer in the parent
 * drives every countdown on the page; 600 parked rows must not mean 600
 * intervals.
 */
export function ImportOtpRow({
  row,
  now,
  onSubmitOtp,
  onRetry,
  compact = false,
}: {
  row: ImportJobRow;
  now: number;
} & OtpActions & { compact?: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const win = otpWindow(row.otp_expires_at, now);
  const usable = canAcceptCode(row.state, row.otp_expires_at, now);
  const expired = row.state === "needs_2fa_expired" || (!!win && win.expired);

  // Clear any stale rejection once the operator edits the code again.
  useEffect(() => {
    if (code) setErr(null);
  }, [code]);

  async function submit() {
    if (busy || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmitOtp(row.row_id, code);
      setDone(true);
      setCode("");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.isTransport
            ? "Could not reach the API — the code was not submitted. Try again."
            : e.data?.error || e.message
          : "Something went wrong submitting the code.";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onRetry(row.row_id);
      setDone(true);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.isTransport
            ? "Could not reach the API. Try again."
            : e.data?.error || e.message
          : "Could not restart this login.";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-green-400">
        <PxCheck className="h-3 w-3" />
        <span>Sent — resuming…</span>
      </div>
    );
  }

  // ── Expired: no code will work, so don't offer one. ───────────────────────
  if (expired) {
    return (
      <div className={compact ? "space-y-1" : "space-y-1.5"}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-red-400 font-semibold uppercase tracking-wider">
            Code window closed
          </span>
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="flex items-center gap-1.5 border border-red-400/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-red-300 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
          >
            <PxRefresh className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Restarting…" : "Log in again"}
          </button>
        </div>
        <p className="text-[10px] text-default-500 leading-relaxed">
          A 6-digit code can no longer be used for this account — the login
          attempt it belonged to has been discarded. Restarting sends a fresh
          challenge.
        </p>
        {err && <p className="text-[10px] text-red-400">{err}</p>}
      </div>
    );
  }

  // ── Parked and live: take a code. ─────────────────────────────────────────
  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          value={code}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`2FA code for ${row.email ?? `line ${row.line}`}`}
          placeholder="000000"
          maxLength={CODE_LENGTH}
          disabled={busy || !usable}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          className="w-[92px] bg-white/[0.03] border border-white/[0.12] px-2 py-1 text-[13px] font-mono tracking-[0.25em] text-foreground placeholder:text-white/20 outline-none focus:border-[color:rgba(var(--theme-accent-rgb,245,73,0),0.5)] disabled:opacity-40"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || code.length !== CODE_LENGTH || !usable}
          className="border border-amber-400/40 px-2.5 py-1 text-[10px] uppercase tracking-wider text-amber-300 hover:bg-amber-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Sending…" : "Submit"}
        </button>

        {win && (
          <motion.span
            key={win.urgent ? "urgent" : "calm"}
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            title="Time left before this code window closes"
            className={`tabular-nums text-[11px] font-semibold ${
              win.urgent ? "text-red-400" : "text-amber-400/80"
            }`}
          >
            {win.display}
          </motion.span>
        )}
      </div>
      {err && <p className="text-[10px] text-red-400 max-w-[320px]">{err}</p>}
    </div>
  );
}
