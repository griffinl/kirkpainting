#!/usr/bin/env tsx
/**
 * deploy-inplace.ts — Ship THIS already-built site (no template copy, no AI
 * config regen). Creates the GitHub repo, pushes, creates the Vercel project
 * linked to it, a deploy hook, and adds the custom domains. DNS is printed for
 * manual setup (no CLOUDFLARE_TOKEN in .env).
 *
 * Run from the site root:  npx tsx scripts/deploy-inplace.ts
 */
import * as cp from "node:child_process";
import { loadEnv } from "./lib/env";
import { vercelRequest, addProjectDomain } from "./lib/vercel";

const DOMAIN = "kirkpainting.com";
const REPO = "kirkpainting";
const WWW = `www.${DOMAIN}`;
const SITE_URL = `https://${WWW}`;

const step = (m: string) => console.log(`\n→ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ⚠ ${m}`);
const run = (cmd: string) =>
  cp.execSync(cmd, { cwd: process.cwd(), encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });

async function gh<T>(endpoint: string, token: string, options: RequestInit = {}): Promise<T> {
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
  if (!res.ok) throw new Error(`GitHub ${endpoint} → ${res.status}: ${data.message ?? JSON.stringify(data)}`);
  return data;
}

async function main() {
  loadEnv();
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID || undefined;
  if (!GITHUB_TOKEN || !VERCEL_TOKEN) throw new Error("GITHUB_TOKEN and VERCEL_TOKEN required in .env");

  // 1. GitHub identity
  step("Verifying GitHub token...");
  const user = await gh<{ login: string }>("/user", GITHUB_TOKEN);
  const fullName = `${user.login}/${REPO}`;
  ok(`Logged in as ${user.login}`);

  // 2. Create repo (idempotent)
  step(`Creating GitHub repo ${fullName}...`);
  let repoUrl = `https://github.com/${fullName}`;
  try {
    const r = await gh<{ html_url: string }>("/user/repos", GITHUB_TOKEN, {
      method: "POST",
      body: JSON.stringify({
        name: REPO,
        description: "Painting & home-improvement product reviews",
        private: false,
        auto_init: false,
      }),
    });
    repoUrl = r.html_url;
    ok(`Created: ${repoUrl}`);
  } catch (e) {
    const m = (e as Error).message;
    if (/422|already exists/i.test(m)) warn(`Repo already exists, using ${repoUrl}`);
    else throw e;
  }

  // 3. Commit + push (git inherits the shell proxy env, which it needs)
  step("Pushing code to GitHub...");
  try { run("git rev-parse --git-dir"); } catch { run("git init -b main"); }
  run("git add -A");
  try { run(`git commit -m "Initial commit: Kirk Painting site"`); } catch { warn("nothing to commit"); }
  const remote = `https://${GITHUB_TOKEN}@github.com/${fullName}.git`;
  try { run(`git remote add origin ${remote}`); } catch { run(`git remote set-url origin ${remote}`); }
  run("git push -u origin main --force");
  ok("Pushed to GitHub");

  // 4. Vercel project linked to the repo
  step("Creating Vercel project...");
  let projectId: string;
  try {
    const p = await vercelRequest<{ id: string; name: string }>(
      "/v10/projects",
      VERCEL_TOKEN,
      {
        method: "POST",
        body: JSON.stringify({
          name: REPO,
          framework: "astro",
          gitRepository: { type: "github", repo: fullName },
          buildCommand: "npm run build",
          outputDirectory: "dist",
          installCommand: "npm install",
          environmentVariables: [
            { key: "SITE_URL", value: SITE_URL, type: "plain", target: ["production"] },
          ],
        }),
      },
      teamId
    );
    projectId = p.id;
    ok(`Project created: ${p.name} (${p.id})`);
  } catch (e) {
    const m = (e as Error).message;
    if (/409|already exists/i.test(m)) {
      const ex = await vercelRequest<{ id: string; name: string }>(`/v10/projects/${REPO}`, VERCEL_TOKEN, {}, teamId);
      projectId = ex.id;
      warn(`Using existing project ${ex.name}`);
    } else throw e;
  }

  // 5. Deploy hook (for AmazonScrapling publishes)
  step("Creating Vercel deploy hook...");
  await vercelRequest(
    `/v1/projects/${projectId}/deploy-hooks`,
    VERCEL_TOKEN,
    { method: "POST", body: JSON.stringify({ name: "AmazonScrapling", ref: "main" }) },
    teamId
  ).catch(() => {});
  const proj = await vercelRequest<{ link?: { deployHooks?: { url: string; name: string }[] } }>(
    `/v10/projects/${projectId}`, VERCEL_TOKEN, {}, teamId
  );
  const hook = proj.link?.deployHooks?.find((h) => h.name === "AmazonScrapling") ?? proj.link?.deployHooks?.[0];
  ok(hook ? "Deploy hook ready" : "Deploy hook not found (set up in dashboard)");

  // 6. Custom domains (www primary + apex 308 → www)
  step("Adding custom domains...");
  await addProjectDomain(projectId, VERCEL_TOKEN, teamId, { name: WWW });
  await addProjectDomain(projectId, VERCEL_TOKEN, teamId, { name: DOMAIN, redirect: WWW, redirectStatusCode: 308 });
  ok(`${WWW} (primary) + ${DOMAIN} (308 → www)`);

  // 7. Summary + manual DNS (no Cloudflare token in .env)
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  GitHub + Vercel ready
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  GitHub:  ${repoUrl}
  Vercel:  project "${REPO}" (auto-deploys on push)
  Target:  ${SITE_URL}

  → Add these DNS records at the domain's DNS host, then wait for SSL:
      A      ${DOMAIN}   → 76.76.21.21            (DNS only / not proxied)
      CNAME  www          → cname.vercel-dns.com   (DNS only / not proxied)

  → Once DNS resolves, finish (removes the .vercel.app default):
      npm run finalize-site -- --domain ${DOMAIN}

  → AmazonScrapling Blog settings:
      url:              ${SITE_URL}
      staticSiteRepo:   ${fullName}
      staticSiteBranch: main
      vercelDeployHook: ${hook?.url ?? "(see Vercel dashboard → Settings → Git → Deploy Hooks)"}

  → Submit ${SITE_URL}/sitemap-index.xml to Google Search Console
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch((e) => { console.error("\n✗", (e as Error).message); process.exit(1); });
