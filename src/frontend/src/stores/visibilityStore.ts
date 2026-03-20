import { create } from 'zustand'
import type { VisibilityRecord, TokenCounts } from '@/lib/types'

interface VisibilityState {
  // Pane open/close
  isPaneOpen: boolean
  setIsPaneOpen: (open: boolean) => void
  togglePane: () => void

  // Which message is being inspected
  activeMessageId: string | null
  setActiveMessageId: (id: string | null) => void

  // Which section to auto-expand (set by inline clickable shortcuts)
  focusedSection: string | null
  setFocusedSection: (section: string | null) => void

  // Cached visibility records (keyed by message ID)
  records: Record<string, VisibilityRecord>
  setRecord: (messageId: string, record: VisibilityRecord) => void

  // Latest token counts for the active conversation
  tokenCounts: TokenCounts | null
  setTokenCounts: (counts: TokenCounts | null) => void

  // Open the visibility panel to a specific message + section
  inspectMessage: (messageId: string, focusSection?: string) => void
}

export const useVisibilityStore = create<VisibilityState>((set) => ({
  isPaneOpen: false,
  setIsPaneOpen: (open) => set({ isPaneOpen: open }),
  togglePane: () => set((state) => ({ isPaneOpen: !state.isPaneOpen })),

  activeMessageId: null,
  setActiveMessageId: (id) => set({ activeMessageId: id }),

  focusedSection: null,
  setFocusedSection: (section) => set({ focusedSection: section }),

  records: {},
  setRecord: (messageId, record) =>
    set((state) => ({
      records: { ...state.records, [messageId]: record },
    })),

  tokenCounts: null,
  setTokenCounts: (counts) => set({ tokenCounts: counts }),

  inspectMessage: (messageId, focusSection) =>
    set({
      isPaneOpen: true,
      activeMessageId: messageId,
      focusedSection: focusSection ?? null,
    }),
}))
