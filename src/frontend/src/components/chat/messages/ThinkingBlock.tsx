import { useState } from "react";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";

interface ThinkingBlockProps {
  reasoning: string;
}

export function ThinkingBlock({ reasoning }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const excerpt = reasoning.split("\n")[0].slice(0, 80);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground cursor-pointer select-none">
        <BrainIcon className="size-3 shrink-0" />
        <span className="shrink-0">Thinking</span>
        {!open && (
          <span className="truncate opacity-50">— {excerpt}…</span>
        )}
        <ChevronRightIcon
          className={cn("size-3 shrink-0 transition-transform ml-1", open && "rotate-90")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md bg-muted/30 px-4 py-3 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {reasoning}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
