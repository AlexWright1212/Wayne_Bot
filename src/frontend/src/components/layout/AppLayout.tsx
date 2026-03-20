import { useState } from 'react'
import { Sidebar, SidebarToggle } from '@/components/sidebar/Sidebar'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { VisibilityPanel } from '@/components/visibility/VisibilityPanel'
import { useVisibilityStore } from '@/stores/visibilityStore'

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const isPaneOpen = useVisibilityStore((s) => s.isPaneOpen)

  return (
    <div className="flex h-full w-full">
      {/* Sidebar toggle (visible when collapsed) */}
      <SidebarToggle
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(false)}
      />

      {/* Left: Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
      />

      {/* Center: Chat */}
      <ChatPanel />

      {/* Right: Visibility */}
      {isPaneOpen && <VisibilityPanel />}
    </div>
  )
}
