import { create } from "zustand";

export type Lang = "en" | "kn";

const D = {
  tagline: ["Predict. Preserve. Prevent.", "ಮುನ್ಸೂಚಿಸಿ. ಸಂರಕ್ಷಿಸಿ. ತಡೆಯಿರಿ."],
  myFarm: ["My farm", "ನನ್ನ ಜಮೀನು"],
  shed: ["Farm shed", "ಹೊಲದ ಶೆಡ್"],
  cold: ["Cold storage", "ಶೀತಲ ಸಂಗ್ರಹಾಗಾರ"],
  truck: ["Mandi truck", "ಮಂಡಿ ಲಾರಿ"],
  quality: ["Quality now", "ಈಗಿನ ಗುಣಮಟ್ಟ"],
  qualityAt: ["Quality", "ಗುಣಮಟ್ಟ"],
  daysLeft: ["Days left", "ಉಳಿದ ದಿನಗಳು"],
  worth: ["Worth today", "ಇಂದಿನ ಮೌಲ್ಯ"],
  worthAt: ["Worth", "ಮೌಲ್ಯ"],
  days: ["days", "ದಿನಗಳು"],
  hours: ["hours", "ಗಂಟೆಗಳು"],
  moreThan30: ["more than 30 days", "30 ದಿನಗಳಿಗಿಂತ ಹೆಚ್ಚು"],
  Excellent: ["Excellent", "ಅತ್ಯುತ್ತಮ"], Good: ["Good", "ಉತ್ತಮ"], Fair: ["Fair", "ಸಾಧಾರಣ"], Poor: ["Poor", "ಕಳಪೆ"], Unsellable: ["Unsellable", "ಮಾರಲಾಗದು"],
  whatToDo: ["What should I do?", "ನಾನು ಏನು ಮಾಡಬೇಕು?"],
  SELL_title: ["Sell at {m}", "{m} ನಲ್ಲಿ ಮಾರಾಟ ಮಾಡಿ"],
  SHIP_title: ["Send to {m}", "{m} ಗೆ ಕಳುಹಿಸಿ"],
  STORE_title: ["Keep {d} days in cold storage", "{d} ದಿನ ಶೀತಲ ಸಂಗ್ರಹದಲ್ಲಿ ಇಡಿ"],
  youGet: ["You get about {v}", "ನಿಮಗೆ ಸುಮಾರು {v} ಸಿಗುತ್ತದೆ"],
  reason_SELL: ["Waiting will lower the value. Sell at {q}% quality.", "ಕಾಯುವುದರಿಂದ ಮೌಲ್ಯ ಕಡಿಮೆಯಾಗುತ್ತದೆ. {q}% ಗುಣಮಟ್ಟದಲ್ಲಿ ಮಾರಿ."],
  reason_SHIP: ["{p}% more than selling at {l} today, sold at {q}% quality.", "ಇಂದು {l} ನಲ್ಲಿ ಮಾರುವುದಕ್ಕಿಂತ {p}% ಹೆಚ್ಚು, {q}% ಗುಣಮಟ್ಟದಲ್ಲಿ ಮಾರಾಟ."],
  reason_STORE: ["{p}% more than selling today. Cold storage keeps it fresh.", "ಇಂದು ಮಾರುವುದಕ್ಕಿಂತ {p}% ಹೆಚ್ಚು. ಶೀತಲ ಸಂಗ್ರಹ ತಾಜಾವಾಗಿಡುತ್ತದೆ."],
  urgent: ["Act fast", "ಬೇಗ ಕ್ರಮ ಕೈಗೊಳ್ಳಿ"],
  seeChoices: ["See all choices", "ಎಲ್ಲಾ ಆಯ್ಕೆಗಳನ್ನು ನೋಡಿ"],
  future: ["See the future", "ಭವಿಷ್ಯ ನೋಡಿ"],
  futureHint: ["Drag to see how quality and value change if nothing changes.", "ಏನೂ ಬದಲಾಗದಿದ್ದರೆ ಗುಣಮಟ್ಟ ಮತ್ತು ಮೌಲ್ಯ ಹೇಗೆ ಬದಲಾಗುತ್ತದೆ ಎಂದು ನೋಡಲು ಎಳೆಯಿರಿ."],
  today: ["Today", "ಇಂದು"],
  dayN: ["Day {n}", "{n}ನೇ ದಿನ"],
  whatIf: ["What if I…", "ಒಂದು ವೇಳೆ ನಾನು…"],
  keepCool: ["Keep it cool", "ತಂಪಾಗಿ ಇಟ್ಟರೆ"],
  sell2: ["Sell in 2 days", "2 ದಿನದಲ್ಲಿ ಮಾರಿದರೆ"],
  sendBlr: ["Send to Bengaluru", "ಬೆಂಗಳೂರಿಗೆ ಕಳುಹಿಸಿದರೆ"],
  now: ["Now", "ಈಗ"],
  ifYouDo: ["If you do this", "ಹೀಗೆ ಮಾಡಿದರೆ"],
  weatherNote: ["Shed temperature is estimated from local weather. Enter a measured reading for a better answer.", "ಶೆಡ್ ತಾಪಮಾನವನ್ನು ಸ್ಥಳೀಯ ಹವಾಮಾನದಿಂದ ಅಂದಾಜಿಸಲಾಗಿದೆ. ಉತ್ತಮ ಉತ್ತರಕ್ಕಾಗಿ ಅಳೆದ ತಾಪಮಾನ ನಮೂದಿಸಿ."],
  saveReading: ["Save reading", "ಉಳಿಸಿ"],
  handover: ["Hand over to mandi truck", "ಮಂಡಿ ಲಾರಿಗೆ ಹಸ್ತಾಂತರಿಸಿ"],
  truckWaiting: ["The mandi company's truck is waiting at your farm.", "ಮಂಡಿ ಕಂಪನಿಯ ಲಾರಿ ನಿಮ್ಮ ಜಮೀನಿನಲ್ಲಿ ಕಾಯುತ್ತಿದೆ."],
  truckGoesTo: ["It will take your load to {m}.", "ಇದು ನಿಮ್ಮ ಸರಕನ್ನು {m} ಗೆ ಕೊಂಡೊಯ್ಯುತ್ತದೆ."],
  loadingNow: ["Loading crates into the truck…", "ಪೆಟ್ಟಿಗೆಗಳನ್ನು ಲಾರಿಗೆ ತುಂಬಿಸಲಾಗುತ್ತಿದೆ…"],
  onRoad: ["On the road to {m}", "{m} ಕಡೆಗೆ ಪ್ರಯಾಣದಲ್ಲಿದೆ"],
  arrived: ["Arrived at {m}", "{m} ತಲುಪಿದೆ"],
  cargoTemp: ["Cargo temperature", "ಸರಕು ತಾಪಮಾನ"],
  trip: ["Trip", "ಪ್ರಯಾಣ"],
  simulateBreak: ["Simulate cooling breakdown", "ಶೀತಲೀಕರಣ ವೈಫಲ್ಯ ಅನುಕರಿಸಿ"],
  demoOnly: ["Demo: simulated fault", "ಡೆಮೊ: ಅನುಕರಿತ ದೋಷ"],
  coolingFailed: ["Cooling unit failed!", "ಶೀತಲೀಕರಣ ಘಟಕ ವಿಫಲವಾಗಿದೆ!"],
  checking: ["ZERO ROT is checking your options…", "ZERO ROT ನಿಮ್ಮ ಆಯ್ಕೆಗಳನ್ನು ಪರಿಶೀಲಿಸುತ್ತಿದೆ…"],
  Detect: ["Detect", "ಪತ್ತೆ"], Assess: ["Assess", "ಮೌಲ್ಯಮಾಪನ"], Plan: ["Plan", "ಯೋಜನೆ"], "Check capacity": ["Check capacity", "ಸ್ಥಳ ಪರಿಶೀಲನೆ"], Notify: ["Notify", "ಸೂಚನೆ"],
  recommendChange: ["Recommended: change the route", "ಶಿಫಾರಸು: ಮಾರ್ಗ ಬದಲಿಸಿ"],
  divertTo: ["Go to {m} instead", "ಬದಲಾಗಿ {m} ಗೆ ಹೋಗಿ"],
  ifContinues: ["If it continues", "ಹೀಗೆಯೇ ಮುಂದುವರಿದರೆ"],
  withChange: ["With the new route", "ಹೊಸ ಮಾರ್ಗದಲ್ಲಿ"],
  approve: ["Approve new route", "ಹೊಸ ಮಾರ್ಗ ಅನುಮೋದಿಸಿ"],
  needsYou: ["Nothing changes until you approve.", "ನೀವು ಅನುಮೋದಿಸುವವರೆಗೆ ಏನೂ ಬದಲಾಗುವುದಿಲ್ಲ."],
  youSaved: ["You protected {v}", "ನೀವು {v} ಉಳಿಸಿದ್ದೀರಿ"],
  estimate: ["Estimated by simulation from the same moment, not a measured saving.", "ಅದೇ ಕ್ಷಣದಿಂದ ಅನುಕರಣೆಯ ಅಂದಾಜು, ಅಳೆದ ಉಳಿತಾಯವಲ್ಲ."],
  noBetter: ["No better route found. Keep going.", "ಉತ್ತಮ ಮಾರ್ಗ ಸಿಗಲಿಲ್ಲ. ಮುಂದುವರಿಸಿ."],
  ghostTruck: ["Faded truck = what would have happened", "ಮಸುಕಾದ ಲಾರಿ = ಏನಾಗುತ್ತಿತ್ತು"],
  detailed: ["Detailed mode", "ವಿವರವಾದ ಮೋಡ್"],
  analytics: ["Analytics", "ವಿಶ್ಲೇಷಣೆ"],
  reset: ["Reset demo", "ಡೆಮೊ ಮರುಹೊಂದಿಸಿ"],
  close: ["Close", "ಮುಚ್ಚಿ"],
  backToFarm: ["Back to farm", "ಜಮೀನಿಗೆ ಹಿಂತಿರುಗಿ"],
  choices: ["Your choices", "ನಿಮ್ಮ ಆಯ್ಕೆಗಳು"],
  SELL: ["Sell now", "ಈಗ ಮಾರಿ"], STORE: ["Store", "ಸಂಗ್ರಹಿಸಿ"], SHIP: ["Send to another mandi", "ಬೇರೆ ಮಂಡಿಗೆ ಕಳುಹಿಸಿ"],
  recommended: ["Recommended", "ಶಿಫಾರಸು"],
  lessThan: ["{v} less than recommended. Your choice.", "ಶಿಫಾರಸಿಗಿಂತ {v} ಕಡಿಮೆ. ನಿಮ್ಮ ನಿರ್ಧಾರ."],
  chosenRec: ["Good choice. Saved.", "ಉತ್ತಮ ಆಯ್ಕೆ. ಉಳಿಸಲಾಗಿದೆ."],
  whenSell: ["When should I sell?", "ಯಾವಾಗ ಮಾರಬೇಕು?"],
  normal: ["Normal market", "ಸಾಮಾನ್ಯ ಮಾರುಕಟ್ಟೆ"], price_crash: ["Price crash", "ಬೆಲೆ ಕುಸಿತ"], festival: ["Festival demand", "ಹಬ್ಬದ ಬೇಡಿಕೆ"], heavy_rain: ["Heavy rain", "ಭಾರಿ ಮಳೆ"],
  price: ["Price", "ಬೆಲೆ"], youGetShort: ["You get", "ನಿಮಗೆ ಸಿಗುವುದು"], rent: ["Storage rent", "ಸಂಗ್ರಹ ಬಾಡಿಗೆ"],
  tapPlace: ["Tap the shed, the cold store or the truck to see your produce.", "ನಿಮ್ಮ ಉತ್ಪನ್ನ ನೋಡಲು ಶೆಡ್, ಶೀತಲ ಸಂಗ್ರಹ ಅಥವಾ ಲಾರಿಯನ್ನು ಒತ್ತಿ."],
  loading: ["Loading…", "ಲೋಡ್ ಆಗುತ್ತಿದೆ…"],
  simulated: ["Prices and truck sensors are simulated (demo).", "ಬೆಲೆಗಳು ಮತ್ತು ಲಾರಿ ಸಂವೇದಕಗಳು ಅನುಕರಿತ (ಡೆಮೊ)."],
  confidence: ["Confidence", "ವಿಶ್ವಾಸಾರ್ಹತೆ"],
  HIGH: ["High", "ಹೆಚ್ಚು"], MEDIUM: ["Medium", "ಮಧ್ಯಮ"], LOW: ["Low", "ಕಡಿಮೆ"], INSUFFICIENT: ["Not enough data", "ಸಾಕಷ್ಟು ಮಾಹಿತಿ ಇಲ್ಲ"],
  kg: ["kg", "ಕೆಜಿ"],
  inside: ["Inside", "ಒಳಗೆ"],
  readyToSell: ["Ready to decide", "ನಿರ್ಧಾರಕ್ಕೆ ಸಿದ್ಧ"],
  scenario: ["Demo scenario", "ಡೆಮೊ ಸನ್ನಿವೇಶ"],
  fullAnalysis: ["Full analysis", "ಸಂಪೂರ್ಣ ವಿಶ್ಲೇಷಣೆ"],
  qualityCurve: ["Quality over 14 days (with likely range)", "14 ದಿನಗಳ ಗುಣಮಟ್ಟ (ಸಂಭಾವ್ಯ ವ್ಯಾಪ್ತಿಯೊಂದಿಗೆ)"],
  valueCurve: ["Value over 14 days", "14 ದಿನಗಳ ಮೌಲ್ಯ"],
  whyConfidence: ["Why this confidence", "ಈ ವಿಶ್ವಾಸಾರ್ಹತೆ ಏಕೆ"],
  photoNote: ["Photo shows the freshness stage, not your actual batch.", "ಫೋಟೋ ತಾಜಾತನದ ಹಂತವನ್ನು ತೋರಿಸುತ್ತದೆ, ನಿಮ್ಮ ನಿಜವಾದ ಸರಕನ್ನಲ್ಲ."],
  savedChoice: ["Your choice is saved.", "ನಿಮ್ಮ ಆಯ್ಕೆ ಉಳಿಸಲಾಗಿದೆ."],
  cold_hint: ["Kept at the recommended cold temperature.", "ಶಿಫಾರಸು ಮಾಡಿದ ತಂಪು ತಾಪಮಾನದಲ್ಲಿ ಇಡಲಾಗಿದೆ."],
  dragHint: ["Drag to look around · scroll to zoom", "ಸುತ್ತ ನೋಡಲು ಎಳೆಯಿರಿ · ಜೂಮ್ ಮಾಡಲು ಸ್ಕ್ರೋಲ್ ಮಾಡಿ"],
} as const;

