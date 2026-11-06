import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ChevronDown, ChevronUp, CloudSun, Cpu, Languages, LineChart, Mic, Route, ScanLine, Smartphone, Sprout, Truck, Warehouse } from "lucide-react";
import { useAuth } from "../stores/auth";
import type { Flight } from "../landing/LandingScene";

const LandingScene = lazy(() => import("../landing/LandingScene"));
const N = 5;
const FLIGHT_MS = 1900;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);   // easeInOutCubic

const TITLES = ["ZERO ROT", "The problem", "What it does", "How it works", "The impact"];

function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ffd0c4] backdrop-blur">{children}</div>;
}

function Slide({ i, token }: { i: number; token: string | null }) {
  const cta = token ? "/world" : "/login";
  if (i === 0) return (
    <div className="max-w-3xl">
      <Kicker><Sprout className="h-3.5 w-3.5" /> Post-harvest digital twin</Kicker>
      <img src="/logo.png" alt="ZERO ROT" className="mb-3 h-14 w-auto drop-shadow-[0_6px_30px_rgba(0,0,0,0.45)] sm:h-20" />
      <h1 className="font-display text-4xl font-black leading-[1.05] text-white sm:text-5xl xl:text-6xl">Field to market,<br /><span className="text-[#FF684A]">without the rot.</span></h1>
      <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">ZERO ROT predicts how fast produce will spoil, what it will sell for, and whether to sell, store or discard, in Kannada, on any phone, even for a simple shed.</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link to={cta} className="inline-flex items-center gap-2 rounded-full bg-[#FF684A] px-6 py-3 font-bold text-white shadow-[0_10px_30px_rgba(255,104,74,0.45)] transition hover:scale-[1.03]">Launch simulation <ArrowRight className="h-4 w-4" /></Link>
        {!token && <Link to="/login" className="rounded-full border border-white/30 px-6 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/10">Sign in</Link>}
      </div>
    </div>
  );
  if (i === 1) return (
    <div className="max-w-4xl">
      <Kicker>Why we built it</Kicker>
      <h2 className="font-display text-3xl font-black leading-tight text-white sm:text-5xl"><span className="text-[#ff6b5a]">₹1.53 lakh crore</span><br />of produce is lost every year.</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[["6–15%", "of fruits lost after harvest"], ["5–12%", "of vegetables lost after harvest"], ["₹2–5/kg", "tomato in Sept 2023, weeks after ₹150+/kg; farmers dumped crops on roads"]].map(([a, b]) => (
          <div key={a} className="rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur"><div className="font-mono text-3xl font-bold text-[#ff8a7a]">{a}</div><div className="mt-1 text-sm text-white/75">{b}</div></div>
        ))}
      </div>
      <p className="mt-5 max-w-2xl text-base text-white/85 sm:text-lg">Produce isn't lost because it was bad. It's lost because farmers can't see <b className="text-white">when it will spoil</b> or <b className="text-white">what waiting will earn</b>. Most store in sheds, with no sensors and no forecast.</p>
      <div className="mt-3 text-[11px] text-white/50">Sources: NABCONS study for MoFPI (2022); news reports of the 2023 tomato price crash.</div>
    </div>
  );
  if (i === 2) return (
    <div className="max-w-5xl">
      <Kicker>Features</Kicker>
      <h2 className="font-display text-4xl font-black text-white sm:text-5xl">One assistant, from harvest to mandi.</h2>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[[Cpu, "Physics digital twin", "Temperature, humidity, chilling and ripening decay, 100 Monte Carlo runs for a likely range."],
          [Warehouse, "Already-stored produce", "Replays the real past weather, so a lot entered late starts at its true quality."],
          [LineChart, "Weather-aware prices", "A year of Agmarknet prices plus rain and heat; used only when it beats “price stays the same”."],
          [Sprout, "Sell, store or discard", "Day sliders show quality, price, profit, spoilage risk and expiry. The farmer decides."],
          [Mic, "Kannada voice assistant", "Speak entries and questions; a 3D assistant answers in a natural female Kannada voice."],
          [Truck, "Live cold chain", "Trucks on real roads, checkpoints, automatic reroutes and alerts that ding on the phone."]].map(([Icon, t, b]: any) => (
          <motion.div key={t} whileHover={{ y: -4 }} className="rounded-2xl border border-white/15 bg-black/30 p-4 backdrop-blur">
            <Icon className="h-6 w-6 text-[#7fe3d6]" /><div className="mt-2 font-bold text-white">{t}</div><div className="mt-1 text-sm text-white/70">{b}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
  if (i === 3) return (
    <div className="max-w-5xl">
      <Kicker>Implementation</Kicker>
      <h2 className="font-display text-4xl font-black text-white sm:text-5xl">Phone in hand, world on the laptop.</h2>
      <div className="mt-7 flex flex-wrap items-stretch gap-2">
        {[[Smartphone, "Phone", "Scan QR + PIN; entry by voice or touch"], [Cpu, "FastAPI backend", "Authoritative live simulation, 1 s ticks"],
          [CloudSun, "Live data", "Open-Meteo weather, Agmarknet prices, OSRM roads"], [ScanLine, "Models", "Q10 decay, gradient-boosting price forecast"],
          [Languages, "AI layer", "Groq LLM explains; offline Kannada voice"], [Route, "3D world", "Three.js laptop view of every lot"]].map(([Icon, t, b]: any, k) => (
          <div key={t} className="flex items-center gap-2">
            <div className="w-40 rounded-2xl border border-white/15 bg-black/35 p-3 backdrop-blur"><Icon className="h-5 w-5 text-[#FF684A]" /><div className="mt-1 text-sm font-bold text-white">{t}</div><div className="text-[11px] text-white/65">{b}</div></div>
            {k < 5 && <ArrowRight className="hidden h-4 w-4 text-white/40 lg:block" />}
          </div>
        ))}
      </div>
      <p className="mt-5 max-w-2xl text-sm text-white/75">Numbers come from models and verified sources, never from the AI. When data is missing the app says so. API keys stay on the server, and QR codes carry no keys.</p>
    </div>
  );
  return (
    <div className="max-w-3xl">
      <Kicker>Conclusion</Kicker>
      <h2 className="font-display text-4xl font-black leading-tight text-white sm:text-5xl">Less rot.<br /><span className="text-[#ffcf70]">Better prices.</span> Every farmer.</h2>
      <ul className="mt-6 space-y-2 text-base text-white/85 sm:text-lg">
        <li>• Farmers stop selling blind or dumping crops: they see spoilage and profit day by day.</li>
        <li>• Works with the storage farmers already have, from a shed to a cold room.</li>
        <li>• Supports UN SDG 12.3: halve food loss along the supply chain.</li>
      </ul>
      <Link to={cta} className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#FF684A] px-6 py-3 font-bold text-white shadow-[0_10px_30px_rgba(255,104,74,0.45)] transition hover:scale-[1.03]">Try ZERO ROT <ArrowRight className="h-4 w-4" /></Link>
    </div>
  );
}

export default function Landing() {
  const token = useAuth((s) => s.token);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const flight = useRef<Flight>({ progress: 0, speed: 0 });
  const anim = useRef<{ from: number; to: number; start: number } | null>(null);
  const busy = useRef(false);

  // smooth eased camera flight between stations; `speed` drives the light streaks
  useEffect(() => {
    let raf = 0, last = flight.current.progress;
    const tick = (now: number) => {
      const a = anim.current;
      if (a) {
        const k = Math.min(1, (now - a.start) / FLIGHT_MS);
        flight.current.progress = a.from + (a.to - a.from) * ease(k);
        if (k >= 1) { anim.current = null; busy.current = false; }
      }
      flight.current.speed = Math.abs(flight.current.progress - last) * 60;
      last = flight.current.progress;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const go = useCallback((to: number) => {
    to = Math.max(0, Math.min(N - 1, to));
    if (busy.current || to === idx) return;
    busy.current = true;
    setDir(to > idx ? 1 : -1);
    setIdx(to);
    anim.current = { from: flight.current.progress, to, start: performance.now() };
  }, [idx]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (["ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(idx + 1); }
      if (["ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go(idx - 1); }
    };
    let wheelLock = 0;
    const wheel = (e: WheelEvent) => {
      const now = Date.now();
      if (Math.abs(e.deltaY) < 25 || now < wheelLock) return;
      wheelLock = now + FLIGHT_MS + 150;
      go(idx + (e.deltaY > 0 ? 1 : -1));
    };
    let touchY: number | null = null;
    const ts = (e: TouchEvent) => { touchY = e.touches[0].clientY; };
    const te = (e: TouchEvent) => { if (touchY == null) return; const d = touchY - e.changedTouches[0].clientY; if (Math.abs(d) > 50) go(idx + (d > 0 ? 1 : -1)); touchY = null; };
    window.addEventListener("keydown", key);
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("touchstart", ts, { passive: true });
    window.addEventListener("touchend", te, { passive: true });
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("wheel", wheel); window.removeEventListener("touchstart", ts); window.removeEventListener("touchend", te); };
  }, [go, idx]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0e3b38] text-white">
      <div className="absolute inset-0"><Suspense fallback={null}><LandingScene flight={flight} /></Suspense></div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" />

      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4 sm:px-10">
        <img src="/logo.png" alt="ZERO ROT" className="h-9 w-auto" />
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/docs" className="hidden rounded-full px-4 py-2 text-white/80 hover:text-white sm:block">Docs</Link>
          <Link to={token ? "/world" : "/login"} className="rounded-full bg-white/15 px-4 py-2 font-semibold backdrop-blur hover:bg-white/25">{token ? "Open simulation" : "Sign in"}</Link>
        </nav>
      </header>

      <main className="absolute inset-0 z-10 flex items-center overflow-y-auto px-5 pb-28 pt-20 sm:px-12 lg:px-20">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.section key={idx} custom={dir} className="w-full"
            initial={{ opacity: 0, y: dir * 70, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.8, delay: 0.75, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, y: dir * -60, filter: "blur(8px)", transition: { duration: 0.5, ease: [0.55, 0, 1, 0.45] } }}>
            <Slide i={idx} token={token} />
          </motion.section>
        </AnimatePresence>
      </main>

      {/* slide dots */}
      <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-3 sm:right-8">
        {TITLES.map((t, k) => (
          <button key={t} onClick={() => go(k)} aria-label={`Go to ${t}`} className="group flex items-center justify-end gap-2">
            <span className={`hidden text-[11px] font-semibold transition sm:block ${k === idx ? "text-white" : "text-white/0 group-hover:text-white/70"}`}>{t}</span>
            <span className={`block rounded-full transition-all ${k === idx ? "h-3 w-3 bg-[#FF684A] shadow-[0_0_12px_#FF684A]" : "h-2 w-2 bg-white/40"}`} />
          </button>
        ))}
      </div>

      {/* down / up button */}
      <div className="absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2">
        <div className="font-mono text-[11px] text-white/60">{String(idx + 1).padStart(2, "0")} / {String(N).padStart(2, "0")} · {TITLES[idx]}</div>
        <motion.button onClick={() => go(idx < N - 1 ? idx + 1 : 0)} aria-label={idx < N - 1 ? "Next slide" : "Back to start"}
          whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} animate={{ y: [0, 6, 0] }} transition={{ y: { duration: 1.8, repeat: Infinity, ease: "easeInOut" } }}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur hover:bg-[#FF684A]">
          {idx < N - 1 ? <ChevronDown className="h-7 w-7" /> : <ChevronUp className="h-7 w-7" />}
        </motion.button>
      </div>
    </div>
  );
}
