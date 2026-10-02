/**
 * Sets env vars on a Render service via the REST API.
 *
 * The Render CLI can create services with --env-var but has no command to add
 * them to an existing service, and Blueprints are only applied from the
 * dashboard. This fills that gap: reads the API key the CLI already stored in
 * ~/.render/cli.yaml and PUTs the key/value pairs you pass.
 *
 * Usage:
 *   node scripts/set-render-env.mjs <service-id> KEY=VALUE [KEY=VALUE ...]
 *
 * Values are never logged.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_HOST = "https://api.render.com/v1";

function readApiKey() {
  const config = readFileSync(join(homedir(), ".render", "cli.yaml"), "utf8");
  const key = /^ {4}key: (.+)$/m.exec(config)?.[1]?.trim();
  if (!key) throw new Error("no API key found in ~/.render/cli.yaml (run: render login)");
  return key;
}

const [serviceId, ...pairs] = process.argv.slice(2);
if (!serviceId || pairs.length === 0) {
  console.error("usage: node scripts/set-render-env.mjs <service-id> KEY=VALUE [KEY=VALUE ...]");
  process.exit(1);
}

const envVars = pairs.map((pair) => {
  const eq = pair.indexOf("=");
  if (eq < 1) throw new Error(`not a KEY=VALUE pair: ${pair.slice(0, 20)}…`);
  return { key: pair.slice(0, eq), value: pair.slice(eq + 1) };
});

// PUT replaces the whole env var set, so merge with what is already configured.
const existing = await fetch(`${API_HOST}/services/${serviceId}/env-vars`, {
  headers: { Authorization: `Bearer ${readApiKey()}` },
}).then(async (r) => {
  if (!r.ok) throw new Error(`list env vars failed: ${r.status} ${await r.text()}`);
  return r.json();
});

const merged = new Map(existing.map((e) => [e.key, e.value]));
for (const { key, value } of envVars) merged.set(key, value);

// Preserve secret/plaintext flags already set on unchanged keys.
const preserved = new Map(existing.map((e) => [e.key, e]));

const body = [...merged].map(([key, value]) => ({
  key,
  value,
  type: preserved.get(key)?.type ?? "plaintext",
  ...(preserved.get(key)?.keyValueGroupId && {
    keyValueGroupId: preserved.get(key).keyValueGroupId,
  }),
}));

const response = await fetch(`${API_HOST}/services/${serviceId}/env-vars`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${readApiKey()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(body),
});

if (!response.ok) {
  console.error(`update failed: ${response.status} ${await response.text()}`);
  process.exit(1);
}

console.log(`set ${envVars.length} var(s) on ${serviceId}; total now ${body.length}`);
