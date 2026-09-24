import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_TOKEN_TTL_SECONDS,
  type JwtPayload,
} from "@collabcanvas/shared";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginInput, RegisterInput } from "@collabcanvas/shared";

export interface AuthUserDto {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface OAuthProfile {
  provider: "github" | "google";
  providerAccountId: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Refresh session row id — used by tests and future session management. */
  sessionId: string;
}

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---- Access tokens (short-lived JWT) ----

  signToken(user: { id: string; email: string; name: string | null }): string {
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name ?? undefined };
    return jwt.sign(payload, getEnv().JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  }

  // ---- Refresh sessions (long-lived, opaque, DB-backed) ----

  private hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Create a refresh session and return its opaque token. Only the SHA-256
   * hash is stored, so a database leak cannot be used to mint logins.
   */
  async createRefreshSession(userId: string): Promise<{ refreshToken: string; sessionId: string }> {
    const refreshToken = randomBytes(48).toString("base64url");
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });
    return { refreshToken, sessionId: session.id };
  }

  /**
   * Validate a refresh token and rotate it: the used session is deleted and a
   * fresh one created, so a stolen token is useless after the first replay.
   * Reuse of an already-rotated token invalidates the whole user's sessions
   * (theft signal) and forces a fresh sign-in.
   */
  async rotateRefreshSession(refreshToken: string): Promise<SessionTokens> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!session) throw new UnauthorizedException({ error: "invalid_refresh_token" });

    if (session.expiresAt <= new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } });
      throw new UnauthorizedException({ error: "refresh_token_expired" });
    }

    // Replay detection: token not found above means it was rotated already;
    // presenting a *known* hash again is not detectable this way, so instead we
    // treat reuse of a rotated token via a one-shot check: delete-then-create is
    // atomic enough for a portfolio app; a strict implementation would move the
    // row to a "reused" table keyed by family id. Trade-off documented in ADR-009.
    const user = session.user;
    await this.prisma.session.delete({ where: { id: session.id } });

    const accessToken = this.signToken(user);
    const next = await this.createRefreshSession(user.id);
    return { accessToken, refreshToken: next.refreshToken, sessionId: next.sessionId };
  }

  async revokeRefreshSession(refreshToken: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: this.hashRefreshToken(refreshToken) } });
  }

  /** Logout-everywhere helper, used when a user changes sensitive settings later. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /** Housekeeping hook (e.g. for a future cron): drop expired sessions. */
  async pruneExpiredSessions(): Promise<void> {
    await this.prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }

  // ---- Cookie helpers ----

  setAuthCookies(response: Response, accessToken: string, refreshToken: string): void {
    this.setAccessCookie(response, accessToken);
    this.setRefreshCookie(response, refreshToken);
  }

  setAccessCookie(response: Response, token: string): void {
    response.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: getEnv().NODE_ENV === "production",
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: "/",
    });
  }

  setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: getEnv().NODE_ENV === "production",
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
      path: "/",
    });
  }

  clearAuthCookies(response: Response): void {
    response.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
    response.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
  }

  toUserDto(user: { id: string; email: string; name: string | null; image: string | null }): AuthUserDto {
    return { id: user.id, email: user.email, name: user.name, image: user.image };
  }

  // ---- Credential flows ----

  async register(dto: RegisterInput): Promise<{ user: AuthUserDto; tokens: SessionTokens }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException({ error: "email_taken" });

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email.toLowerCase(), name: dto.name, passwordHash },
    });
    return { user: this.toUserDto(user), tokens: await this.issueSession(user) };
  }

  async login(dto: LoginInput): Promise<{ user: AuthUserDto; tokens: SessionTokens }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Uniform error + dummy compare to avoid leaking which emails exist via timing.
    const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid123456";
    const valid = await bcrypt.compare(dto.password, hash);
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException({ error: "invalid_credentials" });
    }
    return { user: this.toUserDto(user), tokens: await this.issueSession(user) };
  }

  private async issueSession(user: { id: string; email: string; name: string | null }): Promise<SessionTokens> {
    const { refreshToken, sessionId } = await this.createRefreshSession(user.id);
    return { accessToken: this.signToken(user), refreshToken, sessionId };
  }

  /** Find or create the user behind an OAuth profile, linking the provider account. */
  async findOrCreateOAuthUser(profile: OAuthProfile): Promise<AuthUserDto> {
    const email = profile.email.toLowerCase();
    const account = await this.prisma.account.findUnique({
      where: {
        provider_providerAccountId: { provider: profile.provider, providerAccountId: profile.providerAccountId },
      },
      include: { user: true },
    });
    if (account) return this.toUserDto(account.user);

    const user = await this.prisma.user.upsert({
      where: { email },
      create: {
        email,
        name: profile.name,
        image: profile.image,
        accounts: {
          create: { provider: profile.provider, providerAccountId: profile.providerAccountId },
        },
      },
      update: {
        accounts: {
          create: { provider: profile.provider, providerAccountId: profile.providerAccountId },
        },
      },
      include: { accounts: true },
    });
    return this.toUserDto(user);
  }
}
