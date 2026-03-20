import { ChevronDownIcon, SearchIcon, CheckIcon, LoaderIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { JsonViewer } from '../JsonViewer'
import { cn } from '@/lib/utils'
import type { ToolTrace } from '@/lib/types'

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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface ToolTraceSectionProps {
  trace: ToolTrace
  defaultOpen?: boolean
}

export function ToolTraceSection({ trace, defaultOpen = false }: ToolTraceSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        render={
          <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary transition-colors cursor-pointer" />
        }
      >
        <SearchIcon className="size-3.5 text-muted-foreground" />
        <span>Tool Trace</span>
        <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">
          {trace.steps.length} steps
        </Badge>
        <ChevronDownIcon className={cn('ml-auto size-3 text-muted-foreground transition-transform', 'group-data-[state=open]:rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-0.5">
          {trace.steps.map((step, i) => (
            <ToolTraceStepItem key={i} step={step} isRetry={step.name.startsWith('coverage_retry_')} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolTraceStepItem({
  step,
  isRetry,
}: {
  step: ToolTrace['steps'][number]
  isRetry: boolean
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <button
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-secondary transition-colors cursor-pointer',
              isRetry && 'border-l-2 border-orange-400/50 ml-1'
            )}
          />
        }
      >
        {step.status === 'running' ? (
          <LoaderIcon className="size-3 text-muted-foreground animate-spin" />
        ) : (
          <CheckIcon className="size-3 text-muted-foreground" />
        )}
        <span className="flex-1 text-left">{getStepLabel(step.name)}</span>
        {step.duration_ms > 0 && (
          <span className="text-muted-foreground">{formatDuration(step.duration_ms)}</span>
        )}
        <ChevronDownIcon className="size-3 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mx-2 mt-1 mb-2 rounded-md bg-muted p-2 overflow-x-auto max-h-48 overflow-y-auto">
          <JsonViewer data={step.data} defaultCollapsed maxStringLength={150} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
