# Unit C — Chat Core

**Spec sections:** §2.2, §2.3, §8.1, §8.3, §9.1, §9.2
**Consult:** `spec/v1_spec.md`, `plans/v1_master_plan.md` (§3.1–3.6 for contracts), `docs/llm_models_reference.md`

## Overview

Chat Core implements the conversational backbone: conversation CRUD, the WebSocket streaming endpoint, message persistence with sequence numbering, the central chat orchestrator, and async auto-titling. This is the unit that makes Wayne a functional chatbot — after this phase, a user can create conversations, send messages, receive streamed responses, and see auto-generated titles.

The `ChatService` is designed as the single orchestrator that coordinates all subsystems. In this phase it handles only the basic chat loop; Units S, T, and V will later wire rolling summary, tool execution, and visibility capture into the same orchestrator method.

## Dependencies

- **Unit F** (Foundation): `get_db()`, `Settings`, ORM models (`Conversation`, `Message`, `RollingSummary`), base Pydantic schemas, `SYSTEM_PROMPT`, `exceptions.py`, FastAPI app shell in `main.py`
- **Unit P** (Provider Layer): `LLMProvider` protocol, `ProviderRegistry`, `ChatMessage`/`StreamEvent` types (master plan §3.1), model catalog, `GET /api/models`

Read these files from dependency units to understand real interfaces:
- `src/backend/providers/base.py` — `ChatMessage`, `StreamEvent`, `LLMProvider` protocol
- `src/backend/providers/registry.py` — `ProviderRegistry` for getting provider instances
- `src/backend/models/` — all ORM models
- `src/backend/config.py` — `Settings`
- `src/backend/database.py` — `get_db()`
- `src/backend/services/system_prompt.py` — `SYSTEM_PROMPT`

## Files to Create

- `src/backend/schemas/conversations.py` — Request/response schemas for conversation CRUD
- `src/backend/schemas/messages.py` — Message response schemas
- `src/backend/schemas/ws.py` — WebSocket message schemas (client→server and server→client)
- `src/backend/services/conversation.py` — Conversation CRUD and message persistence logic
- `src/backend/services/chat.py` — Central orchestrator for the chat loop
- `src/backend/services/auto_title.py` — Async auto-titling after first exchange
- `src/backend/routes/conversations.py` — REST endpoints for conversation CRUD
- `src/backend/routes/ws.py` — WebSocket endpoint
- `tests/unit/test_chat_service.py` — Unit tests for chat orchestrator
- `tests/integration/test_conversations_api.py` — Integration tests for CRUD endpoints
- `tests/integration/test_websocket.py` — Integration tests for WebSocket flow
- `tests/integration/test_chat_flow.py` — End-to-end chat flow tests

## Architecture & Key Decisions

### ChatService as extensible orchestrator

`ChatService.handle_user_message()` is the single method that processes every user message. In this phase it does:

1. Persist the user message with next sequence number
2. Assemble context: system prompt + all conversation messages as `ChatMessage` list
3. Call `provider.stream_chat()` with the assembled context
4. Accumulate the streamed response while yielding `StreamEvent`s to the caller
5. Persist the complete assistant message
6. Update conversation's `last_model_id` and `last_provider`
7. Fire auto-title if this is the first exchange

Design the method signature so Units S, T, V can inject behavior without rewriting:
- Accept the full message list and return it (so Unit S can compress before the API call)
- Yield `StreamEvent`s through an async generator (so the WS route can forward them)
- After accumulating the full response, provide hook points where Unit V can capture visibility and Unit T can handle tool calls

The method should be an **async generator** that yields `StreamEvent` objects. The WebSocket route iterates over this generator and forwards each event to the client.

### Sequence numbering

Messages use a monotonic `sequence` integer within each conversation. The `ConversationService` should provide a `next_sequence(conversation_id, db)` method that queries `MAX(sequence)` and adds 1 (or returns 1 if no messages exist). When multiple messages are created in a single exchange (user + assistant, or later user + tool_call + tool_result + assistant), increment for each.

### WebSocket session management

Per master plan §6 (Shared Patterns): create a **new database session per operation** within the WebSocket handler, not one session for the entire connection lifetime. The WS connection can be long-lived; holding a session open would block the connection pool.

Pattern: the WS handler receives messages in a loop. For each user message, it creates a fresh `AsyncSession` via `get_db()`, passes it to `ChatService`, and closes it when the exchange completes.

### Auto-title fire-and-forget

