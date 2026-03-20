import { useState } from 'react'

interface JsonViewerProps {
  data: unknown
  defaultCollapsed?: boolean
  maxStringLength?: number
}

export function JsonViewer({ data, defaultCollapsed = false, maxStringLength = 200 }: JsonViewerProps) {
  return (
    <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
      <JsonNode value={data} indent={0} defaultCollapsed={defaultCollapsed} maxStringLength={maxStringLength} />
    </pre>
  )
}

function JsonNode({
  value,
  indent,
  defaultCollapsed,
  maxStringLength,
}: {
  value: unknown
  indent: number
  defaultCollapsed: boolean
  maxStringLength: number
}) {
  const padInner = '  '.repeat(indent + 1)

  if (value === null) return <span className="text-muted-foreground">null</span>
  if (value === undefined) return <span className="text-muted-foreground">undefined</span>
  if (typeof value === 'boolean') return <span className="text-orange-400">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-blue-400">{value}</span>

  if (typeof value === 'string') {
    return <StringNode value={value} maxLength={maxStringLength} />
  }

  if (Array.isArray(value)) {
    return (
      <CollapsibleNode
        openBracket="["
        closeBracket="]"
        indent={indent}
        defaultCollapsed={defaultCollapsed || value.length > 5}
        summary={`${value.length} items`}
      >
        {value.map((item, i) => (
          <span key={i}>
            {padInner}
            <JsonNode
              value={item}
              indent={indent + 1}
              defaultCollapsed={defaultCollapsed}
              maxStringLength={maxStringLength}
            />
            {i < value.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
      </CollapsibleNode>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <CollapsibleNode
        openBracket="{"
        closeBracket="}"
        indent={indent}
        defaultCollapsed={defaultCollapsed || entries.length > 8}
        summary={`${entries.length} keys`}
      >
        {entries.map(([k, v], i) => (
          <span key={k}>
            {padInner}
            <span className="text-sky-400">"{k}"</span>
            {': '}
            <JsonNode
              value={v}
              indent={indent + 1}
              defaultCollapsed={defaultCollapsed}
              maxStringLength={maxStringLength}
            />
            {i < entries.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
      </CollapsibleNode>
    )
  }

  return <span>{String(value)}</span>
}

function StringNode({ value, maxLength }: { value: string; maxLength: number }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = value.length > maxLength

  if (!isLong) {
    return <span className="text-green-400">"{value}"</span>
  }

  return (
    <span
      className="text-green-400 cursor-pointer hover:opacity-80"
      onClick={() => setExpanded(!expanded)}
    >
      "{expanded ? value : value.slice(0, maxLength) + '...'}"
    </span>
  )
}

function CollapsibleNode({
  openBracket,
  closeBracket,
  indent,
  defaultCollapsed,
  summary,
  children,
}: {
  openBracket: string
  closeBracket: string
  indent: number
  defaultCollapsed: boolean
  summary: string
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const pad = '  '.repeat(indent)

  if (collapsed) {
    return (
      <span
        className="cursor-pointer hover:opacity-80 text-muted-foreground"
        onClick={() => setCollapsed(false)}
      >
        {openBracket} <span className="text-xs italic">{summary}</span> {closeBracket}
      </span>
    )
  }

  return (
    <span>
      <span
        className="cursor-pointer hover:opacity-80"
        onClick={() => setCollapsed(true)}
      >
        {openBracket}
      </span>
      {'\n'}
      {children}
      {pad}{closeBracket}
    </span>
  )
}
