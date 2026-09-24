import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

const API = "http://localhost:3001/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

/** Queue of responses returned in order by the fetch mock. */
function respond(...responses: Response[]): void {
  let i = 0;
  fetchMock.mockImplementation(() => responses[Math.min(i++, responses.length - 1)]);
}

function calls(): { url: string; init?: RequestInit }[] {
  return fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit | undefined }));
}

describe("api client session refresh", () => {
  it("returns data without refreshing when the first request succeeds", async () => {
    respond(jsonResponse(200, { ok: true }));

    await expect(api("/rooms/mine")).resolves.toEqual({ ok: true });
    expect(calls().map((c) => c.url)).toEqual([`${API}/rooms/mine`]);
  });

  it("refreshes once and retries when the access token has expired", async () => {
    respond(jsonResponse(401, { error: "unauthorized" }), jsonResponse(200, { ok: true }));

    await expect(api("/rooms/mine")).resolves.toEqual({ ok: true });
    expect(calls().map((c) => c.url)).toEqual([
      `${API}/rooms/mine`,
      `${API}/auth/refresh`,
      `${API}/rooms/mine`,
    ]);
    expect(calls()[1]?.init?.method).toBe("POST");
  });

  it("propagates the 401 when refresh also fails (session truly expired)", async () => {
    respond(
      jsonResponse(401, { error: "unauthorized" }),
      jsonResponse(401, { error: "invalid_refresh_token" }),
    );

    const err = await api("/rooms/mine").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    // A failed refresh means the session is dead: no pointless retry.
    expect(calls().map((c) => c.url)).toEqual([`${API}/rooms/mine`, `${API}/auth/refresh`]);
  });

  it("does not refresh for auth endpoints themselves", async () => {
    respond(jsonResponse(401, { error: "invalid_credentials" }));

    await expect(api("/auth/login", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    await expect(api("/auth/refresh", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(calls().map((c) => c.url)).toEqual([`${API}/auth/login`, `${API}/auth/refresh`]);
  });

  it("shares one refresh between concurrent 401s (single-flight)", async () => {
    // Both initial requests 401; refresh succeeds; both retries succeed.
    let refreshCalls = 0;
    fetchMock.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return Promise.resolve(jsonResponse(200, { user: { id: "u1" } }));
      }
      // First call per path 401s, the retry succeeds — driven by call counts.
      const count = calls().filter((c) => c.url === u).length;
      return Promise.resolve(count <= 1 ? jsonResponse(401, { error: "unauthorized" }) : jsonResponse(200, { path: u }));
    });

    const [a, b] = await Promise.all([api("/rooms/mine"), api("/auth/me")]);
    expect(a).toEqual({ path: `${API}/rooms/mine` });
    expect(b).toEqual({ path: `${API}/auth/me` });
    expect(refreshCalls).toBe(1);
  });

  it("passes other status codes through untouched", async () => {
    respond(jsonResponse(403, { error: "insufficient_permissions" }));

    const err = await api("/rooms/x").catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(403);
    expect(calls()).toHaveLength(1);
  });
});
