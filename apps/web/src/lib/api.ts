import { env } from "./env";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error?: string; [key: string]: unknown } = {},
  ) {
    super(`API error ${status}: ${body.error ?? "unknown"}`);
    this.name = "ApiError";
  }
}

/** Typed fetch against the NestJS API. Cookie-based auth via credentials: include. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.apiUrl}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}
