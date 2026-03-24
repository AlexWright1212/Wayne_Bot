import { useState } from "react";
import { PanelLeft, PanelRight, Plus, ChevronDown } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { ChatPane } from "./chat-pane";
import { VisibilityPane, VISIBILITY_DATA } from "./visibility-pane";

interface Chat {
  id: string;
  title: string;
  subtitle: string;
  timestamp: string;
}

const MOCK_CHATS: Chat[] = [
  { id: "1", title: "API Integration Discussion", subtitle: "Discussed REST endpoints and auth flow...", timestamp: "2h" },
  { id: "2", title: "Database Schema Design", subtitle: "Reviewed user table and relationships...", timestamp: "1d" },
  { id: "3", title: "Authentication Flow", subtitle: "JWT tokens and refresh mechanism...", timestamp: "2d" },
  { id: "4", title: "Performance Optimization", subtitle: "Query optimization and caching strategies...", timestamp: "3d" },
  { id: "5", title: "UI Component Refactor", subtitle: "Button variants and theme updates...", timestamp: "1w" },
];

const PROVIDER_DATA: Record<string, {
  name: string;
  models: {
    id: string;
    name: string;
    context_window: number;
    max_output: number;
    reasoning_levels: string[];
  }[];
}> = {
  openai: {
    name: "OpenAI",
    models: [
      { id: "gpt-5.2",    name: "GPT-5.2",    context_window: 400000, max_output: 128000, reasoning_levels: ["none","low","medium","high","xhigh"] },
      { id: "gpt-5",      name: "GPT-5",      context_window: 400000, max_output: 128000, reasoning_levels: ["none","low","medium","high","xhigh"] },
      { id: "gpt-5-mini", name: "GPT-5 mini", context_window: 400000, max_output: 128000, reasoning_levels: ["none","low","medium","high","xhigh"] },
      { id: "gpt-5-nano", name: "GPT-5 nano", context_window: 400000, max_output: 128000, reasoning_levels: ["none","low","medium","high","xhigh"] },
    ],
  },
  anthropic: {
    name: "Anthropic",
    models: [
      { id: "claude-opus-4-6-20250130",   name: "Claude Opus 4.6",   context_window: 200000, max_output: 8192, reasoning_levels: ["off","low","medium","high","adaptive"] },
      { id: "claude-sonnet-4-6-20250514", name: "Claude Sonnet 4.6", context_window: 200000, max_output: 8192, reasoning_levels: ["off","low","medium","high","adaptive"] },
      { id: "claude-haiku-4-5-20251001",  name: "Claude Haiku 4.5",  context_window: 200000, max_output: 8192, reasoning_levels: ["off","low","medium","high","adaptive"] },
    ],
  },
  openrouter: {
    name: "OpenRouter",
    models: [
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1", context_window: 128000, max_output: 4096, reasoning_levels: [] },
    ],
  },
};

const MOCK_TOTAL_TOKENS = 26_842;

const UI: React.CSSProperties = { fontFamily: "'Inter', system-ui, sans-serif" };
const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

function formatKM(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ─── Colors ────────────────────────────────────────────────────────────────
const C = {
  bg0: "#181818",       // deepest background
  bg1: "#1e1e1e",       // main panels
  bg2: "#252526",       // sidebar / elevated
  bg3: "#2d2d30",       // hover / surface
  border0: "#2b2b2b",   // subtle
  border1: "#3e3e42",   // primary
  text0: "#e0e0e0",     // primary text
  text1: "#ababab",     // secondary
  text2: "#777",        // muted
  text3: "#555",        // dim
  text4: "#3c3c3c",     // very dim
  accent: "#4fc1e9",    // restrained cyan
  accentMuted: "#3a8fb7",
};

// ─── Inline select ─────────────────────────────────────────────────────────
interface HeaderSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

function HeaderSelect({ label, value, onChange, options }: HeaderSelectProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="uppercase tracking-wider"
        style={{ ...UI, fontSize: "10px", color: C.text3, fontWeight: 500 }}
      >
        {label}
      </span>
      <div className="relative flex items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none bg-transparent pr-4 cursor-pointer outline-none border-0"
          style={{ ...MONO, fontSize: "11px", color: C.accent }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} style={{ background: C.bg2, color: C.accent }}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="absolute right-0 pointer-events-none"
          style={{ width: 10, height: 10, color: C.accent }}
        />
      </div>
    </div>
  );
}

