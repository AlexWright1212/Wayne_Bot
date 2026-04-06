import { useState } from "react";
import { ChevronRightIcon, EyeOffIcon, CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConversationStore } from "@/stores/useConversationStore";
import { useModelStore } from "@/stores/useModelStore";
import { MOCK_VISIBILITY, MOCK_TOKEN_COUNTS } from "@/mocks/data";
import type { VisibilityRecord, ToolSchema, HarnessStep } from "@/mocks/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

// ---------------------------------------------------------------------------
// Inline types for HarnessStep data (not exported from mocks/types)
// ---------------------------------------------------------------------------

interface FilterStepData {
  kept: number;
  removed: number;
  removed_reasons: Array<{ url: string; reason: string }>;
}

interface CoverageStepData {
  sufficient: boolean;
  missing: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function formatN(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString();
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return n.toString();
}

function formatUtil(ratio: number): string {
  const pct = ratio * 100;
  if (pct < 0.01) return "<0.01%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(1)}%`;
}

function getToolName(tool: ToolSchema): string {
  return "function" in tool ? tool.function.name : tool.name;
}

function getToolDescription(tool: ToolSchema): string {
  return "function" in tool ? tool.function.description : tool.description;
}

// ---------------------------------------------------------------------------
// Tab layout helpers
// ---------------------------------------------------------------------------

const TABS = [
  { value: "payload", label: "Payload" },
  { value: "metadata", label: "Metadata" },
  { value: "tokens", label: "Tokens" },
  { value: "reasoning", label: "Reasoning" },
  { value: "summary", label: "Summary" },
  { value: "trace", label: "Trace" },
  { value: "config", label: "Config" },
] as const;

function TabRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right text-xs">{children}</div>
    </div>
  );
}

