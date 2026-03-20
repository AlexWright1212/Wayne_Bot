import { create } from 'zustand'
import type { ModelInfo, ProviderModels } from '@/lib/types'

interface ModelState {
  // Catalog data from GET /api/models
  providers: Record<string, ProviderModels>
  setProviders: (providers: Record<string, ProviderModels>) => void

  // User selections
  selectedProvider: string | null
  selectedModelId: string | null
  selectedReasoningLevel: string | null
  setSelectedProvider: (provider: string) => void
  setSelectedModelId: (modelId: string) => void
  setSelectedReasoningLevel: (level: string | null) => void

  // Derived helpers
  getSelectedModel: () => ModelInfo | null
  getAvailableModels: () => ModelInfo[]
  getReasoningLevels: () => string[]
}

export const useModelStore = create<ModelState>((set, get) => ({
  providers: {},
  setProviders: (providers) => {
    set({ providers })
    // Auto-select first available provider + model if nothing selected
    const state = get()
    if (!state.selectedProvider) {
      for (const name of ['openai', 'anthropic', 'openrouter']) {
        const p = providers[name]
        if (p?.available && p.models.length > 0) {
          set({
            selectedProvider: name,
            selectedModelId: p.models[0].id,
            selectedReasoningLevel: p.models[0].reasoning_levels[0] ?? null,
          })
          break
        }
      }
    }
  },

  selectedProvider: null,
  selectedModelId: null,
  selectedReasoningLevel: null,

  setSelectedProvider: (provider) => {
    const p = get().providers[provider]
    if (p && p.models.length > 0) {
      set({
        selectedProvider: provider,
        selectedModelId: p.models[0].id,
        selectedReasoningLevel: p.models[0].reasoning_levels[0] ?? null,
      })
    }
  },
  setSelectedModelId: (modelId) => {
    const provider = get().providers[get().selectedProvider ?? '']
    const model = provider?.models.find((m) => m.id === modelId)
    set({
      selectedModelId: modelId,
      selectedReasoningLevel: model?.reasoning_levels[0] ?? null,
    })
  },
  setSelectedReasoningLevel: (level) => set({ selectedReasoningLevel: level }),

  getSelectedModel: () => {
    const { providers, selectedProvider, selectedModelId } = get()
    if (!selectedProvider || !selectedModelId) return null
    return providers[selectedProvider]?.models.find((m) => m.id === selectedModelId) ?? null
  },
  getAvailableModels: () => {
    const { providers, selectedProvider } = get()
    if (!selectedProvider) return []
    return providers[selectedProvider]?.models ?? []
  },
  getReasoningLevels: () => {
    const model = get().getSelectedModel()
    return model?.reasoning_levels ?? []
  },
}))
