import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { enablePush, pushSupported, testPush } from "../lib/push";
import { when } from "../lib/format";
import { ErrorBox, Field, Note, PageHead, Panel, Seg, Spinner, cn } from "../components/ui";
import { useCommodities } from "../components/shared";
import { useAuth } from "../stores/auth";

function Integrations() {
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["integrations"], queryFn: () => api("/integrations") });
  return (
    <Panel title="Integrations" sub="Checked live from the backend" action={<button className="btn-line" onClick={() => refetch()}>{isFetching ? <Spinner /> : "Re-check"}</button>}>
      {isLoading ? <Spinner /> : (
        <table className="w-full text-sm"><tbody className="table-body">
          {(data?.integrations || []).map((i: any) => (
            <tr key={i.name}><td className="py-1.5 font-semibold">{i.name}</td><td><span className={cn("chip", ["live", "connected"].includes(i.status) ? "bg-ok text-white" : i.status === "unavailable" ? "bg-critical text-white" : "bg-gold text-ink")}>{i.status}</span></td><td className="text-xs text-ink-400">{i.detail}</td></tr>
          ))}
        </tbody></table>
      )}
      <Note>Keys (Groq, data.gov.in, VAPID) live only in the backend <code>.env</code>; they are never sent to the browser.</Note>
    </Panel>
  );
}

function Users() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: () => api("/auth/users") });
  const [f, setF] = useState({ name: "", email: "", password: "", role: "operator" });
  const m = useMutation({ mutationFn: () => post("/auth/users", f), onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setF({ name: "", email: "", password: "", role: "operator" }); } });
  return (
    <Panel title="Users" sub="Role-based access: admin, operator, farmer">
      <ErrorBox error={q.error} />
      <div className="mb-3 space-y-1">{(q.data?.users || []).map((u: any) => <div key={u.id} className="flex justify-between border-b border-paper-300 py-1 text-sm"><span>{u.name} <span className="text-ink-400">{u.email}</span></span><span className="chip bg-paper-300">{u.role}</span></div>)}</div>
      <form className="grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <input className="input" placeholder="Name" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="input" placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" placeholder="Password (8+)" type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="operator">Operator</option><option value="farmer">Farmer</option><option value="admin">Admin</option></select>
        <button className="btn-gold" disabled={m.isPending}>{m.isPending ? <Spinner /> : "Add user"}</button>
      </form>
      <ErrorBox error={m.error} />
    </Panel>
  );
}

function QRSessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["qr-sessions"], queryFn: () => api("/qr/sessions") });
  const revoke = useMutation({ mutationFn: (id: number) => post(`/qr/sessions/${id}/revoke`), onSuccess: () => qc.invalidateQueries({ queryKey: ["qr-sessions"] }) });
  const list = q.data?.sessions || [];
  return (
    <Panel title="Mobile QR sessions" sub="Scoped to one resource, PIN-protected, expiring and revocable">
      {list.length === 0 ? <div className="text-sm text-ink-400">No QR sessions created.</div> : (
        <table className="w-full text-xs">
          <thead><tr className="table-head"><th className="py-1 text-left">#</th><th className="text-left">Resource</th><th className="text-left">Permissions</th><th className="text-left">Expires</th><th className="text-right">Uses</th><th /></tr></thead>
          <tbody className="table-body">{list.map((s: any) => (
            <tr key={s.id}><td className="py-1">{s.id}</td><td>{s.resource_type} #{s.resource_id}</td><td>{s.permissions.join(", ")}</td><td>{when(s.expires_at)}</td><td className="text-right">{s.uses}</td>
              <td className="text-right">{s.revoked ? <span className="chip bg-paper-300">revoked</span> : s.expired ? <span className="chip bg-paper-300">expired</span> : <button className="btn-danger py-0.5 text-[11px]" onClick={() => revoke.mutate(s.id)}>Revoke</button>}</td></tr>
          ))}</tbody>
        </table>
      )}
    </Panel>
  );
}

