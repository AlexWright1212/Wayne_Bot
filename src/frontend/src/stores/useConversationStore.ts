import { create } from "zustand";
import type { Conversation, Message } from "@/mocks/types";
import {
  getConversations,
  createConversation,
  updateConversation,
  deleteConversation as apiDeleteConversation,
  getConversation,
} from "@/lib/api";

interface ConversationStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  messagesByConvId: Record<string, Message[]>;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;

  // Visibility pane state
  visibilityOpen: boolean;
  selectedVisibilityMessageId: string | null;

  setActiveConversation: (id: string | null) => Promise<void>;
  loadConversations: () => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  newChat: () => Promise<void>;
  /** Mock-only: add a user message and transition away from empty state. */
  addUserMessage: (convId: string, content: string) => void;
  openVisibility: (messageId: string) => void;
  closeVisibility: () => void;
  toggleVisibility: () => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messagesByConvId: {},
  isLoadingConversations: false,
  isLoadingMessages: false,

  visibilityOpen: false,
  selectedVisibilityMessageId: null,

  setActiveConversation: async (id) => {
    set({ activeConversationId: id });
    if (!id) return;
    // Skip fetch if already cached
    if (get().messagesByConvId[id]) return;
    set({ isLoadingMessages: true });
    try {
      const detail = await getConversation(id);
      set((state) => ({
        messagesByConvId: { ...state.messagesByConvId, [id]: detail.messages },
        isLoadingMessages: false,
      }));
    } catch (err) {
      console.error("setActiveConversation fetch failed", err);
      set({ isLoadingMessages: false });
    }
  },

  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const conversations = await getConversations();
      const firstId = conversations[0]?.id ?? null;
      set({
        conversations,
        activeConversationId: firstId,
        isLoadingConversations: false,
      });
      // Eagerly load messages for the first conversation
      if (firstId) {
        get().setActiveConversation(firstId);
      }
    } catch {
      set({ isLoadingConversations: false });
    }
  },

  renameConversation: async (id, title) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Optimistic update
    const prev = get().conversations;
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title: trimmed } : c
      ),
    }));
    try {
      await updateConversation(id, trimmed);
    } catch (err) {
      console.error("renameConversation failed", err);
      set({ conversations: prev });
    }
  },

  deleteConversation: async (id) => {
    // Optimistic update
    const prev = get();
    const remaining = prev.conversations.filter((c) => c.id !== id);
    const activeId =
      prev.activeConversationId === id
        ? (remaining[0]?.id ?? null)
        : prev.activeConversationId;
    set({ conversations: remaining, activeConversationId: activeId });
    try {
      await apiDeleteConversation(id);
    } catch (err) {
      console.error("deleteConversation failed", err);
      set({ conversations: prev.conversations, activeConversationId: prev.activeConversationId });
    }
  },

  newChat: async () => {
    try {
      const conv = await createConversation();
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: conv.id,
        messagesByConvId: { ...state.messagesByConvId, [conv.id]: [] },
      }));
    } catch (err) {
      console.error("newChat failed", err);
    }
  },

  openVisibility: (messageId) =>
    set({ visibilityOpen: true, selectedVisibilityMessageId: messageId }),
  closeVisibility: () => set({ visibilityOpen: false }),
  toggleVisibility: () => set((s) => ({ visibilityOpen: !s.visibilityOpen })),

  addUserMessage: (convId, content) => {
    const existing = get().messagesByConvId[convId] ?? [];
    const newMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      model_id: null,
      provider: null,
      reasoning_level: null,
      tool_call_id: null,
      tool_name: null,
      tool_arguments: null,
      tool_result_call_id: null,
      tool_result_name: null,
      sequence: existing.length + 1,
      created_at: new Date().toISOString(),
    };
    set((state) => ({
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: [...existing, newMsg],
      },
    }));
  },
}));
