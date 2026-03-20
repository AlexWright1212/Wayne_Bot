import { ChevronDownIcon, FileTextIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn, formatNumber } from '@/lib/utils'
import type { SummaryEvent } from '@/lib/types'

interface SummaryEventSectionProps {
  event: SummaryEvent
  defaultOpen?: boolean
}

export function SummaryEventSection({ event, defaultOpen = false }: SummaryEventSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        render={
          <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary transition-colors cursor-pointer" />
        }
      >
        <FileTextIcon className="size-3.5 text-muted-foreground" />
        <span>Summary Event</span>
        <ChevronDownIcon className={cn('ml-auto size-3 text-muted-foreground transition-transform', 'group-data-[state=open]:rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-md bg-muted p-3 text-xs flex flex-col gap-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tokens before</span>
            <span>{formatNumber(event.tokens_before)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tokens after</span>
            <span>{formatNumber(event.tokens_after)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Messages summarized</span>
            <span>{event.summarized_message_ids.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Model used</span>
            <span>{event.model_used}</span>
          </div>
          <div className="mt-2 pt-2 border-t border-border">
            <div className="text-muted-foreground mb-1">Summary text</div>
            <p className="text-foreground whitespace-pre-wrap">{event.summary_text}</p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
