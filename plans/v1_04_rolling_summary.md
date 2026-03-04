# Unit S — Rolling Summary

**Spec sections:** §4.1–4.6
**Consult:** `spec/v1_spec.md`, `plans/v1_master_plan.md` (§3.4 for contracts), `docs/llm_models_reference.md`

## Overview

This unit implements token counting (three provider methods) and rolling summary generation. When a conversation's token count exceeds 80% of the active model's context window, the oldest messages are compressed into a summary using the lightweight model. The unit exposes `TokenCounter` and `RollingSummaryService` for use by Unit V (visibility) and Unit C (chat orchestrator).

## Dependencies

- **Unit F:** ORM models (`Message`, `RollingSummary`, `Conversation`), `get_db()`, `Settings`, `exceptions.py`
- **Unit P:** `LLMProvider` protocol, `ProviderRegistry` (to get the OpenAI provider for lightweight model calls), `ChatMessage` type, model catalog (for context window sizes). The `complete()` method on the OpenAI provider is used for summary generation.

Read the actual provider implementations from Unit P to understand how `complete()` works and what `ChatMessage` looks like.

## Files to Create

- `src/backend/services/token_counter.py` — Three counting methods + context window lookup
- `src/backend/services/rolling_summary.py` — Threshold check, message selection, summary generation, persistence

Test files:
- `tests/unit/test_token_counter.py` — Unit tests for each counting method
- `tests/unit/test_rolling_summary.py` — Unit tests for threshold logic, message selection, summary generation

## Architecture & Key Decisions

### Summary message role mapping

The DB schema has a `summary` role. When assembling context for the LLM, summary messages must be sent as role `system` (not `user` or `assistant`) with a prefix like `"[Previous conversation summary]: ..."`. This keeps the summary distinct from actual conversation turns and works across all providers. The `ChatMessage` dataclass uses `role="system"` for summaries in the messages list sent to the LLM.

### Message grouping for summarization

The spec says "accumulate message pairs (user + assistant)" but tool-calling conversations produce multi-message sequences: `user → assistant(tool_call) → tool_result → assistant`. These must be treated as **atomic exchange groups** — never split a tool call from its result or from the final assistant response. The summarizer works in terms of "exchanges" (a user message plus everything until the next user message), not individual message pairs.

### Context window size resolution

`TokenCounter.get_context_window()` delegates to the model catalog from Unit P. For OpenAI/Anthropic, these are hardcoded in the catalog. For OpenRouter, they come from the dynamic model list. Reference values from `docs/llm_models_reference.md`: all GPT-5 family models are 400K, Anthropic Claude models are 200K (standard).

### tiktoken encoding selection

Use `tiktoken.encoding_for_model()` which handles model-to-encoding mapping. Wrap in a try/except — if the GPT-5 model IDs aren't recognized by the installed tiktoken version, fall back to `cl200k_base` (the encoding used by recent OpenAI models). Log a warning on fallback.

## Implementation Steps

### Phase 1 — Token Counter

**Step 1: `src/backend/services/token_counter.py`**

Implement `TokenCounter` matching the contract in master plan §3.4.

- `count_openai()`: Use tiktoken. Count each message's content plus role overhead tokens (every message has ~4 overhead tokens for role/separators — check tiktoken docs for the exact chat format). Handle `None` content (tool_call messages may have no content).
- `count_anthropic()`: Use the Anthropic SDK's `messages.count_tokens()`. This requires constructing the messages in Anthropic's format (system extracted to top-level param). Inject the Anthropic client via constructor — get it from the provider registry or config. Handle network errors by raising `TokenCountError`.
- `count_openrouter()`: Sum `len(msg.content or "")` for all messages, divide by 3.5, round up. Simple but must handle `None` content gracefully.
- `count_for_provider()`: Dispatch method. Takes `provider` string, calls the matching method.
- `get_context_window()`: Lookup from model catalog. Takes `model_id` and `provider`. For OpenRouter models, the catalog should already have context window from the dynamic fetch. Known values: GPT-5 family = 400K, Claude models = 200K.
- `count_anthropic()` note: The Anthropic SDK's `messages.count_tokens()` requires messages in Anthropic format — system message extracted to a top-level `system` param, and the remaining messages as the `messages` list. Consult the Anthropic SDK docs for the exact method signature.
- Constructor takes `Settings` and the Anthropic client (or provider registry). Keep it injectable for testing.

**Smoke check:** Import `TokenCounter` in a Python shell, instantiate with mocked dependencies, verify `count_openai` and `count_openrouter` return reasonable numbers for a sample message list. (Anthropic count requires a real API call — skip in smoke check.)

### Phase 2 — Rolling Summary Service

**Step 2: `src/backend/services/rolling_summary.py`**

Implement `RollingSummaryService` matching the contract in master plan §3.4.

- **Constructor:** Takes `TokenCounter`, `ProviderRegistry` (to get the OpenAI provider for lightweight model calls), and `Settings` (for `lightweight_model`, `summary_threshold`, `summary_budget`).

- **`check_and_summarize()` flow:**
  1. Call `token_counter.count_for_provider()` to get current token count
  2. Call `token_counter.get_context_window()` to get window size
  3. If `token_count < threshold * window_size`, return `(messages, None)` — no-op
  4. If threshold exceeded, call `_select_messages_to_summarize()`
  5. Call `_generate_summary()` with selected messages
  6. Persist `RollingSummary` record to DB
  7. Build new messages list: system prompt + summary message + remaining messages
  8. Return `(new_messages, SummaryResult)`

