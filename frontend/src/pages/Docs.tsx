import { Link } from "react-router-dom";

const ROWS: [string, string][] = [
  ["1 · Live entry (phone)", "Crop, quantity, harvest condition and location (GPS or place search). Choose a traditional or advanced godown. The laptop shows the tractor bringing the crates and the godown filling at 2000 kg/h with the door open."],
  ["2 · Godown", "Traditional: no sensors; inside conditions follow the live Open-Meteo forecast through brick walls and vents; alerts and suggestions. Advanced: insulated chamber with refrigeration and automatic control of temperature, humidity and gases (every action logged)."],
  ["3 · Predict (phone)", "Mandi rates (Agmarknet via data.gov.in, DATA UNAVAILABLE without a key), spoilage (shelf life now vs at recommended storage, P10–P90) and the sell-now vs store decision. Groq explains; numbers come from the models."],
  ["4 · Scan & bag (advanced)", "Photos are analysed with OpenCV; each item is graded A1 / A2 / A3 / rejected / uncertain. Shares are applied to the lot (estimate) and bagged in 25 kg bags at 1500 kg/h."],
  ["5 · Track", "Dispatch to a mandi: real OSRM road route, weather along the route, 6-zone cargo heat model (reefer) or open truck, checkpoints, ETA and delay. 'Road blocked' finds an alternative road from the truck's position. Arrival, unloading and delivery are notified."],
];

export default function Docs() {
  return (
    <div className="min-h-screen bg-ink text-paper">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link to="/world" className="text-xs text-gold underline">← Back to the simulation</Link>
        <h1 className="mt-4 font-display text-4xl font-bold">How ZERO ROT works</h1>
        <p className="mt-2 text-sm text-ink-300">The phone is the app; the laptop is the live simulation of the real world. Both show the same backend state over WebSocket within a second.</p>
        <div className="mt-6 divide-y divide-white/10 border border-white/10">
          {ROWS.map(([t, d]) => <div key={t} className="p-4"><div className="font-semibold text-gold">{t}</div><div className="mt-1 text-sm text-ink-300">{d}</div></div>)}
        </div>
        <h2 className="mt-8 font-display text-xl font-bold">Testing slowly</h2>
        <p className="mt-1 text-sm text-ink-300">Bottom bar on the laptop: pause, step +1 min / +10 min / +1 h of simulated time, speed from real time up to 1 h per second, test scenarios for the current stage, and the bug icon for raw backend values.</p>
        <h2 className="mt-8 font-display text-xl font-bold">Data labels</h2>
        <p className="mt-1 text-sm text-ink-300">Godown and truck sensors are SIMULATED by the physics engine. Weather, routes and checkpoint names are LIVE (Open-Meteo, OSRM, OpenStreetMap Nominatim). Prices are verified Agmarknet data or DATA UNAVAILABLE. Operating rates (loading, grading, unloading, bag size, truck specs) are stated assumptions.</p>
        <p className="mt-6 text-xs text-ink-400">Operations console (records, analytics, exports): <Link to="/app" className="underline">/app</Link></p>
      </div>
    </div>
  );
}
