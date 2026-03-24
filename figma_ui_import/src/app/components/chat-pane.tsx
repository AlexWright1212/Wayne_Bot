import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  Brain,
  FileText,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolStep {
  label: string;
  status: "complete" | "running" | "pending";
}

interface ToolExecutionDisplay {
  type: "tool_execution";
  collapsed_text: string;
  expanded_steps: ToolStep[];
}

interface ReasoningDisplay {
  type: "reasoning";
  collapsed_text: string;
  expanded_text: string;
}

interface SummaryDisplay {
  type: "summary";
  collapsed_text: string;
  expanded_text: string;
}

type InlineDisplay = ToolExecutionDisplay | ReasoningDisplay | SummaryDisplay;

interface MessageFooter {
  model: string;
  provider: string;
  reasoning_level: string;
  output_tokens: string;
}

interface UserMessage {
  id: string;
  role: "user";
  content: string;
  created_at: string;
}

interface AssistantMessage {
  id: string;
  role: "assistant";
  content: string;
  inline_display?: InlineDisplay;
  footer: MessageFooter;
  created_at: string;
}

type Message = UserMessage | AssistantMessage;

// ─── Data ────────────────────────────────────────────────────────────────────

const MESSAGES: Message[] = [
  {
    id: "msg-u1",
    role: "user",
    content:
      "I'm building out Soulware and want to add some data visualization for mood tracking. Can you search the latest shadcn/ui docs for their new chart components?",
    created_at: "2026-03-23T19:30:00Z",
  },
  {
    id: "msg-a1",
    role: "assistant",
    content:
      "Based on the latest documentation, shadcn/ui recently introduced a comprehensive `Chart` block built on top of Recharts. It uses a combination of CSS variables for theming and a central `<ChartContainer>` component to manage context.\n\nTo get started, you'll want to use the CLI: `npx shadcn-ui@latest add chart`.",
    inline_display: {
      type: "tool_execution",
      collapsed_text: "Searched the web — 4 steps",
      expanded_steps: [
        { label: "Generating search queries", status: "complete" },
        { label: "Searching",                 status: "complete" },
        { label: "Filtering results",         status: "complete" },
        { label: "Checking coverage",         status: "complete" },
      ],
    },
    footer: {
      model: "GPT-5",
      provider: "OpenAI",
      reasoning_level: "none",
      output_tokens: "340 tokens",
    },
    created_at: "2026-03-23T19:30:15Z",
  },
  {
    id: "msg-u2",
    role: "user",
    content:
      "How should I structure the React components for a multi-line chart comparing different spreadsheet metrics?",
    created_at: "2026-03-23T19:35:00Z",
  },
  {
    id: "msg-a2",
    role: "assistant",
    content:
      'For a multi-line chart handling complex spreadsheet data, you should separate your data transformation logic from your presentation components.\n\n```tsx\nimport { Line, LineChart, XAxis, YAxis } from "recharts"\nimport { ChartContainer, ChartTooltip } from "@/components/ui/chart"\n\n// Architecture details follow...\n```\n\nKeep your `<ChartConfig>` defined outside the render loop to prevent unnecessary re-renders when swapping dataset views.',
    inline_display: {
      type: "reasoning",
      collapsed_text: "Thinking...",
      expanded_text:
        "The user is asking for architectural advice on building a multi-line chart with shadcn/ui and Recharts, specifically for spreadsheet data.\n\nFirst, I need to consider how `ChartContainer` manages the `ChartConfig`. If the spreadsheet has dynamic columns, the config object needs to be generated dynamically, not hardcoded.\n\nSecond, Recharts expects a flat array of objects. A spreadsheet export might be row-based or column-based. I should advise them on normalizing the data first.\n\nLet's write out a clean wrapper component that takes the raw data, formats it, and maps over the keys to generate `<Line>` components dynamically. I'll make sure to mention memoization to avoid performance hits with large datasets.",
    },
    footer: {
      model: "GPT-5",
      provider: "OpenAI",
      reasoning_level: "high",
      output_tokens: "412 tokens",
    },
    created_at: "2026-03-23T19:35:45Z",
  },
  {
    id: "msg-u3",
    role: "user",
    content:
      "Actually, I want the ability to reference past conversations where we built the data pipeline. Here is the massive 30,000-line JSON export of our spreadsheet schema: [Pretend massive JSON string here]. Can you adapt the chart config for this?",
    created_at: "2026-03-23T19:40:00Z",
  },
  {
    id: "msg-a3",
    role: "assistant",
    content:
      "I've reviewed the massive schema dump. To adapt the `ChartConfig` for this structure, we need to dynamically map the keys from your `pipeline_output` array into the Recharts `<Line>` components.\n\nHere is how you parse that specific JSON structure into the required format...",
    inline_display: {
      type: "summary",
      collapsed_text: "Chat summarized",
      expanded_text:
        "The user is building an app called Soulware and requested documentation on shadcn/ui chart components. Wayne provided the CLI install commands and structural advice for handling dynamic spreadsheet data.",
    },
    footer: {
      model: "GPT-5",
      provider: "OpenAI",
      reasoning_level: "none",
      output_tokens: "280 tokens",
    },
    created_at: "2026-03-23T19:45:00Z",
  },
];

