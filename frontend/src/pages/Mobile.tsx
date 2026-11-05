import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api, post } from "../lib/api";
import { enablePush, pushSupported } from "../lib/push";
import { days, num, qualityColor, tempColor } from "../lib/format";
import { useAuth } from "../stores/auth";
import { Logo } from "../components/AppLayout";
import { ErrorBox, Loading, Metric, Note, Origin, Spinner, cn } from "../components/ui";
import { AlertRow, SimulationView } from "../components/SimulationView";

function Pin({ token }: { token: string }) {
  const setMobile = useAuth((s) => s.setMobile);
  const [pin, setPin] = useState("");
  const m = useMutation({ mutationFn: () => post("/qr/verify", { token, pin }), onSuccess: (d) => setMobile(d.access_token, { ...d.scope, link: token, expires_at: d.expires_at }) });
  return (
    <form className="mx-auto mt-10 max-w-xs space-y-4 text-center" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <h1 className="font-display text-2xl font-bold">Enter PIN</h1>
      <p className="text-sm text-ink-400">Ask the person who shared this QR code for the 6-digit PIN.</p>
      <input className="input text-center font-mono text-3xl tracking-[0.4em]" inputMode="numeric" pattern="\d{6}" maxLength={6} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus aria-label="PIN" />
      <ErrorBox error={m.error} />
      <button className="btn-gold w-full py-3" disabled={pin.length !== 6 || m.isPending}>{m.isPending ? <Spinner /> : "Open"}</button>
    </form>
  );
}

function Overview() {
  const qc = useQueryClient();
  const scope = useAuth((s) => s.mobileScope);
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["mobile-overview"], queryFn: () => api("/mobile/overview", { mobile: true }), refetchInterval: 10000 });
  const ack = useMutation({ mutationFn: (id: number) => post(`/alerts/${id}/acknowledge`, {}, true), onSuccess: () => qc.invalidateQueries({ queryKey: ["mobile-overview"] }) });
  const push = useMutation({ mutationFn: () => enablePush(true) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-4"><ErrorBox error={q.error} /><Note>The link may have expired or been revoked. Ask for a new QR code.</Note></div>;
  const canControl = scope?.permissions?.includes("control");
  return (
    <div className="space-y-4 p-3">
      <div className="flex items-center justify-between text-xs"><span className="chip bg-ink text-gold">{scope?.type?.toUpperCase()} #{scope?.id}</span><span className="text-ink-400">expires {new Date(scope?.expires_at + "Z").toLocaleString()}</span></div>
      {pushSupported() && <button className="btn-line w-full" onClick={() => push.mutate()} disabled={push.isPending || push.isSuccess}><Bell className="h-4 w-4" /> {push.isSuccess ? "Alerts will be pushed to this phone" : "Get alert notifications"}</button>}
      <ErrorBox error={push.error} />
      {q.data.simulations.length === 0 && <Note>No simulations for this {scope?.type} yet.</Note>}
      {q.data.simulations.map((s: any) => {
        const r = s.live?.readings || {};
        const sp = s.live?.equipment?.setpoint ?? 12;
        return (
          <div key={s.id} className="border border-paper-300 bg-white">
            <button className="w-full p-3 text-left" onClick={() => setOpen(open === s.id ? null : s.id)}>
              <div className="flex items-center justify-between gap-2"><b className="text-sm">{s.name}</b><span className={cn("chip", s.status === "running" ? "bg-ok text-white" : "bg-paper-300")}>{s.status}</span></div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Metric label="Temp" value={num(r.temperature_c)} unit="°C" tone={r.temperature_c != null ? tempColor(r.temperature_c, sp) : undefined} />
                <Metric label="RH" value={num(r.rh_pct, 0)} unit="%" />
                <Metric label="Quality" value={num(s.live?.produce?.quality, 0)} tone={s.live?.produce ? qualityColor(s.live.produce.quality) : undefined} />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-ink-400"><Origin kind="simulated" /><span>shelf life {days(s.live?.prediction?.shelf_life_days)} · tap for 3D</span></div>
            </button>
            {open === s.id && <div className="border-t border-paper-300 p-2"><SimulationView id={s.id} mobile canControl={canControl} /></div>}
          </div>
        );
      })}
      <div>
        <div className="label mb-1">Alerts</div>
        <div className="space-y-2">
          {q.data.alerts.length === 0 && <div className="text-sm text-ink-400">No alerts.</div>}
          {q.data.alerts.map((a: any) => <AlertRow key={a.id} a={a} mobile onAck={scope?.permissions?.includes("acknowledge_alerts") ? () => ack.mutate(a.id) : undefined} />)}
        </div>
      </div>
    </div>
  );
}

export default function Mobile() {
  const { token = "" } = useParams();
  const { mobileToken, mobileScope } = useAuth();
  const valid = mobileToken && mobileScope?.link === token && new Date(mobileScope.expires_at + "Z") > new Date();
  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between bg-ink px-3 py-3"><Logo /></header>
      {valid ? <Overview /> : <Pin token={token} />}
    </div>
  );
}
