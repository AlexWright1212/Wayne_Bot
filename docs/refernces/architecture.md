# Wayne Bot — Architecture Reference

## Backend Architecture

### Request Flow

1. **WebSocket** (`/ws/{conversation_id}`) — all chat happens over WS, not HTTP. Client sends `send_message`; server streams back typed events (`stream_token`, `stream_reasoning`, `tool_call_start`, `tool_step`, `stream_done`, `error`, etc.).
2. **`ChatService.handle_user_message()`** (`src/backend/services/chat.py`) — the central async generator orchestrating the full pipeline:
   - Persists user message → assembles history → rolling summary check → streams LLM → tool call sub-loop → persists assistant message → captures visibility → fires auto-title.
3. **Tool sub-loop** — when the LLM emits a `tool_call` event, a background `asyncio.Task` runs the tool and pushes `ToolStep` progress objects through a queue. The generator drains the queue, yielding `tool_step` events, then re-enters the LLM for a follow-up pass (capped at 2 tool rounds).

### Dependency Wiring

All services are module-level singletons in `src/backend/deps.py`. Routes call `get_chat_service()`, `get_conv_service()`, etc. — never instantiate services directly. This makes test overriding straightforward.

### Provider Layer (`src/backend/providers/`)

- `base.py` — abstract `LLMProvider` with `stream_chat()` and `complete()`. Defines `ChatMessage`, `StreamEvent`, `ToolCallData`, `CompletionResult`.
- `registry.py` — `ProviderRegistry` instantiates providers based on which API keys are set in `.env`.
- Three concrete providers: `openai.py`, `anthropic.py`, `openrouter.py`. OpenRouter uses OpenAI-compatible format.
- Tool schemas differ per provider: OpenAI/OpenRouter use `{"type": "function", "function": {...}}` wrapper; Anthropic uses `{"name": ..., "input_schema": ...}`. The `ToolFramework` handles translation.

### Tool Framework (`src/backend/tools/`)

- `base.py` — `Tool` ABC, `ToolContext`, `ToolResult`, `ToolStep` dataclasses.
- `framework.py` — `ToolFramework`: registers tools, routes execution, translates schemas per provider, and gates tool support by model/provider.
- Tools are registered at startup in `deps.py`. Currently: `WebSearchTool` (Tavily).

### Visibility Layer (`src/backend/services/visibility.py`)

Captures the full request/response payload for each assistant message: raw messages sent to the LLM, response metadata, token counts, reasoning content, tool traces, rolling summary metadata, and auto-title data. Stored in the `visibility` table and served via `GET /api/visibility/{message_id}`.

### Rolling Summary (`src/backend/services/rolling_summary.py`)

When the conversation exceeds `summary_threshold` (80%) of the model's context window, the service compresses old messages into a summary record. The `summary_budget` (50%) controls how much of the window the summary may use. The compressed messages replace the full history for the current request.

### Settings (`src/backend/config.py`)

`Settings` uses `pydantic-settings` reading from `.env`. Key fields: `database_url`, `openai_api_key`, `anthropic_api_key`, `openrouter_api_key`, `tavily_api_key`, `lightweight_model`, `summary_threshold`, `summary_budget`, `cors_origins`.

---

## Frontend Architecture

### Request Flow

The frontend connects to the backend exclusively via WebSocket (`/ws/{conversation_id}`). Conversation CRUD (list, create, delete, rename) uses the REST API (`/api/conversations/`). There is no separate HTTP endpoint for sending messages.

### State Management

Zustand stores are the single source of truth for UI state. Components read from stores and dispatch actions — no prop drilling for shared state.

### Component Layer

- shadcn/ui (style: `base-nova`) built on Radix primitives for accessible, unstyled base components.
- Tailwind v4 for styling.
- Community registries configured in `components.json`: `@assistant-ui`, `@shadcnblocks`, `@cult-ui`.

### Markdown Rendering

Assistant messages are rendered with `react-markdown` + `remark-gfm` (GitHub Flavored Markdown) + `rehype-highlight` (syntax highlighting).
