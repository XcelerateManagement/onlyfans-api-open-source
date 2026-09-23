/**
 * Panel configuration.
 *
 * The hosted product carried a large site config here: marketing navigation,
 * pricing tiers, comparison tables, company registration details and a
 * checkout URL. None of that applies to a self-hosted install, so what remains
 * is the name shown in the browser tab and the sidebar.
 *
 * Rename it freely — this is your panel.
 */
export const siteConfig = {
  name:
    process.env.NEXT_PUBLIC_PANEL_NAME ||
    "Open Source OnlyFans + Fansly API",
  description:
    "Open-source, self-hosted CRM and REST API for OnlyFans and Fansly creator accounts.",
} as const;

export type SiteConfig = typeof siteConfig;
