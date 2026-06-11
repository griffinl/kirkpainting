/**
 * vercel.ts — minimal Vercel REST helpers for the site pipeline:
 * project lookup, domain add/remove, DNS-config polling, env upsert.
 */

export async function vercelRequest<T>(
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

export interface VercelProject {
  id: string;
  name: string;
}

export function findProjectByName(
  name: string,
  token: string,
  teamId?: string
): Promise<VercelProject> {
  return vercelRequest<VercelProject>(`/v10/projects/${name}`, token, {}, teamId);
}

export interface AddDomainBody {
  name: string;
  redirect?: string;
  redirectStatusCode?: number;
}

/** Add a domain to a project. Resolves even if it already exists. */
export async function addProjectDomain(
  projectId: string,
  token: string,
  teamId: string | undefined,
  body: AddDomainBody
): Promise<void> {
  try {
    await vercelRequest(
      `/v10/projects/${projectId}/domains`,
      token,
      { method: "POST", body: JSON.stringify(body) },
      teamId
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/already|exists|conflict/i.test(msg)) return; // idempotent
    throw e;
  }
}

export async function removeProjectDomain(
  projectId: string,
  token: string,
  teamId: string | undefined,
  name: string
): Promise<void> {
  await vercelRequest(
    `/v9/projects/${projectId}/domains/${name}`,
    token,
    { method: "DELETE" },
    teamId
  ).catch(() => {}); // already gone is fine
}

export async function getDomainMisconfigured(
  domain: string,
  token: string,
  teamId?: string
): Promise<boolean> {
  const cfg = await vercelRequest<{ misconfigured?: boolean }>(
    `/v6/domains/${domain}/config`,
    token,
    {},
    teamId
  );
  return cfg.misconfigured !== false; // treat unknown as not-ready
}

/** Poll until the domain is correctly configured (DNS + SSL) or timeout. */
export async function waitForDomainLive(
  domain: string,
  token: string,
  teamId: string | undefined,
  opts: { timeoutMs?: number; intervalMs?: number; onTick?: (n: number) => void } = {}
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const intervalMs = opts.intervalMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;
  let n = 0;
  while (Date.now() < deadline) {
    n++;
    opts.onTick?.(n);
    const misconfigured = await getDomainMisconfigured(domain, token, teamId).catch(
      () => true
    );
    if (!misconfigured) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

interface EnvEntry {
  id: string;
  key: string;
}

/** Create or update a plain project env var for the given targets. */
export async function upsertProjectEnv(
  projectId: string,
  token: string,
  teamId: string | undefined,
  key: string,
  value: string,
  target: string[] = ["production"]
): Promise<void> {
  const list = await vercelRequest<{ envs: EnvEntry[] }>(
    `/v9/projects/${projectId}/env`,
    token,
    {},
    teamId
  );
  const existing = list.envs.find((e) => e.key === key);
  if (existing) {
    await vercelRequest(
      `/v9/projects/${projectId}/env/${existing.id}`,
      token,
      { method: "PATCH", body: JSON.stringify({ value, target }) },
      teamId
    );
  } else {
    await vercelRequest(
      `/v10/projects/${projectId}/env`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ key, value, type: "plain", target }),
      },
      teamId
    );
  }
}
