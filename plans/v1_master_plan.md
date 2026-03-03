# Wayne v1 — Master Implementation Plan

**Spec:** `spec/v1_spec.md` (v1.1, 2026-03-02)
**Model Reference:** `docs/llm_models_reference.md`

---

## Context

Wayne is a greenfield personal chatbot with multi-provider LLM support, a pluggable tool framework, web search, rolling conversation memory, and full transparency into every internal process. This master plan defines the architecture, database schema, subsystem boundaries, interface contracts, and build order. Each subsystem will get its own detailed sub-plan referencing this document.

---

## 1. Project Structure

```
wayne_bot/
├── docker-compose.yml
├── pyproject.toml
├── alembic.ini
├── .env / .env.example
│
├── src/
│   ├── backend/
│   │   ├── __init__.py
│   │   ├── main.py                     # FastAPI app, lifespan, CORS, mount routes
│   │   ├── config.py                   # Pydantic Settings
│   │   ├── database.py                 # Async engine, session factory, get_db
│   │   ├── exceptions.py              # Error hierarchy
│   │   │
│   │   ├── models/                     # SQLAlchemy ORM
│   │   │   ├── __init__.py
│   │   │   ├── base.py                 # DeclarativeBase, common mixins
│   │   │   ├── conversation.py
│   │   │   ├── message.py
│   │   │   ├── visibility.py
│   │   │   └── rolling_summary.py
│   │   │
│   │   ├── schemas/                    # Pydantic request/response
│   │   │   ├── __init__.py
│   │   │   ├── conversations.py
│   │   │   ├── messages.py
│   │   │   ├── visibility.py
│   │   │   ├── models_list.py
│   │   │   ├── ws.py
│   │   │   └── tools.py
│   │   │
│   │   ├── routes/                     # FastAPI routers
│   │   │   ├── __init__.py
│   │   │   ├── conversations.py
│   │   │   ├── models.py
│   │   │   ├── visibility.py
│   │   │   └── ws.py
│   │   │
│   │   ├── services/                   # Business logic
│   │   │   ├── __init__.py
│   │   │   ├── chat.py                 # Central orchestrator
│   │   │   ├── conversation.py
│   │   │   ├── auto_title.py
│   │   │   ├── rolling_summary.py
│   │   │   ├── token_counter.py
│   │   │   ├── visibility.py
│   │   │   └── system_prompt.py
│   │   │
│   │   ├── providers/                  # LLM provider abstraction
│   │   │   ├── __init__.py
│   │   │   ├── base.py                 # LLMProvider protocol, ChatMessage, StreamEvent
│   │   │   ├── openai.py
│   │   │   ├── anthropic.py
│   │   │   ├── openrouter.py
│   │   │   ├── registry.py
│   │   │   └── model_catalog.py
│   │   │
│   │   ├── tools/                      # Pluggable tool framework
│   │   │   ├── __init__.py
│   │   │   ├── framework.py            # Registry, schema normalization, routing
│   │   │   ├── base.py                 # Abstract Tool interface
│   │   │   └── web_search/
│   │   │       ├── __init__.py
│   │   │       ├── tool.py             # Tool registration entry point
│   │   │       ├── harness.py          # 5-step pipeline orchestrator
│   │   │       ├── tavily_client.py
│   │   │       └── filters.py          # Deterministic filtering
│   │   │
│   │   └── migrations/
│   │       ├── env.py
│   │       ├── script.py.mako
│   │       └── versions/
│   │
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── index.css
│           ├── components/
│           │   ├── ui/                  # shadcn/ui
│           │   ├── chat/
│           │   │   ├── ChatPanel.tsx
│           │   │   ├── MessageList.tsx
│           │   │   ├── MessageBubble.tsx
│           │   │   ├── ChatInput.tsx
│           │   │   └── StreamingIndicator.tsx
│           │   ├── sidebar/
│           │   │   ├── Sidebar.tsx
│           │   │   ├── ConversationItem.tsx
│           │   │   └── NewChatButton.tsx
│           │   ├── header/
│           │   │   ├── Header.tsx
│           │   │   ├── ModelSelector.tsx
│           │   │   └── ReasoningSelector.tsx
│           │   ├── visibility/
│           │   │   ├── VisibilityPanel.tsx
│           │   │   ├── PayloadView.tsx
│           │   │   ├── TokenDisplay.tsx
│           │   │   ├── ReasoningView.tsx
│           │   │   ├── SummaryEventView.tsx
│           │   │   └── ToolTraceView.tsx
│           │   └── search/
│           │       └── SearchProgress.tsx
│           ├── hooks/
│           │   ├── useWebSocket.ts
│           │   ├── useChat.ts
│           │   └── useModels.ts
│           ├── stores/
│           │   ├── chatStore.ts
│           │   ├── modelStore.ts
│           │   └── visibilityStore.ts
│           ├── lib/
│           │   ├── api.ts
│           │   └── types.ts
│           └── utils/
│               └── formatters.ts
│
├── tests/
│   ├── conftest.py
│   ├── factories.py
│   ├── unit/
│   │   ├── test_token_counter.py
│   │   ├── test_rolling_summary.py
│   │   ├── test_tool_framework.py
│   │   ├── test_search_filters.py
│   │   └── test_providers/
│   │       ├── test_openai.py
│   │       ├── test_anthropic.py
│   │       └── test_openrouter.py
│   └── integration/
│       ├── test_conversations_api.py
│       ├── test_chat_flow.py
│       ├── test_visibility_api.py
│       └── test_websocket.py
│
├── spec/
├── docs/
└── plans/
```

