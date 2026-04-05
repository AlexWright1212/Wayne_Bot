import { useState } from "react";
import { cn } from "@/lib/utils";
import { SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatEmpty } from "@/components/chat/ChatEmpty";
import { useConversationStore } from "@/stores/useConversationStore";

export function AppLayout() {
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  const activeConversationId = useConversationStore((s) => s.activeConversationId);
  const messagesByConvId = useConversationStore((s) => s.messagesByConvId);
  const addUserMessage = useConversationStore((s) => s.addUserMessage);

  const activeMessages =
    (activeConversationId ? messagesByConvId[activeConversationId] : null) ?? [];
  const hasMessages = activeMessages.length > 0;

  function handleSend(content: string) {
    if (activeConversationId) {
      addUserMessage(activeConversationId, content);
    }
  }

  return (
    <>
      {/* ── Left sidebar ─────────────────────────────────────────── */}
      <AppSidebar />

      {/* ── Main content ─────────────────────────────────────────── */}
      <SidebarInset className="overflow-hidden">

        {/* Top bar */}
        <TopBar
          visibilityOpen={visibilityOpen}
          onToggleVisibility={() => setVisibilityOpen((v) => !v)}
        />

        {/* Body: chat pane + visibility pane side by side */}
        <div className="flex flex-1 overflow-hidden">

          {/* Chat pane */}
          <div className="flex flex-1 flex-col overflow-hidden bg-card">
            {/* Messages or empty state */}
            {hasMessages ? (
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <p className="text-sm text-muted-foreground">Chat messages</p>
              </div>
            ) : (
              <ChatEmpty />
            )}

            {/* Input */}
            <div className="shrink-0 border-t border-border px-3 py-3">
              <ChatInput onSend={handleSend} />
            </div>
          </div>

          {/* Visibility pane — collapses to w-0 when closed */}
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
  );
}
