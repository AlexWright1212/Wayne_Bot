import { useState } from "react"
import { PanelRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/AppSidebar"

export function AppLayout() {
  const [visibilityOpen, setVisibilityOpen] = useState(false)

  return (
    <>
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <AppSidebar />

      {/* ── Main content ─────────────────────────────────────────── */}
      <SidebarInset className="overflow-hidden">

        {/* Top bar */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs text-muted-foreground">
              Provider · Model · Reasoning
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              400K ctx · 128K max · 0 tok · 0%
            </span>
            <Separator orientation="vertical" className="h-4" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setVisibilityOpen((v) => !v)}
            >
              <PanelRightIcon />
            </Button>
          </div>
        </header>

        {/* Body: chat pane + visibility pane side by side */}
        <div className="flex flex-1 overflow-hidden">

          {/* Chat pane */}
          <div className="flex flex-1 flex-col overflow-hidden bg-card">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <p className="text-sm text-muted-foreground">Chat messages</p>
            </div>
            {/* Input */}
            <div className="shrink-0 border-t border-border px-3 py-3">
              <p className="text-sm text-muted-foreground">Chat input</p>
            </div>
          </div>

          {/* Visibility pane — collapsed to w-0 until opened */}
          <div
            className={cn(
              "flex flex-col overflow-hidden border-l border-border bg-card",
              "transition-all duration-150 ease-out",
              visibilityOpen ? "w-[400px]" : "w-0"
            )}
          >
            <div className="shrink-0 border-b border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">Visibility pane</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <p className="text-xs text-muted-foreground">Tab content</p>
            </div>
            <div className="shrink-0 border-t border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">Token totals footer</p>
            </div>
          </div>

        </div>
      </SidebarInset>
    </>
  )
}
