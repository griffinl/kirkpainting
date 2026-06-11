#!/usr/bin/env tsx
/**
 * create-site.ts — One-command niche site factory
 *
 * 1. AI generates site.config.ts  (requires ANTHROPIC_API_KEY)
 * 2. Copies template to output dir
 * 3. Creates GitHub repo           (requires GITHUB_TOKEN)
 * 4. Pushes code
 * 5. Creates Vercel project + env  (requires VERCEL_TOKEN)
 * 6. Creates Deploy Hook
 * 7. Prints AmazonScrapling config values
 *
 * Usage:
 *   npm run create-site -- --domain onehousedecor.com --niche "home decor"
 *   npm run create-site -- --domain onehousedecor.com --niche "home decor" --style wirecutter --output ~/sites/onehousedecor
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as cp from "node:child_process";
import * as readline from "node:readline";
import { loadEnv } from "./lib/env";
import {
  addProjectDomain,
  waitForDomainLive,
  removeProjectDomain,
  upsertProjectEnv,
} from "./lib/vercel";
import { loadCfAccounts, findZone, configureVercelDns, apexOf } from "./lib/cloudflare";

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && args[i + 1] && !args[i + 1].startsWith("--")) {
      map[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return map;
}

async function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (a) => { rl.close(); resolve(a.trim()); });
  });
}

// ─── Logging ──────────────────────────────────────────────────────────────────

const step = (msg: string) => console.log(`\n→ ${msg}`);
const ok   = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string) => console.log(`  ⚠ ${msg}`);

// ─── Shell ────────────────────────────────────────────────────────────────────

function run(cmd: string, cwd: string): string {
  return cp.execSync(cmd, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

// ─── File copy ────────────────────────────────────────────────────────────────

const COPY_EXCLUDE = new Set(["node_modules", "dist", ".git", ".astro", "package-lock.json"]);

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (COPY_EXCLUDE.has(entry)) continue;
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    if (fs.statSync(s).isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function ghRequest<T>(
  endpoint: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { message?: string };
  if (!res.ok) {
    throw new Error(`GitHub ${endpoint} → ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  }
  return data;
}

async function getGithubLogin(token: string): Promise<string> {
  const user = await ghRequest<{ login: string }>("/user", token);
  return user.login;
}

async function createGithubRepo(
  repoName: string,
  description: string,
  token: string
): Promise<{ full_name: string; html_url: string }> {
  return ghRequest("/user/repos", token, {
    method: "POST",
    body: JSON.stringify({
      name: repoName,
      description,
      private: false,
      auto_init: false,
    }),
  });
}

// ─── Vercel API ───────────────────────────────────────────────────────────────

async function vercelRequest<T>(
  endpoint: string,
  token: string,
  options: RequestInit = {},
  teamId?: string
): Promise<T> {
  const url = new URL(`https://api.vercel.com${endpoint}`);
  if (teamId) url.searchParams.set("teamId", teamId);

  const res = await fetch(url.toString(), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(
      `Vercel ${endpoint} → ${res.status}: ${data.error?.message ?? JSON.stringify(data)}`
    );
  }
  return data;
}

async function createVercelProject(
  name: string,
  githubRepo: string,
  siteUrl: string,
  token: string,
  teamId?: string
): Promise<{ id: string; name: string }> {
  return vercelRequest(
    "/v10/projects",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        framework: "astro",
        gitRepository: { type: "github", repo: githubRepo },
        buildCommand: "npm run build",
        outputDirectory: "dist",
        installCommand: "npm install",
        environmentVariables: [
          { key: "SITE_URL", value: siteUrl, type: "plain", target: ["production"] },
        ],
      }),
    },
    teamId
  );
}

async function createDeployHook(
  projectId: string,
  token: string,
  teamId?: string
): Promise<string> {
  // Create the hook (API returns project info, not hook — known Vercel quirk)
  await vercelRequest(
    `/v1/projects/${projectId}/deploy-hooks`,
    token,
    { method: "POST", body: JSON.stringify({ name: "AmazonScrapling", ref: "main" }) },
    teamId
  ).catch(() => {}); // ignore response shape error

  // Read back the hook URL from the project's link.deployHooks
  const project = await vercelRequest<{
    link?: { deployHooks?: { url: string; id: string; name: string }[] };
  }>(`/v10/projects/${projectId}`, token, {}, teamId);

  const hooks = project.link?.deployHooks ?? [];
  const hook = hooks.find((h) => h.name === "AmazonScrapling") ?? hooks[0];
  if (!hook) throw new Error("Deploy hook was not created");
  return hook.url;
}

// ─── AI config generation ─────────────────────────────────────────────────────

async function generateConfig(
  domain: string,
  niche: string,
  description: string,
  style: string,
  apiKey: string
): Promise<Record<string, unknown>> {
  const client = new Anthropic({ apiKey });

  process.stdout.write("  Calling Claude...");

  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    system: `You are a web design expert who creates product review blog configurations.
Return ONLY valid JSON — no markdown code fences, no explanation.`,
    messages: [
      {
        role: "user",
        content: `Generate a site configuration JSON for an Amazon affiliate product review blog.

Niche: ${niche}
Domain: ${domain}
Description: ${description}
Visual style: ${style}

Design rules:
- Colors must suit the niche emotionally
- layout.home: "grid" for lifestyle/decor, "hero" for editorial-heavy niches
- layout.article: "wirecutter" for tech/appliances/tools, "default" for lifestyle/decor/baby
- fontHeading + fontBody = valid Google Fonts CSS names
- Generate 5 nav/category items
- amazonTag = first word of domain (no TLD) + "-20"
- 2-paragraph about page body

Return this exact JSON shape (no extra keys):
{
  "name": "...",
  "tagline": "...",
  "description": "...",
  "domain": "${domain}",
  "niche": "slug",
  "amazonTag": "...",
  "theme": {
    "colorPrimary":"#hex","colorPrimaryLight":"#hex","colorAccent":"#hex",
    "colorBg":"#hex","colorBgSubtle":"#hex","colorBgDark":"#hex",
    "colorText":"#hex","colorTextMuted":"#hex","colorBorder":"#hex",
    "colorPro":"#hex","colorCon":"#hex","colorStar":"#hex",
    "fontHeading":"'...',...","fontBody":"'...',..."
  },
  "layout": { "home": "grid", "article": "default" },
  "nav": [{ "label": "...", "href": "/slug/" }],
  "categories": [{ "slug": "...", "label": "..." }],
  "social": {},
  "pages": {
    "about": { "headline": "...", "body": "para1.\\n\\npara2." },
    "contact": { "email": "hello@${domain}", "body": "..." },
    "privacy": { "lastUpdated": "${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}" },
    "disclaimer": { "lastUpdated": "${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}" }
  }
}`,
      },
    ],
  });

  console.log(" done.");

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function generateFavicon(config: Record<string, unknown>): string {
  const theme = (config.theme ?? {}) as Record<string, string>;
  const name  = String(config.name ?? "S");
  const color = theme.colorPrimary ?? "#2D4A3E";
  const accent = theme.colorAccent ?? "#B8732E";

  // Up to 2 initials from site name words
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const fontSize = initials.length === 1 ? 18 : 14;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${color}"/>
  <text x="16" y="${initials.length === 1 ? 23 : 22}" font-size="${fontSize}" font-weight="700"
    font-family="Georgia, serif" text-anchor="middle" fill="white">${initials}</text>
</svg>`;
}

/**
 * Canonical site origin — normalize to a single host (www) so canonical/sitemap/OG
 * always agree. The apex domain must 301-redirect to this host in Vercel.
 */
