import type { INestApplication } from "@nestjs/common";
import * as Y from "yjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bytesToBase64, encodeDocToBase64 } from "@collabcanvas/yjs-utils";
import { auth, cleanupDb, createTestApp, isTestDbUp, registerUser, type TestUser } from "./helpers";

let app: INestApplication;
let prisma: import("../src/prisma/prisma.service").PrismaService;
let editor: TestUser;
let viewer: TestUser;
let roomId: string;

const dbUp = await isTestDbUp();

function boardWithRect(): string {
  const doc = new Y.Doc();
  doc.getMap("elements").set("r1", {
    id: "r1",
    type: "rect",
    createdBy: "u1",
    createdAt: 1,
    z: 0,
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: "#3b82f6",
  });
  const base64 = encodeDocToBase64(doc);
  doc.destroy();
  return base64;
}

describe.skipIf(!dbUp)("board snapshots", () => {
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupDb(prisma);
    editor = await registerUser(app, "snap-editor@example.com", "Editor");
    viewer = await registerUser(app, "snap-viewer@example.com", "Viewer");
    const room = await request(app.getHttpServer())
      .post("/api/rooms")
      .set(auth(editor.cookie))
      .send({ name: "Snapshot room", isPublic: true });
    roomId = room.body.id;
    await request(app.getHttpServer())
      .patch(`/api/rooms/${roomId}/members`)
      .set(auth(editor.cookie))
      .send({ userId: viewer.id, role: "VIEWER" });
  });

  afterAll(async () => {
    await cleanupDb(prisma);
    await app.close();
  });

  it("saves snapshots with incrementing versions", async () => {
    const first = await request(app.getHttpServer())
      .post(`/api/rooms/${roomId}/snapshots`)
      .set(auth(editor.cookie))
      .send({ data: boardWithRect(), label: "initial" });
    expect(first.status).toBe(201);
    expect(first.body.version).toBe(1);

    const second = await request(app.getHttpServer())
      .post(`/api/rooms/${roomId}/snapshots`)
      .set(auth(editor.cookie))
      .send({ data: boardWithRect() });
    expect(second.body.version).toBe(2);
  });

  it("lists snapshots newest first without data payload", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/rooms/${roomId}/snapshots`)
      .set(auth(viewer.cookie));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].version).toBe(2);
    expect(res.body[0]).not.toHaveProperty("data");
  });

  it("viewers can read but not create snapshots", async () => {
    const denied = await request(app.getHttpServer())
      .post(`/api/rooms/${roomId}/snapshots`)
      .set(auth(viewer.cookie))
      .send({ data: boardWithRect() });
    expect(denied.status).toBe(403);

    const read = await request(app.getHttpServer())
      .get(`/api/rooms/${roomId}/snapshots`)
      .set(auth(viewer.cookie));
    expect(read.status).toBe(200);
  });

  it("returns snapshot data for restore", async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/rooms/${roomId}/snapshots`)
      .set(auth(editor.cookie));
    const newest = list.body[0];

    const res = await request(app.getHttpServer())
      .get(`/api/rooms/${roomId}/snapshots/${newest.id}`)
      .set(auth(editor.cookie));
    expect(res.status).toBe(200);
    expect(typeof res.body.data).toBe("string");
    // Round-trip sanity: data is valid base64 of a Yjs update.
    expect(bytesToBase64(Buffer.from(res.body.data, "base64"))).toBe(res.body.data);
  });

  it("keeps only the newest 50 snapshots per room", async () => {
    for (let i = 0; i < 52; i++) {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/snapshots`)
        .set(auth(editor.cookie))
        .send({ data: boardWithRect(), label: `bulk-${i}` });
      expect(res.status).toBe(201);
    }
    const list = await request(app.getHttpServer())
      .get(`/api/rooms/${roomId}/snapshots`)
      .set(auth(editor.cookie));
    expect(list.body.length).toBeLessThanOrEqual(50);
    expect(list.body[0].version).toBe(54); // versions 1..54 created; 1..4 pruned
  });
});
