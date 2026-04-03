import { TooltipProvider } from "@/components/ui/tooltip"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppLayout } from "@/components/layout/AppLayout"

export default function App() {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={true}>
        <AppLayout />
      </SidebarProvider>
    </TooltipProvider>
  )
}
