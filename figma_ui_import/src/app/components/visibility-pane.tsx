import { useState, useEffect } from "react";
import { PanelRight, ChevronRight, ChevronDown, Loader2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = "request" | "response" | "tokens" | "reasoning" | "summary" | "tools" | "config";

const TABS: Tab[] = ["request", "response", "tokens", "reasoning", "summary", "tools", "config"];

const UI: React.CSSProperties = { fontFamily: "'Inter', system-ui, sans-serif" };
const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

const C = {
  bg0: "#181818",
  bg1: "#1e1e1e",
  bg2: "#252526",
  bg3: "#2d2d30",
  bgEditor: "#0f1218",
  border0: "#2b2b2b",
  border1: "#333",
  text0: "#e0e0e0",
  text1: "#ababab",
  text2: "#777",
  text3: "#555",
  text4: "#3c3c3c",
  accent: "#4fc1e9",
  accentMuted: "#3a8fb7",
};

// ─── Visibility data type ─────────────────────────────────────────────────────

export interface VisibilityData {
  id: string;
  message_id: string;
  request_payload: Record<string, unknown>;
  response_metadata: {
    finish_reason: string;
    usage: { prompt_tokens: number; completion_tokens: number };
    auto_title?: { prompt: string; response: string };
  };
  tokens_openai: number;
  tokens_anthropic: number | null;
  tokens_openrouter: number | null;
  output_tokens: number;
  context_window_size: number;
  active_token_count: number;
  reasoning_content: string | null;
  summary_event: {
    summary_text: string;
    summarized_message_ids: string[];
    tokens_before: number;
    tokens_after: number;
    model?: string;
    model_used?: string;
  } | null;
  tool_trace: {
    steps: {
      name: string;
      status: string;
      data: Record<string, unknown>;
      duration_ms: number;
    }[];
  } | null;
  created_at: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

export const VISIBILITY_DATA: Record<string, VisibilityData> = {
  "msg-a1": {
    id: "vis-001",
    message_id: "msg-a1",
    request_payload: {
      messages: [
        {
          role: "system",
          content: "You are Wayne, a personal AI assistant. Today's date is March 23, 2026. Your primary goal is to be helpful, direct, and thorough. You have access to various tools including web search. Always use your tools when up-to-date information is required. Do not invent facts. Format your responses using clear Markdown. When writing code, ensure it is production-ready and clearly commented.",
        },
        {
          role: "user",
          content: "I'm building out Soulware and want to add some data visualization for mood tracking. Can you search the latest shadcn/ui docs for their new chart components?",
        },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_abc123",
              name: "web_search",
              arguments: '{"reason": "Need current shadcn docs to understand the new chart component API and implementation details for a user\'s React project.", "query": "shadcn ui chart component documentation 2026"}',
            },
          ],
        },
        {
          role: "tool_result",
          tool_call_id: "call_abc123",
          tool_name: "web_search",
          content: '[{"title": "Charts - shadcn/ui", "url": "https://ui.shadcn.com/docs/components/chart", "snippet": "Beautiful charts. Built using Recharts. Copy and paste into your apps. The Chart component uses a combination of CSS variables for theming and a centralized ChartContainer for managing responsive layouts and tooltip contexts.", "score": 0.98}, {"title": "Building Dashboards with shadcn/ui Charts", "url": "https://example.com/blog/shadcn-charts", "snippet": "A deep dive into the new chart block provided by shadcn/ui. Learn how to map dynamic data sources to the LineChart and BarChart primitives while maintaining dark mode compatibility.", "score": 0.85}]',
        },
      ],
      model_id: "gpt-5",
      provider: "openai",
      reasoning_level: "none",
      tools: [
        {
          type: "function",
          function: {
            name: "web_search",
            description: "Search the web for current or factual information needed to answer the user's question. Use this when the question requires up-to-date information, specific facts, or knowledge you may not have.",
            parameters: {
              type: "object",
              properties: {
                reason: { type: "string", description: "Brief explanation of why web search is needed" },
                query: { type: "string", description: "The information need described clearly for the search system" },
              },
              required: ["reason", "query"],
            },
          },
        },
      ],
    },
    response_metadata: {
      finish_reason: "stop",
      usage: { prompt_tokens: 1250, completion_tokens: 340 },
      auto_title: {
        prompt: "User: I'm building out Soulware and want to add some data visualization for mood tracking. Can you search the latest shadcn/ui docs for their new chart components?\nAssistant: Based on the latest documentation, shadcn/ui recently introduced a comprehensive `Chart` block built on top of Recharts.",
        response: "shadcn/ui Data Visualization",
      },
    },
    tokens_openai: 1250,
    tokens_anthropic: 1190,
    tokens_openrouter: 1300,
    output_tokens: 340,
    context_window_size: 400000,
    active_token_count: 1250,
    reasoning_content: null,
    summary_event: null,
    tool_trace: {
      steps: [
        {
          name: "query_generation",
          status: "complete",
          data: { ready_queries: ["shadcn ui chart component docs 2026", "shadcn ui Recharts wrapper implementation"], pending_queries: [] },
          duration_ms: 650,
        },
        {
          name: "execute_queries",
          status: "complete",
          data: { queries: ["shadcn ui chart component docs 2026", "shadcn ui Recharts wrapper implementation"], result_count: 8, entities: {} },
          duration_ms: 1400,
        },
        {
          name: "filter_results",
          status: "complete",
          data: { kept: 3, removed: 5, removed_reasons: [{ url: "https://old-react-blog.com/shadcn-charts", reason: "too_old" }] },
          duration_ms: 5,
        },
        {
          name: "coverage_check",
          status: "complete",
          data: { sufficient: true, missing: [], confidence: 0.95 },
          duration_ms: 500,
        },
      ],
    },
    created_at: "2026-03-23T19:30:15Z",
  },
  "msg-a2": {
    id: "vis-002",
    message_id: "msg-a2",
    request_payload: {
      messages: [
        {
          role: "system",
          content: "You are Wayne, a personal AI assistant. Today's date is March 23, 2026. Your primary goal is to be helpful, direct, and thorough. You have access to various tools including web search. Always use your tools when up-to-date information is required. Do not invent facts. Format your responses using clear Markdown. When writing code, ensure it is production-ready and clearly commented.",
        },
        {
          role: "user",
          content: "I'm building out Soulware and want to add some data visualization for mood tracking. Can you search the latest shadcn/ui docs for their new chart components?",
        },
        {
          role: "assistant",
          content: "Based on the latest documentation, shadcn/ui recently introduced a comprehensive `Chart` block built on top of Recharts. It uses a combination of CSS variables for theming and a central `<ChartContainer>` component to manage context.\n\nTo get started, you'll want to use the CLI: `npx shadcn-ui@latest add chart`.",
        },
        {
          role: "user",
          content: "How should I structure the React components for a multi-line chart comparing different spreadsheet metrics?",
        },
      ],
      model_id: "gpt-5",
      provider: "openai",
      reasoning_level: "high",
      tools: null,
    },
    response_metadata: {
      finish_reason: "stop",
      usage: { prompt_tokens: 1650, completion_tokens: 412 },
    },
    tokens_openai: 1650,
    tokens_anthropic: 1580,
    tokens_openrouter: 1710,
    output_tokens: 412,
    context_window_size: 400000,
    active_token_count: 1650,
    reasoning_content: "The user is asking for architectural advice on building a multi-line chart with shadcn/ui and Recharts, specifically focusing on handling spreadsheet metrics.\n\nFirst, I need to consider how `ChartContainer` manages the `ChartConfig`. If the spreadsheet has dynamic columns, the config object needs to be generated dynamically from the data keys, rather than hardcoded in the component file.\n\nSecond, Recharts expects a flat array of objects for its data prop. A spreadsheet export might be row-based or column-based, so I should advise them on normalizing the data first. Typically, a time-series format where each row represents a date and columns represent metrics is best.\n\nLet's write out a clean wrapper component that takes the raw data, formats it into the expected flat array, and maps over the metric keys to generate `<Line>` components dynamically. I will also make sure to mention `useMemo` to avoid performance hits with large datasets, as re-rendering heavy charts on every state change is a common pitfall.",
    summary_event: null,
    tool_trace: null,
    created_at: "2026-03-23T19:35:45Z",
  },
  "msg-a3": {
    id: "vis-003",
    message_id: "msg-a3",
    request_payload: {
      messages: [
        {
          role: "system",
          content: "You are Wayne, a personal AI assistant. Today's date is March 23, 2026. Your primary goal is to be helpful, direct, and thorough. You have access to various tools including web search. Always use your tools when up-to-date information is required. Do not invent facts. Format your responses using clear Markdown. When writing code, ensure it is production-ready and clearly commented.",
        },
        {
          role: "system",
          content: "[Conversation summary] The user is building an app called Soulware and requested documentation on shadcn/ui chart components. Wayne utilized the web search tool to find the latest documentation and provided the CLI install commands. The user then asked for structural advice for handling dynamic spreadsheet data. Wayne recommended normalizing the data into a flat array and dynamically generating Line components from the metric keys to ensure optimal performance.",
        },
        {
          role: "user",
          content: "Actually, I want the ability to reference past conversations where we built the data pipeline. Here is the massive 30,000-line JSON export of our spreadsheet schema:\n\n[\n  {\n    \"column_id\": \"col_98237\",\n    \"metric_name\": \"daily_active_users\",\n    \"data_type\": \"integer\",\n    \"temporal_resolution\": \"day\",\n    \"source_table\": \"analytics.events\"\n  },\n  {\n    \"column_id\": \"col_98238\",\n    \"metric_name\": \"session_duration_minutes\",\n    \"data_type\": \"float\",\n    \"temporal_resolution\": \"day\",\n    \"source_table\": \"analytics.sessions\"\n  },\n  {\n    \"column_id\": \"col_98239\",\n    \"metric_name\": \"bounce_rate_percentage\",\n    \"data_type\": \"float\",\n    \"temporal_resolution\": \"day\",\n    \"source_table\": \"analytics.traffic\"\n  },\n  {\n    \"column_id\": \"col_98240\",\n    \"metric_name\": \"conversion_rate_funnel_a\",\n    \"data_type\": \"float\",\n    \"temporal_resolution\": \"week\",\n    \"source_table\": \"analytics.conversions\"\n  }\n]\n\nCan you adapt the chart config for this specific output structure so I can render it directly?",
        },
      ],
      model_id: "gpt-5",
      provider: "openai",
      reasoning_level: "none",
      tools: null,
    },
    response_metadata: {
      finish_reason: "stop",
      usage: { prompt_tokens: 325000, completion_tokens: 280 },
    },
    tokens_openai: 325000,
    tokens_anthropic: 321000,
    tokens_openrouter: 330000,
    output_tokens: 280,
    context_window_size: 400000,
    active_token_count: 325000,
    reasoning_content: null,
    summary_event: {
      summary_text: "The user is building an app called Soulware and requested documentation on shadcn/ui chart components. Wayne utilized the web search tool to find the latest documentation and provided the CLI install commands. The user then asked for structural advice for handling dynamic spreadsheet data. Wayne recommended normalizing the data into a flat array and dynamically generating Line components from the metric keys to ensure optimal performance.",
      summarized_message_ids: ["msg-u1", "msg-a1", "msg-u2", "msg-a2"],
      tokens_before: 327100,
      tokens_after: 325000,
      model_used: "gpt-5-nano",
    },
    tool_trace: null,
    created_at: "2026-03-23T19:45:00Z",
  },
};

