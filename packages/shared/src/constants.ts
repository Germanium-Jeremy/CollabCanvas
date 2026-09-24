/** Auth cookie holding the short-lived access JWT (httpOnly). Shared by web, API and realtime server. */
export const AUTH_COOKIE_NAME = "cc_token";

/** Auth cookie holding the long-lived refresh token (httpOnly). Not read by the realtime server. */
export const REFRESH_COOKIE_NAME = "cc_refresh";

/** Access token lifetime. Refreshed silently by the web client via POST /api/auth/refresh. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Refresh session lifetime: after this the user must sign in again. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Max board text length for sticky notes / text elements (input sanitization). */
export const MAX_TEXT_LENGTH = 2000;

export const MAX_ROOM_NAME_LENGTH = 100;

/** Hard cost-control limit: AI actions per user per hour. */
export const AI_RATE_LIMIT_PER_HOUR = 5;

/** Login/register rate limit per IP per 15 minutes. */
export const AUTH_RATE_LIMIT_PER_15MIN = 20;

/** How many snapshot versions to keep per room. */
export const MAX_SNAPSHOTS_PER_ROOM = 50;
