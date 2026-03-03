# Wayne v1 â€” Unit FE: Frontend Implementation Plan

**File:** `plans/v1_07_frontend.md`
**Spec Reference:** Â§2.2, Â§2.3, Â§3.1, Â§4.5, Â§6.3, Â§8, Â§11.6
**Dependencies:** Unit BE must expose all REST endpoints and the WebSocket channel before full integration testing is possible. The frontend can be scaffolded, component-built, and store-wired against mocked data before BE is ready.

---

## 0. Assumptions and Constraints

- Node.js 20+ is required (per spec Â§14.1).
- The frontend lives at `src/frontend/` relative to the project root.
- Vite dev server proxies `/api` and `/ws` to the FastAPI backend at `localhost:8000` during development.
- Dark theme only; no light/dark toggle required (personal tool, Â§1.2 â€” mobile out of scope).
- All model names referenced in UI code must match `docs/llm_models_reference.md`: GPT-5.2, GPT-5, GPT-5 mini, GPT-5 nano; Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5; DeepSeek V3.2, DeepSeek R1.
- shadcn/ui components are copied into `src/frontend/src/components/ui/` â€” they are not imported from node_modules.

---

## 1. Project Scaffolding

This phase produces a running Vite dev server with Tailwind and shadcn/ui operational. Nothing functional yet â€” the goal is a correctly configured build foundation.

### 1.1 Initialize the Vite + React + TypeScript Project

**Command (run from project root):**
```
npm create vite@latest src/frontend -- --template react-ts
```

This generates:
- `src/frontend/package.json`
- `src/frontend/tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `src/frontend/vite.config.ts`
- `src/frontend/index.html`
- `src/frontend/src/main.tsx`, `App.tsx`, `index.css`

### 1.2 Install Core Dependencies

```
cd src/frontend
npm install
npm install tailwindcss @tailwindcss/vite
npm install zustand
npm install react-markdown rehype-highlight
npm install class-variance-authority clsx tailwind-merge
npm install lucide-react
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
npm install @radix-ui/react-scroll-area @radix-ui/react-separator
npm install @radix-ui/react-collapsible @radix-ui/react-tooltip
npm install @radix-ui/react-badge
```

Note: shadcn/ui components themselves are not npm packages â€” they are code-generated into `src/components/ui/`. The Radix primitives above are the peer dependencies that shadcn components rely on.

### 1.3 Configure Tailwind CSS

**`src/frontend/src/index.css`** â€” replace default content:
```css
@import "tailwindcss";
```

**`src/frontend/tailwind.config.ts`** â€” dark mode class strategy, content paths covering all component directories:
```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // CSS custom properties from shadcn/ui convention
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 1.4 Configure Vite

**`src/frontend/vite.config.ts`** â€” add Tailwind plugin and dev proxy:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8000",
        ws: true,
      },
    },
  },
});
```

### 1.5 Initialize CSS Variables for shadcn/ui Dark Theme

In `src/frontend/src/index.css`, after the Tailwind import, add the dark theme CSS variable block. Use shadcn/ui's dark theme defaults with a neutral-zinc palette. The `:root` block defines the dark theme since this is a dark-only app â€” no `.dark` class switching needed:

```css
@import "tailwindcss";

:root {
  --background: 240 10% 3.9%;
  --foreground: 0 0% 98%;
  --card: 240 10% 3.9%;
  --card-foreground: 0 0% 98%;
  --muted: 240 3.7% 15.9%;
  --muted-foreground: 240 5% 64.9%;
  --accent: 240 3.7% 15.9%;
  --accent-foreground: 0 0% 98%;
  --border: 240 3.7% 15.9%;
  --primary: 0 0% 98%;
  --primary-foreground: 240 5.9% 10%;
  --secondary: 240 3.7% 15.9%;
  --secondary-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --radius: 0.5rem;
}

* {
  border-color: hsl(var(--border));
}

body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
}
```

### 1.6 Add shadcn/ui Utility Library

**`src/frontend/src/lib/utils.ts`** â€” the standard `cn()` helper used by all shadcn components:
```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 1.7 Copy in shadcn/ui Components

Use the shadcn CLI or copy components manually into `src/frontend/src/components/ui/`. Required components for this project:

```
src/frontend/src/components/ui/
â”œâ”€â”€ button.tsx
â”œâ”€â”€ input.tsx
â”œâ”€â”€ scroll-area.tsx
â”œâ”€â”€ dropdown-menu.tsx
â”œâ”€â”€ separator.tsx
â”œâ”€â”€ badge.tsx
â”œâ”€â”€ collapsible.tsx
â”œâ”€â”€ tooltip.tsx
â”œâ”€â”€ sheet.tsx          (for the visibility panel right drawer)
â”œâ”€â”€ dialog.tsx         (for rename confirmation dialog)
â””â”€â”€ skeleton.tsx       (for loading states)
```

Each shadcn component uses the standard pattern: Radix primitive wrapped with `cn()` and `class-variance-authority` for variant management. They import from `@/lib/utils` using the `@` alias configured in Vite.

### 1.8 Configure tsconfig Paths

**`src/frontend/tsconfig.app.json`** â€” ensure `@` alias is recognized by TypeScript:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

Also install the types package: `npm install -D @types/node`

**Checkpoint:** `npm run dev` should start the Vite server with a blank dark-background page and no console errors.

---

## 2. Type Definitions

All shared TypeScript types are defined in one file before any store or component is written. This prevents circular import issues and provides a single reference point during development.

**`src/frontend/src/lib/types.ts`**

