import { clsx } from "clsx";
import { AlertTriangle, Info, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";

export const cn = (...a: any[]) => clsx(a);

export function Panel({ title, action, children, className, dark, sub }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; dark?: boolean; sub?: ReactNode }) {
  return (
    <section className={cn(dark ? "panel-dark" : "panel", "p-4", className)}>
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className={cn("text-[13px] font-semibold uppercase tracking-[0.08em]", dark ? "text-paper" : "text-ink")}>{title}</h3>}
            {sub && <p className={cn("mt-0.5 text-xs", dark ? "text-ink-300" : "text-ink-400")}>{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const ORIGIN: Record<string, [string, string]> = {
  simulated: ["SIMULATED", "bg-gold text-ink"], live: ["LIVE", "bg-ok text-white"], live_forecast: ["LIVE FORECAST", "bg-ok text-white"],
  manual: ["MANUAL", "bg-ink text-paper"], unavailable: ["DATA UNAVAILABLE", "bg-critical text-white"], estimate: ["ESTIMATE", "bg-paper-300 text-ink"],
  model: ["MODEL", "bg-paper-300 text-ink"], scenario: ["SCENARIO", "bg-abnormal text-white"], test: ["TEST DATA", "bg-paper-300 text-ink"],
  ai: ["AI EXPLANATION", "bg-ink text-gold"], osrm_live: ["ROUTE · LIVE", "bg-ok text-white"],
};
export function Origin({ kind, title }: { kind: string; title?: string }) {
  const base = kind?.split("+")[0];
  const [label, cls] = ORIGIN[base] || [kind?.toUpperCase(), "bg-paper-300 text-ink"];
  return <span title={title} className={cn("chip", cls)}>{label}{kind?.includes("+scenario") ? " + SCENARIO" : ""}</span>;
}

const SEV: Record<string, string> = { CRITICAL: "bg-critical text-white", WARNING: "bg-gold text-ink", INFO: "bg-coldlight text-ink" };
export function Severity({ s }: { s: string }) {
  return <span className={cn("chip", SEV[s] || "bg-paper-300")}>{s}</span>;
}

export function Metric({ label, value, unit, sub, tone, dark }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: string; dark?: boolean }) {
  return (
    <div className={cn("p-3", dark ? "border border-ink-600 bg-ink-800" : "border border-paper-300 bg-white")}>
      <div className={dark ? "label-dark" : "label"}>{label}</div>
      <div className={cn("num mt-1 text-2xl font-semibold", dark ? "text-paper" : "text-ink")} style={tone ? { color: tone } : undefined}>
        {value}{unit && <span className={cn("ml-1 text-sm font-medium", dark ? "text-ink-300" : "text-ink-400")}>{unit}</span>}
      </div>
      {sub && <div className={cn("mt-0.5 text-[11px]", dark ? "text-ink-300" : "text-ink-400")}>{sub}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="flex items-center gap-2 p-6 text-sm text-ink-400"><Spinner /> {label}…</div>;
}

export function ErrorBox({ error }: { error: any }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 border-l-4 border-critical bg-white px-3 py-2 text-sm text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
      <span>{error.message || String(error)}</span>
    </div>
  );
}

export function Note({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={cn("flex items-start gap-2 border-l-4 px-3 py-2 text-xs leading-relaxed", tone === "warn" ? "border-gold bg-gold-50" : "border-ink-300 bg-paper-50")}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><div>{children}</div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-paper-400 bg-paper-50 p-8 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="mx-auto mt-1 max-w-lg text-sm text-ink-400">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-ink-400">{hint}</span>}
    </label>
  );
}

export function PageHead({ kicker, title, sub, actions }: { kicker?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-paper-300 pb-4">
      <div>
        {kicker && <div className="label mb-1 text-gold-700">{kicker}</div>}
        <h1 className="h1">{title}</h1>
        {sub && <p className="mt-1 max-w-3xl text-sm text-ink-400">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={cn("max-h-[90vh] w-full overflow-y-auto bg-paper", wide ? "max-w-4xl" : "max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-ink px-4 py-3 text-paper">
          <div className="text-sm font-semibold uppercase tracking-[0.1em]">{title}</div>
          <button onClick={onClose} aria-label="Close" className="text-ink-300 hover:text-gold"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, dark }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <div className={cn("inline-flex border", dark ? "border-ink-500" : "border-paper-300 bg-white")}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("px-3 py-1.5 text-xs font-semibold", value === o.value ? "bg-gold text-ink" : dark ? "text-ink-300 hover:text-paper" : "text-ink-400 hover:text-ink")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
