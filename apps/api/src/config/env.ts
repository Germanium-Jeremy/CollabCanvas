import { z } from "zod";

const boolFromString = z
  .string()
  .transform((v) => v === "true" || v === "1")
  .default("true");

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16),
    WEB_ORIGIN: z.string().default("http://localhost:3000"),
    API_PUBLIC_URL: z.string().default("http://localhost:3001"),
    AI_ENABLED: boolFromString,
    AI_PROVIDER: z.enum(["mock", "openai", "ollama", "huggingface", "gemini"]).default("mock"),
    /** Per-request timeout for every model provider (local models can be slow on CPU). */
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),
    OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
    OLLAMA_MODEL: z.string().default("llama3.2"),
    // Hugging Face: token + model are required only when AI_PROVIDER=huggingface.
    HF_TOKEN: z.string().optional(),
    HF_MODEL: z.string().optional(),
    /** Optional Inference Provider pin (e.g. "featherless-ai"); unset = SDK auto selection. */
    HF_PROVIDER: z.string().optional(),
    /** Dedicated Inference Endpoint URL; when set it replaces the hosted Inference Providers route. */
    HF_ENDPOINT_URL: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
    REDIS_URL: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.string().default("info"),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Only the *selected* provider's credentials are required: local Ollama and
    // the mock provider must keep working without any cloud secrets.
    const requireVar = (condition: boolean, name: "OPENAI_API_KEY" | "HF_TOKEN" | "HF_MODEL" | "GEMINI_API_KEY") => {
      if (!condition) return;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message: `${name} is required when AI_PROVIDER=${env.AI_PROVIDER}`,
      });
    };
    requireVar(env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY, "OPENAI_API_KEY");
    requireVar(env.AI_PROVIDER === "huggingface" && !env.HF_TOKEN, "HF_TOKEN");
    requireVar(env.AI_PROVIDER === "huggingface" && !env.HF_MODEL, "HF_MODEL");
    requireVar(env.AI_PROVIDER === "gemini" && !env.GEMINI_API_KEY, "GEMINI_API_KEY");
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Lazily parse and cache env vars. Called at bootstrap and at request time in tests. */
export function getEnv(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}

/** Test-only helper to reload env after process.env changes. */
export function resetEnvForTests(): void {
  cached = null;
}
