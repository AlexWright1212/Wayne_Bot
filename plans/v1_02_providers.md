# Unit P — Provider Layer

**Spec sections:** §3.1, §3.2, §3.3, §8.1
**Consult:** `spec/v1_spec.md`, `plans/v1_master_plan.md` (§3.1 for provider protocol, §3.5 for visibility service interface), `docs/llm_models_reference.md`

## Overview

The provider layer abstracts OpenAI, Anthropic, and OpenRouter behind a unified `LLMProvider` protocol. Each provider translates between Wayne's internal `ChatMessage`/`StreamEvent` types and the provider's native API format. This unit also includes the model catalog (static + dynamic), the provider registry, and the `GET /api/models` endpoint.

## Dependencies

- **Unit F** must be complete: this unit consumes `Settings` for API keys and `get_db()` is available (though not used directly by providers). Read `src/backend/config.py` to understand the `Settings` class.
- Uses the `ChatMessage`, `StreamEvent`, and `LLMProvider` protocol defined in master plan §3.1.

## Files to Create

- `src/backend/providers/__init__.py` — Re-exports key types and registry
- `src/backend/providers/base.py` — Protocol, dataclasses (`ChatMessage`, `StreamEvent`, `ToolCallData`, `CompletionResult`, `ToolSchema`)
- `src/backend/providers/openai.py` — OpenAI SDK provider implementation
- `src/backend/providers/anthropic.py` — Anthropic SDK provider implementation
- `src/backend/providers/openrouter.py` — OpenRouter httpx provider implementation
- `src/backend/providers/registry.py` — Provider registry (instantiation, lookup)
- `src/backend/providers/model_catalog.py` — Static model definitions + OpenRouter dynamic fetch
- `src/backend/schemas/models_list.py` — Pydantic response schemas for model list API
- `src/backend/routes/models.py` — `GET /api/models`, `GET /api/models/openrouter/refresh`
- `tests/unit/test_providers/test_openai.py` — OpenAI provider tests
- `tests/unit/test_providers/test_anthropic.py` — Anthropic provider tests
- `tests/unit/test_providers/test_openrouter.py` — OpenRouter provider tests

## Architecture & Key Decisions

1. **Protocol, not base class.** `LLMProvider` is a `typing.Protocol`. Providers are structurally typed — no inheritance required. This enables easy mocking in downstream units.

2. **Two methods per provider:** `stream_chat` (async generator yielding `StreamEvent`) for user-facing chat, and `complete` (returns `CompletionResult`) for internal utility calls (summaries, auto-title, harness plumbing). `complete` is non-streaming and supports `response_format` for JSON mode.

3. **Provider-specific translation is encapsulated.** Each provider file handles all format conversion internally. Consumers only see `ChatMessage` in and `StreamEvent` out.

4. **Model catalog is a simple module-level data structure.** No database table for models — a dict of static models for OpenAI/Anthropic, plus a cached list for OpenRouter fetched via API. Context windows live here.

5. **Registry is a thin lookup.** Maps provider name strings to instantiated provider objects. Constructed at app startup using `Settings`.

## Implementation Steps

### Phase 1 — Base Types

#### Step 1: `providers/base.py`

Define the shared types that flow through the entire system. Implement the protocol and dataclasses from master plan §3.1.

- `ToolCallData` needs: `id` (str), `name` (str), `arguments` (str — raw JSON, not parsed dict). Providers parse their native format into this.
- `ToolSchema` is a simple dataclass wrapping `name`, `description`, `parameters` (dict — JSON Schema). Used internally by the tool framework (Unit T) during tool registration. `ToolFramework.get_schemas_for_provider()` translates registered tools into provider-specific `list[dict]` — providers receive these already-formatted dicts via `stream_chat()` and pass them through to the API directly. Providers do NOT consume `ToolSchema` objects.
- `CompletionResult` dataclass: `content` (str), `tool_calls` (list[ToolCallData] | None), `metadata` (dict — raw response metadata like usage, finish_reason).
- `StreamEvent.metadata` carries provider-specific info. For `done` events: include `usage` dict (prompt_tokens, completion_tokens) and `finish_reason`.
- Export a `REASONING_LEVELS` dict mapping provider name to list of valid reasoning level strings. OpenAI: `["none", "low", "medium", "high", "xhigh"]`. Anthropic: `["off", "low", "medium", "high", "adaptive"]`. OpenRouter: `[]` (reasoning is model-dependent, not user-controlled).

