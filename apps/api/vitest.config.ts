import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.e2e-spec.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests hit a real Postgres; run files serially to avoid cross-file interference.
    fileParallelism: false,
    setupFiles: ["test/setup.ts"],
  },
});