// ─── Collapsible JSON Viewer ──────────────────────────────────────────────────

const JSON_COLORS = {
  key: "#7ec8e3",
  string: "#a5d6a7",
  number: "#f0c674",
  boolean: "#c792ea",
  null: "#ef5350",
  bracket: "#666",
  punctuation: "#555",
};

function isLongString(val: unknown): boolean {
  return typeof val === "string" && val.length > 200;
}

function JsonValue({ value, defaultCollapsed = false }: { value: unknown; defaultCollapsed?: boolean }) {
  if (value === null) return <span style={{ color: JSON_COLORS.null }}>null</span>;
  if (typeof value === "boolean") return <span style={{ color: JSON_COLORS.boolean }}>{String(value)}</span>;
  if (typeof value === "number") return <span style={{ color: JSON_COLORS.number }}>{value}</span>;
  if (typeof value === "string") {
    const long = isLongString(value);
    if (long) return <CollapsibleString value={value} defaultCollapsed={!defaultCollapsed ? true : defaultCollapsed} />;
    return <span style={{ color: JSON_COLORS.string }}>"{value}"</span>;
  }
  if (Array.isArray(value)) return <JsonArray value={value} defaultCollapsed={defaultCollapsed} />;
  if (typeof value === "object") return <JsonObject value={value as Record<string, unknown>} defaultCollapsed={defaultCollapsed} />;
  return <span>{String(value)}</span>;
}

