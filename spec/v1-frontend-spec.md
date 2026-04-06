# Wayne v1 — Frontend Spec

**Version:** 1.0
**Date:** 2026-03-19

---

## 1. Overview

Wayne is a single-user chatbot with full transparency into its internals. The frontend is a locally-hosted React SPA that connects to a FastAPI backend. The core value proposition is the **visibility pane** — every API payload, token count, reasoning trace, summary event, and tool execution step is inspectable per message. This is not a debug drawer; it is a primary feature and the main reason someone would use Wayne over another chat app.

**Reference apps:** Cursor (primary). Angular, rectangular, dense but clean. Lots of small UI elements organized tightly. Information-dense without feeling cluttered. The chat interaction style (collapsible tool steps, thinking indicators) draws from Cursor's approach where actions like "explored 6 files" are shown as compact, expandable inline blocks.

**Tech stack:** React + TypeScript, Vite, shadcn/ui, Tailwind CSS, Zustand, native WebSocket. Backend surface area documented in `docs/frontend_surface_area.md`.

---

## 2. Layout

Three-pane layout: **left sidebar**, **main chat pane**, **right visibility pane**.

```
┌──────────┬─────────────────────────────────────────┬──────────────────┐
│          │  [Provider▾][Model▾][Reason▾]    Stats → │                  │
│ SIDEBAR  │  (left)           ctx|max|tok|util (rt) │  VISIBILITY      │
│          ├─────────────────────────────────────────┤  PANE             │
│ [+ New]  │                                        │                  │
│          │  CHAT MESSAGES                          │ [Tab1|Tab2|...|7]│
│ Chat 1   │  (full-width threaded)                  │                  │
│ Chat 2   │                                        │  (tab content)   │
│ Chat 3   │                                        │                  │
│          │                                        │                  │
│          ├─────────────────────────────────────────┤  ────────────────│
│          │  [Message input...             ][↵]    │  OAI: 1,542      │
│          │                                        │  ANT: 1,489      │
└──────────┴─────────────────────────────────────────┤  OR:  1,610      │
                                                     └──────────────────┘
```

- **Sidebar:** Collapsible. Fixed width (~260px). New Chat button at top, conversation list below sorted by recency.
- **Chat pane:** Flex, takes remaining horizontal space. Top bar + messages + input.
- **Visibility pane:** Collapsible. ~400px wide. Closed by default. Opens when user clicks inspect on an assistant message. Stays open showing the selected message's data until the user closes it or selects a different message.
- Both sidebar and visibility pane collapse/expand independently.

---

## 3. Sidebar

- **New Chat button** at the top. Creates a new conversation via `POST /api/conversations`.
- **Conversation list** below, each entry shows:
  - Title (or "New Chat" placeholder if null/untitled)
  - Subtle badge for last model/provider used (optional, from `last_model_id` + `last_provider`)
- **Context menu** (right-click or three-dot icon on hover) per conversation:
  - **Rename** — inline edit, saves via `PATCH /api/conversations/{id}`
  - **Delete** — confirmation dialog, then `DELETE /api/conversations/{id}`
- Active conversation is visually highlighted.
- Auto-updates title when `title_updated` WebSocket event arrives (regardless of which conversation is currently active).

---

## 4. Top Bar (Main Pane Header)

The top bar spans the full width of the main chat pane. It is divided into a left side and a right side.

### Left side — Model Controls

Three dropdowns, each contingent on the previous:

1. **Provider** — `openai`, `anthropic`, `openrouter`. Populated from `GET /api/models`. Providers without API keys are visible but grayed out with a subtle warning indicator. When OpenRouter is shown in the dropdown, a small refresh icon appears on hover that triggers `GET /api/models/openrouter/refresh`.
2. **Model** — Filtered by selected provider. Shows model names from the provider's model list.
3. **Reasoning Level** — Filtered by selected model's `reasoning_levels` array. Hidden entirely if the array is empty. For DeepSeek R1 (builtin reasoning), show a static "Reasoning: Always On" indicator instead of a dropdown.

### Right side — Token Stats

Displayed as compact data on the right side of the header:
- **Context window** — the selected model's `context_window` value (e.g., "400K ctx")
- **Max output** — the selected model's `max_output` value (e.g., "128K max out")
- **Total tokens** — current conversation token count for the active provider
- **Utilization** — percentage of context window used (e.g., "0.4%"), with a small progress indicator

