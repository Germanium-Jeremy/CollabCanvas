// Standalone Hugging Face connectivity smoke test for CollabCanvas.
//
// It checks that HF_TOKEN + the configured model/provider are reachable. It does NOT
// call the CollabCanvas API, send board context, or test the three AI actions —
// use `pnpm --filter @collabcanvas/api test` for those.
//
// Run (from apps/api or via `pnpm --filter @collabcanvas/api smoke:hf`):
//   $env:HF_TOKEN = "<token>"; pnpm smoke:hf
// This script does not load .env itself, so HF_TOKEN must already be in the process
// environment. Never hard-code or log the token.

const token = process.env.HF_TOKEN;
if (!token) {
  console.error("HF_TOKEN is not set in the process environment.");
  process.exit(1);
}

const model = process.env.HF_MODEL ?? "Qwen/Qwen3-8B:featherless-ai";
const provider = process.env.HF_PROVIDER;
const prompt = process.env.HF_SMOKE_PROMPT ?? "What is the capital of France?";

const { InferenceClient } = await import("@huggingface/inference");
const client = new InferenceClient(token);

const startedAt = Date.now();
let out = "";
let chunks = 0;

try {
  const stream = client.chatCompletionStream({
    model,
    ...(provider ? { provider } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      out += delta;
      chunks += 1;
      process.stdout.write(delta);
    }
  }
} catch (error) {
  console.error(`\nHF smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const elapsedMs = Date.now() - startedAt;
console.log(`\n\nmodel=${model} provider=${provider ?? "auto"} chunks=${chunks} elapsedMs=${elapsedMs}`);

if (!out.trim()) {
  console.error("No text was received — check model/provider availability, quota, and billing.");
  process.exit(1);
}
