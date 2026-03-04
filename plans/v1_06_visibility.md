# Unit V — Visibility Layer + Integration Wiring

**Spec sections:** §6.1–6.3, §4.6, §5.5
**Consult:** `spec/v1_spec.md`, `plans/v1_master_plan.md` (§3.5 for visibility contract, §3.3 for WS protocol), `docs/llm_models_reference.md`

---

## Overview

This unit has two responsibilities: (A) the visibility capture and query system, and (B) wiring all backend subsystems — rolling summary, tool framework, and visibility — into the chat orchestrator. After this unit, the full backend is operational: messages trigger rolling summaries when needed, tool calls execute through the harness with real-time step streaming, and every assistant response has a complete visibility record capturing payloads, token counts, reasoning, summary events, and tool traces.

---

## Dependencies

| Unit | What this unit consumes |
|------|------------------------|
| **F** | ORM models (`VisibilityRecord`, `Message`, `Conversation`, `RollingSummary`), `get_db()`, `Settings`, exceptions |
| **P** | `LLMProvider` protocol, `ProviderRegistry`, `ChatMessage`/`StreamEvent` types (master plan §3.1), model catalog |
| **C** | `ChatService`, `ConversationService`, `routes/ws.py`, `routes/conversations.py`, WS protocol types |
| **S** | `TokenCounter`, `RollingSummaryService` (master plan §3.4) |
| **T** | `ToolFramework`, `ToolResult`, `ToolStep`, `ToolContext` (master plan §3.2) |

**Files to read before implementing:**
- `src/backend/services/chat.py` — current orchestrator to modify
- `src/backend/routes/ws.py` — current WS handler to modify
- `src/backend/services/token_counter.py` — token counting methods
- `src/backend/services/rolling_summary.py` — check_and_summarize interface
- `src/backend/tools/framework.py` — ToolFramework execute_tool_call, get_schemas
- `src/backend/tools/base.py` — ToolContext, ToolResult, ToolStep
- `src/backend/providers/base.py` — StreamEvent, ChatMessage, LLMProvider
- `src/backend/models/visibility.py` — ORM model for visibility_records table

---

## Files to Create

- `src/backend/services/visibility.py` — Visibility capture and async token count population
- `src/backend/routes/visibility.py` — REST endpoints for visibility data
- `src/backend/schemas/visibility.py` — Request/response schemas for visibility API

Test files:
- `tests/unit/test_visibility_service.py` — Unit tests for capture and async token counting
- `tests/unit/test_tool_call_subloop.py` — Isolated tests for queue-based tool call sub-loop pattern
- `tests/integration/test_visibility_api.py` — Integration tests for visibility endpoints
- `tests/integration/test_full_wiring.py` — End-to-end tests for the complete chat orchestrator

## Files to Modify

- `src/backend/services/chat.py` — Add rolling summary, tool call loop, visibility capture
- `src/backend/routes/ws.py` — Forward new event types (tool steps, summary events), inject new dependencies
- `src/backend/main.py` — Register visibility routes, wire up new service dependencies

---

## Architecture & Key Decisions

### Two-phase visibility record creation

The visibility record is created in two stages:
1. **Synchronous (blocking):** After the assistant response completes, create the record with: request payload, response metadata, active provider token count, reasoning content, summary event, tool trace. The active provider token count is computed synchronously because it's needed for the record.
2. **Asynchronous (fire-and-forget):** Spawn background tasks for the two non-active provider token counts. These update the record via individual DB writes when they complete. Use `asyncio.create_task` — failures are logged but don't affect the user.

### Tool call loop via asyncio.Queue

When the LLM returns a `tool_call` stream event, the chat service must:
1. Persist the tool_call message
2. Execute the tool (which streams step progress)
3. Persist the tool_result message
4. Feed results back to the LLM for a second stream

The challenge: tool step progress must stream to the client in real-time while the tool executes. Use an `asyncio.Queue` as the bridge:
- The `on_step` callback pushes `ToolStep` events onto the queue
- Run tool execution as a concurrent task
- The chat service's async generator reads from the queue and yields `tool_step` events
- When execution completes, a sentinel signals the generator to proceed with the LLM's second pass

### Request payload capture

