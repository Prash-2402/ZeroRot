import { create } from "zustand";

type User = { id: number; email: string; name: string; role: string };

type AuthState = {
  token: string | null;
  user: User | null;
  mobileToken: string | null;
  mobileScope: any | null;
  setAuth: (token: string, user: User) => void;
  setMobile: (token: string, scope: any) => void;
  logout: () => void;
};

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };

export const useAuth = create<AuthState>((set) => ({
  token: read("zr-token"),
  user: (() => { try { return JSON.parse(read("zr-user") || "null"); } catch { return null; } })(),
  mobileToken: read("zr-mobile-token"),
  mobileScope: (() => { try { return JSON.parse(read("zr-mobile-scope") || "null"); } catch { return null; } })(),
  setAuth: (token, user) => { write("zr-token", token); write("zr-user", JSON.stringify(user)); set({ token, user }); },
  setMobile: (token, scope) => { write("zr-mobile-token", token); write("zr-mobile-scope", JSON.stringify(scope)); set({ mobileToken: token, mobileScope: scope }); },
  logout: () => { write("zr-token", null); write("zr-user", null); set({ token: null, user: null }); },
}));

type Toast = { id: number; title: string; body?: string; tone: "info" | "warning" | "critical" | "ok" };
let n = 1;
export const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, "id">) => void; drop: (id: number) => void }>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = n++;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().drop(id), t.tone === "critical" ? 9000 : 5000);
  },
  drop: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));
