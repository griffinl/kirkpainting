#!/usr/bin/env tsx
/**
 * finalize-site.ts — pipeline step that runs once a site's custom domain DNS is
 * in place. It NEVER removes the .vercel.app fallback until the real domain is
 * verified serving, so the site is never left without a working URL.
 *
 *   1. Ensure www (primary) + apex (308 → www) domains exist on the project
 *   2. Poll until the www domain is correctly configured (DNS + SSL)
 *   3. Remove the <project>.vercel.app default domain
 *   4. Set SITE_URL env to https://www.<domain>
 *
 * Usage:
 *   npm run finalize-site -- --domain onehousedecor.com
 *   npm run finalize-site -- --domain onehousedecor.com --vercel-team griffinls-projects
 */
import { loadEnv } from "./lib/env";
import {
  findProjectByName,
  addProjectDomain,
  removeProjectDomain,
  waitForDomainLive,
  upsertProjectEnv,
} from "./lib/vercel";
import { apexOf } from "./lib/cloudflare";

loadEnv();

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

const step = (m: string) => console.log(`\n→ ${m}`);
const ok = (m: string) => console.log(`  ✓ ${m}`);
const warn = (m: string) => console.log(`  ⚠ ${m}`);

async function main() {
  const args = parseArgs();
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN env var required");

  const rawDomain = args.domain;
  if (!rawDomain) throw new Error("--domain is required");

  const team = args["vercel-team"];
  const apex = apexOf(rawDomain);
  const www = `www.${apex}`;
  const repoSlug = apex.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-]/gi, "-");
  const defaultDomain = `${repoSlug}.vercel.app`;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Finalizing: ${www}
  Project:    ${repoSlug}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  step("Locating Vercel project...");
  const project = await findProjectByName(repoSlug, token, team);
  ok(`Project ${project.name} (${project.id})`);

  step("Ensuring custom domains exist...");
  await addProjectDomain(project.id, token, team, { name: www });
  await addProjectDomain(project.id, token, team, {
    name: apex,
    redirect: www,
    redirectStatusCode: 308,
  });
  ok(`${www} (primary) + ${apex} (308 → www)`);

  step("Waiting for the domain to go live (DNS + SSL)...");
  const live = await waitForDomainLive(www, token, team, {
    timeoutMs: 6 * 60_000,
    intervalMs: 15_000,
    onTick: (n) => process.stdout.write(`  …check ${n}\r`),
  });

  if (!live) {
    warn(`${www} is not configured yet (DNS still propagating?).`);
    warn(`Kept ${defaultDomain} in place. Re-run finalize-site once DNS resolves.`);
    process.exitCode = 2;
    return;
  }
  ok(`${www} is live and serving over HTTPS`);

  step("Removing the .vercel.app default domain...");
  await removeProjectDomain(project.id, token, team, defaultDomain);
  ok(`Removed ${defaultDomain}`);

  step("Setting SITE_URL env...");
  await upsertProjectEnv(project.id, token, team, "SITE_URL", `https://${www}`, [
    "production",
  ]);
  ok(`SITE_URL = https://${www}`);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  ${www} finalized.
  Note: SITE_URL applies on the next deploy (e.g. next article publish).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

main().catch((e) => {
  console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
