# Implementation Plan: Frontend–Backend Wiring

**Spec:** `spec/v1-wiring-spec.md`

## Context

The frontend and backend are both built but disconnected. The frontend runs entirely off `src/frontend/src/mocks/data.ts` — no HTTP or WebSocket calls exist. The backend has full REST + WebSocket endpoints, SQLAlchemy persistence, and streaming chat. This plan wires them together per `spec/v1-wiring-spec.md`.

## Architecture Decisions

- **API client layer first** — All fetch logic lives in `src/frontend/src/lib/api.ts`. Stores call functions from this module, never raw `fetch`. One place for base URL, headers, and error normalization.
- **Mixed slicing** — Horizontal for the two foundations (integration tests, API client), then vertical by feature area (models → conversations → streaming → visibility).
- **`isStreaming` in conversation store** — Not a separate store. Streaming is scoped to the active conversation and the store already owns conversation state.
- **Backend tests first** — No frontend wiring starts until integration tests confirm the backend endpoints are working.
- **Mock data stays in repo** — `mocks/data.ts` and `mocks/types.ts` are not deleted. Store initialization is changed to no longer use them at startup; they remain as reference/test fixtures.

---

## Task List

### Phase 1: Backend Smoke Tests

#### Task 1: Integration test suite for wiring-critical endpoints
**Description:** Write `tests/integration/test_api_wiring.py` covering the nine spec-required paths. Use the existing `client` + `db_session` fixtures from `tests/conftest.py`. For the WebSocket test, mock the provider via `app.dependency_overrides` to return a fixed deterministic event sequence (token → done) — no real API keys required.

**Dependencies:** None

**Files touched:**
- `tests/integration/test_api_wiring.py` (new)
- `tests/conftest.py` (may need WS mock helper)

**Estimated scope:** Medium

---

### Checkpoint: Backend Smoke Tests
- [x] `poetry run pytest tests/integration/test_api_wiring.py` — all 9 tests pass
- [x] Fix any backend bugs found before proceeding

---

### Phase 2: API Client Foundation

#### ~~Task 2: Create `src/frontend/src/lib/api.ts`~~ ✓
**Description:** Typed fetch wrappers for all REST endpoints + a `createWebSocket(conversationId)` factory. Use a `BASE_URL` constant (`http://localhost:8000`). Each function throws a typed `ApiError` on non-2xx. Return types must match the interfaces in `mocks/types.ts`.

Functions:
```
getConversations() → Conversation[]
createConversation(title?: string) → Conversation
getConversation(id: string) → ConversationDetail   // includes messages[]
updateConversation(id: string, title: string) → Conversation
deleteConversation(id: string) → void
getModels() → ModelCatalog
getMessageVisibility(messageId: string) → VisibilityRecord
getConversationTokenCounts(conversationId: string) → TokenCountsResponse
createWebSocket(conversationId: string) → WebSocket
```

**Dependencies:** None (parallel with Task 1)

**Files touched:**
- `src/frontend/src/lib/api.ts` (new)

**Estimated scope:** Small

---

### Phase 3: Model Store Wiring

#### ~~Task 3: Replace mock catalog with live `GET /api/models`~~ ✓
**Description:** Initialize `catalog` as empty rather than `MOCK_MODEL_CATALOG`. Add `loadCatalog()` async action that calls `api.getModels()` and calls `setCatalog()`. Call `loadCatalog()` on app mount. Model selects should show a disabled/loading state while catalog is empty.

**Dependencies:** Task 2

**Files touched:**
- `src/frontend/src/stores/useModelStore.ts`
- `src/frontend/src/App.tsx`

**Estimated scope:** Small

---

### Phase 4: Conversation List Wiring

#### ~~Task 4: Replace mock conversations with live `GET /api/conversations`~~ ✓
**Description:** Initialize `conversations` as `[]` and `activeConversationId` as `null`. Add `loadConversations()` async action. Call on app mount. After loading, set first conversation as active if any exist.

**Dependencies:** Task 2

**Files touched:**
- `src/frontend/src/stores/useConversationStore.ts`
- `src/frontend/src/App.tsx`

**Estimated scope:** Small

#### ~~Task 5: Wire conversation CRUD (create, rename, delete)~~
**Description:** Update the three store actions to call the backend:
- `newChat()`: call `api.createConversation()`, use returned server ID (not random UUID), prepend to list, set active.
- `renameConversation(id, title)`: call `api.updateConversation()`, update local state on success.
- `deleteConversation(id)`: call `api.deleteConversation()`, remove from local state on success. If deleted was active, set next available as active or null.

On API error: show a toast and revert any optimistic update.

**Dependencies:** Task 4

**Files touched:**
- `src/frontend/src/stores/useConversationStore.ts`

**Estimated scope:** Small

#### ~~Task 6: Load message history on conversation select~~ ✓
**Description:** When `setActiveConversation(id)` is called, fetch `api.getConversation(id)` and populate `messagesByConvId[id]`. Add `isLoadingMessages: boolean` to the store. `ChatMessages.tsx` shows a skeleton when loading. Skip fetch if messages already cached.

**Dependencies:** Task 4

