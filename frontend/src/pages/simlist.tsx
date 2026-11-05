import { useSearchParams } from "react-router-dom";
import { useSims } from "../components/shared";
import { cn } from "../components/ui";
import { when } from "../lib/format";

/** Selected simulation id kept in the URL (?sim=) so views are linkable. */
export function useSelectedSim() {
  const [sp, setSp] = useSearchParams();
  const id = sp.get("sim") ? Number(sp.get("sim")) : null;
  return [id, (v: number | null) => setSp(v ? { sim: String(v) } : {})] as const;
}

export function SimList({ kind, selected, onSelect }: { kind: string; selected: number | null; onSelect: (id: number) => void }) {
  const { data } = useSims();
  const list = (data?.simulations || []).filter((s: any) => s.kind === kind);
  if (!list.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {list.map((s: any) => (
        <button key={s.id} onClick={() => onSelect(s.id)}
          className={cn("shrink-0 border px-3 py-2 text-left text-xs", selected === s.id ? "border-ink bg-ink text-paper" : "border-paper-300 bg-white hover:border-ink")}>
          <div className="font-semibold">{s.name}</div>
          <div className={selected === s.id ? "text-ink-300" : "text-ink-400"}>#{s.id} · {s.status} · {when(s.created_at)}</div>
        </button>
      ))}
    </div>
  );
}
