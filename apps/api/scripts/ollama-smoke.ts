/**
 * Opt-in Ollama smoke test — never part of the normal test/CI path.
 *
 * Boots the API in-process against the test database, registers a throwaway user,
 * creates a room, then runs summarize / suggest / diagram through the real
 * `AI_PROVIDER=ollama` adapter and validates each result contract. Prints the
 * serving mode, model id, latency, and a result excerpt.
 *
 * Requirements: local Postgres with the test DB, and a running Ollama daemon with
 * `OLLAMA_MODEL` available (see `ollama list`).
 *
 * Run: pnpm --filter @collabcanvas/api smoke:ollama
 */
import cookieParser from "cookie-parser";
import request from "supertest";
import * as Y from "yjs";

const emptyBoard = (): string => Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString("base64");

interface Outcome {
  action: string;
  ok: boolean;
  detail: string;
  ms: number;
}

function validate(action: string, body: Record<string, unknown>): { ok: boolean; detail: string } {
  if (action === "summarize") {
    const summary = body.summary;
    const keyPoints = body.keyPoints;
    const ok = typeof summary === "string" && summary.trim().length > 0 && Array.isArray(keyPoints);
    return { ok, detail: ok ? `summary="${String(summary).slice(0, 160)}" keyPoints=${keyPoints.length}` : JSON.stringify(body).slice(0, 300) };
  }
  if (action === "suggest") {
    const ideas = body.ideas;
    const ok = Array.isArray(ideas) && ideas.length >= 3 && ideas.length <= 5;
    return { ok, detail: ok ? `ideas=${ideas.length}` : JSON.stringify(body).slice(0, 300) };
  }
  const shapes = body.shapes;
  const ok =
    Array.isArray(shapes) &&
    shapes.length > 0 &&
    shapes.every(
      (shape: unknown) =>
        !!shape &&
        typeof shape === "object" &&
        ["rect", "ellipse", "sticky", "text", "arrow"].includes(String((shape as { type?: unknown }).type)) &&
        Number.isFinite((shape as { x?: unknown }).x) &&
        Number.isFinite((shape as { y?: unknown }).y),
    );
  return { ok, detail: ok ? `shapes=${shapes.length}` : JSON.stringify(body).slice(0, 300) };
}

async function main(): Promise<number> {
  // Set before the app (and its config) loads; dotenv has already filled the rest.
  process.env.AI_PROVIDER = "ollama";
  process.env.AI_ENABLED = "true";
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";
  delete process.env.REDIS_URL; // keep the smoke run self-contained (in-memory limiter)

  const { Test } = await import("@nestjs/testing");
  const { AppModule } = await import("../src/app.module");
  const { PrismaService } = await import("../src/prisma/prisma.service");
  const { getEnv } = await import("../src/config/env");

  const env = getEnv();
  console.log(`provider=${env.AI_PROVIDER} model=${env.OLLAMA_MODEL} baseUrl=${env.OLLAMA_BASE_URL}`);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  await app.init();
  const http = app.getHttpServer();
  const prisma = app.get(PrismaService);

  const email = `ollama-smoke-${Date.now()}@example.com`;
  let userId: string | undefined;
  let roomId: string | undefined;
  const outcomes: Outcome[] = [];

  try {
    const register = await request(http).post("/api/auth/register").send({ email, password: "password123", name: "Ollama Smoke" });
    if (register.status !== 201) throw new Error(`register failed (${register.status}): ${JSON.stringify(register.body)}`);
    userId = register.body.user.id as string;
    const cookies = (register.headers["set-cookie"] as string[]) ?? [];
    const headers = { Cookie: cookies.join("; ") };

    const room = await request(http).post("/api/rooms").set(headers).send({ name: "Ollama smoke", isPublic: false });
    if (room.status !== 201) throw new Error(`room create failed (${room.status}): ${JSON.stringify(room.body)}`);
    roomId = room.body.id as string;

    const calls: { action: string; payload: Record<string, unknown> }[] = [
      { action: "summarize", payload: { boardBase64: emptyBoard() } },
      { action: "suggest", payload: { boardBase64: emptyBoard() } },
      { action: "diagram", payload: { prompt: "signup, login, dashboard, settings" } },
    ];

    for (const call of calls) {
      const startedAt = Date.now();
      const res = await request(http).post(`/api/rooms/${roomId}/ai`).set(headers).send({ action: call.action, ...call.payload });
      const ms = Date.now() - startedAt;
      const body = res.body as Record<string, unknown>;
      const { ok, detail } = res.status === 200 ? validate(call.action, body) : { ok: false, detail: JSON.stringify(body).slice(0, 300) };
      outcomes.push({ action: call.action, ok: res.status === 200 && ok, detail: `status=${res.status} ${detail}`, ms });
    }
  } finally {
    if (roomId) await prisma.room.deleteMany({ where: { id: roomId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  }

  let failed = 0;
  for (const outcome of outcomes) {
    const mark = outcome.ok ? "PASS" : "FAIL";
    if (!outcome.ok) failed += 1;
    console.log(`${mark} ${outcome.action.padEnd(10)} ${String(outcome.ms).padStart(6)}ms  ${outcome.detail}`);
  }
  if (outcomes.length === 0) {
    console.error("No AI actions ran.");
    return 1;
  }
  console.log(failed === 0 ? "Ollama smoke test passed." : `${failed} action(s) failed.`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`Ollama smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
