import { JsonLd } from "@/components/ui/JsonLd";
import { siteUrl } from "@/lib/seo";

export interface JsonLdArticleProps {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  /** Named human author for E-E-A-T. When absent, falls back to the org. */
  author?: { name: string; role?: string };
  /** Source URLs backing any claims/statistics in the article. */
  citations?: string[];
  image?: string;
}

export function JsonLdArticle({
  title,
  description,
  url,
  datePublished,
  dateModified,
  author,
  citations,
  image,
}: JsonLdArticleProps) {
  const resolvedImage = image
    ? image.startsWith("http")
      ? image
      : `${siteUrl}${image.startsWith("/") ? image : `/${image}`}`
    : `${siteUrl}/og-image.png`;

  // Schema.org dates must be ISO 8601. Callers pass human dates like
  // "Mar 1, 2026"; normalize to a YYYY-MM-DD date (no time, so no TZ drift).
  // Fall back to the raw string if it can't be parsed, rather than emit NaN.
  const toIso = (d: string): string => {
    const parsed = new Date(d);
    return Number.isNaN(parsed.getTime())
      ? d
      : parsed.toISOString().slice(0, 10);
  };
  const isoPublished = toIso(datePublished);
  const isoModified = toIso(dateModified ?? datePublished);

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": url,
        },
        url,
        image: [resolvedImage],
        datePublished: isoPublished,
        dateModified: isoModified,
        author: author?.name
          ? {
              "@type": "Person",
              name: author.name,
              ...(author.role ? { jobTitle: author.role } : {}),
              url: `${siteUrl}/about`,
            }
          : {
              "@type": "Organization",
              name: "The Only API Team",
              url: siteUrl,
            },
        ...(citations && citations.length
          ? { citation: citations.map((u) => ({ "@type": "CreativeWork", url: u })) }
          : {}),
        publisher: {
          "@type": "Organization",
          name: "The Only API",
          logo: {
            "@type": "ImageObject",
            url: `${siteUrl}/favicon.png`,
          },
        },
      }}
    />
  );
}
