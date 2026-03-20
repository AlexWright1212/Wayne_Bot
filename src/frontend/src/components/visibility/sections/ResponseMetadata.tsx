import { ChevronDownIcon, InfoIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ResponseMetadataSectionProps {
  metadata: Record<string, unknown> | null
  defaultOpen?: boolean
}

export function ResponseMetadataSection({ metadata, defaultOpen = false }: ResponseMetadataSectionProps) {
  if (!metadata) return null

  const finishReason = metadata.finish_reason as string | undefined
  const usage = metadata.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const autoTitle = metadata.auto_title as { prompt?: string; response?: string } | undefined

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        render={
          <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary transition-colors cursor-pointer" />
        }
      >
        <InfoIcon className="size-3.5 text-muted-foreground" />
        <span>Response Metadata</span>
        <ChevronDownIcon className={cn('ml-auto size-3 text-muted-foreground transition-transform', 'group-data-[state=open]:rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-md bg-muted p-3 text-xs flex flex-col gap-1.5">
          {finishReason && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Finish reason</span>
              <span>{finishReason}</span>
            </div>
          )}
          {usage?.prompt_tokens != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Prompt tokens</span>
              <span>{usage.prompt_tokens.toLocaleString()}</span>
            </div>
          )}
          {usage?.completion_tokens != null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Completion tokens</span>
              <span>{usage.completion_tokens.toLocaleString()}</span>
            </div>
          )}
          {autoTitle && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="text-muted-foreground mb-1">Auto-title</div>
              <div className="text-foreground">{autoTitle.response}</div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
