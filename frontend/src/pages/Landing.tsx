import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Cpu, Snowflake, Sprout, Tag, Truck, Warehouse } from "lucide-react";
import { Logo } from "../components/AppLayout";
import { useAuth } from "../stores/auth";

const ReeferTruck = lazy(() => import("../three/Truck").then((m) => ({ default: m.ReeferTruck })));

const MODULES = [
  { icon: Sprout, title: "Post-harvest loss prevention", body: "Register farmers and batches, then follow each batch from the field through storage, inspection and sale." },
  { icon: Warehouse, title: "Traditional storage twin", body: "Brick, mud or tin rooms driven by live Open-Meteo weather, psychrometrics, Dalton's law and respiration gas balance." },
  { icon: Cpu, title: "Advanced storage + CV", body: "Upload produce photos; OpenCV separates good, damaged, rejected and uncertain items, shown on an animated sorting line." },
  { icon: Snowflake, title: "Cold storage allocation", body: "Capacity- and compatibility-aware zone recommendation, then a 3D cold room with refrigeration, door and airflow physics." },
  { icon: Tag, title: "Price intelligence", body: "Verified Agmarknet prices, a backtested statistical forecast, and a sell-now vs store-and-sell profit engine." },
  { icon: Truck, title: "Cold chain digital twin", body: "Refrigerated truck on a real OSRM road route, six-zone cargo heatmap, virtual sensors and seven fault scenarios." },
];

const PROBLEM = [
  ["Post-harvest loss", "Fruits and vegetables lose quality fast between harvest and sale; heat, humidity and delays decide how much reaches the market."],
  ["Invisible conditions", "Farmers and small storage operators rarely see temperature, humidity or gas levels until the produce is already damaged."],
  ["Blind selling decisions", "Without prices and shelf-life estimates, produce is sold at the wrong time — too early at a low price, or too late after spoilage."],
];

export default function Landing() {
  const token = useAuth((s) => s.token);
  return (
    <div className="min-h-screen bg-ink text-paper">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-3 text-sm">
          <a href="#modules" className="hidden text-ink-300 hover:text-gold sm:inline">Modules</a>
          <a href="#honesty" className="hidden text-ink-300 hover:text-gold sm:inline">Data policy</a>
          <Link to={token ? "/world" : "/login"} className="btn-gold">{token ? "Open simulation" : "Sign in"}</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <div className="label-dark mb-4 text-gold">AI-powered post-harvest loss prevention · cold chain digital twin</div>
          <h1 className="font-display text-6xl font-bold leading-[0.95] tracking-tight md:text-8xl">ZERO<br /><span className="text-gold">ROT</span></h1>
          <p className="mt-6 max-w-xl font-display text-2xl leading-snug text-paper md:text-3xl">Intelligent Agriculture.<br />Reduced Losses. Better Profits.</p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-300">
            Physics-based digital twins of farm storage, cold rooms and refrigerated trucks — fed by live weather and road routes — with shelf-life prediction,
            produce inspection and market-aware selling advice for farmers in Karnataka.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={token ? "/world" : "/login"} className="btn-gold px-6 py-3 text-sm">Launch Simulation <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/docs" className="btn-line-dark px-6 py-3 text-sm">How it works</Link>
          </div>
        </div>
        <div className="relative border border-ink-600">
          <Suspense fallback={<div className="h-[420px] bg-ink-800" />}>
            <ReeferTruck live={null} setpoint={12} cutaway={false} commodity="tomato" />
          </Suspense>
          <div className="pointer-events-none absolute bottom-3 left-3 chip bg-ink/80 text-paper">3D model · drag to rotate · live data appears inside the dashboard</div>
        </div>
      </section>

      <section className="border-y border-ink-600 bg-ink-800">
        <div className="mx-auto grid max-w-7xl gap-px px-5 py-12 md:grid-cols-3">
          {PROBLEM.map(([t, b], i) => (
            <div key={t} className="p-5">
              <div className="font-mono text-xs text-gold">0{i + 1}</div>
              <div className="mt-2 font-display text-xl font-semibold">{t}</div>
              <p className="mt-2 text-sm leading-relaxed text-ink-300">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-7xl px-5 py-16">
        <div className="label-dark text-gold">Platform</div>
        <h2 className="mt-2 font-display text-4xl font-bold">Six connected modules</h2>
        <div className="mt-8 grid gap-px bg-ink-600 md:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <div key={m.title} className="bg-ink p-6 transition-colors hover:bg-ink-800">
              <m.icon className="h-6 w-6 text-gold" />
              <div className="mt-4 font-display text-lg font-semibold">{m.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-ink-300">{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="grid gap-6 md:grid-cols-3">
          {(["tomato", "mango", "banana"] as const).map((c) => (
            <div key={c} className="border border-ink-600">
              <div className="grid grid-cols-3">
                {["fresh", "aging", "spoiling"].map((s) => <img key={s} src={`/produce/${c}_${s}.jpg`} alt={`${c} ${s}`} className="aspect-square w-full object-cover" loading="lazy" />)}
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-xs"><span className="font-semibold uppercase tracking-[0.1em]">{c}</span><span className="text-ink-300">fresh → aging → spoiling</span></div>
            </div>
          ))}
        </div>
      </section>

      <section id="honesty" className="border-t border-ink-600 bg-paper text-ink">
        <div className="mx-auto max-w-7xl px-5 py-14">
          <h2 className="font-display text-3xl font-bold">Every number says where it came from</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {[["SIMULATED", "bg-gold text-ink", "Virtual sensor readings produced by the physics model."], ["LIVE", "bg-ok text-white", "Retrieved from Open-Meteo, OSRM or Agmarknet with a timestamp."],
              ["MANUAL", "bg-ink text-paper", "Entered by the operator, e.g. a fallback temperature."], ["DATA UNAVAILABLE", "bg-critical text-white", "Shown instead of inventing a value when a source is down."]].map(([l, c, d]) => (
              <div key={l} className="border border-paper-300 bg-white p-4"><span className={`chip ${c}`}>{l}</span><p className="mt-2 text-sm text-ink-400">{d}</p></div>
            ))}
          </div>
        </div>
      </section>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-ink-300">
        <span>ZERO ROT · DL-SJBIT-HK26-AGR007</span>
        <span>Produce photos: see /produce/credits.json</span>
      </footer>
    </div>
  );
}
