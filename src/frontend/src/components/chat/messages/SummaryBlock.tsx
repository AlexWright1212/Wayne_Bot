import { useState } from "react";
import { ArchiveIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { SummaryEvent } from "@/mocks/types";

interface SummaryBlockProps {
  event: SummaryEvent;
}

export function SummaryBlock({ event }: SummaryBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground cursor-pointer select-none">
        <ArchiveIcon className="size-3 shrink-0" />
        <span>Chat summarized</span>
        <ChevronRightIcon
          className={cn("size-3 shrink-0 transition-transform ml-1", open && "rotate-90")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex flex-col gap-2">
          <p className="leading-relaxed">{event.summary_text}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-60">
            <span>{event.summarized_message_ids.length} messages summarized</span>
            <span>
              {event.tokens_before.toLocaleString()} → {event.tokens_after.toLocaleString()} tokens
            </span>
            <span>by {event.model_used}</span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
