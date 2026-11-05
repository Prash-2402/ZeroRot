import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Flame, Pause, Play, Smartphone, Zap } from "lucide-react";
import { api, post } from "../lib/api";
import { inr, num, PRODUCE_EMOJI, when } from "../lib/format";
import { useLive, useSelection } from "../stores/live";
import { LiveMap } from "../components/LiveMap";
import { Header, Logo, NAV } from "../components/Layout";
import { Badge, cn, Segmented, Spinner } from "../components/ui";
import { RescuePanel } from "../features/RescuePanel";

function StatsPanel({ stats }: { stats: any }) {
  if (!stats) return null;
  const total = (stats.healthy + stats.warning + stats.critical) || 1;
  return (
    <div className="card-dark w-full p-4 md:w-72">
      <div className="label text-sage-500">Live monitoring</div>
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div><div className="text-[11px] text-sage-500">Active batches</div><div className="num text-2xl font-semibold">{stats.active_batches}</div></div>
        <div><div className="text-[11px] text-sage-500">Tonnes monitored</div><div className="num text-2xl font-semibold">{num(stats.tonnes_monitored)}</div></div>
        <div><div className="text-[11px] text-sage-500">Value at risk</div><div className="num text-xl font-semibold text-amber">{inr(stats.value_at_risk, { compact: true })}</div></div>
        <div><div className="text-[11px] text-sage-500">Protected today</div><div className="num text-xl font-semibold text-leaf-400">{inr(stats.value_protected_today, { compact: true })}</div></div>
      </div>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-night-600">
        <div className="bg-leaf" style={{ width: `${(stats.healthy / total) * 100}%` }} />
        <div className="bg-amber" style={{ width: `${(stats.warning / total) * 100}%` }} />
        <div className="bg-rot" style={{ width: `${(stats.critical / total) * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-sage-500">
        <span><b className="text-leaf-400">{stats.healthy}</b> healthy</span><span><b className="text-amber">{stats.warning}</b> warning</span><span><b className="text-rot">{stats.critical}</b> critical</span>
      </div>
      <div className="mt-3 text-[10px] text-sage-700">From backend records. Cold-chain feed SIMULATED. Value at risk = current value of warning + critical batches.</div>
    </div>
  );
}

function AlertFeed({ alerts }: { alerts: any[] }) {
  return (
    <div className="card-dark flex max-h-[42vh] w-full flex-col p-3 md:w-80">
      <div className="label mb-2 px-1 text-sage-500">Live alert feed</div>
      <div className="space-y-1.5 overflow-auto pr-1">
        <AnimatePresence initial={false}>
          {alerts.slice(0, 14).map((a) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg bg-night-700/70 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", { critical: "bg-rot", warning: "bg-amber", success: "bg-leaf", info: "bg-sky-400" }[a.severity as string])} />
                <span className="truncate text-xs font-semibold text-cream-50">{a.title}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-[11px] text-sage-500">{a.body}</div>
              <div className="mt-0.5 text-[10px] text-sage-700">{when(a.ts)}{a.origin === "simulated" ? " · SIMULATED" : ""}</div>
            </motion.div>
          ))}
        </AnimatePresence>
        {alerts.length === 0 && <div className="px-1 py-3 text-xs text-sage-700">No alerts yet. Inject a reefer failure from the admin panel (or press F).</div>}
      </div>
    </div>
  );
}

function Ticker({ items }: { items: any[] }) {
  const list = items.filter((x) => ["m_kolar", "m_bengaluru", "m_hubballi", "m_mysuru", "m_davanagere", "m_belagavi"].includes(x.mandi_id));
  return (
    <div className="flex items-center gap-3 overflow-hidden border-t border-night-600 bg-night-800/95 px-4 py-2 text-xs">
      <Badge tone="amber">SIMULATED PRICES</Badge>
      <div className="relative flex-1 overflow-hidden">
        <motion.div className="flex gap-8 whitespace-nowrap" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 60, repeat: Infinity, ease: "linear" }}>
          {[...list, ...list].map((x, i) => (
            <span key={i} className="text-sage-500">
              {PRODUCE_EMOJI[x.commodity]} <span className="text-cream-100">{x.mandi.replace(" APMC", "")}</span> ₹{num(x.modal_per_kg, 1)}/kg{" "}
              {x.change_pct !== null && <span className={x.change_pct >= 0 ? "text-leaf-400" : "text-rot"}>{x.change_pct >= 0 ? "▲" : "▼"}{Math.abs(x.change_pct)}%</span>}
              <span className="ml-1 text-sage-700">{x.date}</span>
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

function AdminPanel({ data }: { data: any }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useLive((s) => s.toast);
  const [open, setOpen] = useState(true);
  const { data: net } = useQuery({ queryKey: ["network"], queryFn: () => api("/network"), staleTime: 60000 });
  const reefers = (data?.trips || []).filter((t: any) => t.reefer && t.reefer_status === "ok" && t.status === "in_transit");
  const [target, setTarget] = useState("TRIP-S2");
  const inject = useMutation({ mutationFn: (id: string) => post(`/trips/${id}/inject-failure`),
    onSuccess: () => qc.invalidateQueries(), onError: (e: any) => toast({ title: "Cannot inject", body: e.message, severity: "warning" }) });
  const speed = useMutation({ mutationFn: (b: any) => post("/demo/speed", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboard"] }) });
  const scenario = useMutation({ mutationFn: (n: number) => post(`/demo/scenario/${n}`),
    onSuccess: (d: any) => { qc.invalidateQueries(); toast({ title: `Scenario ${d.scenario} loaded`, body: "Deterministic start state restored.", severity: "success" }); if (d.navigate && d.scenario !== 2) nav(d.navigate); } });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && !(e.target as HTMLElement)?.closest("input,textarea,select")) {
        const t = reefers.find((r: any) => r.id === target) || reefers[0];
        if (t) inject.mutate(t.id);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [reefers, target, inject]);
  const port = location.port || (location.protocol === "https:" ? "443" : "80");
  const host = net?.ips?.[0] && ["localhost", "127.0.0.1"].includes(location.hostname) ? `${net.ips[0]}:${port}` : location.host;
  const judgeUrl = `${location.protocol}//${host}/judge`;
  const sp = data?.speed || { minutes_per_tick: 2, paused: false };
  return (
    <div className="card-dark w-full p-3 md:w-72">
      <button className="flex w-full items-center justify-between" onClick={() => setOpen(!open)}>
        <span className="label text-sage-500">Demo admin</span>{open ? <ChevronUp className="h-4 w-4 text-sage-500" /> : <ChevronDown className="h-4 w-4 text-sage-500" />}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => scenario.mutate(n)} disabled={scenario.isPending} className="rounded-md bg-night-700 px-2 py-1.5 text-[11px] font-semibold text-cream-100 hover:bg-night-600">
                Scenario {n}
              </button>
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] text-sage-500">Reefer failure (simulated fault) · key F</div>
            <div className="flex gap-1.5">
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 rounded-md border border-night-600 bg-night-700 px-2 py-1 text-xs text-cream-100">
                {reefers.map((t: any) => <option key={t.id} value={t.id}>{t.id} → {t.dest_name.replace(" APMC", "")}</option>)}
                {reefers.length === 0 && <option>No working reefers</option>}
              </select>
              <button className="btn-danger px-2.5 py-1 text-xs" disabled={!reefers.length || inject.isPending} onClick={() => inject.mutate((reefers.find((r: any) => r.id === target) || reefers[0]).id)}>
                {inject.isPending ? <Spinner className="h-3 w-3" /> : <Flame className="h-3.5 w-3.5" />} Fail
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-sage-500"><span>Simulation speed (sim min / tick)</span>
              <button onClick={() => speed.mutate({ paused: !sp.paused })} className="text-cream-100">{sp.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</button>
            </div>
            <Segmented dark value={String(sp.minutes_per_tick)} onChange={(v) => speed.mutate({ minutes_per_tick: Number(v) })}
              options={["1", "2", "5", "10"].map((v) => ({ value: v, label: `${v}m` }))} />
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-night-700 p-2">
            <div className="rounded-md bg-white p-1.5"><QRCodeSVG value={judgeUrl} size={78} /></div>
            <div className="text-[11px] text-sage-500">
              <div className="flex items-center gap-1 font-semibold text-cream-100"><Smartphone className="h-3.5 w-3.5" /> Judge mode</div>
              Scan to register a batch from your phone. It appears live on this map.
              <div className="mt-1 break-all text-[10px] text-sage-700">{judgeUrl}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ControlRoom() {
  const nav = useNavigate();
  const { setBatch } = useSelection();
  const version = useLive((s) => s.version);
  const liveAlerts = useLive((s) => s.alerts);
  const liveStats = useLive((s) => s.stats);
  const workflow = useLive((s) => s.workflow);
  const { data } = useQuery({ queryKey: ["dashboard", version], queryFn: () => api("/dashboard"), refetchInterval: 8000 });
  const alerts = useMemo(() => {
    const seen = new Set<number>();
    return [...liveAlerts, ...(data?.alerts || [])].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  }, [liveAlerts, data]);
  const activeTrip = useMemo(() => {
    const ids = Object.keys(workflow);
    const failed = (data?.trips || []).find((t: any) => t.reefer_status === "failed" && t.status === "in_transit");
    return ids[ids.length - 1] || failed?.id || null;
  }, [workflow, data]);
  return (
    <div className="flex h-screen flex-col bg-night text-cream-100">
      <header className="z-20 flex flex-wrap items-center justify-between gap-3 border-b border-night-600 bg-night-800/95 px-4 py-2.5">
        <div className="flex items-center gap-5">
          <Logo dark />
          <nav className="hidden items-center gap-1 xl:flex">
            {NAV.slice(1).map((n) => (
              <Link key={n.to} to={n.to} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-sage-500 hover:bg-night-700 hover:text-cream-100">{n.label}</Link>
            ))}
          </nav>
        </div>
        <Header dark />
      </header>
      <div className="relative flex-1">
        <LiveMap dark trips={data?.trips || []} facilities={data?.facilities || []} stored={data?.stored_batches || []} focusTrip={activeTrip}
          onPick={(id) => { setBatch(id); nav("/twin"); }} />
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-3 p-3 md:flex-row">
          <div className="pointer-events-auto flex max-h-full flex-col gap-3 overflow-y-auto pb-10 [scrollbar-width:thin]">
            <StatsPanel stats={liveStats || data?.stats} />
            {activeTrip && <div className="w-full md:w-72"><RescuePanel tripId={activeTrip} dark /></div>}
          </div>
          <div className="pointer-events-auto flex flex-col items-end gap-3">
            <AdminPanel data={data} />
            <AlertFeed alerts={alerts} />
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-12 left-1/2 hidden -translate-x-1/2 items-center gap-3 rounded-full bg-night-800/90 px-3 py-1.5 text-[11px] text-sage-500 md:flex">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-leaf" /> quality ≥ 80</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber" /> 55–80</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rot" /> &lt; 55</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full border border-white bg-white" /> mandi</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> cold store</span>
          <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> trucks: SIMULATED on real OSRM roads</span>
        </div>
      </div>
      <Ticker items={data?.ticker || []} />
    </div>
  );
}
