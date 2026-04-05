import { create } from "zustand";
import type { ModelCatalog, Provider } from "@/mocks/types";
import { MOCK_MODEL_CATALOG } from "@/mocks/data";

interface ModelStore {
  catalog: ModelCatalog;
  provider: Provider;
  modelId: string;
  reasoningLevel: string;

  /** Replace the catalog (called on real API response). */
  setCatalog: (catalog: ModelCatalog) => void;
  setProvider: (p: Provider) => void;
  setModelId: (id: string) => void;
  setReasoningLevel: (level: string) => void;
}

const _defaultProvider: Provider = "openai";
const _defaultModel = MOCK_MODEL_CATALOG.providers.openai.models[0];
const _defaultReasoning = (_defaultModel.reasoning_levels[0] as string) ?? "";

export const useModelStore = create<ModelStore>((set) => ({
  catalog: MOCK_MODEL_CATALOG,
  provider: _defaultProvider,
  modelId: _defaultModel.id,
  reasoningLevel: _defaultReasoning,

  setCatalog: (catalog) => set({ catalog }),

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
