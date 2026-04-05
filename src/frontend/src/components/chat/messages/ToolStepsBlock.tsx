import { useState } from "react";
import { GlobeIcon, ChevronRightIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import type { ToolTrace, HarnessStepName } from "@/mocks/types";

const STEP_LABELS: Record<HarnessStepName, string> = {
  query_generation: "Generating search queries",
  execute_queries: "Searching",
  round2_search: "Searching for more info",
  filter_results: "Filtering results",
  coverage_check: "Checking coverage",
  coverage_retry_1: "Searching for more info",
  coverage_retry_2: "Searching for more info",
};

interface ToolStepsBlockProps {
  trace: ToolTrace;
}

export function ToolStepsBlock({ trace }: ToolStepsBlockProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 border-0 bg-transparent p-0 text-left text-xs text-muted-foreground outline-none transition-colors hover:text-foreground cursor-pointer select-none">
        <GlobeIcon className="size-3 shrink-0" />
        <span>Searched the web</span>
        <span className="opacity-50">— {trace.steps.length} steps</span>
        <ChevronRightIcon
          className={cn("size-3 shrink-0 transition-transform ml-1", open && "rotate-90")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-1.5 pl-4 border-l border-border">
          {trace.steps.map((step) => (
            <div
              key={step.name}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <CheckIcon className="size-3 shrink-0 text-primary" />
              <span>{STEP_LABELS[step.name] ?? step.name}</span>
              <span className="ml-auto tabular-nums opacity-40">
                {step.duration_ms}ms
              </span>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
