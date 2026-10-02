import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Sets env vars on a Render service via the REST API.
 *
 * The Render CLI can create services with --env-var but has no command to add
 * them to an existing service, and Blueprints are only applied from the
 * dashboard. This fills that gap: reads the API key the CLI already stored in
 * ~/.render/cli.yaml and PUTs the key/value pairs you pass.
 *
 * Values are never logged.
 */

// The web service (Next.js) needs its public origin vars at BUILD time because
// Next.js inlines rewrites/env into the server bundle. These must match the
// live URLs of the connected API and realtime services:
//   - NEXT_PUBLIC_API_URL / API_PROXY_TARGET  → web/public API origin
//   - NEXT_PUBLIC_WS_URL                      → wss://<realtime-host>
//   - NEXT_PUBLIC_APP_URL                     → web public origin
const WEB_SERVICE_PUBLIC_ENV = [
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_WS_URL",
  "NEXT_PUBLIC_APP_URL",
  "API_PROXY_TARGET",
];

const isWebPublicEnv = (key) => WEB_SERVICE_PUBLIC_ENV.includes(key);

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

// Warn about web-service vars that are build-time-only and therefore must be
// supplied via Blueprints/render.yaml, not at runtime.
for (const { key } of envVars) {
  if (isWebPublicEnv(key)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[set-render-env] ${key} is a build-time public env var for the web service. ` +
        "It must be set in render.yaml / the dashboard (sync or plaintext) for `pnpm build` to work.",
    );
  }
}

// PUT replaces the whole env var set, so merge with what is already configured.
// The list endpoint returns one page of { envVar: { key, value }, cursor } — a
// flat { key, value } list would silently send empty keys.
const apiKey = readApiKey();
const existing = [];
let cursor;
do {
  const url = new URL(`${API_HOST}/services/${serviceId}/env-vars`);
  if (cursor) url.searchParams.set("cursor", cursor);
  const page = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!page.ok) throw new Error(`list env vars failed: ${page.status} ${await page.text()}`);
  const body = await page.json();
  existing.push(...body.map((e) => e.envVar));
  cursor = body.at(-1)?.cursor;
} while (cursor);

const merged = new Map(existing.map((e) => [e.key, e.value]));
for (const { key, value } of envVars) merged.set(key, value);

const body = [...merged].map(([key, value]) => ({ key, value, type: "plaintext" }));

const response = await fetch(`${API_HOST}/services/${serviceId}/env-vars`, {
  method: "PUT",
  headers: {
    Authorization: `Bearer ${apiKey}`,
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