function CollapsibleString({ value, defaultCollapsed }: { value: string; defaultCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  if (collapsed) {
    const preview = value.slice(0, 80) + "…";
    return (
      <span
        onClick={() => setCollapsed(false)}
        style={{ color: JSON_COLORS.string, cursor: "pointer", opacity: 0.7 }}
        title="Click to expand"
      >
        "{preview}"
      </span>
    );
  }
  return (
    <span
      onClick={() => setCollapsed(true)}
      style={{ color: JSON_COLORS.string, cursor: "pointer" }}
      title="Click to collapse"
    >
      "{value}"
    </span>
  );
}

function JsonObject({ value, defaultCollapsed = false }: { value: Record<string, unknown>; defaultCollapsed?: boolean }) {
  const keys = Object.keys(value);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (keys.length === 0) return <span style={{ color: JSON_COLORS.bracket }}>{"{}"}</span>;

  if (collapsed) {
    const preview = keys.slice(0, 3).join(", ") + (keys.length > 3 ? ", …" : "");
    return (
      <span>
        <span onClick={() => setCollapsed(false)} style={{ color: JSON_COLORS.bracket, cursor: "pointer" }}>{"{"}</span>
        <span style={{ color: "#444", cursor: "pointer" }} onClick={() => setCollapsed(false)}> {preview} </span>
        <span style={{ color: JSON_COLORS.bracket }}>{"}"}</span>
      </span>
    );
  }

  return (
    <span>
      <span onClick={() => setCollapsed(true)} style={{ color: JSON_COLORS.bracket, cursor: "pointer" }}>{"{"}</span>
      <div style={{ paddingLeft: 16 }}>
        {keys.map((k, i) => (
          <div key={k}>
            <span style={{ color: JSON_COLORS.key }}>"{k}"</span>
            <span style={{ color: JSON_COLORS.punctuation }}>: </span>
            <JsonValue value={value[k]} />
            {i < keys.length - 1 && <span style={{ color: JSON_COLORS.punctuation }}>,</span>}
          </div>
        ))}
      </div>
      <span onClick={() => setCollapsed(true)} style={{ color: JSON_COLORS.bracket, cursor: "pointer" }}>{"}"}</span>
    </span>
  );
}

function JsonArray({ value, defaultCollapsed = false }: { value: unknown[]; defaultCollapsed?: boolean }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  if (value.length === 0) return <span style={{ color: JSON_COLORS.bracket }}>[]</span>;

  if (collapsed) {
    return (
      <span>
        <span onClick={() => setCollapsed(false)} style={{ color: JSON_COLORS.bracket, cursor: "pointer" }}>[</span>
        <span style={{ color: "#444", cursor: "pointer" }} onClick={() => setCollapsed(false)}> {value.length} items </span>
        <span style={{ color: JSON_COLORS.bracket }}>]</span>
      </span>
    );
  }

  return (
    <span>
      <span onClick={() => setCollapsed(true)} style={{ color: JSON_COLORS.bracket, cursor: "pointer" }}>[</span>
      <div style={{ paddingLeft: 16 }}>
        {value.map((item, i) => (
          <div key={i}>
            <JsonValue value={item} />
            {i < value.length - 1 && <span style={{ color: JSON_COLORS.punctuation }}>,</span>}
          </div>
        ))}
      </div>
      <span onClick={() => setCollapsed(true)} style={{ color: JSON_COLORS.bracket, cursor: "pointer" }}>]</span>
    </span>
  );
}

function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre
      style={{
        ...MONO,
        fontSize: "11px",
        lineHeight: "1.65",
        margin: 0,
        padding: "12px 14px",
        background: C.bgEditor,
        border: `1px solid ${C.border0}`,
        borderRadius: 4,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <JsonValue value={data} />
    </pre>
  );
}

// ─── Tab Content Components ───────────────────────────────────────────────────

function NoData({ label }: { label: string }) {
  return (
    <div style={{ padding: "40px 20px", textAlign: "center" }}>
      <span style={{ ...UI, fontSize: "12px", color: C.text4 }}>No {label} data</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        ...UI,
        fontSize: "10px",
        color: C.text4,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 0" }}>
      <Label>{label}</Label>
      <span style={{ ...MONO, fontSize: "12px", color: C.text1 }}>{value}</span>
    </div>
  );
}

// ─── Request Tab ──────────────────────────────────────────────────────────────

function RequestTab({ data }: { data: VisibilityData }) {
  return (
    <div style={{ padding: 12 }}>
      <Label>Request Payload</Label>
      <div style={{ marginTop: 8 }}>
        <JsonViewer data={data.request_payload} />
      </div>
    </div>
  );
}

// ─── Response Tab ─────────────────────────────────────────────────────────────

function ResponseTab({ data }: { data: VisibilityData }) {
  const meta = data.response_metadata;
  return (
    <div style={{ padding: "12px 14px" }}>
      <Label>Response Metadata</Label>
      <div style={{ marginTop: 8, borderTop: `1px solid ${C.border0}` }}>
        <MetaRow label="Finish Reason" value={meta.finish_reason} />
        <MetaRow label="Prompt Tokens" value={meta.usage.prompt_tokens.toLocaleString()} />
        <MetaRow label="Completion Tokens" value={meta.usage.completion_tokens.toLocaleString()} />
      </div>

      {meta.auto_title && (
        <div style={{ marginTop: 16 }}>
          <Label>Auto Title</Label>
          <div style={{ marginTop: 8, borderTop: `1px solid ${C.border0}` }}>
            <MetaRow label="Generated Title" value={<span style={{ color: C.accent }}>{meta.auto_title.response}</span>} />
            <div style={{ marginTop: 8 }}>
              <Label>Title Prompt</Label>
              <pre
                style={{
                  ...MONO,
                  fontSize: "11px",
                  color: C.text2,
                  background: C.bgEditor,
                  border: `1px solid ${C.border0}`,
                  borderRadius: 4,
                  padding: "10px 12px",
                  marginTop: 6,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: "1.6",
                }}
              >
                {meta.auto_title.prompt}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tokens Tab ───────────────────────────────────────────────────────────────

function TokenBar({ label, value, max, color, loading }: { label: string; value: number | null; max: number; color: string; loading?: boolean }) {
  const pct = value != null && max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <Label>{label}</Label>
        {loading ? (
          <Loader2 className="animate-spin" style={{ width: 10, height: 10, color: C.text4 }} />
        ) : (
          <span style={{ ...MONO, fontSize: "12px", color: C.text1 }}>{value != null ? value.toLocaleString() : "—"}</span>
        )}
      </div>
      <div style={{ height: 3, background: C.border0, position: "relative", overflow: "hidden", borderRadius: 1 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: color, borderRadius: 1, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

function TokensTab({ data }: { data: VisibilityData }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 1200);
    return () => clearTimeout(t);
  }, [data.message_id]);

  const utilPct = data.context_window_size > 0 ? Math.round((data.active_token_count / data.context_window_size) * 100) : 0;

  return (
    <div style={{ padding: "12px 14px" }}>
      <Label>Provider Token Counts</Label>
      <div style={{ marginTop: 8, borderTop: `1px solid ${C.border0}` }}>
        <TokenBar label="OpenAI (tiktoken)" value={data.tokens_openai} max={data.context_window_size} color={C.accent} />
        <TokenBar label="Anthropic (count_tokens)" value={loaded ? data.tokens_anthropic : null} max={data.context_window_size} color="#a78bfa" loading={!loaded} />
        <TokenBar label="OpenRouter (heuristic)" value={loaded ? data.tokens_openrouter : null} max={data.context_window_size} color="#34d399" loading={!loaded} />
      </div>

      <div style={{ marginTop: 16 }}>
        <Label>Output Tokens</Label>
        <div style={{ marginTop: 6 }}>
          <span style={{ ...MONO, fontSize: "14px", color: C.text0 }}>{data.output_tokens.toLocaleString()}</span>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Label>Context Utilization</Label>
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 3, background: C.border0, position: "relative", overflow: "hidden", borderRadius: 1 }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${utilPct}%`, background: C.accent, borderRadius: 1 }} />
          </div>
          <span style={{ ...MONO, fontSize: "11px", color: C.text2 }}>{utilPct}%</span>
          <span style={{ ...MONO, fontSize: "10px", color: C.text4 }}>
            ({data.active_token_count.toLocaleString()} / {data.context_window_size.toLocaleString()})
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Reasoning Tab ────────���───────────────────────────────────────────────────

function ReasoningTab({ data }: { data: VisibilityData }) {
  if (!data.reasoning_content) return <NoData label="reasoning" />;
  return (
    <div style={{ padding: 12 }}>
      <Label>Reasoning Trace</Label>
      <pre
        style={{
          ...MONO,
          fontSize: "11px",
          color: C.text2,
          background: C.bgEditor,
          border: `1px solid ${C.border0}`,
          borderRadius: 4,
          padding: "12px 14px",
          marginTop: 8,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: "1.65",
          maxHeight: 500,
          overflow: "auto",
        }}
      >
        {data.reasoning_content}
      </pre>
    </div>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({ data }: { data: VisibilityData }) {
  if (!data.summary_event) return <NoData label="summary" />;
  const s = data.summary_event;
  return (
    <div style={{ padding: "12px 14px" }}>
      <Label>Summary Event</Label>
      <div style={{ marginTop: 8, borderTop: `1px solid ${C.border0}` }}>
        <MetaRow label="Model" value={s.model || s.model_used} />
        <MetaRow label="Messages Summarized" value={s.summarized_message_ids.length} />
        <MetaRow label="Tokens Before" value={s.tokens_before.toLocaleString()} />
        <MetaRow label="Tokens After" value={s.tokens_after.toLocaleString()} />
      </div>
      <div style={{ marginTop: 12 }}>
        <Label>Summary Text</Label>
        <pre
          style={{
            ...MONO,
            fontSize: "11px",
            color: C.text2,
            background: C.bgEditor,
            border: `1px solid ${C.border0}`,
            borderRadius: 4,
            padding: "10px 12px",
            marginTop: 6,
            whiteSpace: "pre-wrap",
            lineHeight: "1.6",
            fontStyle: "italic",
          }}
        >
          {s.summary_text}
        </pre>
      </div>
    </div>
  );
}

// ─── Tools Tab ────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  query_generation: "Generating search queries",
  execute_queries: "Executing searches",
  filter_results: "Filtering results",
  coverage_check: "Checking coverage",
};

function ToolsTab({ data }: { data: VisibilityData }) {
  if (!data.tool_trace) return <NoData label="tool trace" />;
  const steps = data.tool_trace.steps;

  return (
    <div style={{ padding: "12px 14px" }}>
      <Label>Tool Execution Timeline</Label>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {steps.map((step, i) => (
            <ToolStepRow key={i} step={step} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolStepRow({ step }: { step: VisibilityData["tool_trace"] extends { steps: (infer S)[] } | null ? S : never }) {
  const [expanded, setExpanded] = useState(false);
  const label = STEP_LABELS[step.name] || step.name;
  const isFilter = step.name === "filter_results";
  const isCoverage = step.name === "coverage_check";
  const filterData = step.data as { kept?: number; removed?: number };
  const coverageData = step.data as { confidence?: number };

  let summary = "";
  if (isFilter && filterData.kept != null) summary = `Kept ${filterData.kept}, removed ${filterData.removed}`;
  if (isCoverage && coverageData.confidence != null) summary = `${Math.round(coverageData.confidence * 100)}% confidence`;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 0",
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: step.status === "complete" ? "#162b1e" : C.bg0,
            border: step.status === "complete" ? "1px solid #2a5a3a" : `1px solid ${C.border0}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {step.status === "complete" && (
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80" }} />
          )}
        </span>

        <span style={{ ...UI, fontSize: "12px", color: C.text2, flex: 1 }}>{label}</span>

        {summary && (
          <span style={{ ...MONO, fontSize: "10px", color: C.text3 }}>{summary}</span>
        )}

        <span style={{ ...MONO, fontSize: "10px", color: C.text4, flexShrink: 0 }}>{step.duration_ms}ms</span>

        {expanded ? (
          <ChevronDown style={{ width: 10, height: 10, color: C.text4, flexShrink: 0 }} />
        ) : (
          <ChevronRight style={{ width: 10, height: 10, color: C.text4, flexShrink: 0 }} />
        )}
      </button>

      {expanded && (
        <div style={{ marginLeft: 22, marginBottom: 6 }}>
          <JsonViewer data={step.data} />
        </div>
      )}
    </div>
  );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = "You are Wayne, a personal AI assistant. Today's date is March 23, 2026. Your primary goal is to be helpful, direct, and thorough. You have access to various tools including web search. Always use your tools when up-to-date information is required. Do not invent facts. Format your responses using clear Markdown. When writing code, ensure it is production-ready and clearly commented.";

const AVAILABLE_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web for current or factual information needed to answer the user's question. Use this when the question requires up-to-date information, specific facts, or knowledge you may not have.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Brief explanation of why web search is needed" },
          query: { type: "string", description: "The information need described clearly for the search system" },
        },
        required: ["reason", "query"],
      },
    },
  },
];

