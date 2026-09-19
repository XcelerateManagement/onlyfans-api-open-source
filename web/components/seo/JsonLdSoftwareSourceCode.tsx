import { JsonLd } from "@/components/ui/JsonLd";
import { siteUrl } from "@/lib/seo";

/**
 * SoftwareSourceCode for the published, self-hostable build.
 *
 * ── Why NOT SoftwareApplication ───────────────────────────────────────────
 * app/layout.tsx already emits a site-wide SoftwareApplication at
 * `${siteUrl}/#product` on every page, describing the hosted commercial
 * product and its AggregateOffer. Emitting a second SoftwareApplication here
 * would put two competing entities of the same type on one page with different
 * prices — which is worse than emitting nothing: Google has to guess which one
 * the page is about, and the free one would undercut the paid one in any rich
 * result it did produce.
 *
 * SoftwareSourceCode is the type that actually describes what this page is
 * about — a repository, a licence and a runtime — and it is a distinct entity,
 * so it composes with the site-wide block instead of competing with it. The
 * `targetProduct` property is the schema.org-sanctioned edge from source code
 * to the application it builds, so the two are explicitly related rather than
 * merely co-present.
 *
 * ── Publish gate ──────────────────────────────────────────────────────────
 * `codeRepository` is a hard, machine-readable assertion that a URL serves
 * source. Callers must gate this on OSS_PUBLIC; see app/open-source/page.tsx.
 */
export interface JsonLdSoftwareSourceCodeProps {
  /** Canonical URL of the page carrying this entity. */
  url: string;
  /** Public repository URL. Must resolve — see the publish gate above. */
  codeRepository: string;
  /** SPDX-style licence URL (the licence text, not the repo's LICENSE file). */
  license: string;
  name: string;
  description: string;
  programmingLanguages: string[];
  runtimePlatforms: string[];
}

export function JsonLdSoftwareSourceCode({
  url,
  codeRepository,
  license,
  name,
  description,
  programmingLanguages,
  runtimePlatforms,
}: JsonLdSoftwareSourceCodeProps) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        "@id": `${url}#sourcecode`,
        name,
        description,
        url,
        codeRepository,
        license,
        programmingLanguage: programmingLanguages.map((lang) => ({
          "@type": "ComputerLanguage",
          name: lang,
        })),
        runtimePlatform: runtimePlatforms,
        applicationCategory: "DeveloperApplication",
        // The self-hosted build runs as a Docker stack; it is not a web app you
        // visit, so "Web-based" (what the site-wide block says) would be wrong.
        operatingSystem: "Linux, macOS, Windows (Docker)",
        // Ties the source to the hosted product described in app/layout.tsx
        // rather than restating it, so there is exactly one SoftwareApplication
        // entity on the page.
        targetProduct: { "@id": `${siteUrl}/#product` },
        author: { "@id": `${siteUrl}/#organization` },
        maintainer: { "@id": `${siteUrl}/#organization` },
        // The source itself is free. This does not contradict the site-wide
        // AggregateOffer, which prices the hosted service — different entity,
        // different offer.
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          availability: "https://schema.org/InStock",
          url,
        },
      }}
    />
  );
}
