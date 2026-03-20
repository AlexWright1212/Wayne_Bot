# Wayne v1 — Frontend Surface Area Guide

**Purpose:** Everything the frontend needs to display, control, and handle — derived from the actual backend code (source of truth), cross-referenced against the spec and master plan.

**Date:** 2026-03-15

---

## 1. Frontend Surface Area Summary

The Wayne frontend is a single-page React app that:

- **Manages conversations** via REST (CRUD)
- **Streams LLM responses** via WebSocket (token-by-token, with tool execution progress)
- **Lets users configure** provider, model, and reasoning level per message
- **Displays a transparency/visibility panel** per assistant message showing API payloads, token counts, reasoning content, summary events, and tool execution traces
- **Handles async state** including streaming progress, rolling summary blocking, auto-title updates, background token count population, and error recovery

**Backend base URL:** `http://localhost:8000`
**Frontend dev server:** `http://localhost:5173` (Vite, pre-configured in CORS)

---

## 2. User Actions Supported

### Conversation Management
| Action | API | Notes |
|--------|-----|-------|
| Create new chat | `POST /api/conversations` | Body optional; title can be null |
| List all chats | `GET /api/conversations` | Ordered by `updated_at DESC` |
| Open a chat | `GET /api/conversations/{id}` | Returns full message history |
| Rename a chat | `PATCH /api/conversations/{id}` | `{ "title": "new name" }` |
| Delete a chat | `DELETE /api/conversations/{id}` | Permanent, cascading delete |

### Sending Messages
| Action | Channel | Notes |
|--------|---------|-------|
| Send a message | WebSocket `send_message` | Includes model_id, provider, reasoning_level |
| Receive streamed response | WebSocket events | Token-by-token, plus tool steps, reasoning, summary |

### Model Configuration (per message)
| Control | Options | Source |
|---------|---------|--------|
| Provider selection | `openai`, `anthropic`, `openrouter` | `GET /api/models` → providers dict |
| Model selection | Per-provider model list | `GET /api/models` → providers[x].models |
| Reasoning level | Per-provider level list | `GET /api/models` → models[x].reasoning_levels |
| Refresh OpenRouter models | Button/action | `GET /api/models/openrouter/refresh` |

### Visibility Inspection
| Action | API | Notes |
|--------|-----|-------|
| View visibility for a message | `GET /api/messages/{id}/visibility` | Per assistant message |
| View conversation token counts | `GET /api/conversations/{id}/token-counts` | Latest snapshot |

---

## 3. Displayable Data Inventory

### 3.1 Conversation List (Sidebar)

From `GET /api/conversations` — each item:

```json
{
  "id": "a1b2c3d4-...",
  "title": "How to deploy a FastAPI app",   // or null (untitled)
  "last_model_id": "gpt-5",                 // or null
  "last_provider": "openai",                // or null
  "updated_at": "2026-03-15T14:30:00Z"
}
```

**Display notes:**
- `title` is null until auto-titled after the first exchange. Show placeholder like "New Chat".
- `last_model_id` / `last_provider` can be shown as a subtle badge (e.g., small model icon).
- Sort by `updated_at` descending (backend already returns this order).

### 3.2 Message History (Chat Panel)

From `GET /api/conversations/{id}` → `messages[]` — each message:

```json
{
  "id": "msg-uuid-...",
  "role": "assistant",
  "content": "Here's how you deploy...",
  "model_id": "gpt-5",
  "provider": "openai",
  "reasoning_level": "medium",
  "tool_call_id": null,
  "tool_name": null,
  "tool_arguments": null,
  "tool_result_call_id": null,
  "tool_result_name": null,
  "sequence": 4,
  "created_at": "2026-03-15T14:30:05Z"
}
```

**Which roles are user-visible in the chat:**

| Role | Display in Chat | Notes |
|------|----------------|-------|
| `user` | Yes — user's message bubble | |
| `assistant` | Yes — assistant's response bubble | Show model badge, has visibility data |
| `system` | No | System prompt; only visible in visibility payload |
| `tool_call` | No (inline in chat) | Shown as part of assistant's tool activity indicator |
| `tool_result` | No (inline in chat) | Shown as part of assistant's tool activity indicator |
| `summary` | No | Hidden from chat; visible in visibility panel |

**Assistant message metadata to display:**
- `model_id` + `provider` — show which model generated this response
- `reasoning_level` — show if reasoning was active
- Each assistant message has a clickable affordance to open its visibility data

### 3.3 Model Catalog

From `GET /api/models`:

```json
{
  "providers": {
    "openai": {
      "provider": "openai",
      "available": true,
      "models": [
        {
          "id": "gpt-5.2",
          "name": "GPT-5.2",
          "provider": "openai",
          "context_window": 400000,
          "max_output": 128000,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["none", "low", "medium", "high", "xhigh"]
        },
        {
          "id": "gpt-5",
          "name": "GPT-5",
          "provider": "openai",
          "context_window": 400000,
          "max_output": 128000,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["none", "low", "medium", "high", "xhigh"]
        },
        {
          "id": "gpt-5-mini",
          "name": "GPT-5 mini",
          "provider": "openai",
          "context_window": 400000,
          "max_output": 128000,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["none", "low", "medium", "high", "xhigh"]
        },
        {
          "id": "gpt-5-nano",
          "name": "GPT-5 nano",
          "provider": "openai",
          "context_window": 400000,
          "max_output": 128000,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["none", "low", "medium", "high", "xhigh"]
        }
      ]
    },
    "anthropic": {
      "provider": "anthropic",
      "available": true,
      "models": [
        {
          "id": "claude-opus-4-6-20250130",
          "name": "Claude Opus 4.6",
          "provider": "anthropic",
          "context_window": 200000,
          "max_output": 8192,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["off", "low", "medium", "high", "adaptive"]
        },
        {
          "id": "claude-sonnet-4-6-20250514",
          "name": "Claude Sonnet 4.6",
          "provider": "anthropic",
          "context_window": 200000,
          "max_output": 8192,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["off", "low", "medium", "high", "adaptive"]
        },
        {
          "id": "claude-haiku-4-5-20251001",
          "name": "Claude Haiku 4.5",
          "provider": "anthropic",
          "context_window": 200000,
          "max_output": 8192,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": ["off", "low", "medium", "high", "adaptive"]
        }
      ]
    },
    "openrouter": {
      "provider": "openrouter",
      "available": true,
      "models": [
        {
          "id": "deepseek/deepseek-r1",
          "name": "DeepSeek R1",
          "provider": "openrouter",
          "context_window": 128000,
          "max_output": 4096,
          "supports_tools": true,
          "supports_reasoning": true,
          "reasoning_levels": []
        }
      ]
    }
  }
}
```

**UI control logic:**
- Show providers as top-level tabs or grouped sections
- If `available` is `false`, gray out the provider with a "No API key" indicator
- Models within each provider shown in a dropdown
- Reasoning level dropdown is populated from the selected model's `reasoning_levels` array
- If `reasoning_levels` is empty (OpenRouter non-reasoning models), hide the reasoning dropdown
- If `supports_reasoning` is true but `reasoning_type` is `"builtin"` (DeepSeek R1 via OpenRouter), reasoning is always-on with no user control — show an indicator like "Reasoning: Always On" instead of a dropdown

**Reasoning level defaults:**
- OpenAI: `"none"` (no reasoning unless explicitly selected)
- Anthropic: `"off"` (no thinking unless explicitly selected)
- OpenRouter: `null` (not user-controllable)

### 3.4 Token Counts (Always Visible)

From `GET /api/conversations/{id}/token-counts` (or from `stream_done` event):

```json
{
  "tokens_openai": 1542,
  "tokens_anthropic": 1489,
  "tokens_openrouter": 1610,
  "output_tokens": 387,
  "context_window_size": 400000,
  "active_token_count": 1542,
  "active_provider": "openai",
  "model_id": "gpt-5",
  "utilization": 0.003855
}
```

**Display requirements (spec §4.5):**
1. All three provider token counts — always visible, regardless of selected model
2. Context window utilization bar — e.g., `1,542 / 400,000 tokens (0.4%)`
3. Updates when user switches models (re-fetch or recalculate from stored counts)

**Note:** `tokens_anthropic` and `tokens_openrouter` may be `null` briefly after a response — they are computed in background tasks. The frontend should handle null gracefully (show "..." or a loading indicator, then poll/refresh).

---

## 4. Visibility Layer Audit

Every assistant message has an associated visibility record. The frontend fetches it via `GET /api/messages/{message_id}/visibility`. Below are the exact JSON shapes the backend produces, with realistic examples.

### 4.1 Request Payload

