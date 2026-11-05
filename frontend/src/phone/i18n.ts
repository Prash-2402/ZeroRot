import { create } from "zustand";

const read = () => { try { return (localStorage.getItem("zr-lang") as "en" | "kn") || "en"; } catch { return "en"; } };
export const useLang = create<{ lang: "en" | "kn"; set: (l: "en" | "kn") => void }>((set) => ({
  lang: read(),
  set: (lang) => { try { localStorage.setItem("zr-lang", lang); } catch { /* ignore */ } set({ lang }); },
}));

const KN: Record<string, string> = {
  "New entry": "ಹೊಸ ನಮೂದು", Godown: "ಗೋದಾಮು", Predict: "ಮುನ್ಸೂಚನೆ", "Scan & bag": "ಸ್ಕ್ಯಾನ್ & ಚೀಲ", "Scan & sort": "ಸ್ಕ್ಯಾನ್ & ವಿಂಗಡಣೆ", "Start scanning": "ಸ್ಕ್ಯಾನ್ ಪ್ರಾರಂಭಿಸಿ", Boxes: "ಪೆಟ್ಟಿಗೆಗಳು", Track: "ಟ್ರ್ಯಾಕ್", Help: "ಸಹಾಯ",
  Crop: "ಬೆಳೆ", Quantity: "ಪ್ರಮಾಣ", Location: "ಸ್ಥಳ", "Use my location": "ನನ್ನ ಸ್ಥಳ ಬಳಸಿ", "Search place": "ಸ್ಥಳ ಹುಡುಕಿ",
  "Harvest condition": "ಕೊಯ್ಲಿನ ಸ್ಥಿತಿ", Excellent: "ಅತ್ಯುತ್ತಮ", Good: "ಉತ್ತಮ", Fair: "ಸಾಧಾರಣ", Maturity: "ಪಕ್ವತೆ",
  "Mature green": "ಹಸಿರು ಪಕ್ವ", Turning: "ಬಣ್ಣ ಬದಲು", Ripe: "ಹಣ್ಣಾದ", "Choose godown": "ಗೋದಾಮು ಆಯ್ಕೆ ಮಾಡಿ",
  Traditional: "ಸಾಂಪ್ರದಾಯಿಕ", Advanced: "ಆಧುನಿಕ", "Send to godown": "ಗೋದಾಮಿಗೆ ಕಳುಹಿಸಿ",
  Temperature: "ತಾಪಮಾನ", Humidity: "ಆರ್ದ್ರತೆ", Quality: "ಗುಣಮಟ್ಟ", "Shelf life": "ಬಾಳಿಕೆ", Outside: "ಹೊರಗೆ", Inside: "ಒಳಗೆ",
  Door: "ಬಾಗಿಲು", Vents: "ಗಾಳಿ ಕಿಂಡಿ", Cooling: "ತಂಪಾಗಿಸುವಿಕೆ", Open: "ತೆರೆದಿದೆ", Closed: "ಮುಚ್ಚಿದೆ", On: "ಚಾಲನೆ", Off: "ನಿಲ್ಲಿಸಿದೆ",
  Loading: "ಲೋಡ್ ಆಗುತ್ತಿದೆ", Stored: "ಸಂಗ್ರಹಿಸಲಾಗಿದೆ", Alerts: "ಎಚ್ಚರಿಕೆಗಳು", Suggestions: "ಸಲಹೆಗಳು",
  "Mandi rates": "ಮಂಡಿ ದರ", Spoilage: "ಹಾಳಾಗುವಿಕೆ", Decision: "ನಿರ್ಧಾರ", "Sell now": "ಈಗ ಮಾರಿ", "Store and sell later": "ಸಂಗ್ರಹಿಸಿ ನಂತರ ಮಾರಿ",
  Sell: "ಮಾರಾಟ", Destination: "ಗಮ್ಯಸ್ಥಾನ", Dispatch: "ಕಳುಹಿಸಿ", "Scan produce": "ಉತ್ಪನ್ನ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ", Bags: "ಚೀಲಗಳು",
  Rejected: "ತಿರಸ್ಕೃತ", Delivered: "ತಲುಪಿಸಲಾಗಿದೆ", "In transit": "ಸಾಗಣೆಯಲ್ಲಿ", Arrived: "ತಲುಪಿದೆ", Checkpoints: "ತಪಾಸಣಾ ಸ್ಥಳಗಳು",
  "Ask anything": "ಏನಾದರೂ ಕೇಳಿ", Send: "ಕಳುಹಿಸಿ", "No lot yet": "ಇನ್ನೂ ಯಾವುದೇ ಲಾಟ್ ಇಲ್ಲ", Enter: "ನಮೂದಿಸಿ",
  "days left": "ದಿನಗಳು ಉಳಿದಿವೆ", "Price you were quoted (₹/kg)": "ನಿಮಗೆ ಹೇಳಿದ ದರ (₹/ಕೆಜಿ)", "Get decision": "ನಿರ್ಧಾರ ಪಡೆಯಿರಿ",
  "Enter PIN": "ಪಿನ್ ನಮೂದಿಸಿ", "Plan to sell within": "ಇಷ್ಟು ದಿನಗಳೊಳಗೆ ಮಾರಾಟ", Connect: "ಸಂಪರ್ಕಿಸಿ", "Live on laptop": "ಲ್ಯಾಪ್‌ಟಾಪ್‌ನಲ್ಲಿ ನೇರ", Stage: "ಹಂತ",
};

export function useT() {
  const lang = useLang((s) => s.lang);
  return (s: string) => (lang === "kn" ? KN[s] || s : s);
}