```ts
// â”€â”€â”€ Provider & Model Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type Provider = "openai" | "anthropic" | "openrouter";

export type ReasoningLevel =
  // OpenAI levels (Â§3.1)
  | "none" | "low" | "medium" | "high" | "xhigh"
  // Anthropic levels (Â§3.1)
  | "off" | "adaptive";
  // Note: OpenAI uses none/low/medium/high/xhigh
  //       Anthropic uses off/low/medium/high/adaptive
  //       OpenRouter: depends on model â€” DeepSeek R1 always-on, V3.2 no reasoning

export interface Model {
  id: string;                    // e.g. "gpt-5", "claude-opus-4-6-20250130"
  name: string;                  // Display name: "GPT-5", "Claude Opus 4.6"
  provider: Provider;
  context_window: number;        // tokens
  supports_reasoning: boolean;
  supports_tools: boolean;
  reasoning_levels: ReasoningLevel[];  // Available levels for this model
  is_available: boolean;         // false if provider key is missing (Â§11.1)
}

export interface ProviderGroup {
  provider: Provider;
  label: string;                 // "OpenAI", "Anthropic", "OpenRouter"
  key_configured: boolean;       // checkmark vs warning (Â§11.1)
  models: Model[];
}

export interface ModelsResponse {
  providers: ProviderGroup[];
}

// â”€â”€â”€ Message Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type MessageRole = "user" | "assistant" | "tool_call" | "tool_result" | "summary";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;               // text or JSON string for tool_call/tool_result
  timestamp: string;             // ISO 8601
  model_id?: string;             // assistant messages only
  provider?: Provider;           // assistant messages only
  reasoning_level?: ReasoningLevel; // assistant messages only
  tool_name?: string;            // tool_call/tool_result messages
  has_visibility?: boolean;      // true if visibility record exists for this message
}

// â”€â”€â”€ Conversation Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at: string;
  last_model_id?: string;
  last_provider?: Provider;
}

export interface Conversation extends ConversationSummary {
  created_at: string;
  messages: Message[];
}

// â”€â”€â”€ Token Count Types (Â§4.5) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface TokenCounts {
  openai_tiktoken: number;          // tiktoken count
  anthropic_count_tokens: number;   // SDK API count
  openrouter_heuristic: number;     // chars / 3.5
  output_tokens?: number;           // from API response metadata
  active_provider: Provider;        // which count to use for utilization
  active_model_context_window: number;
  utilization_fraction: number;     // active_count / context_window
  utilization_percent: number;      // 0â€“100
}

// â”€â”€â”€ Visibility Types (Â§6.2, Â§6.3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ApiPayload {
  messages: unknown[];           // full messages array sent to LLM
  model: string;
  provider: Provider;
  parameters: Record<string, unknown>; // temp, max_tokens, reasoning settings, etc.
  response_metadata: {
    finish_reason: string;
    usage: Record<string, number>;
  };
}

export interface SummaryEvent {
  triggered_by_message_id: string;
  messages_summarized: { role: string; content: string }[];
  summary_text: string;
  tokens_before: number;
  tokens_after: number;
}

export interface ToolStep {
  step_name: string;             // "query_generation", "search_round_1", etc.
  status: "running" | "complete" | "error";
  input: unknown;
  output: unknown;
  duration_ms?: number;
  timestamp: string;
}

export interface ToolTrace {
  tool_name: string;
  arguments: Record<string, string>;  // reason, query
  steps: ToolStep[];
  total_duration_ms?: number;
}

export interface VisibilityRecord {
  message_id: string;
  api_payload: ApiPayload;
  token_counts: TokenCounts;
  reasoning_content?: string;    // null if model has no reasoning
  summary_event?: SummaryEvent;  // null if no summary was triggered
  tool_trace?: ToolTrace;        // null if no tool was called
}

// â”€â”€â”€ WebSocket Message Types (Â§8) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type WsClientMessage = {
  type: "send_message";
  content: string;
  model_id: string;
  provider: Provider;
  reasoning_level: ReasoningLevel;
};

export type WsServerMessage =
  | { type: "stream_token"; token: string }
  | { type: "stream_reasoning"; token: string }
  | { type: "tool_call_start"; tool_name: string; arguments: Record<string, string> }
  | { type: "tool_step"; step: ToolStep }
  | { type: "stream_done"; message_id: string }
  | { type: "summary_started" }
  | { type: "summary_complete"; event: SummaryEvent }
  | { type: "title_updated"; title: string }
  | { type: "error"; message: string };

// â”€â”€â”€ UI State Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type ConnectionStatus = "connected" | "connecting" | "reconnecting" | "disconnected" | "failed";

export type SearchStep =
  | "generating_queries"
  | "searching"
  | "searching_round_2"
  | "filtering"
  | "checking_coverage"
  | "retrying"
  | "complete";
```

---

## 3. State Management â€” Zustand Stores

Three stores match the spec's conceptual separation of concerns. All stores are written before hooks and components, since hooks depend on them.

### 3.1 Chat Store

**`src/frontend/src/stores/chatStore.ts`**

Manages conversation list, active conversation, messages, streaming state, and search progress.

```ts
import { create } from "zustand";
import type {
  ConversationSummary, Conversation, Message,
  ToolStep, SummaryEvent, ConnectionStatus, SearchStep
} from "@/lib/types";

interface ChatState {
  // Sidebar data
  conversations: ConversationSummary[];
  conversationsLoading: boolean;

  // Active conversation
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  conversationLoading: boolean;

  // Streaming state
  isStreaming: boolean;
  streamingContent: string;         // accumulated tokens
  streamingReasoning: string;       // accumulated reasoning tokens
  isSummarizing: boolean;           // "Compressing conversation history..."

  // Search progress (Â§8.2)
  searchActive: boolean;
  currentSearchStep: SearchStep | null;
  searchSteps: ToolStep[];

  // WebSocket connection
  connectionStatus: ConnectionStatus;

  // Actions
  setConversations: (list: ConversationSummary[]) => void;
  setActiveConversation: (conv: Conversation | null) => void;
  setActiveConversationId: (id: string | null) => void;
  appendStreamToken: (token: string) => void;
  appendReasoningToken: (token: string) => void;
  finalizeStreamedMessage: (message: Message) => void;
  setIsSummarizing: (v: boolean) => void;
  updateSearchStep: (step: ToolStep) => void;
  clearSearchProgress: () => void;
  updateConversationTitle: (id: string, title: string) => void;
  removeConversation: (id: string) => void;
  addConversationToList: (summary: ConversationSummary) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  addMessageToActive: (message: Message) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  conversationsLoading: false,
  activeConversationId: null,
  activeConversation: null,
  conversationLoading: false,
  isStreaming: false,
  streamingContent: "",
  streamingReasoning: "",
  isSummarizing: false,
  searchActive: false,
  currentSearchStep: null,
  searchSteps: [],
  connectionStatus: "disconnected",

  setConversations: (list) => set({ conversations: list }),
  setActiveConversation: (conv) => set({ activeConversation: conv }),
  setActiveConversationId: (id) => set({ activeConversationId: id }),

  appendStreamToken: (token) =>
    set((s) => ({
      isStreaming: true,
      streamingContent: s.streamingContent + token,
    })),

  appendReasoningToken: (token) =>
    set((s) => ({
      streamingReasoning: s.streamingReasoning + token,
    })),

  finalizeStreamedMessage: (message) =>
    set((s) => ({
      isStreaming: false,
      streamingContent: "",
      streamingReasoning: "",
      activeConversation: s.activeConversation
        ? {
            ...s.activeConversation,
            messages: [...s.activeConversation.messages, message],
          }
        : null,
    })),

  setIsSummarizing: (v) => set({ isSummarizing: v }),

  updateSearchStep: (step) =>
    set((s) => {
      const existing = s.searchSteps.findIndex((x) => x.step_name === step.step_name);
      const steps =
        existing >= 0
          ? s.searchSteps.map((x, i) => (i === existing ? step : x))
          : [...s.searchSteps, step];
      return { searchActive: true, currentSearchStep: step.step_name as SearchStep, searchSteps: steps };
    }),

  clearSearchProgress: () =>
    set({ searchActive: false, currentSearchStep: null, searchSteps: [] }),

  updateConversationTitle: (id, title) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title } : c
      ),
      activeConversation:
        s.activeConversation?.id === id
          ? { ...s.activeConversation, title }
          : s.activeConversation,
    })),

  removeConversation: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
      activeConversation: s.activeConversation?.id === id ? null : s.activeConversation,
    })),

  addConversationToList: (summary) =>
    set((s) => ({
      conversations: [summary, ...s.conversations],
    })),

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  addMessageToActive: (message) =>
    set((s) => ({
      activeConversation: s.activeConversation
        ? {
            ...s.activeConversation,
            messages: [...s.activeConversation.messages, message],
          }
        : null,
    })),
}));
```

### 3.2 Model Store

**`src/frontend/src/stores/modelStore.ts`**

Manages available models, selected model, and reasoning level selection.

