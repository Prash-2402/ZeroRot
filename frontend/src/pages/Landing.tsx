import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "framer-motion";
import { ArrowRight, ChevronDown, ChevronUp, CloudSun, Cpu, Languages, LineChart, Mic, Route, ScanLine, Smartphone, Sprout, Truck, Warehouse } from "lucide-react";
import { useAuth } from "../stores/auth";
import type { Flight } from "../landing/LandingScene";

const LandingScene = lazy(() => import("../landing/LandingScene"));
const N = 5;
const FLIGHT_MS = 1800;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);   // easeInOutCubic
const TITLES = ["ZERO ROT", "The problem", "What it does", "How it works", "The impact"];

/* staggered entrance: the slide's items appear one after another once the island has arrived */
const list = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.65 } } };
const item = { hidden: { opacity: 0, y: 26, filter: "blur(6px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } } };
const M = motion.div;

function Kicker({ children }: { children: React.ReactNode }) {
  return <M variants={item} className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ffd0c4] backdrop-blur">{children}</M>;
}

function CountUp({ to, decimals = 0, prefix = "", suffix = "" }: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (x) => `${prefix}${x.toFixed(decimals)}${suffix}`);
  useEffect(() => { const c = animate(v, to, { duration: 1.8, delay: 0.8, ease: [0.16, 1, 0.3, 1] }); return () => c.stop(); }, [to, v]);
  return <motion.span>{text}</motion.span>;
}

const card = "rounded-2xl border border-white/15 bg-black/35 p-3.5 backdrop-blur-md";