The `request_payload` field captures exactly what was sent to the LLM:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "You are Wayne, a personal AI assistant. Today's date is March 15, 2026.\n\nBe helpful, direct, and thorough..."
    },
    {
      "role": "user",
      "content": "What are the best JavaScript frameworks in 2026?"
    }
  ],
  "model_id": "gpt-5",
  "provider": "openai",
  "reasoning_level": "medium",
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "web_search",
        "description": "Search the web for current or factual information needed to answer the user's question. Use this when the question requires up-to-date information, specific facts, or knowledge you may not have.",
        "parameters": {
          "type": "object",
          "properties": {
            "reason": {
              "type": "string",
              "description": "Brief explanation of why web search is needed"
            },
            "query": {
              "type": "string",
              "description": "The information need described clearly for the search system"
            }
          },
          "required": ["reason", "query"]
        }
      }
    }
  ]
}
```

**Notes:**
- `tools` is `null` when the model doesn't support tool calling, or after tool_round >= 2
- Tool schema format varies by provider (OpenAI uses `function` wrapper, Anthropic uses `input_schema`)
- `messages` array includes summary messages (role: `system` with `[Conversation summary]` prefix) when rolling summary has been applied
- When tool calls occurred, `messages` includes the tool_call and tool_result messages from prior rounds

**Example with tool call history in messages:**

```json
{
  "messages": [
    { "role": "system", "content": "You are Wayne..." },
    { "role": "user", "content": "What's the weather in NYC?" },
    {
      "role": "assistant",
      "tool_calls": [
        {
          "id": "call_abc123",
          "name": "web_search",
          "arguments": "{\"reason\": \"Need current weather data\", \"query\": \"current weather NYC\"}"
        }
      ]
    },
    {
      "role": "tool_result",
      "tool_call_id": "call_abc123",
      "tool_name": "web_search",
      "content": "[{\"title\": \"NYC Weather\", \"url\": \"...\", \"snippet\": \"...\", \"score\": 0.95}]"
    }
  ],
  "model_id": "gpt-5",
  "provider": "openai",
  "reasoning_level": null,
  "tools": null
}
```

### 4.2 Response Metadata

The `response_metadata` field captures what the LLM returned:

```json
{
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 1542,
    "completion_tokens": 387
  }
}
```

**After auto-title (first exchange only), this gets enriched:**

```json
{
  "finish_reason": "stop",
  "usage": {
    "prompt_tokens": 1542,
    "completion_tokens": 387
  },
  "auto_title": {
    "prompt": "User: What are the best JavaScript frameworks in 2026?\nAssistant: Based on the current landscape, here are the top JavaScript frameworks...",
    "response": "Best JavaScript Frameworks 2026"
  }
}
```

**When a tool was called, finish_reason is `"tool_calls"` in the first pass, then `"stop"` in the synthesis pass.** The visibility record is only captured for the final assistant message (the synthesis), so `finish_reason` will typically be `"stop"`.

### 4.3 Token Counts

Six numeric fields on the visibility record:

```json
{
  "tokens_openai": 1542,
  "tokens_anthropic": 1489,
  "tokens_openrouter": 1610,
  "output_tokens": 387,
  "context_window_size": 400000,
  "active_token_count": 1542
}
```

- `tokens_openai` — exact via tiktoken (local)
- `tokens_anthropic` — exact via Anthropic API (may be null initially, filled by background task)
- `tokens_openrouter` — heuristic `ceil(chars / 3.5)` (may be null initially, filled by background task)
- `output_tokens` — from `response_metadata.usage.completion_tokens`
- `context_window_size` — the model's max context (e.g., 400000 for GPT-5)
- `active_token_count` — the count from whichever provider was active (always present immediately)

**Display suggestion:** Show all three counts side by side (e.g., "OAI: 1,542 | Anthropic: 1,489 | OR: 1,610") plus a utilization bar for the active provider.

### 4.4 Reasoning Content

The `reasoning_content` field is a plain text string. Its content varies by provider:

**OpenAI (reasoning_level > "none"):**
```
The user is asking about JavaScript frameworks. I should consider the current
ecosystem as of 2026. The major players are still React, Vue, and Svelte, but
there have been significant changes. Let me think about what's most relevant...
```

**Anthropic (thinking enabled):**
```
Let me think about this carefully. The JavaScript framework landscape has evolved
significantly. I need to consider:
1. React - still dominant but React Server Components changed the game
2. Vue 4 - major rewrite with better TypeScript support
3. Svelte 5 - runes system matured
4. Solid.js 2.0 - growing adoption
...
```

**DeepSeek R1 (always-on, parsed from `<think>` tags):**
```
I need to evaluate JavaScript frameworks based on their current adoption,
performance benchmarks, and developer experience. Let me consider each...
```

**When reasoning is not active:** `null`

**Display notes:**
- This can be long (hundreds to thousands of tokens for Anthropic thinking)
- Should be displayed in a collapsible section, not inline in chat
- Monospace or slightly different styling to distinguish from normal content

### 4.5 Summary Event

The `summary_event` field is present only when a rolling summary was triggered for this exchange:

```json
{
  "summary_text": "The conversation began with the user asking about JavaScript frameworks. Wayne provided a comprehensive overview covering React, Vue, Svelte, and Solid.js, noting that React remains dominant but Svelte and Solid are gaining ground. The user then asked specifically about performance benchmarks, and Wayne shared detailed comparisons from recent studies.",
  "summarized_message_ids": [
    "a1b2c3d4-1111-...",
    "a1b2c3d4-2222-...",
    "a1b2c3d4-3333-...",
    "a1b2c3d4-4444-..."
  ],
  "tokens_before": 165000,
  "tokens_after": 82000,
  "model_used": "gpt-5-nano"
}
```

**Display suggestions:**
- Show as an event card: "Context compressed: 165,000 → 82,000 tokens"
- Expandable to see the full summary text
- List how many messages were summarized (count of `summarized_message_ids`)
- Show the model used (always the lightweight model)

**When no summary was triggered:** `null`

### 4.6 Tool Trace — Full Web Search Example

The `tool_trace` field captures the complete execution trace of tool calls. Here is a realistic full example for a web search that includes all 5 harness steps:

```json
{
  "steps": [
    {
      "name": "query_generation",
      "status": "complete",
      "data": {
        "ready_queries": [
          "best JavaScript frameworks 2026",
          "JavaScript framework comparison 2026 performance"
        ],
        "pending_queries": [
          {
            "template": "{{top_framework}} vs React 2026 benchmark",
            "slot": "top_framework"
          }
        ]
      },
      "duration_ms": 820
    },
    {
      "name": "execute_queries",
      "status": "complete",
      "data": {
        "queries": [
          "best JavaScript frameworks 2026",
          "JavaScript framework comparison 2026 performance"
        ],
        "result_count": 16,
        "entities": {
          "top_framework": "Svelte"
        }
      },
      "duration_ms": 2150
    },
    {
      "name": "round2_search",
      "status": "complete",
      "data": {
        "filled_queries": [
          "Svelte vs React 2026 benchmark"
        ],
        "result_count": 7
      },
      "duration_ms": 1340
    },
    {
      "name": "filter_results",
      "status": "complete",
      "data": {
        "kept": 12,
        "removed": 11,
        "removed_reasons": [
          { "url": "https://old-blog.example.com/2024/frameworks", "reason": "too_old" },
          { "url": "https://spam-site.example.com/seo-bait", "reason": "low_score" },
          { "url": "https://best-js-frameworks.example.com/2026", "reason": "duplicate" }
        ]
      },
      "duration_ms": 5
    },
    {
      "name": "coverage_check",
      "status": "complete",
      "data": {
        "sufficient": true,
        "missing": [],
        "confidence": 0.92
      },
      "duration_ms": 650
    }
  ]
}
```

**Example with coverage retry:**

If the first coverage check finds gaps, retry steps are appended:

```json
{
  "steps": [
    { "name": "query_generation", "status": "complete", "data": { "..." : "..." }, "duration_ms": 800 },
    { "name": "execute_queries", "status": "complete", "data": { "..." : "..." }, "duration_ms": 2100 },
    { "name": "filter_results", "status": "complete", "data": { "kept": 6, "removed": 4, "removed_reasons": [] }, "duration_ms": 3 },
    {
      "name": "coverage_check",
      "status": "complete",
      "data": {
        "sufficient": false,
        "missing": ["performance benchmarks for Svelte 5 vs React 19", "developer survey data 2026"],
        "confidence": 0.45
      },
      "duration_ms": 700
    },
    {
      "name": "coverage_retry_1",
      "status": "complete",
      "data": {
        "sufficient": true,
        "missing": [],
        "confidence": 0.88
      },
      "duration_ms": 2800
    }
  ]
}
```

**Note:** Step 3 (`round2_search`) only appears when `pending_queries` exist. If the query generation produces no pending queries, the trace goes directly from `execute_queries` to `filter_results`.

**Filter reasons enum:**
- `"low_score"` — Tavily relevance score below 0.75
- `"too_old"` — Published date older than 365 days
- `"blacklisted"` — Domain in blacklist
- `"duplicate"` — URL already seen

**Display suggestions for tool trace:**
- Show as a vertical stepper/timeline
- Each step shows name, status icon (spinner → checkmark), and duration
- Expandable to show step data
- For `filter_results`, show a summary like "Kept 12, removed 11 (3 low score, 5 too old, 3 duplicate)"
- For `coverage_check`, show confidence as a percentage and whether it passed
- Highlight retry loops distinctly

### 4.7 Complete Visibility Record Example

Putting it all together — a full `GET /api/messages/{id}/visibility` response for a message that involved a web search:

```json
{
  "id": "vis-uuid-...",
  "message_id": "msg-uuid-...",
  "request_payload": {
    "messages": [
      { "role": "system", "content": "You are Wayne, a personal AI assistant..." },
      { "role": "user", "content": "What's happening with JavaScript frameworks in 2026?" },
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_abc123",
            "name": "web_search",
            "arguments": "{\"reason\": \"Need current 2026 data on JS frameworks\", \"query\": \"JavaScript framework trends 2026\"}"
          }
        ]
      },
      {
        "role": "tool_result",
        "tool_call_id": "call_abc123",
        "tool_name": "web_search",
        "content": "[{\"title\": \"State of JS 2026\", \"url\": \"https://stateofjs.com/2026\", \"snippet\": \"React leads with 78% satisfaction...\", \"score\": 0.97}, ...]"
      }
    ],
    "model_id": "gpt-5",
    "provider": "openai",
    "reasoning_level": "medium",
    "tools": null
  },
  "response_metadata": {
    "finish_reason": "stop",
    "usage": {
      "prompt_tokens": 4250,
      "completion_tokens": 892
    },
    "auto_title": {
      "prompt": "User: What's happening with JavaScript frameworks in 2026?\nAssistant: Based on my research, here's a comprehensive overview...",
      "response": "JavaScript Frameworks in 2026"
    }
  },
  "tokens_openai": 4250,
  "tokens_anthropic": 4102,
  "tokens_openrouter": 4571,
  "output_tokens": 892,
  "context_window_size": 400000,
  "active_token_count": 4250,
  "reasoning_content": "The user is asking about JavaScript frameworks in 2026. I performed a web search and got good results. Let me synthesize the key findings from State of JS survey and the benchmark data...",
  "summary_event": null,
  "tool_trace": {
    "steps": [
      {
        "name": "query_generation",
        "status": "complete",
        "data": {
          "ready_queries": ["JavaScript framework trends 2026", "State of JS 2026 survey results"],
          "pending_queries": []
        },
        "duration_ms": 780
      },
      {
        "name": "execute_queries",
        "status": "complete",
        "data": {
          "queries": ["JavaScript framework trends 2026", "State of JS 2026 survey results"],
          "result_count": 14,
          "entities": {}
        },
        "duration_ms": 1950
      },
      {
        "name": "filter_results",
        "status": "complete",
        "data": {
          "kept": 9,
          "removed": 5,
          "removed_reasons": [
            { "url": "https://example.com/old-post", "reason": "too_old" },
            { "url": "https://example.com/low-quality", "reason": "low_score" },
            { "url": "https://example.com/low-quality-2", "reason": "low_score" },
            { "url": "https://stateofjs.com/2026", "reason": "duplicate" },
            { "url": "https://example.com/blacklisted", "reason": "blacklisted" }
          ]
        },
        "duration_ms": 4
      },
      {
        "name": "coverage_check",
        "status": "complete",
        "data": {
          "sufficient": true,
          "missing": [],
          "confidence": 0.91
        },
        "duration_ms": 620
      }
    ]
  },
  "created_at": "2026-03-15T14:30:05Z"
}
```

---

## 5. Streaming / Real-Time Contract

### 5.1 WebSocket Connection

**URL:** `ws://localhost:8000/ws/{conversation_id}`