// ─── Style constants ─────────────────────────────────────────────────────────

const UI: React.CSSProperties = { fontFamily: "'Inter', system-ui, sans-serif" };
const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

const C = {
  bg0: "#181818",
  bg1: "#1e1e1e",
  bg2: "#252526",
  bg3: "#2d2d30",
  border0: "#2b2b2b",
  border1: "#333",
  text0: "#e0e0e0",
  text1: "#ababab",
  text2: "#777",
  text3: "#555",
  text4: "#3c3c3c",
  accent: "#4fc1e9",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseInlineContent(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          style={{
            ...MONO,
            fontSize: "11px",
            background: "#1a2636",
            color: "#7ec8e3",
            border: "1px solid #2a3a4a",
            padding: "1px 5px",
            borderRadius: 3,
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return (
      <span key={i}>
        {part.split("\n\n").map((para, pi, arr) => (
          <span key={pi}>
            {para}
            {pi < arr.length - 1 && (
              <>
                <br />
                <br />
              </>
            )}
          </span>
        ))}
      </span>
    );
  });
}

function renderMessageContent(content: string): React.ReactNode {
  const segments = content.split(/(```[\w]*\n[\s\S]*?```)/g);
  return segments.map((seg, i) => {
    const fenceMatch = seg.match(/^```([\w]*)\n([\s\S]*?)```$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "code";
      const code = fenceMatch[2];
      return (
        <div key={i} style={{ margin: "10px 0" }}>
          <div
            style={{
              ...MONO,
              fontSize: "10px",
              color: C.text3,
              background: "#1a1d23",
              border: `1px solid ${C.border0}`,
              borderBottom: "none",
              padding: "5px 10px",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              borderRadius: "4px 4px 0 0",
            }}
          >
            {lang}
          </div>
          <pre
            style={{
              ...MONO,
              fontSize: "11px",
              color: "#a8c4e0",
              background: "#0f1218",
              border: `1px solid ${C.border0}`,
              borderTop: "none",
              padding: "10px 12px",
              margin: 0,
              overflowX: "auto",
              lineHeight: "1.6",
              whiteSpace: "pre",
              borderRadius: "0 0 4px 4px",
            }}
          >
            {code}
          </pre>
        </div>
      );
    }
    return <span key={i}>{parseInlineContent(seg)}</span>;
  });
}

// ─── Step icon ───────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: ToolStep["status"] }) {
  if (status === "complete") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: "50%",
          background: "#162b1e",
          border: "1px solid #2a5a3a",
          flexShrink: 0,
        }}
      >
        <Check style={{ width: 8, height: 8, color: "#4ade80" }} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        className="animate-spin"
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          border: `1.5px solid ${C.border0}`,
          borderTopColor: C.accent,
          borderRadius: "50%",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        border: `1.5px solid ${C.border0}`,
        borderRadius: "50%",
        flexShrink: 0,
      }}
    />
  );
}

