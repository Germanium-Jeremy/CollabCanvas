import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { AUTH_RATE_LIMIT_PER_15MIN, REFRESH_COOKIE_NAME } from "@collabcanvas/shared";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { getEnv } from "../config/env";
import { CurrentUser, Public } from "../common/auth.decorators";
import { RateLimitService } from "../common/rate-limit.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";
import { buildAuthorizeUrl, fetchOAuthProfile, oauthStateCookie, type OAuthProviderName } from "./oauth.providers";
import { loginSchema, registerSchema, type LoginInput, type RegisterInput } from "@collabcanvas/shared";

@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimiter: RateLimitService,
  ) {}

  @Public()
  @Post("register")
  async register(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterInput,
  ) {
    await this.assertAuthRateLimit(request);
    const { user, tokens } = await this.auth.register(dto);
    this.auth.setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
    return { user, token: tokens.accessToken };
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
  ) {
    await this.assertAuthRateLimit(request);
    const { user, tokens } = await this.auth.login(dto);
    this.auth.setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
    return { user, token: tokens.accessToken };
  }

  /**
   * Silent session renewal: rotates the refresh session and re-issues both
   * cookies. The web client calls this transparently when an access token
   * expires (single-flight, retried once per request).
   */
  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) throw new UnauthorizedException({ error: "no_refresh_token" });
    const tokens = await this.auth.rotateRefreshSession(refreshToken);
    this.auth.setAuthCookies(response, tokens.accessToken, tokens.refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: this.readSubject(tokens.accessToken) } });
    if (!user) throw new UnauthorizedException({ error: "invalid_refresh_token" });
    return { user: this.auth.toUserDto(user) };
  }

  private readSubject(accessToken: string): string {
    const payload = jwt.decode(accessToken) as { sub?: string } | null;
    if (!payload?.sub) throw new UnauthorizedException({ error: "invalid_refresh_token" });
    return payload.sub;
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) await this.auth.revokeRefreshSession(refreshToken);
    this.auth.clearAuthCookies(response);
    return { ok: true };
  }

  @Get("me")
  async me(@CurrentUser() user: { sub: string }) {
    const profile = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!profile) return { user: null };
    return { user: this.auth.toUserDto(profile) };
  }

  /** Returns the session JWT so the client can authenticate realtime websocket connections. */
  @Get("token")
  token(@CurrentUser() user: { sub: string; email: string; name?: string }) {
    return { token: this.auth.signToken({ id: user.sub, email: user.email, name: user.name ?? null }) };
  }

  // ---- OAuth ----

  @Public()
  @Get("oauth/:provider")
  startOAuth(@Param("provider") provider: OAuthProviderName, @Req() request: Request, @Res() response: Response) {
    if (provider !== "github" && provider !== "google") {
      throw new BadRequestException({ error: "unknown_provider" });
    }
    const state = randomUUID();
    response.cookie(oauthStateCookie.name, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: getEnv().NODE_ENV === "production",
      maxAge: oauthStateCookie.maxAge,
      path: "/",
    });
    response.redirect(302, buildAuthorizeUrl(provider, state));
  }

  @Public()
  @Get("oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") provider: OAuthProviderName,
    @Query("code") code: string,
    @Query("state") state: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const webOrigin = getEnv().WEB_ORIGIN.split(",")[0]?.trim() ?? "http://localhost:3000";
    try {
      if (provider !== "github" && provider !== "google") throw new BadRequestException({ error: "unknown_provider" });
      if (!code || !state || request.cookies?.[oauthStateCookie.name] !== state) {
        throw new BadRequestException({ error: "oauth_state_mismatch" });
      }

      const profile = await fetchOAuthProfile(provider, code);
      const user = await this.auth.findOrCreateOAuthUser(profile);
      const { refreshToken } = await this.auth.createRefreshSession(user.id);
      this.auth.setAuthCookies(response, this.auth.signToken(user), refreshToken);
      response.clearCookie(oauthStateCookie.name, { path: "/" });
      response.redirect(302, `${webOrigin}/rooms`);
    } catch (error) {
      console.error("OAuth callback error:", error);
      response.redirect(302, `${webOrigin}/login?error=oauth`);
    }
  }

  private async assertAuthRateLimit(request: Request): Promise<void> {
    const ip = request.ip ?? "unknown";
    const result = await this.rateLimiter.check(`auth:${ip}`, AUTH_RATE_LIMIT_PER_15MIN, 15 * 60 * 1000);
    if (!result.ok) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
