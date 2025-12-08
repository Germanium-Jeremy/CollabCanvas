function required(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/** Client-safe public env vars (never contains secrets). */
export const env = {
  apiUrl: required("NEXT_PUBLIC_API_URL", "http://localhost:3001"),
  wsUrl: required("NEXT_PUBLIC_WS_URL", "ws://localhost:3002"),
  appUrl: required("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
} as const;
