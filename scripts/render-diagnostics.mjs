import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Read-only diagnostics: lists every service in the workspace with its env
 * vars (secrets redacted) and recent deploys. Complements
 * scripts/set-render-env.mjs (write side). Useful when a deployed app is not
 * picking up env vars — check what is actually configured and when deploys
 * last ran, since NEXT_PUBLIC_*/build-time vars only take effect on rebuild.
 */

const API_HOST = "https://api.render.com/v1";

function readApiKey() {
  const config = readFileSync(join(homedir(), ".render", "cli.yaml"), "utf8");
  const key = /^ {4}key: (.+)$/m.exec(config)?.[1]?.trim();
  if (!key) throw new Error("no API key in ~/.render/cli.yaml");
  return key;
}

const apiKey = readApiKey();

// Values that are safe to print; anything else is redacted.
const PRINTABLE = new Set([
  "NODE_ENV",
  "NODE_VERSION",
  "API_PROXY_TARGET",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_WS_URL",
  "NEXT_PUBLIC_APP_URL",
  "WEB_ORIGIN",
  "API_PUBLIC_URL",
  "AI_ENABLED",
  "AI_PROVIDER",
  "AI_TIMEOUT_MS",
  "HF_MODEL",
  "LOG_LEVEL",
  "RENDER_WEB_SERVICE_FREE_PLAN_SLEEP",
]);

async function get(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getPaginated(path, unwrap) {
  const items = [];
  let cursor;
  do {
    const url = new URL(`${API_HOST}${path}`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await get(url.href);
    items.push(...page.map(unwrap));
    cursor = page.at(-1)?.cursor;
  } while (cursor);
  return items;
}

const services = await getPaginated("/services", (s) => s.service ?? s);

for (const svc of services) {
  console.log("=".repeat(70));
  console.log(`service: ${svc.name}  id=${svc.id}`);
  console.log(`  type=${svc.type ?? svc.serviceDetails?.type} runtime=${svc.serviceDetails?.runtime ?? "?"}`);
  console.log(`  url=${svc.serviceDetails?.url ?? "?"}`);
  console.log(`  branch=${svc.branch ?? "?"}  suspended=${svc.suspended ?? "?"} suspendStatus=${svc.suspendStatus ?? "?"}`);
  console.log(`  autoDeploy=${svc.autoDeploy ?? "?"}  buildFilter=${JSON.stringify(svc.buildFilter ?? null)}`);
  console.log(`  lastCommit=${svc.serviceDetails?.lastCommit ?? "?"}`);

  try {
    const envVars = await getPaginated(`/services/${svc.id}/env-vars`, (e) => e.envVar);
    console.log("  envVars:");
    for (const { key, value } of envVars) {
      if (PRINTABLE.has(key)) console.log(`    ${key}=${value ?? "(sync:false, no value)"}`);
      else console.log(`    ${key}=<redacted>${value ? "" : " (sync:false)"}`);
    }
  } catch (err) {
    console.log(`  envVars: ERROR ${err.message}`);
  }

  try {
    const deploys = await getPaginated(`/services/${svc.id}/deploys`, (d) => d.deploy ?? d);
    console.log("  recent deploys (newest first):");
    for (const d of deploys.slice(0, 5)) {
      console.log(`    ${d.status}  ${d.commit?.id?.slice(0, 7) ?? "?"} "${d.commit?.message ?? ""}"  started=${d.startedAt ?? "?"} finished=${d.finishedAt ?? "?"} trigger=${d.trigger ?? "?"}`);
    }
  } catch (err) {
    console.log(`  deploys: ERROR ${err.message}`);
  }
}
console.log("=".repeat(70));
console.log(`done: ${services.length} service(s)`);