---

## 2. Database Schema

### conversations

```sql
CREATE TABLE conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255),                -- NULL until auto-titled
    last_model_id   VARCHAR(100),
    last_provider   VARCHAR(20),                 -- "openai" | "anthropic" | "openrouter"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
```

### messages

```sql
CREATE TYPE message_role AS ENUM (
    'user', 'assistant', 'system', 'tool_call', 'tool_result', 'summary'
);

CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role                message_role NOT NULL,
    content             TEXT,

    -- Model attribution (assistant messages)
    model_id            VARCHAR(100),
    provider            VARCHAR(20),
    reasoning_level     VARCHAR(20),

    -- Tool call fields (role = tool_call)
    tool_call_id        VARCHAR(100),
    tool_name           VARCHAR(50),
    tool_arguments      JSONB,

    -- Tool result fields (role = tool_result)
    tool_result_call_id VARCHAR(100),
    tool_result_name    VARCHAR(50),

    -- Ordering
    sequence            INTEGER NOT NULL,        -- Monotonic within conversation
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, sequence);
```

**Why `sequence`:** Messages within a single exchange (user, tool_call, tool_result, assistant) have near-identical timestamps. Explicit sequence guarantees deterministic ordering for context assembly.

### visibility_records

```sql
CREATE TABLE visibility_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id          UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,

    request_payload     JSONB NOT NULL,
    response_metadata   JSONB,

    tokens_openai       INTEGER,
    tokens_anthropic    INTEGER,
    tokens_openrouter   INTEGER,
    output_tokens       INTEGER,

    context_window_size INTEGER,
    active_token_count  INTEGER,

    reasoning_content   TEXT,
    summary_event       JSONB,
    tool_trace          JSONB,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### rolling_summaries

```sql
CREATE TABLE rolling_summaries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id         UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary_text            TEXT NOT NULL,
    summarized_message_ids  UUID[] NOT NULL,
    tokens_before           INTEGER NOT NULL,
    tokens_after            INTEGER NOT NULL,
    model_used              VARCHAR(100) NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_summaries_conversation ON rolling_summaries(conversation_id, created_at);
```

---

## 3. Interface Contracts

### 3.1 Provider Abstraction

```python
# providers/base.py — the types that flow through the entire system

