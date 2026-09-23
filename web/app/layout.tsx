import "@/styles/globals.css";
import { Metadata, Viewport } from "next";
import clsx from "clsx";

import { siteConfig } from "@/config/site";
import { fontSans, fontMono } from "@/config/fonts";
import { ClientLayout } from "./ClientLayout";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "OnlyFans API",
    "OnlyFans automation",
    "OnlyFans API for agencies",
    "OnlyFans mass messaging",
    "OnlyFans CRM",
    "OnlyFans developer API",
    "open source OnlyFans API",
    "Fansly API",
    "self-hosted creator CRM",
  ],
  authors: [{ name: "OnlyFans API contributors" }],
  creator: "OnlyFans API contributors",
  openGraph: {
    type: "website",
    locale: "en_NZ",
    url: baseUrl,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Open Source OnlyFans and Fansly API",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.png",
  },
  robots: {
    index: false,
    follow: false,
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
      <head />
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
