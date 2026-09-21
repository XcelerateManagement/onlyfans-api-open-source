import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { fontSans, fontMono } from "@/config/fonts";
import { ClientLayout } from "./ClientLayout";
import { JsonLd } from "@/components/ui/JsonLd";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "OnlyFans API — 200+ Endpoints, No Credits | The Only API",
    template: `%s | ${siteConfig.name}`,
  },
  description: "The OnlyFans API for agencies and developers. 200+ endpoints, unlimited calls, no credits, sub-50ms response. Free plan available.",
  keywords: [
    "OnlyFans API",
    "OnlyFans automation",
    "OnlyFans API for agencies",
    "OnlyFans mass messaging",
    "OnlyFans CRM",
    "OnlyFans developer API",
    "The Only API",
    "Xcelerator",
  ],
  authors: [{ name: "The Only API contributors" }],
  creator: "The Only API contributors",
  openGraph: {
    type: "website",
    locale: "en_NZ",
    url: baseUrl,
    title: "OnlyFans API — 200+ Endpoints, No Credits | The Only API",
    description: "The OnlyFans API for agencies and developers. 200+ endpoints, unlimited calls, no credits, sub-50ms response.",
    siteName: siteConfig.name,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "The Only API — OnlyFans API Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OnlyFans API — 200+ Endpoints, No Credits",
    description: "The OnlyFans API for agencies and developers. Unlimited calls, no credits, sub-50ms response.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.png",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: baseUrl,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning lang="en" className="dark">
      <head>
        <JsonLd data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          "@id": `${baseUrl}/#organization`,
          "name": "The Only API",
          "alternateName": "The Only API",
          "url": baseUrl,
          "logo": { "@type": "ImageObject", "url": `${baseUrl}/favicon.png`, "width": 512, "height": 512 },
          "description": "The most affordable OnlyFans API with 200+ endpoints, unlimited API calls, and no credit system.",
          "foundingDate": "2023-08-23",
          "founders": [
            { "@type": "Person", "name": "Tristyn Robertson", "jobTitle": "Co-Founder & CTO" },
            { "@type": "Person", "name": "Jordan H.", "jobTitle": "Co-Founder & CEO" },
          ],
          "address": { "@type": "PostalAddress", "streetAddress": "73 Queens Road", "addressLocality": "Waikanae", "addressRegion": "Wellington", "postalCode": "5036", "addressCountry": "NZ" },
          "contactPoint": [{ "@type": "ContactPoint", "contactType": "customer support", "email": "hello@xcelerate.nz", "availableLanguage": "English" }],
          "sameAs": ["https://linkedin.com/company/xcelerate-nz", "https://github.com/XceleratorCRM/"],
          "legalName": "The Only API",
        }} />
        <JsonLd data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          "@id": `${baseUrl}/#product`,
          "name": "The Only API",
          "description": "The most comprehensive and affordable OnlyFans API. 200+ endpoints covering messaging, content, earnings, subscribers, campaigns, and payouts.",
          "url": baseUrl,
          "applicationCategory": "DeveloperApplication",
          "operatingSystem": "Web-based",
          // Real pricing model: Free ($0, 1 account) → Slots ($20/mo per
          // account, dropping to $15 at 15+) → Enterprise (custom). Modeled as
          // an AggregateOffer so the schema mirrors the visible /pricing page
          // and never names plans that don't exist.
          "offers": {
            "@type": "AggregateOffer",
            "priceCurrency": "USD",
            "lowPrice": "0",
            "highPrice": "20",
            "offerCount": 3,
            "url": `${baseUrl}/pricing`,
          },
          // NOTE: aggregateRating intentionally omitted. Google flags
          // self-assigned ratings with no on-page, individually-attributed
          // Review nodes as spammy structured markup (manual-action risk).
          // Re-add only once real visible reviews ship on this page.
        }} />
        <JsonLd data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          "@id": `${baseUrl}/#website`,
          "name": "The Only API",
          "alternateName": "TheOnlyAPI",
          "url": baseUrl,
          "inLanguage": "en",
          "publisher": { "@id": `${baseUrl}/#organization` },
        }} />
      </head>
      <body
        suppressHydrationWarning
        className={clsx(
          "min-h-screen text-foreground bg-background font-sans antialiased",
          fontSans.variable,
          fontMono.variable
        )}
      >
        {/* AIShield is NOT rendered here. Off-screen hidden text on every
            indexable page reads as Google's "hidden text" pattern and feeds
            decoy prose to the AI crawlers robots.ts now welcomes. It stays
            scoped to the honeypot /admin/* pages, which render it directly. */}
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
