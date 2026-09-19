# SEO Execution Plan — Rank #1 for "OnlyFans API"

Date: 2026-05-03
Status: in flight (5 parallel workstreams)

## Target queries

| Tier | Query | Intent | Target page |
|------|-------|--------|-------------|
| Head | `onlyfans api` | Commercial / informational | `/` (homepage) |
| Head | `onlyfans automation` | Informational → commercial | `/onlyfans-automation` (NEW pillar) |
| Head | `onlyfans auto dm` | Informational → commercial | `/onlyfans-auto-dm` (NEW pillar) |
| Long-tail | `onlyfans api alternative`, `infloww alternative` | Comparison | `/compare/vs-infloww` (NEW) |
| Long-tail | `onlyfansapi.com alternative`, `cheapest onlyfans api` | Comparison | `/compare/vs-onlyfansapi-com` (NEW) |
| Long-tail | `supercreator alternative` | Comparison | `/compare/vs-supercreator` (NEW) |
| Long-tail | `onlyfans crm api`, `onlyfans developer api`, `onlyfans bot api` | Mixed | Homepage + pillars (LSI in body) |
| Long-tail | `onlyfans mass dm`, `onlyfans message automation` | Informational | `/onlyfans-auto-dm` |

## Strategy

1. **Topical authority** — three dedicated 2,000–2,500 word pillar pages targeting the head terms with on-page intent matching, FAQ schema, and tight internal linking.
2. **Mechanical fix on every existing page** — per-page `<title>` / `<meta description>` / OpenGraph / Twitter / canonical / `Article` or `BreadcrumbList` schema.
3. **Homepage owns the head term `onlyfans api`** — strengthen H1, hero copy, and FAQ; keep the existing `Organization` + `SoftwareApplication` JSON-LD that's already excellent.
4. **Comparison pages** capture commercial-intent long-tail (these convert at 5–10x informational queries).
5. **Internal linking** — every new page links to homepage with `OnlyFans API` anchor; every old page links to at least one new pillar.
6. **Schema markup** for rich SERP features: `FAQPage`, `Article`, `BreadcrumbList`, `Product` w/ aggregateRating.

## Workstreams (parallel)

