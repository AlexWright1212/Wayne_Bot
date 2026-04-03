import { useState, useRef, useEffect } from "react"
import { PlusIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MOCK_CONVERSATIONS, MOCK_ACTIVE_CONVERSATION_ID } from "@/mocks/data"
import type { Conversation } from "@/mocks/types"

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OAI",
  anthropic: "ANT",
  openrouter: "OR",
}

export function AppSidebar() {
  const [activeId, setActiveId] = useState(MOCK_ACTIVE_CONVERSATION_ID)
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renamingId])

  function startRename(conv: Conversation) {
    setRenameValue(conv.title ?? "")
    setRenamingId(conv.id)
  }

  function commitRename() {
    if (!renamingId) return
    setConversations((prev) =>
      prev.map((c) =>
        c.id === renamingId
          ? { ...c, title: renameValue.trim() || c.title }
          : c
      )
    )
    setRenamingId(null)
  }

  function cancelRename() {
    setRenamingId(null)
  }

  function confirmDelete() {
    if (!deleteTarget) return
    setConversations((prev) => prev.filter((c) => c.id !== deleteTarget.id))
    if (activeId === deleteTarget.id) {
      const remaining = conversations.filter((c) => c.id !== deleteTarget.id)
      setActiveId(remaining[0]?.id ?? "")
    }
    setDeleteTarget(null)
  }

  return (
    <>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
          >
            <PlusIcon data-icon="inline-start" />
            New Chat
          </Button>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="p-0 py-1">
            <SidebarMenu>
              {conversations.map((conv) => (
                <SidebarMenuItem key={conv.id}>
                  {renamingId === conv.id ? (
                    <div className="px-2 py-1">
                      <Input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename()
                          if (e.key === "Escape") cancelRename()
                        }}
                        onBlur={commitRename}
                        className="h-7 text-xs"
                      />
                    </div>
                  ) : (
                    <ContextMenu>
                      <ContextMenuTrigger>
                        <SidebarMenuButton
                          isActive={activeId === conv.id}
                          size="sm"
                          onClick={() => setActiveId(conv.id)}
                          className={cn(
                            "gap-1.5",
                            activeId === conv.id && "font-normal"
                          )}
                        >
                          <span className="flex-1 min-w-0 truncate text-xs">
                            {conv.title ?? "New Chat"}
                          </span>
                          {conv.last_provider && (
                            <Badge
                              variant="secondary"
                              className="shrink-0 rounded-sm px-1 py-0 h-[18px] text-[10px] font-normal leading-none bg-muted text-muted-foreground border-0"
                            >
                              {PROVIDER_LABEL[conv.last_provider] ??
                                conv.last_provider}
                            </Badge>
                          )}
                        </SidebarMenuButton>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuGroup>
                          <ContextMenuItem onSelect={() => startRename(conv)}>
                            Rename
                          </ContextMenuItem>
                          <ContextMenuItem
                            variant="destructive"
                            onSelect={() => setDeleteTarget(conv)}
                          >
                            Delete
                          </ContextMenuItem>
                        </ContextMenuGroup>
                      </ContextMenuContent>
                    </ContextMenu>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {/* Delete confirmation dialog — controlled, no trigger */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title ?? "This conversation"}&rdquo; will be
              permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
