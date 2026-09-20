// Test environment — loaded before any app code via vitest setupFiles.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-test-secret-test-secret-0123456789";
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  "postgresql://postgres:postgres@localhost:5432/collabcanvas_test?schema=public";
process.env.AI_ENABLED = "true";
process.env.AI_PROVIDER = "mock";
process.env.LOG_LEVEL = "silent";
