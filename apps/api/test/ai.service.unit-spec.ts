import { HttpException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { AI_RATE_LIMIT_PER_HOUR } from "@collabcanvas/shared";
import { AiService } from "../src/ai/ai.service";
import { MockAiProvider, type AiProvider } from "../src/ai/ai.providers";
import type { PrismaService } from "../src/prisma/prisma.service";
import type { RateLimitResult, RateLimitService } from "../src/common/rate-limit.service";
import { resetEnvForTests } from "../src/config/env";

const emptyBoard = (): string => Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString("base64");

function failingProvider(): AiProvider {
  return {
    name: "failing",
    summarize: vi.fn().mockRejectedValue(new Error("503 upstream unavailable")),
    suggest: vi.fn().mockRejectedValue(new Error("503 upstream unavailable")),
    diagram: vi.fn().mockRejectedValue(new Error("503 upstream unavailable")),
  };
}

/** Test doubles only cover what AiService touches: one room lookup and one rate-limit check. */
function makeService(overrides: { provider?: AiProvider; rateLimit?: RateLimitResult } = {}) {
  const prisma = { room: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaService;
  const rateLimiter = {
    check: vi.fn().mockResolvedValue(overrides.rateLimit ?? { ok: true, remaining: 5, retryAfterSeconds: 0 }),
  } as unknown as RateLimitService;
  const provider = overrides.provider ?? new MockAiProvider();
  return { service: new AiService(prisma, rateLimiter, provider), prisma, rateLimiter, provider };
}

async function expectHttpError(promise: Promise<unknown>, status: number, error: string): Promise<HttpException> {
  const caught = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(caught).toBeInstanceOf(HttpException);
  const exception = caught as HttpException;
  expect(exception.getStatus()).toBe(status);
  expect(exception.getResponse()).toMatchObject({ error });
  return exception;
}

describe("AiService", () => {
  beforeEach(() => {
    process.env.AI_ENABLED = "true";
    process.env.AI_PROVIDER = "mock";
    resetEnvForTests();
  });

  afterEach(() => {
    process.env.AI_ENABLED = "true";
    process.env.AI_PROVIDER = "mock";
    resetEnvForTests();
  });

  it("returns provider results and reuses the client-sent board context", async () => {
    const { service, prisma } = makeService();
    const result = await service.run("room-1", "user-1", { action: "summarize", boardBase64: emptyBoard() });
    expect(result).toHaveProperty("summary");
    expect(prisma.room.findUnique).not.toHaveBeenCalled();
  });

  it("falls back to the persisted snapshot when the client sends no board state", async () => {
    const { service, prisma } = makeService();
    const result = await service.run("room-1", "user-1", { action: "summarize" });
    expect(result).toHaveProperty("summary");
    expect(prisma.room.findUnique).toHaveBeenCalledWith({ where: { id: "room-1" } });
  });

  it("returns 503 ai_disabled when the feature flag is off", async () => {
    process.env.AI_ENABLED = "false";
    resetEnvForTests();
    const { service } = makeService();
    await expectHttpError(service.run("room-1", "user-1", { action: "summarize" }), 503, "ai_disabled");
  });

  it("returns 429 ai_rate_limited with a retry hint when the hourly quota is spent", async () => {
    const { service, rateLimiter } = makeService({
      rateLimit: { ok: false, remaining: 0, retryAfterSeconds: 1800 },
    });
    const exception = await expectHttpError(service.run("room-1", "user-1", { action: "summarize" }), 429, "ai_rate_limited");
    expect(exception.getResponse()).toMatchObject({ retryAfterSeconds: 1800 });
    expect(rateLimiter.check).toHaveBeenCalledWith("ai:user-1", AI_RATE_LIMIT_PER_HOUR, 60 * 60 * 1000);
  });

  it("turns provider failures into a controlled 503 instead of surfacing provider details", async () => {
    const { service } = makeService({ provider: failingProvider() });
    await expectHttpError(service.run("room-1", "user-1", { action: "summarize", boardBase64: emptyBoard() }), 503, "ai_unavailable");
  });

  it("checks the rate limit before calling the provider (cost control)", async () => {
    const provider = failingProvider();
    const { service } = makeService({ provider, rateLimit: { ok: false, remaining: 0, retryAfterSeconds: 60 } });
    await expectHttpError(service.run("room-1", "user-1", { action: "diagram", prompt: "a" }), 429, "ai_rate_limited");
    expect(provider.diagram).not.toHaveBeenCalled();
  });
});
