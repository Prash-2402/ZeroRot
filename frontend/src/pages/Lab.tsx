import { Link } from "react-router-dom";
import { useSims } from "../components/shared";
import { SimulationView } from "../components/SimulationView";
import { Empty, PageHead, cn } from "../components/ui";
import { when } from "../lib/format";
import { useSelectedSim } from "./simlist";
import { KIND_LABEL } from "./Overview";

export default function Lab() {
  const [sel, setSel] = useSelectedSim();
  const { data } = useSims();
  const list = data?.simulations || [];
  return (
    <div className="space-y-4">
      <PageHead kicker="3D Simulation Lab" title="All digital twins" sub="Every simulation from every module in one place. All views are driven by the backend's authoritative simulation state over WebSocket." />
      {list.length === 0 ? (
        <Empty title="No simulations yet">Create one from <Link className="underline" to="/app/traditional">Traditional Storage</Link>, <Link className="underline" to="/app/cold-storage">Cold Storage</Link> or <Link className="underline" to="/app/cold-chain">Cold Chain</Link>.</Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[260px_1fr]">
          <div className="space-y-1">
            {list.map((s: any) => (
              <button key={s.id} onClick={() => setSel(s.id)} className={cn("block w-full border px-3 py-2 text-left text-xs", sel === s.id ? "border-ink bg-ink text-paper" : "border-paper-300 bg-white hover:border-ink")}>
                <div className="font-semibold">{s.name}</div>
                <div className={sel === s.id ? "text-ink-300" : "text-ink-400"}>{KIND_LABEL[s.kind]} · {s.status} · {when(s.created_at)}</div>
              </button>
            ))}
          </div>
          <div>{sel ? <SimulationView id={sel} /> : <Empty title="Select a simulation" />}</div>
        </div>
      )}
    </div>
  );
}
