import { ChevronDownIcon, FileJsonIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { JsonViewer } from '../JsonViewer'
import { cn } from '@/lib/utils'

interface RequestPayloadSectionProps {
  payload: Record<string, unknown>
  defaultOpen?: boolean
}

export function RequestPayloadSection({ payload, defaultOpen = false }: RequestPayloadSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        render={
          <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary transition-colors cursor-pointer" />
        }
      >
        <FileJsonIcon className="size-3.5 text-muted-foreground" />
        <span>Request Payload</span>
        <ChevronDownIcon className={cn('ml-auto size-3 text-muted-foreground transition-transform', 'group-data-[state=open]:rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-md bg-muted p-3 overflow-x-auto max-h-96 overflow-y-auto">
          <JsonViewer data={payload} maxStringLength={200} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
