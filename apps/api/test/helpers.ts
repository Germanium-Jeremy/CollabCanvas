import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

export interface TestUser {
  id: string;
  email: string;
  cookie: string[];
}

export async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix("api");
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

let dbUpCache: boolean | null = null;

export async function isTestDbUp(): Promise<boolean> {
  if (dbUpCache === null) {
    const probe = new PrismaClient();
    try {
      await probe.$queryRaw`SELECT 1`;
      dbUpCache = true;
    } catch {
      dbUpCache = false;
    } finally {
      await probe.$disconnect();
    }
  }
  return dbUpCache;
}

export async function cleanupDb(prisma: PrismaService): Promise<void> {
  // FK-safe deletion order.
  await prisma.block.deleteMany();
  await prisma.report.deleteMany();
  await prisma.snapshot.deleteMany();
  await prisma.roomMember.deleteMany();
  await prisma.room.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
}

export async function registerUser(
  app: INestApplication,
  email: string,
  name = email.split("@")[0] ?? email,
): Promise<TestUser> {
  const res = await request(app.getHttpServer())
    .post("/api/auth/register")
    .send({ email, password: "password123", name });
  if (res.status !== 201) throw new Error(`register failed (${res.status}): ${JSON.stringify(res.body)}`);
  const setCookie = res.headers["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
  return { id: res.body.user.id as string, email, cookie: cookies };
}

export function auth(cookie: string[]): Record<string, string> {
  return { Cookie: cookie.join("; ") };
}