// ─── Stat block ────────────────────────────────────────────────────────────
function StatBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span
        className="uppercase tracking-wider"
        style={{ ...UI, fontSize: "10px", color: C.text4, fontWeight: 500 }}
      >
        {label}
      </span>
      <div style={MONO}>{value}</div>
    </div>
  );
}

// ─── Main layout ───────────────────────────────────────────────────────────
export function ChatLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [visibilityCollapsed, setVisibilityCollapsed] = useState(true);
  const [inspectedMessageId, setInspectedMessageId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [selectedModelId, setSelectedModelId]   = useState("gpt-5");
  const [selectedReasoning, setSelectedReasoning] = useState("high");

  const navigate = useNavigate();
  const { id: chatId } = useParams();

  const providerData   = PROVIDER_DATA[selectedProvider];
  const currentModel   = providerData.models.find((m) => m.id === selectedModelId) ?? providerData.models[0];
  const utilization    = Math.min(100, Math.round((MOCK_TOTAL_TOKENS / currentModel.context_window) * 100));
  const currentChat    = MOCK_CHATS.find((c) => c.id === chatId);
  const chatTitle      = currentChat ? currentChat.title : "New Conversation";

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    const firstModel = PROVIDER_DATA[provider].models[0];
    setSelectedModelId(firstModel.id);
    setSelectedReasoning(firstModel.reasoning_levels[0] ?? "");
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    const model = providerData.models.find((m) => m.id === modelId);
    if (model && model.reasoning_levels.length > 0 && !model.reasoning_levels.includes(selectedReasoning)) {
      setSelectedReasoning(model.reasoning_levels[0]);
    }
  };

  const handleInspect = (msgId: string) => {
    setInspectedMessageId(msgId);
    setVisibilityCollapsed(false);
  };

  const providerOptions  = Object.entries(PROVIDER_DATA).map(([k, v]) => ({ value: k, label: v.name }));
  const modelOptions     = providerData.models.map((m) => ({ value: m.id, label: m.name }));
  const reasoningOptions = currentModel.reasoning_levels.map((r) => ({
    value: r,
    label: r.charAt(0).toUpperCase() + r.slice(1),
  }));

  return (
    <div
      className="dark h-screen w-screen flex overflow-hidden"
      style={{ ...UI, background: C.bg0, color: C.text0 }}
    >
      {/* ── Left Sidebar ─────────────────────────────────────────────── */}
      <div
        className={`flex-shrink-0 transition-all duration-200 ${
          sidebarCollapsed ? "w-0" : "w-56"
        }`}
        style={{ background: C.bg2, borderRight: `1px solid ${C.border0}` }}
      >
        <div className={`h-full flex flex-col ${sidebarCollapsed ? "hidden" : ""}`}>
          {/* Sidebar header */}
          <div
            className="px-2.5 pt-2.5 pb-2 flex items-center gap-2"
            style={{ borderBottom: `1px solid ${C.border0}` }}
          >
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="p-1.5 rounded transition-colors flex-shrink-0"
              style={{ color: C.text3 }}
              onMouseEnter={e => { e.currentTarget.style.background = C.bg3; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              title="Collapse sidebar"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigate("/")}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded transition-colors"
              style={{ border: `1px solid ${C.border0}` }}
              onMouseEnter={e => { e.currentTarget.style.background = C.bg3; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <Plus className="w-3 h-3" style={{ color: C.text3 }} />
              <span style={{ ...UI, fontSize: "12px", color: C.text2, fontWeight: 500 }}>New Chat</span>
            </button>
          </div>

          {/* Chat list */}
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
            <div
              className="px-3 py-2"
              style={{ ...UI, fontSize: "10px", color: C.text4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}
            >
              Chats
            </div>
            {MOCK_CHATS.map((chat) => {
              const isActive = chatId === chat.id;
              return (
                <button
                  key={chat.id}
                  onClick={() => navigate(`/chat/${chat.id}`)}
                  className="w-full px-3 py-2 transition-colors text-left"
                  style={{
                    background: isActive ? C.bg3 : "transparent",
                    borderLeft: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.bg1; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate"
                        style={{ ...UI, fontSize: "12px", color: isActive ? C.text0 : C.text1, fontWeight: 400, lineHeight: "1.4" }}
                      >
                        {chat.title}
                      </div>
                      <div
                        className="mt-0.5 truncate"
                        style={{ ...UI, fontSize: "11px", color: C.text3, lineHeight: "1.3" }}
                      >
                        {chat.subtitle}
                      </div>
                    </div>
                    <div style={{ ...MONO, fontSize: "10px", color: C.text4, flexShrink: 0, marginTop: 1 }}>
                      {chat.timestamp}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Header ───────────────────────────────────────────── */}
        <div
          className="flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.border0}`, background: C.bg1 }}
        >
          <div className="flex items-stretch">

            {sidebarCollapsed && (
              <div className="flex items-center pl-3 pr-2" style={{ borderRight: `1px solid ${C.border0}` }}>
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="p-1.5 rounded transition-colors"
                  style={{ color: C.text3 }}
                  onMouseEnter={e => { e.currentTarget.style.background = C.bg3; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  title="Expand sidebar"
                >
                  <PanelLeft className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Left: title + dropdowns */}
            <div className="flex-1 flex flex-col justify-center px-4 py-2.5 gap-1.5 min-w-0">
              <div className="flex items-baseline gap-3">
                <span style={{ ...UI, fontSize: "13px", fontWeight: 600, color: C.text0, letterSpacing: "0.02em" }}>
                  Wayne
                </span>
                <span
                  className="truncate"
                  style={{ ...UI, fontSize: "12px", color: C.text2 }}
                >
                  {chatTitle}
                </span>
              </div>

              <div className="flex items-center gap-5 flex-wrap">
                <HeaderSelect label="Provider" value={selectedProvider} onChange={handleProviderChange} options={providerOptions} />
                <HeaderSelect label="Model" value={selectedModelId} onChange={handleModelChange} options={modelOptions} />
                {currentModel.reasoning_levels.length > 0 && (
                  <HeaderSelect label="Reasoning" value={selectedReasoning} onChange={setSelectedReasoning} options={reasoningOptions} />
                )}
              </div>
            </div>

            {/* Right: Stats */}
            <div
              className="flex items-center px-4 gap-4 flex-shrink-0"
              style={{ borderLeft: `1px solid ${C.border0}` }}
            >
              <StatBlock
                label="Context"
                value={
                  <span style={{ fontSize: "12px", color: C.text1 }}>
                    {formatKM(currentModel.context_window)}
                  </span>
                }
              />
              <div style={{ width: 1, height: 20, background: C.border0 }} />
              <StatBlock
                label="Max Out"
                value={
                  <span style={{ fontSize: "12px", color: C.text1 }}>
                    {formatKM(currentModel.max_output)}
                  </span>
                }
              />
              <div style={{ width: 1, height: 20, background: C.border0 }} />
              <StatBlock
                label="Tokens"
                value={
                  <span style={{ fontSize: "13px", color: C.text0, letterSpacing: "0.02em" }}>
                    {MOCK_TOTAL_TOKENS.toLocaleString()}
                  </span>
                }
              />
              <div style={{ width: 1, height: 20, background: C.border0 }} />
              <StatBlock
                label="Util"
                value={
                  <div className="flex items-center gap-2">
                    <div style={{ width: 64, height: 3, background: C.border0, borderRadius: 1, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${utilization}%`, background: C.accent, borderRadius: 1, transition: "width 0.3s ease" }} />
                    </div>
                    <span style={{ fontSize: "11px", color: C.text2 }}>{utilization}%</span>
                  </div>
                }
              />

              {visibilityCollapsed && (
                <>
                  <div style={{ width: 1, height: 20, background: C.border0 }} />
                  <button
                    onClick={() => setVisibilityCollapsed(false)}
                    title="Expand visibility pane"
                    className="p-1.5 rounded transition-colors"
                    style={{ color: C.text3 }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.bg3; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <PanelRight className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Split View ───────────────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0">
          <div
            className="overflow-hidden"
            style={{ flex: 1, minWidth: 0, background: C.bg0, borderRight: `1px solid ${C.border0}` }}
          >
            <ChatPane onInspect={handleInspect} userAlignRight={true} />
          </div>

          {!visibilityCollapsed && (
            <div style={{ width: "50%", flexShrink: 0, background: C.bg1 }} className="overflow-hidden">
              <VisibilityPane
                onCollapse={() => setVisibilityCollapsed(true)}
                data={inspectedMessageId ? VISIBILITY_DATA[inspectedMessageId] ?? null : null}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}