- **`_select_messages_to_summarize()`:**
  - Group messages into exchanges (see Architecture section above). An exchange starts with a user message and includes everything until the next user message.
  - Skip the system prompt (index 0) — never summarize it.
  - Skip any existing summary messages — they stay in place and the new summary replaces them (the new summary encompasses the old summary's content plus additional messages).
  - Calculate `budget = summary_budget * context_window` (50% by default).
  - Accumulate exchanges from oldest to newest. Stop when adding the next exchange would push the running token count past the budget.
  - Return the list of messages to summarize and the list of remaining messages.
  - **Edge case:** If even a single exchange exceeds the budget, summarize just that one exchange. Never return an empty list.

- **`_generate_summary()`:**
  - Build a prompt for the lightweight model: include the messages to summarize, instruct it to produce a concise summary preserving key facts, decisions, user preferences, and any important context. Ask it to maintain chronological flow.
  - Call `provider_registry.get("openai").complete()` with the lightweight model ID from settings.
  - Parse the response text as the summary.
  - If the lightweight model call fails, raise or let the caller handle it (spec §11.5: skip summary, send full context).

- **Summary message construction:**
  - Create a `ChatMessage` with `role="system"` and content formatted as: `"[Conversation summary]\n{summary_text}"`.
  - When persisting to the `messages` table, use `role="summary"` and the appropriate sequence number (it replaces the summarized messages' position in the sequence).

- **Handling existing summaries:**
  - If the messages list already contains a summary message, the new summary should incorporate it. Include the previous summary text in the prompt to the lightweight model so it can build on it rather than losing context.
  - Delete the old summary message from the DB (or mark it superseded) and insert the new one.

**Smoke check:** Write a quick script that instantiates `RollingSummaryService` with mocked `TokenCounter` (returns a count above threshold) and mocked OpenAI provider. Verify it calls `complete()` and returns a `SummaryResult`.

### Phase 3 — Tests

**Step 3: `tests/unit/test_token_counter.py`**

- Test `count_openai()` with a known message list — verify count matches tiktoken's output for the same content.
- Test `count_openai()` handles messages with `None` content (tool_call messages).
- Test `count_openrouter()` math: known string length → expected token count.
- Test `count_anthropic()` with a mocked Anthropic client — verify it calls `count_tokens` with correctly formatted messages and returns the result.
- Test `count_anthropic()` raises `TokenCountError` on network failure.
- Test `count_for_provider()` dispatches correctly for each provider string.
- Test `get_context_window()` returns correct values for known models and raises for unknown models.

**Step 4: `tests/unit/test_rolling_summary.py`**

- **Threshold tests:**
  - Token count below 80% → `check_and_summarize()` returns original messages and `None`.
  - Token count at exactly 80% → triggers summary.
  - Token count above 80% → triggers summary.

- **Message selection tests:**
  - Simple conversation (alternating user/assistant) → correct oldest messages selected.
  - Conversation with tool call exchanges (user → tool_call → tool_result → assistant) → exchange kept atomic, never split mid-tool-call.
  - Conversation with existing summary message → old summary included in new summary prompt, old summary replaced.
  - Edge case: single very long exchange exceeds budget → that one exchange is still selected.

- **Summary generation tests:**
  - Mock the OpenAI provider's `complete()` method. Verify the prompt sent includes all messages to summarize.
  - Verify `SummaryResult` fields are populated correctly (summary_text, summarized_message_ids, tokens_before, tokens_after, model_used).
  - Verify the returned messages list has the correct structure: system prompt, summary message, remaining messages.

- **DB persistence tests (integration):**
  - After `check_and_summarize()`, verify a `RollingSummary` record exists in the DB with correct fields.
  - Verify the summary message is inserted into the `messages` table with role `summary`.

- **Error handling:**
  - Lightweight model failure → exception propagated (caller decides behavior per spec §11.5).

## Error Handling

- **Anthropic `count_tokens` failure:** Raise `TokenCountError`. The caller (chat service in Unit C) will decide whether to proceed without a count or show an error.
- **Lightweight model failure during summary:** Let the exception propagate. Per spec §11.5, the chat service skips the summary and sends full context. If that causes context overflow, the provider will return an error which surfaces to the user.
- **tiktoken encoding not found for model:** Fall back to `cl200k_base`, log warning. This is a graceful degradation — the count will be approximate but close enough for threshold purposes.

## Completion Criteria

1. `TokenCounter.count_openai()` returns accurate token counts for a multi-message conversation using tiktoken.
2. `TokenCounter.count_anthropic()` calls the Anthropic SDK's count_tokens method and returns the result.
3. `TokenCounter.count_openrouter()` returns a character-based heuristic count.
4. `TokenCounter.get_context_window()` returns correct context window sizes for all supported models.
5. `RollingSummaryService.check_and_summarize()` returns messages unchanged when below threshold.
6. `RollingSummaryService.check_and_summarize()` generates a summary, persists it, and returns compressed messages when above threshold.
7. Tool call exchanges are never split during message selection for summarization.
8. Existing summary messages are incorporated into new summaries rather than lost.
9. All unit tests pass. Integration test confirms DB persistence of summary records.