#### Step 2: `providers/__init__.py`

Re-export `ChatMessage`, `StreamEvent`, `LLMProvider`, `ToolCallData`, `CompletionResult`, `ProviderRegistry` for clean imports.

**Smoke check:** Import `from src.backend.providers.base import ChatMessage, LLMProvider` in a Python shell — verify no import errors.

### Phase 2 — Provider Implementations

#### Step 3: `providers/openai.py`

OpenAI provider using the `openai` async SDK.

- Instantiate `AsyncOpenAI(api_key=...)` in `__init__`.
- **`stream_chat`:** Use `client.chat.completions.create(stream=True, ...)`. Iterate over chunks, yield `StreamEvent` for each.
  - Map `ChatMessage` list to OpenAI's message format. Roles map 1:1 except: `tool_call` role → OpenAI `assistant` message with `tool_calls` array; `tool_result` role → OpenAI `tool` role with `tool_call_id`.
  - Reasoning: if `reasoning_level` is not None and not `"none"`, pass `reasoning={"effort": reasoning_level}`. The SDK handles reasoning summary opt-in — include `reasoning_summaries="concise"` in the create call when reasoning is active.
  - Reasoning content arrives as `reasoning` deltas in the stream. Yield as `StreamEvent(type="reasoning")`.
  - Tool calls arrive as `tool_calls` deltas across multiple chunks. Accumulate `tool_call` fragments (id, name, arguments are streamed incrementally), yield a single `StreamEvent(type="tool_call")` with the complete `ToolCallData` once the tool call is fully assembled.
  - Tools: the `tools` parameter receives pre-translated dicts from `ToolFramework.get_schemas_for_provider("openai")` — they are already in OpenAI function calling format (`{"type": "function", "function": {...}}`). Pass them directly to the API's `tools` parameter without any transformation.
- **`complete`:** Non-streaming `chat.completions.create(...)`. Parse response into `CompletionResult`. Support `response_format={"type": "json_object"}` for JSON mode.
- **Error handling:** Catch `openai.APIError` and subclasses, wrap in `ProviderError` from `exceptions.py`. Include the HTTP status code and error message.

#### Step 4: `providers/anthropic.py`

Anthropic provider using the `anthropic` async SDK.

- Instantiate `AsyncAnthropic(api_key=...)` in `__init__`.
- **`stream_chat`:** Use `client.messages.stream(...)`. Key translation points:
  - **System message extraction:** Anthropic doesn't accept `system` role in the messages array. Extract system messages, concatenate their content, pass as the top-level `system` parameter.
  - **Message role mapping:** `user` and `assistant` map directly. `tool_call` → not sent as a separate message; instead, reconstruct the assistant message with `tool_use` content blocks. `tool_result` → `user` role message with `tool_result` content block containing `tool_use_id`.
  - **Consecutive same-role messages:** Anthropic requires strict user/assistant alternation. If consecutive messages have the same role after translation, merge them into a single message with multiple content blocks.
  - **Reasoning:** Map Wayne's reasoning levels to Anthropic's thinking config:
    - `"off"` → no thinking param
    - `"adaptive"` → `thinking={"type": "adaptive"}`
    - `"low"/"medium"/"high"` → `thinking={"type": "adaptive"}` with appropriate effort hint (consult model reference for exact parameter mapping)
  - **Thinking content** arrives as `thinking` events in the stream. Yield as `StreamEvent(type="reasoning")`.
  - Tool calls arrive as `tool_use` content blocks. Yield `StreamEvent(type="tool_call")`.
  - Tools: the `tools` parameter receives pre-translated dicts from `ToolFramework.get_schemas_for_provider("anthropic")` — they are already in Anthropic format (`{"name", "description", "input_schema"}`). Pass them directly to the API's `tools` parameter without any transformation.
- **`complete`:** Non-streaming `client.messages.create(...)`. Parse into `CompletionResult`.
- **Error handling:** Catch `anthropic.APIError`, wrap in `ProviderError`.

