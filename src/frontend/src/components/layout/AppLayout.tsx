import { cn } from "@/lib/utils";
import { SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatEmpty } from "@/components/chat/ChatEmpty";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { useConversationStore } from "@/stores/useConversationStore";
import { VisibilityPane } from "@/components/visibility/VisibilityPane";

export function AppLayout() {
  const activeConversationId = useConversationStore((s) => s.activeConversationId);
  const messagesByConvId = useConversationStore((s) => s.messagesByConvId);
  const visibilityOpen = useConversationStore((s) => s.visibilityOpen);
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
      <SidebarInset className="h-svh overflow-hidden">

        {/* Top bar */}
        <TopBar />

        {/* Body: chat pane + visibility pane side by side */}
        <div className="flex flex-1 overflow-hidden">

          {/* Chat pane */}
          <div className="flex flex-1 flex-col overflow-hidden bg-card">
            {hasMessages ? <ChatMessages /> : <ChatEmpty />}

            {/* Input */}
            <div className="shrink-0 border-t border-border px-3 py-3">
              <ChatInput onSend={handleSend} />
            </div>
          </div>

          {/* Visibility pane — collapses to w-0 when closed */}
          <div
            className={cn(
              "flex flex-col overflow-hidden border-l border-border bg-panel",
              "transition-all duration-150 ease-out",
              visibilityOpen ? "w-[448px]" : "w-0"
            )}
          >
            <VisibilityPane />
          </div>

        </div>
      </SidebarInset>
    </>
  );
}
