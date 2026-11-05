import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Boxes, Gauge, LayoutDashboard, LineChart, Menu, Radar, RotateCcw, Settings, ShieldCheck, Sprout, Store, Truck, X, QrCode } from "lucide-react";
import { api, post } from "../lib/api";
import { clock, PRODUCE_EMOJI } from "../lib/format";
import { useLive, useSelection } from "../stores/live";
import { cn, Spinner } from "./ui";

export const NAV = [
  { to: "/", label: "Control Room", icon: Radar },
  { to: "/batches", label: "Batches", icon: Boxes },
  { to: "/twin", label: "Digital Twin", icon: Sprout },
  { to: "/decide", label: "Decide", icon: Gauge },
  { to: "/markets", label: "Markets", icon: Store },
  { to: "/transport", label: "Transport", icon: Truck },
  { to: "/passport", label: "Passport", icon: QrCode },
  { to: "/impact", label: "Impact", icon: LineChart },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Logo({ dark }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8"><rect width="64" height="64" rx="14" fill={dark ? "#3E8E5A" : "#1F4D3A"} /><circle cx="32" cy="35" r="16" fill="#F7F3E8" /><path d="M32 19c2-6 8-8 12-7-1 5-5 9-12 7z" fill={dark ? "#F7F3E8" : "#3E8E5A"} /><circle cx="32" cy="35" r="6" fill={dark ? "#3E8E5A" : "#1F4D3A"} /></svg>
      <div className="leading-none">
        <div className={cn("font-display text-lg font-semibold tracking-tight", dark ? "text-cream-50" : "text-forest")}>ZERO ROT</div>
        <div className={cn("text-[10px] tracking-wide", dark ? "text-sage-500" : "text-charcoal-400")}>Predict. Preserve. Prevent.</div>
      </div>
    </div>
  );
}

function StatusDots({ integrations }: { integrations: any[] }) {
  const color = (s: string) => ({ ok: "bg-leaf", demo: "bg-sky-500", preview: "bg-sky-500", unavailable: "bg-charcoal-300" }[s] || "bg-charcoal-300");
  const show = integrations.filter((i) => ["weather", "mandi", "routes", "ai", "notify"].includes(i.name));
  return (
    <div className="flex items-center gap-1">
      {show.map((i) => <span key={i.name} title={`${i.name}: ${i.status} — ${i.detail}`} className={cn("h-2 w-2 rounded-full", color(i.status))} />)}
    </div>
  );
}

function ModeToggle({ dark }: { dark?: boolean }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["integrations"], queryFn: () => api("/integrations"), refetchInterval: 60000 });
  const m = useMutation({ mutationFn: (mode: string) => post("/mode", { mode }), onSuccess: () => qc.invalidateQueries() });
  const mode = data?.mode || "demo";
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-2 py-1", dark ? "border-night-600 bg-night-800" : "border-cream-200 bg-white")}>
      {(["demo", "real"] as const).map((x) => (
        <button key={x} onClick={() => m.mutate(x)} disabled={m.isPending}
          className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wider",
            mode === x ? (x === "demo" ? "bg-amber text-white" : "bg-leaf text-white") : dark ? "text-sage-500" : "text-charcoal-400")}>
          {x.toUpperCase()}
        </button>
      ))}
      {m.isPending ? <Spinner className="h-3 w-3" /> : <StatusDots integrations={data?.integrations || []} />}
    </div>
  );
}

function BatchSelector({ dark }: { dark?: boolean }) {
  const { data } = useQuery({ queryKey: ["batches"], queryFn: () => api("/batches"), refetchInterval: 15000 });
  const { batchId, setBatch } = useSelection();
  const nav = useNavigate();
  const loc = useLocation();
  const batches = data?.batches || [];
  useEffect(() => {
    if (batches.length && (!batchId || !batches.find((b: any) => b.id === batchId))) setBatch(batches[0].id);
  }, [batches, batchId, setBatch]);
  return (
    <select value={batchId || ""} onChange={(e) => { setBatch(e.target.value); if (loc.pathname === "/") nav("/twin"); }}
      className={cn("max-w-[220px] rounded-lg border px-2 py-1.5 text-sm", dark ? "border-night-600 bg-night-800 text-cream-100" : "border-cream-200 bg-white")}>
      {batches.map((b: any) => (
        <option key={b.id} value={b.id}>{PRODUCE_EMOJI[b.produce]} {b.id} · {b.quantity_kg >= 1000 ? `${(b.quantity_kg / 1000).toFixed(1)} t` : `${b.quantity_kg} kg`}{b.origin === "manual" ? " · yours" : ""}</option>
      ))}
    </select>
  );
}

