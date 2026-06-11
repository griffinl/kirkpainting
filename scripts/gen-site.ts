#!/usr/bin/env tsx
/**
 * gen-site.ts — AI-powered site config generator
 *
 * Usage:
 *   npm run gen-site
 *   npm run gen-site -- --domain kitchenpickr.com --niche "kitchen appliances" --style wirecutter
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

// ─── CLI helpers ──────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1] && !args[i + 1].startsWith('--')) {
      map[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return map;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Claude prompt ────────────────────────────────────────────────────────────

const SYSTEM = `You are a web design expert who creates product review blog configurations.
Your designs are clean, trustworthy, and visually appropriate for the niche.
Return ONLY valid JSON — no markdown code fences, no explanation.`;

function buildPrompt(domain: string, niche: string, description: string, style: string): string {
  return `Generate a site configuration for an Amazon affiliate product review blog.

Niche: ${niche}
Domain: ${domain}
Description: ${description}
Visual style: ${style}

Design requirements:
- Colors must suit the niche's emotional feel:
    outdoor/tools → forest greens, slate blues
    kitchen/appliances → clean whites, navy, steel grey
    baby/nursery → soft blush, lavender, warm cream
    fitness/health → energetic orange/red, dark charcoal
    home decor → warm earthy tones (sage, terracotta, cream)
    tech/electronics → cool blues, dark backgrounds, sharp contrast
- fontHeading + fontBody = valid Google Fonts names (e.g. "'Playfair Display', Georgia, serif")
- layout.home: "grid" for lifestyle/decor niches, "hero" for editorial/review-heavy niches
- layout.article: "wirecutter" for tech, appliances, tools; "default" for lifestyle, decor, baby
- Generate 5 categories that make sense for the niche
- amazonTag = first word of domain (strip TLD) + "-20"  (e.g. kitchenpickr-20)
- Write genuine 2-paragraph about page copy for this specific niche
- All color values must be valid hex codes

Return exactly this JSON (no extra keys, no comments):
{
  "name": "Site Display Name",
  "tagline": "Short punchy tagline (under 8 words)",
  "description": "Meta description 140-155 chars",
  "domain": "${domain}",
  "niche": "slug-kebab-case",
  "amazonTag": "tag-20",
  "theme": {
    "colorPrimary":      "#hex",
    "colorPrimaryLight": "#hex",
    "colorAccent":       "#hex",
    "colorBg":           "#hex",
    "colorBgSubtle":     "#hex",
    "colorBgDark":       "#hex",
    "colorText":         "#hex",
    "colorTextMuted":    "#hex",
    "colorBorder":       "#hex",
    "colorPro":          "#hex",
    "colorCon":          "#hex",
    "colorStar":         "#hex",
    "fontHeading":       "'Font Name', fallback, fallback",
    "fontBody":          "'Font Name', fallback"
  },
  "layout": {
    "home":    "grid",
    "article": "default"
  },
  "nav": [
    { "label": "Category", "href": "/slug/" }
  ],
  "categories": [
    { "slug": "slug", "label": "Label" }
  ],
  "social": {},
  "pages": {
    "about": {
      "headline": "Headline",
      "body": "Paragraph 1.\\n\\nParagraph 2."
    },
    "contact": {
      "email": "hello@${domain}",
      "body": "One sentence contact intro."
    },
    "privacy":    { "lastUpdated": "${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}" },
    "disclaimer": { "lastUpdated": "${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}" }
  }
}`;
}

// ─── Generate ─────────────────────────────────────────────────────────────────

async function generate(domain: string, niche: string, description: string, style: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('\n✗ ANTHROPIC_API_KEY environment variable is not set.\n');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  process.stdout.write('\n🤖 Generating site config with Claude...');

  const message = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(domain, niche, description, style) }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';

  // Strip any accidental markdown fences
  const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error('\n\nClaude returned invalid JSON:\n', cleaned);
    throw new Error('JSON parse failed');
  }
}

// ─── Write output ─────────────────────────────────────────────────────────────

function writeConfig(config: Record<string, unknown>, outputPath: string) {
  const date = new Date().toISOString().split('T')[0];

  const ts = `// Generated by gen-site on ${date}
// To regenerate: npm run gen-site -- --domain ${config.domain} --niche "${config.niche}"
export const siteConfig = ${JSON.stringify(config, null, 2)} as const;

export type SiteConfig = typeof siteConfig;
export type Category = typeof siteConfig.categories[number];
`;

  fs.writeFileSync(outputPath, ts, 'utf-8');
}

function updateRobots(domain: string, robotsPath: string) {
  if (!fs.existsSync(robotsPath)) return;
  const content = fs.readFileSync(robotsPath, 'utf-8');
  const updated = content.replace(
    /Sitemap: https?:\/\/[^\n]+/,
    `Sitemap: https://${domain}/sitemap-index.xml`
  );
  fs.writeFileSync(robotsPath, updated, 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Blog Site Generator');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const domain      = args.domain      ?? await prompt('Domain (e.g. kitchenpickr.com): ');
  const niche       = args.niche       ?? await prompt('Niche (e.g. "kitchen appliances"): ');
  const description = args.description ?? await prompt('Brief description of the site: ');
  const style       = args.style       ?? await prompt('Style ("wirecutter", "magazine", "clean card" or describe): ');
  const outputPath  = args.output      ?? path.resolve('./site.config.ts');

  const config = await generate(domain, niche, description, style);

  console.log(' done.\n');

  writeConfig(config, outputPath);
  updateRobots(domain, path.resolve('./public/robots.txt'));

  console.log('✅ site.config.ts written\n');
  console.log(`   Name:            ${config.name}`);
  console.log(`   Tagline:         ${config.tagline}`);
  console.log(`   Primary color:   ${config.theme?.colorPrimary}`);
  console.log(`   Home layout:     ${config.layout?.home}`);
  console.log(`   Article layout:  ${config.layout?.article}`);
  console.log(`   Categories:      ${(config.categories as { label: string }[])?.map(c => c.label).join(', ')}`);
  console.log('\n→ Run npm run dev to preview\n');
}

main().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
