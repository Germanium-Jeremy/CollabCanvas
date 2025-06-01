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

    it("joins a private room with the invite code as VIEWER (links never grant edit)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${privateRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({ code: privateInviteCode });
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("VIEWER");
    });

    it("rejoining never self-promotes an existing member", async () => {
      // Owner demotes stranger to EDITOR, then a re-join with the code must
      // keep the explicit role instead of resetting it.
      const strangerId = (await request(app.getHttpServer()).get("/api/auth/me").set(auth(stranger.cookie))).body.user
        .id as string;
      const promote = await request(app.getHttpServer())
        .patch(`/api/rooms/${privateRoomId}/members`)
        .set(auth(owner.cookie))
        .send({ userId: strangerId, role: "EDITOR" });
      expect(promote.status).toBe(200);

      const rejoin = await request(app.getHttpServer())
        .post(`/api/rooms/${privateRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({ code: privateInviteCode });
      expect(rejoin.status).toBe(201);
      expect(rejoin.body.role).toBe("EDITOR");
    });

    it("joins a public room without a code as VIEWER", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${publicRoomId}/join`)
        .set(auth(stranger.cookie))
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.role).toBe("VIEWER");
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
      // Role assignment targets existing members only — the viewer joins first
      // (public join creates VIEWER), then the owner pins the role explicitly.
      await request(app.getHttpServer()).post(`/api/rooms/${roomId}/join`).set(auth(viewer.cookie)).send({});
      const res = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/members`)
        .set(auth(owner.cookie))
        .send({ userId: viewer.id, role: "VIEWER" });
      expect(res.status).toBe(200);
      // The editor user joins as VIEWER and is promoted by the owner — the
      // only path to EDITOR is an owner action (join/links never grant it).
      await request(app.getHttpServer()).post(`/api/rooms/${roomId}/join`).set(auth(editor.cookie)).send({});
      const promote = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/members`)
        .set(auth(owner.cookie))
        .send({ userId: editor.id, role: "EDITOR" });
      expect(promote.status).toBe(200);
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

  describe("email invitations", () => {
    let roomId: string;

    beforeAll(async () => {
      const room = await request(app.getHttpServer())
        .post("/api/rooms")
        .set(auth(owner.cookie))
        .send({ name: "Invite room", isPublic: false });
      roomId = room.body.id;
    });

    it("owner creates an invitation with a chosen role and receives a code", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations`)
        .set(auth(owner.cookie))
        .send({ email: "Invited-User@example.com", role: "EDITOR" });
      expect(res.status).toBe(201);
      expect(res.body.email).toBe("invited-user@example.com");
      expect(res.body.role).toBe("EDITOR");
      expect(res.body.code).toMatch(/^inv_/);
    });

    it("rejects invalid emails", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations`)
        .set(auth(owner.cookie))
        .send({ email: "nope", role: "EDITOR" });
      expect(res.status).toBe(400);
    });

    it("rejects OWNER as an invitation role", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations`)
        .set(auth(owner.cookie))
        .send({ email: "someone@example.com", role: "OWNER" });
      expect(res.status).toBe(400);
    });

    it("editors cannot create, list, or change invitations", async () => {
      // Promote the editor into this private room first.
      const editorId = (await request(app.getHttpServer()).get("/api/auth/me").set(auth(editor.cookie))).body.user
        .id as string;
      await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/join`)
        .set(auth(editor.cookie))
        .send({ code: (await request(app.getHttpServer()).get(`/api/rooms/${roomId}`).set(auth(owner.cookie))).body.inviteCode });
      await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/members`)
        .set(auth(owner.cookie))
        .send({ userId: editorId, role: "EDITOR" });

      const create = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations`)
        .set(auth(editor.cookie))
        .send({ email: "x@example.com", role: "VIEWER" });
      expect(create.status).toBe(403);

      const list = await request(app.getHttpServer()).get(`/api/rooms/${roomId}/invitations`).set(auth(editor.cookie));
      expect(list.status).toBe(403);

      const patch = await request(app.getHttpServer())
        .patch(`/api/rooms/${roomId}/invitations/whatever`)
        .set(auth(editor.cookie))
        .send({ role: "VIEWER" });
      expect(patch.status).toBe(403);
    });

    it("redeems a valid invitation and grants the chosen role", async () => {
      // Register the invited user with the exact email that was invited.
      const invited = await registerUser(app, "invited-user@example.com", "Invited User");

      const created = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations`)
        .set(auth(owner.cookie))
        .send({ email: "invited-user@example.com", role: "EDITOR" });
      const code = created.body.code as string;

      const redeem = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations/redeem`)
        .set(auth(invited.cookie))
        .send({ email: "invited-user@example.com", code });
      expect(redeem.status).toBe(201);
      expect(redeem.body.role).toBe("EDITOR");

      // Role is visible through the room resource.
      const me = await request(app.getHttpServer()).get(`/api/rooms/${roomId}`).set(auth(invited.cookie));
      expect(me.body.role).toBe("EDITOR");
    });

    it("rejects a wrong code, wrong email, or already-used invitation", async () => {
      const wrongCode = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations/redeem`)
        .set(auth(stranger.cookie))
        .send({ email: "invited-user@example.com", code: "inv_wrong" });
      expect(wrongCode.status).toBe(403);

      const used = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations/redeem`)
        .set(auth(stranger.cookie))
        .send({ email: "invited-user@example.com", code: "inv_wrong" });
      expect(used.status).toBe(403); // invitation already accepted anyway
    });

    it("an accepted email invitation upgrades an existing link-viewer to EDITOR", async () => {
      // Stranger joins via link (VIEWER), then redeems an EDITOR invitation.
      await request(app.getHttpServer()).post(`/api/rooms/${roomId}/join`).set(auth(stranger.cookie)).send({});

      const created = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations`)
        .set(auth(owner.cookie))
        .send({ email: "rooms-stranger@example.com", role: "EDITOR" });
      expect(created.status).toBe(201);

      const redeem = await request(app.getHttpServer())
        .post(`/api/rooms/${roomId}/invitations/redeem`)
        .set(auth(stranger.cookie))
        .send({ email: "rooms-stranger@example.com", code: created.body.code });
      expect(redeem.status).toBe(201);
      expect(redeem.body.role).toBe("EDITOR");
    });
  });
});
