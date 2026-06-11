/**
 * cloudflare.ts — multi-account Cloudflare DNS automation for the site pipeline.
 *
 * Accounts come from .env, one scoped API token per account:
 *   CLOUDFLARE_TOKEN            → account labeled "default"
 *   CLOUDFLARE_TOKEN_MAIN       → account labeled "main"
 *   CLOUDFLARE_TOKEN_CLIENTB    → account labeled "clientb"
 *
 * The account that owns a domain's zone is auto-detected (try each token), or
 * forced with --cf-account <label>. Token needs Zone:Read + DNS:Edit.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export interface CfAccount {
  label: string;
  token: string;
}

export function loadCfAccounts(): CfAccount[] {
  const accounts: CfAccount[] = [];
  for (const [key, val] of Object.entries(process.env)) {
    if (!val) continue;
    if (key === "CLOUDFLARE_TOKEN") {
      accounts.push({ label: "default", token: val });
    } else {
      const m = key.match(/^CLOUDFLARE_TOKEN_(.+)$/);
      if (m) accounts.push({ label: m[1].toLowerCase(), token: val });
    }
  }
  return accounts;
}

async function cfRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const data = (await res.json()) as {
    success: boolean;
    result: T;
    errors?: unknown[];
  };
  if (!res.ok || !data.success) {
    throw new Error(`Cloudflare ${path} failed: ${JSON.stringify(data.errors ?? data)}`);
  }
  return data.result;
}

/** Registrable apex (strips a leading "www."). Naive single-TLD assumption. */
export function apexOf(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
}

export interface ZoneMatch {
  zoneId: string;
  account: CfAccount;
}

/**
 * Find which Cloudflare account/zone owns the domain. If `preferLabel` is given,
 * only that account is tried; otherwise every configured account is probed.
 */
export async function findZone(
  domain: string,
  accounts: CfAccount[],
  preferLabel?: string
): Promise<ZoneMatch | null> {
  const apex = apexOf(domain);
  const candidates = preferLabel
    ? accounts.filter((a) => a.label === preferLabel.toLowerCase())
    : accounts;

  for (const account of candidates) {
    const zones = await cfRequest<Array<{ id: string }>>(
      `/zones?name=${apex}`,
      account.token
    ).catch(() => []);
    if (zones.length > 0) return { zoneId: zones[0].id, account };
  }
  return null;
}

interface DnsRecord {
  type: "A" | "CNAME";
  name: string;
  content: string;
  proxied: boolean;
}

/** Create or update a DNS record (idempotent). */
async function ensureDnsRecord(
  zoneId: string,
  token: string,
  rec: DnsRecord
): Promise<void> {
  const existing = await cfRequest<Array<{ id: string }>>(
    `/zones/${zoneId}/dns_records?type=${rec.type}&name=${rec.name}`,
    token
  );
  const body = JSON.stringify({ ...rec, ttl: 1 });
  if (existing.length > 0) {
    await cfRequest(`/zones/${zoneId}/dns_records/${existing[0].id}`, token, {
      method: "PUT",
      body,
    });
  } else {
    await cfRequest(`/zones/${zoneId}/dns_records`, token, {
      method: "POST",
      body,
    });
  }
}

/**
 * Point the zone at Vercel: apex A record + www CNAME, both DNS-only (grey
 * cloud), which is required for Vercel to verify and issue SSL.
 */
export async function configureVercelDns(
  zoneId: string,
  token: string,
  domain: string
): Promise<void> {
  const apex = apexOf(domain);
  await ensureDnsRecord(zoneId, token, {
    type: "A",
    name: apex,
    content: "76.76.21.21",
    proxied: false,
  });
  await ensureDnsRecord(zoneId, token, {
    type: "CNAME",
    name: `www.${apex}`,
    content: "cname.vercel-dns.com",
    proxied: false,
  });
}
