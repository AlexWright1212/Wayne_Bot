# Wayne v1 — Specification

**Version:** 1.0
**Date:** 2026-03-01
**Status:** Draft — pending approval

---

## 1. Vision and Scope

### 1.1 What Wayne Is

Wayne is a personal chatbot application built for a single user. It provides a conversational interface to multiple LLM providers (OpenAI, Anthropic, OpenRouter) with full transparency into every internal process — every API payload, every token count, every tool call, every decision the system makes is inspectable.

Wayne v1 is the foundation: a fully functional chatbot with in-chat memory management, web search via a deterministic research harness, multi-provider model selection with provider-specific reasoning controls, and a transparency layer that exposes all internal mechanics.

### 1.2 What Wayne Is Not (v1)

The following are explicitly out of scope for v1:

- Long-term memory across chats (persistent facts, user profile)
- RAG / document retrieval
- Email, calendar, or any external integrations
- Agent orchestration / subagent spawning
- File upload or multimodal input
- Content moderation or safety filtering
- Mobile support
- Multi-user / authentication
- API cost/pricing tracking
- User-configurable system prompt
- Search across chat history
- Message editing, regeneration, or branching

### 1.3 Future Direction

Wayne will evolve into a fully agentic personal assistant capable of accessing email, executing terminal commands, searching personal knowledge bases (Obsidian), orchestrating multi-step research, and running code. v1 lays the architectural groundwork for all of this. Every design decision should consider future extensibility without over-engineering for it now.

---

## 2. User Experience

### 2.1 Application Model

Wayne is a locally-hosted web application. The user runs it on their own machine and accesses it at `localhost` in a browser. There is no deployment, no cloud hosting, no authentication. It is a single-user tool.

### 2.2 Core Interface

The interface follows the established chat application pattern:

- **Left sidebar:** A list of past conversations, ordered by most recent. Each entry shows the auto-generated title. The user can rename or delete conversations from this sidebar.
- **Main panel:** The active conversation. User messages appear on one side, assistant responses on the other. Responses stream in token-by-token in real-time.
- **Top bar / header area:** Model and provider selection controls, reasoning level configuration.

### 2.3 User Flows

#### Starting a New Chat
1. User clicks "New Chat" (or equivalent).
2. A new empty conversation is created.
3. User types a message and sends it.
4. The system sends the message to the selected LLM and streams the response.
5. After the first exchange, the system auto-generates a title for the conversation using a lightweight model.

#### Continuing a Chat
1. User clicks a conversation in the sidebar.
2. The full message history loads in the main panel.
3. User sends a new message. The system assembles the context (all messages, or summary + recent messages if rolling summary has been triggered) and sends it to the selected LLM.

#### Switching Models Mid-Conversation
1. User changes the model/provider selection in the header.
2. The next message uses the new model.
3. If the new model has a smaller context window and the current conversation exceeds 80% of it, a rolling summary is triggered before the next API call.

#### Deleting a Chat
1. User selects delete on a conversation in the sidebar.
2. The conversation and all associated data (messages, summaries, tool traces, visibility data) are permanently removed.

#### Renaming a Chat
1. User selects rename on a conversation in the sidebar.
2. User enters a new title.
3. The title updates immediately.

---

## 3. Model Configuration

### 3.1 Supported Providers

#### OpenAI (Direct SDK)
- **Connection:** OpenAI Python SDK, API key via `.env`
- **Available models:** GPT-4o, GPT-4o-mini, o1, o3-mini, and future models as released
- **Reasoning control:** A dropdown with options: none, low, medium, high. Maps to OpenAI's `reasoning_effort` parameter. When a reasoning level is selected, the response may include a concise reasoning summary, which is captured and made available in the visibility layer.
- **Streaming:** Yes, via SSE

#### Anthropic (Direct SDK)
- **Connection:** Anthropic Python SDK, API key via `.env`
- **Available models:** Claude Haiku, Sonnet, Opus (current versions)
- **Reasoning control:** A dropdown with options: off, low, medium, high, adaptive. Maps to Claude's extended thinking feature with `budget_tokens`. "Adaptive" means Claude chooses how much to think, up to the selected maximum. When extended thinking is active, raw reasoning tokens are captured and made available in the visibility layer.
- **Streaming:** Yes, via SSE

#### OpenRouter (Unified API)
- **Connection:** OpenRouter API, API key via `.env`
- **Available models:** Fetched dynamically from OpenRouter's model list API. Primary targets are DeepSeek R1, DeepSeek V3, but any model available on OpenRouter can be selected.
- **Reasoning control:** Provider-specific behavior. For DeepSeek R1 models, reasoning is baked in (always-on) and raw reasoning output is parsed and captured for the visibility layer. For non-reasoning models (DeepSeek V3, etc.), no reasoning controls are shown.
- **Streaming:** Yes, via SSE

