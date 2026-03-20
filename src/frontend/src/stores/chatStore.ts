import { create } from 'zustand'
import type { ConversationSummary, Message, ToolTraceStep } from '@/lib/types'

interface ChatState {
  // Conversation list
  conversations: ConversationSummary[]
  setConversations: (conversations: ConversationSummary[]) => void
  updateConversationTitle: (id: string, title: string) => void
  removeConversation: (id: string) => void
  addConversation: (conversation: ConversationSummary) => void

  // Active conversation
  activeConversationId: string | null
  setActiveConversationId: (id: string | null) => void

  // Messages for the active conversation
  messages: Message[]
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void

  // Loading state
  isLoadingMessages: boolean
  setIsLoadingMessages: (loading: boolean) => void

  // Sending state (between user send and first stream_token)
  isSending: boolean
  setIsSending: (sending: boolean) => void

  // Streaming state
  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void
  streamingContent: string
  setStreamingContent: (content: string) => void
  appendStreamingContent: (chunk: string) => void

  // Reasoning state (for inline dropdown)
  streamingReasoning: string
  appendStreamingReasoning: (chunk: string) => void

  // Tool execution state
  activeToolName: string | null
  activeToolArgs: Record<string, unknown> | null
  toolSteps: ToolTraceStep[]
  setToolCallStart: (name: string, args: Record<string, unknown>) => void
  addToolStep: (step: ToolTraceStep) => void
  updateToolStep: (index: number, step: ToolTraceStep) => void

  // Summary state
  isSummarizing: boolean
  setIsSummarizing: (s: boolean) => void
  hasSummaryEvent: boolean
  setHasSummaryEvent: (s: boolean) => void

  // Streaming message metadata (set on stream_done)
  streamingMessageId: string | null
  streamingVisibilityId: string | null
  setStreamingIds: (messageId: string | null, visibilityId: string | null) => void

  // Error
  streamError: string | null
  setStreamError: (error: string | null) => void

  // Reset streaming state after finalization
  resetStreaming: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  setConversations: (conversations) => set({ conversations }),
  updateConversationTitle: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
    })),
  removeConversation: (id) =>
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId:
        state.activeConversationId === id ? null : state.activeConversationId,
      messages: state.activeConversationId === id ? [] : state.messages,
    })),
  addConversation: (conversation) =>
    set((state) => ({
      conversations: [conversation, ...state.conversations],
    })),

  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  isLoadingMessages: false,
  setIsLoadingMessages: (loading) => set({ isLoadingMessages: loading }),

  isSending: false,
  setIsSending: (sending) => set({ isSending: sending }),

  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),
  streamingContent: '',
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({ streamingContent: state.streamingContent + chunk })),

  streamingReasoning: '',
  appendStreamingReasoning: (chunk) =>
    set((state) => ({ streamingReasoning: state.streamingReasoning + chunk })),

  activeToolName: null,
  activeToolArgs: null,
  toolSteps: [],
  setToolCallStart: (name, args) =>
    set({ activeToolName: name, activeToolArgs: args, toolSteps: [] }),
  addToolStep: (step) =>
    set((state) => ({ toolSteps: [...state.toolSteps, step] })),
  updateToolStep: (index, step) =>
    set((state) => ({
      toolSteps: state.toolSteps.map((s, i) => (i === index ? step : s)),
    })),

  isSummarizing: false,
  setIsSummarizing: (s) => set({ isSummarizing: s }),
  hasSummaryEvent: false,
  setHasSummaryEvent: (s) => set({ hasSummaryEvent: s }),

  streamingMessageId: null,
  streamingVisibilityId: null,
  setStreamingIds: (messageId, visibilityId) =>
    set({ streamingMessageId: messageId, streamingVisibilityId: visibilityId }),

  streamError: null,
  setStreamError: (error) => set({ streamError: error }),

  resetStreaming: () =>
    set({
      isSending: false,
      isStreaming: false,
      streamingContent: '',
      streamingReasoning: '',
      streamingMessageId: null,
      streamingVisibilityId: null,
      activeToolName: null,
      activeToolArgs: null,
      toolSteps: [],
      isSummarizing: false,
      hasSummaryEvent: false,
      streamError: null,
    }),
}))
