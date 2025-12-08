import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME } from "@collabcanvas/shared";

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(AUTH_COOKIE_NAME);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/rooms/:path*"],
};
