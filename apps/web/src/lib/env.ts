/**
 * Client-safe public env vars (never contains secrets).
 *
 * `apiUrl` intentionally defaults to "" (same-origin) rather than
 * http://localhost:3001: in production Next.js proxies `/api/*` to the API via
 * API_PROXY_TARGET, so auth cookies stay same-origin. Local dev sets
 * NEXT_PUBLIC_API_URL explicitly and talks to the API directly.
 *
 * IMPORTANT: these must be *direct* `process.env.X` references. Next.js
 * replaces literal occurrences with the build-time value in client bundles;
 * dynamic access like `process.env[name]` is left untouched, so the client
 * would see `undefined` and fall back to "" — making y-websocket connect
 * against the page origin instead of the realtime server.
 *
 * NOTE: `wsUrl` may be http:// or wss://, but it is NEVER read server-side.
 * Always use wss:// when this bundle is served by a remote host (Render,
 * Vercel, etc.).
 */
export const env = {
  // Direct references: Next.js inlines these at build time (see note above).
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  wsUrl: process.env.NEXT_PUBLIC_WS_URL ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;

// -- Local dev only: convenience overrides -------------------------------------------------
// These run read only on the developer's machine; they are NOT shipped in any
// built bundle and never affect production. They exist so `pnpm dev` works
// without touching .env files.
if (process.env.NODE_ENV === "development") {
  if (!process.env.NEXT_PUBLIC_WS_URL) {
    console.warn(
      '[env] NEXT_PUBLIC_WS_URL not set; defaulting to ws://localhost:3002 for local dev. '
      + 'Set NEXT_PUBLIC_WS_URL explicitly in .env.local to silence this warning.',
    );
    (env as { wsUrl: string }).wsUrl = "ws://localhost:3002";
  }
}
