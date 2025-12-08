import { defineConfig } from "@playwright/test";

const WEB_PORT = 3000;
const API_PORT = 3001;
const WS_PORT = 3002;

const sharedEnv = {
  JWT_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
  DATABASE_URL:
    process.env.DATABASE_URL_E2E ??
    "postgresql://postgres:postgres@localhost:5432/collabcanvas_e2e?schema=public",
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  API_PUBLIC_URL: `http://localhost:${API_PORT}`,
  AI_ENABLED: "true",
  AI_PROVIDER: "mock",
  LOG_LEVEL: "warn",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @collabcanvas/api exec prisma db push --skip-generate && pnpm --filter @collabcanvas/api exec tsx src/main.ts",
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: { ...sharedEnv, PORT: String(API_PORT) },
    },
    {
      command: "pnpm --filter @collabcanvas/realtime exec tsx src/server.ts",
      port: WS_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { ...sharedEnv, REALTIME_PORT: String(WS_PORT) },
    },
    {
      command: `pnpm --filter @collabcanvas/web exec next dev -p ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}`,
        NEXT_PUBLIC_WS_URL: `ws://localhost:${WS_PORT}`,
        NEXT_PUBLIC_APP_URL: `http://localhost:${WEB_PORT}`,
      },
    },
  ],
});
