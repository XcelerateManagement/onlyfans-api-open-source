import type { Metadata } from "next";

export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export function canonical(path: string): string {
  if (!path || path === "/") return siteUrl;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${siteUrl}${clean}`;
}

export interface MetaForInput {
  title: string;
  description: string;
  path: string;
  image?: string;
  /**
   * When true, the title is treated as the complete <title> and the root
   * layout's `%s | The Only API` template is NOT appended. Use this for pages
   * whose title already contains the brand or would exceed ~60 chars once the
   * template is added (avoids "… The Only API | The Only API" duplication).
   * The OG/Twitter titles still use the bare string.
   */
  absoluteTitle?: boolean;
}

/**
 * Build a partial Metadata object for a sub-page.
 * - Sets canonical, OpenGraph, and Twitter from a single source of truth.
 * - Defaults the OG image to /og-image.png (the site-wide placeholder).
 */
export function metaFor({
  title,
  description,
  path,
  image = "/og-image.png",
  absoluteTitle = false,
}: MetaForInput): Metadata {
  const url = canonical(path);
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