#### Step 5: `providers/openrouter.py`

OpenRouter provider using raw `httpx.AsyncClient`.

- Instantiate httpx client with base URL `https://openrouter.ai/api/v1` and auth header.
- **`stream_chat`:** POST to `/chat/completions` with `stream: true`. Parse SSE lines manually.
  - Message format is OpenAI-compatible — same translation as the OpenAI provider.
  - **DeepSeek R1 reasoning:** R1's reasoning is embedded in the response content between `<think>` and `</think>` tags. During streaming, detect these tags and yield content between them as `StreamEvent(type="reasoning")` instead of `StreamEvent(type="token")`. Track state with a simple boolean flag (`in_think_block`).
  - Tool calling uses OpenAI-compatible function calling format. The `tools` parameter receives pre-translated dicts from `ToolFramework.get_schemas_for_provider("openrouter")` — same format as OpenAI. Pass them directly to the API.
  - Add OpenRouter-specific headers: `HTTP-Referer` (can be app name), `X-Title` (app name).
- **`complete`:** Non-streaming POST. Parse JSON response into `CompletionResult`.
- **SSE parsing:** Parse `data: [JSON]` lines. Handle `data: [DONE]` terminator. Skip empty lines and comments.
- **Error handling:** Check HTTP status codes. Wrap errors in `ProviderError` with the error body from OpenRouter's response.

**Smoke check:** Write a quick script that instantiates each provider with a dummy API key and verifies the classes satisfy the `LLMProvider` protocol (use `isinstance` check or `typing.runtime_checkable`).

### Phase 3 — Model Catalog & Registry

#### Step 6: `providers/model_catalog.py`

Static model definitions and OpenRouter dynamic model fetching.

- Define a `ModelInfo` dataclass: `id` (str), `name` (str — display name), `provider` (str), `context_window` (int), `supports_tools` (bool), `supports_reasoning` (bool), `reasoning_type` (str | None — "effort", "thinking", "builtin", None).
- **Static models** — hardcode as a dict keyed by model ID:
  - OpenAI: `gpt-5.2`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`. Context window: 400,000 for all. Max output: 128,000. All support tools and reasoning.
  - Anthropic: `claude-opus-4-6-20250130`, `claude-sonnet-4-6-20250514`, `claude-haiku-4-5-20251001`. Context window: 200,000. All support tools and reasoning.
- **OpenRouter dynamic fetch:** `async def fetch_openrouter_models(api_key: str) -> list[ModelInfo]`. GET `https://openrouter.ai/api/v1/models` via httpx. Parse response into `ModelInfo` objects. Context window comes from the API response's `context_length` field. `supports_tools` — check if the model's metadata indicates function calling support (OpenRouter includes this). Cache the result in-memory.
- **`get_context_window(model_id, provider)`** — lookup function used by TokenCounter (Unit S). For static models, direct dict lookup. For OpenRouter, check cached dynamic models.
- **`get_all_models()`** — returns the full catalog grouped by provider. Used by the models API endpoint.

#### Step 7: `providers/registry.py`

Simple provider registry.

- `ProviderRegistry` class. Constructor takes `Settings`, instantiates each provider if its API key is non-empty.
- `get(provider_name: str) -> LLMProvider` — returns the provider instance. Raises `ProviderKeyMissing` if the provider has no API key configured.
- `available_providers() -> list[str]` — returns names of providers with configured keys.
- Store as a dict: `{"openai": OpenAIProvider(...), "anthropic": AnthropicProvider(...), "openrouter": OpenRouterProvider(...)}`.

**Smoke check:** In a test or script, create a `ProviderRegistry` with mock settings and verify `get("openai")` returns an `OpenAIProvider` instance.

### Phase 4 — API Layer

#### Step 8: `schemas/models_list.py`

Pydantic response schemas for the model list endpoint.

- `ModelResponse`: id, name, provider, context_window, supports_tools, supports_reasoning, reasoning_levels (list[str]).
- `ProviderModels`: provider name, available (bool — key configured), models (list[ModelResponse]).
- `ModelsListResponse`: providers dict keyed by provider name.

#### Step 9: `routes/models.py`