function Bell_({ dark }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => api("/notifications?limit=40"), refetchInterval: 20000 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const items = (data?.notifications || []).filter((n: any) => n.channel === "in_app");
  return (
    <div className="relative" ref={ref}>
      <button aria-label="Notifications" onClick={() => { setOpen(!open); if (!open) post("/notifications/read").then(() => qc.invalidateQueries({ queryKey: ["notifications"] })); }}
        className={cn("relative rounded-lg p-2", dark ? "text-cream-100 hover:bg-night-700" : "text-forest hover:bg-forest-50")}>
        <Bell className="h-5 w-5" />
        {data?.unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rot px-1 text-[10px] font-bold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[360px] max-w-[92vw] overflow-auto rounded-xl border border-cream-200 bg-white p-2 text-charcoal shadow-xl">
          <div className="label px-2 py-1">Notification centre</div>
          {items.length === 0 && <div className="p-4 text-sm text-charcoal-400">No notifications yet.</div>}
          {items.map((n: any) => (
            <div key={n.id} className="rounded-lg px-2 py-2 hover:bg-cream-100">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", { critical: "bg-rot", warning: "bg-amber", success: "bg-leaf", info: "bg-sky-500" }[n.severity as string])} />
                <span className="text-sm font-medium text-forest">{n.title}</span>
              </div>
              <div className="mt-0.5 pl-4 text-xs text-charcoal-500">{n.body}</div>
              <div className="mt-0.5 pl-4 text-[10px] text-charcoal-300">{clock(n.ts)} · {n.origin === "simulated" ? "SIMULATED" : "manual"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResetButton({ dark }: { dark?: boolean }) {
  const qc = useQueryClient();
  const toast = useLive((s) => s.toast);
  const m = useMutation({ mutationFn: () => post("/demo/reset"), onSuccess: (d: any) => { qc.invalidateQueries(); toast({ title: "Demo reset", body: `Start state restored in ${d.seconds}s`, severity: "success" }); } });
  const { data } = useQuery({ queryKey: ["integrations"], queryFn: () => api("/integrations") });
  if ((data?.mode || "demo") !== "demo") return null;
  return (
    <button onClick={() => m.mutate()} disabled={m.isPending} className={cn("btn px-2.5 py-1.5 text-xs", dark ? "bg-night-700 text-cream-100 hover:bg-night-600" : "btn-secondary")}>
      {m.isPending ? <Spinner className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />} Reset Demo
    </button>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useLive();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[360px] max-w-[92vw] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
            className={cn("pointer-events-auto rounded-xl border bg-white p-3 shadow-xl",
              { critical: "border-rot/40", warning: "border-amber/40", success: "border-leaf/40" }[t.severity] || "border-cream-200")}>
            <div className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", { critical: "bg-rot", warning: "bg-amber", success: "bg-leaf" }[t.severity] || "bg-sky-500")} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-forest">{t.title}</div>
                {t.body && <div className="mt-0.5 text-xs text-charcoal-500">{t.body}</div>}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-charcoal-300 hover:text-charcoal"><X className="h-4 w-4" /></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function Header({ dark }: { dark?: boolean }) {
  const { simNow, connected } = useLive();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={cn("hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs md:flex", dark ? "text-sage-500" : "text-charcoal-500")} title="Simulated clock (demo). Each tick advances simulated minutes.">
        <span className={cn("h-2 w-2 rounded-full", connected ? "bg-leaf" : "bg-rot")} />
        <span className="num">{clock(simNow)}</span>
      </div>
      <BatchSelector dark={dark} />
      <ModeToggle dark={dark} />
      <Bell_ dark={dark} />
      <ResetButton dark={dark} />
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [loc.pathname]);
  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.to === "/"}
          className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive ? "bg-forest text-cream-50" : "text-forest/80 hover:bg-forest-50 hover:text-forest")}>
          <n.icon className="h-4 w-4" /> {n.label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-cream-200 bg-cream-100/60 p-4 lg:flex">
        <Logo />
        <div className="mt-8">{nav}</div>
        <div className="mt-auto rounded-xl border border-cream-200 bg-white p-3 text-[11px] leading-relaxed text-charcoal-500">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-forest"><ShieldCheck className="h-3.5 w-3.5" /> Honest by design</div>
          Decay Engine + Rule-Based Decision Engine. Simulated feeds are labelled SIMULATED. Reroutes need human approval.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-cream-200 bg-cream-50/90 px-4 py-2.5 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-forest hover:bg-forest-50" aria-label="Menu"><Menu className="h-5 w-5" /></button>
            <Logo />
          </div>
          <div className="hidden text-sm text-charcoal-400 2xl:block">{NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)))?.label}</div>
          <Header />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 bg-black/30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.aside initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} className="h-full w-64 bg-cream-50 p-4" onClick={(e) => e.stopPropagation()}>
              <div className="mb-6 flex items-center justify-between"><Logo /><button onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
              {nav}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { Logo, LayoutDashboard };
