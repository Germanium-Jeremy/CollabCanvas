import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv, resetEnvForTests } from "../src/config/env";

/** Env vars this suite owns; saved/restored so other spec files keep the mocked default. */
const OWNED = ["AI_PROVIDER", "OPENAI_API_KEY", "HF_TOKEN", "HF_MODEL", "HF_PROVIDER", "HF_ENDPOINT_URL", "GEMINI_API_KEY", "GEMINI_MODEL", "OLLAMA_BASE_URL", "OLLAMA_MODEL"] as const;

let saved: Record<string, string | undefined>;

function setEnv(values: Record<string, string | undefined>): void {
  for (const name of OWNED) delete process.env[name];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  resetEnvForTests();
}

describe("AI provider env validation", () => {
  beforeEach(() => {
    saved = Object.fromEntries(OWNED.map((name) => [name, process.env[name]]));
    setEnv({ AI_PROVIDER: "mock" });
  });

  afterEach(() => {
    setEnv(saved);
    resetEnvForTests();
  });

  it("defaults to the mock provider without any cloud credential", () => {
    expect(getEnv().AI_PROVIDER).toBe("mock");
  });

  it("keeps local Ollama usable without cloud secrets", () => {
    // Clear inherited values so the schema defaults are what we assert.
    setEnv({ AI_PROVIDER: "ollama", OLLAMA_BASE_URL: undefined, OLLAMA_MODEL: undefined });
    const env = getEnv();
    expect(env.AI_PROVIDER).toBe("ollama");
    expect(env.OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(env.OLLAMA_MODEL).toBe("llama3.2");
  });

  it("requires HF_TOKEN and HF_MODEL only when huggingface is selected", () => {
    setEnv({ AI_PROVIDER: "huggingface" });
    expect(() => getEnv()).toThrow(/HF_TOKEN is required/);
    expect(() => getEnv()).toThrow(/HF_MODEL is required/);

    setEnv({ AI_PROVIDER: "huggingface", HF_TOKEN: "hf_test", HF_MODEL: "Qwen/Qwen3-8B", HF_PROVIDER: "featherless-ai" });
    expect(getEnv()).toMatchObject({ HF_TOKEN: "hf_test", HF_MODEL: "Qwen/Qwen3-8B", HF_PROVIDER: "featherless-ai" });

    // Unselected provider credentials stay optional.
    setEnv({ AI_PROVIDER: "huggingface", HF_MODEL: "Qwen/Qwen3-8B", GEMINI_API_KEY: undefined });
    expect(() => getEnv()).toThrow(/HF_TOKEN is required/);
    expect(() => getEnv()).not.toThrow(/GEMINI_API_KEY/);
  });

  it("requires GEMINI_API_KEY only when gemini is selected", () => {
    setEnv({ AI_PROVIDER: "gemini" });
    expect(() => getEnv()).toThrow(/GEMINI_API_KEY is required/);

    setEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "test-key" });
    expect(getEnv()).toMatchObject({ GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.5-flash" });

    setEnv({ AI_PROVIDER: "ollama", GEMINI_API_KEY: undefined, HF_TOKEN: undefined });
    expect(getEnv().AI_PROVIDER).toBe("ollama");
  });

  it("requires OPENAI_API_KEY only when openai is selected", () => {
    setEnv({ AI_PROVIDER: "openai" });
    expect(() => getEnv()).toThrow(/OPENAI_API_KEY is required/);

    setEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" });
    expect(getEnv().OPENAI_MODEL).toBe("gpt-4o-mini");
  });

  it("rejects unknown provider names", () => {
    setEnv({ AI_PROVIDER: "not-a-provider" });
    expect(() => getEnv()).toThrow();
  });
});
