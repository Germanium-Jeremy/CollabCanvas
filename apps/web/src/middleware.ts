import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@collabcanvas/shared";

export function middleware(request: NextRequest) {
  // The refresh cookie is the session anchor: it lives 7 days while the access
  // token rotates every 15 minutes. Either cookie present counts as a session
  // for routing; real authorization still happens in the API.
  const hasSession = request.cookies.has(REFRESH_COOKIE_NAME) || request.cookies.has(AUTH_COOKIE_NAME);
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
