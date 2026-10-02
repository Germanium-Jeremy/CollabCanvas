export interface RealtimeEnv {
  port: number;
  jwtSecret: string;
  databaseUrl: string;
}

export function loadEnv(overrides: Partial<RealtimeEnv> = {}): RealtimeEnv {
  // Render (and most PaaS providers) inject PORT; REALTIME_PORT stays the local
  // dev override. Render also scans a bound port to route traffic, so listening
  // on anything other than PORT makes the service unreachable.
  const port = Number(process.env.REALTIME_PORT ?? process.env.PORT ?? 3002);
  const jwtSecret = process.env.JWT_SECRET ?? "";
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!jwtSecret) throw new Error("JWT_SECRET is required for the realtime server");
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the realtime server");
  return { port, jwtSecret, databaseUrl, ...overrides };
}
