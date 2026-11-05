const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function inr(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n < 0 ? "−" : ""}₹${inrFmt.format(Math.round(Math.abs(n)))}`;
}

export function num(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function kg(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? `${num(n / 1000, 2)} t` : `${num(n, 0)} kg`;
}

export function days(d: number | null | undefined) {
  if (d === null || d === undefined) return "> 30 d";
  if (d < 1) return `${num(d * 24, 0)} h`;
  return `${num(d, 1)} d`;
}

export function dur(seconds: number) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function when(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z").toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const COMMODITY_EMOJI: Record<string, string> = { tomato: "🍅", mango: "🥭", banana: "🍌", potato: "🥔", onion: "🧅" };

/** Semantic temperature colour relative to a setpoint: blue cold → light blue normal → yellow → orange → red. */
export function tempColor(t: number, setpoint: number) {
  const d = t - setpoint;
  if (d < -1.5) return "#2F80ED";
  if (d < 1.5) return "#7FC4FF";
  if (d < 3.5) return "#FFC900";
  if (d < 6) return "#F2994A";
  return "#EB4D3D";
}

export function qualityColor(q: number) {
  if (q >= 80) return "#5FB37C";
  if (q >= 60) return "#FFC900";
  if (q >= 45) return "#F2994A";
  return "#EB4D3D";
}