function ExpandTrigger({
  open,
  label,
}: {
  open: boolean;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer select-none">
      <ChevronRightIcon
        className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty / placeholder states
// ---------------------------------------------------------------------------

function NoMessageSelected() {
  return (
    <Empty className="h-full border-0 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <EyeOffIcon />
        </EmptyMedia>
        <EmptyTitle>No message selected</EmptyTitle>
        <EmptyDescription>
          Click Inspect on an assistant message to view its data.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function NoDataState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="text-center text-xs text-muted-foreground">
        No {label.toLowerCase()} data for this message.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Response Metadata
// ---------------------------------------------------------------------------

function MetadataTabContent({ record }: { record: VisibilityRecord }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const meta = record.response_metadata;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <TabRow label="Finish Reason">
        <Badge
          className={cn(
            "bg-muted text-muted-foreground",
            meta.finish_reason === "error" && "bg-destructive/10 text-destructive"
          )}
        >
          {meta.finish_reason}
        </Badge>
      </TabRow>
      <TabRow label="Prompt Tokens">
        <span className="font-mono tabular-nums">
          {meta.usage.prompt_tokens.toLocaleString()}
        </span>
      </TabRow>
      <TabRow label="Output Tokens">
        <span className="font-mono tabular-nums">
          {meta.usage.completion_tokens.toLocaleString()}
        </span>
      </TabRow>

      {meta.auto_title && (
        <>
          <Separator className="my-1" />
          <TabRow label="Generated Title">
            <span>{meta.auto_title.response}</span>
          </TabRow>
          <div className="mt-1">
            <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
              <CollapsibleTrigger className="border-0 bg-transparent p-0 outline-none">
                <ExpandTrigger open={promptOpen} label="Title Prompt" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {meta.auto_title.prompt}
                </p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Token Counts
// ---------------------------------------------------------------------------

function TokensTabContent({ record }: { record: VisibilityRecord }) {
  const util = record.active_token_count / record.context_window_size;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <TabRow label="OpenAI">
        <span
          className={cn(
            "font-mono tabular-nums",
            record.tokens_openai === null && "text-muted-foreground"
          )}
        >
          {formatN(record.tokens_openai)}
        </span>
      </TabRow>
      <TabRow label="Anthropic">
        <span
          className={cn(
            "font-mono tabular-nums",
            record.tokens_anthropic === null && "text-muted-foreground"
          )}
        >
          {formatN(record.tokens_anthropic)}
        </span>
      </TabRow>
      <TabRow label="OpenRouter">
        <span
          className={cn(
            "font-mono tabular-nums",
            record.tokens_openrouter === null && "text-muted-foreground"
          )}
        >
          {formatN(record.tokens_openrouter)}
        </span>
      </TabRow>

      <Separator className="my-1" />

      <TabRow label="Output Tokens">
        <span className="font-mono tabular-nums">{record.output_tokens.toLocaleString()}</span>
      </TabRow>
      <TabRow label="Context Window">
        <span className="font-mono tabular-nums">
          {formatContext(record.context_window_size)}
        </span>
      </TabRow>
      <TabRow label="Active Tokens">
        <span className="font-mono tabular-nums">
          {record.active_token_count.toLocaleString()}
        </span>
      </TabRow>
      <TabRow label="Utilization">
        <span className="font-mono tabular-nums">{formatUtil(util)}</span>
      </TabRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Reasoning Content
// ---------------------------------------------------------------------------

function ReasoningTabContent({ reasoning }: { reasoning: string }) {
  return (
    <div className="px-3 py-3">
      <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-muted-foreground">
        {reasoning}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Summary Event
// ---------------------------------------------------------------------------

function SummaryTabContent({ record }: { record: VisibilityRecord }) {
  const [textOpen, setTextOpen] = useState(true);
  const event = record.summary_event!;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-3">
      <TabRow label="Messages Summarized">
        <span className="font-mono tabular-nums">
          {event.summarized_message_ids.length}
        </span>
      </TabRow>
      <TabRow label="Tokens Before">
        <span className="font-mono tabular-nums">
          {event.tokens_before.toLocaleString()}
        </span>
      </TabRow>
      <TabRow label="Tokens After">
        <span className="font-mono tabular-nums">
          {event.tokens_after.toLocaleString()}
        </span>
      </TabRow>
      <TabRow label="Model Used">
        <span className="font-mono text-[11px] text-[--code]">{event.model_used}</span>
      </TabRow>

      <Separator className="my-1" />

      <Collapsible open={textOpen} onOpenChange={setTextOpen}>
        <CollapsibleTrigger className="border-0 bg-transparent p-0 outline-none">
          <ExpandTrigger open={textOpen} label="Summary Text" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-2 text-xs leading-relaxed text-foreground">
            {event.summary_text}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Config
// ---------------------------------------------------------------------------

function ConfigTabContent({ record }: { record: VisibilityRecord }) {
  const [promptOpen, setPromptOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const systemMsg = record.request_payload.messages.find(
    (m) => m.role === "system"
  );
  const systemPrompt = systemMsg?.content ?? "";
  const tools = record.request_payload.tools ?? [];

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <TabRow label="Summary Trigger">
        <span>80% ctx utilization</span>
      </TabRow>

      <Separator className="my-1" />

      <Collapsible open={promptOpen} onOpenChange={setPromptOpen}>
        <CollapsibleTrigger className="border-0 bg-transparent p-0 outline-none">
          <ExpandTrigger open={promptOpen} label="System Prompt" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
            {systemPrompt}
          </pre>
        </CollapsibleContent>
      </Collapsible>

      {tools.length > 0 && (
        <>
          <Separator className="my-1" />
          <Collapsible open={toolsOpen} onOpenChange={setToolsOpen}>
            <CollapsibleTrigger className="border-0 bg-transparent p-0 outline-none">
              <ExpandTrigger
                open={toolsOpen}
                label={`Available Tools (${tools.length})`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 flex flex-col gap-3">
                {tools.map((tool, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    <span className="font-mono text-[11px] text-[--code]">
                      {getToolName(tool)}
                    </span>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {getToolDescription(tool)}
                    </p>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON Viewer — collapsible, syntax-highlighted JSON renderer
// ---------------------------------------------------------------------------

const JSON_INDENT = 16; // px per nesting level

function JsonKey({ name }: { name: string }) {
  return (
    <>
      <span className="text-foreground">"{name}"</span>
      <span className="text-muted-foreground">: </span>
    </>
  );
}

function JsonStringValue({ value }: { value: string }) {
  const isLong = value.length > 200;
  const [open, setOpen] = useState(!isLong);

  if (!isLong) {
    return <span className="text-[--code] break-words">"{value}"</span>;
  }

  return open ? (
    <span
      className="text-[--code] break-words cursor-pointer hover:opacity-80 transition-opacity"
      onClick={() => setOpen(false)}
    >
      "{value}"
    </span>
  ) : (
    <button
      className="text-left text-[--code] opacity-60 hover:opacity-100 transition-opacity"
      onClick={() => setOpen(true)}
    >
      "{value.slice(0, 80)}…"
    </button>
  );
}

function JsonObjectValue({
  obj,
  objectKey,
  isLast,
  depth,
}: {
  obj: Record<string, unknown>;
  objectKey?: string;
  isLast: boolean;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const entries = Object.entries(obj);
  const comma = !isLast ? <span className="text-muted-foreground">,</span> : null;

  if (entries.length === 0) {
    return (
      <>
        <div>
          {objectKey && <JsonKey name={objectKey} />}
          <span className="text-muted-foreground">{"{}"}</span>
          {comma}
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        {objectKey && <JsonKey name={objectKey} />}
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setOpen((o) => !o)}
        >
          {"{"}
        </button>
        {!open && (
          <>
            <span className="text-[11px] text-muted-foreground italic">
              {" "}…{entries.length}{" "}
            </span>
            <span className="text-muted-foreground">{"}"}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          <div style={{ paddingLeft: JSON_INDENT }} className="border-l border-border/40">
            {entries.map(([k, v], i) => (
              <JsonNode
                key={k}
                value={v}
                objectKey={k}
                isLast={i === entries.length - 1}
                depth={depth + 1}
              />
            ))}
          </div>
          <div>
            <span className="text-muted-foreground">{"}"}</span>
            {comma}
          </div>
        </>
      )}
    </>
  );
}

function JsonArrayValue({
  arr,
  objectKey,
  isLast,
  depth,
}: {
  arr: unknown[];
  objectKey?: string;
  isLast: boolean;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  const comma = !isLast ? <span className="text-muted-foreground">,</span> : null;

  if (arr.length === 0) {
    return (
      <>
        <div>
          {objectKey && <JsonKey name={objectKey} />}
          <span className="text-muted-foreground">{"[]"}</span>
          {comma}
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        {objectKey && <JsonKey name={objectKey} />}
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setOpen((o) => !o)}
        >
          {"["}
        </button>
        {!open && (
          <>
            <span className="text-[11px] text-muted-foreground italic">
              {" "}…{arr.length}{" "}
            </span>
            <span className="text-muted-foreground">{"]"}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          <div style={{ paddingLeft: JSON_INDENT }} className="border-l border-border/40">
            {arr.map((item, i) => (
              <JsonNode
                key={i}
                value={item}
                isLast={i === arr.length - 1}
                depth={depth + 1}
              />
            ))}
          </div>
          <div>
            <span className="text-muted-foreground">{"]"}</span>
            {comma}
          </div>
        </>
      )}
    </>
  );
}

function JsonNode({
  value,
  objectKey,
  isLast = true,
  depth = 0,
}: {
  value: unknown;
  objectKey?: string;
  isLast?: boolean;
  depth?: number;
}) {
  if (Array.isArray(value)) {
    return (
      <JsonArrayValue
        arr={value}
        objectKey={objectKey}
        isLast={isLast}
        depth={depth}
      />
    );
  }
  if (typeof value === "object" && value !== null) {
    return (
      <JsonObjectValue
        obj={value as Record<string, unknown>}
        objectKey={objectKey}
        isLast={isLast}
        depth={depth}
      />
    );
  }

  const comma = !isLast ? <span className="text-muted-foreground">,</span> : null;
  let valueEl: React.ReactNode;

  if (value === null) {
    valueEl = <span className="text-muted-foreground italic">null</span>;
  } else if (typeof value === "boolean") {
    valueEl = <span className="text-primary">{String(value)}</span>;
  } else if (typeof value === "number") {
    valueEl = (
      <span className="text-primary tabular-nums">{String(value)}</span>
    );
  } else if (typeof value === "string") {
    valueEl = <JsonStringValue value={value} />;
  } else {
    valueEl = <span>{String(value)}</span>;
  }

  return (
    <div>
      {objectKey !== undefined && <JsonKey name={objectKey} />}
      {valueEl}
      {comma}
    </div>
  );
}

function JsonViewer({ data }: { data: unknown }) {
  return (
    <div className="font-mono text-[12px] leading-relaxed">
      <JsonNode value={data} depth={0} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Request Payload
// ---------------------------------------------------------------------------

function PayloadTabContent({ record }: { record: VisibilityRecord }) {
  return (
    <div className="px-3 py-3">
      <JsonViewer data={record.request_payload} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Tool Trace
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<string, string> = {
  query_generation: "Generating search queries",
  execute_queries: "Searching",
  round2_search: "Searching for details",
  filter_results: "Filtering results",
  coverage_check: "Checking coverage",
  coverage_retry_1: "Coverage retry 1",
  coverage_retry_2: "Coverage retry 2",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function TraceStepIcon({ status }: { status: HarnessStep["status"] }) {
  if (status === "complete") {
    return <CheckIcon className="size-3 shrink-0 text-primary" />;
  }
  if (status === "error") {
    return <XIcon className="size-3 shrink-0 text-destructive" />;
  }
  return <Spinner className="size-3 shrink-0 text-muted-foreground" />;
}

function TraceStepData({ step }: { step: HarnessStep }) {
  if (step.name === "filter_results") {
    const d = step.data as unknown as FilterStepData;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-3 text-xs">
          <span>
            Kept{" "}
            <span className="font-mono text-primary tabular-nums">{d.kept}</span>
          </span>
          <span>
            Removed{" "}
            <span className="font-mono text-muted-foreground tabular-nums">
              {d.removed}
            </span>
          </span>
        </div>
        {d.removed_reasons.length > 0 && (
          <div className="flex flex-col gap-0.5">
            {d.removed_reasons.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate font-mono text-[--code]">
                  {r.url}
                </span>
                <Badge className="shrink-0 bg-muted px-1 text-[10px] text-muted-foreground">
                  {r.reason}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (
    step.name === "coverage_check" ||
    step.name.startsWith("coverage_retry")
  ) {
    const d = step.data as unknown as CoverageStepData;
    return (
      <div className="flex flex-col gap-1 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Confidence</span>
          <span className="font-mono tabular-nums text-primary">
            {Math.round(d.confidence * 100)}%
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Sufficient</span>
          <span
            className={cn(
              "font-mono",
              d.sufficient ? "text-primary" : "text-destructive"
            )}
          >
            {String(d.sufficient)}
          </span>
        </div>
        {d.missing.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground">Missing:</span>
            {d.missing.map((m, i) => (
              <span key={i} className="text-[11px] text-foreground">
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return <JsonViewer data={step.data} />;
}

function TraceStep({
  step,
  isLast,
}: {
  step: HarnessStep;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = STEP_LABELS[step.name] ?? step.name;
  const isRetry = step.name.startsWith("coverage_retry");

  return (
    <div className="flex gap-2">
      {/* Left column: status icon + vertical connector */}
      <div className="flex flex-col items-center pt-0.5">
        <div className="flex size-5 shrink-0 items-center justify-center">
          <TraceStepIcon status={step.status} />
        </div>
        {!isLast && <div className="mt-0.5 w-px flex-1 bg-border" />}
      </div>

      {/* Right column: label row + expandable data */}
      <div className={cn("min-w-0 flex-1", !isLast && "pb-3")}>
        <button
          className="flex w-full items-center gap-1.5 text-left"
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
          <span
            className={cn(
              "flex-1 text-xs",
              isRetry && "italic text-muted-foreground"
            )}
          >
            {label}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
            {formatDuration(step.duration_ms)}
          </span>
        </button>
        {open && (
          <div className="mt-1.5 rounded border border-border bg-muted/30 px-2 py-2">
            <TraceStepData step={step} />
          </div>
        )}
      </div>
    </div>
  );
}

function ToolTraceTabContent({ record }: { record: VisibilityRecord }) {
  const trace = record.tool_trace!;
  const [argsOpen, setArgsOpen] = useState(false);
  const totalDuration = trace.steps.reduce((sum, s) => sum + s.duration_ms, 0);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {/* Tool info */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Tool</span>
          <span className="font-mono text-[11px] text-[--code]">
            {trace.tool_name}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Duration</span>
          <span className="font-mono text-[11px] tabular-nums">
            {formatDuration(totalDuration)}
          </span>
        </div>
      </div>

      {/* Arguments collapsible */}
      {Object.keys(trace.tool_arguments).length > 0 && (
        <Collapsible open={argsOpen} onOpenChange={setArgsOpen}>
          <CollapsibleTrigger className="border-0 bg-transparent p-0 outline-none">
            <ExpandTrigger open={argsOpen} label="Arguments" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded border border-border bg-muted/30 px-2 py-2">
              <JsonViewer data={trace.tool_arguments} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Separator />

      {/* Steps timeline */}
      <div className="flex flex-col">
        {trace.steps.map((step, i) => (
          <TraceStep
            key={`${step.name}-${i}`}
            step={step}
            isLast={i === trace.steps.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VisibilityPane() {
  const selectedMessageId = useConversationStore(
    (s) => s.selectedVisibilityMessageId
  );
  const record = selectedMessageId
    ? (MOCK_VISIBILITY[selectedMessageId] ?? null)
    : null;

  const tokens = MOCK_TOKEN_COUNTS;
  const catalog = useModelStore((s) => s.catalog);

  // Per-provider context windows: use the first model in each provider's list.
  // When the real backend ships, the catalog will already have the right values.
  const ctxOpenAI = catalog.providers.openai?.models[0]?.context_window ?? 1;
  const ctxAnthropic = catalog.providers.anthropic?.models[0]?.context_window ?? 1;
  const ctxOpenRouter = catalog.providers.openrouter?.models[0]?.context_window ?? 1;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="payload" className="min-h-0 flex-1 flex-col gap-0">
        {/* Tab bar */}
        <TabsList
          variant="line"
          className="h-8 w-full rounded-none border-b border-border px-0"
        >
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="flex-1 rounded-none px-0.5 py-1 text-xs"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Payload */}
        <TabsContent value="payload" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : (
            <ScrollArea className="h-full">
              <PayloadTabContent record={record} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Metadata */}
        <TabsContent value="metadata" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : (
            <ScrollArea className="h-full">
              <MetadataTabContent record={record} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Token Counts */}
        <TabsContent value="tokens" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : (
            <ScrollArea className="h-full">
              <TokensTabContent record={record} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Reasoning Content */}
        <TabsContent value="reasoning" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : record.reasoning_content === null ? (
            <NoDataState label="Reasoning" />
          ) : (
            <ScrollArea className="h-full">
              <ReasoningTabContent reasoning={record.reasoning_content} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Summary Event */}
        <TabsContent value="summary" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : record.summary_event === null ? (
            <NoDataState label="Summary Event" />
          ) : (
            <ScrollArea className="h-full">
              <SummaryTabContent record={record} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Tool Trace */}
        <TabsContent value="trace" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : record.tool_trace === null ? (
            <NoDataState label="Tool Trace" />
          ) : (
            <ScrollArea className="h-full">
              <ToolTraceTabContent record={record} />
            </ScrollArea>
          )}
        </TabsContent>

        {/* Config */}
        <TabsContent value="config" className="flex-1 overflow-hidden">
          {!record ? (
            <NoMessageSelected />
          ) : (
            <ScrollArea className="h-full">
              <ConfigTabContent record={record} />
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>

      {/* Persistent footer — conversation-level token totals */}
      <Separator />
      <div className="shrink-0 px-3 py-2">
        <div className="flex flex-col gap-1">
          {/* OpenAI row */}
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">OAI</span>
            <Progress
              value={tokens.tokens_openai !== null ? (tokens.tokens_openai / ctxOpenAI) * 100 : 0}
              className="h-1 flex-1"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
              {formatN(tokens.tokens_openai)}
            </span>
          </div>
          {/* Anthropic row */}
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">ANT</span>
            <Progress
              value={tokens.tokens_anthropic !== null ? (tokens.tokens_anthropic / ctxAnthropic) * 100 : 0}
              className="h-1 flex-1"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
              {formatN(tokens.tokens_anthropic)}
            </span>
          </div>
          {/* OpenRouter row */}
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 font-mono text-[11px] text-muted-foreground">OR</span>
            <Progress
              value={tokens.tokens_openrouter !== null ? (tokens.tokens_openrouter / ctxOpenRouter) * 100 : 0}
              className="h-1 flex-1"
            />
            <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums">
              {formatN(tokens.tokens_openrouter)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
