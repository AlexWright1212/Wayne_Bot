# Unit T — Tool Framework + Web Search

**Spec sections:** §5.1–5.5
**Master plan:** `plans/v1_master_plan.md` (§3.2, §4 Unit T)
**Also consult:** `spec/v1_spec.md`, `docs/llm_models_reference.md`

---

## Overview

This unit builds the pluggable tool framework and Wayne's first tool — web search. The framework handles tool registration, per-provider schema normalization, routing, and trace capture. The web search tool implements a 5-step deterministic research harness that uses GPT-5 nano for plumbing and Tavily for search. The harness streams step progress via callbacks for real-time WebSocket updates (wired in Unit V).

---

## Dependencies

| Unit | What this unit consumes |
|------|------------------------|
| **F** | `Settings` (Tavily key, search config thresholds, lightweight model ID), `WayneError` hierarchy |
| **P** | `ChatMessage`, `CompletionResult` types (master plan §3.1) — used in `ToolContext.lightweight_complete` signature. Unit T does **not** instantiate providers or use `ProviderRegistry` directly; the `lightweight_complete` callable is injected by Unit V at wiring time. |

**Files to read from dependencies before implementing:**
- `src/backend/config.py` — settings shape
- `src/backend/exceptions.py` — error base classes
- `src/backend/providers/base.py` — `ChatMessage`, `CompletionResult`, `LLMProvider`

---

## Files to Create

- `src/backend/tools/__init__.py` — Package init, re-exports
- `src/backend/tools/base.py` — Abstract `Tool` interface, `ToolResult`, `ToolStep`, `ToolContext`
- `src/backend/tools/framework.py` — `ToolFramework`: registry, schema normalization, routing
- `src/backend/tools/web_search/__init__.py` — Package init
- `src/backend/tools/web_search/tool.py` — `WebSearchTool` implementing `Tool`, entry point
- `src/backend/tools/web_search/harness.py` — 5-step pipeline orchestrator
- `src/backend/tools/web_search/tavily_client.py` — Thin async httpx wrapper around Tavily API
- `src/backend/tools/web_search/filters.py` — Deterministic result filtering (Step 4)
- `src/backend/schemas/tools.py` — Pydantic schemas for tool-related WS events and API payloads
- `tests/unit/test_tool_framework.py` — Framework unit tests
- `tests/unit/test_search_filters.py` — Deterministic filter unit tests
- `tests/integration/test_search_harness.py` — Full harness integration test (mocked externals)

---

## Architecture & Key Decisions

### ToolContext

The master plan references `ToolContext` in the `Tool.execute()` and `ToolFramework.execute_tool_call()` signatures but doesn't define it. Define it as:

```python
@dataclass
class ToolContext:
    user_message: str           # Original user message (harness needs it for query gen)
    conversation_id: UUID       # For logging/tracing
    lightweight_complete: Callable  # Async callable wrapping provider.complete() for GPT-5 nano
```

`lightweight_complete` is a closure created by the chat service (Unit C/V wiring) that captures the OpenAI provider + `settings.lightweight_model`. This keeps the tool layer decoupled from provider internals — tools call `await context.lightweight_complete(messages)` without knowing which provider or model.

### Schema Normalization

Three formats, but only two actual shapes:
- **OpenAI + OpenRouter:** Identical — `{"type": "function", "function": {"name", "description", "parameters"}}`
- **Anthropic:** `{"name", "description", "input_schema"}` (parameters → input_schema, no function wrapper)

`ToolFramework.get_schemas_for_provider(provider)` handles this translation. Tools register with a single canonical schema (OpenAI format). The framework translates.

### Harness LLM Calls

All plumbing LLM calls (Steps 1, 2 entity extraction, 5 coverage check) use `context.lightweight_complete()` with structured JSON output. Use `response_format={"type": "json_object"}` in the complete call. Each LLM call gets a focused system prompt and the minimum context needed.

### Error Strategy

- `ToolExecutionError` (from `exceptions.py`) wraps all tool failures
- Tavily failures: 1 retry per API call, then abort with structured error (spec §11.4)
- Lightweight model failures: return partial/error result, don't crash (spec §11.5)
- All errors are captured in `ToolStep` trace entries with `status="error"`

---

## Implementation Steps

### Phase 1 — Tool Abstractions

**Step 1: `src/backend/tools/base.py`** — Core types and abstract interface

- Implement `ToolStep`, `ToolResult`, `ToolContext` dataclasses and `Tool` ABC as defined in master plan §3.2
- `ToolContext` shape as described in Architecture section above
- `ToolStep.duration_ms` is populated by the tool (harness), not the framework — the harness records `time.monotonic()` before and after each step's work and sets `duration_ms` before calling `on_step`. The framework has no visibility into per-step timing since steps complete inside `tool.execute()`.

**Step 2: `src/backend/tools/framework.py`** — Registry, normalization, routing