Two endpoints:

- `GET /api/models` — returns all models grouped by provider. For each provider, include whether the API key is configured. OpenRouter models come from the cached dynamic list (fetch on first request if not yet cached).
- `GET /api/models/openrouter/refresh` — forces a re-fetch of the OpenRouter model list. Returns the updated list.
- Wire this router into `main.py` (add `app.include_router(models_router, prefix="/api")`).

**Smoke check:** Start the app, `curl http://localhost:8000/api/models`. Verify response includes all three providers with their model lists. Providers without keys should show `available: false`.

### Phase 5 — Tests

#### Step 10: Provider unit tests

Use `respx` to mock HTTP responses at the transport level. Each provider gets its own test file.

**For each provider, test these scenarios:**
1. **Normal response stream:** Mock a streamed response with text tokens. Assert `stream_chat` yields `StreamEvent(type="token")` events followed by `StreamEvent(type="done")`.
2. **Response with reasoning:** Mock a response that includes reasoning content. Assert reasoning events are yielded with `type="reasoning"`.
3. **Response with tool call:** Mock a response where the model calls a tool. Assert a `StreamEvent(type="tool_call")` is yielded with correct `ToolCallData`.
4. **`complete` method:** Mock a non-streaming response. Assert `CompletionResult` has correct content and metadata.
5. **Error handling:** Mock an API error response. Assert `ProviderError` is raised with appropriate details.

**Provider-specific tests:**
- **Anthropic:** Test system message extraction (system messages removed from array, passed as parameter). Test consecutive same-role message merging.
- **OpenRouter:** Test DeepSeek R1 `<think>` tag parsing — reasoning content correctly split from response content during streaming.
- **OpenRouter:** Test SSE line parsing with various edge cases (empty lines, `[DONE]` terminator).

**Model catalog tests:**
- Test static model lookup returns correct `ModelInfo`.
- Test `get_context_window` for known models.
- Mock the OpenRouter models API and test `fetch_openrouter_models` parses correctly.

**Registry tests:**
- Test that providers with empty API keys are not instantiated.
- Test `get()` raises `ProviderKeyMissing` for unconfigured providers.

## Error Handling

- All provider errors wrap in `ProviderError(status_code=502)` — the error originates from an upstream API.
- Missing API keys raise `ProviderKeyMissing(status_code=422)` — a configuration error, not a runtime failure.
- OpenRouter model fetch failures: log warning, return empty model list for OpenRouter. Don't crash the app or affect other providers.
- Network timeouts: let httpx/SDK timeouts propagate, catch and wrap in `ProviderError`.

## Completion Criteria

1. All three providers implement `LLMProvider` protocol and can be instantiated via `ProviderRegistry`
2. `stream_chat` yields correct `StreamEvent` sequences for normal text, reasoning, and tool call responses (verified via mocked HTTP tests)
3. `complete` returns `CompletionResult` with content and metadata for all three providers
4. Anthropic provider correctly extracts system messages and handles message role translation
5. OpenRouter provider correctly parses DeepSeek R1 `<think>` tags into reasoning events
6. Model catalog returns correct static models for OpenAI/Anthropic and fetches dynamic models from OpenRouter
7. `GET /api/models` returns all providers with availability status and model lists
8. `GET /api/models/openrouter/refresh` triggers a fresh fetch of OpenRouter models
9. All provider tests pass with mocked HTTP (no real API calls)

## Implementation Notes

### Mocking async SDK methods in tests

The OpenAI and Anthropic SDKs expose async methods (`create`, `stream`). Tests must use `AsyncMock` as the replacement (not `patch(return_value=...)` which creates a sync `MagicMock`). For streaming tests, a custom `_AsyncChunkIterator` class wraps a list of mock chunks into a proper async iterator.

### runtime_checkable Protocol with async methods

`isinstance(provider, LLMProvider)` may hang or produce no output in Python 3.13. The Protocol still works structurally — just don't use runtime isinstance checks. Tests verify behavior directly instead.

### Anthropic max_tokens

The Anthropic provider hardcodes `max_tokens=8192` in both `stream_chat` and `complete`. Downstream units that need longer outputs (unlikely for v1) would need to add a parameter for this.
