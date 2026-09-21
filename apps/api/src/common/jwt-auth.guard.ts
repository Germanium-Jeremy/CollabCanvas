import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_COOKIE_NAME, type JwtPayload } from "@collabcanvas/shared";
import jwt from "jsonwebtoken";
import { getEnv } from "../config/env";
import { IS_PUBLIC_KEY } from "./auth.decorators";

function extractToken(request: { cookies?: Record<string, string>; headers: Record<string, unknown> }): string | null {
  const cookieToken = request.cookies?.[AUTH_COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/**
 * Global auth guard. Accepts the JWT from the httpOnly auth cookie or an
 * Authorization: Bearer header (used by tests and machine clients).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractToken(request);
    if (!token) throw new UnauthorizedException({ error: "unauthorized" });

    try {
      const payload = jwt.verify(token, getEnv().JWT_SECRET) as JwtPayload;
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException({ error: "unauthorized" });
    }
  }
}