**Lifecycle:**
1. Client creates conversation via REST first (`POST /api/conversations`)
2. Client opens WebSocket to `/ws/{conversation_id}`
3. Server validates conversation exists; if not, closes with code `1008`
4. Client sends `send_message`, server streams events back
5. Connection persists across multiple message exchanges
6. Client reconnects on disconnect with exponential backoff (up to 3 attempts)

### 5.2 Client → Server Message

```json
{
  "type": "send_message",
  "content": "What are the best JavaScript frameworks in 2026?",
  "model_id": "gpt-5",
  "provider": "openai",
  "reasoning_level": "medium"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | string | Yes | Always `"send_message"` |
| `content` | string | Yes | User's message text |
| `model_id` | string | Yes | From model catalog |
| `provider` | string | Yes | `"openai"`, `"anthropic"`, or `"openrouter"` |
| `reasoning_level` | string \| null | No | Provider-specific; null = default (no reasoning) |

### 5.3 Server → Client Events

#### `stream_token` — Text content arriving

```json
{ "type": "stream_token", "content": "Here" }
{ "type": "stream_token", "content": "'s" }
{ "type": "stream_token", "content": " how" }
```

- Concatenate `content` fields to build the full response
- Arrives rapidly (many per second)
- Support markdown rendering as tokens arrive

#### `stream_reasoning` — Reasoning/thinking content

```json
{ "type": "stream_reasoning", "content": "Let me think about this..." }
```

- Only arrives when reasoning is active for the selected model
- Display separately from main content (e.g., collapsible thinking section)
- For OpenAI: arrives as concise summary chunks
- For Anthropic: arrives as raw thinking tokens
- For DeepSeek R1: parsed from `<think>` tags

#### `tool_call_start` — LLM decided to use a tool

```json
{
  "type": "tool_call_start",
  "tool_name": "web_search",
  "arguments": {
    "reason": "Need current information about JavaScript frameworks",
    "query": "best JavaScript web frameworks 2026"
  }
}
```

- `arguments` is already parsed (dict, not string)
- Show an indicator: "Searching the web..."
- Display the `reason` to the user

#### `tool_step` — Tool execution progress

```json
{
  "type": "tool_step",
  "step_name": "query_generation",
  "step_index": 0,
  "status": "complete",
  "data": {
    "ready_queries": ["best JavaScript frameworks 2026"],
    "pending_queries": []
  },
  "duration_ms": 820
}
```

- Steps arrive in pairs: first `status: "running"` (with empty data), then `status: "complete"` (with results)
- `step_index` is 0-based
- Show as a progress stepper (e.g., "Generating queries... ✓ → Searching... → Filtering...")
- The `data` field is step-specific (see Section 4.6 for all shapes)

**Step names and their user-friendly labels:**

| `step_name` | Display Label | What to Show |
|-------------|--------------|-------------|
| `query_generation` | "Generating search queries" | List the `ready_queries` |
| `execute_queries` | "Searching" | Show `result_count` results found |
| `round2_search` | "Searching for details" | Show `filled_queries` |
| `filter_results` | "Filtering results" | Show `kept` count |
| `coverage_check` | "Checking coverage" | Show `confidence` as percentage |
| `coverage_retry_N` | "Searching for more info" | Show what was `missing` |

#### `summary_started` — Rolling summary blocking

```json
{ "type": "summary_started" }
```

- Show: "Compressing conversation history..."
- This blocks the response — no tokens will arrive until summary completes
- Rare in practice (only when conversation is very long)

#### `summary_complete` — Summary done

```json
{ "type": "summary_complete" }
```

- Remove the "Compressing..." indicator
- Tokens will start streaming shortly after

#### `title_updated` — Auto-title generated

```json
{
  "type": "title_updated",
  "conversation_id": "a1b2c3d4-...",
  "title": "JavaScript Frameworks in 2026"
}
```

- Arrives asynchronously, a few seconds after the first exchange
- Update sidebar immediately
- May arrive after `stream_done` for the first message

#### `stream_done` — Response complete

```json
{
  "type": "stream_done",
  "message_id": "msg-uuid-...",
  "visibility_id": "vis-uuid-...",
  "token_counts": null,
  "context_utilization": 0.003855
}
```

- `message_id` — use to fetch visibility data later
- `visibility_id` — the visibility record ID (may be null if capture failed)
- `token_counts` — currently always `null` (background tasks populate the DB; fetch via REST)
- `context_utilization` — float 0.0-1.0, may be `null`

**Important:** After `stream_done`, the frontend should fetch fresh token counts via `GET /api/conversations/{id}/token-counts` to get the updated values (including background-computed non-active provider counts).

#### `error` — Error occurred

```json
{
  "type": "error",
  "message": "Provider API key is not configured",
  "recoverable": true
}
```

- `recoverable: true` — connection stays open, user can retry or switch models
- Show as an error banner/toast in the chat area
- Currently all WebSocket errors are sent as recoverable (the connection is never closed by error events)

### 5.4 Event Sequence Diagrams

**Normal message:**
```
Client → send_message
Server → stream_token (many)
Server → stream_done
```

**With reasoning:**
```
Client → send_message
Server → stream_reasoning (one or more)
Server → stream_token (many)
Server → stream_done
```

**With tool call (web search):**
```
Client → send_message
Server → tool_call_start
Server → tool_step (query_generation, running)
Server → tool_step (query_generation, complete)
Server → tool_step (execute_queries, running)
Server → tool_step (execute_queries, complete)
Server → tool_step (filter_results, running)
Server → tool_step (filter_results, complete)
Server → tool_step (coverage_check, running)
Server → tool_step (coverage_check, complete)
Server → stream_token (many — LLM synthesizing with search results)
Server → stream_done
```

**With rolling summary + tool call:**
```
Client → send_message
Server → summary_started
Server → summary_complete
Server → tool_call_start
Server → tool_step (...)
Server → stream_token (many)
Server → stream_done
```

**First message (triggers auto-title asynchronously):**
```
Client → send_message
Server → stream_token (many)
Server → stream_done
  ... (a few seconds later) ...
