import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Pinned explicitly: lib/env.ts defaults to same-origin (""), which would
    // make the api() URL assertions below meaningless.
    env: { NEXT_PUBLIC_API_URL: "http://localhost:3001" },
  },
});
