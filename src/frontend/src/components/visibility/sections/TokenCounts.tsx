import { ChevronDownIcon, HashIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatNumber } from '@/lib/utils'
import type { VisibilityRecord } from '@/lib/types'

interface TokenCountsSectionProps {
  record: VisibilityRecord
  defaultOpen?: boolean
}

export function TokenCountsSection({ record, defaultOpen = false }: TokenCountsSectionProps) {
  const utilization =
    record.context_window_size && record.active_token_count
      ? ((record.active_token_count / record.context_window_size) * 100).toFixed(2)
      : null

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        render={
          <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary transition-colors cursor-pointer" />
        }
      >
        <HashIcon className="size-3.5 text-muted-foreground" />
        <span>Token Counts</span>
        <ChevronDownIcon className={cn('ml-auto size-3 text-muted-foreground transition-transform', 'group-data-[state=open]:rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-md bg-muted p-3 text-xs flex flex-col gap-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">OpenAI (tiktoken)</span>
            {record.tokens_openai != null ? (
              <span>{formatNumber(record.tokens_openai)}</span>
            ) : (
              <Skeleton className="h-3 w-12" />
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Anthropic</span>
            {record.tokens_anthropic != null ? (
              <span>{formatNumber(record.tokens_anthropic)}</span>
            ) : (
              <Skeleton className="h-3 w-12" />
            )}
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">OpenRouter</span>
            {record.tokens_openrouter != null ? (
              <span>{formatNumber(record.tokens_openrouter)}</span>
            ) : (
              <Skeleton className="h-3 w-12" />
            )}
          </div>
          {record.output_tokens != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Output tokens</span>
              <span>{formatNumber(record.output_tokens)}</span>
            </div>
          )}
          {utilization && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">Context utilization</span>
                <span>{utilization}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-foreground/50 transition-all"
                  style={{ width: `${Math.min(parseFloat(utilization), 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