```ts
import { create } from "zustand";
import type { Model, Provider, ReasoningLevel, ProviderGroup } from "@/lib/types";

interface ModelState {
  providers: ProviderGroup[];
  modelsLoading: boolean;
  modelsError: string | null;

  // Current selection
  selectedProvider: Provider | null;
  selectedModelId: string | null;
  selectedReasoningLevel: ReasoningLevel;

  // Derived
  selectedModel: Model | null;
  availableReasoningLevels: ReasoningLevel[];

  // Actions
  setProviders: (providers: ProviderGroup[]) => void;
  setModelsLoading: (v: boolean) => void;
  setModelsError: (e: string | null) => void;
  selectModel: (provider: Provider, modelId: string) => void;
  setReasoningLevel: (level: ReasoningLevel) => void;
}

export const useModelStore = create<ModelState>((set, get) => ({
  providers: [],
  modelsLoading: false,
  modelsError: null,
  selectedProvider: null,
  selectedModelId: null,
  selectedReasoningLevel: "none",
  selectedModel: null,
  availableReasoningLevels: [],

  setProviders: (providers) => set({ providers }),
  setModelsLoading: (v) => set({ modelsLoading: v }),
  setModelsError: (e) => set({ modelsError: e }),

  selectModel: (provider, modelId) => {
    const { providers } = get();
    const providerGroup = providers.find((p) => p.provider === provider);
    const model = providerGroup?.models.find((m) => m.id === modelId) ?? null;
    const levels = model?.reasoning_levels ?? [];
    const defaultLevel = levels[0] ?? "none";
    set({
      selectedProvider: provider,
      selectedModelId: modelId,
      selectedModel: model,
      availableReasoningLevels: levels,
      selectedReasoningLevel: defaultLevel,
    });
  },

  setReasoningLevel: (level) => set({ selectedReasoningLevel: level }),
}));
```

### 3.3 Visibility Store

**`src/frontend/src/stores/visibilityStore.ts`**

Manages the visibility panel's open/closed state and the currently inspected visibility record.

```ts
import { create } from "zustand";
import type { VisibilityRecord } from "@/lib/types";

interface VisibilityState {
  isOpen: boolean;
  inspectedMessageId: string | null;
  record: VisibilityRecord | null;
  loading: boolean;
  error: string | null;

  openForMessage: (messageId: string) => void;
  close: () => void;
  setRecord: (record: VisibilityRecord | null) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useVisibilityStore = create<VisibilityState>((set) => ({
  isOpen: false,
  inspectedMessageId: null,
  record: null,
  loading: false,
  error: null,

  openForMessage: (messageId) =>
    set({ isOpen: true, inspectedMessageId: messageId, record: null, error: null }),

  close: () =>
    set({ isOpen: false, inspectedMessageId: null, record: null }),

  setRecord: (record) => set({ record }),
  setLoading: (v) => set({ loading: v }),
  setError: (e) => set({ error: e }),
}));
```

---

## 4. API Layer

**`src/frontend/src/lib/api.ts`**

A thin wrapper over the native `fetch` API. All REST interactions go through this module. It is not a hook â€” it is a plain async function library imported by hooks.

```ts
import type {
  Conversation, ConversationSummary, ModelsResponse,
  VisibilityRecord, TokenCounts
} from "@/lib/types";

const BASE = "";  // proxied by Vite dev server; in prod, same origin

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Conversations
export const createConversation = () =>
  request<Conversation>("/conversations", { method: "POST" });

export const listConversations = () =>
  request<ConversationSummary[]>("/conversations");

export const getConversation = (id: string) =>
  request<Conversation>(`/conversations/${id}`);

export const renameConversation = (id: string, title: string) =>
  request<Conversation>(`/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

export const deleteConversation = (id: string) =>
  request<void>(`/conversations/${id}`, { method: "DELETE" });

// Models
export const getModels = () =>
  request<ModelsResponse>("/models");

// Visibility
export const getVisibility = (messageId: string) =>
  request<VisibilityRecord>(`/messages/${messageId}/visibility`);

export const getTokenCounts = (conversationId: string) =>
  request<TokenCounts>(`/conversations/${conversationId}/token-counts`);
```

---

## 5. Custom Hooks

### 5.1 useWebSocket

**`src/frontend/src/hooks/useWebSocket.ts`**

This is the most complex hook. It owns the WebSocket lifecycle, reconnection logic (Â§11.6), and dispatches all incoming server messages to the chat store.

Key behaviors per spec Â§11.6:
- Exponential backoff, up to 3 attempts.
- Shows "Connection lost â€” reconnecting..." during attempts.
- Manual reconnect button after all 3 attempts fail.
- Partial streaming content is preserved on disconnect.

```ts
import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { WsClientMessage, WsServerMessage } from "@/lib/types";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export function useWebSocket(conversationId: string | null) {
  const ws = useRef<WebSocket | null>(null);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    appendStreamToken,
    appendReasoningToken,
    finalizeStreamedMessage,
    setIsSummarizing,
    updateSearchStep,
    clearSearchProgress,
    updateConversationTitle,
    setConnectionStatus,
    addMessageToActive,
  } = useChatStore();

  const handleMessage = useCallback(
    (raw: string) => {
      const msg: WsServerMessage = JSON.parse(raw);

      switch (msg.type) {
        case "stream_token":
          appendStreamToken(msg.token);
          break;

        case "stream_reasoning":
          appendReasoningToken(msg.token);
          break;

        case "tool_call_start":
          // The search progress panel activates
          updateSearchStep({
            step_name: "generating_queries",
            status: "running",
            input: msg.arguments,
            output: null,
            timestamp: new Date().toISOString(),
          });
          break;

        case "tool_step":
          updateSearchStep(msg.step);
          break;

        case "stream_done":
          // Backend sends final assembled message object; fetch it or use the
          // streamed content to construct a provisional message.
          clearSearchProgress();
          // The addMessageToActive call here uses the message_id to signal
          // the chat panel to replace the in-progress streaming bubble with
          // the finalized Message. The full Message is fetched lazily if needed.
          finalizeStreamedMessage({
            id: msg.message_id,
            conversation_id: conversationId ?? "",
            role: "assistant",
            content: useChatStore.getState().streamingContent,
            timestamp: new Date().toISOString(),
            has_visibility: true,
          });
          break;

        case "summary_started":
          setIsSummarizing(true);
          break;

        case "summary_complete":
          setIsSummarizing(false);
          break;

        case "title_updated":
          if (conversationId) {
            updateConversationTitle(conversationId, msg.title);
          }
          break;

        case "error":
          console.error("WS server error:", msg.message);
          // TODO: surface error in UI (separate error toast mechanism)
          break;
      }
    },
    [conversationId, appendStreamToken, appendReasoningToken,
     finalizeStreamedMessage, setIsSummarizing, updateSearchStep,
     clearSearchProgress, updateConversationTitle]
  );

  const connect = useCallback(() => {
    if (!conversationId) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus("connecting");
    const socket = new WebSocket(`ws://${window.location.host}/ws/${conversationId}`);

    socket.onopen = () => {
      retryCount.current = 0;
      setConnectionStatus("connected");
    };

    socket.onmessage = (evt) => handleMessage(evt.data);

    socket.onclose = () => {
      if (retryCount.current < MAX_RETRIES) {
        setConnectionStatus("reconnecting");
        const delay = BASE_DELAY_MS * Math.pow(2, retryCount.current);
        retryCount.current++;
        retryTimer.current = setTimeout(connect, delay);
      } else {
        setConnectionStatus("failed");
      }
    };

    socket.onerror = () => {
      socket.close();
    };

    ws.current = socket;
  }, [conversationId, handleMessage, setConnectionStatus]);

  // Connect when conversationId changes
  useEffect(() => {
    retryCount.current = 0;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    ws.current?.close();
    connect();

    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      ws.current?.close();
    };
  }, [conversationId, connect]);

  const sendMessage = useCallback(
    (payload: WsClientMessage) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify(payload));
      } else {
        console.warn("WebSocket not open, cannot send message");
      }
    },
    []
  );

  const manualReconnect = useCallback(() => {
    retryCount.current = 0;
    connect();
  }, [connect]);

  return { sendMessage, manualReconnect };
}
```

### 5.2 useChat

**`src/frontend/src/hooks/useChat.ts`**

Orchestrates the full "send message" user flow: optimistic UI update, WebSocket send, conversation creation if new.

```ts
import { useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useModelStore } from "@/stores/modelStore";
import { createConversation, listConversations } from "@/lib/api";
import type { WsClientMessage } from "@/lib/types";

