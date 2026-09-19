"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { CornerBrackets } from "@/components/ui/CornerBrackets";
import { PixelSpinner } from "@/components/ui/PixelSpinner";
import { AuthBackground } from "@/components/ui/AuthBackground";
import {
  TurnstileCaptcha,
  readTurnstileToken,
  captchaEnabled,
} from "@/components/ui/TurnstileCaptcha";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const [checkInbox, setCheckInbox] = useState(false);
  const [verificationEmailSent, setVerificationEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setAccountExists(false);

    // Read the Turnstile token BEFORE flipping into loading state — if the
    // user hasn't solved the challenge yet, bail with a clear error rather
    // than show the spinner only to fail downstream.
    const captchaToken = readTurnstileToken(e.currentTarget);
    if (captchaEnabled() && !captchaToken) {
      setError("Please complete the captcha challenge before continuing.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/free-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, company, captchaToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setAccountExists(true);
          setLoading(false);
          return;
        }
        setError(data.error || "Could not create your account");
        setLoading(false);
        return;
      }

      // Two possible success shapes:
      //  - { verificationRequired: true }    → show "check your inbox"
      //  - everything else                  → legacy auto-signin path
      if (data?.verificationRequired) {
        setVerificationEmailSent(data.verificationEmailSent === true);
        setCheckInbox(true);
        setLoading(false);
        return;
      }

      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInRes?.error) {
        setError("Account created. Please log in to continue.");
        setLoading(false);
        setTimeout(() => router.push("/login"), 1500);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black overflow-hidden px-4">
      <AuthBackground />

      <motion.div
        className="relative w-full max-w-[460px] z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
      >
        <div className="relative bg-[#0d0d0d]/80 backdrop-blur-xl border border-white/[0.06] p-8 sm:p-10 overflow-hidden">
          <CornerBrackets size={10} />

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
                <p className="mt-5 text-[13px] font-medium text-white/60 uppercase tracking-[0.15em]">
                  Creating account
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            className="text-center mb-8"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            <Link
              href="/"
              className="inline-flex flex-col items-center gap-1 mb-5"
            >
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
              Start free — no card required
            </h1>
            <p className="text-[13px] text-white/40">
              1 OnlyFans account · 1,000 API calls/month · All 200+ endpoints
            </p>
          </motion.div>

          {checkInbox ? (
            <motion.div
              className="space-y-4 text-center py-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <div className="mx-auto w-12 h-12 flex items-center justify-center bg-[#f54900]/10 border border-[#f54900]/30">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#f54900"
                  strokeWidth="2"
                  strokeLinecap="square"
                >
                  <rect x="3" y="5" width="18" height="14" rx="0" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
              </div>
              <h2 className="text-base font-medium text-white">
                {verificationEmailSent
                  ? "Check your inbox"
                  : "Your account was created"}
              </h2>
              <p className="text-sm text-white/60 leading-relaxed">
                {verificationEmailSent ? (
                  <>
                    A verification email was submitted for delivery to{" "}
                    <span className="text-white font-medium">{email}</span>.
                    Click its link to activate your account. The link expires
                    in 24 hours.
                  </>
                ) : (
                  <>
                    We could not confirm sending the verification email to{" "}
                    <span className="text-white font-medium">{email}</span>.
                    Contact support for help completing verification.
                  </>
                )}
              </p>
              {verificationEmailSent ? (
              <p className="text-[12px] text-white/30">
                Didn&apos;t get it? Check spam, or{" "}
                <button
                  type="button"
                  onClick={() => {
                    setCheckInbox(false);
                  }}
                  className="text-[#f54900]/80 hover:text-[#f54900] transition-colors underline underline-offset-2"
                >
                  use a different email
                </button>
                .
              </p>
              ) : (
                <div className="space-y-3">
                  <Link href="/contact" className="inline-block w-full bg-[#f54900] hover:bg-[#ff7a30] text-white text-sm font-bold uppercase tracking-wider py-3.5 transition-colors">
                    Contact support
                  </Link>
                  <p className="text-[12px] text-white/40">
                    Already verified?{" "}
                    <Link href="/login" className="underline underline-offset-2 hover:text-white/70">
                      Sign in
                    </Link>.
                  </p>
                </div>
              )}
            </motion.div>
          ) : accountExists ? (
            <motion.div
              className="space-y-4 text-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <p className="text-sm text-white/70">
                An account with <strong>{email}</strong> already exists.
              </p>
              <Link
                href={`/login?email=${encodeURIComponent(email)}`}
                className="inline-block w-full bg-[#f54900] hover:bg-[#ff7a30] text-white text-sm font-bold uppercase tracking-wider py-3.5 transition-colors"
              >
                Go to login
              </Link>
              <button
                type="button"
                onClick={() => setAccountExists(false)}
                className="text-[12px] text-white/40 hover:text-white/70 transition-colors"
              >
                Use a different email
              </button>
            </motion.div>
          ) : (
            <motion.form
              onSubmit={handleSubmit}
              className="space-y-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.35, duration: 0.5 }}
            >
              {error && (
                <motion.div
                  className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                >
                  {error}
                </motion.div>
              )}

              <div>
                <label
                  htmlFor="register-name"
                  className="block text-[13px] text-white/50 mb-2"
                >
                  Full name
                </label>
                <input
                  id="register-name"
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 placeholder:text-white/20 outline-none focus:border-[#f54900]/50 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="register-email"
                  className="block text-[13px] text-white/50 mb-2"
                >
                  Email
                </label>
                <input
                  id="register-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 placeholder:text-white/20 outline-none focus:border-[#f54900]/50 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="register-password"
                  className="block text-[13px] text-white/50 mb-2"
                >
                  Password
                </label>
                <input
                  id="register-password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 placeholder:text-white/20 outline-none focus:border-[#f54900]/50 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="register-company"
                  className="block text-[13px] text-white/50 mb-2"
                >
                  Company{" "}
                  <span className="text-white/25">(optional)</span>
                </label>
                <input
                  id="register-company"
                  type="text"
                  autoComplete="organization"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="Acme Inc."
                  className="w-full bg-white/[0.03] border border-white/[0.08] text-white text-sm px-4 py-3 placeholder:text-white/20 outline-none focus:border-[#f54900]/50 transition-colors"
                />
              </div>

              <TurnstileCaptcha className="pt-1" />

              <motion.button
                type="submit"
                disabled={loading}
                className="w-full bg-[#f54900] text-white text-sm font-bold uppercase tracking-wider py-3.5 hover:bg-[#ff7a30] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                whileHover={!loading ? { scale: 1.01 } : {}}
                whileTap={!loading ? { scale: 0.99 } : {}}
              >
                Create free account
              </motion.button>

              <motion.p
                className="text-center text-[13px] text-white/40 pt-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.4 }}
              >
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="text-[#f54900] hover:text-[#ff7a30] transition-colors font-medium"
                >
                  Log in
                </Link>
              </motion.p>
              <p className="text-center text-[11px] text-white/25">
                Need more than 1 account?{" "}
                <Link
                  href="/pricing"
                  className="text-white/50 hover:text-white/70 transition-colors underline underline-offset-2"
                >
                  Compare plans
                </Link>
              </p>
            </motion.form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