function Slide({ i, token }: { i: number; token: string | null }) {
  const cta = token ? "/world" : "/login";
  if (i === 0) return (
    <>
      <Kicker><Sprout className="h-3.5 w-3.5" /> Post-harvest digital twin</Kicker>
      <M variants={item}><img src="/logo.png" alt="ZERO ROT" className="mb-3 h-14 w-auto drop-shadow-[0_6px_30px_rgba(0,0,0,0.45)] sm:h-20" /></M>
      <M variants={item}><h1 className="font-display text-4xl font-black leading-[1.04] text-white sm:text-5xl xl:text-6xl">Field to market,<br /><span className="bg-gradient-to-r from-[#FF684A] to-[#ffb26b] bg-clip-text text-transparent">without the rot.</span></h1></M>
      <M variants={item}><p className="mt-4 text-base text-white/85 sm:text-lg">ZERO ROT predicts how fast your produce will spoil, what it will sell for, and whether to sell, store or discard. In Kannada, on any phone, even for a simple shed.</p></M>
      <M variants={item} className="mt-5 flex flex-wrap gap-2 text-xs">
        {["17 crops", "14-day sell and store planner", "Kannada voice assistant", "Live 3D simulation"].map((x) => <span key={x} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-white/85 backdrop-blur">{x}</span>)}
      </M>
      <M variants={item} className="mt-6 flex flex-wrap gap-3">
        <Link to={cta} className="group inline-flex items-center gap-2 rounded-full bg-[#FF684A] px-6 py-3 font-bold text-white shadow-[0_10px_30px_rgba(255,104,74,0.45)] transition hover:scale-[1.03]">Launch simulation <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link>
        {!token && <Link to="/login" className="rounded-full border border-white/30 px-6 py-3 font-semibold text-white backdrop-blur transition hover:bg-white/10">Sign in</Link>}
      </M>
    </>
  );
  if (i === 1) return (
    <>
      <Kicker>Why we built it</Kicker>
      <M variants={item}><h2 className="font-display text-3xl font-black leading-tight text-white sm:text-5xl"><span className="text-[#ff7a6a]"><CountUp to={1.53} decimals={2} prefix="₹" suffix=" lakh crore" /></span><br />of produce lost every year in India.</h2></M>
      <M variants={item} className="mt-5 grid grid-cols-2 gap-2.5">
        <div className={card}><div className="font-mono text-2xl font-bold text-[#ff9a8a]">6–15%</div><div className="mt-1 text-xs text-white/75">of fruits lost after harvest</div></div>
        <div className={card}><div className="font-mono text-2xl font-bold text-[#ff9a8a]">5–12%</div><div className="mt-1 text-xs text-white/75">of vegetables lost after harvest</div></div>
        <div className={card}><div className="font-mono text-2xl font-bold text-[#ff9a8a]">₹150 → ₹2–5</div><div className="mt-1 text-xs text-white/75">per kg of tomato, July to Sept 2023; farmers dumped crops on roads</div></div>
        <div className={card}><div className="font-mono text-2xl font-bold text-[#ff9a8a]">₹2.49</div><div className="mt-1 text-xs text-white/75">net payment reported for 512 kg of onions, Maharashtra 2023</div></div>
      </M>
      <M variants={item}><p className="mt-4 text-base text-white/85">Produce isn't lost because it was bad. It's lost because farmers can't see <b className="text-white">when it will spoil</b> or <b className="text-white">what waiting will earn</b>, and most store in sheds with no sensors and no forecast.</p></M>
      <M variants={item}><div className="mt-2 text-[11px] text-white/50">Sources: NABCONS study for the Ministry of Food Processing Industries (2022); news reports.</div></M>
    </>
  );
  if (i === 2) return (
    <>
      <Kicker>Features</Kicker>
      <M variants={item}><h2 className="font-display text-3xl font-black text-white sm:text-5xl">One assistant, from harvest to mandi.</h2></M>
      <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {[[Cpu, "Physics digital twin", "Q10 decay with humidity, chilling and ripening; 100 Monte Carlo runs give a likely range."],
          [Warehouse, "Already-stored produce", "Up to 365 days since harvest, replayed with the real past weather of the place."],
          [LineChart, "Weather-aware price forecast", "A year of Agmarknet prices plus rain and heat; used only when it beats “price stays the same”."],
          [Sprout, "Sell, store or discard", "14-day sliders: quality, price, profit, spoilage risk and expiry. The farmer decides."],
          [Mic, "Kannada voice assistant", "Speak entries and questions; a 3D assistant replies in a natural female Kannada voice."],
          [Truck, "Live cold chain", "Trucks on real roads, checkpoints, automatic reroutes, and alerts that ding on the phone."]].map(([Icon, t, b]: any) => (
          <M key={t} variants={item} whileHover={{ y: -3 }} className={card}>
            <div className="flex items-center gap-2"><Icon className="h-5 w-5 text-[#7fe3d6]" /><div className="text-sm font-bold text-white">{t}</div></div>
            <div className="mt-1 text-xs leading-snug text-white/72">{b}</div>
          </M>
        ))}
      </div>
    </>
  );
  if (i === 3) return (
    <>
      <Kicker>Implementation</Kicker>
      <M variants={item}><h2 className="font-display text-3xl font-black text-white sm:text-4xl xl:text-5xl">Phone in hand, world on the laptop.</h2></M>
      <div className="mt-4 space-y-1.5">
        {[[Smartphone, "Phone app", "Scan the QR code, enter the PIN, add a crop by voice or touch"],
          [Cpu, "FastAPI backend", "Runs the live simulation every second; the single source of truth"],
          [CloudSun, "Live data", "Open-Meteo weather, data.gov.in Agmarknet prices, OSRM road routes"],
          [ScanLine, "Models", "Q10 decay engine, gradient-boosting price forecast with backtest"],
          [Languages, "AI layer", "Groq language model explains the numbers; offline SYSPIN Kannada voice"],
          [Route, "3D world", "Three.js laptop view of every lot: godowns, scan house, trucks, mandi"]].map(([Icon, t, b]: any, k) => (
          <M key={t} variants={item} className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF684A]/90 font-mono text-xs font-bold text-white">{k + 1}</div>
            <div className={`${card} flex flex-1 items-center gap-3 py-2`}><Icon className="h-5 w-5 shrink-0 text-[#7fe3d6]" /><div><div className="text-sm font-bold text-white">{t}</div><div className="text-xs text-white/70">{b}</div></div></div>
          </M>
        ))}
      </div>
      <M variants={item}><p className="mt-3 text-xs text-white/65">Numbers come from models and verified sources, never invented by the AI. When data is missing, the app says so. API keys stay on the server, and QR codes carry no keys.</p></M>
    </>
  );
  return (
    <>
      <Kicker>Conclusion</Kicker>
      <M variants={item}><h2 className="font-display text-4xl font-black leading-tight text-white sm:text-5xl">Less rot.<br /><span className="bg-gradient-to-r from-[#ffcf70] to-[#FF684A] bg-clip-text text-transparent">Better prices.</span><br />Every farmer.</h2></M>
      <div className="mt-5 space-y-2">
        {[["Farmers", "No more selling blind or dumping crops: spoilage and profit are visible day by day."],
          ["Godowns", "Small problems are fixed automatically and logged; only emergencies need a person."],
          ["Supply chain", "Graded A1/A2/A3 lots go to the right markets; trucks reroute around blocked roads."],
          ["Society", "Supports UN SDG 12.3: halve food loss along supply chains."]].map(([t, b]) => (
          <M key={t} variants={item} className={`${card} py-2`}><b className="text-[#ffcf70]">{t}</b> <span className="text-sm text-white/80">· {b}</span></M>
        ))}
      </div>
      <M variants={item}><Link to={cta} className="group mt-6 inline-flex items-center gap-2 rounded-full bg-[#FF684A] px-6 py-3 font-bold text-white shadow-[0_10px_30px_rgba(255,104,74,0.45)] transition hover:scale-[1.03]">Try ZERO ROT <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></Link></M>
    </>
  );
}

export default function Landing() {
  const token = useAuth((s) => s.token);
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [ready, setReady] = useState(false);
  const flight = useRef<Flight>({ progress: 0, speed: 0 });
  const anim = useRef<{ from: number; to: number; start: number } | null>(null);
  const busy = useRef(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 12000); return () => clearTimeout(t); }, []);   // never hide the page behind the loader

  // eased turntable rotation between islands; `speed` drives the speed lines
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
      if (["ArrowDown", "PageDown", " ", "ArrowRight"].includes(e.key)) { e.preventDefault(); go(idx + 1); }
      if (["ArrowUp", "PageUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); go(idx - 1); }
    };
    let wheelLock = 0;
    const wheel = (e: WheelEvent) => {
      const now = Date.now();
      if (Math.abs(e.deltaY) < 25 || now < wheelLock) return;
      wheelLock = now + FLIGHT_MS + 200;
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
    <div className="fixed inset-0 overflow-hidden bg-[#0f4a45] text-white">
      <div className="absolute inset-0"><Suspense fallback={null}><LandingScene flight={flight} onReady={() => setReady(true)} /></Suspense></div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/60 via-black/25 to-transparent lg:via-black/10" />

      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4 sm:px-10">
        <img src="/logo.png" alt="ZERO ROT" className="h-9 w-auto" />
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/docs" className="hidden rounded-full px-4 py-2 text-white/80 hover:text-white sm:block">Docs</Link>
          <Link to={token ? "/world" : "/login"} className="rounded-full bg-white/15 px-4 py-2 font-semibold backdrop-blur hover:bg-white/25">{token ? "Open simulation" : "Sign in"}</Link>
        </nav>
      </header>

      <main className="absolute inset-0 z-10 flex flex-col overflow-y-auto px-5 pb-28 pt-20 sm:px-12 lg:px-20">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.section key={idx} custom={dir} className="my-auto w-full max-w-[600px] xl:max-w-[640px]" variants={list} initial="hidden" animate="show"
            exit={{ opacity: 0, x: dir * -80, filter: "blur(8px)", transition: { duration: 0.45, ease: [0.55, 0, 1, 0.45] } }}>
            <Slide i={idx} token={token} />
          </motion.section>
        </AnimatePresence>
      </main>

      {/* progress rail */}
      <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-3 sm:right-8">
        {TITLES.map((t, k) => (
          <button key={t} onClick={() => go(k)} aria-label={`Go to ${t}`} className="group flex items-center justify-end gap-2">
            <span className={`hidden text-[11px] font-semibold transition sm:block ${k === idx ? "text-white" : "text-white/0 group-hover:text-white/70"}`}>{t}</span>
            <span className={`block rounded-full transition-all duration-500 ${k === idx ? "h-8 w-2 bg-[#FF684A] shadow-[0_0_14px_#FF684A]" : "h-2 w-2 bg-white/45"}`} />
          </button>
        ))}
      </div>

      {/* down button */}
      <div className="absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2">
        <div className="font-mono text-[11px] text-white/65">{String(idx + 1).padStart(2, "0")} / {String(N).padStart(2, "0")} · {TITLES[idx]}</div>
        <motion.button onClick={() => go(idx < N - 1 ? idx + 1 : 0)} aria-label={idx < N - 1 ? "Next slide" : "Back to start"}
          whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} animate={{ y: [0, 6, 0] }} transition={{ y: { duration: 1.8, repeat: Infinity, ease: "easeInOut" } }}
          className="relative flex h-14 w-14 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur transition-colors hover:bg-[#FF684A]">
          <span className="absolute inset-0 animate-ping rounded-full border border-white/30" style={{ animationDuration: "2.4s" }} />
          {idx < N - 1 ? <ChevronDown className="h-7 w-7" /> : <ChevronUp className="h-7 w-7" />}
        </motion.button>
      </div>

      {/* loader while the 3D world builds */}
      <AnimatePresence>
        {!ready && (
          <motion.div key="loader" exit={{ opacity: 0, transition: { duration: 0.8 } }} className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#0f4a45]">
            <motion.img src="/logo.png" alt="ZERO ROT" className="h-16 w-auto" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
            <div className="h-1 w-48 overflow-hidden rounded-full bg-white/15"><motion.div className="h-1 rounded-full bg-[#FF684A]" initial={{ x: "-100%" }} animate={{ x: "100%" }} transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }} /></div>
            <div className="text-xs uppercase tracking-[0.25em] text-white/60">Growing the farm…</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