// ─── Collapsible shell ────────────────────────────────────────────────────────

function CollapsibleShell({
  icon,
  label,
  accent = C.text3,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode;
  label: string;
  accent?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        border: `1px solid ${C.border0}`,
        background: C.bg1,
        marginBottom: 8,
        borderRadius: 4,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors text-left"
        style={{ borderRadius: 4 }}
        onMouseEnter={e => { e.currentTarget.style.background = C.bg3; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ color: accent, display: "flex", flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, ...UI, fontSize: "12px", color: C.text2, fontWeight: 400 }}>{label}</span>
        {open ? (
          <ChevronDown style={{ width: 11, height: 11, color: C.text4 }} />
        ) : (
          <ChevronRight style={{ width: 11, height: 11, color: C.text4 }} />
        )}
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${C.border0}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

function ToolExecutionBlock({ block }: { block: ToolExecutionDisplay }) {
  return (
    <CollapsibleShell
      icon={<Globe style={{ width: 12, height: 12 }} />}
      label={block.collapsed_text}
      accent="#5a9aad"
    >
      <div style={{ padding: "10px 12px 12px 12px" }}>
        <div className="flex flex-col gap-2.5">
          {block.expanded_steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2.5" style={{ paddingLeft: 2 }}>
              <StepIcon status={step.status} />
              <span
                style={{
                  ...UI,
                  fontSize: "12px",
                  color: step.status === "complete" ? C.text2 : C.text1,
                }}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleShell>
  );
}

function ReasoningBlock({ block }: { block: ReasoningDisplay }) {
  return (
    <CollapsibleShell
      icon={<Brain style={{ width: 12, height: 12 }} />}
      label={block.collapsed_text}
      accent="#8a6aaa"
    >
      <div
        style={{
          padding: "10px 14px 12px 14px",
          ...UI,
          fontSize: "12px",
          color: C.text2,
          lineHeight: "1.65",
          borderLeft: "2px solid #2a1e3a",
          margin: "8px 12px 10px 14px",
        }}
      >
        {block.expanded_text.split("\n\n").map((p, i) => (
          <p key={i} style={{ margin: 0, marginBottom: i < block.expanded_text.split("\n\n").length - 1 ? 8 : 0 }}>
            {parseInlineContent(p)}
          </p>
        ))}
      </div>
    </CollapsibleShell>
  );
}

function SummaryBlock({ block }: { block: SummaryDisplay }) {
  return (
    <CollapsibleShell
      icon={<FileText style={{ width: 12, height: 12 }} />}
      label={block.collapsed_text}
      accent="#5a8a5a"
    >
      <div
        style={{
          padding: "10px 14px 12px 14px",
          ...UI,
          fontSize: "12px",
          color: C.text2,
          lineHeight: "1.65",
          fontStyle: "italic",
        }}
      >
        {block.expanded_text}
      </div>
    </CollapsibleShell>
  );
}

function InlineDisplayBlock({ display }: { display: InlineDisplay }) {
  if (display.type === "tool_execution") return <ToolExecutionBlock block={display} />;
  if (display.type === "reasoning")     return <ReasoningBlock block={display} />;
  if (display.type === "summary")       return <SummaryBlock block={display} />;
  return null;
}

// ─── User message ─────────────────────────────────────────────────────────────

function UserMessageRow({ msg, alignRight }: { msg: UserMessage; alignRight?: boolean }) {
  return (
    <div
      className="flex px-5 py-3.5"
      style={{ justifyContent: alignRight ? "flex-end" : "center" }}
    >
      <div style={{ maxWidth: 560 }}>
        <div
          style={{
            background: C.bg0,
            border: `1px solid ${C.border0}`,
            padding: "10px 14px",
            borderRadius: 6,
            ...UI,
            fontSize: "13px",
            color: C.text0,
            lineHeight: "1.6",
          }}
        >
          {msg.content}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 4,
            ...MONO,
            fontSize: "10px",
            color: C.text4,
          }}
        >
          {formatTime(msg.created_at)}
        </div>
      </div>
    </div>
  );
}

// ─── Assistant message ─────────────────────────────────────────────────��──────

function AssistantMessageRow({
  msg,
  onInspect,
}: {
  msg: AssistantMessage;
  onInspect: (id: string) => void;
}) {
  const showReasoning = msg.footer.reasoning_level && msg.footer.reasoning_level !== "none";

  return (
    <div
      style={{
        borderBottom: `1px solid ${C.border0}`,
        padding: "14px 20px",
      }}
    >
      {msg.inline_display && <InlineDisplayBlock display={msg.inline_display} />}

      <div
        style={{
          ...UI,
          fontSize: "13px",
          color: "#c8c8c8",
          lineHeight: "1.7",
          marginBottom: 14,
        }}
      >
        {renderMessageContent(msg.content)}
      </div>

      <div
        style={{
          borderTop: `1px solid ${C.border0}`,
          paddingTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {[
            msg.footer.model,
            msg.footer.provider,
            showReasoning ? `reasoning: ${msg.footer.reasoning_level}` : null,
            msg.footer.output_tokens,
          ]
            .filter(Boolean)
            .map((tag, i) => (
              <span
                key={i}
                style={{
                  ...MONO,
                  fontSize: "10px",
                  color: C.text3,
                  background: C.bg0,
                  border: `1px solid ${C.border0}`,
                  padding: "2px 6px",
                  borderRadius: 3,
                  letterSpacing: "0.02em",
                }}
              >
                {tag}
              </span>
            ))}
        </div>

        <button
          onClick={() => onInspect(msg.id)}
          className="flex items-center gap-1.5 flex-shrink-0 rounded px-2 py-1 transition-all"
          title="Inspect message"
          style={{
            border: `1px solid #1e3a4a`,
            background: "rgba(79, 193, 233, 0.06)",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(79, 193, 233, 0.14)";
            e.currentTarget.style.borderColor = "#2a5a72";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(79, 193, 233, 0.06)";
            e.currentTarget.style.borderColor = "#1e3a4a";
          }}
        >
          <ExternalLink style={{ width: 10, height: 10, color: "#4fc1e9" }} />
          <span
            style={{
              ...UI,
              fontSize: "10px",
              color: "#4fc1e9",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            Inspect
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Chat pane ────────────────────────────────────────────────────────────────

export function ChatPane({
  onInspect,
  userAlignRight,
}: {
  onInspect?: (msgId: string) => void;
  userAlignRight?: boolean;
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Pane label */}
      <div
        style={{
          flexShrink: 0,
          borderBottom: `1px solid ${C.border0}`,
          background: C.bg1,
          padding: "6px 16px",
          display: "flex",
          alignItems: "center",
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
          }}
        >
          Thread
        </span>
      </div>

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ background: C.bg1, scrollbarWidth: "none" }}
      >
        {MESSAGES.map((msg) =>
          msg.role === "user" ? (
            <UserMessageRow key={msg.id} msg={msg} alignRight={userAlignRight} />
          ) : (
            <AssistantMessageRow
              key={msg.id}
              msg={msg as AssistantMessage}
              onInspect={onInspect ?? (() => {})}
            />
          )
        )}
        <div style={{ height: 32 }} />
      </div>

      {/* Composer */}
      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${C.border0}`,
          background: C.bg1,
          padding: "10px 14px",
        }}
      >
        <div
          style={{
            border: `1px solid ${C.border0}`,
            background: C.bg0,
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            padding: "8px 10px",
            borderRadius: 6,
          }}
        >
          <textarea
            placeholder="Message Wayne..."
            rows={1}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "none",
              ...UI,
              fontSize: "13px",
              color: C.text1,
              lineHeight: "1.5",
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
          />
          <button
            style={{
              flexShrink: 0,
              background: C.bg2,
              border: `1px solid ${C.border1}`,
              color: C.text2,
              ...UI,
              fontSize: "11px",
              fontWeight: 500,
              padding: "5px 12px",
              cursor: "pointer",
              borderRadius: 4,
              letterSpacing: "0.02em",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}