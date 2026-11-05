import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { MapPin, QrCode, Search, Sparkles } from "lucide-react";
import { api, post } from "../lib/api";
import { COMMODITY_EMOJI, kg } from "../lib/format";
import { ErrorBox, Field, Modal, Note, Spinner, cn } from "./ui";

export type Loc = { name: string; lat: number; lng: number };

export const useCommodities = () => useQuery({ queryKey: ["commodities"], queryFn: () => api("/commodities"), staleTime: 600000 });
export const useBatches = () => useQuery({ queryKey: ["batches"], queryFn: () => api("/batches") });
export const useSims = () => useQuery({ queryKey: ["simulations"], queryFn: () => api("/simulations"), refetchInterval: 15000 });

/** Place search through the backend's Open-Meteo geocoding proxy. */
export function LocationPicker({ value, onChange, label = "Location" }: { value: Loc | null; onChange: (l: Loc | null) => void; label?: string }) {
  const [q, setQ] = useState("");
  const m = useMutation({ mutationFn: (s: string) => api(`/weather/geocode?q=${encodeURIComponent(s)}`) });
  return (
    <Field label={label} hint={value ? `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)} · Open-Meteo geocoding` : "Search a village, town or mandi"}>
      {value ? (
        <div className="flex items-center justify-between border border-paper-300 bg-white px-3 py-2 text-sm">
          <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-gold-700" />{value.name}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => onChange(null)}>Change</button>
        </div>
      ) : (
        <div>
          <div className="flex gap-2">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Kolar" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); q.trim().length > 1 && m.mutate(q.trim()); } }} />
            <button type="button" className="btn-ink" onClick={() => q.trim().length > 1 && m.mutate(q.trim())} disabled={m.isPending}>{m.isPending ? <Spinner /> : <Search className="h-4 w-4" />}</button>
          </div>
          <ErrorBox error={m.error} />
          {m.data && (
            <div className="mt-1 max-h-48 overflow-y-auto border border-paper-300 bg-white">
              {m.data.results.length === 0 && <div className="p-2 text-xs text-ink-400">No places found.</div>}
              {m.data.results.map((r: any, i: number) => (
                <button type="button" key={i} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gold-50"
                  onClick={() => { onChange({ name: [r.name, r.admin1].filter(Boolean).join(", "), lat: r.lat, lng: r.lng }); m.reset(); setQ(""); }}>
                  {r.name}<span className="text-ink-400">{r.admin1 ? `, ${r.admin1}` : ""}{r.country ? ` · ${r.country}` : ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  );
}

export function BatchSelect({ value, onChange, filter }: { value: number | ""; onChange: (id: number | "") => void; filter?: (b: any) => boolean }) {
  const { data } = useBatches();
  const list = (data?.batches || []).filter((b: any) => (filter ? filter(b) : true));
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}>
      <option value="">{list.length ? "Choose a batch" : "No batches yet — register one in Post-Harvest"}</option>
      {list.map((b: any) => <option key={b.id} value={b.id}>{COMMODITY_EMOJI[b.commodity_id]} {b.code} · {b.commodity_id} · {kg(b.quantity_kg)} · {b.status}</option>)}
    </select>
  );
}

/** Groq explanation of server-side numbers. Shows the failure visibly; never fabricates. */
export function ExplainButton({ body, label = "Explain with AI" }: { body: any; label?: string }) {
  const [lang, setLang] = useState<"en" | "kn">("en");
  const m = useMutation({ mutationFn: () => post("/ai/explain", { ...body, language: lang }) });
  const ex = m.data?.explanation;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button className="btn-line" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? <Spinner /> : <Sparkles className="h-4 w-4" />} {label}</button>
        <select className="input w-auto py-1 text-xs" value={lang} onChange={(e) => setLang(e.target.value as any)} aria-label="Explanation language">
          <option value="en">English</option><option value="kn">ಕನ್ನಡ</option>
        </select>
      </div>
      <ErrorBox error={m.error} />
      {ex && (
        <div className="border-l-4 border-gold bg-white p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="chip bg-ink text-gold">AI EXPLANATION</span>
            <span className={cn("chip", { low: "bg-ok text-white", medium: "bg-gold text-ink", high: "bg-abnormal text-white", critical: "bg-critical text-white" }[ex.risk_level as string])}>RISK {ex.risk_level?.toUpperCase()}</span>
            <span className="text-[11px] text-ink-400">{m.data.model}</span>
          </div>
          <p>{ex.summary}</p>
          {ex.key_factors?.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{ex.key_factors.map((k: string, i: number) => <li key={i}>{k}</li>)}</ul>}
          {ex.recommendations?.length > 0 && (
            <div className="mt-2 space-y-1">{ex.recommendations.map((r: any, i: number) => <div key={i} className="text-xs"><b>{r.action}</b> — {r.reason}</div>)}</div>
          )}
          {ex.caveats?.length > 0 && <div className="mt-2 text-[11px] text-ink-400">Caveats: {ex.caveats.join(" · ")}</div>}
          {!m.data.verified && <Note tone="warn">The explanation mentions numbers not found in the model output ({m.data.unverified_numbers.join(", ")}). Trust the numerical panels, not the text.</Note>}
          <div className="mt-1 text-[10px] text-ink-400">{m.data.label}</div>
        </div>
      )}
    </div>
  );
}

/** Creates a scoped, expiring, revocable mobile session and shows its QR code + PIN. */
export function QRShare({ resourceType, resourceId, label = "Mobile QR" }: { resourceType: "batch" | "simulation" | "zone" | "truck"; resourceId: number; label?: string }) {
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState(720);
  const [control, setControl] = useState(false);
  const m = useMutation({ mutationFn: () => post("/qr/sessions", { resource_type: resourceType, resource_id: resourceId, ttl_minutes: ttl, allow_control: control }) });
  return (
    <>
      <button className="btn-line" onClick={() => { setOpen(true); m.reset(); }}><QrCode className="h-4 w-4" /> {label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Mobile access QR">
        {!m.data ? (
          <div className="space-y-3">
            <p className="text-sm">The QR code opens a phone view of this {resourceType} only. It never contains an API key; access needs the 6-digit PIN, expires, and can be revoked in Settings.</p>
            <Field label="Valid for">
              <select className="input" value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
                <option value={60}>1 hour</option><option value={720}>12 hours</option><option value={1440}>1 day</option><option value={10080}>7 days</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={control} onChange={(e) => setControl(e.target.checked)} /> Allow controls (door, cooling, start/pause)</label>
            <ErrorBox error={m.error} />
            <button className="btn-gold w-full" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? <Spinner /> : "Create QR"}</button>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <div className="inline-block bg-white p-3"><QRCodeSVG value={m.data.url} size={220} /></div>
            <div><div className="label">PIN</div><div className="num text-4xl font-bold tracking-[0.3em]">{m.data.pin}</div></div>
            <div className="text-xs text-ink-400">Expires {new Date(m.data.expires_at + "Z").toLocaleString()} · permissions: {m.data.permissions.join(", ")}</div>
            <div className="break-all text-[11px] text-ink-400">{m.data.url}</div>
            <Note>Share the PIN separately from the QR. The PIN is shown only once.</Note>
          </div>
        )}
      </Modal>
    </>
  );
}