- `ToolFramework` class with register/get_schemas/execute_tool_call/supports_tools as in master plan §3.2
- `register()` stores tools by name in a dict. Duplicate name → raise on startup
- `get_schemas_for_provider()` translates from canonical (OpenAI) format to provider-specific format. Only Anthropic needs translation (see Architecture section)
- `execute_tool_call()` looks up tool by name, wraps execution in try/except, calls `tool.execute()`, and catches unhandled exceptions into `ToolExecutionError`
- `supports_tools(model_id: str, provider: str) -> bool` — **strict allowlist for OpenRouter, True for direct SDK providers.** For `provider == "openai"` or `provider == "anthropic"`, return `True` immediately — all current direct SDK models support tools. For `provider == "openrouter"`, check `model_id` against a `TOOL_CAPABLE_PREFIXES` set and return `False` for anything not on the list, preventing 400 errors and wasted context window tokens on unsupported models:
  ```python
  TOOL_CAPABLE_PREFIXES: set[str] = {
      "openai/",                  # All modern OpenAI models on OpenRouter
      "anthropic/",               # All modern Anthropic models on OpenRouter
      "deepseek/deepseek-chat",   # DeepSeek V3.x (tool-capable)
      "deepseek/deepseek-r1",     # DeepSeek R1 (tool-capable)
      "deepseek/deepseek-coder",  # DeepSeek Coder (tool-capable)
  }
  ```
  Match by checking `any(model_id.startswith(p) for p in TOOL_CAPABLE_PREFIXES)`. Unknown OpenRouter models return `False` and degrade gracefully to standard text chat.
- The `on_step` callback is async — it's how the chat service (Unit V wiring) pushes `tool_step` events over WebSocket

**Step 3: `src/backend/schemas/tools.py`** — Pydantic schemas

- `ToolCallStartEvent`, `ToolStepEvent` — shapes for WebSocket event payloads matching master plan §3.3 WS protocol
- `ToolTraceSchema` — for visibility record serialization
- These are data containers only; the WS route (Unit C/V) serializes and sends them

**Smoke check:** Import all tool modules from a Python shell. No circular imports. `ToolFramework()` instantiates, `register()` and `get_schemas_for_provider()` work with a dummy tool.

### Phase 2 — Tavily Client & Filters

**Step 4: `src/backend/tools/web_search/tavily_client.py`** — Async Tavily wrapper

- Single class `TavilyClient` with `async def search(query: str) -> list[TavilyResult]`
- Uses httpx async client. Tavily endpoint: `POST https://api.tavily.com/search`
- Request body: `{"query": query, "search_depth": "advanced", "include_raw_content": false, "max_results": 10}`
- Parse response into `TavilyResult` dataclass: `title`, `url`, `content` (snippet), `score`, `published_date` (optional)
- Retry logic: on HTTP error or timeout, retry **once** with a brief delay. On second failure, raise `ToolExecutionError` with the HTTP status/message
- Set httpx timeout to 15 seconds per request
- API key from `Settings.tavily_api_key`

**Step 5: `src/backend/tools/web_search/filters.py`** — Deterministic filtering (Step 4 of harness)

- Pure function: `filter_results(results: list[TavilyResult], settings: Settings) -> tuple[list[TavilyResult], list[FilteredOut]]`
- Returns both kept results and a list of what was filtered + why (for visibility trace)
- Four filter rules applied in order:
  1. Score below `settings.tavily_score_threshold` (default 0.75)
  2. Published date older than `settings.tavily_date_threshold_days` (default 365 days). Skip if no date.
  3. Domain in `settings.tavily_domain_blacklist`
  4. Duplicate URL (keep first occurrence)
- `FilteredOut` dataclass: `result`, `reason` (enum: `low_score`, `too_old`, `blacklisted`, `duplicate`)
- This is the most testable part of the unit — all logic is deterministic, no IO

**Smoke check:** Instantiate `TavilyClient` (will fail without key, but class loads). Call `filter_results()` with test data, verify filtering logic.

### Phase 3 — Search Harness

**Step 6: `src/backend/tools/web_search/harness.py`** — 5-step pipeline orchestrator

This is the core of the unit. The `SearchHarness` class orchestrates the full pipeline described in spec §5.3.

- Constructor takes `TavilyClient` and `Settings`
- Main method: `async def run(self, reason: str, query: str, context: ToolContext, on_step: Callable) -> ToolResult`
- Each step is a separate private method returning its output. The harness calls them in sequence, invoking `on_step` after each completes.

**Step 1 — Query Generation:**
- LLM call via `context.lightweight_complete()` with a system prompt asking for `{"ready_queries": [...], "pending_queries": [{"template": "...", "slot": "..."}]}`
- Input: the tool call's `reason`, `query`, and `context.user_message`
- Parse JSON response. If parsing fails, fall back to using `query` as the single ready query

