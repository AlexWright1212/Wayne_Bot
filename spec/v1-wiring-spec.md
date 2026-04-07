# Spec: Frontend–Backend Integration (v1 Wiring)

## Objective

Wire the React frontend off mock data and onto the live FastAPI backend, delivering a fully functional single-user chat application. The app currently has zero HTTP/WebSocket calls; all data comes from `src/frontend/src/mocks/data.ts`. This spec covers replacing every mock data source with real API calls, implementing WebSocket streaming with correct UI state, and validating the backend with a lean integration test suite before trusting it under the frontend.

**User stories:**

- As a user, I can start the app and see my real conversation history from the database.
- As a user, I can create, rename, and delete conversations and have those changes persist.
- As a user, I can select a model and provider, send a message, and see the response stream in real time.
- As a user, the send button is disabled while a response is streaming so I can't send overlapping requests.
- As a user, I can open the Visibility pane on any assistant message and see real request/response data.
- As a user, the model picker shows real models fetched from the backend.

---

## Success Criteria

**Backend integration tests pass** (written as part of this work):

- `GET /api/health` returns `200 { "status": "ok" }`.
- `POST /api/conversations` → `GET /api/conversations` → conversation appears in list.
- `GET /api/conversations/{id}` returns conversation with correct message history after a send.
- `DELETE /api/conversations/{id}` removes conversation and cascades.
- `PATCH /api/conversations/{id}` updates the title.
- `GET /api/models` returns a non-empty catalog grouped by provider.
- WebSocket `/ws/{conversation_id}` accepts a `send_message` event and emits at least one `stream_token` followed by `stream_done`.
- `GET /api/messages/{message_id}/visibility` returns a visibility record after a completed exchange.
- `GET /api/conversations/{conversation_id}/token-counts` returns token counts after a completed exchange.

**Frontend wiring complete:**

- App startup fetches and displays real conversation list; no hardcoded conversations visible.
- App startup fetches and displays real model catalog; model picker shows live data.
- Selecting a conversation loads its real message history from `GET /api/conversations/{id}`.
- Sending a message opens a WebSocket, streams tokens into the chat, and closes cleanly on `stream_done`.
- `isStreaming` state added to the conversation store; `ChatInput` receives `disabled={isStreaming}`, blocking input during a stream.
- After streaming completes, token counts and visibility data are fetchable for the new assistant message.
- Conversation is auto-created via `POST /api/conversations` before the first send if the active conversation has no server-side ID yet.
- Clicking a visibility button on an assistant message fetches and displays real visibility data.
- Creating, renaming, and deleting a conversation calls the appropriate REST endpoint and reflects in the store.
- The mock data file is no longer the source of truth for any runtime state (it may be kept for reference, but stores must not initialize from it).

**Error states handled:**

- Failed API call shows a toast or inline error; app does not silently fail or render stale mock data.
- WebSocket disconnect during streaming shows an error state on the in-progress message bubble and re-enables the input.

---

## Testing Strategy

**Framework:** `pytest` + `httpx.AsyncClient` (already in the project), in `tests/integration/`.

**Coverage expectations:** Not exhaustive — target the nine highest-risk backend paths listed in the success criteria above. Each test hits the real `wayne_test` PostgreSQL database; no mocking the DB layer.

**Test file:** `tests/integration/test_api_wiring.py`. All wiring-related integration tests live here so they can be run as a group:

```bash
poetry run pytest tests/integration/test_api_wiring.py
```

**Sequencing:** Write and pass these tests before wiring the frontend. They act as the backend smoke-test gate — if they fail, fix the backend first.

---

## New Patterns Introduced

**API client layer** — `src/frontend/src/lib/api.ts`: typed wrappers around `fetch` for every REST endpoint, plus a `createWebSocket(conversationId)` factory. Stores call these functions rather than raw `fetch`. All base URL config and serialization lives here.

**`isStreaming` store field** — `useConversationStore` gains `isStreaming: boolean` (default `false`), set to `true` on WebSocket open and `false` on `stream_done` or error. `AppLayout` passes `disabled={isStreaming}` to `ChatInput`.
