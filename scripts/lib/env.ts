import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Load KEY=VALUE pairs from a .env file into process.env without overriding
 * variables that are already set. Lets `npm run finalize-site` work whether or
 * not the user sourced .env first.
 */
export function loadEnv(dir = process.cwd()): void {
  const file = path.join(dir, ".env");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf-8").split("\n")) {
    const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    let val = rawVal;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
