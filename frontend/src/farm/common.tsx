import type { ReactNode } from "react";
import { cn } from "../components/ui";
import { inr, qualityColor } from "../lib/format";
import { useT } from "../lib/i18n";

export function BigButton({ children, onClick, tone = "primary", disabled, className, icon }: {
  children: ReactNode; onClick?: () => void; tone?: "primary" | "danger" | "soft" | "ghost"; disabled?: boolean; className?: string; icon?: ReactNode;
}) {
  const t = {
    primary: "bg-forest text-cream-50 shadow-[0_6px_0_#112B21] hover:bg-forest-800 active:translate-y-[3px] active:shadow-[0_3px_0_#112B21]",
    danger: "bg-rot text-white shadow-[0_6px_0_#7E2A22] hover:bg-rot-600 active:translate-y-[3px] active:shadow-[0_3px_0_#7E2A22]",
    soft: "bg-white text-forest border-2 border-forest/15 shadow-[0_4px_0_#D7E6DC] hover:border-forest/40 active:translate-y-[2px] active:shadow-[0_2px_0_#D7E6DC]",
    ghost: "text-forest hover:bg-forest-50",
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn("flex w-full items-center justify-center gap-2.5 rounded-2xl px-5 py-4 text-base font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50", t, className)}>
      {icon}{children}
    </button>
  );
}

export function Answer({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="rounded-2xl bg-cream-100 px-3 py-3 text-center">
      <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="num mt-1 text-[26px] font-extrabold leading-none" style={{ color: color || "#1F4D3A" }}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-tight text-charcoal-500">{sub}</div>}
    </div>
  );
}

export function useDaysText() {
  const { t } = useT();
  return (d: number | null | undefined, beyond?: boolean) => {
    if (beyond || d === null || d === undefined) return t("moreThan30");
    if (d < 1) return `${Math.max(0, Math.round(d * 24))} ${t("hours")}`;
    return `${d.toFixed(1)} ${t("days")}`;
  };
}

export function ThreeAnswers({ quality, category, days, p10, p90, beyond, value, valueLabel }: any) {
  const { t } = useT();
  const daysText = useDaysText();
  return (
    <div className="grid grid-cols-3 gap-2">
      <Answer label={t("quality")} value={`${Math.round(quality)}%`} sub={t(category)} color={qualityColor(quality)} />
      <Answer label={t("daysLeft")} value={beyond ? "30+" : days === null || days === undefined ? "—" : days < 1 ? "<1" : days.toFixed(1)}
        sub={beyond ? t("moreThan30") : p10 !== undefined && p90 !== undefined ? `${p10.toFixed(1)}–${p90.toFixed(1)} ${t("days")}` : daysText(days)} />
      <Answer label={valueLabel || t("worth")} value={inr(value, { compact: value >= 100000 })} />
    </div>
  );
}

export function actionTitle(action: any, t: any, market: any) {
  if (!action) return "";
  if (action.kind === "SELL") return t("SELL_title", { m: market(action.market_id, action.market_name) });
  if (action.kind === "SHIP") return t("SHIP_title", { m: market(action.market_id, action.market_name) });
  if (action.kind === "STORE") return t("STORE_title", { d: action.store_days ?? 2 });
  return action.explanation || action.kind;
}