export function useChat(sendWsMessage: (msg: WsClientMessage) => void) {
  const {
    activeConversationId,
    addMessageToActive,
    addConversationToList,
  } = useChatStore();

  const { selectedModelId, selectedProvider, selectedReasoningLevel } = useModelStore();

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;
      if (!selectedModelId || !selectedProvider) return;

      let conversationId = activeConversationId;

      // Create conversation if this is a new chat
      if (!conversationId) {
        const newConv = await createConversation();
        conversationId = newConv.id;
        useChatStore.getState().setActiveConversationId(conversationId);
        useChatStore.getState().setActiveConversation(newConv);
        useChatStore.getState().addConversationToList({
          id: newConv.id,
          title: newConv.title,
          updated_at: newConv.updated_at,
        });
      }

      // Optimistic user message
      addMessageToActive({
        id: `optimistic-${Date.now()}`,
        conversation_id: conversationId,
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      });

      // Send via WebSocket
      sendWsMessage({
        type: "send_message",
        content,
        model_id: selectedModelId,
        provider: selectedProvider,
        reasoning_level: selectedReasoningLevel,
      });
    },
    [activeConversationId, selectedModelId, selectedProvider, selectedReasoningLevel,
     addMessageToActive, sendWsMessage]
  );

  return { sendMessage };
}
```

### 5.3 useModels

**`src/frontend/src/hooks/useModels.ts`**

Fetches the model list from `/api/models` on mount and populates the model store. Handles the OpenRouter fetch failure case (Â§11.3).

```ts
import { useEffect } from "react";
import { useModelStore } from "@/stores/modelStore";
import { getModels } from "@/lib/api";

export function useModels() {
  const { setProviders, setModelsLoading, setModelsError, selectModel, providers } =
    useModelStore();

  useEffect(() => {
    setModelsLoading(true);
    getModels()
      .then((data) => {
        setProviders(data.providers);
        setModelsError(null);

        // Auto-select first available model
        for (const group of data.providers) {
          const first = group.models.find((m) => m.is_available);
          if (first) {
            selectModel(group.provider, first.id);
            break;
          }
        }
      })
      .catch((err) => {
        setModelsError(err.message);
      })
      .finally(() => {
        setModelsLoading(false);
      });
  }, []);
}
```

---

## 6. Layout and App Shell

### 6.1 App.tsx

The top-level component. Initializes models, renders the three-column layout, and connects the WebSocket to the active conversation.

**`src/frontend/src/App.tsx`**

```tsx
import { useEffect } from "react";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Header } from "@/components/header/Header";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VisibilityPanel } from "@/components/visibility/VisibilityPanel";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useModels } from "@/hooks/useModels";
import { useChatStore } from "@/stores/chatStore";
import { listConversations } from "@/lib/api";

export default function App() {
  const { activeConversationId, setConversations } = useChatStore();

  // Fetch model list once on mount
  useModels();

  // Fetch conversation list on mount
  useEffect(() => {
    listConversations().then(setConversations).catch(console.error);
  }, []);

  // WebSocket â€” tied to active conversation
  const { sendMessage, manualReconnect } = useWebSocket(activeConversationId);

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Left: fixed sidebar */}
      <Sidebar />

      {/* Center: main area (header + chat) */}
      <div className="flex flex-col flex-1 min-w-0">
        <Header />
        <ChatPanel sendMessage={sendMessage} manualReconnect={manualReconnect} />
      </div>

      {/* Right: visibility drawer (controlled by visibilityStore) */}
      <VisibilityPanel />
    </div>
  );
}
```

---

## 7. Sidebar Components

### 7.1 Sidebar

**`src/frontend/src/components/sidebar/Sidebar.tsx`**

Fixed left panel, ~260px wide. Shows "New Chat" button at top, then a scrollable list of conversations ordered by `updated_at` DESC (order is maintained by the store, which receives the list already sorted from the API).

```tsx
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PlusIcon } from "lucide-react";
import { ConversationItem } from "./ConversationItem";
import { useChatStore } from "@/stores/chatStore";
import { createConversation } from "@/lib/api";