export type Key = keyof typeof D;

const MARKETS: Record<string, string> = {
  m_kolar: "ಕೋಲಾರ ಎಪಿಎಂಸಿ", m_bengaluru: "ಬೆಂಗಳೂರು ಎಪಿಎಂಸಿ", m_mysuru: "ಮೈಸೂರು ಎಪಿಎಂಸಿ", m_tumakuru: "ತುಮಕೂರು ಎಪಿಎಂಸಿ",
  m_chikkaballapur: "ಚಿಕ್ಕಬಳ್ಳಾಪುರ ಎಪಿಎಂಸಿ", m_hubballi: "ಹುಬ್ಬಳ್ಳಿ ಎಪಿಎಂಸಿ", m_davanagere: "ದಾವಣಗೆರೆ ಎಪಿಎಂಸಿ", m_belagavi: "ಬೆಳಗಾವಿ ಎಪಿಎಂಸಿ",
  m_mangaluru: "ಮಂಗಳೂರು ಎಪಿಎಂಸಿ", m_chitradurga: "ಚಿತ್ರದುರ್ಗ ಎಪಿಎಂಸಿ",
  cs_malur: "ಮಾಲೂರು ಶೀತಲ ಸಂಗ್ರಹ", cs_hoskote: "ಹೊಸಕೋಟೆ ಶೀತಲ ಸಂಗ್ರಹ", cs_tumakuru: "ತುಮಕೂರು ಶೀತಲ ಸಂಗ್ರಹ",
  cs_chitradurga: "ಚಿತ್ರದುರ್ಗ ಶೀತಲ ಸಂಗ್ರಹ", cs_davanagere: "ದಾವಣಗೆರೆ ಶೀತಲ ಸಂಗ್ರಹ", cs_hubballi: "ಹುಬ್ಬಳ್ಳಿ ಶೀತಲ ಸಂಗ್ರಹ",
};
const PRODUCE: Record<string, [string, string]> = { tomato: ["Tomatoes", "ಟೊಮೇಟೊ"], mango: ["Mangoes", "ಮಾವು"], banana: ["Bananas", "ಬಾಳೆಹಣ್ಣು"] };

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: (() => { try { return (localStorage.getItem("zr-lang") as Lang) || "en"; } catch { return "en"; } })(),
  setLang: (lang) => { try { localStorage.setItem("zr-lang", lang); } catch { /* ignore */ } set({ lang }); },
}));

export function translate(lang: Lang, key: Key | string, vars: Record<string, string | number> = {}) {
  const entry = (D as any)[key] as readonly [string, string] | undefined;
  let s = entry ? entry[lang === "kn" ? 1 : 0] : String(key);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

export function useT() {
  const lang = useLang((s) => s.lang);
  const t = (key: Key | string, vars?: Record<string, string | number>) => translate(lang, key, vars);
  const market = (id?: string | null, name?: string | null) => (lang === "kn" && id && MARKETS[id] ? MARKETS[id] : (name || id || "").replace(" (demo)", ""));
  const produce = (p: string) => (PRODUCE[p] ? PRODUCE[p][lang === "kn" ? 1 : 0] : p);
  return { t, lang, market, produce };
}
