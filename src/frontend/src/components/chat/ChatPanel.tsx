import { useRef, useEffect, useCallback } from 'react'
import { LoaderIcon, WifiOffIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chatStore'
import { useVisibilityStore } from '@/stores/visibilityStore'
import { useModelStore } from '@/stores/modelStore'
import { useWebSocket } from '@/hooks/useWebSocket'
import { getTokenCounts, getVisibility } from '@/lib/api'
import { TopBar } from './TopBar'
import { MessageInput } from './MessageInput'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import type { WSServerEvent, Message } from '@/lib/types'

export function ChatPanel() {
  const activeId = useChatStore((s) => s.activeConversationId)
  const messages = useChatStore((s) => s.messages)
  const isLoading = useChatStore((s) => s.isLoadingMessages)
  const isSending = useChatStore((s) => s.isSending)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingReasoning = useChatStore((s) => s.streamingReasoning)
  const activeToolName = useChatStore((s) => s.activeToolName)
  const toolSteps = useChatStore((s) => s.toolSteps)
  const isSummarizing = useChatStore((s) => s.isSummarizing)
  const hasSummaryEvent = useChatStore((s) => s.hasSummaryEvent)
  const streamError = useChatStore((s) => s.streamError)

  const setIsSending = useChatStore((s) => s.setIsSending)
  const setIsStreaming = useChatStore((s) => s.setIsStreaming)
  const appendStreamingContent = useChatStore((s) => s.appendStreamingContent)
  const appendStreamingReasoning = useChatStore((s) => s.appendStreamingReasoning)
  const setToolCallStart = useChatStore((s) => s.setToolCallStart)
  const addToolStep = useChatStore((s) => s.addToolStep)
  const updateToolStep = useChatStore((s) => s.updateToolStep)
  const setIsSummarizing = useChatStore((s) => s.setIsSummarizing)
  const setHasSummaryEvent = useChatStore((s) => s.setHasSummaryEvent)
  const setStreamingIds = useChatStore((s) => s.setStreamingIds)
  const setStreamError = useChatStore((s) => s.setStreamError)
  const addMessage = useChatStore((s) => s.addMessage)
  const resetStreaming = useChatStore((s) => s.resetStreaming)
  const updateConversationTitle = useChatStore((s) => s.updateConversationTitle)

  const setTokenCounts = useVisibilityStore((s) => s.setTokenCounts)
  const setVisibilityRecord = useVisibilityStore((s) => s.setRecord)

  const selectedModelId = useModelStore((s) => s.selectedModelId)
  const selectedProvider = useModelStore((s) => s.selectedProvider)
  const selectedReasoningLevel = useModelStore((s) => s.selectedReasoningLevel)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUp = useRef(false)

  // Auto-scroll logic
  function scrollToBottom() {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent])

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    userScrolledUp.current = !atBottom
  }

  // WebSocket event handler
  const handleWSEvent = useCallback(
    (event: WSServerEvent) => {
      switch (event.type) {
        case 'stream_token':
          if (isSending) setIsSending(false)
          if (!isStreaming) setIsStreaming(true)
          appendStreamingContent(event.content)
          break

        case 'stream_reasoning':
          if (isSending) setIsSending(false)
          appendStreamingReasoning(event.content)
          break

        case 'tool_call_start':
          if (isSending) setIsSending(false)
          setToolCallStart(event.tool_name, event.arguments)
          break

        case 'tool_step':
          if (event.status === 'running') {
            addToolStep({
              name: event.step_name,
              status: 'running',
              data: event.data,
              duration_ms: 0,
            })
          } else {
            // Update the existing running step
            const steps = useChatStore.getState().toolSteps
            const idx = steps.findIndex(
              (s) => s.name === event.step_name && s.status === 'running'
            )
            if (idx >= 0) {
              updateToolStep(idx, {
                name: event.step_name,
                status: event.status,
                data: event.data,
                duration_ms: event.duration_ms,
              })
            } else {
              addToolStep({
                name: event.step_name,
                status: event.status,
                data: event.data,
                duration_ms: event.duration_ms,
              })
            }
          }
          break

        case 'summary_started':
          if (isSending) setIsSending(false)
          setIsSummarizing(true)
          break

        case 'summary_complete':
          setIsSummarizing(false)
          setHasSummaryEvent(true)
          break

        case 'title_updated':
          updateConversationTitle(event.conversation_id, event.title)
          break

        case 'stream_done': {
          setStreamingIds(event.message_id, event.visibility_id)

          // Finalize: add the streamed content as a proper message
          const state = useChatStore.getState()
          const finalMessage: Message = {
            id: event.message_id,
            role: 'assistant',
            content: state.streamingContent,
            model_id: selectedModelId,
            provider: selectedProvider,
            reasoning_level: selectedReasoningLevel,
            tool_call_id: null,
            tool_name: state.activeToolName,
            tool_arguments: state.activeToolArgs,
            tool_result_call_id: null,
            tool_result_name: null,
            sequence: state.messages.length,
            created_at: new Date().toISOString(),
          }
          addMessage(finalMessage)
          resetStreaming()
          userScrolledUp.current = false

          // Fetch token counts
          if (activeId) {
            getTokenCounts(activeId)
              .then(setTokenCounts)
              .catch(() => {})

            // Delayed re-fetch for background-computed counts
            setTimeout(() => {
              getTokenCounts(activeId)
                .then(setTokenCounts)
                .catch(() => {})
            }, 2000)
          }

          // Fetch visibility record
          if (event.visibility_id) {
            getVisibility(event.message_id)
              .then((vis) => setVisibilityRecord(event.message_id, vis))
              .catch(() => {})
          }
          break
        }

        case 'error':
          setStreamError(event.message)
          setIsSending(false)
          setIsStreaming(false)
          break
      }
    },
    [
      activeId, isSending, isStreaming, selectedModelId, selectedProvider, selectedReasoningLevel,
      setIsSending, setIsStreaming, appendStreamingContent, appendStreamingReasoning,
      setToolCallStart, addToolStep, updateToolStep, setIsSummarizing, setHasSummaryEvent,
      updateConversationTitle, setStreamingIds, addMessage, resetStreaming,
      setTokenCounts, setVisibilityRecord, setStreamError,
    ]
  )

  const { send, connectionStatus, reconnect } = useWebSocket({ conversationId: activeId, onEvent: handleWSEvent })

  function handleSend(content: string, modelId: string, provider: string, reasoningLevel: string | null) {
    // Add user message to list immediately
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      model_id: null,
      provider: null,
      reasoning_level: null,
      tool_call_id: null,
      tool_name: null,
      tool_arguments: null,
      tool_result_call_id: null,
      tool_result_name: null,
      sequence: messages.length,
      created_at: new Date().toISOString(),
    }
    addMessage(userMsg)
    setIsSending(true)
    setStreamError(null)
    userScrolledUp.current = false

    send({
      type: 'send_message',
      content,
      model_id: modelId,
      provider,
      reasoning_level: reasoningLevel,
    })
  }

  // Filter to only user-visible messages
  const visibleMessages = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  )

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <TopBar />

      {/* Connection status bar */}
      {connectionStatus === 'reconnecting' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive">
          <LoaderIcon className="size-3.5 animate-spin" />
          <span>Connection lost — reconnecting...</span>
        </div>
      )}
      {connectionStatus === 'disconnected' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive">
          <WifiOffIcon className="size-3.5" />
          <span>Connection lost</span>
          <Button variant="outline" size="sm" className="ml-2 h-6 text-xs" onClick={reconnect}>
            Reconnect
          </Button>
        </div>
      )}

      {/* Message area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6"
        onScroll={handleScroll}
      >
        <div className="max-w-3xl mx-auto">
          {isLoading ? (
            <div className="flex items-center justify-center mt-32">
              <LoaderIcon className="size-6 text-muted-foreground animate-spin" />
            </div>
          ) : !activeId ? (
            <div className="flex flex-col items-center justify-center mt-32 gap-2">
              <h1 className="text-2xl font-medium text-foreground">Wayne</h1>
              <p className="text-sm text-muted-foreground">
                Select or create a conversation to start chatting
              </p>
            </div>
          ) : visibleMessages.length === 0 && !isStreaming && !isSending ? (
            <div className="flex flex-col items-center justify-center mt-32 gap-2">
              <h1 className="text-2xl font-medium text-foreground">Wayne</h1>
              <p className="text-sm text-muted-foreground">
                Send a message to start the conversation
              </p>
            </div>
          ) : (
            <>
              {visibleMessages.map((msg) => (
                msg.role === 'user' ? (
                  <UserMessage key={msg.id} message={msg} />
                ) : (
                  <AssistantMessage key={msg.id} message={msg} />
                )
              ))}

              {/* Currently streaming assistant message */}
              {(isStreaming || isSending || isSummarizing) && (
                <>
                  {isSummarizing && (
                    <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                      <LoaderIcon className="size-3.5 animate-spin" />
                      <span>Compressing conversation history...</span>
                    </div>
                  )}

                  {isSending && !isStreaming && !isSummarizing && (
                    <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                      <LoaderIcon className="size-3.5 animate-spin" />
                      <span>Sending...</span>
                    </div>
                  )}

                  {(streamingContent || streamingReasoning || activeToolName) && (
                    <AssistantMessage
                      message={{
                        id: 'streaming',
                        role: 'assistant',
                        content: streamingContent || null,
                        model_id: selectedModelId,
                        provider: selectedProvider,
                        reasoning_level: selectedReasoningLevel,
                        tool_call_id: null,
                        tool_name: activeToolName,
                        tool_arguments: null,
                        tool_result_call_id: null,
                        tool_result_name: null,
                        sequence: -1,
                        created_at: new Date().toISOString(),
                      }}
                      reasoning={streamingReasoning || null}
                      toolName={activeToolName}
                      toolSteps={toolSteps}
                      hasSummary={hasSummaryEvent}
                      isStreaming
                    />
                  )}
                </>
              )}

              {/* Error display */}
              {streamError && (
                <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-4">
                  {streamError}
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <MessageInput onSend={handleSend} />
    </div>
  )
}
