import { create } from "zustand";
import type { TokenUsageEntry } from "../lib/types";
import { parseSessionUsage } from "../lib/tauri";

interface TokenStore {
  usage: Record<string, TokenUsageEntry[]>;
  loading: boolean;
  loadUsage: (workingDir: string) => Promise<void>;
}

export const useTokenStore = create<TokenStore>((set) => ({
  usage: {},
  loading: false,

  loadUsage: async (workingDir: string) => {
    set({ loading: true });
    try {
      const entries = await parseSessionUsage(workingDir);
      set((s) => ({ usage: { ...s.usage, [workingDir]: entries }, loading: false }));
    } catch {
      set((s) => ({ usage: { ...s.usage, [workingDir]: [] }, loading: false }));
    }
  },
}));
