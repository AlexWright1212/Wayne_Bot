import { create } from "zustand";
import type { ModelCatalog, Provider } from "@/mocks/types";
import { getModels } from "@/lib/api";

const EMPTY_CATALOG: ModelCatalog = { providers: {} as ModelCatalog["providers"] };

interface ModelStore {
  catalog: ModelCatalog;
  isLoadingCatalog: boolean;
  provider: Provider;
  modelId: string;
  reasoningLevel: string;

  /** Replace the catalog (called on real API response). */
  setCatalog: (catalog: ModelCatalog) => void;
  loadCatalog: () => Promise<void>;
  setProvider: (p: Provider) => void;
  setModelId: (id: string) => void;
  setReasoningLevel: (level: string) => void;
}

export const useModelStore = create<ModelStore>((set) => ({
  catalog: EMPTY_CATALOG,
  isLoadingCatalog: false,
  provider: "openai",
  modelId: "",
  reasoningLevel: "",

  setCatalog: (catalog) => set({ catalog }),

  loadCatalog: async () => {
    set({ isLoadingCatalog: true });
    try {
      const catalog = await getModels();
      const firstProvider = Object.keys(catalog.providers)[0] as Provider | undefined;
      const firstModel = firstProvider ? catalog.providers[firstProvider]?.models[0] : undefined;
      set({
        catalog,
        provider: firstProvider ?? "openai",
        modelId: firstModel?.id ?? "",
        reasoningLevel: (firstModel?.reasoning_levels[0] as string) ?? "",
      });
    } finally {
      set({ isLoadingCatalog: false });
    }
  },

  setProvider: (p) =>
    set((state) => {
      const firstModel = state.catalog.providers[p]?.models[0];
      return {
        provider: p,
        modelId: firstModel?.id ?? "",
        reasoningLevel: (firstModel?.reasoning_levels[0] as string) ?? "",
      };
    }),

  setModelId: (id) =>
    set((state) => {
      const models = state.catalog.providers[state.provider]?.models ?? [];
      const m = models.find((m) => m.id === id);
      return {
        modelId: id,
        reasoningLevel: (m?.reasoning_levels[0] as string) ?? "",
      };
    }),

  setReasoningLevel: (level) => set({ reasoningLevel: level }),
}));