### WS1 — Mechanical SEO sweep
**Owner:** Agent 1
**Files:** `app/about/page.tsx`, `app/services/page.tsx`, `app/contact/page.tsx`, `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `app/changelog/page.tsx`, `app/pricing/page.tsx`, `app/documents/page.tsx`, `app/sitemap.ts`, `next.config.js`, NEW `lib/seo.ts`, NEW `components/seo/*`
**Scope:**
- Per-page `openGraph` + `twitter` metadata on every public page
- `alternates.canonical` on every sub-page
- `Article` JSON-LD on `/blog/[slug]` template + `<article>` wrapper
- `FAQPage` JSON-LD on `/pricing`
- `BreadcrumbList` JSON-LD helper used on all sub-pages
- Fix `/documents` `"use client"` → server wrapper so metadata exports work
- Add new pillar + comparison routes to `app/sitemap.ts`
- Add HSTS header in `next.config.js`
- Fix H1→H3 skips on /pricing, /about, /contact, /changelog
- Fix Contact "conversationwith" typo

### WS2 — Homepage `OnlyFans API` head-term optimization
**Owner:** Agent 2
**Files:** `app/layout.tsx` (root metadata polish only), `components/sections/CodeExampleHero.tsx` (semantic H1 + hero copy + LSI keyword density)
**Scope:**
- Add a real `<h1>` to the hero containing "OnlyFans API"
- Tighten root meta description / OG title for click-through
- Add a brief above-the-fold paragraph with the keyword + LSI terms ("OnlyFans API endpoints", "OnlyFans automation API", "agency OnlyFans CRM")
- Do not touch styling beyond what's needed to expose the H1

### WS3 — `/onlyfans-automation` pillar page
**Owner:** Agent 3
**Files:** NEW `app/onlyfans-automation/page.tsx` and component(s) under `components/sections/automation/*` if needed
**Scope:**
- 2,000–2,500 words covering: what OnlyFans automation is, what's safe vs unsafe, mass DM, scheduled posts, fan tagging/segmentation, webhook automations, integration with Zapier/Make/n8n
- H1: "OnlyFans Automation API for Creators & Agencies"
- FAQPage JSON-LD with 8–12 questions
- Internal links: homepage (anchor "OnlyFans API"), `/pricing`, `/onlyfans-auto-dm`, `/compare/vs-infloww`, `/dashboard` (with rel=nofollow if needed)
- Strong primary CTA to `/pricing`

### WS4 — `/onlyfans-auto-dm` pillar page
**Owner:** Agent 4
**Files:** NEW `app/onlyfans-auto-dm/page.tsx`
**Scope:**
- 2,000–2,500 words covering: what OnlyFans auto-DM is, why creators use it, how to do it without bans, mass-message vs welcome-message vs PPV-blast use cases, code example calling our API, safety/rate-limit guidance, pricing tier callout
- H1: "OnlyFans Auto DM — Mass Messaging via API (Without Getting Banned)"
- HowTo JSON-LD ("How to send OnlyFans auto-DMs via The Only API") + FAQPage
- Internal links: homepage, `/onlyfans-automation`, `/pricing`, `/compare/vs-infloww`
- Code snippet block (use `<pre>`/`<code>`) showing a real API call

### WS5 — Comparison pages
**Owner:** Agent 5
**Files:** NEW `app/compare/vs-infloww/page.tsx`, `app/compare/vs-onlyfansapi-com/page.tsx`, `app/compare/vs-supercreator/page.tsx`
**Scope:**
- Each ~1,200–1,500 words
- Honest, benefit-driven comparison tables (don't make up competitor flaws — emphasize our actual differentiators: 200+ endpoints, unlimited calls, no credits, transparent pricing)
- Schema: `BreadcrumbList` + FAQPage on each
- Internal links to homepage, `/pricing`, the two pillars

## Out of scope (this run)

- i18n infrastructure (separate sprint per `SEO-EXECUTION-PLAN` Sprint 4)
- New legal/compliance documents (DPA, AUP, § 2257) — separate compliance sprint
- Performance refactor of `CodeExampleHero` (separate sprint)
- Off-page / link building
- Image asset creation (placeholder OG images use the existing `/og-image.png`; per-page custom OGs come later)
- Translation of new pillars (English first; Spanish in Phase 1 of i18n rollout)

## Success criteria

- `npx tsc --noEmit` passes
- Build succeeds
- Every public page has unique title + meta description
- Every public page has at least one OG image declared (page-specific or inherited)
- All JSON-LD validates (`Organization`, `SoftwareApplication`, `FAQPage` × 4, `Article`, `BreadcrumbList`)
- 3 new pillar/comparison routes are live and listed in sitemap
- Homepage H1 contains "OnlyFans API"
- 0 broken internal links (existing footer `/status` link stays as a known TODO)

## File ownership matrix (no conflicts)

| File / dir | Agent |
|------------|-------|
| `app/layout.tsx` | 2 only |
| `components/sections/CodeExampleHero.tsx` | 2 only |
| `app/about/`, `app/services/`, `app/contact/`, `app/blog/`, `app/changelog/`, `app/pricing/`, `app/documents/`, `app/privacy/`, `app/terms/` | 1 only |
| `app/sitemap.ts`, `next.config.js`, `lib/seo.ts`, `components/seo/*` | 1 only |
| `app/onlyfans-automation/` | 3 only |
| `app/onlyfans-auto-dm/` | 4 only |
| `app/compare/` | 5 only |

## Brand voice (all agents)

Technical, direct, founder-built. Audience: agency owners + developers building creator tools. Phrases that fit: "200+ endpoints", "<50ms response times", "no credits, no overage fees", "built by agency operators", "zero accounts banned". Phrases to avoid: marketing fluff, exclamation points, "revolutionary", "game-changing".
