import type { INestApplication } from "@nestjs/common";
import * as Y from "yjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvForTests } from "../src/config/env";
import { auth, cleanupDb, createTestApp, isTestDbUp, registerUser, type TestUser } from "./helpers";

let app: INestApplication;
let prisma: import("../src/prisma/prisma.service").PrismaService;
let user: TestUser;
let roomId: string;

const dbUp = await isTestDbUp();

const emptyBoardBase64 = (): string => Buffer.from(Y.encodeStateAsUpdate(new Y.Doc())).toString("base64");

async function callAi(action: string, extra: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post(`/api/rooms/${roomId}/ai`)
    .set(auth(user.cookie))
    .send({ action, ...extra });
}

describe.skipIf(!dbUp)("AI proxy (mock provider)", () => {
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupDb(prisma);
    user = await registerUser(app, "ai-user@example.com", "AI User");
    const room = await request(app.getHttpServer())
      .post("/api/rooms")
      .set(auth(user.cookie))
      .send({ name: "AI room", isPublic: true });
    roomId = room.body.id;
  });

  afterAll(async () => {
    await cleanupDb(prisma);
    await app.close();
    resetEnvForTests();
  });

  it("summarizes a board deterministically", async () => {
    const res = await callAi("summarize", { boardBase64: emptyBoardBase64() });
    expect(res.status).toBe(200);
    expect(res.body.summary).toContain("empty");
    expect(Array.isArray(res.body.keyPoints)).toBe(true);
  });

  it("generates diagram shapes from a prompt", async () => {
    const res = await callAi("diagram", { prompt: "signup, login, dashboard, settings" });
    expect(res.status).toBe(200);
    expect(res.body.shapes.length).toBeGreaterThanOrEqual(4);
    expect(res.body.shapes[0].type).toBe("sticky");
  });

  it("rejects invalid actions via schema validation", async () => {
    const res = await callAi("deleteEverything");
    expect(res.status).toBe(400);
  });

  it("returns 429 after 5 AI actions in an hour (cost control)", async () => {
    // Fresh user: the AI quota is per user and the tests above consumed some of it.
    const limitUser = await registerUser(app, "ai-limit@example.com", "Limit");
    const room = await request(app.getHttpServer())
      .post("/api/rooms")
      .set(auth(limitUser.cookie))
      .send({ name: "Limit room", isPublic: true });
    const limitRoomId = room.body.id;

    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${limitRoomId}/ai`)
        .set(auth(limitUser.cookie))
        .send({ action: "summarize" });
      expect(res.status).toBe(200);
    }
    const sixth = await request(app.getHttpServer())
      .post(`/api/rooms/${limitRoomId}/ai`)
      .set(auth(limitUser.cookie))
      .send({ action: "summarize" });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toBe("ai_rate_limited");
  });

  it("denies viewers access to AI actions", async () => {
    // New app + room to escape the rate limit reached above.
    await app.close();
    ({ app, prisma } = await createTestApp());
    await cleanupDb(prisma);
    const owner = await registerUser(app, "ai-owner2@example.com", "Owner2");
    const viewer = await registerUser(app, "ai-viewer@example.com", "Viewer2");
    const room = await request(app.getHttpServer())
      .post("/api/rooms")
      .set(auth(owner.cookie))
      .send({ name: "AI perms", isPublic: true });
    await request(app.getHttpServer())
      .patch(`/api/rooms/${room.body.id}/members`)
      .set(auth(owner.cookie))
      .send({ userId: viewer.id, role: "VIEWER" });

    const res = await request(app.getHttpServer())
      .post(`/api/rooms/${room.body.id}/ai`)
      .set(auth(viewer.cookie))
      .send({ action: "summarize" });
    expect(res.status).toBe(403);
  });

  it("degrades gracefully when AI is disabled (503, board still usable)", async () => {
    process.env.AI_ENABLED = "false";
    resetEnvForTests();
    await app.close();
    ({ app, prisma } = await createTestApp());
    await cleanupDb(prisma);
    user = await registerUser(app, "ai-disabled@example.com", "Disabled");
    const room = await request(app.getHttpServer())
      .post("/api/rooms")
      .set(auth(user.cookie))
      .send({ name: "Disabled room", isPublic: true });
    roomId = room.body.id;

    const res = await callAi("summarize");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("ai_disabled");

    // Restore for other suites.
    process.env.AI_ENABLED = "true";
    resetEnvForTests();
  });
});
