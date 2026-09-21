import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { JwtPayload } from "@collabcanvas/shared";

export const IS_PUBLIC_KEY = "isPublic";

/** Marks an endpoint as public (skips JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user as JwtPayload;
});