function ConfigTab() {
  return (
    <div style={{ padding: "12px 14px" }}>
      <Label>System Prompt</Label>
      <pre
        style={{
          ...MONO,
          fontSize: "11px",
          color: C.text2,
          background: C.bgEditor,
          border: `1px solid ${C.border0}`,
          borderRadius: 4,
          padding: "12px 14px",
          marginTop: 8,
          marginBottom: 20,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          lineHeight: "1.65",
        }}
      >
        {SYSTEM_PROMPT}
      </pre>

      <Label>Available Tools</Label>
      <div style={{ marginTop: 8, marginBottom: 20 }}>
        <JsonViewer data={AVAILABLE_TOOLS} />
      </div>

      <Label>Summary Trigger Threshold</Label>
      <div
        style={{
          marginTop: 8,
          background: C.bgEditor,
          border: `1px solid ${C.border0}`,
          borderRadius: 4,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ ...UI, fontSize: "12px", color: C.text1 }}>
          Summary triggers at:
        </span>
        <span style={{ ...MONO, fontSize: "12px", color: C.accent }}>
          80% context utilization
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <span style={{ ...UI, fontSize: "10px", color: C.text4 }}>
          Read-only — not configurable in v1
        </span>
      </div>
    </div>
  );
}

// ─── Provider utilization row ─────────────────────────────────────────────────

