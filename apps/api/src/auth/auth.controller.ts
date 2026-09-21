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
} from "@nestjs/common";
import { AUTH_RATE_LIMIT_PER_15MIN } from "@collabcanvas/shared";
import type { Request, Response } from "express";
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
    const { user, token } = await this.auth.register(dto);
    this.auth.setAuthCookie(response, token);
    return { user, token };
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
    const { user, token } = await this.auth.login(dto);
    this.auth.setAuthCookie(response, token);
    return { user, token };
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  logout(@Res({ passthrough: true }) response: Response) {
    this.auth.clearAuthCookie(response);
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
      const token = this.auth.signToken(user);
      this.auth.setAuthCookie(response, token);
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
