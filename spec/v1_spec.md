# Wayne v1 — Specification

**Version:** 1.1
**Date:** 2026-03-02
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
3. User sends a new message. The system assembles the context (all messages, potential summary, system prompt, etc.) and sends it to the selected LLM.

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
- **Available models:** GPT-5.2 (flagship reasoning), GPT-5 (default workhorse), GPT-5 mini (cost-efficient mid-tier), GPT-5 nano (cheapest/fastest). Legacy models (GPT-4o, GPT-4o-mini, o3, o4-mini) are not included.
- **Reasoning control:** A dropdown with options: none, low, medium, high, xhigh. Maps to OpenAI's `reasoning.effort` parameter. When a reasoning level above "none" is selected, concise reasoning summaries can be opted into and are captured for the visibility layer.
- **Tool calling:** Supported natively via function calling. Tool schemas are passed in the API request; the model returns `tool_calls` when it decides to use a tool.
- **Streaming:** Yes, via SSE

#### Anthropic (Direct SDK)
- **Connection:** Anthropic Python SDK, API key via `.env`
- **Available models:** Claude Opus 4.6 (top-tier reasoning/coding), Claude Sonnet 4.6 (best balance of cost/performance), Claude Haiku 4.5 (cheapest/fastest).
- **Reasoning control:** A dropdown with options: off, low, medium, high, adaptive. Maps to Claude's adaptive thinking feature (recommended) or the effort parameter. "Adaptive" means Claude decides how much to think based on problem complexity. When thinking is active, raw reasoning tokens are captured and made available in the visibility layer.
- **Tool calling:** Supported natively via tool use. Tool schemas are passed in the API request; the model returns `tool_use` content blocks when it decides to use a tool.
- **Streaming:** Yes, via SSE

#### OpenRouter (Unified API)
- **Connection:** OpenRouter API, API key via `.env`
- **Available models:** Fetched dynamically from OpenRouter's model list API. Primary targets are DeepSeek R1 (reasoning, always-on CoT) and DeepSeek V3.2 (latest general model), but any model available on OpenRouter can be selected.
- **Reasoning control:** Provider-specific behavior. For DeepSeek R1 models, reasoning is baked in (always-on) and raw reasoning output is parsed and captured for the visibility layer. For non-reasoning models (DeepSeek V3.2, etc.), no reasoning controls are shown.
- **Tool calling:** Supported via OpenAI-compatible function calling format. Tool calling capability varies by model — models that do not support tool calling will not have tools available.
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
- Search harness plumbing (query refinement, entity extraction, coverage check)

The default lightweight model is **GPT-5 nano** ($0.05/$0.40 per million tokens) — the cheapest and fastest model from OpenAI's current lineup. This always routes through OpenAI regardless of the user's selected chat provider, since it is a backend utility operation. It is not user-selectable in v1 — it is a backend configuration.

---

## 4. In-Chat Memory (Rolling Summary)

### 4.1 Purpose

Within a single conversation, the message history grows with each exchange. Eventually it will exceed the context window of the active model. The rolling summary system compresses older messages into a summary to keep the conversation within context limits while preserving continuity.

### 4.2 How It Works

1. **Token counting:** When the user sends a message (before the API call), the system counts the total tokens of the messages array (system prompt + all messages + the new user message) using the counting method appropriate to the currently selected model's provider (see Section 4.3).

2. **Threshold check:** If the token count exceeds **80% of the active model's context window**, a rolling summary is triggered before the user's message is sent to the LLM.

3. **Summary generation:**
   - Calculate 50% of the context window as the "summary budget."
   - Starting from the oldest messages (but always keeping the system prompt), accumulate message pairs (user + assistant) until the next pair would push past the 50% mark.
   - Note that previous summaries should also be counted as they are sent to the model and contribute to token counts.
   - Send those accumulated messages to the **lightweight model** with instructions to produce a concise summary preserving key facts, decisions, and context.
   - Replace those messages with a single summary message.

4. **Result:** The messages array now contains: system prompt, summary message, and the remaining recent messages — fitting within the model's context window. The user's new message is then sent to the LLM with the compressed context.

**Note:** Because the summary check happens at send-time, it is a **blocking operation**. If a summary is triggered, the user experiences a brief delay before their message reaches the LLM. The UI should display a "Compressing conversation history..." indicator during this time.

### 4.3 Token Counting Methods

Three token counting methods are used, one per provider integration:

