import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";

const key = fs.readFileSync(resolve(homedir(), ".render", "cli.yaml"), "utf8")
  .match(/^ {4}key: (.+)$/m)?.[1]?.trim();

if (!key) {
  console.error("no render api key");
  process.exit(1);
}

const tmp = tmpdir();
const logPath = resolve(tmp, `render-api-${process.pid}.log`);

// 1. Render API service logs
{
  const res = await fetch(
    "https://api.render.com/v1/services/srv-davps4e0tbcc73eu06a0/logs",
    { headers: { Authorization: `Bearer ${key}` } },
  );
  console.log("logs HTTP status:", res.status);
  const raw = await res.text();
  fs.writeFileSync(logPath, raw);
  console.log("API logs bytes:", raw.length);
  console.log("raw head:", raw.slice(0, 400).replace(/\s+/g, " "));
  if (raw.trim().startsWith("{"))
    try {
      const j = JSON.parse(raw);
      const logs = Array.isArray(j) ? j : [j];
      const out = logs.map(
        (x) =>
          x.log == null && x.data == null
            ? "---RAW---" + JSON.stringify(x).slice(0, 300)
            : typeof x === "object"
              ? x.log ?? x.data ?? JSON.stringify(x)
              : x,
      );
      console.log(out.join("\n").slice(-9000));
    } catch (e) {
      console.log("logs parse failed:", e.message);
    }
  fs.unlinkSync(logPath);
}

// 2. Probe HF_TOKEN live against HF Inference Providers
{
  const envVars = await fetch(
    "https://api.render.com/v1/services/srv-davps4e0tbcc73eu06a0/env-vars",
    { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
  ).then((r) => r.json());
  const entry = Array.isArray(envVars)
    ? envVars.find((e) => e.envVar.key === "HF_TOKEN")
    : (envVars.envVar ?? null);

  if (!entry) {
    console.log("HF_TOKEN env var is not set on the API service");
  } else if (entry.envVar.value == null || entry.envVar.value === "") {
    console.log(
      "HF_TOKEN env var exists but has NO value — this causes 401/400 from HF",
    );
  } else {
    console.log(
      `HF_TOKEN is set (length ${entry.envVar.value.length}, value redacted). `,
    );
    console.log("Probing Qwen/Qwen3-8B on HF Inference Providers...");
    const probe = await fetch(
      "https://api-inference.huggingface.co/models/Qwen/Qwen3-8B",
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${entry.envVar.value}` },
      },
    );
    const hdrs = Object.fromEntries(probe.headers.entries());
    console.log(
      `HF probe status=${probe.status} headers=${JSON.stringify(
        hdrs,
      ).replace(entry.envVar.value, "<TOKEN>")}`,
    );
    if (probe.status === 401)
      console.log(
        "  -> HF 401 Unauthorized: token likely invalid/expired or wrong token type.",
      );
    else if (probe.status === 403)
      console.log(
        "  -> HF 403: token lacks Inference Providers access OR the model is gated (needs approve).",
      );
    else if (!probe.ok)
      console.log(
        `  -> HF probe failed with status ${probe.status}. Could be model queued/deployed=GPUs unavailable (503), outage, model id typo, or org restrictions.`,
      );
    else
      console.log(
        "  -> HF model reachable with this token (small free models may return 503 under load; that is normal).",
      );
  }
}
