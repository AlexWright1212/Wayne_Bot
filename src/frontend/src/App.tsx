import { useEffect } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppLayout } from "@/components/layout/AppLayout"
import { useModelStore } from "@/stores/useModelStore"
import { useConversationStore } from "@/stores/useConversationStore"

export default function App() {
  const loadCatalog = useModelStore((s) => s.loadCatalog)
  const loadConversations = useConversationStore((s) => s.loadConversations)

  useEffect(() => {
    loadCatalog()
    loadConversations()
  }, [loadCatalog, loadConversations])

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={true}>
        <AppLayout />
      </SidebarProvider>
    </TooltipProvider>
  )
}