These update when the user switches models (recalculated against the new model's context window) and after each `stream_done` event (re-fetched via `GET /api/conversations/{id}/token-counts`).

---

## 5. Chat Pane

### Message Style

Full-width threaded layout (Cursor-style). User messages are displayed in a chat bubble (still mostly center-aligned within the pane) to visually distinguish them as user input. Assistant messages are full-width with no bubble — just content flowing naturally. This gives more room for inline elements like tool steps and metadata on assistant messages, while keeping user messages clearly identifiable.

### User Messages

Displayed as a right-aligned chat bubble. The bubble is content-width (shrinks to fit short messages) with a max-width of ~80% of the pane — long messages wrap inside the bubble, which stays anchored to the right. Text inside the bubble is left-aligned. No additional metadata.

### Assistant Messages

Each assistant message displays:

- **Thinking indicator** (when reasoning was active): A line of slightly lighter/muted text showing "Thinking..." or a brief description of the thought. Collapsible — clicking expands to show the full reasoning trace inline. Appears above the response content. For full inspection, the user can open the visibility pane via the Inspect button and navigate to the Reasoning Content tab.
- **Tool execution steps** (when a tool was called): Persistent, collapsible inline block. Collapsed state shows a compact summary like "Searched the web — 5 steps". Expanded state shows each step as a text label with status:
  - "Generating search queries" / "Searching" / "Searching for details" / "Filtering results" / "Checking coverage" / "Searching for more info" (for retries)
  - Each step shows a status icon (spinner while running, checkmark when complete)
  - These are text labels only — no JSON data in the chat pane. Full detail lives in the visibility pane.
  - Steps appear in real-time during streaming as `tool_step` WebSocket events arrive.
  - For full tool trace detail, the user opens the visibility pane via the Inspect button and navigates to the Tool Trace tab.
- **Summary indicator** (when rolling summary was triggered): A compact inline note like "Chat summarized" — persistent, collapsible in the same style as tool steps. For full summary details, the user opens the visibility pane via the Inspect button and navigates to the Summary Event tab.
- **"Compressing conversation history..."** blocking indicator: Appears between `summary_started` and `summary_complete` events. This is a temporary streaming-time indicator (not persistent after the message is complete). The persistent "Chat summarized" note replaces it once the message is done.
- **Response content**: Markdown-rendered text. Code blocks get syntax highlighting and a **copy button**.
- **Footer metadata** (below the response content):
  - Model used (e.g., "GPT-5")
  - Provider (e.g., "OpenAI")
  - Reasoning level (e.g., "medium")
  - Output tokens (e.g., "387 tokens")
- **Inspect button**: A clickable affordance (icon or small button) that opens the visibility pane populated with this message's data.

### Error Display

When an API call fails (bad key, rate limit, provider error), an error block appears inline where the assistant response would have been. Styled distinctly (warning/error color). The user can switch models and resend. Errors are also captured in visibility data.

### Streaming Behavior

- Tokens appear progressively as `stream_token` events arrive.
- **Auto-scroll** follows new tokens to the bottom.
- If the user **manually scrolls up** during streaming, auto-scroll stops. Resumes when the user scrolls back to the bottom.
- A "Sending..." indicator appears between the user pressing send and the first `stream_token` arriving (no server acknowledgment exists for this gap).
- A streaming/typing indicator is visible while tokens are actively arriving.

### Input Area

- Auto-growing text box at the bottom of the chat pane. Grows vertically as the user types long messages.
- Send button to the right of the input.
- **Enter** to send, **Shift+Enter** for newline.
- No attachment button or other controls for v1 — strictly text input.

### Empty State

When no conversations exist (first launch), the main pane shows a centered welcome state — "Wayne" branding, model selectors active in the top bar, input box ready. Sidebar shows only the New Chat button with no list items.

---

## 6. Visibility Pane

The visibility pane is a core feature of Wayne. It is the primary surface for inspecting every internal process. It opens when the user clicks an assistant message's inspect button and populates with that message's data from `GET /api/messages/{id}/visibility`.

### Behavior

- **Closed by default.** Opens on inspect click.
- **Per-message.** Shows data for the selected assistant message. Does not auto-switch when new messages stream in — stays on the selected message until the user explicitly clicks a different message's inspect button.
- **Collapsible pane.** User can close the entire pane. Reopening shows the last-selected message's data.

### Tabs

Seven tabs arranged horizontally across the top of the visibility pane. Clicking a tab displays its content below. All tabs are always visible regardless of whether data exists for the selected message — if no data is present for a tab (e.g., no tool was called), the tab content area shows an appropriate empty state.

#### 1. Request Payload
- Always present.
- Shows the full JSON of what was sent to the LLM: system prompt, messages array, model_id, provider, reasoning_level, tool schemas, etc.
- **Collapsible JSON viewer** with syntax highlighting. Clicking any brace `{` or bracket `[` collapses the contents to a single truncated line (text runs to the end of the available width, then the closing brace/bracket). This is critical for navigating large payloads with long message content.
- **Auto-collapse long values:** Any JSON string value that exceeds ~200 characters (roughly 3-4 sentences) should be rendered collapsed by default. This prevents the request payload from being an overwhelming wall of text when it contains long chat messages. The user can click to expand individual values as needed.

#### 2. Response Metadata
- Always present.
- Shows: `finish_reason`, `prompt_tokens`, `completion_tokens`.
- On the first exchange, also shows `auto_title` data (the prompt sent to the titling model and the generated title).

#### 3. Token Counts
- Always present.
- All three provider counts for this specific message: OpenAI (tiktoken), Anthropic (count_tokens), OpenRouter (heuristic).
- Output tokens.
- Context utilization at the time of this message.
- Note: `tokens_anthropic` and `tokens_openrouter` may arrive late (background tasks). Show a loading indicator, then refresh. Builder should implement a brief delayed re-fetch after `stream_done`.

#### 4. Reasoning Content
- Shows the full thinking/reasoning trace in a scrollable, monospace-styled text area.
- Can be very long (thousands of tokens for Anthropic extended thinking).
- If reasoning was not active for this message, the tab shows an empty state (e.g., "No reasoning data for this message").

#### 5. Summary Event
- Shows: summary text, count of summarized messages (from `summarized_message_ids`), tokens before, tokens after, model used.
- Expandable to see the full summary text.
- If no rolling summary was triggered for this exchange, the tab shows an empty state.

#### 6. Tool Trace
- Displayed as a vertical timeline/stepper. Each step shows: name, status, duration, and expandable data.
- Step data uses the same **collapsible JSON viewer** as the request payload.
- Step names mapped to display labels (query_generation → "Generating search queries", etc.).
- Filter results step shows a summary like "Kept 12, removed 11" with expandable detail on removal reasons.
- Coverage check shows confidence as a percentage.
- Retry loops are visually distinct.
- If no tool was called, the tab shows an empty state.

#### 7. Config
- Shows read-only system information that is constant across messages:
  - **System prompt** — the full text of Wayne's system prompt as sent to the model.
  - **Available tools** — the tool schemas as they are shown to the model (name, description, parameter schema).
  - **Summary trigger threshold** — "Summary triggers at: 80% context utilization" (read-only, not configurable in v1).

### Persistent Footer (Bottom of Visibility Pane)

Always visible when the pane is open, not collapsible, not message-scoped:

- **Conversation-level token totals per provider.** How many tokens has this entire conversation used according to each provider? Shows all three: OpenAI, Anthropic, OpenRouter.
- This is distinct from the per-message token counts in Section 3 above.
- Updates after each exchange.

---

## 7. Interactions & Data Flow

### WebSocket Connection

- Client opens `ws://localhost:8000/ws/{conversation_id}` after creating/opening a conversation.
- Connection persists across multiple message exchanges within a conversation.
- **Reconnection:** On disconnect, attempt reconnection with exponential backoff (up to 3 attempts). Show "Connection lost — reconnecting..." indicator. If all attempts fail, show a persistent error with a manual reconnect option.

### Message Send Flow

1. User types message, presses Enter or clicks Send.
2. Frontend sends `send_message` via WebSocket with `content`, `model_id`, `provider`, `reasoning_level`.
3. "Sending..." indicator appears immediately.
4. Server streams events back (`stream_reasoning`, `tool_call_start`, `tool_step`, `summary_started/complete`, `stream_token`, `stream_done`).
5. On `stream_done`, frontend stores `message_id` and `visibility_id`, then fetches fresh token counts via REST.

### Model Selection

- Provider/model/reasoning are global controls (not per-conversation). Changing them affects the next message sent.
- Switching models updates the token stats in the top bar immediately (recalculated against the new model's context window).
- If the model doesn't support reasoning (`reasoning_levels` is empty), the reasoning dropdown is hidden.
- If the model doesn't support tools (`supports_tools` is false), tools simply won't trigger — no UI change needed.

### Visibility Pane Interaction

- User clicks inspect on an assistant message → visibility pane opens (or updates if already open) with that message's data.
- Data fetched from `GET /api/messages/{id}/visibility`.
- Pane stays on selected message regardless of new streaming activity.
- User can switch between tabs and collapse/expand JSON nodes freely within each tab.

---

## 8. Delegated Decisions

The following were explicitly left to the builder's judgment:

- Exact sidebar width, visibility pane width, and resize behavior (if any)
- Specific color values, border styles, spacing — within the Cursor-like dark aesthetic
- Visibility pane tab ordering (the seven tabs listed above — builder can order by what's most useful)
- Streaming/typing animation style
- "Sending..." indicator style
- WebSocket reconnection indicator placement
- Exact layout of token stats in the top bar (inline, row below dropdowns, etc.)
- Visual style for empty states in visibility pane tabs when data is not present
- Hover/focus states on interactive elements
- Scrollbar styling
- Transition animations for pane collapse/expand
- Empty state visual design beyond "Wayne" branding + ready input

---

## 9. Technical Notes

- **Backend surface area:** `docs/frontend_surface_area.md` contains the complete API contract with JSON shapes, WebSocket event formats, and edge cases.
- **State management:** Zustand stores for conversation list, active conversation messages, model catalog, streaming state, and visibility data.
- **Token count refresh:** After `stream_done`, fetch `GET /api/conversations/{id}/token-counts`. Background-computed counts (`tokens_anthropic`, `tokens_openrouter`) may be null initially — implement a short delayed re-fetch (1-2 seconds) to catch them.
- **OpenRouter models can be empty.** Handle gracefully with a "No models available" state and the refresh button.
- **Tool step count is variable** (3-7+ steps). The stepper/timeline UI must handle dynamic step counts including retry loops.
- **No settings page, no API key UI for v1.** Keys are configured in `.env` on the backend. Provider availability is indicated in the dropdown via the `available` boolean.
- **No mobile support for v1.**