| Provider | Method | Type | Notes |
|---|---|---|---|
| **OpenAI** | `tiktoken` library | Local (no API call) | Exact token count for OpenAI models. Used as the counting method when the active model is an OpenAI model. |
| **Anthropic** | `messages.count_tokens()` SDK method | API call (network) | Exact token count for Anthropic models. Used as the counting method when the active model is an Anthropic model. |
| **OpenRouter** | Characters / 3.5 (heuristic) | Local (no API call) | Conservative approximation. Slightly overcounts vs reality, which is safer for the rolling summary threshold. Used when the active model is an OpenRouter model. |

**For the rolling summary check:** Only the counting method matching the active model's provider is used, and it runs synchronously (it must complete before the message is sent).

**For display purposes (visibility layer):** All three counts are computed for every assistant response. The non-active-provider counts run asynchronously and are non-blocking — they populate in the visibility layer after the response is delivered.

### 4.4 Context Window Sizes

The system maintains a lookup table mapping each model to its context window size in tokens. This table is used for threshold calculations. When a model is fetched dynamically from OpenRouter, context window size is obtained from the OpenRouter model metadata.

### 4.5 Token Display

The user can always see two pieces of token information:

1. **All three provider token counts** for the current messages array — how many tokens the current conversation state represents according to OpenAI (tiktoken), Anthropic (count_tokens API), and OpenRouter (heuristic). These are always visible regardless of which model is selected, allowing the user to compare how different tokenizers interpret the same conversation.

2. **Context window utilization for the selected model** — the token count from the matching provider (e.g., tiktoken count if an OpenAI model is selected) displayed as a fraction of the model's context window. For example: `42,381 / 200,000 tokens (21.2%)`. This updates when the user switches models, immediately showing utilization against the new model's context window.

### 4.6 Visibility

Rolling summaries are **not** shown inline in the chat. The user sees a continuous conversation. However, the transparency layer captures and exposes:

- When a summary was triggered (which message exchange caused it)
- The messages that were summarized (full content)
- The summary that was generated
- The token counts before and after

---

## 5. Tool Framework & Web Search

### 5.1 Tool Framework

Wayne uses a **pluggable tool framework** built on LLM-native tool calling (function calling). Tools are capabilities beyond basic chat — web search, and in future versions, email, terminal commands, knowledge base search, etc.

#### How It Works

1. **Tool registration:** Each tool registers itself with a name, description, parameter schema, and an execution handler. The framework collects all registered tools into a unified tool schema list.
2. **Tool schemas sent to LLM:** When the user sends a message, the backend includes all registered tool schemas in the API request to the chat LLM. The schema format is normalized per provider (OpenAI function calling format, Anthropic tool use format, OpenRouter OpenAI-compatible format).
3. **LLM decides:** The chat LLM decides whether to call a tool based on the user's message and conversation context. If no tool is needed, the LLM responds directly. If a tool is needed, it returns a tool call with the tool name and arguments.
4. **Tool execution:** The backend routes the tool call to the appropriate handler. The handler executes the tool (which may involve its own multi-step pipeline) and returns structured results.
5. **Results returned to LLM:** The tool results are sent back to the chat LLM as a tool result message. The LLM then synthesizes its final response incorporating the tool output.
6. **Conversation persistence:** Tool calls and tool results are persisted in the conversation's message history, so the model has access to previous tool results for follow-up questions.

#### Design Principles

- **Tools are self-contained:** Each tool manages its own execution logic. The framework only handles registration, schema delivery, routing, and result passing.
- **Provider-agnostic:** The framework normalizes tool schemas and tool call/result formats across providers. A tool author writes one implementation; the framework handles the per-provider translation.
- **Visibility built-in:** Every tool execution produces a trace that is captured by the visibility layer. The framework defines a standard trace format; tools populate it with step-by-step detail.
- **Graceful degradation:** If the active model does not support tool calling (e.g., some OpenRouter models), the tools are simply not included in the API request. The LLM responds using only its own knowledge.

#### v1 Tools

Wayne v1 ships with one tool: **web_search** (Section 5.3). The framework is designed so that future tools can be added by implementing the tool interface — no changes to the chat pipeline or framework plumbing required.

### 5.2 Search API

**Tavily Search API.** Tavily is purpose-built for LLM applications and returns clean, extracted content rather than raw HTML. API key stored in `.env`.

### 5.3 Web Search Tool — Harness Flow

