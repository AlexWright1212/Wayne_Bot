import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { EllipsisIcon, PencilIcon, TrashIcon } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useChatStore } from '@/stores/chatStore'
import { getConversation, updateConversation, deleteConversation } from '@/lib/api'
import { timeAgo, cn } from '@/lib/utils'
import { DeleteDialog } from './DeleteDialog'
import type { ConversationSummary } from '@/lib/types'

interface ConversationItemProps {
  conversation: ConversationSummary
}

export function ConversationItem({ conversation }: ConversationItemProps) {
  const activeId = useChatStore((s) => s.activeConversationId)
  const setActiveId = useChatStore((s) => s.setActiveConversationId)
  const setMessages = useChatStore((s) => s.setMessages)
  const setIsLoadingMessages = useChatStore((s) => s.setIsLoadingMessages)
  const updateTitle = useChatStore((s) => s.updateConversationTitle)
  const removeConversation = useChatStore((s) => s.removeConversation)

  const isActive = activeId === conversation.id
  const displayTitle = conversation.title || 'New Chat'

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  // Delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)

  useEffect(() => {
    if (isRenaming) {
      renameRef.current?.focus()
      renameRef.current?.select()
    }
  }, [isRenaming])

  async function handleSelect() {
    if (isActive || isRenaming) return
    setActiveId(conversation.id)
    setIsLoadingMessages(true)
    try {
      const detail = await getConversation(conversation.id)
      setMessages(detail.messages)
    } catch {
      setMessages([])
    } finally {
      setIsLoadingMessages(false)
    }
  }

  function startRename() {
    setRenameValue(conversation.title || '')
    setIsRenaming(true)
  }

  async function commitRename() {
    setIsRenaming(false)
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === conversation.title) return
    updateTitle(conversation.id, trimmed)
    try {
      await updateConversation(conversation.id, trimmed)
    } catch {
      updateTitle(conversation.id, conversation.title || '')
    }
  }

  function cancelRename() {
    setIsRenaming(false)
  }

  function handleRenameKey(e: KeyboardEvent) {
    if (e.key === 'Enter') commitRename()
    if (e.key === 'Escape') cancelRename()
  }

  async function handleDelete() {
    setDeleteOpen(false)
    removeConversation(conversation.id)
    try {
      await deleteConversation(conversation.id)
    } catch {
      // Conversation already removed from UI
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            onClick={handleSelect}
            className={cn(
              'group flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer transition-colors',
              isActive
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            )}
          >
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <Input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleRenameKey}
                  className="h-6 text-sm"
                />
              ) : (
                <>
                  <div className="truncate">{displayTitle}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-xs text-muted-foreground opacity-60">
                      {timeAgo(conversation.updated_at)}
                    </span>
                    {conversation.last_model_id && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">
                        {conversation.last_model_id}
                      </Badge>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Three-dots menu (visible on hover) */}
            {!isRenaming && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Conversation options"
                      onClick={(e) => e.stopPropagation()}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" sideOffset={4}>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={startRename}>
                      <PencilIcon data-icon="inline-start" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                      <TrashIcon data-icon="inline-start" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuGroup>
            <ContextMenuItem onSelect={startRename}>
              <PencilIcon data-icon="inline-start" />
              Rename
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <TrashIcon data-icon="inline-start" />
              Delete
            </ContextMenuItem>
          </ContextMenuGroup>
        </ContextMenuContent>
      </ContextMenu>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title={displayTitle}
      />
    </>
  )
}