function Notifications() {
  const en = useMutation({ mutationFn: () => enablePush(false) });
  const t = useMutation({ mutationFn: () => testPush(false) });
  return (
    <Panel title="Push notifications" sub="Critical alerts are pushed to subscribed devices">
      {!pushSupported() ? <Note tone="warn">This browser does not support web push.</Note> : (
        <div className="flex flex-wrap gap-2">
          <button className="btn-gold" onClick={() => en.mutate()} disabled={en.isPending}>{en.isPending ? <Spinner /> : en.isSuccess ? "Enabled ✓" : "Enable on this device"}</button>
          <button className="btn-line" onClick={() => t.mutate()} disabled={t.isPending}>Send test</button>
        </div>
      )}
      <ErrorBox error={en.error || t.error} />
      {t.data && <div className="mt-2 text-xs">{t.data.results.map((r: any, i: number) => <div key={i}>{r.ok ? "Delivered to push service" : `Failed: ${r.detail}`}</div>)}</div>}
    </Panel>
  );
}

function Catalog() {
  const comms = useCommodities();
  const [c, setC] = useState("tomato");
  const d = useQuery({ queryKey: ["commodity", c], queryFn: () => api(`/commodities/${c}`) });
  return (
    <Panel title="Commodity parameters" sub="Every model parameter with its source, classification and limitations">
      <div className="mb-3"><Seg value={c} onChange={setC} options={(comms.data?.commodities || []).map((x: any) => ({ value: x.id, label: x.name }))} /></div>
      {d.data && !d.data.prediction_supported && <Note tone="warn">{d.data.prediction_note}</Note>}
      <div className="max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead><tr className="table-head"><th className="py-1 text-left">Parameter</th><th className="text-right">Value</th><th className="text-left pl-2">Class</th><th className="text-left">Source</th></tr></thead>
          <tbody className="table-body">{(d.data?.parameters || []).map((p: any) => (
            <tr key={p.key} className="align-top"><td className="py-1"><b>{p.name}</b><div className="font-mono text-ink-400">{p.key}</div></td>
              <td className="text-right font-mono">{p.value} {p.unit}{p.range && <div className="text-ink-400">[{p.range[0]}, {p.range[1]}]</div>}</td>
              <td className="pl-2"><span className={cn("chip", p.classification === "sourced" ? "bg-ok text-white" : p.classification === "derived" ? "bg-gold text-ink" : "bg-paper-300")}>{p.classification}</span></td>
              <td className="max-w-md text-ink-400">{p.source}{p.derivation && <div>Derivation: {p.derivation}</div>}{p.limitations && <div>Limits: {p.limitations}</div>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function Audit() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api("/audit") });
  return (
    <Panel title="Audit log" sub="Security-relevant actions (last 300)">
      <ErrorBox error={q.error} />
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-xs"><thead><tr className="table-head"><th className="py-1 text-left">When</th><th className="text-left">Actor</th><th className="text-left">Action</th><th className="text-left">Entity</th><th className="text-left">IP</th></tr></thead>
          <tbody className="table-body">{(q.data?.entries || []).map((a: any) => <tr key={a.id}><td className="py-1">{when(a.created_at)}</td><td>{a.actor}</td><td className="font-mono">{a.action}</td><td>{a.entity} {a.entity_id ?? ""}</td><td>{a.ip}</td></tr>)}</tbody></table>
      </div>
    </Panel>
  );
}

export default function Settings() {
  const role = useAuth((s) => s.user?.role);
  return (
    <div className="space-y-4">
      <PageHead kicker="System" title="Settings" />
      <Integrations />
      {role === "admin" && <Users />}
      <div className="grid gap-4 lg:grid-cols-2"><QRSessions /><Notifications /></div>
      <Catalog />
      {role === "admin" && <Audit />}
      <Field label="Signed in as"><div className="text-sm">{useAuth.getState().user?.email}</div></Field>
    </div>
  );
}