function ProviderUtilRow({
  label,
  tokens,
  context,
  color,
}: {
  label: string;
  tokens: number;
  context: number;
  color: string;
}) {
  const pct = context > 0 ? Math.min(100, Math.round((tokens / context) * 100)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
      <span
        style={{
          ...UI,
          fontSize: "10px",
          color: C.text4,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <div
          style={{
            flex: 1,
            height: 3,
            background: C.border0,
            position: "relative",
            overflow: "hidden",
            borderRadius: 1,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${pct}%`,
              background: color,
              borderRadius: 1,
              transition: "width 0.4s ease",
            }}
          />
        </div>
        <span style={{ ...MONO, fontSize: "10px", color: C.text4, flexShrink: 0 }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ─── Visibility pane ──────────────────────────────────────────────────────────

interface VisibilityPaneProps {
  onCollapse: () => void;
  data?: VisibilityData | null;
}

export function VisibilityPane({ onCollapse, data }: VisibilityPaneProps) {
  const [activeTab, setActiveTab] = useState<Tab>("request");

  const GLOBAL_UTILIZATION = {
    openai: 325000,
    anthropic: 321000,
    openrouter: 330000,
    context: 400000,
  };

  const PROVIDER_TOKENS = [
    { label: "OpenAI", tokens: GLOBAL_UTILIZATION.openai, context: GLOBAL_UTILIZATION.context, color: C.accent },
    { label: "Anthropic", tokens: GLOBAL_UTILIZATION.anthropic, context: GLOBAL_UTILIZATION.context, color: "#a78bfa" },
    { label: "OpenRouter", tokens: GLOBAL_UTILIZATION.openrouter, context: GLOBAL_UTILIZATION.context, color: "#34d399" },
  ];

  function renderTabContent() {
    if (activeTab === "config") return <ConfigTab />;

    if (!data) {
      return (
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <span style={{ ...UI, fontSize: "12px", color: C.text4 }}>
            Click "Inspect" on an assistant message to view its internals
          </span>
        </div>
      );
    }

    switch (activeTab) {
      case "request": return <RequestTab data={data} />;
      case "response": return <ResponseTab data={data} />;
      case "tokens": return <TokensTab data={data} />;
      case "reasoning": return <ReasoningTab data={data} />;
      case "summary": return <SummaryTab data={data} />;
      case "tools": return <ToolsTab data={data} />;
    }
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bg1,
        overflow: "hidden",
      }}
    >
      {/* ── Pane header */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: `1px solid ${C.border0}`,
          background: C.bg1,
          display: "flex",
          alignItems: "center",
          padding: "0 10px 0 14px",
          height: 34,
          gap: 6,
        }}
      >
        <span
          style={{
            ...UI,
            fontSize: "11px",
            color: C.text3,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontWeight: 500,
            flex: 1,
          }}
        >
          Visibility
          {data && (
            <span style={{ color: C.text4, marginLeft: 8, ...MONO, fontSize: "10px" }}>
              {data.message_id}
            </span>
          )}
        </span>

        <button
          onClick={onCollapse}
          title="Collapse visibility pane"
          className="flex items-center justify-center rounded transition-colors"
          style={{ width: 26, height: 26, border: "1px solid transparent" }}
          onMouseEnter={e => { e.currentTarget.style.background = C.bg3; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          <PanelRight style={{ width: 13, height: 13, color: C.text3 }} />
        </button>
      </div>

      {/* ── Tabs */}
      <div
        style={{
          flexShrink: 0,
          display: "flex",
          borderBottom: `1px solid ${C.border0}`,
          background: C.bg0,
          overflow: "hidden",
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                ...UI,
                fontSize: "11px",
                fontWeight: isActive ? 500 : 400,
                padding: "7px 12px",
                color: isActive ? C.text0 : C.text3,
                background: isActive ? C.bg1 : "transparent",
                borderBottom: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                letterSpacing: "0.02em",
                cursor: "pointer",
                transition: "color 0.15s, background 0.15s",
                flexShrink: 0,
                textTransform: "capitalize",
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = C.text1;
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = C.text3;
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* ── Tab content */}
      <div
        style={{
          flex: 1,
          background: C.bg1,
          overflow: "auto",
          scrollbarWidth: "none",
        }}
      >
        {renderTabContent()}
      </div>

      {/* ── Footer: provider utilization */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.border0}`,
          background: C.bg2,
          padding: "8px 14px 10px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 5,
        }}
      >
        <span
          style={{
            ...UI,
            fontSize: "9px",
            color: C.text4,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Token Utilization
        </span>

        <div style={{ display: "flex", gap: 12 }}>
          {PROVIDER_TOKENS.map((p) => (
            <ProviderUtilRow
              key={p.label}
              label={p.label}
              tokens={p.tokens}
              context={p.context}
              color={p.color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}