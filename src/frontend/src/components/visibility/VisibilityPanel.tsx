import { useEffect } from 'react'
import { XIcon, EllipsisVerticalIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { useVisibilityStore } from '@/stores/visibilityStore'
import { getVisibility } from '@/lib/api'
import { formatNumber } from '@/lib/utils'
import { RequestPayloadSection } from './sections/RequestPayload'
import { ResponseMetadataSection } from './sections/ResponseMetadata'
import { TokenCountsSection } from './sections/TokenCounts'
import { ReasoningSection } from './sections/Reasoning'
import { SummaryEventSection } from './sections/SummaryEvent'
import { ToolTraceSection } from './sections/ToolTrace'

export function VisibilityPanel() {
  const activeMessageId = useVisibilityStore((s) => s.activeMessageId)
  const records = useVisibilityStore((s) => s.records)
  const setRecord = useVisibilityStore((s) => s.setRecord)
  const setIsPaneOpen = useVisibilityStore((s) => s.setIsPaneOpen)
  const tokenCounts = useVisibilityStore((s) => s.tokenCounts)
  const focusedSection = useVisibilityStore((s) => s.focusedSection)

  const record = activeMessageId ? records[activeMessageId] : null

  // Fetch visibility data when a message is selected
  useEffect(() => {
    if (!activeMessageId || records[activeMessageId]) return
    getVisibility(activeMessageId)
      .then((vis) => setRecord(activeMessageId, vis))
      .catch(() => {})
  }, [activeMessageId, records, setRecord])

  return (
    <div className="w-[420px] min-w-[420px] border-l border-border bg-muted/30 flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center justify-between px-3">
        <span className="text-sm font-medium">Visibility</span>
        <div className="flex items-center gap-1">
          {/* Three-dots menu */}
          <SystemInfoMenu />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setIsPaneOpen(false)}
            aria-label="Close visibility panel"
          >
            <XIcon />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 flex flex-col gap-2">
          {!activeMessageId ? (
            <p className="text-xs text-muted-foreground text-center mt-8">
              Click the inspect button on any assistant message to view its details
            </p>
          ) : !record ? (
            <p className="text-xs text-muted-foreground text-center mt-8">
              Loading visibility data...
            </p>
          ) : (
            <>
              <RequestPayloadSection
                payload={record.request_payload}
                defaultOpen={focusedSection === 'payload'}
              />
              <ResponseMetadataSection
                metadata={record.response_metadata}
                defaultOpen={focusedSection === 'metadata'}
              />
              <TokenCountsSection
                record={record}
                defaultOpen={focusedSection === 'tokens'}
              />
              {record.reasoning_content && (
                <ReasoningSection
                  content={record.reasoning_content}
                  defaultOpen={focusedSection === 'reasoning'}
                />
              )}
              {record.summary_event && (
                <SummaryEventSection
                  event={record.summary_event}
                  defaultOpen={focusedSection === 'summary'}
                />
              )}
              {record.tool_trace && (
                <ToolTraceSection
                  trace={record.tool_trace}
                  defaultOpen={focusedSection === 'tool_trace'}
                />
              )}
            </>
          )}
        </div>
      </ScrollArea>

      {/* Persistent footer — conversation-level token totals */}
      <Separator />
      <div className="px-3 py-2 text-xs text-muted-foreground flex justify-between">
        <span>OAI: {tokenCounts?.tokens_openai != null ? formatNumber(tokenCounts.tokens_openai) : '—'}</span>
        <span>Anthropic: {tokenCounts?.tokens_anthropic != null ? formatNumber(tokenCounts.tokens_anthropic) : '—'}</span>
        <span>OR: {tokenCounts?.tokens_openrouter != null ? formatNumber(tokenCounts.tokens_openrouter) : '—'}</span>
      </div>
    </div>
  )
}

function SystemInfoMenu() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-xs" aria-label="System info" />
        }
      >
        <EllipsisVerticalIcon />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-80">
        <div className="flex flex-col gap-3 p-1">
          <div>
            <h4 className="text-xs font-medium mb-1">Summary Trigger</h4>
            <p className="text-xs text-muted-foreground">
              Summary triggers at: 80% context utilization
            </p>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            System prompt and tool schemas are visible in the Request Payload section of each message.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
