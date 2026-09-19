export interface RealtimeEnv {
  port: number;
  jwtSecret: string;
  databaseUrl: string;
}

export function loadEnv(overrides: Partial<RealtimeEnv> = {}): RealtimeEnv {
  const port = Number(process.env.REALTIME_PORT ?? 3002);
  const jwtSecret = process.env.JWT_SECRET ?? "";
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!jwtSecret) throw new Error("JWT_SECRET is required for the realtime server");
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the realtime server");
  return { port, jwtSecret, databaseUrl, ...overrides };
}