export function Sidebar() {
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    setActiveConversation,
    addConversationToList,
  } = useChatStore();

  const handleNewChat = async () => {
    const conv = await createConversation();
    addConversationToList({ id: conv.id, title: conv.title, updated_at: conv.updated_at });
    setActiveConversationId(conv.id);
    setActiveConversation(conv);
  };

  return (
    <aside className="w-64 shrink-0 border-r border-border flex flex-col h-screen">
      <div className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={handleNewChat}
        >
          <PlusIcon size={16} />
          New Chat
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1 px-2 py-2">
        <div className="flex flex-col gap-0.5">
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              isActive={conv.id === activeConversationId}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
```

### 7.2 ConversationItem

**`src/frontend/src/components/sidebar/ConversationItem.tsx`**

Each conversation row. Shows the title and a hover-revealed actions menu with "Rename" and "Delete". Rename uses an inline edit pattern (not a separate dialog). Delete calls the API immediately.

Key details:
- Active item has a highlighted background.
- Clicking the item loads the conversation (`GET /api/conversations/{id}`).
- The `...` button opens a DropdownMenu with Rename and Delete actions.
- Rename: replaces the title text with an input, pressing Enter or blurring saves via `PATCH /api/conversations/{id}`.
- Delete: calls `DELETE /api/conversations/{id}` then removes from store.

```tsx
import { useState, useRef, useCallback } from "react";
import { MoreHorizontalIcon, PencilIcon, TrashIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
         DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { deleteConversation, renameConversation, getConversation } from "@/lib/api";
import type { ConversationSummary } from "@/lib/types";

interface Props {
  conversation: ConversationSummary;
  isActive: boolean;
}

export function ConversationItem({ conversation, isActive }: Props) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    setActiveConversationId,
    setActiveConversation,
    removeConversation,
    updateConversationTitle,
  } = useChatStore();

  const handleClick = useCallback(async () => {
    if (isRenaming) return;
    setActiveConversationId(conversation.id);
    const full = await getConversation(conversation.id);
    setActiveConversation(full);
  }, [conversation.id, isRenaming]);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameValue.trim()) {
      setRenameValue(conversation.title);
      setIsRenaming(false);
      return;
    }
    await renameConversation(conversation.id, renameValue.trim());
    updateConversationTitle(conversation.id, renameValue.trim());
    setIsRenaming(false);
  }, [conversation.id, renameValue]);

  const handleDelete = useCallback(async () => {
    await deleteConversation(conversation.id);
    removeConversation(conversation.id);
  }, [conversation.id]);

  const startRename = useCallback(() => {
    setRenameValue(conversation.title);
    setIsRenaming(true);
    // Focus happens via useEffect in the input
  }, [conversation.title]);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer",
        "hover:bg-accent transition-colors",
        isActive && "bg-accent"
      )}
      onClick={handleClick}
    >
      {isRenaming ? (
        <input
          ref={inputRef}
          autoFocus
          className="flex-1 bg-transparent outline-none text-sm"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRenameSubmit();
            if (e.key === "Escape") {
              setRenameValue(conversation.title);
              setIsRenaming(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate text-sm">{conversation.title}</span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted",
              isActive && "opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={startRename}>
            <PencilIcon size={14} className="mr-2" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={handleDelete}
          >
            <TrashIcon size={14} className="mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

---

## 8. Header Components

### 8.1 Header

**`src/frontend/src/components/header/Header.tsx`**

Fixed top bar across the main content area. Contains ModelSelector and ReasoningSelector. Also displays the connection status indicator.

```tsx
import { ModelSelector } from "./ModelSelector";
import { ReasoningSelector } from "./ReasoningSelector";
import { ConnectionIndicator } from "./ConnectionIndicator";
import { Separator } from "@/components/ui/separator";

export function Header() {
  return (
    <header className="h-14 border-b border-border flex items-center gap-3 px-4 shrink-0">
      <ModelSelector />
      <Separator orientation="vertical" className="h-6" />
      <ReasoningSelector />
      <div className="ml-auto">
        <ConnectionIndicator />
      </div>
    </header>
  );
}
```

### 8.2 ModelSelector

**`src/frontend/src/components/header/ModelSelector.tsx`**

A DropdownMenu grouping models by provider. Each provider group shows a header with a key-status indicator (checkmark if configured, warning triangle if not). Models with `is_available: false` are shown grayed out.

Provider display order: OpenAI â†’ Anthropic â†’ OpenRouter.

```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
         DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem }
  from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { CheckIcon, AlertTriangleIcon, ChevronDownIcon } from "lucide-react";
import { useModelStore } from "@/stores/modelStore";
import { cn } from "@/lib/utils";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
};

export function ModelSelector() {
  const { providers, selectedModel, selectModel } = useModelStore();

  const displayName = selectedModel?.name ?? "Select model";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-1.5 h-8 text-sm font-medium">
          {displayName}
          <ChevronDownIcon size={14} />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-64" align="start">
        {providers.map((group, i) => (
          <div key={group.provider}>
            {i > 0 && <DropdownMenuSeparator />}

            <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
              {PROVIDER_LABELS[group.provider] ?? group.provider}
              {group.key_configured ? (
                <CheckIcon size={12} className="text-green-500" />
              ) : (
                <AlertTriangleIcon size={12} className="text-yellow-500" />
              )}
            </DropdownMenuLabel>

            {group.models.map((model) => (
              <DropdownMenuItem
                key={model.id}
                disabled={!model.is_available}
                className={cn(
                  "text-sm",
                  !model.is_available && "opacity-40 cursor-not-allowed"
                )}
                onClick={() => selectModel(group.provider, model.id)}
              >
                {model.name}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 8.3 ReasoningSelector

**`src/frontend/src/components/header/ReasoningSelector.tsx`**

Shows reasoning options appropriate to the selected model's provider. Hidden entirely if the model has no reasoning (`reasoning_levels` is empty or contains only `["none"]` / `["off"]`). 

Per spec Â§3.1:
- OpenAI: none, low, medium, high, xhigh
- Anthropic: off, low, medium, high, adaptive
- OpenRouter/DeepSeek R1: always-on (no UI control shown)
- OpenRouter/DeepSeek V3.2: no reasoning (no UI control shown)

```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
         DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { useModelStore } from "@/stores/modelStore";
import { cn } from "@/lib/utils";
import type { ReasoningLevel } from "@/lib/types";

const LEVEL_LABELS: Record<ReasoningLevel, string> = {
  none: "No reasoning",
  off: "Thinking off",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extended",
  adaptive: "Adaptive",
};

export function ReasoningSelector() {
  const {
    availableReasoningLevels,
    selectedReasoningLevel,
    setReasoningLevel,
    selectedModel,
  } = useModelStore();

  // Hide entirely if no reasoning options (DeepSeek V3.2, models without reasoning)
  // or if DeepSeek R1 (always-on, no user control)
  if (!availableReasoningLevels.length) return null;
  if (availableReasoningLevels.length === 1 &&
      (availableReasoningLevels[0] === "none" || availableReasoningLevels[0] === "off")) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-1.5 h-8 text-sm">
          <BrainIcon size={14} />
          {LEVEL_LABELS[selectedReasoningLevel] ?? selectedReasoningLevel}
          <ChevronDownIcon size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {availableReasoningLevels.map((level) => (
          <DropdownMenuItem
            key={level}
            onClick={() => setReasoningLevel(level)}
            className={cn(level === selectedReasoningLevel && "bg-accent")}
          >
            {LEVEL_LABELS[level]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 8.4 ConnectionIndicator

**`src/frontend/src/components/header/ConnectionIndicator.tsx`**

Shows connection status. Hidden when connected. Shows reconnecting or failed states.

```tsx
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chatStore";
import type { ConnectionStatus } from "@/lib/types";

interface Props {
  onManualReconnect?: () => void;
}

export function ConnectionIndicator({ onManualReconnect }: Props) {
  const { connectionStatus } = useChatStore();

  if (connectionStatus === "connected") return null;

  if (connectionStatus === "reconnecting") {
    return (
      <span className="text-xs text-yellow-400 animate-pulse">
        Connection lost â€” reconnecting...
      </span>
    );
  }

  if (connectionStatus === "failed") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-400">Connection failed</span>
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={onManualReconnect}>
          Reconnect
        </Button>
      </div>
    );
  }

  return null;
}
```

Note: `ConnectionIndicator` needs `manualReconnect` passed through. The prop threading goes: `App.tsx` has `manualReconnect` from `useWebSocket` â†’ passes to `ChatPanel` â†’ which also accepts it and passes to `Header`. Alternatively, store the `manualReconnect` callback in the chat store (simpler). The simpler approach: store `manualReconnect` in chatStore as an action slot.

---

## 9. Chat Components

### 9.1 ChatPanel

**`src/frontend/src/components/chat/ChatPanel.tsx`**

The main content area. Fills the remaining vertical space below the header. Contains the message list, search progress indicator (conditionally), summarizing indicator, and the chat input pinned to the bottom.

```tsx
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { StreamingIndicator } from "./StreamingIndicator";
import { SearchProgress } from "@/components/search/SearchProgress";
import { useChatStore } from "@/stores/chatStore";
import { useChat } from "@/hooks/useChat";
import type { WsClientMessage } from "@/lib/types";

interface Props {
  sendMessage: (msg: WsClientMessage) => void;
  manualReconnect: () => void;
}

export function ChatPanel({ sendMessage, manualReconnect }: Props) {
  const {
    activeConversation,
    isStreaming,
    streamingContent,
    streamingReasoning,
    isSummarizing,
    searchActive,
    connectionStatus,
  } = useChatStore();

  const { sendMessage: handleSend } = useChat(sendMessage);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="max-w-3xl mx-auto space-y-6">
          {!activeConversation && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm pt-24">
              Select a conversation or start a new chat.
            </div>
          )}

          {activeConversation && (
            <MessageList
              messages={activeConversation.messages}
              isStreaming={isStreaming}
              streamingContent={streamingContent}
              streamingReasoning={streamingReasoning}
            />
          )}

          {isSummarizing && (
            <div className="text-xs text-muted-foreground italic flex items-center gap-2">
              <span className="animate-spin">âŸ³</span>
              Compressing conversation history...
            </div>
          )}

          {searchActive && <SearchProgress />}

          {isStreaming && !searchActive && (
            <StreamingIndicator content={streamingContent} />
          )}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            onSend={handleSend}
            disabled={isStreaming || isSummarizing || connectionStatus !== "connected"}
          />
        </div>
      </div>
    </div>
  );
}
```

### 9.2 MessageList

**`src/frontend/src/components/chat/MessageList.tsx`**

Renders the full message list. Filters out `tool_call` and `tool_result` messages (not shown in the chat per Â§5.4). `summary` role messages are also not shown inline (Â§4.6).

```tsx
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";
import type { Message } from "@/lib/types";

interface Props {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
  streamingReasoning: string;
}

// Roles visible in the chat panel (Â§5.4, Â§4.6)
const VISIBLE_ROLES = new Set(["user", "assistant"]);

export function MessageList({ messages, isStreaming, streamingContent, streamingReasoning }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, streamingContent]);

  const visible = messages.filter((m) => VISIBLE_ROLES.has(m.role));

  return (
    <div className="space-y-6">
      {visible.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {/* Streaming bubble â€” shown while tokens are arriving */}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{
            id: "streaming",
            conversation_id: "",
            role: "assistant",
            content: streamingContent,
            timestamp: new Date().toISOString(),
            has_visibility: false,
          }}
          isStreaming
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
```

### 9.3 MessageBubble

**`src/frontend/src/components/chat/MessageBubble.tsx`**

Individual message rendering. User messages are simple text, right-aligned. Assistant messages render markdown via `react-markdown` with `rehype-highlight` for code blocks. Each finalized assistant message shows an "Inspect" button that opens the VisibilityPanel.

```tsx
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useVisibilityStore } from "@/stores/visibilityStore";
import type { Message } from "@/lib/types";

// Import a highlight.js dark theme (e.g., github-dark)
import "highlight.js/styles/github-dark.css";

interface Props {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming = false }: Props) {
  const { openForMessage } = useVisibilityStore();
  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col gap-1", isUser && "items-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-4 py-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground ml-auto"
            : "bg-card text-card-foreground border border-border"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5 align-text-bottom" />
            )}
          </div>
        )}
      </div>

      {/* Inspect button â€” finalized assistant messages only */}
      {!isUser && !isStreaming && message.has_visibility && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-muted-foreground gap-1 self-start"
          onClick={() => openForMessage(message.id)}
        >
          <EyeIcon size={12} />
          Inspect
        </Button>
      )}
    </div>
  );
}
```

### 9.4 ChatInput

**`src/frontend/src/components/chat/ChatInput.tsx`**

A textarea that auto-grows with content. Enter sends; Shift+Enter inserts a newline. Disabled when streaming or disconnected.

```tsx
import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { SendIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  return (
    <div className="flex items-end gap-2 rounded-lg border border-border bg-muted p-2">
      <textarea
        ref={textareaRef}
        rows={1}
        className="flex-1 resize-none bg-transparent outline-none text-sm placeholder:text-muted-foreground max-h-48 leading-6 px-2 py-1"
        placeholder={disabled ? "Waiting..." : "Message Wayne..."}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        disabled={disabled}
      />
      <Button
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        <SendIcon size={16} />
      </Button>
    </div>
  );
}
```

### 9.5 StreamingIndicator

**`src/frontend/src/components/chat/StreamingIndicator.tsx`**

A simple pulsing "thinking" indicator shown before the first token arrives (when `isStreaming` is true but `streamingContent` is empty, i.e., the model has been sent the message but no tokens have come back yet).

```tsx
export function StreamingIndicator({ content }: { content: string }) {
  if (content) return null;  // Once tokens start, MessageBubble handles display
  return (
    <div className="flex gap-1 items-center px-4 py-3 text-muted-foreground text-sm">
      <span className="animate-bounce" style={{ animationDelay: "0ms" }}>â€¢</span>
      <span className="animate-bounce" style={{ animationDelay: "150ms" }}>â€¢</span>
      <span className="animate-bounce" style={{ animationDelay: "300ms" }}>â€¢</span>
    </div>
  );
}
```

---

## 10. Search Progress Component

### 10.1 SearchProgress

**`src/frontend/src/components/search/SearchProgress.tsx`**

Inline indicator that shows harness steps as they execute (Â§8.2). Each step appears sequentially. Running steps are shown with a spinner. Complete steps are shown with a check.

```tsx
import { useChatStore } from "@/stores/chatStore";
import { cn } from "@/lib/utils";

const STEP_LABELS: Record<string, string> = {
  generating_queries: "Generating search queries",
  searching: "Searching the web",
  searching_round_2: "Searching for more info",
  filtering: "Filtering results",
  checking_coverage: "Checking coverage",
  retrying: "Retrying search",
  complete: "Search complete",
};

export function SearchProgress() {
  const { searchSteps } = useChatStore();

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Web Search
      </p>
      {searchSteps.map((step) => (
        <div key={step.step_name} className="flex items-center gap-2 text-sm">
          {step.status === "running" ? (
            <span className="w-3 h-3 border border-t-transparent border-primary rounded-full animate-spin shrink-0" />
          ) : step.status === "complete" ? (
            <span className="w-3 h-3 text-green-500 shrink-0">âœ“</span>
          ) : (
            <span className="w-3 h-3 text-red-500 shrink-0">âœ—</span>
          )}
          <span
            className={cn(
              "text-sm",
              step.status === "complete" && "text-muted-foreground",
              step.status === "error" && "text-destructive"
            )}
          >
            {STEP_LABELS[step.step_name] ?? step.step_name}
          </span>
        </div>
      ))}
    </div>
  );
}
```

---

## 11. Visibility Panel Components

The visibility panel is a right-side Sheet (drawer) from shadcn/ui. It opens per-message when the user clicks "Inspect" on an assistant message. On open, it fetches the `VisibilityRecord` for that message and renders five sub-sections.

### 11.1 VisibilityPanel (Root)

**`src/frontend/src/components/visibility/VisibilityPanel.tsx`**

```tsx
import { useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useVisibilityStore } from "@/stores/visibilityStore";
import { getVisibility } from "@/lib/api";
import { PayloadView } from "./PayloadView";
import { TokenDisplay } from "./TokenDisplay";
import { ReasoningView } from "./ReasoningView";
import { SummaryEventView } from "./SummaryEventView";
import { ToolTraceView } from "./ToolTraceView";
import { Skeleton } from "@/components/ui/skeleton";

export function VisibilityPanel() {
  const {
    isOpen, close, inspectedMessageId, record,
    loading, error, setRecord, setLoading, setError
  } = useVisibilityStore();

  // Fetch visibility record when opening
  useEffect(() => {
    if (!isOpen || !inspectedMessageId) return;
    setLoading(true);
    getVisibility(inspectedMessageId)
      .then((data) => { setRecord(data); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [isOpen, inspectedMessageId]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side="right" className="w-[560px] max-w-[90vw] p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-border shrink-0">
          <SheetTitle className="text-sm">Message Inspector</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-6">
            {loading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-16 w-full" />
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive">Failed to load: {error}</p>
            )}

            {record && !loading && (
              <>
                <TokenDisplay tokenCounts={record.token_counts} />
                <Separator />
                {record.reasoning_content && (
                  <>
                    <ReasoningView content={record.reasoning_content} />
                    <Separator />
                  </>
                )}
                {record.summary_event && (
                  <>
                    <SummaryEventView event={record.summary_event} />
                    <Separator />
                  </>
                )}
                {record.tool_trace && (
                  <>
                    <ToolTraceView trace={record.tool_trace} />
                    <Separator />
                  </>
                )}
                <PayloadView payload={record.api_payload} />
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
```

### 11.2 TokenDisplay

**`src/frontend/src/components/visibility/TokenDisplay.tsx`**

Shows all three provider counts + utilization bar. Per spec Â§4.5.

```tsx
import type { TokenCounts } from "@/lib/types";

interface Props {
  tokenCounts: TokenCounts;
}

export function TokenDisplay({ tokenCounts }: Props) {
  const {
    openai_tiktoken,
    anthropic_count_tokens,
    openrouter_heuristic,
    utilization_percent,
    utilization_fraction,
    active_provider,
    active_model_context_window,
  } = tokenCounts;

  // Which count matches the active provider
  const activeCount = {
    openai: openai_tiktoken,
    anthropic: anthropic_count_tokens,
    openrouter: openrouter_heuristic,
  }[active_provider];

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Token Counts
      </h3>

      {/* Utilization bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Context window utilization</span>
          <span>{utilization_percent.toFixed(1)}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(utilization_percent, 100)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {activeCount?.toLocaleString()} / {active_model_context_window.toLocaleString()} tokens
        </p>
      </div>

      {/* Three-count breakdown */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "OpenAI (tiktoken)", value: openai_tiktoken, provider: "openai" },
          { label: "Anthropic (API)", value: anthropic_count_tokens, provider: "anthropic" },
          { label: "OpenRouter (est.)", value: openrouter_heuristic, provider: "openrouter" },
        ].map(({ label, value, provider }) => (
          <div
            key={provider}
            className="rounded-md bg-muted p-2 space-y-0.5 text-center"
          >
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-sm font-mono font-medium">{value?.toLocaleString() ?? "â€”"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 11.3 ReasoningView

**`src/frontend/src/components/visibility/ReasoningView.tsx`**

Displays the raw reasoning/chain-of-thought content when present. Uses a Collapsible to keep it from dominating the panel.

```tsx
import { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

interface Props {
  content: string;
}

export function ReasoningView({ content }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground w-full hover:text-foreground transition-colors">
        {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        Chain of Thought / Reasoning
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono leading-relaxed">
          {content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

### 11.4 SummaryEventView

**`src/frontend/src/components/visibility/SummaryEventView.tsx`**

Shows the rolling summary event data when a summary was triggered for this message exchange. Per spec Â§4.6.

```tsx
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import type { SummaryEvent } from "@/lib/types";

interface Props {
  event: SummaryEvent;
}

export function SummaryEventView({ event }: Props) {
  const [open, setOpen] = useState(false);
  const reduction = event.tokens_before - event.tokens_after;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Rolling Summary Event
      </h3>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-muted p-2 text-center">
          <p className="text-muted-foreground">Before</p>
          <p className="font-mono font-medium">{event.tokens_before.toLocaleString()}</p>
        </div>
        <div className="rounded bg-muted p-2 text-center">
          <p className="text-muted-foreground">After</p>
          <p className="font-mono font-medium">{event.tokens_after.toLocaleString()}</p>
        </div>
        <div className="rounded bg-muted p-2 text-center">
          <p className="text-muted-foreground">Saved</p>
          <p className="font-mono font-medium text-green-400">
            -{reduction.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Messages summarized â€” collapsible */}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
          {event.messages_summarized.length} messages summarized
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {event.messages_summarized.map((msg, i) => (
            <div key={i} className="text-xs bg-muted rounded p-2">
              <span className="font-medium capitalize text-muted-foreground mr-2">
                {msg.role}:
              </span>
              <span className="font-mono">{msg.content.slice(0, 200)}
                {msg.content.length > 200 && "..."}
              </span>
            </div>
          ))}
          <div className="text-xs bg-muted rounded p-2 border border-border">
            <p className="font-semibold text-muted-foreground mb-1">Summary produced:</p>
            <p className="font-mono">{event.summary_text}</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
```

### 11.5 ToolTraceView

**`src/frontend/src/components/visibility/ToolTraceView.tsx`**

Shows the full tool execution trace â€” tool name, arguments, and each harness step. Each step is collapsible to reveal input/output JSON.

```tsx
import { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ToolTrace, ToolStep } from "@/lib/types";

interface Props {
  trace: ToolTrace;
}

function StepDetail({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs hover:text-foreground text-muted-foreground transition-colors">
        {open ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className="font-medium">{step.step_name}</span>
        <Badge variant={step.status === "complete" ? "secondary" : step.status === "error" ? "destructive" : "outline"}
               className="ml-auto text-xs">
          {step.status}
        </Badge>
        {step.duration_ms && (
          <span className="text-xs text-muted-foreground">{step.duration_ms}ms</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 pl-4 space-y-1">
        {step.input !== null && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Input</p>
            <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40 font-mono">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          </div>
        )}
        {step.output !== null && (
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Output</p>
            <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-40 font-mono">
              {JSON.stringify(step.output, null, 2)}
            </pre>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolTraceView({ trace }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tool Execution â€” {trace.tool_name}
        </h3>
        {trace.total_duration_ms && (
          <span className="text-xs text-muted-foreground">
            {(trace.total_duration_ms / 1000).toFixed(1)}s total
          </span>
        )}
      </div>

      <div className="text-xs bg-muted rounded p-2 font-mono space-y-1">
        {Object.entries(trace.arguments).map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground">{k}: </span>
            <span>{v}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {trace.steps.map((step, i) => (
          <StepDetail key={i} step={step} />
        ))}
      </div>
    </div>
  );
}
```

### 11.6 PayloadView

**`src/frontend/src/components/visibility/PayloadView.tsx`**

Shows the full API payload that was sent to the LLM. This is the largest section â€” always placed last in the panel so the more actionable sections (tokens, reasoning, etc.) appear first. Uses a Collapsible.

```tsx
import { useState } from "react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ApiPayload } from "@/lib/types";

interface Props {
  payload: ApiPayload;
}

export function PayloadView({ payload }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground w-full hover:text-foreground transition-colors">
        {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
        API Payload
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded bg-muted p-2">
            <p className="text-muted-foreground">Model</p>
            <p className="font-mono mt-0.5">{payload.model}</p>
          </div>
          <div className="rounded bg-muted p-2">
            <p className="text-muted-foreground">Provider</p>
            <p className="font-mono mt-0.5 capitalize">{payload.provider}</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1">Parameters</p>
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-32 font-mono">
            {JSON.stringify(payload.parameters, null, 2)}
          </pre>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1">
            Messages sent ({payload.messages.length})
          </p>
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-96 font-mono">
            {JSON.stringify(payload.messages, null, 2)}
          </pre>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-1">Response metadata</p>
          <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-24 font-mono">
            {JSON.stringify(payload.response_metadata, null, 2)}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

---

## 12. Utilities

**`src/frontend/src/utils/formatters.ts`**

```ts
// Format relative timestamps for the sidebar (e.g., "2 hours ago")
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

// Format large numbers with commas for token counts
export function formatTokenCount(n: number): string {
  return n.toLocaleString();
}

// Format context utilization as "42,381 / 200,000 tokens (21.2%)"
export function formatUtilization(
  activeCount: number,
  contextWindow: number,
  percent: number
): string {
  return `${formatTokenCount(activeCount)} / ${formatTokenCount(contextWindow)} tokens (${percent.toFixed(1)}%)`;
}
```

---

## 13. main.tsx Entry Point

**`src/frontend/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

---

## 14. Testing

Per spec Â§13.3: focus on critical flow coverage. Use Vitest + React Testing Library.

```
npm install -D vitest @testing-library/react @testing-library/user-event jsdom
```

**`src/frontend/vite.config.ts`** â€” add test configuration:
```ts
export default defineConfig({
  // ...existing config...
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

**`src/frontend/src/test/setup.ts`:**
```ts
import "@testing-library/jest-dom";
```

### Critical Test Coverage Required (per Â§13.3)

1. **Starting a chat** â€” `ChatInput` renders, user types, clicks send, `useChat.sendMessage` is called, optimistic message appears in `MessageList`.
2. **Sending a message** â€” WebSocket send is called with correct payload shape (model_id, provider, reasoning_level).
3. **Switching models** â€” `ModelSelector` renders provider groups, selecting a model updates the store, `ReasoningSelector` updates its options.
4. **Renaming a conversation** â€” `ConversationItem` enter-rename flow calls `renameConversation` API, title updates in sidebar.
5. **Deleting a conversation** â€” `ConversationItem` delete action calls `deleteConversation` API, item removed from list.
6. **WebSocket streaming** â€” mock WebSocket, send `stream_token` events, verify `streamingContent` accumulates and renders.

Test files:
```
src/frontend/src/
â”œâ”€â”€ test/
â”‚   â”œâ”€â”€ setup.ts
â”‚   â”œâ”€â”€ ChatInput.test.tsx
â”‚   â”œâ”€â”€ MessageList.test.tsx
â”‚   â”œâ”€â”€ ModelSelector.test.tsx
â”‚   â”œâ”€â”€ ConversationItem.test.tsx
â”‚   â”œâ”€â”€ useWebSocket.test.ts
â”‚   â””â”€â”€ chatStore.test.ts
```

---

## 15. Implementation Sequence Summary

Strict ordering to avoid incomplete dependencies:

| Step | What | Prerequisite |
|------|------|--------------|
| 1 | Project scaffolding (Vite, Tailwind, shadcn/ui setup) | Node.js 20+ |
| 2 | `lib/types.ts` â€” all TypeScript types | Scaffolding |
| 3 | `lib/utils.ts` â€” `cn()` helper | Scaffolding |
| 4 | `lib/api.ts` â€” REST wrappers | types.ts |
| 5 | `stores/chatStore.ts` | types.ts |
| 6 | `stores/modelStore.ts` | types.ts |
| 7 | `stores/visibilityStore.ts` | types.ts |
| 8 | `hooks/useWebSocket.ts` | chatStore, types |
| 9 | `hooks/useModels.ts` | modelStore, api |
| 10 | `hooks/useChat.ts` | chatStore, modelStore, api |
| 11 | `utils/formatters.ts` | (none) |
| 12 | shadcn/ui components (ui/ directory) | Tailwind configured |
| 13 | `App.tsx` skeleton (layout only) | All stores, all hooks |
| 14 | `Sidebar.tsx` + `ConversationItem.tsx` | chatStore, api |
| 15 | `Header.tsx` + `ModelSelector.tsx` + `ReasoningSelector.tsx` | modelStore |
| 16 | `ConnectionIndicator.tsx` | chatStore |
| 17 | `ChatInput.tsx` | (ui components) |
| 18 | `MessageBubble.tsx` | visibilityStore, react-markdown |
| 19 | `MessageList.tsx` + `StreamingIndicator.tsx` | MessageBubble |
| 20 | `ChatPanel.tsx` | MessageList, ChatInput, SearchProgress, stores |
| 21 | `SearchProgress.tsx` | chatStore |
| 22 | `TokenDisplay.tsx` | types |
| 23 | `ReasoningView.tsx` | shadcn/ui collapsible |
| 24 | `SummaryEventView.tsx` | types |
| 25 | `ToolTraceView.tsx` | types |
| 26 | `PayloadView.tsx` | types |
| 27 | `VisibilityPanel.tsx` | All visibility sub-components, api |
| 28 | Wire everything in `App.tsx` | All above |
| 29 | Backend integration (swap mocks for real API) | Unit BE complete |
| 30 | Tests | All components |

---

## 16. Known Risks and Mitigations

**React-markdown + rehype-highlight bundle size.** The `highlight.js` CSS import in `MessageBubble.tsx` adds ~50KB. Mitigate: import only the specific theme needed (`github-dark.css`), not all themes.

**WebSocket reconnection on conversation switch.** When the user switches conversations, the old WS connection closes and a new one opens. If the user switches rapidly, the `useEffect` cleanup in `useWebSocket` must reliably cancel pending retry timers. The `retryTimer.current` ref pattern handles this â€” the cleanup function clears the timer before unmounting.

**Streaming content and store mutation.** `appendStreamToken` is called on every token event â€” potentially 100s of times per second. Zustand's `set()` is synchronous and triggers React re-renders. The `streamingContent` accumulation in `MessageList` uses the store's derived state. If performance is an issue, the streaming bubble can be refactored to use a local ref for accumulation and only sync to the store on `stream_done`. Defer this optimization until there is an observed perf problem.

**Visibility panel Sheet width on narrow desktop.** The Sheet is `560px` with `max-w-[90vw]`. On a 1280px desktop with a 260px sidebar, this leaves the main chat area at ~460px â€” compressed but functional. No mobile support required (Â§1.2).

**OpenRouter dynamic model list.** The `GET /api/models` endpoint returns OpenRouter models fetched at backend startup. If that fetch failed (Â§11.3), the OpenRouter `ProviderGroup` will have `key_configured: false` and its models array will be empty (or a single placeholder). `ModelSelector` handles this gracefully by showing the group header with a warning icon and no selectable items.

**`stream_done` message and final Message construction.** The `stream_done` WS event carries a `message_id` but not the full `Message` object. The `finalizeStreamedMessage` handler constructs a provisional Message from the accumulated streaming content. If the full message needs additional fields (e.g., `model_id`, `provider`), these could be added to the `stream_done` payload by the backend â€” or the frontend can re-fetch `GET /api/conversations/{id}` after `stream_done` to get the fully hydrated message list. The plan defaults to provisional construction for latency reasons; add re-fetch if the provisional message causes downstream issues.

---

### Critical Files for Implementation

- `src/frontend/src/lib/types.ts` â€” All TypeScript interfaces; every component and store depends on these. Must be written first and kept accurate as the backend API surface is finalized.
- `src/frontend/src/stores/chatStore.ts` â€” Core state for conversations, streaming, and connection; the WebSocket hook and all chat components are consumers of this store.
- `src/frontend/src/hooks/useWebSocket.ts` â€” The most complex piece; owns WebSocket lifecycle, exponential backoff reconnection (Â§11.6), and dispatches all server message types to the store.
- `src/frontend/src/components/visibility/VisibilityPanel.tsx` â€” Root of the visibility UI (Â§6.3); coordinates the Sheet component, the API fetch, and all five sub-section components.
- `src/frontend/vite.config.ts` â€” Build tool configuration including the `/api` and `/ws` proxy rules that make local development against the FastAPI backend possible.