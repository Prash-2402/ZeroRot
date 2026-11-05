import * as THREE from "three";
import { seeded } from "./geo";

const cache = new Map<string, THREE.Texture>();

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, repeat: [number, number] = [1, 1]) {
  if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  cache.set(key, t);
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, colors: string[], n: number, size: [number, number], seed = 1) {
  const r = seeded(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.5;
    const s = size[0] + r() * (size[1] - size[0]);
    g.fillRect(r() * w, r() * h, s, s * (0.6 + r()));
  }
  g.globalAlpha = 1;
}

export const grassTex = () => make("grass", 512, 512, (g, w, h) => {
  g.fillStyle = "#5b7a3a"; g.fillRect(0, 0, w, h);
  noise(g, w, h, ["#4d6c30", "#6b8a45", "#7a9550", "#3f5c27", "#8a9a5a"], 9000, [1, 4], 3);
}, [220, 220]);

export const dirtTex = () => make("dirt", 256, 256, (g, w, h) => {
  g.fillStyle = "#8a7258"; g.fillRect(0, 0, w, h);
  noise(g, w, h, ["#7a6248", "#9a8268", "#6b5540", "#a89070"], 4000, [1, 3], 5);
}, [8, 8]);

export const fieldTex = () => make("field", 256, 256, (g, w, h) => {
  g.fillStyle = "#6e5a3e"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) { g.fillStyle = "#4e7a2c"; g.fillRect(0, y + 4, w, 7); g.fillStyle = "#62903a"; g.fillRect(0, y + 6, w, 2); }
  noise(g, w, h, ["#3f6a22", "#5a3f28"], 1500, [1, 3], 7);
}, [3, 3]);

export const brickTex = () => make("brick", 256, 256, (g, w, h) => {
  g.fillStyle = "#cfc3b0"; g.fillRect(0, 0, w, h);
  const r = seeded(11);
  for (let row = 0; row < 16; row++) {
    for (let col = -1; col < 9; col++) {
      const x = col * 32 + (row % 2 ? 16 : 0), y = row * 16;
      const v = 0.85 + r() * 0.3;
      g.fillStyle = `rgb(${Math.round(156 * v)},${Math.round(76 * v)},${Math.round(52 * v)})`;
      g.fillRect(x + 1, y + 1, 30, 14);
    }
  }
}, [3, 1.5]);

export const roofTex = () => make("roof", 256, 256, (g, w, h) => {
  g.fillStyle = "#8a3b25"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 20) for (let x = 0; x < w; x += 24) {
    const grd = g.createLinearGradient(0, y, 0, y + 20); grd.addColorStop(0, "#a8502f"); grd.addColorStop(1, "#6e2c1a");
    g.fillStyle = grd; g.beginPath(); g.ellipse(x + 12 + (y % 40 ? 12 : 0), y + 10, 12, 10, 0, 0, Math.PI); g.fill();
  }
}, [4, 2]);

export const panelTex = () => make("panel", 256, 256, (g, w, h) => {
  g.fillStyle = "#eef0f2"; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 32) { g.fillStyle = "#d9dde1"; g.fillRect(x, 0, 2, h); g.fillStyle = "#ffffff"; g.fillRect(x + 2, 0, 1, h); }
}, [4, 1]);

export const metalRoofTex = () => make("metalroof", 256, 256, (g, w, h) => {
  for (let x = 0; x < w; x += 16) { const grd = g.createLinearGradient(x, 0, x + 16, 0); grd.addColorStop(0, "#9aa3ab"); grd.addColorStop(0.5, "#c8cfd5"); grd.addColorStop(1, "#8b949c"); g.fillStyle = grd; g.fillRect(x, 0, 16, h); }
}, [6, 1]);

export const concreteTex = () => make("concrete", 256, 256, (g, w, h) => {
  g.fillStyle = "#a9a59d"; g.fillRect(0, 0, w, h);
  noise(g, w, h, ["#9c988f", "#b6b2aa", "#8f8b83"], 3000, [1, 3], 13);
  g.strokeStyle = "#8a867e"; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
}, [6, 6]);

export const asphaltTex = () => make("asphalt", 128, 512, (g, w, h) => {
  g.fillStyle = "#2f3134"; g.fillRect(0, 0, w, h);
  noise(g, w, h, ["#26282b", "#3a3c40", "#44464a"], 2500, [1, 2], 17);
  g.fillStyle = "#e8e2d0"; g.fillRect(4, 0, 3, h); g.fillRect(w - 7, 0, 3, h);
  g.fillStyle = "#F2C230"; for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 2, y, 4, 34);
}, [1, 1]);

export const crateTex = () => make("crate", 128, 128, (g, w, h) => {
  g.fillStyle = "#b08850"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#8a6638"; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 4);
  g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h);
  noise(g, w, h, ["#9a7442", "#c49a60"], 600, [1, 3], 19);
});

export const sackTex = () => make("sack", 128, 128, (g, w, h) => {
  g.fillStyle = "#d8c9a3"; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? "#cbbb93" : "#e2d5b3"; g.fillRect(0, y, w, 2); }
});

export const softDotTex = () => make("softdot", 64, 64, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.4, "rgba(255,255,255,0.6)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

export const beltTex = () => make("belt", 256, 32, (g, w, h) => {
  g.fillStyle = "#1c1e22"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#33363c"; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 5, h);
}, [10, 1]);
