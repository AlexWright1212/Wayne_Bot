import { create } from "zustand";
import type { Conversation, Message } from "@/mocks/types";
import { getConversations } from "@/lib/api";

interface ConversationStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  messagesByConvId: Record<string, Message[]>;
  isLoadingConversations: boolean;

  // Visibility pane state
  visibilityOpen: boolean;
  selectedVisibilityMessageId: string | null;

  setActiveConversation: (id: string | null) => void;
  loadConversations: () => Promise<void>;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  newChat: () => void;
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

  visibilityOpen: false,
  selectedVisibilityMessageId: null,

  setActiveConversation: (id) => set({ activeConversationId: id }),

  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const conversations = await getConversations();
      set({
        conversations,
        activeConversationId: conversations[0]?.id ?? null,
        isLoadingConversations: false,
      });
    } catch {
      set({ isLoadingConversations: false });
    }
  },

  renameConversation: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title: title.trim() || c.title } : c
      ),
    })),

  deleteConversation: (id) =>
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id);
      const activeId =
        state.activeConversationId === id
          ? (remaining[0]?.id ?? null)
          : state.activeConversationId;
      return { conversations: remaining, activeConversationId: activeId };
    }),

  newChat: () => {
    const newId = crypto.randomUUID();
    const newConv: Conversation = {
      id: newId,
      title: null,
      last_model_id: null,
      last_provider: null,
      updated_at: new Date().toISOString(),
    };
    set((state) => ({
      conversations: [newConv, ...state.conversations],
      activeConversationId: newId,
      messagesByConvId: { ...state.messagesByConvId, [newId]: [] },
    }));
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
