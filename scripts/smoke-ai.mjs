import fs from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const key = fs.readFileSync(resolve(homedir(), ".render", "cli.yaml"), "utf8")
  .match(/^ {4}key: (.+)$/m)?.[1]?.trim();
const apiOrigin = "https://collabcanvas-api-i8x4.onrender.com";
const webOrigin = "https://collabcanvas-t5xb.onrender.com";

// The AI route is guarded by room + edit permission. As an anonymous user we'll
// get either 401 (no session cookie) or 403 (no edit). Either way we can
// confirm the endpoint is up and see whether the 502 you saw is reproducible
// right now (transient HF issue) vs. something structural.
console.log("API /api/health via web proxy:", webOrigin + "/api/health");
console.log("API /api/health direct:", apiOrigin + "/api/health");
for (const url of [webOrigin + "/api/health", apiOrigin + "/api/health"]) {
  const r = await fetch(url, { redirect: "follow" });
  console.log(`  -> ${url}: ${r.status} body=${await r.text().then(t => t.slice(0, 200))}`);
}

// Try the AI endpoint directly (no cookie) — expect 401.
const roomId = "smoke-test-ai-probe";
console.log("\nDirect AI probe POST (no auth cookie) to", apiOrigin + "/api/rooms/" + roomId + "/ai");
const ai = await fetch(apiOrigin + "/api/rooms/" + roomId + "/ai", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "summarize", boardBase64: "dGVzdA==" }),
});
console.log("  -> status:", ai.status);
const text = await ai.text();
console.log("  -> body:", text.slice(0, 500));

// Also hit via the web proxy path to confirm proxying is intact.
console.log("\nAI probe via web proxy (no auth) to", webOrigin + "/api/rooms/" + roomId + "/ai");
try {
  const ai2 = await fetch(webOrigin + "/api/rooms/" + roomId + "/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "summarize", boardBase64: "dGVzdA==" }),
    redirect: "follow",
  });
  console.log("  -> status:", ai2.status, "body:", (await ai2.text()).slice(0, 300));
} catch (e) {
  console.log("  -> fetch error:", e.message);
}

// HF diagnostics remain best-effort from this machine; if ENOTFOUND, the
// actual production error lives in the API's own stdout/stderr logs.
try {
  const envVars = await fetch(
    "https://api.render.com/v1/services/srv-davps4e0tbcc73eu06a0/env-vars",
    {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    },
  ).then((r) => r.json());
  const entry =
    Array.isArray(envVars) && envVars.length
      ? envVars.find((e) => e.envVar.key === "HF_TOKEN")
      : null;
  if (!entry) console.log("\nHF_TOKEN not configured.");
  else if (!entry.envVar.value)
    console.log("\nHF_TOKEN exists but empty — 502 likely from @huggingface/inference throwing.");
  else
    console.log(
      "\nHF_TOKEN present (length " +
        entry.envVar.value.length +
        "). The deployed API's logs (Render dashboard → service → logs) will show whether HF returned 401/400/5xx or threw on construction.",
    );
} catch (e) {
  console.log("\nCould not read env-vars:", e.message);
}
