import { useState } from "react"
import { PanelRightIcon, RefreshCwIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { MOCK_MODEL_CATALOG, MOCK_TOKEN_COUNTS } from "@/mocks/data"
import type { Provider, ReasoningLevel } from "@/mocks/types"

// ── helpers ──────────────────────────────────────────────────────────────────

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const PROVIDER_DISPLAY: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
}

// ── Compact trigger style shared by all three selects ─────────────────────────
// Strips the bordered-input look and replaces with a text-label+chevron style
const TRIGGER_CLASS =
  "h-7 border-0 bg-transparent px-1.5 text-xs text-foreground shadow-none " +
  "hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring/50 gap-0.5"

// ── TopBar ────────────────────────────────────────────────────────────────────

interface TopBarProps {
  visibilityOpen: boolean
  onToggleVisibility: () => void
}

export function TopBar({ visibilityOpen: _, onToggleVisibility }: TopBarProps) {
  const [provider, setProvider] = useState<Provider>("openai")
  const [modelId, setModelId] = useState("gpt-5")
  const [reasoningLevel, setReasoningLevel] = useState<string>("none")

  const catalog = MOCK_MODEL_CATALOG.providers
  const models = catalog[provider]?.models ?? []
  const currentModel = models.find((m) => m.id === modelId) ?? models[0]

  // Reasoning states for the selected model
  const alwaysOn =
    currentModel?.supports_reasoning &&
    currentModel?.reasoning_levels.length === 0
  const hasReasoningDropdown =
    (currentModel?.reasoning_levels.length ?? 0) > 0

  // When provider changes, default to the first model
  function handleProviderChange(val: string) {
    const p = val as Provider
    setProvider(p)
    const firstModel = catalog[p]?.models[0]
    if (firstModel) {
      setModelId(firstModel.id)
      setReasoningLevel(firstModel.reasoning_levels[0] as string ?? "")
    }
  }

  // When model changes, reset reasoning to first level
  function handleModelChange(val: string) {
    setModelId(val)
    const m = models.find((m) => m.id === val)
    const firstLevel = (m?.reasoning_levels[0] as string) ?? ""
    setReasoningLevel(firstLevel)
  }

  // Token stats — use mock data, adjust context window to selected model
  const ctxSize = currentModel?.context_window ?? MOCK_TOKEN_COUNTS.context_window_size
  const maxOut = currentModel?.max_output ?? 0
  const activeTok = MOCK_TOKEN_COUNTS.active_token_count
  const utilization = activeTok / ctxSize
  const utilizationPct = (utilization * 100).toFixed(1)

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
      {/* ── Left: controls ─────────────────────────────────────── */}
      <div className="flex items-center gap-1">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mx-1 h-4" />

        {/* Provider */}
        <Select value={provider} onValueChange={handleProviderChange}>
          <SelectTrigger className={TRIGGER_CLASS} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} side="bottom">
            <SelectGroup>
              {Object.entries(catalog).map(([key, info]) => (
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

        <Separator orientation="vertical" className="h-3" />

        {/* Model */}
        <div className="flex items-center gap-0.5">
          <Select value={modelId} onValueChange={handleModelChange}>
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
            <Separator orientation="vertical" className="h-3" />
            <Select
              value={reasoningLevel}
              onValueChange={(v) => setReasoningLevel(v)}
            >
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
            <Separator orientation="vertical" className="h-3" />
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
        <span className="tabular-nums">
          {activeTok.toLocaleString()} tok
        </span>
        <span className="text-border">·</span>
        <Progress
          value={utilization * 100}
          className="w-12"
        />
        <span className="tabular-nums">{utilizationPct}%</span>

        <Separator orientation="vertical" className="h-4" />

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleVisibility}
        >
          <PanelRightIcon />
        </Button>
      </div>
    </header>
  )
}
