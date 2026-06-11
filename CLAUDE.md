# CLAUDE.md — BlogTemplate

This file orients Claude (and humans) on what this project is and how it fits into a
larger system. Read it first in any new session.

## What this is

**BlogTemplate is a factory for Amazon product-review blogs.** It is an Astro 5 static
site that you clone-and-customize once per niche. Each generated site is its own GitHub
repo, deployed to Vercel as a zero-cost static site. This replaces an older
WordPress + MySQL setup.

The first live site generated from this template is **onehousedecor.com** (home decor).

## The three-piece system

```
┌────────────────────┐   scrapes Amazon, runs AI article pipeline,
│  AmazonScrapling    │   pushes article JSON via GitHub API
│  (Next.js + Prisma) │   /Users/liqiang/cursor/AmazonScrapling/
└─────────┬──────────┘
          │ writes src/content/articles/<slug>.json  +  triggers Vercel Deploy Hook
          ▼
┌────────────────────┐   per-niche static site (one GitHub repo each)
│  Generated site     │   e.g. /Users/liqiang/Documents/claudecode/onehousedecor/
│  (Astro, this tmpl) │   auto-rebuilds on git push (Vercel ↔ GitHub integration)
└─────────┬──────────┘
          │ created by
          ▼
┌────────────────────┐   THIS REPO — the template + automation scripts
│  BlogTemplate       │   /Users/liqiang/Documents/claudecode/BlogTemplate/
└────────────────────┘
```

- **BlogTemplate** (this repo): the template + `scripts/create-site.ts` automation.
- **Generated sites**: copies of this template with a custom `site.config.ts`. Content
  is pushed in by AmazonScrapling. We do visual/design iteration here, then mirror the
  changes back into the template (see "Dual-edit pattern" below).
- **AmazonScrapling**: the management backend. Its `src/lib/static-site/mapper.ts` maps
  its internal `ArticleFramework` + `ProductReview` data into the JSON shape this template
  consumes (`StaticArticle` / `StaticProduct`). `publisher.ts` pushes the JSON to the
  site's GitHub repo. A `Blog` row with `staticSiteRepo` set routes to static publishing
  instead of WordPress.

## Architecture of the template

- **`site.config.ts`** — the ONLY file that differs between niche sites. Controls name,
  tagline, theme colors, nav, categories, layout presets, and page copy. `create-site.ts`
  generates this with the Anthropic API.
- **Theming** — `BaseLayout.astro` injects `site.config.ts` theme colors as CSS custom
  properties (`--color-primary` etc.) at runtime. `src/styles/global.css` defines the
  design system against those vars.
- **Layout presets** — `layout.home: "grid" | "hero"` and
  `layout.article: "default" | "wirecutter"`. The article page picks `ReviewCard.astro`
  vs `ReviewCardWirecutter.astro` based on `layout.article`.
- **Content loading** — `src/lib/content.ts` loads `src/content/articles/*.json` via
  `import.meta.glob`. `src/lib/types.ts` is the `Article` / `Product` type contract.
- **Routing** — `src/pages/[category]/[slug].astro` (article), `[category]/index.astro`
  (category listing). Categories are defined in `site.config.ts`; the nav shows a curated
  subset (`nav`), while `categories` lists all routable category slugs.
- **SEO** — `@astrojs/sitemap` (→ `/sitemap-index.xml`), `public/robots.txt`,
  `SEOHead.astro` (title/description/canonical/OG/Twitter), and rich JSON-LD on article
  pages (Article, Product + AggregateRating, Offer, FAQPage, BreadcrumbList, Organization).

## The data contract (important)

The JSON shape is defined in THREE places that MUST stay in sync:
1. `src/lib/types.ts` (this template) — `Product`, `Article`.
2. Each generated site's `src/lib/types.ts`.
3. AmazonScrapling `src/lib/static-site/mapper.ts` — `StaticProduct`, `StaticArticle`.

`Product` carries more fields than any single layout shows on purpose — the philosophy is
**"push all useful data, let the template choose what to render per niche."** Notable
optional fields: `badge` (from `quick_picks.label`, e.g. "Best Multi-Pocket Organizer"),
`oneLiner`, `tier`, `bestFor`, `usageNote`. `label` is the SHORT product name; `title` is
the full Amazon title. `category` must be a product-type slug (see below).

## Category strategy

