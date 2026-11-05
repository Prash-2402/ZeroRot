const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function inr(n: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const sign = opts.sign && n > 0 ? "+" : n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (opts.compact) {
    if (a >= 1e7) return `${sign}₹${numFmt.format(a / 1e7)} Cr`;
    if (a >= 1e5) return `${sign}₹${numFmt.format(a / 1e5)} L`;
  }
  return `${sign}₹${inrFmt.format(Math.round(a))}`;
}

export function num(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
}

export function kg(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${num(n / 1000, 2)} t` : `${num(n, 0)} kg`;
}

export function days(d: number | null | undefined, beyond?: boolean) {
  if (beyond) return "> 30 days";
  if (d === null || d === undefined) return "—";
  if (d < 1) return `${num(d * 24, 0)} h`;
  return `${num(d, 1)} days`;
}

export function when(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function clock(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const PRODUCE_EMOJI: Record<string, string> = { tomato: "🍅", mango: "🥭", banana: "🍌" };
export const MATURITY: Record<string, string> = { mature_green: "Mature green", turning: "Turning", ripe: "Ripe" };
export const STORAGE: Record<string, string> = { open_shed: "Open shed", cold_storage: "Cold storage", reefer: "Reefer truck" };

export function qualityColor(q: number) {
  if (q >= 80) return "#3E8E5A";
  if (q >= 65) return "#8FA23A";
  if (q >= 55) return "#D99A2B";
  if (q >= 40) return "#D2702F";
  return "#C2463B";
}

export function qualityRGB(q: number): [number, number, number] {
  const h = qualityColor(q).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const RISK_STYLE: Record<string, string> = {
  healthy: "bg-leaf/10 text-leaf-600",
  warning: "bg-amber-50 text-amber-600",
  critical: "bg-rot-50 text-rot",
};