**Files touched:**
- `src/frontend/src/stores/useConversationStore.ts`
- `src/frontend/src/components/chat/ChatMessages.tsx`

**Estimated scope:** Small

---

### Checkpoint: Conversation CRUD ✓
- [x] App loads showing real conversations from the database
- [x] New Chat creates a real conversation (visible after reload)
- [x] Rename and Delete persist (visible after reload)
- [x] Clicking a conversation loads its real message history

---

### Phase 5: WebSocket Streaming

#### Task 7: Add `isStreaming` state and wire send to WebSocket
**Description:** The core wiring task.

In `useConversationStore.ts`:
- Add `isStreaming: boolean` (default `false`)
- Replace `addUserMessage()` with `sendMessage(content, modelId, provider, reasoningLevel)` async action:
  1. If `activeConversationId` is null, call `createConversation()` first and set active.
  2. Append optimistic user message to `messagesByConvId`.
  3. Open WebSocket via `api.createWebSocket(conversationId)`.
  4. Set `isStreaming = true`.
  5. Send `{ type: "send_message", content, model_id, provider, reasoning_level }`.
  6. On `stream_token`: accumulate on a placeholder assistant message in `messagesByConvId`.
  7. On `stream_done`: finalize assistant message with real `message_id` from server, set `isStreaming = false`, close WebSocket.
  8. On `error` / `onerror` / `onclose` mid-stream: mark message errored, set `isStreaming = false`, show toast.

  Use `getState()` inside WS callbacks to avoid stale closure on Zustand state.

In `AppLayout.tsx`:
- Read `isStreaming` from the store.
- Wire `handleSend` to call `sendMessage(content, modelId, provider, reasoningLevel)` (pull model state from `useModelStore`).
- Pass `disabled={isStreaming}` to `ChatInput`.

**Dependencies:** Tasks 5, 6

**Files touched:**
- `src/frontend/src/stores/useConversationStore.ts`
- `src/frontend/src/components/layout/AppLayout.tsx`

**Estimated scope:** Large

---

### Checkpoint: Full Chat Loop
- [ ] User can send a message and see the response stream in real time
- [ ] Send button and textarea disabled during streaming
- [ ] Stream completes cleanly (`stream_done` received, input re-enabled)
- [ ] WebSocket error shows error state on message bubble and re-enables input
- [ ] Message history persists after page reload

---

### Phase 6: Visibility Pane Wiring

#### Task 8: Replace mock visibility with live API calls
**Description:** Replace `MOCK_VISIBILITY[selectedMessageId]` with a real fetch. Add `visibilityByMessageId: Record<string, VisibilityRecord>` cache to the conversation store. When `openVisibility(messageId)` is called, fetch `api.getMessageVisibility(messageId)` if not cached. Show loading state in the pane.

Replace `MOCK_TOKEN_COUNTS` with token data from the `stream_done` event (already carried in the payload). Fall back to `api.getConversationTokenCounts()` for older messages.

**Dependencies:** Task 7

**Files touched:**
- `src/frontend/src/stores/useConversationStore.ts`
- `src/frontend/src/components/visibility/VisibilityPane.tsx`
- `src/frontend/src/components/chat/ChatMessages.tsx` (remove `MOCK_VISIBILITY` import)

**Estimated scope:** Medium

---

### Checkpoint: Complete
- [ ] All 9 integration tests in `test_api_wiring.py` pass
- [ ] Full user flow works end-to-end: start app → see conversations → send message → stream response → open visibility pane → see real data
- [ ] Send button disabled during streaming
- [ ] No mock data used at runtime
- [ ] `npm run build` from `src/frontend/` passes with no TypeScript errors

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WebSocket test requires real LLM API key | High | Mock provider via `app.dependency_overrides` with fixed event sequence |
| Stale closure in WebSocket handler loses tokens | Medium | Use Zustand `getState()` inside WS callbacks, not closure over state |
| Type mismatch between backend pydantic and frontend TS | Medium | Exploration confirmed alignment; catch in `api.ts` error handler |
| `newChat()` race: user sends before server ID returns | Low | `isStreaming` window covers this; block send until conversation exists |

## Parallel Work Guidance

- **Safe to parallelize:** Tasks 1 and 2 (no shared state)
- **Safe to parallelize:** Tasks 3 and 4 after Task 2 completes
- **Must be sequential:** Tasks 4 → 5 → 6 → 7 → 8

## Critical Files

| File | Role |
|------|------|
| `src/frontend/src/lib/api.ts` | New — all HTTP/WS calls |
| `src/frontend/src/stores/useConversationStore.ts` | Major changes — init, 4 actions, 3 new fields |
| `src/frontend/src/stores/useModelStore.ts` | Remove mock init, add `loadCatalog()` |
| `src/frontend/src/components/layout/AppLayout.tsx` | Wire `sendMessage`, pass `isStreaming` |
| `src/frontend/src/components/visibility/VisibilityPane.tsx` | Replace mock imports with real fetches |
| `src/frontend/src/components/chat/ChatMessages.tsx` | Remove `MOCK_VISIBILITY`, add loading state |
| `tests/integration/test_api_wiring.py` | New — 9 smoke tests |