### 3.2 API Key Management

All API keys are stored in a `.env` file in the project root, loaded by the backend at startup. The keys are never exposed to the frontend. The `.env` file is gitignored.

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
TAVILY_API_KEY=tvly-...
```

### 3.3 Lightweight Model

Several internal operations use a lightweight model rather than the user's selected model:

- Rolling summary generation
- Auto-titling conversations
- Search harness plumbing (classifier, query generation, entity extraction, coverage check)

The lightweight model is a single configured choice (e.g., GPT-4o-mini or Claude Haiku). It is not user-selectable in v1 — it is a backend configuration.

---

## 4. In-Chat Memory (Rolling Summary)

### 4.1 Purpose

Within a single conversation, the message history grows with each exchange. Eventually it will exceed the context window of the active model. The rolling summary system compresses older messages into a summary to keep the conversation within context limits while preserving continuity.

### 4.2 How It Works

1. **Token counting:** After each model response, the system estimates the total token count of the messages array (system prompt + all messages). Token estimation uses tiktoken for OpenAI models and approximation heuristics for other providers.

2. **Threshold check:** If the estimated token count exceeds **80% of the active model's context window**, a rolling summary is triggered.

3. **Summary generation:**
   - Calculate 50% of the context window as the "summary budget."
   - Starting from the oldest messages (but always keeping the system prompt), accumulate message pairs (user + assistant) until the next pair would push past the 50% mark.
   - Send those accumulated messages to the **lightweight model** with instructions to produce a concise summary preserving key facts, decisions, and context.
   - Replace those messages with a single summary message.

4. **Result:** The messages array now contains: system prompt, summary message, and the remaining recent messages — fitting within the model's context window.

### 4.3 Context Window Sizes

The system maintains a lookup table mapping each model to its context window size in tokens. This table is used for threshold calculations. When a model is fetched dynamically from OpenRouter, context window size is obtained from the OpenRouter model metadata.

### 4.4 Model Switching and Summary

If the user switches to a model with a smaller context window mid-conversation, the system checks the threshold immediately. If the current messages exceed 80% of the *new* model's context window, a rolling summary is triggered before the next API call.

### 4.5 Visibility

Rolling summaries are **not** shown inline in the chat. The user sees a continuous conversation. However, the transparency layer captures and exposes:

- When a summary was triggered (which message exchange caused it)
- The messages that were summarized (full content)
- The summary that was generated
- The token counts before and after

---

## 5. Search Tool — Deterministic Research Harness

### 5.1 Purpose

Wayne can search the web when a user's question requires current or external information. The search is **model-initiated** — the model decides when a search is needed; there is no manual search button. The search process follows a deterministic, multi-step harness that uses a series of targeted LLM calls and Tavily API searches to gather, filter, and synthesize information.

### 5.2 Search API

**Tavily Search API.** Tavily is purpose-built for LLM applications and returns clean, extracted content rather than raw HTML. API key stored in `.env`.

### 5.3 Harness Flow

The harness is a Python-orchestrated pipeline. Each step is a discrete, logged operation. The harness uses the **lightweight model** for all plumbing steps (Steps 1-4, 6) and the **user's selected chat model** for synthesis (Step 7).

#### Step 1 — Search Need Classification

- **Input:** The user's original message.
- **Action:** LLM call with a classifier prompt: "Does this query require a web search to answer? What entities or information are missing?"
- **Output:** JSON with `needs_search` (boolean) and `missing_entities` (array of strings).
- **Branch:** If `needs_search` is false, skip the harness entirely and let the chat model respond directly.

#### Step 2 — Query Generation

- **Input:** Original query + missing entities from Step 1.
- **Action:** LLM call to generate search queries. The LLM produces two categories:
  - `ready_queries`: Queries that can be executed immediately.
  - `pending_queries`: Template queries with `{{slot}}` placeholders that depend on entities not yet known (to be filled after initial search results arrive).
- **Output:** JSON with both query arrays.

#### Step 3 — Execute Ready Queries

- **Input:** `ready_queries` from Step 2.
- **Action:** Call Tavily API for each ready query. Collect results.
- **Sub-step — Entity Extraction:** If `pending_queries` exist, make an LLM call against the search results to extract the entities needed to fill template slots.
- **Output:** Search results + extracted entities (if applicable).

#### Step 4 — Fill Templates and Execute Round 2

- **Input:** `pending_queries` + extracted entities from Step 3.
- **Action:** String-replace `{{slot}}` placeholders with extracted entities. Execute the now-complete queries via Tavily.
- **Output:** Additional search results added to the results collection.

#### Step 5 — Deterministic Result Filtering (No LLM)

- **Input:** All raw search results collected across rounds.
- **Action:** Python code applies deterministic rules:
  - Discard results below a relevance score threshold (e.g., Tavily score < 0.75)
  - Discard results older than a date threshold (configurable, e.g., older than 1 year)
  - Discard results from blacklisted domains (hardcoded list)
  - Deduplicate by URL
- **Output:** `filtered_results` — clean, scored, relevant results.

#### Step 6 — Coverage Check

- **Input:** Original user query + all filtered result snippets.
- **Action:** LLM call: "Do these results contain enough information to fully answer the user's question? What's missing?"
- **Output:** JSON with `sufficient` (boolean), `missing` (array of strings), and `confidence` (float).
- **Branch:** If `sufficient` is false, generate new queries targeting the `missing` items and loop back to Step 3. **Maximum 2 retry loops** (3 total search rounds). After the cap, proceed to synthesis with available results and note any gaps.

#### Step 7 — Synthesis

- **Input:** Original user query + filtered results (snippets + source URLs).
- **Action:** Call the **user's selected chat model** (not the lightweight model) with instructions to answer the question using only the provided sources, citing inline.
- **Output:** The final assistant response, grounded in search results with citations.

### 5.4 Harness Visibility

The transparency layer captures every harness step and streams progress to the UI in real-time as steps complete:

| Step | What is exposed |
|---|---|
| Step 1 | Classifier JSON output (needs_search, missing_entities) |
| Step 2 | Generated queries (both ready and pending templates) |
| Step 3 | Filled query strings sent to Tavily, entity extraction LLM output. Tavily results shown as cleaned final output only (title, URL, snippet, score) — not raw API internals |
| Step 4 | Filled template queries, additional Tavily results (same cleaned format) |
| Step 5 | Which results were filtered out and why (score too low, too old, blacklisted, duplicate) |
| Step 6 | Coverage verdict JSON (sufficient, missing, confidence). If looping, show the decision to retry and new missing entities |
| Step 7 | The synthesis prompt sent to the chat model (so the user can see exactly what context the model received) |

The user sees harness steps appearing in real-time as a "research in progress" sequence, with each step's status (running, complete) visible. The final synthesized answer then streams in as the normal assistant response.

---

## 6. Visibility and Transparency Layer

### 6.1 Philosophy

Every internal process in Wayne should be inspectable. The user should never wonder "what did the model actually receive?" or "why did it say that?" The visibility layer is the answer. It is a separate UI surface (not inline in the chat) where the user can drill into the mechanics of any exchange.

### 6.2 What Is Captured

For **every assistant response**, the following is captured and stored:

#### API Payload Exposure
- The complete messages array sent to the LLM: system prompt, summary messages (if any), conversation messages, tool definitions/schemas
- The model identifier and provider used
- All request parameters (temperature, max_tokens, reasoning settings, etc.)
- The raw response metadata (finish reason, token usage reported by the API)

#### Token Tracking
- Estimated input tokens (local estimate)
- Output tokens (from API response)
- Running total for the conversation
- Context window utilization percentage

#### Chain of Thought / Reasoning
- **OpenAI:** Concise reasoning summaries when reasoning effort is set above "none"
- **Anthropic:** Raw extended thinking content when extended thinking is enabled
- **DeepSeek R1 (via OpenRouter):** Parsed reasoning content from the response
- **Models without reasoning:** Nothing displayed; field is absent

#### Rolling Summary Events
- When triggered: which exchange caused the threshold to be crossed
- The messages that were consumed by the summary
- The generated summary text
- Token counts before and after summarization

#### Search Harness Events
- Full step-by-step trace as described in Section 5.4
- Each LLM call within the harness (prompt sent, response received)
- Tavily results in cleaned format
- Timing of each step

### 6.3 How It Is Accessed

The specific UI pattern for accessing visibility data (drawer, panel, modal, expandable sections) is deferred to the implementation/design phase. The backend must make all visibility data available via API endpoints so the frontend can present it however is most effective.

The key requirement is: **every assistant message has associated visibility data, and the user can access it per-message.**

---

## 7. System Prompt

### 7.1 Default System Prompt

Wayne has a single, global system prompt that is prepended to every conversation. It is hardcoded in the backend and not configurable via the UI in v1.

The system prompt should:

- Identify the assistant as Wayne
- Establish a helpful, direct communication style
- Instruct the model to be thorough but concise
- Not include personality gimmicks or role-play elements
- Be provider-agnostic (work well with OpenAI, Anthropic, and OpenRouter models)

The exact wording will be finalized during implementation, but it should be short (under 500 tokens) to preserve context window space.

### 7.2 System Prompt in Visibility

The system prompt is always visible in the API payload exposure for any message, since it is part of what gets sent to the model.

---

## 8. Streaming and Real-Time Behavior

### 8.1 Response Streaming

All LLM responses stream token-by-token to the frontend via WebSocket. The user sees text appearing progressively, matching the experience of ChatGPT/Claude.

### 8.2 Search Harness Streaming

When the search harness is running, the user sees a real-time progress sequence:

1. "Checking if search is needed..." → Step 1 result appears
2. "Generating search queries..." → Step 2 queries appear
3. "Searching..." → Step 3 results appear
4. (If applicable) "Searching for details..." → Step 4 results appear
5. "Filtering results..." → Step 5 summary appears
6. "Checking coverage..." → Step 6 verdict appears
7. (If looping) Steps repeat with "Searching for more info..." indication
8. "Generating answer..." → Final response streams in token-by-token

Each step's detailed data is available in the visibility layer. The inline chat shows a condensed progress indicator.

### 8.3 Auto-Title and Summary

Auto-titling and rolling summary operations run asynchronously — they do not block the user from continuing to use the chat. The sidebar title updates when auto-titling completes. Rolling summary runs after a response is delivered, before the next user message is sent.

---

## 9. Data Model (Conceptual)

This section describes *what* is stored, not the exact database schema (which is an implementation concern).

### 9.1 Conversation
- Unique identifier
- Title (auto-generated or user-renamed)
- Created timestamp
- Last updated timestamp
- The model/provider that was last used (for display purposes)

### 9.2 Message
- Unique identifier
- Belongs to a conversation
- Role: user, assistant, system, or summary
- Content (text)
- Timestamp
- The model/provider that generated it (for assistant messages)
- Associated visibility data (see below)

### 9.3 Visibility Record
- Belongs to a message (one-to-one with assistant messages)
- API payload sent (full messages array, parameters)
- API response metadata (tokens, finish reason)
- Estimated input tokens
- Output tokens
- Chain of thought / reasoning content (if available)
- Rolling summary event data (if a summary was triggered for this exchange)
- Search harness trace (if search was invoked): all step inputs and outputs

### 9.4 Rolling Summary
- Belongs to a conversation
- The summary text
- Which messages were summarized (by ID or content snapshot)
- Token count before and after
- Timestamp

---

## 10. Configuration Summary

| Setting | Location | User-Facing |
|---|---|---|
| API keys (OpenAI, Anthropic, OpenRouter, Tavily) | `.env` file | No |
| Lightweight model selection | Backend config | No |
| System prompt | Backend code | No |
| Active model/provider | UI header controls | Yes |
| Reasoning level | UI header controls (per-provider) | Yes |
| Tavily score threshold | Backend config | No |
| Tavily date threshold | Backend config | No |
| Domain blacklist | Backend config | No |
| Context window sizes per model | Backend config + OpenRouter API | No |

---

## 11. Acceptance Criteria

Wayne v1 is complete when:

1. **Chat works end-to-end:** User can start a new conversation, send messages, and receive streamed responses from OpenAI, Anthropic, or OpenRouter models.
2. **Sidebar management:** Conversations appear in the sidebar, can be resumed, renamed, and deleted.
3. **Auto-titling:** Conversations receive an auto-generated title after the first exchange.
4. **Model switching:** User can select a provider, a model, and a reasoning level from the UI. These can be changed mid-conversation.
5. **OpenRouter dynamic models:** Available OpenRouter models are fetched dynamically from the API.
6. **Rolling summary:** When a conversation exceeds 80% of the active model's context window, older messages are automatically summarized. The conversation continues seamlessly.
7. **Search harness:** When the model determines a web search is needed, the full deterministic harness executes (classify, query gen, search, filter, coverage check, synthesize) with results grounded in sources.
8. **Real-time harness progress:** Search harness steps appear live in the UI as they complete.
9. **Visibility — payload exposure:** For any assistant message, the user can inspect the full API payload that was sent and the response metadata.
10. **Visibility — token tracking:** Input/output token estimates are captured and displayed per message and as a running conversation total.
11. **Visibility — chain of thought:** Reasoning content is captured and displayed when available (Anthropic extended thinking, OpenAI reasoning summaries, DeepSeek R1 reasoning).
12. **Visibility — rolling summary events:** When a summary is triggered, the event details (what was summarized, the result, token impact) are captured and inspectable.
13. **Visibility — search harness trace:** All harness steps, LLM calls, and cleaned Tavily results are captured and inspectable.
14. **System prompt:** A global system prompt is included in every conversation.
15. **Data persists:** All conversations, messages, and visibility data survive application restarts (PostgreSQL).

---

## 12. Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite |
| Backend | Python + FastAPI + Poetry |
| Database | PostgreSQL (local) |
| Frontend-Backend Communication | REST (CRUD) + WebSocket (streaming) |
| LLM — OpenAI | OpenAI Python SDK |
| LLM — Anthropic | Anthropic Python SDK |
| LLM — OpenRouter | OpenRouter REST API (or compatible SDK) |
| Search | Tavily Search API |
| Token Estimation | tiktoken + heuristic approximation |
