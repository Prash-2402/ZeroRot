import { create } from "zustand";

export type Place = "yard" | "shed" | "cold" | "truck";

type UI = {
  detailed: boolean;
  focus: Place;
  batchId: string | null;
  futureIdx: number; // index into the selected batch's future trajectory (6-hour steps)
  loadingAt: number | null; // performance.now() when the crate-loading animation started
  decideId: string | null; // batch whose "all choices" sheet is open
  openDecide: (id: string | null) => void;
  setDetailed: (b: boolean) => void;
  setFocus: (p: Place, batchId?: string | null) => void;
  setFuture: (i: number) => void;
  startLoading: () => void;
  endLoading: () => void;
};

export const useUI = create<UI>((set) => ({
  detailed: (() => { try { return localStorage.getItem("zr-detailed") === "1"; } catch { return false; } })(),
  focus: "yard",
  batchId: null,
  futureIdx: 0,
  loadingAt: null,
  decideId: null,
  openDecide: (decideId) => set({ decideId }),
  setDetailed: (detailed) => { try { localStorage.setItem("zr-detailed", detailed ? "1" : "0"); } catch { /* ignore */ } set({ detailed }); },
  setFocus: (focus, batchId = null) => set({ focus, batchId, futureIdx: 0 }),
  setFuture: (futureIdx) => set({ futureIdx }),
  startLoading: () => set({ loadingAt: performance.now() }),
  endLoading: () => set({ loadingAt: null }),
}));
