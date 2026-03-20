import { useState, useRef, useCallback, type KeyboardEvent } from 'react'
import { SendIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatStore } from '@/stores/chatStore'
import { useModelStore } from '@/stores/modelStore'

interface MessageInputProps {
  onSend: (content: string, modelId: string, provider: string, reasoningLevel: string | null) => void
}

export function MessageInput({ onSend }: MessageInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const isSending = useChatStore((s) => s.isSending)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const selectedModelId = useModelStore((s) => s.selectedModelId)
  const selectedProvider = useModelStore((s) => s.selectedProvider)
  const selectedReasoningLevel = useModelStore((s) => s.selectedReasoningLevel)

  const canSend = value.trim().length > 0 &&
    !isStreaming &&
    !isSending &&
    !!activeConversationId &&
    !!selectedModelId &&
    !!selectedProvider

  const handleSend = useCallback(() => {
    if (!canSend || !selectedModelId || !selectedProvider) return
    onSend(value.trim(), selectedModelId, selectedProvider, selectedReasoningLevel)
    setValue('')
    textareaRef.current?.focus()
  }, [canSend, value, selectedModelId, selectedProvider, selectedReasoningLevel, onSend])

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border p-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeConversationId ? 'Type a message...' : 'Select or create a conversation'}
          disabled={!activeConversationId || isStreaming || isSending}
          className="min-h-10 max-h-48 resize-none"
          rows={1}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
        >
          <SendIcon />
        </Button>
      </div>
    </div>
  )
}
