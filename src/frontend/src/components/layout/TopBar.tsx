import { RefreshCwIcon, PanelRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useModelStore } from "@/stores/useModelStore";
import { useConversationStore } from "@/stores/useConversationStore";
import { MOCK_TOKEN_COUNTS } from "@/mocks/data";
import type { Provider } from "@/mocks/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const PROVIDER_DISPLAY: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

// Compact trigger style: outlined secondary action — visible border + muted fill
const TRIGGER_CLASS =
  "h-7 border border-border bg-muted px-2 text-xs text-foreground shadow-none " +
  "hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring/50 gap-0.5";

// ── TopBar ────────────────────────────────────────────────────────────────────

export function TopBar() {
  const toggleVisibility = useConversationStore((s) => s.toggleVisibility);
  const catalog = useModelStore((s) => s.catalog);
  const isLoadingCatalog = useModelStore((s) => s.isLoadingCatalog);
  const provider = useModelStore((s) => s.provider);
  const modelId = useModelStore((s) => s.modelId);
  const reasoningLevel = useModelStore((s) => s.reasoningLevel);
  const setProvider = useModelStore((s) => s.setProvider);
  const setModelId = useModelStore((s) => s.setModelId);
  const setReasoningLevel = useModelStore((s) => s.setReasoningLevel);

  const models = catalog.providers[provider]?.models ?? [];
  const currentModel = models.find((m) => m.id === modelId) ?? models[0];

  const alwaysOn =
    currentModel?.supports_reasoning &&
    currentModel?.reasoning_levels.length === 0;
  const hasReasoningDropdown = (currentModel?.reasoning_levels.length ?? 0) > 0;

  // Token stats — mock data adjusted for selected model's context window
  const ctxSize = currentModel?.context_window ?? MOCK_TOKEN_COUNTS.context_window_size;
  const maxOut = currentModel?.max_output ?? 0;
  const activeTok = MOCK_TOKEN_COUNTS.active_token_count;
  const utilization = activeTok / ctxSize;
  const utilizationPct = (utilization * 100).toFixed(1);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
      {/* ── Left: controls ─────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mx-1 my-1" />

        {/* Provider */}
        <Select value={provider} onValueChange={(v) => setProvider(v as Provider)} disabled={isLoadingCatalog}>
          <SelectTrigger className={TRIGGER_CLASS} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} side="bottom">
            <SelectGroup>
              {Object.entries(catalog.providers).map(([key, info]) => (
                <SelectItem
                  key={key}
                  value={key}
                  className={cn(!info.available && "opacity-40")}
                >
                  {PROVIDER_DISPLAY[key as Provider]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <Separator orientation="vertical" className="my-1" />

        {/* Model */}
        <div className="flex items-center gap-0.5">
          <Select value={modelId} onValueChange={(v) => v && setModelId(v)} disabled={isLoadingCatalog}>
            <SelectTrigger className={TRIGGER_CLASS} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} side="bottom">
              <SelectGroup>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          {/* OpenRouter refresh icon */}
          {provider === "openrouter" && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
            >
              <RefreshCwIcon />
            </Button>
          )}
        </div>

        {/* Reasoning — shown only if configurable */}
        {hasReasoningDropdown && (
          <>
            <Separator orientation="vertical" className="my-1" />
            <Select value={reasoningLevel} onValueChange={(v) => v && setReasoningLevel(v)}>
              <SelectTrigger className={TRIGGER_CLASS} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} side="bottom">
                <SelectGroup>
                  {(currentModel?.reasoning_levels as string[]).map((level) => (
                    <SelectItem key={level} value={level}>
                      {level.charAt(0).toUpperCase() + level.slice(1)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </>
        )}

        {/* Always-on reasoning indicator (e.g. DeepSeek R1) */}
        {alwaysOn && !hasReasoningDropdown && (
          <>
            <Separator orientation="vertical" className="my-1" />
            <span className="text-xs text-muted-foreground">
              Reasoning: Always On
            </span>
          </>
        )}
      </div>

      {/* ── Right: token stats + visibility toggle ──────────────── */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{formatK(ctxSize)} ctx</span>
        <span className="text-border">·</span>
        <span className="tabular-nums">{formatK(maxOut)} max</span>
        <span className="text-border">·</span>
        <span className="tabular-nums">{activeTok.toLocaleString()} tok</span>
        <span className="text-border">·</span>
        <Progress value={utilization * 100} className="w-12" />
        <span className="tabular-nums">{utilizationPct}%</span>

        <Separator orientation="vertical" className="my-1" />

        <Button variant="ghost" size="icon-sm" onClick={toggleVisibility}>
          <PanelRightIcon />
        </Button>
      </div>
    </header>
  );
}