**Step 2 — Execute Ready Queries + Entity Extraction:**
- Call `tavily_client.search()` for each ready query (run concurrently with `asyncio.gather`, but catch individual failures)
- If `pending_queries` exist: make an LLM call to extract entities from results. System prompt: "Given these search results, extract: [slot names]". Parse JSON response.
- If entity extraction fails, skip pending queries (graceful degradation)

**Step 3 — Fill Templates + Round 2:**
- String-replace `{{slot}}` placeholders in pending query templates with extracted entities
- Execute filled queries via Tavily (same concurrent pattern)
- If no pending queries, skip entirely

**Step 4 — Filter:**
- Call `filter_results()` on all collected results
- Report filtered-out items via `on_step` for visibility

**Step 5 — Coverage Check + Retry Loop:**
- LLM call: "Do these results answer: [user_message]? Respond with `{sufficient, missing, confidence}`"
- If `sufficient` is false and retries remain (max 2): generate new queries targeting `missing` items → loop back to Tavily → filter → check again
- Track retry count. After cap, proceed with what's available
- Include `missing` items in the trace so visibility shows gaps

**Result assembly:**
- `ToolResult.content`: JSON with filtered results (title, url, snippet, score) — this is what the chat LLM receives
- `ToolResult.trace`: list of all `ToolStep` entries from the pipeline

**Step 7: `src/backend/tools/web_search/tool.py`** — WebSearchTool

- Implements `Tool` ABC
- Constructor takes `Settings` — instantiates `TavilyClient` and `SearchHarness` once at construction time, not per-call. Reusing a single httpx client preserves connection pooling.
- `name = "web_search"`, description and parameters schema as in spec §5.3
- `execute()` calls `self.harness.run()` — thin delegation, all logic lives in `harness.py`
- Schema parameters: `reason` (string, required), `query` (string, required)
- When registering via `ToolFramework.register(WebSearchTool(settings))`, `settings` is injected at app startup (Unit V wires this in `main.py`)

**Smoke check:** Import `WebSearchTool`, register it with `ToolFramework`, call `get_schemas_for_provider("openai")` and `get_schemas_for_provider("anthropic")` — verify both return correct normalized schemas.

### Phase 4 — Tests

**Step 8: `tests/unit/test_tool_framework.py`**

Test cases:
- Register a tool, retrieve schemas for all 3 providers — verify format differences
- Register duplicate tool name → error
- `execute_tool_call()` with a mock tool — verify `on_step` called, timing populated
- `execute_tool_call()` with unknown tool name → `ToolExecutionError`
- `supports_tools(model_id, provider="openai")` and `supports_tools(model_id, provider="anthropic")` return `True` for any model ID — direct SDK short-circuit
- `supports_tools("deepseek/deepseek-chat", provider="openrouter")`, `supports_tools("deepseek/deepseek-r1", ...)`, `supports_tools("openai/gpt-5", ...)`, etc. return `True` — allowlisted prefixes
- `supports_tools("meta-llama/llama-3", provider="openrouter")`, `supports_tools("mistralai/mistral-7b", ...)`, etc. return `False` — not on allowlist

**Step 9: `tests/unit/test_search_filters.py`**

Test cases (all deterministic, no mocking needed):
- Results below score threshold filtered out
- Results with old dates filtered out
- Results with no date pass through (don't filter)
- Blacklisted domains filtered
- Duplicate URLs filtered (first kept)
- Multiple filters applied together
- Empty input → empty output
- All results filtered → empty output (edge case the harness must handle)

**Step 10: `tests/integration/test_search_harness.py`**

- Mock `TavilyClient.search()` to return canned results
- Mock `context.lightweight_complete()` to return canned JSON responses for each LLM step
- Test happy path: all 5 steps complete, `ToolResult` has correct content and trace
- Test with pending queries: entity extraction fills templates, round 2 fires
- Test coverage loop: first check returns `sufficient: false`, retry fires, second check returns `sufficient: true`
- Test coverage loop cap: 3 rounds max, then proceeds
- Test Tavily failure: first call fails → retry → succeeds (verify retry logic)
- Test Tavily failure: both attempts fail → harness aborts with error result
- Test lightweight model failure in query gen → falls back to raw query
- Test all results filtered out → harness returns empty results (not a crash)
- Verify `on_step` callback called for each step with correct status progression

---

## Completion Criteria

1. `ToolFramework` can register tools and produce correctly normalized schemas for OpenAI, Anthropic, and OpenRouter
2. `ToolFramework.execute_tool_call()` routes to the correct tool, captures timing, and streams steps via callback
3. `WebSearchTool` executes the full 5-step harness pipeline with mocked externals
4. Tavily client retries once on failure and raises `ToolExecutionError` on double failure
5. Deterministic filters correctly apply all 4 rules (score, date, domain, dedup)
6. Coverage check loop retries up to 2 times, then proceeds with available results
7. Harness degrades gracefully: LLM parse failures, entity extraction failures, and empty result sets don't crash
8. All unit and integration tests pass
9. `ToolResult.trace` captures every harness step with name, status, data, and duration
