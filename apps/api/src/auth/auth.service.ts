import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { AUTH_COOKIE_NAME, type JwtPayload } from "@collabcanvas/shared";
import bcrypt from "bcryptjs";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { getEnv } from "../config/env";
import { PrismaService } from "../prisma/prisma.service";
import type { LoginInput, RegisterInput } from "@collabcanvas/shared";

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

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

@Injectable()
export class AuthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  signToken(user: { id: string; email: string; name: string | null }): string {
    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name ?? undefined };
    return jwt.sign(payload, getEnv().JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  }

  setAuthCookie(response: Response, token: string): void {
    response.cookie(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: getEnv().NODE_ENV === "production",
      maxAge: TOKEN_TTL_SECONDS * 1000,
      path: "/",
    });
  }

  clearAuthCookie(response: Response): void {
    response.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  }

  toUserDto(user: { id: string; email: string; name: string | null; image: string | null }): AuthUserDto {
    return { id: user.id, email: user.email, name: user.name, image: user.image };
  }

  async register(dto: RegisterInput): Promise<{ user: AuthUserDto; token: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new ConflictException({ error: "email_taken" });

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email.toLowerCase(), name: dto.name, passwordHash },
    });
    return { user: this.toUserDto(user), token: this.signToken(user) };
  }

  async login(dto: LoginInput): Promise<{ user: AuthUserDto; token: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    // Uniform error + dummy compare to avoid leaking which emails exist via timing.
    const hash = user?.passwordHash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid123456";
    const valid = await bcrypt.compare(dto.password, hash);
    if (!user || !user.passwordHash || !valid) {
      throw new UnauthorizedException({ error: "invalid_credentials" });
    }
    return { user: this.toUserDto(user), token: this.signToken(user) };
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
