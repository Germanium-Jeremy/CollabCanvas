import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, cleanupDb, createTestApp, isTestDbUp, registerUser, type TestUser } from "./helpers";

let app: INestApplication;
let prisma: import("../src/prisma/prisma.service").PrismaService;
let owner: TestUser;
let editor: TestUser;
let stranger: TestUser;

const dbUp = await isTestDbUp();

describe.skipIf(!dbUp)("room CRUD + permission enforcement", () => {
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupDb(prisma);
    owner = await registerUser(app, "rooms-owner@example.com", "Owner");
    editor = await registerUser(app, "rooms-editor@example.com", "Editor");
    stranger = await registerUser(app, "rooms-stranger@example.com", "Stranger");
  });

  afterAll(async () => {
    await cleanupDb(prisma);
    await app.close();
  });

  it("requires authentication", async () => {
    const res = await request(app.getHttpServer()).get("/api/rooms/mine");
    expect(res.status).toBe(401);
  });

  it("creates a room and makes the creator OWNER", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/rooms")
      .set(auth(owner.cookie))
      .send({ name: "Sprint planning", isPublic: false });
    expect(res.status).toBe(201);
    expect(res.body.inviteCode).toBeTruthy();
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].role).toBe("OWNER");
  });

  it("lists the owner's rooms", async () => {
    const res = await request(app.getHttpServer()).get("/api/rooms/mine").set(auth(owner.cookie));
    expect(res.status).toBe(200);
    expect(res.body.some((r: { name: string }) => r.name === "Sprint planning")).toBe(true);
  });

  describe("joining", () => {
    let privateRoomId: string;
    let privateInviteCode: string;
    let publicRoomId: string;

    beforeAll(async () => {
      const [priv, pub] = await Promise.all([
        request(app.getHttpServer()).post("/api/rooms").set(auth(owner.cookie)).send({ name: "Private", isPublic: false }),
        request(app.getHttpServer()).post("/api/rooms").set(auth(owner.cookie)).send({ name: "Public", isPublic: true }),
      ]);
      privateRoomId = priv.body.id;
      privateInviteCode = priv.body.inviteCode;
      publicRoomId = pub.body.id;
    });

    it("denies joining a private room without a code", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${privateRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({});
      expect(res.status).toBe(403);
    });

    it("denies joining a private room with a wrong code", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${privateRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({ code: "nope" });
      expect(res.status).toBe(403);
    });

    it("joins a private room with the invite code as EDITOR", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${privateRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({ code: privateInviteCode });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("EDITOR");
    });

    it("joins a public room without a code", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${publicRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("EDITOR");
    });

    it("hides the invite code from non-owners on GET", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/rooms/${privateRoomId}`)
        .set(auth(stranger.cookie));
      expect(res.status).toBe(200);
      expect(res.body.inviteCode).toBeNull();
    });
  });

  describe("permission boundaries", () => {
    let roomId: string;
    let viewer: TestUser;

    beforeAll(async () => {
      const room = await request(app.getHttpServer())
        .post("/api/rooms")
        .set(auth(owner.cookie))
        .send({ name: "Boundary room", isPublic: true });
      roomId = room.body.id;
      viewer = await registerUser(app, "rooms-viewer@example.com", "Viewer");
      // Role assignment targets existing members only — the viewer joins first,
      // matching the real app flow (join, then the owner adjusts the role).
      await request(app.getHttpServer()).post(`/api/rooms/${roomId}/join`).set(auth(viewer.cookie)).send({});
      const res = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/members`)
        .set(auth(owner.cookie))
        .send({ userId: viewer.id, role: "VIEWER" });
      expect(res.status).toBe(200);
    });

    it("viewers can read the room", async () => {
      const res = await request(app.getHttpServer()).get(`/api/rooms/${roomId}`).set(auth(viewer.cookie));
      expect(res.status).toBe(200);
      expect(res.body.role).toBe("VIEWER");
    });

    it("viewers cannot update the room", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}`)
        .set(auth(viewer.cookie))
        .send({ name: "Hacked" });
      expect(res.status).toBe(403);
    });

    it("viewers cannot delete the room", async () => {
      const res = await request(app.getHttpServer()).delete(`/api/rooms/${roomId}`).set(auth(viewer.cookie));
      expect(res.status).toBe(403);
    });

    it("viewers cannot manage members", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/members`)
        .set(auth(viewer.cookie))
        .send({ userId: editor.id, role: "VIEWER" });
      expect(res.status).toBe(403);
    });

    it("editors can read but not update the room", async () => {
      await request(app.getHttpServer()).post(`/api/rooms/${roomId}/join`).set(auth(editor.cookie)).send({});
      const get = await request(app.getHttpServer()).get(`/api/rooms/${roomId}`).set(auth(editor.cookie));
      expect(get.status).toBe(200);

      const patch = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}`)
        .set(auth(editor.cookie))
        .send({ name: "Nope" });
      expect(patch.status).toBe(403);
    });

    it("owners can rename the room", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}`)
        .set(auth(owner.cookie))
        .send({ name: "Renamed" });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Renamed");
    });

    it("users cannot change their own role", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/members`)
        .set(auth(owner.cookie))
        .send({ userId: owner.id, role: "EDITOR" });
      expect(res.status).toBe(400);
    });

    it("members can report a room", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/report`)
        .set(auth(editor.cookie))
        .send({ reason: "spam" });
      expect(res.status).toBe(201);
    });

    it("only owners can block users", async () => {
      const blocked = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/block/${viewer.id}`)
        .set(auth(owner.cookie));
      expect(blocked.status).toBe(201);

      const denied = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/block/${viewer.id}`)
        .set(auth(editor.cookie));
      expect(denied.status).toBe(403);
    });

    it("soft-deleted rooms are inaccessible to everyone", async () => {
      const room = await request(app.getHttpServer())
        .post("/api/rooms")
        .set(auth(owner.cookie))
        .send({ name: "Doomed", isPublic: true });
      const id = room.body.id as string;

      const del = await request(app.getHttpServer()).delete(`/api/rooms/${id}`).set(auth(owner.cookie));
      expect(del.status).toBe(200);

      const get = await request(app.getHttpServer()).get(`/api/rooms/${id}`).set(auth(owner.cookie));
      expect(get.status).toBe(404);
    });
  });
});
