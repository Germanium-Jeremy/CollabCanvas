import { INestApplication } from "@nestjs/common";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv, resetEnvForTests } from "../src/config/env";
import { auth, cleanupDb, createTestApp, isTestDbUp, registerUser, type TestUser } from "./helpers";

let app: INestApplication;
let prisma: import("../src/prisma/prisma.service").PrismaService;
let user: TestUser;

const dbUp = await isTestDbUp();

/** Extract a cookie value from supertest's set-cookie header array. */
function cookieValue(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
  for (const cookie of all) {
    const [pair] = cookie.split(";");
    const [key, value] = pair?.split("=") ?? [];
    if (key === name) return value;
  }
  return undefined;
}

describe.skipIf(!dbUp)("auth flows", () => {
  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanupDb(prisma);
    user = await registerUser(app, "auth-alice@example.com", "Alice");
  });

  afterAll(async () => {
    await cleanupDb(prisma);
    await app.close();
    resetEnvForTests();
  });

  it("GET /health is public and reports db status", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.db).toBe("up");
  });

  it("GET /auth/me returns the session user", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/me").set(auth(user.cookie));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("auth-alice@example.com");
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("GET /auth/me without a session is 401", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects duplicate registrations", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/register")
      .send({ email: "auth-alice@example.com", password: "password123", name: "Alice 2" });
    expect(res.status).toBe(409);
  });

  it("login with the right password returns a token and sets both session cookies", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "auth-alice@example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    expect(cookieValue(setCookie, "cc_token")).toBeTruthy();
    expect(cookieValue(setCookie, "cc_refresh")).toBeTruthy();
  });

  it("POST /auth/refresh rotates the refresh session and re-issues cookies", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "auth-alice@example.com", password: "password123" });
    const firstRefresh = cookieValue(login.headers["set-cookie"], "cc_refresh");
    expect(firstRefresh).toBeTruthy();

    const res = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", `cc_refresh=${firstRefresh}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("auth-alice@example.com");
    const secondRefresh = cookieValue(res.headers["set-cookie"], "cc_refresh");
    expect(secondRefresh).toBeTruthy();
    expect(secondRefresh).not.toBe(firstRefresh);

    // Old token was rotated away: replaying it must fail.
    const replay = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", `cc_refresh=${firstRefresh}`);
    expect(replay.status).toBe(401);
  });

  it("POST /auth/refresh without a refresh cookie is 401", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("logout revokes the refresh session server-side", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "auth-alice@example.com", password: "password123" });
    const refresh = cookieValue(login.headers["set-cookie"], "cc_refresh");

    await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Cookie", `cc_refresh=${refresh}`);

    const res = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .set("Cookie", `cc_refresh=${refresh}`);
    expect(res.status).toBe(401);
  });

  it("login with the wrong password is 401", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "auth-alice@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
  });

  it("logout clears the session cookies", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/logout").set(auth(user.cookie));
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    const cleared = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie ?? "");
    expect(cleared).toContain("cc_token=;");
    expect(cleared).toContain("cc_refresh=;");
  });

  it("GET /auth/token returns a valid session JWT for realtime connections", async () => {
    const res = await request(app.getHttpServer()).get("/api/auth/token").set(auth(user.cookie));
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, getEnv().JWT_SECRET) as { sub: string };
    expect(payload.sub).toBe(user.id);
  });

  it("rate limits login attempts per IP", async () => {
    // Fresh app instance keeps the limiter deterministic for this test.
    resetEnvForTests();
    const { app: freshApp, prisma: freshPrisma } = await createTestApp();
    try {
      for (let i = 0; i < 20; i++) {
        await request(freshApp.getHttpServer())
          .post("/api/auth/login")
          .send({ email: "nobody@example.com", password: "wrongpassword" });
      }
      const res = await request(freshApp.getHttpServer())
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "wrongpassword" });
      expect(res.status).toBe(429);
    } finally {
      await freshApp.close();
      await cleanupDb(freshPrisma);
    }
  });

  it("OAuth start without configured credentials returns a clear error", async () => {
    // Hermetic: a developer's real .env may configure OAuth, so build a fresh
    // app with the credentials explicitly blanked.
    process.env.GITHUB_CLIENT_ID = "";
    process.env.GITHUB_CLIENT_SECRET = "";
    resetEnvForTests();
    const { app: freshApp } = await createTestApp();
    try {
      const res = await request(freshApp.getHttpServer()).get("/api/auth/oauth/github");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("oauth_not_configured");
    } finally {
      await freshApp.close();
    }
  });
});
