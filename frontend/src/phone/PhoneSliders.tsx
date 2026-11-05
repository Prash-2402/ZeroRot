import { useState } from "react";
import { inr, kg, num } from "../lib/format";
import { cn } from "../components/ui";

const dayLabel = (d: number) => {
  const x = new Date();
  x.setDate(x.getDate() + d);
  return x.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
};

function Slider({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  return (
    <div>
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-paper-200 accent-[#FF684A]" />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-400"><span>{min === 0 ? "today" : `day ${min}`}</span><span>day {max}</span></div>
    </div>
  );
}

/** Tiny line chart with a marker at the selected day. */
function Spark({ series, day, color, band, max }: { series: number[]; day: number; color: string; band?: [number[], number[]]; max?: number }) {
  const W = 300, H = 56;
  const all = [...series, ...(band ? [...band[0], ...band[1]] : [])];
  const hi = max ?? Math.max(...all), lo = max != null ? 0 : Math.min(...all);
  const x = (i: number) => (i / Math.max(1, series.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - 8);
  const pts = (a: number[]) => a.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full">
      {band && <polygon fill={color} opacity={0.15} points={`${pts(band[1])} ${band[0].map((v, i) => `${x(i)},${y(v)}`).reverse().join(" ")}`} />}
      <polyline fill="none" stroke={color} strokeWidth={2.5} points={pts(series)} />
      <line x1={x(day)} x2={x(day)} y1={0} y2={H} stroke="#0f3f3b" strokeDasharray="3 3" />
      <circle cx={x(day)} cy={y(series[day])} r={4.5} fill={color} stroke="#fff" strokeWidth={2} />
    </svg>
  );
}

/* ---------------- Spoilage: slide through the days ---------------- */
export function SpoilageSlider({ curves, horizon, qMin }: { curves: any; horizon: number; qMin: number }) {
  const [day, setDay] = useState(Math.min(3, horizon));
  if (!curves?.current?.length) return null;
  const c = curves.current[day], r = curves.recommended[day];
  const Box = ({ title, x, color }: any) => (
    <div className="rounded-xl border border-paper-300 bg-white p-2.5 text-xs">
      <div className="mb-1 font-bold" style={{ color }}>{title}</div>
      <div className="flex justify-between"><span>Quality</span><b className="font-mono">{num(x.quality, 0)} <span className="font-normal text-ink-400">({num(x.quality_p10, 0)}–{num(x.quality_p90, 0)})</span></b></div>
      <div className="flex justify-between"><span>Spoiled / lost</span><b className="font-mono">{kg(x.lost_kg)} · {num(x.lost_pct, 0)}%</b></div>
      <div className="flex justify-between"><span>Risk below sellable</span><b className={cn("font-mono", x.spoil_risk_pct >= 50 ? "text-critical" : x.spoil_risk_pct >= 10 ? "text-[#c2410c]" : "text-ok")}>{num(x.spoil_risk_pct, 0)}%</b></div>
    </div>
  );
  return (
    <div className="rounded-2xl border-2 border-coral/40 bg-white p-3">
      <div className="mb-1 flex items-baseline justify-between"><div className="ph-label !mb-0">Slide to see spoilage ahead</div><b className="text-sm">{day === 0 ? "Today" : `In ${day} day${day > 1 ? "s" : ""}`}</b></div>
      <div className="text-[11px] text-ink-400">{dayLabel(day)}</div>
      <Spark series={curves.current.map((x: any) => x.quality)} day={day} color="#FF684A" max={100}
        band={[curves.current.map((x: any) => x.quality_p10), curves.current.map((x: any) => x.quality_p90)]} />
      <Slider value={day} min={0} max={horizon} onChange={setDay} label="Days ahead" />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Box title="As stored now" x={c} color="#e8542f" />
        <Box title="At recommended conditions" x={r} color="#2F80ED" />
      </div>
      <div className="mt-1 text-[10px] text-ink-400">Sellable minimum is quality {num(qMin, 0)}. Range = 10th–90th percentile of 100 model runs; conditions assumed to stay as they are now.</div>
    </div>
  );
}

/* ---------------- Decision: sell now or sell later ---------------- */
export function SellPlanner({ d }: { d: any }) {
  const rows: any[] = d.rows || [];
  const n = rows.length - 1;
  const [mode, setMode] = useState<"now" | "later">(d.recommendation === "store_and_sell_later" ? "later" : "now");
  const [day, setDay] = useState(Math.max(1, Math.min(n, d.best_day || 3)));
  if (n < 1) return null;
  const now = rows[0], x = mode === "now" ? now : rows[day];
  const diff = x.net_profit - now.net_profit;
  const fc = d.forecast || {};
  const m7 = fc.metrics?.h7;
  const longKey = Object.keys(fc.metrics || {}).filter((k) => !["h1", "h7"].includes(k)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0];
  const m14 = longKey ? fc.metrics[longKey] : null;
  const showBand = rows.some((r) => r.price_low !== r.price_high);
  return (
    <div className="rounded-2xl border-2 border-teal/30 bg-white p-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper-200 p-1">
        {(["now", "later"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={cn("rounded-lg py-2 text-sm font-bold", mode === m ? "bg-white text-teal shadow" : "text-ink-400")}>{m === "now" ? "Sell now" : "Sell later"}</button>
        ))}
      </div>
      {mode === "later" && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between"><b className="text-sm">Sell in {day} day{day > 1 ? "s" : ""}</b><span className="text-[11px] text-ink-400">{dayLabel(day)}</span></div>
          <Spark series={rows.map((r) => r.price_per_kg)} day={day} color="#17645F" band={showBand ? [rows.map((r) => r.price_low), rows.map((r) => r.price_high)] : undefined} />
          <Slider value={day} min={1} max={n} onChange={setDay} label="Days until selling" />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">Harvest quality</div><div className="font-mono text-lg font-bold">{num(x.quality, 0)}</div>
          {mode === "later" && <div className="text-[10px] text-ink-400">likely {num(x.quality_p10, 0)}–{num(x.quality_p90, 0)}</div>}</div>
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">{d.market?.market || "Market"} price</div><div className="font-mono text-lg font-bold">{inr(x.price_per_kg)}<span className="text-[10px] font-normal">/kg</span></div>
          {mode === "later" && x.price_low !== x.price_high && <div className="text-[10px] text-ink-400">likely {inr(x.price_low)}–{inr(x.price_high)}</div>}</div>
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">Profit</div><div className={cn("font-mono text-lg font-bold", x.net_profit < 0 && "text-critical")}>{inr(x.net_profit)}</div>
          {mode === "later" && <div className={cn("text-[10px] font-bold", diff >= 0 ? "text-ok" : "text-critical")}>{diff >= 0 ? "+" : "−"}{inr(Math.abs(diff))} vs selling today</div>}</div>
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">Spoilage</div><div className="font-mono text-lg font-bold">{kg(x.spoilage_loss_kg)}</div>
          <div className={cn("text-[10px] font-bold", x.spoil_risk_pct >= 50 ? "text-critical" : x.spoil_risk_pct >= 10 ? "text-[#c2410c]" : "text-ok")}>risk {num(x.spoil_risk_pct, 0)}%</div></div>
      </div>
      {mode === "later" && !x.within_shelf_life_p10 && <div className="mt-2 rounded-lg bg-critical/10 p-2 text-[11px] text-critical">Beyond the cautious shelf-life estimate: the produce may not be sellable by then.</div>}
      {mode === "later" && (
        <div className="mt-2 text-[10px] leading-snug text-ink-400">
          {fc.status === "ok" && fc.used === false ? <>Price held at today's price: {fc.message} (backtest error at 7 days {num(m7?.model_mape_pct, 0)}% vs {num(m7?.naive_mape_pct, 0)}%).</>
          : fc.status === "ok" ? (
            <>Price forecast: {fc.model}, trained on {fc.trained_points} days of {fc.market}{fc.variety ? ` (${fc.variety})` : ""} prices{fc.trend_from_other_market ? " (trend borrowed from this nearby market)" : ""}; weather: {fc.weather_features ? fc.weather_source : "not used"}.
              {m7 && <> Backtest error at 7 days {num(m7.model_mape_pct, 0)}% (keeping today's price: {num(m7.naive_mape_pct, 0)}%)</>}{m14 && <>, at {longKey?.slice(1)} days {num(m14.model_mape_pct, 0)}% ({num(m14.naive_mape_pct, 0)}%)</>}. Not a guarantee.</>
          ) : <>No price forecast ({fc.message || "unavailable"}); future price held at today's price.</>}
        </div>
      )}
    </div>
  );
}

/* ---------------- Store: how long to keep it, and what that costs or earns ---------------- */
export function StorePlan({ d, days, setDays }: { d: any; days: number; setDays: (n: number) => void }) {
  const rows: any[] = d?.rows || [];
  const n = rows.length - 1;
  if (n < 1) return null;
  const day = Math.max(1, Math.min(n, days));
  const now = rows[0], x = rows[day];
  const diff = x.net_profit - now.net_profit;
  const life = d.shelf_life_days, cautious = d.shelf_life_p10_days;
  const left = life != null ? life - day : null;
  const risk = x.spoil_risk_pct;
  const riskTone = risk >= 50 ? "text-critical" : risk >= 10 ? "text-[#c2410c]" : "text-ok";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between"><b>Store for {day} day{day > 1 ? "s" : ""}</b><span className="text-[11px] text-ink-400">sell on {dayLabel(day)}</span></div>
      <Spark series={rows.map((r) => r.spoil_risk_pct)} day={day} color="#e8542f" max={100} />
      <Slider value={day} min={1} max={n} onChange={setDays} label="Days to store" />
      <div>
        <div className="flex justify-between text-xs"><span>Chance of spoiling by then</span><b className={cn("font-mono", riskTone)}>{num(risk, 0)}%</b></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-paper-200"><div className="h-2 rounded-full" style={{ width: `${Math.max(2, risk)}%`, background: risk >= 50 ? "#d64545" : risk >= 10 ? "#f08a4b" : "#3f9b62" }} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">Selling price that day</div><div className="font-mono text-lg font-bold">{inr(x.price_per_kg)}<span className="text-[10px] font-normal">/kg</span></div>
          {x.price_low !== x.price_high ? <div className="text-[10px] text-ink-400">likely {inr(x.price_low)}–{inr(x.price_high)} (forecast)</div>
            : <div className="text-[10px] text-ink-400">today's price (no reliable forecast for this market)</div>}</div>
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">{x.net_profit >= 0 ? "Profit" : "Loss"}</div><div className={cn("font-mono text-lg font-bold", x.net_profit < 0 && "text-critical")}>{inr(Math.abs(x.net_profit))}</div>
          <div className={cn("text-[10px] font-bold", diff >= 0 ? "text-ok" : "text-critical")}>{diff >= 0 ? "+" : "−"}{inr(Math.abs(diff))} vs selling today</div></div>
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">Quality then</div><div className="font-mono text-lg font-bold">{num(x.quality, 0)}</div><div className="text-[10px] text-ink-400">spoiled {kg(x.spoilage_loss_kg)}</div></div>
        <div className="rounded-xl bg-paper-200 p-2"><div className="text-ink-400">Storage cost</div><div className="font-mono text-lg font-bold">{inr(x.storage_cost)}</div><div className="text-[10px] text-ink-400">{x.storage_cost ? "cold storage charge" : "no charge (traditional)"}</div></div>
      </div>
      {life != null && (
        <div className={cn("rounded-xl p-2 text-xs", left != null && left <= 0 ? "bg-critical/10 text-critical" : "bg-teal/5 text-teal")}>
          Expires in about <b>{num(life, 1)} days</b> at today's godown conditions (cautious estimate {num(cautious, 1)} days).{" "}
          {left != null && left > 0 ? <>After storing {day} day{day > 1 ? "s" : ""}, about <b>{num(left, 1)} days</b> would be left to sell it.</> : <>Storing {day} days goes past expiry.</>}
        </div>
      )}
    </div>
  );
}
