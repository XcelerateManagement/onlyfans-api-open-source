import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Pin the Turbopack workspace root to THIS directory. Without a lockfile that
// Turbopack recognises as a boundary, it walks up the filesystem and can latch
// onto an unrelated app's `src/app`, serving the wrong project. Pinning the
// root makes `next dev`/`build` always use this project.
const __projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: __projectRoot },
  poweredByHeader: false,
  // Serve modern formats (AVIF first, then WebP) from next/image — the
  // homepage dashboard screenshots are the heaviest assets on the site.
  images: {
    formats: ["image/avif", "image/webp"],
  },
  // When a reverse proxy terminates TLS in front of this process, Next sees a
  // loopback `host` but the browser's real `Origin`, and rejects server actions
  // (the OAuth consent form) as "Invalid Server Actions request". List your own
  // public hostname here if you hit that.
  experimental: {
    serverActions: {
      allowedOrigins: (process.env.SERVER_ACTION_ORIGINS || "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
        .concat(["localhost:3000", "127.0.0.1:3000"]),
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
        ],
      },
    ];
  },
  async rewrites() {
    const FLASK = (process.env.BACKEND_URL || "http://127.0.0.1:5020").replace(/\/$/, "");
    return [
      {
        source: "/backend-api/:path*",
        destination: `${process.env.BACKEND_URL || "http://api:5000"}/api/:path*`,
      },
      // The `/api/crm/:path*` rewrite was intentionally removed. That URL is
      // now handled by `app/api/crm/[...path]/route.ts`, which attaches the
      // X-API-Key server-side from the signed JWT so the browser never sees
      // it. Re-adding a rewrite here would reintroduce client-side key
      // exposure.

      // OAuth 2.1 authorization-server endpoints — proxied to Flask so the
      // discovery URLs work at the pretty public hostname. ChatGPT /
      // Claude.ai expect these exact paths per RFC 8414 / RFC 9728. We
      // can't host them at the Flask hostname directly because Cloudflare
      // terminates TLS in front of Next.js.
      {
        source: "/.well-known/oauth-authorization-server",
        destination: `${FLASK}/.well-known/oauth-authorization-server`,
      },
      {
        source: "/.well-known/jwks.json",
        destination: `${FLASK}/.well-known/jwks.json`,
      },
      {
        source: "/oauth/register",
        destination: `${FLASK}/oauth/register`,
      },
      {
        source: "/oauth/authorize",
        destination: `${FLASK}/oauth/authorize`,
      },
      {
        source: "/oauth/authorize/grant",
        destination: `${FLASK}/oauth/authorize/grant`,
      },
      {
        source: "/oauth/token",
        destination: `${FLASK}/oauth/token`,
      },

      // RFC 9728 derives the protected-resource metadata URL from the
      // resource URI by appending the well-known suffix — so for the
      // resource `<your-host>/mcp` the canonical metadata
      // URL is `<your-host>/mcp/.well-known/oauth-protected-
      // resource`. We point clients at this path in the MCP server's
      // WWW-Authenticate header, so we must serve it. The actual body
      // lives in app/.well-known/oauth-protected-resource/route.ts.
      {
        source: "/mcp/.well-known/oauth-protected-resource",
        destination: "/.well-known/oauth-protected-resource",
      },

      // NOTE: the hosted deployment adds scan-path traps here. They are
      // deliberately NOT part of the open-source build: publishing the list of
      // monitored paths tells a scanner exactly which URLs to avoid, which
      // defeats the point of having them.
    ];
  },
};

export default nextConfig;