Categories are by **product type**, NOT by room. (Room-based categories cause product
overlap, fragment topic clusters, and miss product-keyword search intent.) Current set:
bedding, furniture, kitchen, outdoor, bathroom, home-decor, storage, appliances, lighting,
rugs, curtains, wall-decor, smart-home. The nav shows ~8 of these; all are routable. New
articles just need a correct `category` slug — the category page picks them up
automatically, no config change needed.

## Commands

```bash
npm run dev            # local dev server (proxy note below)
npm run build          # production build (strips Astro dev toolbar)
npm run gen-site       # (re)generate site.config.ts via Anthropic API
npm run gen-og         # regenerate public/og-default.png from site.config (name + colors)
npm run create-site    # full factory: config → repo → Vercel → domains → Cloudflare DNS → finalize
npm run finalize-site  # verify custom domain live → remove .vercel.app → set SITE_URL (pipeline tail)
npm run backdate-articles  # spread bulk-published article dates backward (~N/day)
```

### Domain pipeline (create-site → finalize-site)

`create-site` adds the www (primary) + apex (308 → www) domains, auto-configures
**Cloudflare DNS**, waits for SSL, then removes the `.vercel.app` default domain and
sets `SITE_URL`. The `.vercel.app` is only removed AFTER the real domain verifies, so a
site is never left without a working URL. If DNS is still propagating at create time, run
`finalize-site` later to complete the tail.

**Cloudflare = multi-account.** Tokens live in `.env`, one per account, label-suffixed:
`CLOUDFLARE_TOKEN_MAIN`, `CLOUDFLARE_TOKEN_CLIENTB`, … (plain `CLOUDFLARE_TOKEN` = "default").
The account owning a domain's zone is auto-detected (each token is probed); force one with
`--cf-account <label>`. Token scope: Zone:Read + DNS:Edit. Code: `scripts/lib/{cloudflare,vercel,env}.ts`.

`create-site.ts` also auto-generates `public/favicon.svg` (monogram badge) and
`public/og-default.png`. The header logo (`Header.astro`) and favicon both render the same
auto-derived initials + primary color — no manual logo asset needed.

## Conventions & gotchas

- **Dual-edit pattern**: we iterate on design in a generated site (e.g. onehousedecor)
  with live preview, then `cp` the changed component back into BlogTemplate so future
  sites inherit it. When you change a component in one, mirror it to the other.
- **Proxy**: this machine has a system proxy (`127.0.0.1:1087`). `git push` REQUIRES the
  proxy. Vercel/GitHub REST **API** calls must CLEAR proxy env vars (they fail through it).
  `curl --noproxy localhost` to hit the local dev server.
- **Astro scoped CSS + `.map()`**: `display:grid` defined in scoped `<style>` sometimes
  doesn't apply to elements rendered inside a `.map()`. Prefer a real `<table>` or set the
  layout on a stable wrapper. (Bit us on the ReviewCard specs list.)
- **Amazon product images** are square / mixed aspect ratios — use `object-fit: contain`
  and constrain with `max-width`/`max-height`, never `cover` (it crops).
- **Screenshots**: Claude can read PNG/JPG but NOT TIFF. Ask the user for PNG.
- **`@astrojs/sitemap` needs `site`** set in `astro.config.mjs` (it is, via `SITE_URL`).

## Operational (manual, one-time per site)

- Vercel needs GitHub connected in account settings (vercel.com/account/settings/authentication)
  before the API can link repos.
- Domains + DNS are automated when a `CLOUDFLARE_TOKEN*` for the domain's account is in
  `.env` (see Domain pipeline above). Without it, create-site prints the two DNS records to
  add manually (A apex → 76.76.21.21, CNAME www → cname.vercel-dns.com, both DNS-only).
- Submit `/sitemap-index.xml` to Google Search Console (+ Bing Webmaster) — this is the
  main "get indexed" step; nothing in code does it.
- In AmazonScrapling, set the Blog's `staticSiteRepo`, `staticSiteBranch`,
  `vercelDeployHook` to route publishing to the static site.

## Current state (as of last session)

Design polished on onehousedecor: footer gap fixed, featured/hero images removed,
TopPicks and ReviewCard redesigned (badge + short name + bullet specs + "Check Price",
no price shown, title & image link to affiliate URL), product-type categories, hero
background image + monogram logo + favicon + OG image all auto-generated. End-to-end
publish from AmazonScrapling → GitHub → Vercel is wired and working.
