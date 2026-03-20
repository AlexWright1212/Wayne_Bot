import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { EyeIcon, CopyIcon, CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useVisibilityStore } from '@/stores/visibilityStore'
import { ThinkingIndicator } from './ThinkingIndicator'
import { ToolExecution } from './ToolExecution'
import { SummaryIndicator } from './SummaryIndicator'
import type { Message, ToolTraceStep } from '@/lib/types'
import { useState } from 'react'

interface AssistantMessageProps {
  message: Message
  reasoning?: string | null
  toolName?: string | null
  toolSteps?: ToolTraceStep[]
  hasSummary?: boolean
  outputTokens?: number | null
  isStreaming?: boolean
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 transition-opacity"
      aria-label="Copy code"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

export function AssistantMessage({
  message,
  reasoning,
  toolName,
  toolSteps,
  hasSummary,
  outputTokens,
  isStreaming,
}: AssistantMessageProps) {
  const inspectMessage = useVisibilityStore((s) => s.inspectMessage)

  const markdownComponents = useMemo(
    () => ({
      pre: ({ children, ...props }: React.ComponentProps<'pre'>) => {
        const codeText =
          children &&
          typeof children === 'object' &&
          'props' in (children as React.ReactElement)
            ? String((children as React.ReactElement<{ children?: string }>).props?.children || '')
            : ''
        return (
          <div className="group/code relative my-3">
            <pre {...props} className="overflow-x-auto rounded-md bg-muted p-4 text-sm">
              {children}
            </pre>
            <CopyButton text={codeText} />
          </div>
        )
      },
      code: ({ children, className, ...props }: React.ComponentProps<'code'>) => {
        const isInline = !className
        if (isInline) {
          return (
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm" {...props}>
              {children}
            </code>
          )
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      },
    }),
    []
  )

  return (
    <div className="mb-4">
      {/* Thinking indicator */}
      {reasoning && (
        <ThinkingIndicator
          reasoning={reasoning}
          messageId={message.id}
          isStreaming={isStreaming}
        />
      )}

      {/* Tool execution steps */}
      {toolName && toolSteps && toolSteps.length > 0 && (
        <ToolExecution
          toolName={toolName}
          steps={toolSteps}
          messageId={message.id}
          isStreaming={isStreaming}
        />
      )}

      {/* Summary indicator */}
      {hasSummary && <SummaryIndicator messageId={message.id} />}

      {/* Response content */}
      {message.content && (
        <div className="prose prose-invert prose-sm max-w-none text-foreground">
          <ReactMarkdown
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}

      {/* Streaming cursor */}
      {isStreaming && !message.content && (
        <span className="inline-block size-2 rounded-full bg-foreground animate-pulse" />
      )}

      {/* Footer metadata */}
      {!isStreaming && message.content && (
        <>
          <Separator className="my-2" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {message.model_id && <Badge variant="secondary">{message.model_id}</Badge>}
            {message.provider && <span>{message.provider}</span>}
            {message.reasoning_level && message.reasoning_level !== 'none' && message.reasoning_level !== 'off' && (
              <span>reasoning: {message.reasoning_level}</span>
            )}
            {outputTokens != null && <span>{outputTokens} tokens</span>}

            <div className="flex-1" />

            {/* Inspect button */}
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => inspectMessage(message.id)}
              aria-label="Inspect message"
            >
              <EyeIcon />
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
