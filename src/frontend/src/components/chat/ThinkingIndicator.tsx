import { useState } from 'react'
import { BrainIcon, ChevronDownIcon, EyeIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { useVisibilityStore } from '@/stores/visibilityStore'
import { cn } from '@/lib/utils'

interface ThinkingIndicatorProps {
  reasoning: string
  messageId: string
  isStreaming?: boolean
}

export function ThinkingIndicator({ reasoning, messageId, isStreaming }: ThinkingIndicatorProps) {
  const [open, setOpen] = useState(false)
  const inspectMessage = useVisibilityStore((s) => s.inspectMessage)

  const preview = reasoning.slice(0, 120).replace(/\n/g, ' ')
  const hasMore = reasoning.length > 120

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <div className="flex items-center gap-1.5">
        <CollapsibleTrigger
          render={
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
          }
        >
          <BrainIcon className="size-3.5" />
          <span>{isStreaming ? 'Thinking...' : 'Thought'}</span>
          {hasMore && (
            <ChevronDownIcon
              className={cn('size-3 transition-transform', open && 'rotate-180')}
            />
          )}
        </CollapsibleTrigger>

        {!isStreaming && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => inspectMessage(messageId, 'reasoning')}
            aria-label="Inspect reasoning"
          >
            <EyeIcon />
          </Button>
        )}
      </div>

      {!open && (
        <p className="text-xs text-muted-foreground/60 mt-1 truncate">
          {preview}{hasMore ? '...' : ''}
        </p>
      )}

      <CollapsibleContent>
        <pre className="mt-2 rounded-md bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
          {reasoning}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
