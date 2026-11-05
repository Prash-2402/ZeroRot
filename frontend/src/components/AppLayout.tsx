import { useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Box, Boxes, ChartLine, Cpu, LayoutDashboard, LogOut, Menu, Settings, Snowflake, Sprout, Tag, Truck, Warehouse, X } from "lucide-react";
import { api } from "../lib/api";
import { useAlertStream } from "../lib/live";
import { useAuth, useToasts } from "../stores/auth";
import { cn } from "./ui";

export const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/post-harvest", label: "Post-Harvest Prevention", icon: Sprout },
  { to: "/app/traditional", label: "Traditional Storage", icon: Warehouse },
  { to: "/app/advanced", label: "Advanced Storage", icon: Cpu },
  { to: "/app/cold-storage", label: "Cold Storage", icon: Snowflake },
  { to: "/app/price", label: "Price Intelligence", icon: Tag },
  { to: "/app/cold-chain", label: "Cold Chain", icon: Truck },
  { to: "/app/lab", label: "3D Simulation Lab", icon: Box },
  { to: "/app/alerts", label: "Alerts", icon: Bell },
  { to: "/app/analytics", label: "Analytics", icon: ChartLine },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function Logo({ light = true }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8"><rect width="64" height="64" rx="6" fill={light ? "#FF684A" : "#0A2624"} /><path d="M14 18h36L22 46h28" fill="none" stroke={light ? "#0A2624" : "#FF684A"} strokeWidth="7" strokeLinecap="square" /></svg>
      <div className="leading-none">
        <div className={cn("font-display text-[17px] font-bold tracking-[0.12em]", light ? "text-paper" : "text-ink")}>ZERO ROT</div>
        <div className={cn("mt-1 text-[9px] uppercase tracking-[0.22em]", light ? "text-ink-300" : "text-ink-400")}>Post-harvest digital twin</div>
      </div>
    </div>
  );
}

function Toasts() {
  const { toasts, drop } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[92vw] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }}
            className={cn("pointer-events-auto border-l-4 bg-ink p-3 text-paper shadow-xl", { critical: "border-critical", warning: "border-gold", ok: "border-ok", info: "border-coldlight" }[t.tone])}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="text-sm font-semibold">{t.title}</div>{t.body && <div className="mt-0.5 text-xs text-ink-300">{t.body}</div>}</div>
              <button onClick={() => drop(t.id)} className="text-ink-300 hover:text-gold" aria-label="Dismiss"><X className="h-4 w-4" /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function StatusDots() {
  const { data, isError } = useQuery({ queryKey: ["integrations"], queryFn: () => api("/integrations"), refetchInterval: 120000, staleTime: 60000 });
  const color = (s: string) => ({ live: "bg-ok", connected: "bg-ok", configured: "bg-gold", available: "bg-gold", unavailable: "bg-critical" }[s] || "bg-ink-400");
  if (isError) return <span className="chip bg-critical text-white">API OFFLINE</span>;
  return (
    <div className="flex items-center gap-1" aria-label="Integration status">
      {(data?.integrations || []).map((i: any) => <span key={i.name} title={`${i.name}: ${i.status} — ${i.detail}`} className={cn("h-2 w-2 rounded-full", color(i.status))} />)}
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const live = useAlertStream(!!user);
  const { data: alerts } = useQuery({ queryKey: ["alerts", "open-count"], queryFn: () => api("/alerts?status=open&limit=200"), refetchInterval: 30000 });
  const openCount = alerts?.alerts?.length || 0;
  const side = (
    <nav className="flex flex-col">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
          className={({ isActive }) => cn("flex items-center gap-3 border-l-2 px-4 py-2.5 text-[13px] font-medium transition-colors",
            isActive ? "border-gold bg-ink-700 text-gold" : "border-transparent text-ink-300 hover:bg-ink-800 hover:text-paper")}>
          <n.icon className="h-4 w-4" /> {n.label}
          {n.label === "Alerts" && openCount > 0 && <span className="ml-auto bg-critical px-1.5 text-[10px] font-bold text-white">{openCount}</span>}
        </NavLink>
      ))}
    </nav>
  );
  const current = NAV.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-ink lg:flex">
        <div className="border-b border-ink-600 px-4 py-4"><Logo /></div>
        <div className="flex-1 overflow-y-auto py-2">{side}</div>
        <div className="border-t border-ink-600 p-4 text-[11px] text-ink-300">
          <div className="font-semibold text-paper">{user?.name}</div>
          <div>{user?.email} · {user?.role}</div>
          <button onClick={() => { logout(); nav("/login"); }} className="mt-2 inline-flex items-center gap-1 text-ink-300 hover:text-gold"><LogOut className="h-3.5 w-3.5" /> Sign out</button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 bg-ink px-4 py-2.5 text-paper lg:bg-white lg:text-ink lg:border-b lg:border-paper-300">
          <div className="flex items-center gap-3">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <div className="lg:hidden"><Logo /></div>
            <div className="hidden text-sm font-semibold uppercase tracking-[0.1em] lg:block">{current?.label}</div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="hidden items-center gap-1.5 sm:flex"><span className={cn("h-2 w-2 rounded-full", live ? "bg-ok" : "bg-critical")} />{live ? "Live stream" : "Stream offline"}</span>
            <StatusDots />
            <NavLink to="/app/alerts" className="relative" aria-label="Alerts"><Bell className="h-5 w-5" />{openCount > 0 && <span className="absolute -right-1.5 -top-1.5 bg-critical px-1 text-[9px] font-bold text-white">{openCount}</span>}</NavLink>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 bg-ink/60 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} className="h-full w-72 bg-ink" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-ink-600 p-4"><Logo /><button onClick={() => setOpen(false)} className="text-paper"><X className="h-5 w-5" /></button></div>
              {side}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
      <Toasts />
    </div>
  );
}

export { Boxes };
