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
    AI_PROVIDER: z.enum(["mock", "openai", "ollama"]).default("mock"),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4o-mini"),
    OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
    OLLAMA_MODEL: z.string().default("llama3.2"),
    REDIS_URL: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    LOG_LEVEL: z.string().default("info"),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when AI_PROVIDER=openai",
      });
    }
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