The web search tool uses a **hybrid approach**: the chat LLM triggers the search via native tool calling, but the actual search execution runs through a deterministic, multi-step research harness. This gives the quality and reliability of a controlled pipeline while leveraging the LLM's natural understanding of when search is needed.

#### Tool Schema

The `web_search` tool is registered with the following schema (conceptual):

```json
{
  "name": "web_search",
  "description": "Search the web for current or factual information needed to answer the user's question. Use this when the question requires up-to-date information, specific facts, or knowledge you may not have.",
  "parameters": {
    "reason": "Brief explanation of why web search is needed",
    "query": "The information need described clearly for the search system"
  }
}
```

The chat LLM provides a high-level description of what it needs. The harness handles query refinement, multi-round searching, and result quality control.

#### Harness Pipeline

The harness is a Python-orchestrated pipeline. Each step is a discrete, logged operation. The harness uses the **lightweight model** (GPT-5 nano) for all plumbing steps (Steps 1, 2, 4, 5).

##### Step 1 — Query Generation

- **Input:** The `reason` and `query` from the tool call, plus the original user message for context.
- **Action:** LLM call (lightweight model) to generate optimized search queries. The LLM produces two categories:
  - `ready_queries`: Queries that can be executed immediately.
  - `pending_queries`: Template queries with `{{slot}}` placeholders that depend on entities not yet known (to be filled after initial search results arrive).
- **Output:** JSON with both query arrays.

##### Step 2 — Execute Ready Queries

- **Input:** `ready_queries` from Step 1.
- **Action:** Call Tavily API for each ready query. Collect results.
- **Sub-step — Entity Extraction:** If `pending_queries` exist, make an LLM call (lightweight model) against the search results to extract the entities needed to fill template slots.
- **Output:** Search results + extracted entities (if applicable).

##### Step 3 — Fill Templates and Execute Round 2

- **Input:** `pending_queries` + extracted entities from Step 2.
- **Action:** String-replace `{{slot}}` placeholders with extracted entities. Execute the now-complete queries via Tavily.
- **Output:** Additional search results added to the results collection.

##### Step 4 — Deterministic Result Filtering (No LLM)

- **Input:** All raw search results collected across rounds.
- **Action:** Python code applies deterministic rules:
  - Discard results below a relevance score threshold (default: Tavily score < 0.75)
  - Discard results older than a date threshold (default: 1 year)
  - Discard results from blacklisted domains (hardcoded list)
  - Deduplicate by URL
- **Output:** `filtered_results` — clean, scored, relevant results.

##### Step 5 — Coverage Check

- **Input:** Original user query + all filtered result snippets.
- **Action:** LLM call (lightweight model): "Do these results contain enough information to fully answer the user's question? What's missing?"
- **Output:** JSON with `sufficient` (boolean), `missing` (array of strings), and `confidence` (float).
- **Branch:** If `sufficient` is false, generate new queries targeting the `missing` items and loop back to Step 2. **Maximum 2 retry loops** (3 total search rounds). After the cap, proceed with available results and note any gaps.

##### Result Return

The filtered results (titles, URLs, snippets, scores) are returned to the chat LLM as the tool result. The LLM then synthesizes its response naturally, incorporating the search results and citing sources inline. There is no separate synthesis step — the chat LLM handles this as part of its normal response generation after receiving the tool result.

### 5.4 Search Results in Conversation Context

When the harness completes, the results are integrated into the conversation's message history using the standard tool calling message pattern:

```
user: "What are the best JS frameworks in 2026?"
assistant: [tool_call: web_search({reason: "...", query: "..."})]
tool: [cleaned search results as structured JSON — the filtered output from Step 4]
assistant: "Based on my research, here are..."
```

- The **user message** is the original query.
- The **assistant message with tool_call** records the LLM's decision to search and the arguments it provided. This is persisted but not displayed as chat content.
- The **tool result message** contains the cleaned, filtered search results (post-Step 4). This persists in the messages array and is included in future API calls, so the model has access to the search results for follow-up questions.
- The **final assistant message** is the LLM's synthesized response incorporating the search results, which is what the user sees in the main chat.

