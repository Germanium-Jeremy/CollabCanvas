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

/**
 * Silent session renewal. Concurrent 401s share one refresh (single-flight);
 * everyone then retries their original request once with the fresh cookie.
 */
let refreshInFlight: Promise<void> | null = null;

async function refreshSession(): Promise<void> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${env.apiUrl}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new ApiError(response.status, body);
      }
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Typed fetch against the NestJS API. Cookie-based auth via credentials: include. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${env.apiUrl}/api${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...init.headers },
      ...init,
    });

  let response = await doFetch();
  if (response.status === 401 && path !== "/auth/refresh" && path !== "/auth/login" && path !== "/auth/register") {
    try {
      await refreshSession();
      response = await doFetch();
    } catch {
      // Session is truly expired; the caller surfaces the 401 as usual.
    }
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, body);
  }
  return (await response.json()) as T;
}
