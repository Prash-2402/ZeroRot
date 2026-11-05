import { create } from "zustand";

export type Msg = { id: number; role: "user" | "assistant"; text: string; lang: string; sources?: any[]; ui?: any[]; engine?: string; note?: string | null };
export type Phase = "idle" | "listening" | "thinking" | "speaking";

type MitraState = {
  open: boolean;
  phase: Phase;
  level: number; // 0..1 mouth opening, written every animation frame while speaking
  msgs: Msg[];
  setOpen: (b: boolean) => void;
  setPhase: (p: Phase) => void;
  push: (m: Omit<Msg, "id">) => void;
  clear: () => void;
};

let nid = 1;
export const useMitra = create<MitraState>((set, get) => ({
  open: false,
  phase: "idle",
  level: 0,
  msgs: [],
  setOpen: (open) => set({ open }),
  setPhase: (phase) => set({ phase, ...(phase !== "speaking" ? { level: 0 } : {}) }),
  push: (m) => set({ msgs: [...get().msgs, { ...m, id: nid++ }].slice(-30) }),
  clear: () => set({ msgs: [] }),
}));