@dataclass
class ChatMessage:
    role: Literal["user", "assistant", "system", "tool_call", "tool_result"]
    content: str | None = None
    tool_calls: list[ToolCallData] | None = None
    tool_call_id: str | None = None
    tool_name: str | None = None

@dataclass
class StreamEvent:
    type: Literal["token", "tool_call", "reasoning", "done", "error"]
    content: str = ""
    tool_call: ToolCallData | None = None
    metadata: dict | None = None
    error: str | None = None

class LLMProvider(Protocol):
    async def stream_chat(
        self,
        messages: list[ChatMessage],
        model_id: str,
        reasoning_level: str | None = None,
        tools: list[ToolSchema] | None = None,
    ) -> AsyncIterator[StreamEvent]: ...

    async def complete(
        self,
        messages: list[ChatMessage],
        model_id: str,
        response_format: dict | None = None,
    ) -> CompletionResult: ...
```

**Provider-specific translation:**
- **OpenAI:** Direct mapping. Reasoning → `reasoning.effort`. Tools → `functions`.
- **Anthropic:** `system` extracted to top-level param. Tools → `tool_use` blocks. Thinking → `thinking` param.
- **OpenRouter:** OpenAI-compatible format via httpx. DeepSeek R1 reasoning parsed from `<think>` tags.

### 3.2 Tool Framework Interface

```python
# tools/base.py
class Tool(ABC):
    name: str
    description: str
    parameters: dict  # JSON Schema

    @abstractmethod
    async def execute(
        self, arguments: dict, context: ToolContext,
    ) -> ToolResult: ...

@dataclass
class ToolResult:
    content: str | dict
    trace: list[ToolStep]

@dataclass
class ToolStep:
    name: str
    status: Literal["running", "complete", "error"]
    data: dict
    duration_ms: int

# tools/framework.py
class ToolFramework:
    def register(self, tool: Tool) -> None: ...
    def get_schemas_for_provider(self, provider: str) -> list[dict]: ...
    async def execute_tool_call(
        self, tool_name: str, arguments: dict, context: ToolContext,
        on_step: Callable[[ToolStep], Awaitable[None]],
    ) -> ToolResult: ...
    def supports_tools(self, model_id: str) -> bool: ...
```

### 3.3 WebSocket Protocol

**Client → Server:**
```json
{ "type": "send_message", "content": "...", "model_id": "gpt-5", "provider": "openai", "reasoning_level": "medium" }
```

**Server → Client:**
```
stream_token        { type, content }
stream_reasoning    { type, content }
tool_call_start     { type, tool_name, arguments }
tool_step           { type, step_name, step_index, status, data }
stream_done         { type, message_id, visibility_id, token_counts, context_utilization }
summary_started     { type }
summary_complete    { type }
title_updated       { type, conversation_id, title }
error               { type, message, recoverable }
```

### 3.4 REST API

```
POST   /api/conversations                         → ConversationResponse
GET    /api/conversations                          → list[ConversationSummary]
GET    /api/conversations/{id}                     → ConversationDetail (with messages)
PATCH  /api/conversations/{id}  { title }          → ConversationResponse
DELETE /api/conversations/{id}                     → 204

GET    /api/models                                 → { providers: { openai: {...}, anthropic: {...}, openrouter: {...} } }
GET    /api/models/openrouter/refresh              → { models: [...] }

GET    /api/messages/{id}/visibility               → VisibilityRecord
GET    /api/conversations/{id}/token-counts        → TokenCounts

GET    /api/health                                 → { status, providers: { openai: bool, ... } }