The tool call and tool result messages are not displayed in the main chat interface — they exist in the messages array (visible in the visibility layer's payload exposure). The full harness trace (all steps, all intermediate LLM calls) is captured separately in the visibility layer.

### 5.5 Harness Visibility

The transparency layer captures every harness step and streams progress to the UI in real-time as steps complete. In addition to the search results persisted in the conversation context (Section 5.4), the following per-step detail is captured:

| Step | What is exposed |
|---|---|
| Tool call | The chat LLM's tool call arguments (reason, query) — showing why the model decided to search |
| Step 1 | Generated queries (both ready and pending templates) |
| Step 2 | Query strings sent to Tavily, entity extraction LLM output. Tavily results shown as cleaned final output only (title, URL, snippet, score) — not raw API internals |
| Step 3 | Filled template queries, additional Tavily results (same cleaned format) |
| Step 4 | Which results were filtered out and why (score too low, too old, blacklisted, duplicate) |
| Step 5 | Coverage verdict JSON (sufficient, missing, confidence). If looping, show the decision to retry and new missing entities |

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
- Three provider token counts for the current messages array: OpenAI (tiktoken), Anthropic (count_tokens API), and OpenRouter (characters / 3.5 heuristic)
- Output tokens (from API response)
- Context window utilization: token count from the active provider shown as a fraction of the selected model's context window

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

#### Tool Call Events
- Which tool was called and with what arguments (the LLM's decision)
- Full step-by-step execution trace (as described in Sections 5.3 and 5.5 for web search)
- Each LLM call within the tool's pipeline (prompt sent, response received)
- Tool-specific detail (e.g., Tavily results in cleaned format for web search)
- Timing of each step

### 6.3 How It Is Accessed

The specific UI pattern for accessing visibility data (drawer, panel, modal, expandable sections) is deferred to the implementation/design phase. The backend must make all visibility data available via API endpoints so the frontend can present it however is most effective.

The key requirement is: **every assistant message has associated visibility data, and the user can access it per-message.**

Additionally, **every internal LLM call** (rolling summary, auto-titling, search harness plumbing steps) captures and exposes the full prompt sent to the model and the full response received. The user can inspect exactly what instructions the lightweight model was given for any background operation.

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

### 8.2 Tool Execution Streaming

When a tool is triggered by the chat LLM, the user sees a real-time progress sequence. For the web search tool:

1. "Generating search queries..." → Step 1 queries appear
2. "Searching..." → Step 2 results appear
3. (If applicable) "Searching for details..." → Step 3 results appear
4. "Filtering results..." → Step 4 summary appears
5. "Checking coverage..." → Step 5 verdict appears
6. (If looping) Steps repeat with "Searching for more info..." indication
7. Final response streams in token-by-token as the chat LLM synthesizes

Each step's detailed data is available in the visibility layer. The inline chat shows a condensed progress indicator.

### 8.3 Auto-Title

Auto-titling runs asynchronously after the first exchange — it does not block the user from continuing to use the chat. The sidebar title updates when auto-titling completes.

Note: Rolling summary timing is defined in Section 4.2 — it runs synchronously at send-time (blocking) when the token threshold is exceeded.

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
- Role: user, assistant, system, tool_call, tool_result, or summary
- Content (text, or structured JSON for tool_call/tool_result messages)
- Timestamp
- The model/provider that generated it (for assistant messages)
- The reasoning level that was active when generated (for assistant messages)
- Tool name and arguments (for tool_call messages)
- Tool name and call ID (for tool_result messages, linking back to the tool_call)
- Associated visibility data (see below)

### 9.3 Visibility Record
- Belongs to a message (one-to-one with assistant messages)
- API payload sent (full messages array, parameters)
- API response metadata (tokens, finish reason)
- Three provider token counts (OpenAI via tiktoken, Anthropic via count_tokens, OpenRouter via heuristic)
- Output tokens (from API response)
- Context window utilization for the active model
- Chain of thought / reasoning content (if available)
- Rolling summary event data (if a summary was triggered for this exchange)
- Tool execution trace (if a tool was invoked): tool name, arguments, all pipeline step inputs and outputs, timing

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

## 11. Error Handling

### 11.1 API Key Validation

At startup, the backend checks which API keys are present in `.env` (existence check only — no network calls). The UI displays a status indicator per provider in the model selector: a checkmark if a key is configured, a warning icon if no key is present. Providers with no key are still visible in the selector but cannot be used.

On first actual use of a provider, the real API call validates the key. If validation fails (invalid key, expired, revoked), the user sees an error message: "API key for [provider] is invalid. Check your .env file." The provider remains visible but unusable until the key is corrected and the backend is restarted.

### 11.2 Provider API Failures

If a provider's API fails during a chat request (network error, rate limit, server error), the user sees an error message in the chat area indicating the failure. The message is not retried automatically — the user can retry by resending.

### 11.3 OpenRouter Model List Fetch Failure

If the OpenRouter model list cannot be fetched (network error, invalid key), the OpenRouter section of the model selector is grayed out with a message indicating the failure. OpenAI and Anthropic models remain usable.

### 11.4 Tavily Search Failures

If the Tavily API fails during a search harness execution (network error, invalid key, rate limit):

1. The harness retries the failed call **once**.
2. If the retry also fails, the harness aborts and returns a structured error as the tool result, indicating that the search could not be completed.
3. The chat model receives this error as the tool result and responds to the user's query using only its own knowledge, noting that it was unable to search the web.
4. The visibility layer captures the full failure trace: which step failed, the error returned, the retry attempt, and the abort decision.

### 11.5 Lightweight Model Failures

If the lightweight model (GPT-5 nano) fails during a rolling summary, auto-titling, or search harness plumbing operation:

- **Rolling summary failure:** The summary is skipped for this turn. The full unsummarized context is sent to the chat model. If this causes a context window overflow, the error is shown to the user with a suggestion to start a new chat.
- **Auto-titling failure:** The conversation retains its default untitled state. No error is shown to the user.
- **Search harness plumbing failure:** If a lightweight model call fails during query generation, entity extraction, or coverage check, the harness returns a partial or error result to the chat model. The chat model responds using whatever results were gathered, noting the limitation.

### 11.6 WebSocket Disconnection

If the WebSocket connection drops during response streaming, the partial response received so far is preserved in the chat. A reconnection indicator is shown to the user (e.g., "Connection lost — reconnecting..."). The client automatically attempts to reconnect with exponential backoff (up to 3 attempts). If reconnection succeeds, the user can send a new message normally — the interrupted response is not resumed or retried. If all reconnection attempts fail, the user sees a persistent error with a manual reconnect option.

---

## 12. Acceptance Criteria

Wayne v1 is complete when:

1. **Chat works end-to-end:** User can start a new conversation, send messages, and receive streamed responses from OpenAI, Anthropic, or OpenRouter models.
2. **Sidebar management:** Conversations appear in the sidebar, can be resumed, renamed, and deleted.
3. **Auto-titling:** Conversations receive an auto-generated title after the first exchange.
4. **Model switching:** User can select a provider, a model, and a reasoning level from the UI. These can be changed mid-conversation.
5. **OpenRouter dynamic models:** Available OpenRouter models are fetched dynamically from the API.
6. **Rolling summary:** When a conversation exceeds 80% of the active model's context window, older messages are automatically summarized. The conversation continues seamlessly.
7. **Tool framework & search harness:** The chat LLM can trigger tools via native tool calling. The web search tool executes the full deterministic harness (query gen, search, filter, coverage check) and returns results to the LLM for synthesis with inline source citations.
8. **Real-time harness progress:** Search harness steps appear live in the UI as they complete.
9. **Visibility — payload exposure:** For any assistant message, the user can inspect the full API payload that was sent and the response metadata.
10. **Visibility — token tracking:** Three provider token counts (OpenAI via tiktoken, Anthropic via count_tokens API, OpenRouter via heuristic) are captured per message. Context window utilization is displayed for the selected model.
11. **Visibility — chain of thought:** Reasoning content is captured and displayed when available (Anthropic extended thinking, OpenAI reasoning summaries, DeepSeek R1 reasoning).
12. **Visibility — rolling summary events:** When a summary is triggered, the event details (what was summarized, the result, token impact) are captured and inspectable.
13. **Visibility — tool execution trace:** All tool calls, harness steps, LLM calls, and cleaned Tavily results are captured and inspectable.
14. **System prompt:** A global system prompt is included in every conversation.
15. **Data persists:** All conversations, messages, and visibility data survive application restarts (PostgreSQL).

---

## 13. Testing Requirements

### 13.1 Quality Bar

All features defined in the acceptance criteria (Section 12) must have corresponding tests. No feature is considered complete without tests that verify its behavior.

### 13.2 Backend

- All API endpoints must have integration tests.
- The rolling summary logic (threshold detection, summary generation, context reconstruction) must have unit tests.
- The tool framework must have tests for tool registration, schema delivery, and result routing.
- The search harness must have tests for each step, including the retry/abort flow and error handling paths.
- LLM provider integrations must be testable with mocked API responses (no real API calls in CI).
- Target: **80% code coverage** on backend business logic (excluding boilerplate and configuration).

### 13.3 Frontend

- Critical user flows must have tests: starting a chat, sending a message, switching models, renaming/deleting a conversation.
- WebSocket streaming behavior must be tested (message arrives, renders progressively).
- No coverage target for v1 — focus on flow coverage over line coverage.

### 13.4 Implementation Details Deferred

Framework choices (pytest, vitest, etc.), directory structure, test commands, mocking strategies, and CI configuration are implementation plan concerns, not spec concerns.

---

## 14. Tech Stack

### 14.1 Version Constraints

| Technology | Minimum Version | Rationale |
|---|---|---|
| Python | 3.11+ | Modern typing, asyncio task groups, `tomllib` |
| Node.js | 20+ | Current LTS, required by Vite and modern tooling |
| React | 18+ | Hooks, concurrent rendering, Suspense |
| PostgreSQL | 15+ | JSONB improvements, important for visibility data storage |

### 14.2 Backend

| Layer | Technology | Notes |
|---|---|---|
| Framework | **FastAPI** | Async-native, built-in WebSocket support, auto-generated OpenAPI docs |
| Package management | **Poetry** | Dependency resolution, virtual environments, lockfile |
| Data validation | **Pydantic v2** | Ships with FastAPI. Validates all API payloads, harness step outputs, LLM responses |
| ORM | **SQLAlchemy 2.0+** (async) | Async session support via `asyncpg`. Declarative models, relationship management, query building |
| Database driver | **asyncpg** | Async PostgreSQL driver, used by SQLAlchemy's async engine |
| Database migrations | **Alembic** | Schema versioning and migration management, integrates with SQLAlchemy models |
| HTTP client | **httpx** | Async HTTP client for OpenRouter REST API and Tavily API calls |
| Environment variables | **python-dotenv** | Loads `.env` file at startup, integrates with Pydantic Settings |
| WebSocket | **FastAPI built-in** | Native WebSocket support, no additional library needed |

### 14.3 Frontend

| Layer | Technology | Notes |
|---|---|---|
| Framework | **React + TypeScript** | Component-based UI, strong typing |
| Build tool | **Vite** | Fast dev server, HMR, optimized builds |
| UI components | **shadcn/ui** | Copy-paste component library built on Radix UI primitives. AI-friendly (components live in your codebase, not node_modules) |
| Styling | **Tailwind CSS** | Utility-first CSS, pairs with shadcn/ui. AI generates Tailwind classes effectively |
| State management | **Zustand** | Lightweight, minimal boilerplate, scales well. Preferred over Redux (too heavy) or Context alone (re-render issues at scale) |
| WebSocket client | **Native WebSocket API** | No library needed for basic streaming. Reconnection logic handled in a custom hook |
| HTTP client | **fetch API** (native) | No axios needed for simple REST calls. Can add a thin wrapper for error handling |
| Markdown rendering | **react-markdown** | For rendering assistant responses with markdown formatting |
| Code syntax highlighting | **rehype-highlight** or **Shiki** | For code blocks in assistant responses |

### 14.4 LLM Integrations

| Provider | Technology | Notes |
|---|---|---|
| OpenAI | **OpenAI Python SDK** (`openai`) | Direct SDK, streaming via SSE |
| Anthropic | **Anthropic Python SDK** (`anthropic`) | Direct SDK, streaming via SSE |
| OpenRouter | **httpx** (REST API) | OpenAI-compatible API format, no dedicated SDK needed |
| Token counting — OpenAI | **tiktoken** | Local, exact token counts |
| Token counting — Anthropic | **`messages.count_tokens()`** | SDK method, API call |
| Token counting — OpenRouter | **Characters / 3.5 heuristic** | Local approximation |

### 14.5 External Services

| Service | Technology | Notes |
|---|---|---|
| Search | **Tavily Search API** | Called via httpx, API key in `.env` |
| Database | **PostgreSQL** (local) | Run natively or via Docker |

### 14.6 Communication Pattern

| Channel | Protocol | Usage |
|---|---|---|
| CRUD operations | **REST** (HTTP) | Create/read/update/delete conversations, fetch visibility data, model list, config |
| LLM streaming | **WebSocket** | Token-by-token response streaming, search harness step progress |
