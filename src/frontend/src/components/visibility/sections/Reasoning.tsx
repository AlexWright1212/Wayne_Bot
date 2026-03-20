import { ChevronDownIcon, BrainIcon } from 'lucide-react'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ReasoningSectionProps {
  content: string
  defaultOpen?: boolean
}

export function ReasoningSection({ content, defaultOpen = false }: ReasoningSectionProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        render={
          <button className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium hover:bg-secondary transition-colors cursor-pointer" />
        }
      >
        <BrainIcon className="size-3.5 text-muted-foreground" />
        <span>Reasoning Content</span>
        <ChevronDownIcon className={cn('ml-auto size-3 text-muted-foreground transition-transform', 'group-data-[state=open]:rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 rounded-md bg-muted p-3 text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-96 overflow-y-auto">
          {content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