WS     /ws/{conversation_id}
```

---

## 4. Subsystem Decomposition

### Unit F — Foundation

| | |
|---|---|
| **Spec sections** | §2.1, §7.1, §9, §10, §14 |
| **Creates** | docker-compose.yml, alembic.ini, .env.example, config.py, database.py, exceptions.py, all ORM models, base schemas, system_prompt.py, main.py shell, migrations, conftest.py, factories.py |
| **Depends on** | Nothing |
| **Exposes** | `get_db()`, `Settings`, `SYSTEM_PROMPT`, all SQLAlchemy models, base Pydantic schemas |
| **Verification** | `docker compose up -d` starts Postgres. `alembic upgrade head` succeeds. `pytest` with a basic DB connectivity test passes. FastAPI starts and serves `GET /api/health`. |

### Unit P — Provider Layer

| | |
|---|---|
| **Spec sections** | §3.1, §3.2, §3.3, §8.1 |
| **Creates** | All files in `providers/`, `routes/models.py`, `schemas/models_list.py` |
| **Depends on** | Unit F (config for API keys) |
| **Exposes** | `LLMProvider` protocol, `ProviderRegistry`, `ChatMessage`/`StreamEvent` types, model catalog, `GET /api/models` |
| **Verification** | Unit tests with mocked HTTP for each provider. Test `stream_chat` yields correct StreamEvent sequences for: normal response, response with reasoning, response with tool_call. |

### Unit C — Chat Core

| | |
|---|---|
| **Spec sections** | §2.2, §2.3, §8.1, §8.3, §9.1, §9.2 |
| **Creates** | `services/chat.py`, `services/conversation.py`, `services/auto_title.py`, `routes/conversations.py`, `routes/ws.py`, `schemas/conversations.py`, `schemas/messages.py`, `schemas/ws.py` |
| **Depends on** | Unit F + Unit P |
| **Exposes** | Conversation CRUD API, WebSocket endpoint, `ChatService.handle_user_message()` |
| **Verification** | Integration tests: create conversation, send message (mocked provider), verify persistence. WebSocket test: connect, send, receive stream events. Auto-title fires after first exchange. |

### Unit S — Rolling Summary

| | |
|---|---|
| **Spec sections** | §4.1–4.6 |
| **Creates** | `services/token_counter.py`, `services/rolling_summary.py`, tests |
| **Depends on** | Unit F + Unit P (lightweight provider for summary gen, Anthropic for count_tokens) |
| **Exposes** | `TokenCounter` (three methods + context window lookup), `RollingSummaryService.check_and_summarize()` |
| **Verification** | Unit tests for each counting method. Integration test: conversation exceeds threshold → summary generated → context compressed. Edge cases: threshold not reached (no-op), model switch. |

### Unit T — Tool Framework + Web Search

| | |
|---|---|
| **Spec sections** | §5.1–5.5 |
| **Creates** | All files in `tools/`, `schemas/tools.py`, tests |
| **Depends on** | Unit F + Unit P (lightweight provider for harness LLM calls) |
| **Exposes** | `ToolFramework` (register, get_schemas, execute), `WebSearchTool` |
| **Verification** | Unit test tool registration + schema normalization for all 3 providers. Unit test deterministic filters. Integration test full harness with mocked Tavily + mocked lightweight LLM. Test failure paths: Tavily retry/abort, coverage loop cap. |

### Unit V — Visibility Layer

| | |
|---|---|
| **Spec sections** | §6.1–6.3, §4.6, §5.5 |
| **Creates** | `services/visibility.py`, `routes/visibility.py`, `schemas/visibility.py`, tests |
| **Depends on** | Unit F + Unit S (token counter) |
| **Exposes** | `VisibilityService.capture()`, `GET /api/messages/{id}/visibility`, `GET /api/conversations/{id}/token-counts` |
| **Verification** | Integration test: after chat exchange, visibility record exists with all fields. Test async token count population. API endpoint returns correct data. |

### Unit FE — Frontend

| | |
|---|---|
| **Spec sections** | §2.2, §2.3, §3.1 (UI), §4.5, §6.3, §8, §11.6 |
| **Creates** | Everything under `src/frontend/` |
| **Depends on** | All backend units (consumes REST + WebSocket) |
| **Verification** | Dev server starts. All user flows work manually. Vitest tests for critical flows. |

---

## 5. Build Order

```
Phase 1: Unit F  (Foundation)
    ↓