function canonicalUrl(domain: string): string {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const withWww = host.startsWith("www.") ? host : `www.${host}`;
  return `https://${withWww}`;
}

function writeConfigFile(config: Record<string, unknown>, outputDir: string): void {
  // Ensure an analytics block exists so each new site is ready to drop in its Umami ID.
  if (!config.analytics) {
    config.analytics = { umamiSrc: "", umamiWebsiteId: "" };
  }

  const date = new Date().toISOString().split("T")[0];
  const ts = `// Generated by create-site on ${date}
export const siteConfig = ${JSON.stringify(config, null, 2)} as const;

export type SiteConfig = typeof siteConfig;
export type Category = typeof siteConfig.categories[number];
`;
  fs.writeFileSync(path.join(outputDir, "site.config.ts"), ts, "utf-8");

  // Generate favicon from site name initials + primary color
  const faviconPath = path.join(outputDir, "public", "favicon.svg");
  fs.writeFileSync(faviconPath, generateFavicon(config), "utf-8");

  const site = canonicalUrl(config.domain as string);

  // Update robots.txt sitemap URL to the canonical (www) host
  const robotsPath = path.join(outputDir, "public", "robots.txt");
  if (fs.existsSync(robotsPath)) {
    const robots = fs.readFileSync(robotsPath, "utf-8");
    fs.writeFileSync(
      robotsPath,
      robots.replace(
        /Sitemap: https?:\/\/[^\n]+/,
        `Sitemap: ${site}/sitemap-index.xml`
      ),
      "utf-8"
    );
  }

  // Rewrite astro.config.mjs SITE_URL fallback to this site's canonical host
  // (so local builds without the SITE_URL env still emit correct canonicals).
  const acPath = path.join(outputDir, "astro.config.mjs");
  if (fs.existsSync(acPath)) {
    const ac = fs.readFileSync(acPath, "utf-8");
    fs.writeFileSync(
      acPath,
      ac.replace(/(process\.env\.SITE_URL \?\? ')[^']+(')/, `$1${site}$2`),
      "utf-8"
    );
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();
  const args = parseArgs();

  const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
  const VERCEL_TOKEN   = process.env.VERCEL_TOKEN;
  const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

  if (!GITHUB_TOKEN)  throw new Error("GITHUB_TOKEN env var required");
  if (!VERCEL_TOKEN)  throw new Error("VERCEL_TOKEN env var required");

  const domain      = args.domain      ?? await ask("Domain (e.g. onehousedecor.com): ");
  const niche       = args.niche       ?? await ask("Niche (e.g. 'home decor'): ");
  const description = args.description ?? await ask("Brief description: ");
  const style       = args.style       ?? await ask("Style (default / wirecutter / magazine): ");
  const vercelTeam  = args["vercel-team"];

  const repoSlug   = domain.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]/gi, "-");
  const templateDir = path.resolve(import.meta.dirname, "..");
  const outputDir   = args.output ?? path.resolve(templateDir, "..", repoSlug);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Creating: ${domain}
  Output:   ${outputDir}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // ── 1. GitHub user ────────────────────────────────────────────────────────
  step("Verifying GitHub token...");
  const githubUser = await getGithubLogin(GITHUB_TOKEN);
  ok(`Logged in as ${githubUser}`);

  // ── 2. Copy template ──────────────────────────────────────────────────────
  step("Copying template...");
  if (fs.existsSync(outputDir)) {
    warn(`${outputDir} already exists — skipping copy`);
  } else {
    copyDir(templateDir, outputDir);
    // Install dependencies in the new dir
    run("npm install --silent", outputDir);
    ok(`Template copied to ${outputDir}`);
  }

  // ── 3. Generate site.config.ts ────────────────────────────────────────────
  step("Generating site config...");
  if (ANTHROPIC_KEY) {
    const config = await generateConfig(domain, niche, description, style, ANTHROPIC_KEY);
    writeConfigFile(config, outputDir);
    ok(`site.config.ts generated (layout.article: ${(config.layout as Record<string,string>)?.article})`);
  } else {
    warn("ANTHROPIC_API_KEY not set — skipping AI config, using template defaults");
    warn("Run 'npm run gen-site' in the output dir to generate a custom config later");
  }

  // ── 3b. Generate default OG share image from config ────────────────────────
  step("Generating default OG image...");
  try {
    run("npm run gen-og", outputDir);
    ok("public/og-default.png generated");
  } catch {
    warn("OG image generation failed — run 'npm run gen-og' manually later");
  }

  // ── 4. Create GitHub repo ─────────────────────────────────────────────────
  step(`Creating GitHub repo ${githubUser}/${repoSlug}...`);
  let repo: { full_name: string; html_url: string };
  try {
    repo = await createGithubRepo(repoSlug, `${niche} product review blog`, GITHUB_TOKEN);
    ok(`Created: ${repo.html_url}`);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("422") || msg.includes("already exists")) {
      repo = { full_name: `${githubUser}/${repoSlug}`, html_url: `https://github.com/${githubUser}/${repoSlug}` };
      warn(`Repo already exists, using: ${repo.html_url}`);
    } else {
      throw err;
    }
  }

  // ── 5. Push to GitHub ─────────────────────────────────────────────────────
  step("Pushing code to GitHub...");
  const gitDir = path.join(outputDir, ".git");
  if (!fs.existsSync(gitDir)) {
    run("git init -b main", outputDir);
  }
  run("git add .", outputDir);
  try {
    run(`git commit -m "Initial commit"`, outputDir);
  } catch {
    warn("Nothing to commit (already committed)");
  }
  const remoteUrl = `https://${GITHUB_TOKEN}@github.com/${repo.full_name}.git`;
  try {
    run(`git remote add origin ${remoteUrl}`, outputDir);
  } catch {
    run(`git remote set-url origin ${remoteUrl}`, outputDir);
  }
  run("git push -u origin main --force", outputDir);
  ok("Pushed to GitHub");

  // ── 6. Create Vercel project ──────────────────────────────────────────────
  step("Creating Vercel project...");
  let projectId: string;
  let projectName: string;
  try {
    const project = await createVercelProject(
      repoSlug,
      repo.full_name,
      canonicalUrl(domain),
      VERCEL_TOKEN,
      vercelTeam
    );
    projectId   = project.id;
    projectName = project.name;
    ok(`Project created: ${projectName} (${projectId})`);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("409") || msg.toLowerCase().includes("already exists")) {
      warn("Vercel project already exists — fetching existing project");
      // Fetch existing project
      const existing = await vercelRequest<{ id: string; name: string }>(
        `/v10/projects/${repoSlug}`,
        VERCEL_TOKEN,
        {},
        vercelTeam
      );
      projectId   = existing.id;
      projectName = existing.name;
      ok(`Using existing project: ${projectName}`);
    } else {
      throw err;
    }
  }

  // ── 7. Create deploy hook ─────────────────────────────────────────────────
  step("Creating Vercel Deploy Hook...");
  const hookUrl = await createDeployHook(projectId, VERCEL_TOKEN, vercelTeam);
  ok("Deploy hook created");

  // ── 7b. Custom domains + Cloudflare DNS + finalize (full auto) ────────────
  const apex = apexOf(domain);
  const www = `www.${apex}`;
  let domainFinalized = false;

  if (args["skip-domain"] === "true") {
    warn("--skip-domain set — leaving domains/DNS to you");
  } else {
    step("Adding custom domains (www primary + apex 308 → www)...");
    await addProjectDomain(projectId, VERCEL_TOKEN, vercelTeam, { name: www });
    await addProjectDomain(projectId, VERCEL_TOKEN, vercelTeam, {
      name: apex,
      redirect: www,
      redirectStatusCode: 308,
    });
    ok(`${www} + ${apex}`);

    step("Configuring Cloudflare DNS...");
    const accounts = loadCfAccounts();
    const zone =
      accounts.length > 0
        ? await findZone(domain, accounts, args["cf-account"]).catch(() => null)
        : null;

    if (!zone) {
      warn(
        accounts.length === 0
          ? "No CLOUDFLARE_TOKEN* in env — add DNS manually:"
          : `Zone for ${apex} not found in any Cloudflare account — add DNS manually:`
      );
      warn(`  A     ${apex}  → 76.76.21.21          (DNS only)`);
      warn(`  CNAME www       → cname.vercel-dns.com (DNS only)`);
    } else {
      await configureVercelDns(zone.zoneId, zone.account.token, domain);
      ok(`DNS set via Cloudflare account "${zone.account.label}" (DNS only)`);

      step("Waiting for SSL/DNS to verify (up to ~6 min)...");
      const live = await waitForDomainLive(www, VERCEL_TOKEN, vercelTeam, {
        timeoutMs: 6 * 60_000,
        intervalMs: 15_000,
        onTick: (n) => process.stdout.write(`  …check ${n}\r`),
      });
      if (live) {
        ok(`${www} is live`);
        await removeProjectDomain(projectId, VERCEL_TOKEN, vercelTeam, `${repoSlug}.vercel.app`);
        await upsertProjectEnv(projectId, VERCEL_TOKEN, vercelTeam, "SITE_URL", `https://${www}`, ["production"]);
        ok(`Removed ${repoSlug}.vercel.app · SITE_URL = https://${www}`);
        domainFinalized = true;
      } else {
        warn("Domain not verified yet (DNS still propagating).");
        warn(`Finish later: npm run finalize-site -- --domain ${apex}${vercelTeam ? ` --vercel-team ${vercelTeam}` : ""}`);
      }
    }
  }

  // ── 8. Summary ────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Site ready!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  GitHub:  https://github.com/${repo.full_name}
  Site:    https://${www}${domainFinalized ? "  (live, .vercel.app removed)" : "  (DNS verifying…)"}

  → Paste these into AmazonScrapling Blog settings:

    url:               https://${www}
    staticSiteRepo:    ${repo.full_name}
    staticSiteBranch:  main
    vercelDeployHook:  ${hookUrl}
${domainFinalized ? "" : `
  → Domain not finalized yet. Once DNS resolves, run:
    npm run finalize-site -- --domain ${apex}${vercelTeam ? ` --vercel-team ${vercelTeam}` : ""}
`}
  → Submit https://${www}/sitemap-index.xml to Google Search Console
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((err) => {
  console.error("\n✗", err.message);
  process.exit(1);
});
