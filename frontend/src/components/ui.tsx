import { clsx } from "clsx";
import { Loader2, Info } from "lucide-react";
import type { ReactNode } from "react";

export function cn(...a: any[]) { return clsx(a); }

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={cn("card p-5", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="font-semibold text-forest">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-charcoal-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  green: "bg-leaf/10 text-leaf-600", amber: "bg-amber-50 text-amber-600", red: "bg-rot-50 text-rot",
  grey: "bg-cream-200 text-charcoal-500", forest: "bg-forest text-cream-50", blue: "bg-sky-50 text-sky-700",
  outline: "border border-cream-200 text-charcoal-500 bg-white",
};
export function Badge({ tone = "grey", children, className, title }: { tone?: string; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("chip", TONES[tone] || TONES.grey, className)}>{children}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center gap-2 p-6 text-sm text-charcoal-400"><Spinner /> {label}…</div>;
}

export function ErrorBox({ error }: { error: any }) {
  if (!error) return null;
  return <div className="rounded-lg border border-rot/30 bg-rot-50 px-3 py-2 text-sm text-rot">{error.message || String(error)}</div>;
}

export function Stat({ label, value, sub, tone, dark }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; dark?: boolean }) {
  return (
    <div>
      <div className={cn("label", dark && "text-sage-500")}>{label}</div>
      <div className={cn("num mt-1 text-2xl font-semibold", dark ? "text-cream-50" : "text-forest", tone)}>{value}</div>
      {sub && <div className={cn("mt-0.5 text-xs", dark ? "text-sage-500" : "text-charcoal-400")}>{sub}</div>}
    </div>
  );
}

/** Semi-circular gauge driven by a 0-100 value. */
export function Gauge({ value, label, display, sub, color = "#1F4D3A", max = 100 }: { value: number; label: string; display: ReactNode; sub?: ReactNode; color?: string; max?: number }) {
  const v = Math.max(0, Math.min(1, value / max));
  const r = 52, c = Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 128 76" className="w-full max-w-[180px]">
        <path d="M12 68 A52 52 0 0 1 116 68" fill="none" stroke="#EEE7D4" strokeWidth="11" strokeLinecap="round" />
        <path d="M12 68 A52 52 0 0 1 116 68" fill="none" stroke={color} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`} style={{ transition: "stroke-dasharray 400ms ease, stroke 400ms" }} />
      </svg>
      <div className="-mt-9 text-center">
        <div className="num text-2xl font-semibold text-forest">{display}</div>
        <div className="label mt-1">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-charcoal-400">{sub}</div>}
      </div>
    </div>
  );
}

export function OriginTag({ origin, when }: { origin?: string | null; when?: string | null }) {
  if (!origin) return null;
  const map: Record<string, [string, string]> = {
    simulated: ["SIMULATED", "amber"], cached: ["CACHED", "blue"], external_api: ["LIVE API", "green"], manual: ["MANUAL", "forest"],
    model_prediction: ["MODEL", "grey"], image_derived: ["IMAGE ESTIMATE", "grey"], osrm_cached: ["OSRM · CACHED", "blue"],
    straight_line_estimate: ["APPROX. PATH", "grey"], osrm_live: ["OSRM · LIVE", "green"], scenario: ["DEMO SCENARIO", "amber"],
    cached_weather: ["WEATHER · CACHED", "blue"], sensor: ["SENSOR", "green"],
  };
  const [text, tone] = map[origin] || [origin.toUpperCase(), "grey"];
  return <Badge tone={tone} title={`Data origin: ${origin}${when ? ` · ${when}` : ""}`}>{text}</Badge>;
}

export function ConfidenceBadge({ c, full }: { c: any; full?: boolean }) {
  if (!c) return null;
  const tone = { HIGH: "green", MEDIUM: "amber", LOW: "red", INSUFFICIENT: "red" }[c.category as string] || "grey";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={tone} title={c.label}>{c.category} · {Math.round(c.score)}</Badge>
      {full && c.reasons?.length > 0 && <span className="text-xs text-charcoal-500">{c.reasons.join("; ")}</span>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, dark }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <div className={cn("inline-flex rounded-lg p-0.5", dark ? "bg-night-700" : "bg-cream-200/70")}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
            value === o.value ? (dark ? "bg-night-500 text-cream-50" : "bg-white text-forest shadow-sm") : (dark ? "text-sage-500 hover:text-cream-100" : "text-charcoal-500 hover:text-forest"))}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Note({ children, tone = "grey" }: { children: ReactNode; tone?: "grey" | "amber" | "red" | "green" }) {
  const t = { grey: "bg-cream-100 text-charcoal-500 border-cream-200", amber: "bg-amber-50 text-amber-600 border-amber/30", red: "bg-rot-50 text-rot border-rot/30", green: "bg-leaf/10 text-leaf-600 border-leaf/30" }[tone];
  return <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed", t)}><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div>{children}</div></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-cream-200 p-8 text-center"><div className="font-medium text-forest">{title}</div>{children && <div className="mt-1 text-sm text-charcoal-400">{children}</div>}</div>;
}

export function PageHeader({ title, subtitle, actions, kicker }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; kicker?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && <div className="label mb-1 text-leaf">{kicker}</div>}
        <h1 className="h-display text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-charcoal-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
