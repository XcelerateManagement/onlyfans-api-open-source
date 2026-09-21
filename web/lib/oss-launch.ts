/**
 * Single switch for everything that assumes the open-source repository is
 * public.
 *
 * The repo does not exist yet. Until it does, every GitHub link on /open-source
 * 404s, so that page must not be promoted anywhere a visitor can reach it — not
 * the navbar, not the footer, not the sitemap, not the pricing page.
 *
 * Driven by NEXT_PUBLIC_OSS_PUBLIC so it can be switched on locally for review
 * (`NEXT_PUBLIC_OSS_PUBLIC=true npm run dev`) without any chance of a hardcoded
 * `true` being committed and shipped by accident. It is OFF unless the env var
 * is the exact string "true", so every deploy that does not set it stays safe.
 *
 * Set it in the production environment in the SAME deploy that makes the
 * repository public, and work through app/open-source/WIRING.md at the same
 * time.
 */
export const OSS_PUBLIC = process.env.NEXT_PUBLIC_OSS_PUBLIC === "true";

/** Canonical links, so a rename is one edit rather than a grep-and-hope. */
export const OSS_REPO_URL = "https://github.com/XceleratorCRM/onlyfans-api";
export const OSS_PAGE_PATH = "/open-source";
