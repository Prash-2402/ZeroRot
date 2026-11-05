import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../stores/auth";

const respond = (status: number, body: any) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

afterEach(() => { vi.restoreAllMocks(); useAuth.getState().logout(); });

describe("api client", () => {
  it("sends the bearer token and returns JSON", async () => {
    useAuth.getState().setAuth("tok123", { id: 1, email: "a@b.in", name: "A", role: "admin" });
    const f = respond(200, { ok: true });
    vi.stubGlobal("fetch", f);
    await expect(api("/x")).resolves.toEqual({ ok: true });
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer tok123");
  });
  it("surfaces backend error messages instead of fake success (e.g. weather unavailable)", async () => {
    vi.stubGlobal("fetch", respond(503, { detail: { code: "weather_unavailable", message: "Open-Meteo unreachable" } }));
    const e = await api("/weather/forecast").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(503);
    expect(e.message).toBe("Open-Meteo unreachable");
  });
  it("logs out on 401 for dashboard sessions", async () => {
    useAuth.getState().setAuth("expired", { id: 1, email: "a@b.in", name: "A", role: "admin" });
    vi.stubGlobal("fetch", respond(401, { detail: "expired" }));
    await api("/me").catch(() => undefined);
    expect(useAuth.getState().token).toBeNull();
  });
  it("reports an unreachable backend clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const e = await api("/x").catch((x) => x);
    expect(e.message).toBe("Backend unreachable");
  });
});