Auto-titling runs as a background task (`asyncio.create_task`) after the first exchange. It does NOT block the response stream. The spec says (§8.3) it runs asynchronously.

Detection: check if the conversation has exactly 2 messages after persisting the assistant response (1 user + 1 assistant = first exchange). If yes, fire auto-title.

The title update is sent to the client via the still-open WebSocket as a `title_updated` event.

## Implementation Steps

### Phase 1 — Schemas

**Step 1: `src/backend/schemas/conversations.py`**
Request/response schemas for conversation CRUD.
- `ConversationCreate` — empty or with optional title (most conversations start untitled)
- `ConversationUpdate` — optional title field for rename
- `ConversationSummary` — id, title, last_model_id, last_provider, updated_at (for sidebar list)
- `ConversationDetail` — extends summary with list of messages (for loading a conversation)
- `ConversationResponse` — single conversation after create/update

**Step 2: `src/backend/schemas/messages.py`**
- `MessageResponse` — id, role, content, model_id, provider, reasoning_level, tool fields, sequence, created_at
- Roles include all values from the `message_role` enum in the DB schema
- Tool-related fields (tool_call_id, tool_name, tool_arguments, tool_result_call_id, tool_result_name) should be optional, only present for tool_call/tool_result roles

**Step 3: `src/backend/schemas/ws.py`**
- `WSClientMessage` — matches master plan §3.3 client→server format: type, content, model_id, provider, reasoning_level
- Server→client types don't need Pydantic schemas — they're simple dicts serialized to JSON. Define them as TypedDict or just document the format. The WebSocket route constructs them directly from `StreamEvent` data.

**Smoke check:** Import all schemas in a Python shell, instantiate with sample data.

### Phase 2 — Services

**Step 4: `src/backend/services/conversation.py`**
Conversation CRUD and message persistence.
- `create_conversation(db) -> Conversation`
- `list_conversations(db) -> list[Conversation]` — ordered by `updated_at DESC`
- `get_conversation(id, db) -> Conversation` — raise 404 if not found
- `get_conversation_with_messages(id, db) -> tuple[Conversation, list[Message]]` — eagerly load messages ordered by sequence
- `update_conversation(id, update, db) -> Conversation` — for rename
- `delete_conversation(id, db) -> None`
- `add_message(conversation_id, role, content, db, **kwargs) -> Message` — handles sequence assignment and all optional fields (model_id, provider, tool fields, etc.)
- `get_messages_as_chat(conversation_id, db) -> list[ChatMessage]` — converts ORM `Message` objects to provider-layer `ChatMessage` objects for context assembly. Summary-role messages become system-role messages in the ChatMessage list. Tool call/result messages map to their ChatMessage equivalents.
- Updating `conversation.updated_at` on every new message is important for sidebar ordering

**Step 5: `src/backend/services/chat.py`**
Central chat orchestrator.
- `ChatService.__init__(provider_registry, conversation_service)` — inject dependencies
- `async handle_user_message(conversation_id, content, model_id, provider, reasoning_level, db) -> AsyncGenerator[StreamEvent, None]`:
  1. Persist user message via `conversation_service.add_message()`
  2. Build context: prepend system prompt, then `get_messages_as_chat()`
  3. Get provider instance from registry
  4. Call `provider.stream_chat(messages, model_id, reasoning_level)`
  5. Iterate over stream events, accumulating content/reasoning tokens
  6. Yield each `StreamEvent` to the caller
  7. On `StreamEvent(type="done")`: persist assistant message with accumulated content, model_id, provider, reasoning_level
  8. Update conversation's last_model_id and last_provider
  9. Check if this was the first exchange → trigger auto-title
- For now, skip tool call handling in the stream — just handle token, reasoning, and done events. Unit T will add tool call loop later.
- The done event yielded to the caller should include the persisted message_id so the frontend can reference it

**Step 6: `src/backend/services/auto_title.py`**
- `async generate_title(conversation_id, user_message, assistant_message, db) -> str`
- Uses the lightweight model (GPT-5 nano via OpenAI provider) — get from `Settings.lightweight_model`
- Call `provider.complete()` (not streaming) with a short prompt asking for a concise title (under 60 chars) based on the first user message and assistant response
- Persist the title via `conversation_service.update_conversation()`
- Return the generated title so the caller can send a `title_updated` WS event
- On failure: log the error, leave conversation untitled. Do not propagate exceptions (spec §11.5).

**Smoke check:** Write a quick script that creates a conversation, adds messages, and calls `get_messages_as_chat()` to verify the ORM-to-ChatMessage conversion works correctly.

