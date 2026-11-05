import { motion } from "framer-motion";

/** Produce illustration whose colour, sheen and spotting are driven only by the predicted quality value. */
export function ProduceVisual({ produce, quality, size = 160 }: { produce: string; quality: number; size?: number }) {
  const q = Math.max(0, Math.min(100, quality));
  const decay = (100 - q) / 100; // 0 fresh -> 1 rotten
  const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const rgb = (c: number[]) => `rgb(${c.join(",")})`;
  const palette: Record<string, { fresh: number[]; old: number[]; leaf: string }> = {
    tomato: { fresh: [214, 52, 42], old: [120, 62, 40], leaf: "#3E8E5A" },
    mango: { fresh: [240, 170, 40], old: [140, 98, 40], leaf: "#3E8E5A" },
    banana: { fresh: [246, 214, 74], old: [118, 92, 40], leaf: "#6F8A6E" },
  };
  const p = palette[produce] || palette.tomato;
  const body = rgb(mix(p.fresh, p.old, Math.pow(decay, 1.3)));
  const spots = Math.round(Math.max(0, (70 - q) / 6));
  const spotPos = [[38, 48], [62, 40], [54, 64], [30, 66], [70, 60], [46, 34], [66, 74], [40, 76], [24, 52], [76, 48], [52, 50]];
  const wrinkle = Math.max(0, (60 - q) / 60);
  return (
    <motion.svg viewBox="0 0 100 100" width={size} height={size} initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} aria-label={`${produce} at quality ${q.toFixed(0)}`}>
      <defs>
        <radialGradient id={`g-${produce}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#fff" stopOpacity={0.55 * (1 - decay)} />
          <stop offset="45%" stopColor={body} />
          <stop offset="100%" stopColor={rgb(mix(p.old, [40, 30, 20], 0.4))} />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="92" rx="30" ry="4" fill="#1F4D3A" opacity="0.08" />
      {produce === "banana" ? (
        <g transform={`rotate(-18 50 50) scale(1 ${1 - wrinkle * 0.06})`}>
          <path d="M18 60 Q50 92 84 46 Q86 40 80 42 Q52 74 22 52 Q16 52 18 60 Z" fill={`url(#g-${produce})`} stroke={rgb(mix(p.old, [60, 40, 20], 0.5))} strokeWidth="1" />
          <path d="M80 42 l6 -6 l2 3 z" fill="#5A4A2A" />
          {spotPos.slice(0, spots).map(([x, y], i) => <circle key={i} cx={x * 0.8 + 12} cy={y * 0.5 + 30} r={1.4 + (i % 3) * 0.6} fill="#3A2A18" opacity={0.75} />)}
        </g>
      ) : (
        <g>
          <motion.ellipse cx="50" cy="56" rx={produce === "mango" ? 30 : 34} ry={produce === "mango" ? 36 : 31 - wrinkle * 2} fill={`url(#g-${produce})`}
            animate={{ rx: produce === "mango" ? 30 - wrinkle * 2 : 34 - wrinkle * 2 }} transition={{ duration: 0.4 }} />
          <path d="M50 26 C44 18 36 20 34 22 C40 24 44 28 50 30 Z" fill={p.leaf} opacity={1 - decay * 0.5} />
          <path d="M50 26 C56 18 64 20 66 22 C60 24 56 28 50 30 Z" fill={p.leaf} opacity={1 - decay * 0.5} />
          <rect x="48.5" y="20" width="3" height="9" rx="1.5" fill="#4A6A3A" />
          {spotPos.slice(0, spots).map(([x, y], i) => (
            <ellipse key={i} cx={x} cy={y} rx={1.6 + (i % 3) * 0.9} ry={1.3 + (i % 2) * 0.8} fill="#3A2416" opacity={0.55 + 0.4 * decay} />
          ))}
        </g>
      )}
    </motion.svg>
  );
}
