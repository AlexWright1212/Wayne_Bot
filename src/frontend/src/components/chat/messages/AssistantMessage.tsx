import { EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversationStore } from "@/stores/useConversationStore";
import { useModelStore } from "@/stores/useModelStore";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolStepsBlock } from "./ToolStepsBlock";
import { SummaryBlock } from "./SummaryBlock";
import { MarkdownContent } from "./MarkdownContent";
import type { Message, VisibilityRecord, ModelCatalog } from "@/mocks/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function getModelName(catalog: ModelCatalog, modelId: string): string {
  for (const providerData of Object.values(catalog.providers)) {
    const model = providerData.models.find((m) => m.id === modelId);
    if (model) return model.name;
  }
  return modelId;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

// ── AssistantMessage ──────────────────────────────────────────────────────────

interface AssistantMessageProps {
  message: Message;
  visibility: VisibilityRecord | null;
}

export function AssistantMessage({ message, visibility }: AssistantMessageProps) {
  const catalog = useModelStore((s) => s.catalog);
  const openVisibility = useConversationStore((s) => s.openVisibility);

  const modelName = message.model_id
    ? getModelName(catalog, message.model_id)
    : null;
  const providerLabel = message.provider
    ? (PROVIDER_DISPLAY[message.provider] ?? message.provider)
    : null;

  const hasThinking = !!visibility?.reasoning_content;
  const hasToolTrace = !!visibility?.tool_trace;
  const hasSummary = !!visibility?.summary_event;

  return (
    <div className="flex flex-col gap-2">
      {/* Thinking indicator */}
      {hasThinking && (
        <ThinkingBlock reasoning={visibility!.reasoning_content!} />
      )}

      {/* Tool steps */}
      {hasToolTrace && <ToolStepsBlock trace={visibility!.tool_trace!} />}

      {/* Summary indicator */}
      {hasSummary && <SummaryBlock event={visibility!.summary_event!} />}

      {/* Response content */}
      {message.content && <MarkdownContent content={message.content} />}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {modelName && <span>{modelName}</span>}
          {providerLabel && (
            <>
              <span className="opacity-30">·</span>
              <span>{providerLabel}</span>
            </>
          )}
          {message.reasoning_level && message.reasoning_level !== "none" && message.reasoning_level !== "off" && (
            <>
              <span className="opacity-30">·</span>
              <span>reasoning: {message.reasoning_level}</span>
            </>
          )}
          {visibility?.output_tokens != null && (
            <>
              <span className="opacity-30">·</span>
              <span className="tabular-nums">{visibility.output_tokens} tok</span>
            </>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => openVisibility(message.id)}
        >
          <EyeIcon />
        </Button>
      </div>
    </div>
  );
}