### Phase 3 — Routes

**Step 7: `src/backend/routes/conversations.py`**
REST endpoints matching master plan §3.6:
- `POST /api/conversations` — create empty conversation
- `GET /api/conversations` — list all, ordered by updated_at desc
- `GET /api/conversations/{id}` — get with messages
- `PATCH /api/conversations/{id}` — rename
- `DELETE /api/conversations/{id}` — cascade delete (handled by DB foreign keys)
- Standard FastAPI dependency injection for `db: AsyncSession = Depends(get_db)`
- Return appropriate HTTP status codes (201 for create, 204 for delete)

**Step 8: `src/backend/routes/ws.py`**
WebSocket endpoint at `/ws/{conversation_id}`.
- Accept connection, validate conversation exists
- Enter receive loop: wait for client JSON messages
- On `send_message`: parse `WSClientMessage`, create a new DB session, call `ChatService.handle_user_message()`, iterate over the async generator, serialize each `StreamEvent` to the WS protocol format (master plan §3.3), send to client
- On `stream_done`: also send auto-title event if one was triggered
- Handle disconnection gracefully — if client disconnects mid-stream, catch the exception and stop iterating
- Send `error` events for recoverable errors (provider failures). Keep connection open per master plan §6.
- Auto-title: after the chat generator completes, if a title was generated, send `title_updated` event. Alternatively, fire auto-title as a background task and send the event when it completes (the WS connection is still open).

**Step 9: Register routes in `main.py`**
- Import and include the conversations router and WebSocket route
- Mount at appropriate prefixes (`/api` for REST)

**Smoke check:** Start the app, hit `POST /api/conversations` and `GET /api/conversations` with curl. Connect to the WebSocket endpoint with a simple client (e.g., `websocat` or a Python script).

### Phase 4 — Tests

**Step 10: `tests/unit/test_chat_service.py`**
- Mock `ProviderRegistry` to return a mock provider
- Mock provider's `stream_chat` to yield a sequence of `StreamEvent`s (token, token, done)
- Test `handle_user_message`: verify user message persisted, assistant message persisted with correct content, conversation updated_at refreshed
- Test auto-title triggers on first exchange (mock the title generation)
- Test auto-title does NOT trigger on subsequent exchanges

**Step 11: `tests/integration/test_conversations_api.py`**
- Test full CRUD lifecycle: create → list (appears) → get (with messages) → rename → delete → list (gone)
- Test 404 for nonexistent conversation
- Test cascade delete removes messages

**Step 12: `tests/integration/test_websocket.py`**
- Connect to WS, send a message, verify stream events received in correct order (stream_token*, stream_done)
- Verify message persisted after stream completes
- Verify stream_done includes message_id and token counts
- Test with mocked provider — no real LLM calls

**Step 13: `tests/integration/test_chat_flow.py`**
- Full flow: create conversation → connect WS → send message → receive response → verify DB state
- Test auto-title: send first message → verify title_updated event received → verify conversation title in DB
- Test multi-turn: send two messages in same conversation → verify sequence numbers correct → verify context assembly includes both exchanges

## Error Handling

- **Provider failure during stream:** Catch `ProviderError`, yield an error `StreamEvent`, send `error` WS event with `recoverable: true`. The user message is already persisted; no assistant message is saved for the failed attempt.
- **WebSocket disconnect mid-stream:** Catch `WebSocketDisconnect` in the WS route. Stop iterating the chat generator. The partial response is lost (not persisted since we only persist on `done`). This is acceptable for v1.
- **Auto-title failure:** Swallow the exception, log it. The conversation stays untitled. No user-facing error (spec §11.5).
- **Invalid conversation_id on WS connect:** Close the WebSocket with an appropriate close code (1008 Policy Violation) and a reason message.

## Completion Criteria

1. User can create a new conversation via the REST API
2. User can list all conversations ordered by most recent
3. User can load a conversation with its full message history
4. User can rename and delete conversations
5. User can connect via WebSocket and send a message that streams back token-by-token
6. Messages (user and assistant) are persisted with correct sequence numbers and model attribution
7. Conversation's `last_model_id` and `last_provider` update after each exchange
8. Auto-titling fires after the first exchange and sends a `title_updated` WebSocket event
9. Auto-titling failures are silent — no user-facing error
10. Provider errors during streaming result in a recoverable error event, not a crash
11. All tests pass with mocked providers (no real LLM calls)
