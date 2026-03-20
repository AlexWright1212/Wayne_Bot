import { useEffect } from 'react'
import { PanelLeftIcon, PlusIcon } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useChatStore } from '@/stores/chatStore'
import { listConversations, createConversation } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ConversationItem } from './ConversationItem'

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const conversations = useChatStore((s) => s.conversations)
  const setConversations = useChatStore((s) => s.setConversations)
  const addConversation = useChatStore((s) => s.addConversation)
  const setActiveId = useChatStore((s) => s.setActiveConversationId)
  const setMessages = useChatStore((s) => s.setMessages)

  useEffect(() => {
    listConversations()
      .then(setConversations)
      .catch(() => {})
  }, [setConversations])

  async function handleNewChat() {
    try {
      const conv = await createConversation()
      addConversation({
        id: conv.id,
        title: conv.title,
        last_model_id: conv.last_model_id,
        last_provider: conv.last_provider,
        updated_at: conv.updated_at,
      })
      setActiveId(conv.id)
      setMessages([])
    } catch {
      // TODO: error toast
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col border-r border-border bg-muted/50 transition-all duration-200',
        collapsed ? 'w-0 overflow-hidden' : 'w-[260px] min-w-[260px]'
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3">
        <Button
          variant="secondary"
          size="sm"
          className="flex-1 justify-start"
          onClick={handleNewChat}
        >
          <PlusIcon data-icon="inline-start" />
          New Chat
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="Collapse sidebar"
        >
          <PanelLeftIcon />
        </Button>
      </div>

      <Separator />

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {conversations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center mt-8">
              No conversations yet
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {conversations.map((conv) => (
                <ConversationItem key={conv.id} conversation={conv} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

export function SidebarToggle({ collapsed, onToggle }: SidebarProps) {
  if (!collapsed) return null
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onToggle}
      className="fixed top-3 left-3 z-50"
      aria-label="Open sidebar"
    >
      <PanelLeftIcon />
    </Button>
  )
}
