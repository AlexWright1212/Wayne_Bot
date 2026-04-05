import { create } from "zustand";
import type { Conversation, Message } from "@/mocks/types";
import {
  MOCK_CONVERSATIONS,
  MOCK_ACTIVE_CONVERSATION_ID,
  MOCK_MESSAGES_BY_CONV,
} from "@/mocks/data";

interface ConversationStore {
  conversations: Conversation[];
  activeConversationId: string | null;
  messagesByConvId: Record<string, Message[]>;

  setActiveConversation: (id: string | null) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  newChat: () => void;
  /** Mock-only: add a user message and transition away from empty state. */
  addUserMessage: (convId: string, content: string) => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: MOCK_CONVERSATIONS,
  activeConversationId: MOCK_ACTIVE_CONVERSATION_ID,
  messagesByConvId: MOCK_MESSAGES_BY_CONV,

  setActiveConversation: (id) => set({ activeConversationId: id }),

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
