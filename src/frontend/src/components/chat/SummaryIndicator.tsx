import { FileTextIcon, EyeIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useVisibilityStore } from '@/stores/visibilityStore'

interface SummaryIndicatorProps {
  messageId: string
}

export function SummaryIndicator({ messageId }: SummaryIndicatorProps) {
  const inspectMessage = useVisibilityStore((s) => s.inspectMessage)

  return (
    <div className="flex items-center gap-1.5 mb-3">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        onClick={() => inspectMessage(messageId, 'summary')}
      >
        <FileTextIcon className="size-3.5" />
        <span>Chat summarized</span>
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => inspectMessage(messageId, 'summary')}
        aria-label="Inspect summary"
      >
        <EyeIcon />
      </Button>
    </div>
  )
}
