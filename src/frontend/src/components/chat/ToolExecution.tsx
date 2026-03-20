import { useState } from 'react'
import { SearchIcon, CheckIcon, LoaderIcon, ChevronDownIcon, EyeIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { useVisibilityStore } from '@/stores/visibilityStore'
import { cn } from '@/lib/utils'
import type { ToolTraceStep } from '@/lib/types'

const STEP_LABELS: Record<string, string> = {
  query_generation: 'Generating search queries',
  execute_queries: 'Searching',
  round2_search: 'Searching for details',
  filter_results: 'Filtering results',
  coverage_check: 'Checking coverage',
}

function getStepLabel(name: string): string {
  if (name.startsWith('coverage_retry_')) return 'Searching for more info'
  return STEP_LABELS[name] || name
}

interface ToolExecutionProps {
  toolName: string
  steps: ToolTraceStep[]
  messageId: string
  isStreaming?: boolean
}

export function ToolExecution({ steps, messageId, isStreaming }: ToolExecutionProps) {
  const [open, setOpen] = useState(true)
  const inspectMessage = useVisibilityStore((s) => s.inspectMessage)

  const completedCount = steps.filter((s) => s.status === 'complete').length
  const totalLabel = isStreaming
    ? `${completedCount} steps`
    : `${completedCount} steps`

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <div className="flex items-center gap-1.5">
        <CollapsibleTrigger
          render={
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              onClick={() => {
                if (!isStreaming) inspectMessage(messageId, 'tool_trace')
              }}
            />
          }
        >
          <SearchIcon className="size-3.5" />
          <span>Searched the web — {totalLabel}</span>
          <ChevronDownIcon
            className={cn('size-3 transition-transform', open && 'rotate-180')}
          />
        </CollapsibleTrigger>

        {!isStreaming && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => inspectMessage(messageId, 'tool_trace')}
            aria-label="Inspect tool trace"
          >
            <EyeIcon />
          </Button>
        )}
      </div>

      <CollapsibleContent>
        <div className="ml-1 mt-2 flex flex-col gap-1.5 border-l-2 border-border pl-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {step.status === 'running' ? (
                <LoaderIcon className="size-3 text-muted-foreground animate-spin" />
              ) : (
                <CheckIcon className="size-3 text-muted-foreground" />
              )}
              <span className={cn(
                step.status === 'running' ? 'text-foreground' : 'text-muted-foreground'
              )}>
                {getStepLabel(step.name)}
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
