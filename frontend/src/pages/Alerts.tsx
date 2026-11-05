import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../lib/api";
import { Empty, ErrorBox, PageHead, Seg } from "../components/ui";
import { AlertRow } from "../components/SimulationView";
import { ExplainButton } from "../components/shared";

export default function Alerts() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"open" | "acknowledged" | "resolved" | "all">("open");
  const [sev, setSev] = useState<"" | "CRITICAL" | "WARNING" | "INFO">("");
  const q = useQuery({ queryKey: ["alerts", "list", status, sev], queryFn: () => api(`/alerts?limit=300${status !== "all" ? `&status=${status}` : ""}${sev ? `&severity=${sev}` : ""}`), refetchInterval: 15000 });
  const ack = useMutation({ mutationFn: (id: number) => post(`/alerts/${id}/acknowledge`), onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }) });
  const list = q.data?.alerts || [];
  return (
    <div className="space-y-4">
      <PageHead kicker="Event detection" title="Alerts" sub="Each alert records the timestamp, the reading, the expected range, the risk and a recommended action. Alerts come only from simulated readings, never from invented events." />
      <div className="flex flex-wrap gap-3">
        <Seg value={status} onChange={setStatus} options={[{ value: "open", label: "Open" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]} />
        <Seg value={sev} onChange={setSev} options={[{ value: "", label: "Any severity" }, { value: "CRITICAL", label: "Critical" }, { value: "WARNING", label: "Warning" }, { value: "INFO", label: "Info" }]} />
      </div>
      <ErrorBox error={q.error || ack.error} />
      {list.length === 0 ? <Empty title="No alerts">Nothing matches this filter.</Empty> : (
        <div className="space-y-2">
          {list.map((a: any) => (
            <div key={a.id}>
              <AlertRow a={a} onAck={() => ack.mutate(a.id)} />
              <div className="flex flex-wrap items-start gap-3 border-x border-b border-paper-300 bg-paper-50 px-3 py-2">
                {a.simulation_id && <Link to={`/app/lab?sim=${a.simulation_id}`} className="text-xs font-semibold underline">Open simulation #{a.simulation_id}</Link>}
                <details className="flex-1 text-xs"><summary className="cursor-pointer font-semibold">AI explanation</summary><div className="mt-2"><ExplainButton body={{ task: "alert", alert_id: a.id }} /></div></details>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