Before calling `provider.stream_chat()`, serialize the full messages list and parameters into a dict. This is the `request_payload` stored in the visibility record. Include: messages (as dicts), model_id, provider, reasoning_level, tool schemas (if any). Serialize `ChatMessage` objects — don't store ORM models.

### Token counts endpoint — returns stored data

`GET /api/conversations/{id}/token-counts` returns the three provider token counts and context window utilization from the **most recent** visibility record in the conversation. The frontend already has these counts and uses them to calculate utilization against different model context windows when the user switches models. No live recomputation needed — the counts are captured per-message and the latest ones represent the current conversation state.

### Auto-title visibility enrichment

Per master plan §4 Unit C: the auto-title LLM call's prompt and response are stored in the `response_metadata` JSONB of the first assistant message's visibility record. After auto-title completes, update the existing visibility record with the title generation details.

---

## Implementation Steps

### Phase 1 — Visibility Schemas & Service

**Step 1: `src/backend/schemas/visibility.py`**

Pydantic response schemas for the visibility API.
- `VisibilityResponse` — all fields from the `visibility_records` table: request_payload, response_metadata, token counts (all three providers + output), context window size, active token count, reasoning_content, summary_event, tool_trace, created_at
- `TokenCountsResponse` — three provider counts, output tokens, context_window_size, active_token_count, active_provider, model_id. Include a `utilization` float field (active_token_count / context_window_size).
- Keep JSONB fields as `dict | None` — the frontend parses them. Don't over-type the internal structure.

**Step 2: `src/backend/services/visibility.py`**

Implement `VisibilityService` matching the contract in master plan §3.5.

- **Constructor:** Takes `TokenCounter` and `Settings`.

