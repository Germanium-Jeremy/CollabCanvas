function required(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * Client-safe public env vars (never contains secrets).
 *
 * `apiUrl` intentionally defaults to "" (same-origin) rather than
 * http://localhost:3001: in production Next.js proxies `/api/*` to the API via
 * API_PROXY_TARGET, so auth cookies stay same-origin. Local dev sets
 * NEXT_PUBLIC_API_URL explicitly and talks to the API directly.
 */
export const env = {
  apiUrl: required("NEXT_PUBLIC_API_URL", ""),
  wsUrl: required("NEXT_PUBLIC_WS_URL", ""),
  appUrl: required("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
} as const;