Phase 2: Unit P  (Provider Layer)
    ↓
Phase 3: Unit C  (Chat Core — basic chat loop works end-to-end)
    ↓
Phase 4: Unit S  (Rolling Summary)  ← can parallel with Unit T
Phase 4: Unit T  (Tool Framework + Web Search)  ← can parallel with Unit S
    ↓
Phase 5: Unit V  (Visibility Layer)
    ↓
Phase 6: Unit C+ (Wire S, T, V into chat orchestrator)
    ↓
Phase 7: Unit FE (Frontend)
```

**Milestones:**
| Phase | What works |
|-------|------------|
| 1 | DB runs, app starts, schema created |
| 2 | Can call any LLM provider programmatically, model list API works |
| 3 | Can chat via WebSocket, messages persist, auto-title works |
| 4 | Rolling summary triggers; web search harness runs end-to-end |
| 5 | Visibility data captured and queryable |
| 6 | Full backend — all features wired together |
| 7 | Complete app with UI |

---

## 6. Shared Patterns

### Error Handling

```python
# exceptions.py
class WayneError(Exception):
    status_code: int = 500
    detail: str = "Internal server error"

class ProviderError(WayneError):       # status 502
class ProviderKeyMissing(WayneError):  # status 422
class ToolExecutionError(WayneError):  # status 502
class TokenCountError(WayneError):     # status 500
```

WebSocket errors: `{ type: "error", message, recoverable }`. Connection stays open for recoverable errors.

### Configuration

Single `Settings` class (Pydantic Settings v2) loading from `.env`:

```python
class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://wayne:wayne@localhost:5432/wayne"
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    openrouter_api_key: str = ""
    tavily_api_key: str = ""
    lightweight_model: str = "gpt-5-nano"
    summary_threshold: float = 0.80
    summary_budget: float = 0.50
    tavily_score_threshold: float = 0.75
    tavily_date_threshold_days: int = 365
    tavily_domain_blacklist: list[str] = []
    search_max_retries: int = 2
    host: str = "0.0.0.0"
    port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173"]
```

### Database Sessions

`get_db()` async generator with commit/rollback. For WebSocket handlers, create sessions per operation (not per connection).

### Testing

- **pytest-asyncio** for async tests
- Provider mocking at the `LLMProvider` protocol level (not HTTP level) for fast business logic tests
- Provider implementation tests use `respx` for mocked HTTP
- Test DB: same Docker Postgres, separate `wayne_test` database
- `conftest.py`: transactional session fixture (create/drop tables per test)

### Logging

Standard `logging` module. Each module: `logger = logging.getLogger(__name__)`. Provider calls at INFO. Full payloads at DEBUG.

---

## 7. Key Architectural Decisions

1. **Sequence numbers on messages** — deterministic ordering for context assembly
2. **Visibility as separate table** — keeps messages lean, allows rich JSONB for inspection
3. **Protocol not base class** for providers — Pythonic duck typing, easier testing
4. **Chat service as single orchestrator** — `handle_user_message()` coordinates all subsystems; WebSocket route stays thin
5. **Tool step callbacks** — harness streams progress via `on_step` callback for real-time WebSocket updates
6. **Async token counting** — active provider blocks (needed for threshold), other two are fire-and-forget
7. **Frontend built last** — all backend APIs are stable before UI work begins

---

## 8. Verification Strategy

Each sub-plan will include its own test suite. The overall verification sequence:

1. **Per-unit:** Each subsystem passes its own tests before the next begins
2. **Integration (Phase 6):** Full chat flow with all features wired together — send message → rolling summary triggers → search tool fires → visibility captured
3. **End-to-end (Phase 7):** Frontend connects, all user flows work, acceptance criteria from spec §12 verified
4. **Final:** All 15 acceptance criteria (spec §12) checked off
