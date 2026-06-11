#!/usr/bin/env tsx
/**
 * set-dns.ts — Point kirkpainting.com at Vercel via Cloudflare (apex A + www
 * CNAME, both DNS-only). Reuses the shared Cloudflare helpers. Idempotent.
 */
import { loadEnv } from "./lib/env";
import { loadCfAccounts, findZone, configureVercelDns, apexOf } from "./lib/cloudflare";

const DOMAIN = "kirkpainting.com";

async function main() {
  loadEnv();
  const accounts = loadCfAccounts();
  if (accounts.length === 0) throw new Error("No CLOUDFLARE_TOKEN* found in .env");
  console.log(`→ Probing ${accounts.length} Cloudflare account(s) for ${apexOf(DOMAIN)}...`);

  const zone = await findZone(DOMAIN, accounts);
  if (!zone) {
    console.error(`\n✗ Zone for ${apexOf(DOMAIN)} not found in any Cloudflare account the token can see.`);
    console.error("  → Make sure kirkpainting.com is added to this Cloudflare account (nameservers pointed to CF) and the token has Zone:Read for it.");
    process.exit(1);
  }
  console.log(`  ✓ Zone found via account "${zone.account.label}" (zone ${zone.zoneId})`);

  console.log("→ Setting DNS records (DNS-only / grey cloud)...");
  await configureVercelDns(zone.zoneId, zone.account.token, DOMAIN);
  console.log("  ✓ A    @   → 76.76.21.21");
  console.log("  ✓ CNAME www → cname.vercel-dns.com");
  console.log(`\n✅ DNS set. Wait a few minutes for propagation + Vercel SSL, then:`);
  console.log(`   npm run finalize-site -- --domain ${DOMAIN}`);
}

main().catch((e) => { console.error("\n✗", (e as Error).message); process.exit(1); });