- **`capture()` method:**
  1. Compute the active provider's token count synchronously via `token_counter.count_for_provider()`
  2. Get context window size via `token_counter.get_context_window()`
  3. Extract `output_tokens` from `response_metadata` — the provider populates this from the API's usage reporting. The `done` StreamEvent's `metadata` dict contains a `usage` key with `prompt_tokens` and `completion_tokens` (per Unit P's base.py). The chat orchestrator passes this as `response_metadata`. Extract `response_metadata.get("usage", {}).get("completion_tokens")` for `output_tokens`.
  4. Serialize tool trace: convert `list[ToolStep]` to JSON-serializable dicts
  5. Serialize summary event: convert `SummaryResult` to a JSON-serializable dict
  6. Create `VisibilityRecord` ORM object with all synchronous fields
  7. Flush to DB to get the record ID
  8. Spawn background tasks for the two non-active provider token counts
  9. Return the visibility record ID

- **Background token count tasks:**
  - `_compute_background_token_count(record_id, provider, messages, model_id)` — async function that counts tokens for one non-active provider, then updates the visibility record's corresponding column
  - Map provider to column: `"openai"` → `tokens_openai`, `"anthropic"` → `tokens_anthropic`, `"openrouter"` → `tokens_openrouter`
  - Wrap in try/except — log errors, don't propagate. A failed background count is acceptable.
  - Important: these tasks need their own DB session (the parent session may be closed). Create a new session via `get_db()` within each task.

- **`get_visibility(message_id, db)` method:** Query visibility record by message_id. Return None if not found (not all messages have visibility — only assistant messages).

- **`get_latest_token_counts(conversation_id, db)` method:** Query the most recent visibility record for the conversation (join messages table, order by sequence desc, limit 1). Return the token count fields.

- **`update_auto_title_data(message_id, title_prompt, title_response, db)` method:** Update the existing visibility record's `response_metadata` JSONB to include auto-title details. Use JSONB merge, not replacement.

**Smoke check:** Import visibility service, instantiate with mocked dependencies, call `capture()` with sample data. Verify record creation.

### Phase 2 — Visibility Routes

**Step 3: `src/backend/routes/visibility.py`**

Two endpoints matching master plan §3.6:

- `GET /api/messages/{id}/visibility` — returns the full visibility record for an assistant message. 404 if message doesn't exist or has no visibility record.
- `GET /api/conversations/{id}/token-counts` — returns the latest token counts for a conversation. 404 if conversation has no messages with visibility data.

Standard FastAPI dependency injection for `db` and `VisibilityService`.

**Step 4: Register in `main.py`**

Add the visibility router to the FastAPI app.

**Smoke check:** Start the app, verify the visibility endpoints return 404 for nonexistent IDs (not 500).

### Phase 3 — Chat Orchestrator Wiring

This is the most complex phase. Modify `ChatService.handle_user_message()` to integrate all subsystems.

**Step 5: Modify `src/backend/services/chat.py`**

Expand the `ChatService` constructor to accept: `RollingSummaryService`, `ToolFramework`, `VisibilityService`, `TokenCounter`.

Rewrite `handle_user_message()` to follow this flow:

1. **Persist user message** (unchanged from Unit C)
2. **Assemble context** — system prompt + conversation messages as `ChatMessage` list
3. **Rolling summary check** — two-step process to allow the UI indicator to fire before the blocking work:
   a. Call `token_counter.count_for_provider()` and `token_counter.get_context_window()` to pre-check the threshold
   b. If `token_count >= threshold * window_size`: yield `summary_started`, then call `rolling_summary_service.check_and_summarize()`, store the `SummaryResult`, yield `summary_complete`, and use the returned compressed messages going forward
   c. If below threshold: skip directly to step 4 with the unmodified messages
   - Note: token counting runs twice for exchanges where compression fires (once here, once inside `check_and_summarize`). This is intentional and acceptable — the pre-check is what enables the `summary_started` event to arrive at the client *before* the blocking summary generation begins. Do not try to eliminate the double count by caching; keep the logic simple.
4. **Prepare tool schemas** — call `tool_framework.get_schemas_for_provider(provider)` if the model supports tools
5. **Capture request payload** — serialize messages + params before calling the LLM
6. **Stream LLM response** — call `provider.stream_chat()` with tools if applicable
7. **Handle stream events in a loop:**
   - `token` → yield to caller, accumulate content
   - `reasoning` → yield to caller, accumulate reasoning content
   - `tool_call` → enter the **tool call sub-loop** (see below)
   - `done` → exit the stream loop
   - `error` → yield error event to caller
8. **Persist assistant message** with accumulated content
9. **Capture visibility** — call `visibility_service.capture()` with all collected data
10. **Yield `stream_done`** with message_id, visibility_id, token counts, context utilization
11. **Fire auto-title** if first exchange (unchanged from Unit C, but also call `visibility_service.update_auto_title_data()` when title completes)

**Tool call sub-loop (step 7 detail):**

The sub-loop uses an `asyncio.Queue` to bridge the tool framework's `on_step` callback and the chat service's async generator. This pattern has several failure modes that must be handled explicitly. The implementer should treat the queue as the **single communication channel** between the background task and the drain loop — all signals (steps, errors, completion) flow through it.

**Three object types on the queue:**
- `ToolStep` — a normal step event, yielded to the WebSocket client
- An **error marker** (a distinct object, e.g., a dataclass `ToolTaskError(exception)`) — signals the task failed
- A **sentinel** (e.g., `None` or a dedicated `_SENTINEL` constant) — signals the task is finished, drain loop should exit

**Sequence of operations on `tool_call`:**

a. Persist the tool_call message (role=tool_call, with tool_name, arguments, tool_call_id)
b. Yield `tool_call_start` event to the WebSocket client
c. Create an `asyncio.Queue` for step events
d. Build `ToolContext` with `user_message`, `conversation_id`, and a `lightweight_complete` closure
e. Create the background task with a **wrapper function** (see sentinel contract below)
f. Enter the **drain loop** (see drain loop contract below)
g. After drain loop exits, **await the task** to surface any uncaught exceptions and ensure cleanup
h. If the drain loop exited due to an error marker, yield an error event and skip to step (l)
i. Collect the `ToolResult` from the task's return value
j. Persist the tool_result message (role=tool_result, content=result.content)
k. Store the tool trace (`result.trace`) for visibility capture
l. Append tool_call and tool_result as `ChatMessage` to the messages list
m. Call `provider.stream_chat()` again with updated messages (LLM's second pass)
n. Continue the stream event loop for the second pass (this handles the final response)

**Sentinel contract (REQUIRED — not optional defensive code):**

The background task wrapper MUST use `try/finally` to guarantee the sentinel reaches the queue:

```
async def _run_tool_task(framework, tool_name, args, context, queue):
    try:
        result = await framework.execute_tool_call(
            tool_name, args, context, on_step=queue.put
        )
        return result
    except Exception as exc:
        await queue.put(ToolTaskError(exc))   # error travels through the queue
    finally:
        await queue.put(SENTINEL)             # ALWAYS pushed, success or failure
```

Without this, an exception in the tool harness means the sentinel never arrives, the drain loop hangs on `queue.get()` forever, and the WebSocket connection freezes. The `finally` clause is the only thing that makes the drain loop safe.

**Important:** `except Exception` is intentional — do NOT change it to `except BaseException`. In Python 3.8+, `asyncio.CancelledError` is a subclass of `BaseException`, not `Exception`, so it passes through the `except` clause unhandled. The `finally` still runs (Python guarantees `finally` executes on any exception including `BaseException`), so the sentinel is always pushed. The result: on cancellation, no `ToolTaskError` marker is placed on the queue — the drain loop sees only the sentinel and exits cleanly, with no error event sent to the WebSocket. This is the correct disconnect behavior. If you broaden the `except` to `BaseException`, cancellation becomes a reported error instead of a silent clean exit.

**Drain loop contract:**

The drain loop reads from the queue with a **timeout** as a last-resort safety net:

```
while True:
    item = await asyncio.wait_for(queue.get(), timeout=60.0)
    if item is SENTINEL:
        break
    if isinstance(item, ToolTaskError):
        # yield error event to WebSocket, then break
        break
    # item is a ToolStep — yield tool_step event to WebSocket
```

- **Timeout (60 seconds):** If `wait_for` raises `TimeoutError`, something has gone deeply wrong (e.g., task panicked in a way that bypassed `try/finally`). On timeout: cancel the background task, yield a tool error event to the WebSocket, and move on. This is a last-resort safety net — the primary error path is the error marker.
- **Error marker handling:** When a `ToolTaskError` arrives, the drain loop yields an error event to the WebSocket and breaks. The original exception is available in the marker for logging.

**Post-drain task await (REQUIRED):**

After the drain loop exits (whether via sentinel, error marker, or timeout), explicitly `await task` one more time. This serves two purposes:
1. Surfaces any exception that slipped through the wrapper (e.g., a bug in the wrapper itself)
2. Ensures the task is fully cleaned up before the LLM's second pass begins

Wrap the await in `try/except` — if the task was already cancelled (timeout path), `CancelledError` is expected.

**WebSocket disconnect cancellation:**

The chat service's async generator runs inside the WS handler's iteration loop. If the client disconnects, the WS handler stops iterating the generator. But the background tool task keeps running — burning Tavily API calls and lightweight model calls for no audience.

The WS handler (in `routes/ws.py`) must track whether a tool task is in flight and cancel it on disconnect. Use the **yield-a-special-event** approach — do NOT store the task as instance state on ChatService. ChatService is a shared singleton; instance state would be clobbered if two WebSocket connections are active simultaneously.

Instead, when the chat service creates the background task, yield an internal `StreamEvent(type="_tool_task_ref", metadata={"task": task})` event. The WS handler catches this event type, stores the task reference in a **local variable** (per-request stack frame), and does NOT forward it to the client. The WS handler then wraps its generator iteration in `try/finally`:

```
# In ws.py handler
active_tool_task = None
try:
    async for event in chat_service.handle_user_message(...):
        if event.type == "_tool_task_ref":
            active_tool_task = event.metadata["task"]
            continue  # don't send to client
        await websocket.send_json(serialize(event))
finally:
    if active_tool_task and not active_tool_task.done():
        active_tool_task.cancel()
```

The background task wrapper must treat `asyncio.CancelledError` as a clean exit — because `except Exception` doesn't catch it (see above), it propagates out through `finally`, pushing the sentinel. No error marker is placed on the queue. No error event is sent to the WebSocket.

- **Nested tool calls:** For v1, assume at most one tool call per exchange. If the LLM returns multiple tool calls in one response, process them sequentially. If the second LLM pass also returns a tool call, cap at 2 total tool rounds to prevent infinite loops.

- **The `lightweight_complete` closure:** Create it once in the chat service — it captures the OpenAI provider from the registry and `settings.lightweight_model`. Pass it into `ToolContext`. Shape: `async def lightweight_complete(messages: list[ChatMessage], response_format: dict | None = None) -> CompletionResult`

**Step 6: Modify `src/backend/routes/ws.py`**

The WS handler needs to forward new event types from the chat service's async generator:
- `summary_started` / `summary_complete` → send as-is
- `tool_call_start` → serialize per master plan §3.3 WS protocol
- `tool_step` → serialize with step_name, step_index, status, data
- `stream_done` now includes visibility_id, token_counts, context_utilization

Also update dependency injection: the WS route (or the app's lifespan/dependency setup) must construct `ChatService` with all its new dependencies (`RollingSummaryService`, `ToolFramework`, `VisibilityService`).

**Step 7: Wire dependencies in `main.py` / app lifespan**

Create all service instances during app startup:
- `TokenCounter(settings, anthropic_client)`
- `RollingSummaryService(token_counter, provider_registry, settings)`
- `ToolFramework()` + register `WebSearchTool`
- `VisibilityService(token_counter, settings)`
- `ChatService(provider_registry, conversation_service, rolling_summary_service, tool_framework, visibility_service, token_counter, settings)`

Use FastAPI's lifespan context or a simple startup event. Store service instances so routes can access them (app state or dependency injection).

**Smoke check:** Start the app. Connect via WebSocket, send a message (with mocked provider). Verify the stream completes and a visibility record is created in the DB.

### Phase 4 — Tests

**Step 8: `tests/unit/test_visibility_service.py`**

- Test `capture()` creates a visibility record with correct fields
- Test `capture()` spawns background tasks for non-active provider token counts (mock `asyncio.create_task`, verify it's called twice)
- Test `get_visibility()` returns the correct record by message_id
- Test `get_latest_token_counts()` returns counts from the most recent visibility record
- Test `update_auto_title_data()` merges title data into response_metadata without overwriting existing data
- Test background token count task handles errors gracefully (mock token counter to raise, verify it doesn't propagate)

**Step 9: `tests/integration/test_visibility_api.py`**

- Create a conversation, send a message (mocked provider), then `GET /api/messages/{id}/visibility` → verify all fields present
- `GET /api/conversations/{id}/token-counts` → verify token counts returned
- 404 for nonexistent message/conversation
- Verify request_payload contains the messages array that was sent to the LLM

**Step 10: `tests/unit/test_tool_call_subloop.py`**

Dedicated tests for the queue-based tool call sub-loop pattern, isolated from the full chat orchestrator. These tests verify the sentinel contract and failure modes independently. Test against the sub-loop logic directly — mock the tool framework, provider, and queue to control timing.

- **Happy path:** Mock `execute_tool_call` to push 3 `ToolStep` events via `on_step`, then return a `ToolResult`. Iterate the generator. Verify: 3 `tool_step` events yielded in order → sentinel received → drain loop exits → `ToolResult` collected → task awaited cleanly.

- **Task raises mid-execution:** Mock `execute_tool_call` to push 1 step, then raise `ToolExecutionError`. Verify: 1 `tool_step` event yielded → `ToolTaskError` marker arrives on queue → drain loop yields an error event and breaks → sentinel arrives (from `finally`) → task is awaited after drain loop → original exception logged. **Critical assertion:** the drain loop does NOT hang. Set a test-level timeout (e.g., 5 seconds) so a hang fails the test instead of blocking CI.

- **Task raises before pushing any steps:** Mock `execute_tool_call` to raise immediately without calling `on_step`. Verify: `ToolTaskError` marker arrives → drain loop yields error event and breaks → sentinel arrives → task is awaited. Queue was empty of steps — confirm the drain loop handles this without trying to yield step events.

- **Timeout safety net:** Mock `execute_tool_call` as an async function that sleeps forever (simulating a task that never pushes a sentinel — e.g., the `finally` was somehow bypassed). Set the drain loop timeout to a short value (e.g., 1 second) for this test. Verify: `asyncio.TimeoutError` fires → background task is cancelled → error event yielded to caller → drain loop exits. **Critical assertion:** the generator does not hang indefinitely.

- **Disconnect mid-drain (cancellation):** Start the generator, yield the first 1-2 `tool_step` events, then stop iterating (simulating WebSocket disconnect). Verify: `active_tool_task.cancel()` is called → the background task receives `CancelledError` → the task's `finally` clause pushes the sentinel → task exits cleanly without logging an error. **Critical assertion:** no orphaned tasks remain in the event loop after the test completes.

- **CancelledError in task wrapper:** Verify that when the task receives `CancelledError`, it does NOT push a `ToolTaskError` marker — only the sentinel. The cancellation is a clean exit, not an error to report.

**Step 11: `tests/integration/test_full_wiring.py`**

This is the capstone test suite — verifies all subsystems work together through the chat orchestrator.

- **Basic flow:** Send message → receive stream events → verify visibility record exists with request_payload, response_metadata, and active provider token count
- **Rolling summary trigger:** Set up a conversation that exceeds 80% of model's context window (mock token counter to return high count). Send a message → verify `summary_started` and `summary_complete` WS events received → verify `RollingSummary` record in DB → verify visibility record has summary_event populated
- **Tool call flow (end-to-end):** Mock provider's `stream_chat` to yield a `tool_call` event on first call, then normal tokens on second call. Mock `ToolFramework.execute_tool_call` to return a canned result with trace steps. Verify: `tool_call_start` event received → `tool_step` events received → final response streams → visibility record has tool_trace populated → tool_call and tool_result messages persisted in DB
- **Tool call failure (end-to-end):** Mock `execute_tool_call` to raise. Verify: error event received over WebSocket → connection stays open → no assistant message persisted for the failed tool attempt → user can send another message afterward
- **Reasoning capture:** Mock provider to yield `reasoning` events. Verify visibility record has reasoning_content.
- **Auto-title + visibility:** Verify that after auto-title fires, the first assistant message's visibility record has title generation data in response_metadata.
- **Multiple subsystems in one exchange:** Engineer a scenario where rolling summary fires AND a tool call happens in the same exchange. Verify all data captured correctly.

---

## Error Handling

- **Active provider token count failure:** If counting fails during `capture()`, log the error and set the count to `None` in the visibility record. Don't block the response — the record is still valuable without the count.
- **Background token count failure:** Swallow and log. The corresponding column stays `NULL`. No user impact.
- **Rolling summary failure during wiring (spec §11.5):** Catch the exception in `handle_user_message()`. Skip the summary, send full context to the LLM. If the LLM returns a context overflow error, it surfaces to the user as a provider error. Log a warning.
- **Tool execution failure:** `ToolFramework.execute_tool_call()` returns a `ToolResult` with error info (not an exception) for handled failures. The error result is sent to the LLM as a tool_result so it can inform the user. For unhandled exceptions, catch `ToolExecutionError`, yield an error event, and continue without tool results.
- **Visibility capture failure:** Catch any exception from `visibility_service.capture()`. Log it. The chat response already streamed to the user — visibility is best-effort, not critical path.

---

## Completion Criteria

1. Every assistant message has an associated visibility record with request_payload and response_metadata
2. Active provider token count is populated synchronously in the visibility record
3. Non-active provider token counts populate asynchronously via background tasks
4. `GET /api/messages/{id}/visibility` returns the full visibility record for any assistant message
5. `GET /api/conversations/{id}/token-counts` returns the latest token counts with context utilization
6. Rolling summary triggers when threshold exceeded and `summary_started`/`summary_complete` WS events are sent
7. Tool calls execute through the framework with real-time `tool_step` WS events streamed to the client
8. Tool call and tool result messages are persisted in the conversation with correct sequence numbers
9. Reasoning content is captured in the visibility record when present
10. Summary events are captured in the visibility record when a rolling summary fires
11. Tool traces are captured in the visibility record when a tool is invoked
12. Auto-title data is stored in the first assistant message's visibility record
13. All subsystem failures degrade gracefully — no crashes from visibility, summary, or tool errors
14. Tool call sub-loop sentinel contract is enforced: `try/finally` guarantees sentinel delivery, errors travel through the queue, drain loop has a timeout, and WebSocket disconnect cancels the background task
15. All unit and integration tests pass, including isolated sub-loop pattern tests
