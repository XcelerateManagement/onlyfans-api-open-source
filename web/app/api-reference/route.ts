/**
 * Public API reference (Scalar-rendered) — accessible without login.
 *
 * Same config as /dashboard/api-reference, just hoisted out of the dashboard
 * route tree so the middleware doesn't gate it. Prospects can hit
 * the dashboard site and
 * browse every endpoint + try them in-browser with the playground.
 *
 * The OpenAPI spec at /api/openapi.json is itself public, so this needs no
 * auth bypass logic — just render Scalar.
 */
import { ApiReference } from "@scalar/nextjs-api-reference";

/**
 * Pinned on purpose.
 *
 * This route renders a ~1 KB HTML shell; every pixel the visitor sees is drawn
 * by a bundle fetched at runtime from jsDelivr. The default URL
 * (`.../npm/@scalar/api-reference`, no version) resolves to whatever Scalar
 * published most recently, so a stranger's release could change — or break —
 * our public API reference with no deploy, no review and no rollback on our
 * side. Cloudflare in front does not help: the script tag is fetched by the
 * visitor's browser, not by our origin.
 *
 * 1.64.0 is the version that URL resolved to when this was pinned, so the pin
 * froze the exact bundle already in production rather than changing behaviour.
 * Bump it deliberately, the same way any other dependency gets bumped.
 *
 * The stronger fix is to self-host: `npm i @scalar/api-reference` and serve the
 * bundle from our own origin, which also removes a third-party origin from the
 * page's runtime trust boundary. That is a bigger change (it adds a ~2 MB asset
 * to the build) and is left for a follow-up.
 */
const SCALAR_VERSION = "1.64.0";

const config = {
  cdn: `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}`,
  spec: {
    url: "/api/openapi.json",
  },
  theme: "purple",
  darkMode: true,
  /**
   * Without this the browser tab reads "Scalar API Reference" — `metaData.title`
   * only drives the OG/meta tags, not <title>.
   */
  pageTitle: "API Reference — The Only API",
  metaData: {
    title: "The Only API — API Reference",
    description:
      "Browse every OnlyFans and Fansly API endpoint. Try requests live in the playground. No login required.",
  },
  /**
   * The complaint this addresses was "the docs are literally showing me 10
   * endpoints". They were not — the spec has 526 operations — but Scalar's
   * default is `defaultOpenFirstTag`, which expands exactly one tag group and
   * collapses the other ~34. The first group here is "Panel & Usage", which has
   * eight operations. So "10 endpoints" was an accurate description of what was
   * on screen.
   *
   * Opening every tag makes the size of the API legible on arrival, which is the
   * entire job of this page.
   */
  defaultOpenAllTags: true,
  hideDownloadButton: false,
  hideModels: false,
  /**
   * Scalar's own product chrome ("Developer Tools", "Configure", "Share",
   * "Deploy") renders across the top of the page and points at Scalar's SaaS,
   * not at us. It is not something we want on a public marketing surface.
   */
  showToolbar: "never",
  showDeveloperTools: "never",
  defaultHttpClient: {
    // Scalar's key for JavaScript is "js" — "javascript" is silently ignored
    // and the panel falls back to whatever Scalar's own default happens to be.
    targetKey: "js",
    clientKey: "fetch",
  },
} as const;

export const GET = ApiReference(config);
