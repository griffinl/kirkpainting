// kirkpainting.com — painting + home-improvement product reviews
// Theme: "Blueprint Lab" — blueprint ink-navy + cyan data accent + orange CTA,
// a clean, data-driven/geek aesthetic on a cool primer-white background.
export const siteConfig = {
  name: "Kirk Painting",
  tagline: "Painting & Home-Improvement Gear, Decoded by Data",
  description:
    "Data-driven reviews of the best paint sprayers, brushes, power tools and home-improvement gear — every pick scored against thousands of verified buyer reviews.",
  domain: "kirkpainting.com",
  niche: "painting-home-improvement",
  amazonTag: "kirkpainting-20",
  locale: "en-US",

  theme: {
    colorPrimary:      "#16233D",  // blueprint ink-navy
    colorPrimaryLight: "#24375C",
    colorAccent:       "#1E9FD8",  // cyan — data / charts / labels
    colorCta:          "#F2701F",  // safety orange — conversion buttons only
    colorBg:           "#F4F6FB",  // cool primer-white
    colorBgSubtle:     "#E9EDF5",  // cool panel
    colorBgDark:       "#111A2E",  // deep navy (footer / dark sections)
    colorText:         "#16233D",
    colorTextMuted:    "#5B6781",
    colorBorder:       "#D8DEEA",
    colorPro:          "#1B9A6B",
    colorCon:          "#D14343",
    colorStar:         "#F5A623",
    fontHeading:       "'Space Grotesk', 'Segoe UI', sans-serif",
    fontBody:          "'Inter', system-ui, sans-serif",
    fontMono:          "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace",
  },

  nav: [
    { label: "Paint",   href: "/paint/" },
    { label: "Repair",  href: "/repair/" },
    { label: "Tools",   href: "/tools/" },
    { label: "Guides",  href: "/guides/" },
  ],

  categories: [
    { slug: "paint",   label: "Paint" },
    { slug: "repair",  label: "Repair" },
    { slug: "tools",   label: "Tools" },
    { slug: "guides",  label: "Guides" },
  ],

  // This niche uses a fully custom "Blueprint Lab" design (see components).
  // The preset flags are kept for compatibility but the home + article pages
  // are hand-built rather than switching on these.
  layout: {
    home:    "grid"    as "grid" | "hero",
    article: "default" as "default" | "wirecutter",
  },

  social: {},

  // Analytics (self-hosted Umami). Both must be set for the script to load.
  // umamiWebsiteId: create a website in the Umami dashboard (domain
  // www.kirkpainting.com), then paste its ID (UUID) here.
  analytics: {
    umamiSrc: "https://stats.kirkpainting.com/script.js",
    umamiWebsiteId: "2029c564-052f-4229-bf70-4623068223ef",
  },

  pages: {
    about: {
      headline: "Less Guesswork. More Data.",
      body: `Kirk Painting started on the job site — brushes, rollers, sprayers, ladders, and a lot of strong opinions about which gear actually holds up. These days we put those opinions to the test with data instead of hunches.\n\nFor every guide, we pull together thousands of verified buyer reviews, real-world ratings, and price signals, then score each product on a 0–100 scale we call the Kirk Score. Nothing is sponsored, and nothing makes the list on vibes alone. If it isn't gear we'd run on our own project, it doesn't get recommended.`,
    },
    contact: {
      email: "hello@kirkpainting.com",
      body: "Got a product we should test, a correction, or a question about a pick? We read every message.",
    },
    privacy: {
      lastUpdated: "June 10, 2026",
    },
    disclaimer: {
      lastUpdated: "June 10, 2026",
    },
  },
} as const;

export type SiteConfig = typeof siteConfig;
export type Category = typeof siteConfig.categories[number];
