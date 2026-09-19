"use client";

import Script from "next/script";

interface TurnstileCaptchaProps {
  /** "dark" (matches the app) | "light" | "auto". Defaults to "dark". */
  theme?: "dark" | "light" | "auto";
  /** Tailwind className applied to the wrapper. */
  className?: string;
}

/**
 * Cloudflare Turnstile widget. The official script auto-mounts on any
 * element with the `cf-turnstile` class and writes the solved token into a
 * hidden input named `cf-turnstile-response` inside the surrounding <form>.
 * Submit handlers must read that input via
 * `formEl.elements.namedItem('cf-turnstile-response')` and pass the value
 * to the server endpoint as `captchaToken`.
 *
 * If NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (dev), renders nothing — the
 * server-side verifier also no-ops in that case so the flow keeps working.
 */
export function TurnstileCaptcha({
  theme = "dark",
  className = "",
}: TurnstileCaptchaProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  if (!siteKey) {
    // Silent no-op rather than a visible "(captcha disabled in dev)" badge —
    // the user shouldn't see scaffolding text on a production-styled form.
    return null;
  }

  return (
    <>
      <Script
        id="cf-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
        strategy="afterInteractive"
      />
      <div className={`flex justify-center ${className}`}>
        <div
          className="cf-turnstile"
          data-sitekey={siteKey}
          data-theme={theme}
        />
      </div>
    </>
  );
}

/** Reads the Turnstile token from a form. Returns null when the user
 *  hasn't solved the challenge yet (input missing or empty). */
export function readTurnstileToken(form: HTMLFormElement): string | null {
  const input = form.elements.namedItem(
    "cf-turnstile-response"
  ) as HTMLInputElement | null;
  return input?.value || null;
}

/** True when the site key is configured — i.e. the widget will render and
 *  the client should require a solved token before submitting. */
export function captchaEnabled(): boolean {
  return (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "").length > 0;
}
