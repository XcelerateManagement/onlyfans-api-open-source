"use client";

import { useEffect, useState } from "react";
import { signIn, signOut, useSession, getSession } from "next-auth/react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { AuthBackground } from "@/components/ui/AuthBackground";
import { MFA_REQUIRED_PREFIX } from "@/lib/account-security-shared";

const EXPIRED_STEP = /expired/i;

// Only same-site paths, so ?redirect= can't send people off-site.
function safeRedirect(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export default function LoginPage() {
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Second step when the account has two-factor authentication on.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [redirectTo, setRedirectTo] = useState("/dashboard");

  // Billing-dashboard sign-ins arrive as /login?mfa=<challenge>&redirect=<path>.
  // Drop the challenge from the address bar so it doesn't linger in history.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRedirectTo(safeRedirect(params.get("redirect")));
    const mfa = params.get("mfa");
    if (mfa) {
      setChallenge(mfa);
      params.delete("mfa");
      const query = params.toString();
      window.history.replaceState(null, "", `/login${query ? `?${query}` : ""}`);
    }
  }, []);

  const startOver = () => {
    setChallenge(null);
    setCode("");
    setUseRecovery(false);
    setError("");
  };

  // Self-heal stale next-auth session cookies. If decryption fails on the
  // server (NEXTAUTH_SECRET rotated, deployment changed, cookie from a
  // sibling domain) the browser keeps re-sending the bad cookie and the user
  // appears stuck in "logged out" — login form runs, signIn writes a new
  // cookie, but the next request alternates between the old and new cookie
  // depending on browser cookie ordering. signOut() clears all next-auth
  // cookies via the official endpoint, leaving us a clean slate.
  const hasNextAuthCookie = () =>
    typeof document !== "undefined" &&
    document.cookie
      .split(";")
      .some((c) => /(?:^|\s)(?:__Secure-)?next-auth\.session-token=/.test(c));

  // Already authenticated visitors skip the form. Stale/undecryptable cookies
  // (NEXTAUTH_SECRET rotated, sibling-domain cookie) are cleared so the form
  // starts from a clean slate instead of getting stuck "logged out".
  useEffect(() => {
    if (status === "authenticated") {
      window.location.href = safeRedirect(
        new URLSearchParams(window.location.search).get("redirect")
      );
      return;
    }
    if (status === "unauthenticated" && hasNextAuthCookie()) {
      signOut({ redirect: false }).catch(() => {});
    }
  }, [status]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // 1. Clear any prior session FIRST so a new login never inherits another
      //    account's cookie. Fixes the "logged into the wrong account" bug and
      //    the incognito redirect-loop from a half-set/stale cookie. In-band —
      //    we await it rather than relying on the mount effect.
      if (status === "authenticated" || hasNextAuthCookie()) {
        await signOut({ redirect: false }).catch(() => {});
      }

      // 2. Single auth path: signIn → authorize() runs the dashboard login,
      //    subscription check and CRM provisioning, throwing human-readable
      //    errors (no separate client pre-check → no double round-trips / no
      //    self-inflicted rate-limit loops).
      const result = challenge
        ? await signIn("credentials", {
            challenge,
            code,
            recovery: String(useRecovery),
            redirect: false,
          })
        : await signIn("credentials", { email, password, redirect: false });

      if (!result?.ok || result.error) {
        const raw =
          result?.error && result.error !== "CredentialsSignin" ? result.error : "";
        if (raw.startsWith(MFA_REQUIRED_PREFIX)) {
          // Password accepted; now ask for the authenticator code.
          setChallenge(raw.slice(MFA_REQUIRED_PREFIX.length));
          setPassword("");
          setCode("");
          setLoading(false);
          return;
        }
        if (challenge) {
          setCode("");
          if (EXPIRED_STEP.test(raw)) startOver();
          setError(raw || "That code didn't work. Please try again.");
          setLoading(false);
          return;
        }
        setError(
          raw || "Could not sign you in. Please check your details and try again."
        );
        // A failed attempt must not leave a partial/old session reachable.
        await signOut({ redirect: false }).catch(() => {});
        setLoading(false);
        return;
      }

      // 3. Best-effort guard against the wrong-account bind. getSession() can
      //    race the just-committed cookie, so retry briefly. Only BLOCK on a
      //    POSITIVE email mismatch (the actual wrong-account bug); a transient
      //    null falls through to /dashboard, where middleware re-validates the
      //    session — never sign out a good login over a read race.
      let session = await getSession();
      for (let i = 0; i < 4 && !session?.user?.email; i++) {
        await new Promise((r) => setTimeout(r, 350));
        session = await getSession();
      }
      const sessEmail = (session?.user?.email || "").trim().toLowerCase();
      const typedEmail = email.trim().toLowerCase();
      if (sessEmail && typedEmail && sessEmail !== typedEmail) {
        setError("Signed in as a different account. Please sign in again.");
        await signOut({ redirect: false }).catch(() => {});
        setLoading(false);
        return;
      }
    } catch {
      setError("Could not reach the dashboard. Please try again.");
      setLoading(false);
      return;
    }

    window.location.href = redirectTo;
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black overflow-hidden">
      <AuthBackground />

      {/* Login card */}
      <motion.div
        className="relative w-full max-w-[420px] mx-4 z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
      >
        {/* Glass card */}
        <div className="relative bg-[#0d0d0d]/80 backdrop-blur-xl border border-white/[0.06] p-8 sm:p-10 overflow-hidden">
          <CornerBrackets size={10} />

          {/* Pixel loading overlay */}
          <AnimatePresence>
            {loading && (
              <motion.div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0d0d0d]/90 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <CornerBrackets size={10} />
                <PixelSpinner />
                <motion.p
                  className="mt-5 text-[13px] font-medium text-white/60 uppercase tracking-[0.15em]"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  Authenticating
                </motion.p>
                <motion.div
                  className="flex gap-[3px] mt-2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="w-[4px] h-[4px] bg-[#f54900]"
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{
                        duration: 1,
                        delay: i * 0.25,
                        repeat: Infinity,
                        ease: "linear",
                      }}
                    />
                  ))}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Brand */}
          <motion.div
            className="text-center mb-8"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <Link href="/" className="inline-flex flex-col items-center gap-1 mb-5">
              <span className="text-xl font-semibold text-white tracking-tight">
                TheOnlyAPI
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-[0.15em] text-white/30">
                  by
                </span>
                <Image
                  src="/logo.png"
                  alt="Xcelerator"
                  width={60}
                  height={12}
                  className="object-contain opacity-50"
                />
              </div>
            </Link>
            <h1 className="text-lg font-medium text-white mb-1">
              {challenge ? "Two-factor authentication" : "Welcome back"}
            </h1>
            <p className="text-[13px] text-white/40">
              {challenge
                ? useRecovery
                  ? "Enter one of your recovery codes"
                  : "Enter the 6-digit code from your authenticator app"
                : "Sign in to your dashboard"}
            </p>
          </motion.div>

          {/* Form */}
          <motion.form
            onSubmit={handleSubmit}
            className="space-y-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
          >
            {/* Error */}
            {error && (
              <motion.div
                className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
              >
                {error}
              </motion.div>
            )}


            {challenge ? (
              <div>
                <label
                  htmlFor="login-code"
                  className="block text-[13px] text-white/50 mb-2"
                >
                  {useRecovery ? "Recovery code" : "Authentication code"}
                </label>
                <input
                  id="login-code"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={useRecovery ? "xxxxx-xxxxx" : "123456"}
                  autoComplete="one-time-code"
                  inputMode={useRecovery ? "text" : "numeric"}
                  className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 tracking-[0.2em] placeholder:text-white/20 placeholder:tracking-normal outline-none focus:border-[#f54900]/50 transition-colors"
                />
                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setUseRecovery(!useRecovery);
                      setCode("");
                    }}
                    className="text-[12px] text-[#f54900]/70 hover:text-[#f54900] transition-colors"
                  >
                    {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
                  </button>
                  <button
                    type="button"
                    onClick={startOver}
                    className="text-[12px] text-white/40 hover:text-white/70 transition-colors"
                  >
                    Start over
                  </button>
                </div>
              </div>
            ) : (
            <>
            {/* Email */}
            <div>
              <label
                htmlFor="login-email"
                className="block text-[13px] text-white/50 mb-2"
              >
                Email
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 placeholder:text-white/20 outline-none focus:border-[#f54900]/50 transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="login-password"
                  className="block text-[13px] text-white/50"
                >
                  Password
                </label>
              </div>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 placeholder:text-white/20 outline-none focus:border-[#f54900]/50 transition-colors"
              />
            </div>
            </>
            )}

            {/* Submit */}
            <motion.button
              type="submit"
              disabled={loading}
              className="w-full bg-[#f54900] text-white text-sm font-bold uppercase tracking-wider py-3.5 hover:bg-[#ff7a30] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              whileHover={!loading ? { scale: 1.01 } : {}}
              whileTap={!loading ? { scale: 0.99 } : {}}
            >
              {challenge ? "Verify" : "Sign In"}
            </motion.button>
          </motion.form>

          {/* Register link */}
          <motion.p
            className="text-center text-[13px] text-white/40 mt-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55, duration: 0.4 }}
          >
            Don&apos;t have an account?{" "}
            <Link
              href="/pricing"
              className="text-[#f54900] hover:text-[#ff7a30] transition-colors font-medium"
            >
              Choose a plan
            </Link>
          </motion.p>
        </div>

        {/* Bottom glow effect */}
        <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[300px] h-[100px] bg-[#f54900]/5 blur-3xl rounded-full pointer-events-none" />
      </motion.div>
    </div>
  );
}
