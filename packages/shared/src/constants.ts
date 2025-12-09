/** Auth cookie holding the JWT (httpOnly). Shared by web, API and realtime server. */
export const AUTH_COOKIE_NAME = "cc_token";

/** Max board text length for sticky notes / text elements (input sanitization). */
export const MAX_TEXT_LENGTH = 2000;

export const MAX_ROOM_NAME_LENGTH = 100;

/** Hard cost-control limit: AI actions per user per hour. */
export const AI_RATE_LIMIT_PER_HOUR = 5;

/** Login/register rate limit per IP per 15 minutes. */
export const AUTH_RATE_LIMIT_PER_15MIN = 20;

/** How many snapshot versions to keep per room. */
export const MAX_SNAPSHOTS_PER_ROOM = 50;
