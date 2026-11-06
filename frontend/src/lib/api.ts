import { useAuth } from "../stores/auth";

/** Backend address. Empty = same server as the website (local dev, or the backend serving the built app).
 *  Set VITE_API_BASE (e.g. https://your-tunnel.trycloudflare.com) when the website is hosted elsewhere, such as Vercel. */
export const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
export const API = `${API_BASE}/api/v1`;

export class ApiError extends Error {
  status: number;
  detail: any;
  constructor(status: number, message: string, detail: any) { super(message); this.status = status; this.detail = detail; }
}

type Opts = RequestInit & { json?: any; timeoutMs?: number; mobile?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const { json, timeoutMs = 30000, mobile, ...rest } = opts;
  const st = useAuth.getState();
  const token = mobile ? st.mobileToken : st.token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (rest.signal) rest.signal.addEventListener("abort", () => ctrl.abort());
  const headers: Record<string, string> = { ...(rest.headers as any) };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(API + path, { ...rest, headers, signal: ctrl.signal, body: json !== undefined ? JSON.stringify(json) : rest.body });
    const ctype = res.headers.get("content-type") || "";
    const data = ctype.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      const d = (data as any)?.detail;
      if (res.status === 401 && !mobile && token) useAuth.getState().logout();
      throw new ApiError(res.status, (typeof d === "string" ? d : d?.message) || res.statusText, d);
    }
    return data as T;
  } catch (e: any) {
    if (e.name === "AbortError") throw new ApiError(0, "Request timed out", null);
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "Backend unreachable", null);
  } finally {
    clearTimeout(timer);
  }
}

export const post = <T = any>(path: string, json?: any, mobile = false) => api<T>(path, { method: "POST", json: json ?? {}, mobile });

export async function download(path: string, body: any, filename: string) {
  const res = await fetch(API + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${useAuth.getState().token}` }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, "Export failed", null);
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function wsUrl(path: string, mobile = false) {
  const st = useAuth.getState();
  const base = API_BASE ? new URL(API_BASE) : null;
  const proto = (base ? base.protocol : location.protocol) === "https:" ? "wss" : "ws";
  return `${proto}://${base ? base.host : location.host}${path}?token=${encodeURIComponent((mobile ? st.mobileToken : st.token) || "")}`;
}
