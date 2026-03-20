import { useEffect, useState } from 'react'
import { RefreshCwIcon, AlertTriangleIcon } from 'lucide-react'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useModelStore } from '@/stores/modelStore'
import { useVisibilityStore } from '@/stores/visibilityStore'
import { useChatStore } from '@/stores/chatStore'
import { listModels, refreshOpenRouterModels } from '@/lib/api'
import { formatNumber } from '@/lib/utils'

export function TopBar() {
  const providers = useModelStore((s) => s.providers)
  const setProviders = useModelStore((s) => s.setProviders)
  const selectedProvider = useModelStore((s) => s.selectedProvider)
  const selectedModelId = useModelStore((s) => s.selectedModelId)
  const selectedReasoningLevel = useModelStore((s) => s.selectedReasoningLevel)
  const setSelectedProvider = useModelStore((s) => s.setSelectedProvider)
  const setSelectedModelId = useModelStore((s) => s.setSelectedModelId)
  const setSelectedReasoningLevel = useModelStore((s) => s.setSelectedReasoningLevel)
  const getSelectedModel = useModelStore((s) => s.getSelectedModel)
  const getAvailableModels = useModelStore((s) => s.getAvailableModels)
  const getReasoningLevels = useModelStore((s) => s.getReasoningLevels)

  const tokenCounts = useVisibilityStore((s) => s.tokenCounts)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const conversations = useChatStore((s) => s.conversations)
  const activeConv = conversations.find((c) => c.id === activeConversationId)

  useEffect(() => {
    listModels()
      .then((res) => setProviders(res.providers))
      .catch(() => {})
  }, [setProviders])

  const model = getSelectedModel()
  const models = getAvailableModels()
  const reasoningLevels = getReasoningLevels()
  const providerNames = Object.keys(providers)

  // DeepSeek R1 has builtin reasoning — show static indicator
  const isBuiltinReasoning = model && reasoningLevels.length === 0 && model.supports_reasoning

  // Token stats
  const ctxWindow = model?.context_window ?? 0
  const maxOutput = model?.max_output ?? 0
  const activeTokens = tokenCounts?.active_token_count ?? 0
  const utilization = ctxWindow > 0 ? (activeTokens / ctxWindow) * 100 : 0

  const [isRefreshing, setIsRefreshing] = useState(false)

  async function handleRefreshOpenRouter() {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      await refreshOpenRouterModels()
      const res = await listModels()
      setProviders(res.providers)
    } catch {
      console.error('Failed to refresh OpenRouter models')
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="h-12 border-b border-border flex items-center gap-2 px-3">
        {/* Provider select */}
        <Select
          value={selectedProvider ?? undefined}
          onValueChange={(v) => v && setSelectedProvider(v)}
        >
          <SelectTrigger size="sm" className="w-auto min-w-24">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {providerNames.map((name) => {
                const p = providers[name]
                return (
                  <SelectItem key={name} value={name} disabled={!p.available}>
                    <span className="flex items-center gap-1.5">
                      {name}
                      {!p.available && <AlertTriangleIcon className="text-destructive" />}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* OpenRouter refresh */}
        {selectedProvider === 'openrouter' && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleRefreshOpenRouter}
                  disabled={isRefreshing}
                />
              }
            >
              <RefreshCwIcon className={isRefreshing ? 'animate-spin' : ''} />
            </TooltipTrigger>
            <TooltipContent>{isRefreshing ? 'Refreshing...' : 'Refresh OpenRouter models'}</TooltipContent>
          </Tooltip>
        )}

        {/* Model select */}
        <Select
          value={selectedModelId ?? undefined}
          onValueChange={(v) => v && setSelectedModelId(v)}
        >
          <SelectTrigger size="sm" className="w-auto min-w-28">
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {models.length === 0 ? (
                <SelectItem value="__none" disabled>No models available</SelectItem>
              ) : (
                models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))
              )}
            </SelectGroup>
          </SelectContent>
        </Select>

        {/* Reasoning select / indicator */}
        {isBuiltinReasoning ? (
          <Badge variant="secondary">Reasoning: Always On</Badge>
        ) : reasoningLevels.length > 0 ? (
          <Select
            value={selectedReasoningLevel ?? undefined}
            onValueChange={(v) => setSelectedReasoningLevel(v)}
          >
            <SelectTrigger size="sm" className="w-auto min-w-20">
              <SelectValue placeholder="Reasoning" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {reasoningLevels.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}

        {/* Token stats */}
        {model && (
          <div className="ml-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span>{formatNumber(ctxWindow)} ctx</span>
            <span>{formatNumber(maxOutput)} max out</span>
            {activeConversationId && (
              <>
                <span>{formatNumber(activeTokens)} tokens</span>
                <span>{utilization.toFixed(1)}%</span>
              </>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Chat title */}
        {activeConv && (
          <span className="text-sm text-muted-foreground truncate max-w-48">
            {activeConv.title || 'New Chat'}
          </span>
        )}
      </div>
    </TooltipProvider>
  )
}
