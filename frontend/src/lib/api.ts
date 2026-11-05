export const API = "/api/v1";

export class ApiError extends Error {
  status: number;
  detail: any;
  constructor(status: number, message: string, detail: any) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export async function api<T = any>(path: string, opts: RequestInit & { json?: any; timeoutMs?: number } = {}): Promise<T> {
  const { json, timeoutMs = 15000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (rest.signal) rest.signal.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(API + path, {
      ...rest,
      signal: ctrl.signal,
      headers: json !== undefined ? { "content-type": "application/json", ...(rest.headers || {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const d = data?.detail;
      throw new ApiError(res.status, (typeof d === "string" ? d : d?.message) || res.statusText, d);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const post = <T = any>(path: string, json?: any) => api<T>(path, { method: "POST", json: json ?? {} });

export function wsUrl() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/live`;
}
