#!/usr/bin/env tsx
/**
 * gen-og.ts — Generate a branded default Open Graph image (1200x630) for
 * kirkpainting.com in the "Blueprint Lab" style: blueprint-navy + grid,
 * "KP" monogram, cyan mono eyebrow, and a Kirk Score chip.
 *
 * Output: public/og-default.png  (social-share fallback, see SEOHead)
 * Usage:  npm run gen-og
 *
 * Note: librsvg (via sharp) only has *system* fonts, so we use the generic
 * `sans-serif` / `monospace` families rather than the web fonts (Space
 * Grotesk / JetBrains Mono) the live site loads.
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { siteConfig } from "../site.config";

const { name, tagline, theme } = siteConfig;

const initials = name
  .split(/\s+/)
  .slice(0, 2)
  .map((w) => w[0]?.toUpperCase() ?? "")
  .join("");

const bg      = theme.colorBgDark ?? "#111A2E";
const primary = theme.colorPrimary ?? "#16233D";
const accent  = theme.colorAccent ?? "#1E9FD8";
const cta     = theme.colorCta ?? "#F2701F";
const domain  = siteConfig.domain;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="${accent}" stroke-width="1" opacity="0.10"/>
    </pattern>
  </defs>

  <rect width="1200" height="630" fill="${bg}"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <!-- accent rails -->
  <rect x="0" y="0" width="1200" height="6" fill="${accent}"/>
  <rect x="0" y="624" width="1200" height="6" fill="${cta}"/>

  <!-- KP monogram badge -->
  <rect x="90" y="120" width="120" height="120" rx="20" fill="${primary}" stroke="${accent}" stroke-width="2"/>
  <text x="150" y="200" font-family="Helvetica, Arial, sans-serif" font-size="58" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(initials)}</text>

  <!-- mono eyebrow -->
  <text x="92" y="305" font-family="monospace" font-size="26" letter-spacing="2" fill="${accent}">// DATA-VERIFIED GEAR</text>

  <!-- site name -->
  <text x="88" y="395" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="700" fill="#ffffff">${esc(name)}</text>

  <!-- tagline -->
  <text x="92" y="455" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#AEBBD4">${esc(tagline)}</text>

  <!-- Kirk Score chip -->
  <rect x="90" y="515" width="320" height="58" rx="10" fill="${primary}" stroke="${accent}" stroke-width="1.5"/>
  <text x="112" y="552" font-family="monospace" font-size="22" fill="#AEBBD4">KIRK SCORE</text>
  <text x="300" y="554" font-family="monospace" font-size="30" font-weight="700" fill="#ffffff">92<tspan font-size="20" fill="#AEBBD4">/100</tspan></text>
  <rect x="112" y="560" width="276" height="6" rx="3" fill="#243355"/>
  <rect x="112" y="560" width="254" height="6" rx="3" fill="${accent}"/>

  <!-- domain -->
  <text x="1108" y="558" font-family="monospace" font-size="24" text-anchor="end" fill="#6E7EA0">${esc(domain)}</text>
</svg>`;

const out = path.resolve(import.meta.dirname, "..", "public", "og-default.png");
const buf = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(out, buf);
console.log(`✓ og-default.png generated (${(buf.length / 1024).toFixed(0)} KB)`);