Server → title_updated
```

---

## 6. Backend-Driven UI Controls

### 6.1 User-Configurable Controls

| Control | What It Affects | Where to Show | Values From |
|---------|----------------|---------------|-------------|
| **Provider** | Which LLM service handles the message | Header bar | `GET /api/models` → provider keys |
| **Model** | Which specific model within the provider | Header bar | `GET /api/models` → provider.models[] |
| **Reasoning level** | How much the model "thinks" before responding | Header bar | model.reasoning_levels[] |
| **Conversation title** | Sidebar display name | Sidebar (inline edit) | User input via PATCH |

### 6.2 Provider Availability Indicator

From `GET /api/models`, each provider has `available: boolean`:
- `true` = API key is configured in `.env`, provider is usable
- `false` = No API key, provider is visible but grayed out

Show a status icon per provider: checkmark (available) or warning (no key).

### 6.3 Model Capabilities That Affect UI

From each model in the catalog:

| Field | UI Impact |
|-------|----------|
| `supports_tools` | If false, web search won't trigger for this model (no UI change needed, just won't happen) |
| `supports_reasoning` | If false, hide reasoning dropdown |
| `reasoning_levels` | Populates reasoning dropdown options |
| `context_window` | Used for utilization display |
| `max_output` | Not currently displayed, but available for future use |

### 6.4 Things NOT User-Configurable

These are backend settings (`config.py`) with no frontend exposure:

| Setting | Default | Notes |
|---------|---------|-------|
| Lightweight model | `gpt-5-nano` | Used for summaries, auto-title, search harness plumbing |
| Summary threshold | 80% of context window | When rolling summary triggers |
| Summary budget | 50% of context window | How much context to keep after summary |
| Tavily score threshold | 0.75 | Minimum relevance score for search results |
| Tavily date threshold | 365 days | Max age of search results |
| Domain blacklist | `[]` (empty) | Domains to exclude from search |
| Search max retries | 2 | Coverage check retry limit |
| System prompt | Hardcoded | Not editable via UI in v1 |

---

## 7. REST + WebSocket Contract Inventory

### REST Endpoints

| Method | Path | Purpose | Request | Response |
|--------|------|---------|---------|----------|
| `POST` | `/api/conversations` | Create conversation | `{ title?: string }` | `ConversationResponse` (201) |
| `GET` | `/api/conversations` | List conversations | — | `ConversationSummary[]` (200) |
| `GET` | `/api/conversations/{id}` | Get conversation + messages | — | `ConversationDetail` (200) |
| `PATCH` | `/api/conversations/{id}` | Rename conversation | `{ title: string }` | `ConversationResponse` (200) |
| `DELETE` | `/api/conversations/{id}` | Delete conversation | — | 204 |
| `GET` | `/api/models` | List all models | — | `ModelsListResponse` (200) |
| `GET` | `/api/models/openrouter/refresh` | Refresh OpenRouter models | — | `{ models, error? }` (200) |
| `GET` | `/api/messages/{id}/visibility` | Get visibility record | — | `VisibilityResponse` (200) |
| `GET` | `/api/conversations/{id}/token-counts` | Get token counts | — | `TokenCountsResponse` (200) |
| `GET` | `/api/health` | Health check | — | `{ status: "ok" }` (200) |

### WebSocket

| Direction | Event | Key Fields |
|-----------|-------|------------|
| Client → Server | `send_message` | content, model_id, provider, reasoning_level |
| Server → Client | `stream_token` | content |
| Server → Client | `stream_reasoning` | content |
| Server → Client | `tool_call_start` | tool_name, arguments |
| Server → Client | `tool_step` | step_name, step_index, status, data, duration_ms |
| Server → Client | `summary_started` | (no fields) |
| Server → Client | `summary_complete` | (no fields) |
| Server → Client | `title_updated` | conversation_id, title |
| Server → Client | `stream_done` | message_id, visibility_id, token_counts, context_utilization |
| Server → Client | `error` | message, recoverable |

### Error Status Codes

| Code | When |
|------|------|
| 201 | Conversation created |
| 200 | Successful GET/PATCH |
| 204 | Conversation deleted |
| 404 | Resource not found |
| 422 | Provider API key missing |
| 502 | LLM provider error / tool execution error |
| 500 | Internal server error |

---

## 8. Data Model → UI Mapping

### Chat Panel

| Data | UI Element | Source |
|------|-----------|--------|
| User message content | Chat bubble (right) | `messages[role=user].content` |
| Assistant response content | Chat bubble (left) with markdown | `messages[role=assistant].content` or streamed tokens |
| Model badge on response | Small label under assistant bubble | `messages[role=assistant].model_id` + `provider` |
| Reasoning indicator | Icon/badge on assistant bubble | `messages[role=assistant].reasoning_level` |
| Tool activity | Inline progress stepper | `tool_call_start` + `tool_step` events |
| Search results preview | Collapsible under tool activity | `tool_step[filter_results].data.kept` |
| Streaming indicator | Typing/loading animation | Active between first `stream_token` and `stream_done` |
| Summary indicator | Banner: "Compressing history..." | Between `summary_started` and `summary_complete` |
| Error message | Inline error banner | `error` event |

### Sidebar

| Data | UI Element | Source |
|------|-----------|--------|
| Conversation list | Scrollable list | `GET /api/conversations` |
| Conversation title | List item text | `title` (or "New Chat" if null) |
| Last model used | Subtle badge/icon | `last_model_id` + `last_provider` |
| Active conversation | Highlighted item | Client state |
| New chat button | Top of sidebar | Triggers `POST /api/conversations` |
| Rename action | Context menu / inline edit | Triggers `PATCH` |
| Delete action | Context menu with confirmation | Triggers `DELETE` |

### Header Bar

| Data | UI Element | Source |
|------|-----------|--------|
| Provider selector | Dropdown/tabs | `GET /api/models` → provider keys |
| Provider availability | Status icon per provider | `providers[x].available` |
| Model selector | Dropdown (filtered by provider) | `providers[x].models` |
| Reasoning selector | Dropdown (filtered by model) | `models[x].reasoning_levels` |
| Context utilization | Progress bar + fraction | Token counts from visibility/stream_done |

### Visibility Panel

| Data | UI Element | Source |
|------|-----------|--------|
| Request payload | JSON viewer (syntax highlighted, collapsible) | `visibility.request_payload` |
| Response metadata | Key-value list | `visibility.response_metadata` |
| Auto-title data | Expandable section | `visibility.response_metadata.auto_title` |
| Three token counts | Three-column display | `tokens_openai`, `tokens_anthropic`, `tokens_openrouter` |
| Output tokens | Single value | `visibility.output_tokens` |
| Context utilization | Progress bar | `active_token_count` / `context_window_size` |
| Reasoning content | Collapsible text area (monospace) | `visibility.reasoning_content` |
| Summary event | Event card with before/after tokens | `visibility.summary_event` |
| Tool trace | Step-by-step timeline | `visibility.tool_trace.steps[]` |

---

## 9. Gaps, Risks, and Spec Mismatches

### Spec → Code Mismatches

| Spec Says | Code Reality | Frontend Impact |
|-----------|-------------|-----------------|
| `stream_done` includes `token_counts` dict | Code always sends `token_counts: null` (line 419 of chat.py) | Frontend must fetch token counts via REST after `stream_done` |
| `context_utilization` in `stream_done` | Code computes it but the variable `active_token_count` is set to `None` on line 402, so `utilization` is always `null` | Same — use REST endpoint instead |
| Spec §11.6 describes reconnection with exponential backoff | Backend has no reconnection logic; this is purely a frontend responsibility | Frontend must implement reconnection (3 attempts, exponential backoff) |
| Spec §11.1 says "status indicator per provider" | Backend exposes `available` boolean per provider | Frontend should show checkmark/warning per provider |

### Potential Frontend Issues

1. **Background token counts arrive late.** `tokens_anthropic` and `tokens_openrouter` are computed in background tasks after the response. If the frontend fetches visibility immediately after `stream_done`, these may be `null`. Options: poll briefly, or show "calculating..." with a delayed re-fetch.

2. **OpenRouter model list can be empty.** If the OpenRouter key is missing or the API call fails, `openrouter.models` will be `[]`. The frontend should handle this gracefully (show "No models available" or "Refresh" button).

3. **Tool trace step count is variable.** Step 3 (`round2_search`) only appears when pending queries exist. Coverage retries add `coverage_retry_1`, `coverage_retry_2`. The stepper UI must handle a variable number of steps (3-7+).

4. **`stream_reasoning` content length varies wildly.** OpenAI sends concise summaries (100-300 tokens). Anthropic can send thousands of tokens. DeepSeek R1 is also verbose. The reasoning display must handle both short and very long content.

5. **No explicit "message sending" state from backend.** Between the client sending `send_message` and the first `stream_token`, there's no server acknowledgment. The frontend should show a local "sending..." indicator immediately on send.

6. **Auto-title race condition.** `title_updated` can arrive after the user has navigated away from the conversation. The sidebar should update regardless of which conversation is currently active.

7. **Tool call maximum is 2 rounds.** The backend limits tool calls to 2 LLM passes (code line 199: `tool_round < 2`). After that, tools are not offered to the LLM. This is invisible to the user but means very complex multi-search queries may produce incomplete results.

### Missing from Backend (Spec-Referenced but Not Implemented)

| Feature | Status | Notes |
|---------|--------|-------|
| WebSocket close code on non-recoverable errors | Partially implemented | Code always sends `recoverable: true`; WebSocket only closes on disconnect or conversation-not-found |
| Streaming partial response preservation on disconnect | Not implemented server-side | Frontend must handle this client-side by keeping accumulated tokens |

---

## 10. Recommended Frontend Checklist

### Must Have (Core Functionality)

- [ ] Conversation CRUD (create, list, open, rename, delete)
- [ ] Sidebar with conversation list, sorted by recency
- [ ] Chat panel with user/assistant message bubbles
- [ ] Markdown rendering in assistant messages (with code syntax highlighting)
- [ ] WebSocket connection management (connect, reconnect, cleanup)
- [ ] Message streaming (concatenate `stream_token` content in real-time)
- [ ] Provider/model/reasoning selection controls
- [ ] "Sending..." indicator between send and first token
- [ ] Streaming indicator (typing animation) during token arrival
- [ ] `stream_done` handling (finalize message, store IDs)
- [ ] Error display (inline in chat, from `error` events and REST errors)
- [ ] Auto-title sidebar update (from `title_updated` event)

### Must Have (Visibility Layer)

- [ ] Per-message "inspect" button on assistant messages
- [ ] Visibility panel/drawer with tabbed sections
- [ ] Request payload viewer (JSON with syntax highlighting)
- [ ] Response metadata display
- [ ] Token counts display (all three providers + output tokens)
- [ ] Context utilization bar
- [ ] Reasoning content viewer (collapsible)
- [ ] Tool trace timeline/stepper
- [ ] Summary event display

### Must Have (Tool Execution UX)

- [ ] Tool call indicator: "Searching the web..."
- [ ] Real-time step progress (show each `tool_step` as it arrives)
- [ ] Step status transitions (running → complete)
- [ ] Tool execution duration display

### Should Have (Polish)

- [ ] Null title handling ("New Chat" placeholder)
- [ ] Provider availability indicators (checkmark/warning)
- [ ] Model capability awareness (hide reasoning dropdown when not supported)
- [ ] Summary blocking indicator ("Compressing conversation history...")
- [ ] Delayed token count re-fetch (background providers)
- [ ] WebSocket reconnection with exponential backoff
- [ ] Confirmation dialog for conversation deletion
- [ ] Keyboard shortcuts (Enter to send, Shift+Enter for newline)
- [ ] Responsive layout (sidebar collapse on narrow screens)
- [ ] Dark/light theme (or just dark)

### Nice to Have

- [ ] Auto-title data in visibility panel (`response_metadata.auto_title`)
- [ ] Search result preview cards (from tool trace filter step)
- [ ] Token count comparison chart (three providers side by side)
- [ ] Conversation search/filter in sidebar
- [ ] Copy message content button
- [ ] Copy code block button in assistant responses

---

## 11. Frontend Information Architecture Proposal

```
┌─────────────────────────────────────────────────────────────┐
│                        HEADER BAR                           │
│  [Provider: OpenAI ▾] [Model: GPT-5 ▾] [Reasoning: Med ▾] │
│                                    Token: 1,542/400K (0.4%) │
├──────────┬──────────────────────────────────┬───────────────┤
│          │                                  │               │
│ SIDEBAR  │         CHAT PANEL               │  VISIBILITY   │
│          │                                  │    PANEL      │
│ [+ New]  │  ┌──────────────────────────┐    │   (drawer/    │
│          │  │ User: What are the best  │    │    slide-out) │
│ ● Chat 1 │  │ JS frameworks in 2026?   │    │               │
│   Chat 2 │  └──────────────────────────┘    │  [Payload]    │
│   Chat 3 │                                  │  [Tokens]     │
│   Chat 4 │  ┌──────────────────────────┐    │  [Reasoning]  │
│   Chat 5 │  │ 🔍 Searching the web... │    │  [Summary]    │
│          │  │ ✓ Generating queries     │    │  [Tool Trace] │
│          │  │ ● Searching...           │    │               │
│          │  │ ○ Filtering              │    │               │
│          │  │ ○ Checking coverage      │    │               │
│          │  └──────────────────────────┘    │               │
│          │                                  │               │
│          │  ┌──────────────────────────┐    │               │
│          │  │ Assistant: Based on my   │ [👁]│               │
│          │  │ research, here are...    │    │               │
│          │  │              GPT-5 · Med │    │               │
│          │  └──────────────────────────┘    │               │
│          │                                  │               │
│          │  ┌──────────────────────────┐    │               │
│          │  │ [Type a message...   ] [↵]│    │               │
│          │  └──────────────────────────┘    │               │
├──────────┴──────────────────────────────────┴───────────────┤
│ OAI: 1,542 │ Anthropic: 1,489 │ OR: 1,610  │ Out: 387     │
└─────────────────────────────────────────────────────────────┘
```

**Layout notes:**
- Three-column layout: sidebar (fixed width, ~260px), chat (flex), visibility (drawer, ~400px, toggled per message)
- Visibility panel opens when user clicks the inspect button [👁] on an assistant message
- Token bar at bottom shows all three provider counts always visible
- Header controls persist across conversation switches (model selection is global, not per-conversation)
- Tool execution steps shown inline in the chat panel as a compact stepper
- Sidebar scrollable, chat scrollable (auto-scroll to bottom on new tokens)
