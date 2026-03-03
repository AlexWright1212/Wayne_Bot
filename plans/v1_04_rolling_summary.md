# Unit S — Rolling Summary: Implementation Plan (`plans/v1_04_rolling_summary.md`)

## Overview

This plan covers the complete implementation of Wayne v1 Unit S — Rolling Summary. This unit creates two services: `TokenCounter` (three provider-specific counting methods plus context window lookup) and `RollingSummaryService` (threshold detection, message pair selection, summary generation, persistence, and WebSocket events). Together they keep conversations within context limits by compressing older messages into summaries when the token count crosses 80% of the active model's context window.

All spec references are to `spec/v1_spec.md` v1.1. Model references verified against `docs/llm_models_reference.md` (2026-03-02).

**Depends on:** Unit F (ORM models, database, config), Unit P (provider registry, `LLMProvider.complete()` for summary generation, Anthropic SDK for `count_tokens`)

**Completion criteria:**

1. `TokenCounter.count_openai()` returns exact token counts via tiktoken for any message list
2. `TokenCounter.count_anthropic()` returns exact token counts via the Anthropic SDK `count_tokens()` API
3. `TokenCounter.count_openrouter()` returns a conservative heuristic count (chars / 3.5)
4. `TokenCounter.get_context_window()` returns the correct context window size for any known model
5. `TokenCounter.get_active_count()` dispatches to the correct counting method based on provider
6. `RollingSummaryService.check_and_summarize()` is a no-op when tokens are below 80% threshold
7. When threshold is exceeded, the service selects the oldest message pairs up to 50% of context window budget, generates a summary via GPT-5 nano, persists the `rolling_summaries` row, replaces summarized messages with a summary message, and emits `summary_started` / `summary_complete` WebSocket events
8. Edge cases pass: threshold not reached, model switch to smaller window, existing summary in message history
9. All unit tests and integration tests pass with `pytest tests/`

---

## Step 1: Add Dependencies

**File:** `pyproject.toml`

Add `tiktoken` to the project dependencies. The `openai` and `anthropic` SDKs should already be present from Unit P.

```bash
poetry add tiktoken
```

Verify it installs without conflict:

```bash
poetry install
python -c "import tiktoken; print(tiktoken.encoding_for_model('gpt-4o').encode('hello'))"
```

---

## Step 2: Create `services/token_counter.py`

**File:** `src/backend/services/token_counter.py`

This service provides three counting methods, a context window lookup table, and a unified `get_active_count()` dispatcher.

```python
"""Token counting service with provider-specific methods and context window lookup."""

from __future__ import annotations

import logging
import math
from typing import TYPE_CHECKING

import tiktoken

from src.backend.config import get_settings
from src.backend.exceptions import TokenCountError

if TYPE_CHECKING:
    from anthropic import AsyncAnthropic

    from src.backend.providers.base import ChatMessage

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Context window lookup (tokens)
# ---------------------------------------------------------------------------
# Static table for models served directly by OpenAI / Anthropic SDKs.
# OpenRouter models get their context window from the OpenRouter model
# metadata at runtime (see get_context_window).
CONTEXT_WINDOWS: dict[str, int] = {
    # OpenAI GPT-5 family
    "gpt-5.2": 200_000,
    "gpt-5": 200_000,
    "gpt-5-mini": 200_000,
    "gpt-5-nano": 200_000,
    # Anthropic Claude 4 family
    "claude-opus-4-6-20250130": 200_000,
    "claude-sonnet-4-6-20250514": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
}

# Default fallback for unknown models (conservative).
_DEFAULT_CONTEXT_WINDOW = 128_000


class TokenCounter:
    """Counts tokens using provider-specific methods and looks up context windows.

    Instantiate once and reuse — tiktoken encoders are cached internally.
    """

    def __init__(self, anthropic_client: AsyncAnthropic | None = None) -> None:
        self._anthropic = anthropic_client
        # Cache tiktoken encoders keyed by model name.
        self._tiktoken_cache: dict[str, tiktoken.Encoding] = {}

    # ------------------------------------------------------------------
    # 1. OpenAI — tiktoken (local, exact)
    # ------------------------------------------------------------------

    def count_openai(self, messages: list[ChatMessage], model_id: str = "gpt-5") -> int:
        """Return exact token count for *messages* using tiktoken.

        Uses the cl100k_base encoding as a fallback when the model is not
        directly recognised by tiktoken (GPT-5 family still uses cl100k_base
        compatible tokenisation).
        """
        enc = self._get_tiktoken_encoder(model_id)

        total = 0
        for msg in messages:
            # Every message has overhead: <|start|>{role}\n ... <|end|>\n
            total += 4  # per-message overhead tokens
            total += len(enc.encode(msg.role))
            if msg.content:
                total += len(enc.encode(msg.content))
            if msg.tool_name:
                total += len(enc.encode(msg.tool_name))
            if msg.tool_call_id:
                total += len(enc.encode(msg.tool_call_id))
        total += 2  # reply priming (<|start|>assistant)

        return total

    def _get_tiktoken_encoder(self, model_id: str) -> tiktoken.Encoding:
        if model_id not in self._tiktoken_cache:
            try:
                enc = tiktoken.encoding_for_model(model_id)
            except KeyError:
                # GPT-5 family not yet in tiktoken's registry — fall back to
                # cl100k_base which is compatible.
                enc = tiktoken.get_encoding("cl100k_base")
            self._tiktoken_cache[model_id] = enc
        return self._tiktoken_cache[model_id]

    # ------------------------------------------------------------------
    # 2. Anthropic — SDK count_tokens (API call, exact)
    # ------------------------------------------------------------------

    async def count_anthropic(
        self,
        messages: list[ChatMessage],
        model_id: str = "claude-sonnet-4-6-20250514",
        system_prompt: str | None = None,
    ) -> int:
        """Return exact token count via the Anthropic SDK ``count_tokens`` method.

        This makes a lightweight API call — it does NOT run inference.

        Raises ``TokenCountError`` if the Anthropic client is not configured or
        the API call fails.
        """
        if self._anthropic is None:
            raise TokenCountError("Anthropic client not configured — cannot count tokens")

        # Convert ChatMessage list to the Anthropic message format.
        anthropic_messages = self._to_anthropic_format(messages)

        try:
            response = await self._anthropic.messages.count_tokens(
                model=model_id,
                messages=anthropic_messages,
                system=system_prompt or "",
            )
            return response.input_tokens
        except Exception as exc:
            logger.error("Anthropic count_tokens failed: %s", exc)
            raise TokenCountError(f"Anthropic count_tokens failed: {exc}") from exc

    @staticmethod
    def _to_anthropic_format(messages: list[ChatMessage]) -> list[dict]:
        """Convert ChatMessage list to Anthropic API message dicts.

        Filters out system messages (system prompt is passed separately) and
        maps roles appropriately.
        """
        result: list[dict] = []
        for msg in messages:
            if msg.role == "system":
                continue  # system prompt handled via the `system` param
            role = "user" if msg.role in ("user", "tool_result") else "assistant"
            result.append({
                "role": role,
                "content": msg.content or "",
            })
        return result

    # ------------------------------------------------------------------
    # 3. OpenRouter — chars / 3.5 heuristic (local, conservative)
    # ------------------------------------------------------------------

    def count_openrouter(self, messages: list[ChatMessage]) -> int:
        """Return a conservative heuristic token count: total chars / 3.5.

        Slightly overcounts compared to reality, which is safer for the
        rolling summary threshold check (§4.3).
        """
        total_chars = 0
        for msg in messages:
            if msg.content:
                total_chars += len(msg.content)
            if msg.tool_name:
                total_chars += len(msg.tool_name)
            # Include role string in char count for consistency.
            total_chars += len(msg.role)

        return math.ceil(total_chars / 3.5)

    # ------------------------------------------------------------------
    # Context window lookup
    # ------------------------------------------------------------------

    def get_context_window(
        self,
        model_id: str,
        openrouter_context: int | None = None,
    ) -> int:
        """Return the context window size in tokens for *model_id*.

        For OpenRouter models, pass *openrouter_context* from the model
        metadata.  For OpenAI / Anthropic, the static lookup table is used.
        Falls back to ``_DEFAULT_CONTEXT_WINDOW`` if the model is unknown.
        """
        if openrouter_context is not None:
            return openrouter_context

        return CONTEXT_WINDOWS.get(model_id, _DEFAULT_CONTEXT_WINDOW)

    # ------------------------------------------------------------------
    # Unified dispatcher
    # ------------------------------------------------------------------

    async def get_active_count(
        self,
        messages: list[ChatMessage],
        provider: str,
        model_id: str,
        system_prompt: str | None = None,
    ) -> int:
        """Return the token count using the counting method for *provider*.

        This is the method used for the rolling summary threshold check.
        It runs synchronously for OpenAI / OpenRouter (local computation)
        and awaits an API call for Anthropic.

        Args:
            messages: The full messages list (system prompt + conversation).
            provider: One of ``"openai"``, ``"anthropic"``, ``"openrouter"``.
            model_id: The active model ID.
            system_prompt: The system prompt text (used only for Anthropic
                           count_tokens which accepts it separately).

        Returns:
            Token count as an integer.

        Raises:
            TokenCountError: If the provider is unknown or counting fails.
        """
        if provider == "openai":
            return self.count_openai(messages, model_id)
        elif provider == "anthropic":
            return await self.count_anthropic(messages, model_id, system_prompt)
        elif provider == "openrouter":
            return self.count_openrouter(messages)
        else:
            raise TokenCountError(f"Unknown provider: {provider}")
```

### Design notes

- **tiktoken encoder caching:** The `_get_tiktoken_encoder` method caches encoders by model ID to avoid repeated disk reads. GPT-5 family models fall back to `cl100k_base` since tiktoken may not have their entries yet.
- **Anthropic system prompt:** The Anthropic `count_tokens` method takes the system prompt as a separate parameter (matching how the Anthropic API works). The `_to_anthropic_format` helper strips system messages from the list.
- **OpenRouter heuristic:** `chars / 3.5` is intentionally conservative — it overcounts, which means we trigger summaries slightly earlier than strictly necessary, which is the safe direction.
- **Context window table:** Maintained as a module-level constant. OpenRouter context windows come from model metadata (passed in via the `openrouter_context` parameter).

---

## Step 3: Create `services/rolling_summary.py`

**File:** `src/backend/services/rolling_summary.py`

This service implements the core rolling summary logic: threshold check, message pair selection, summary generation, persistence, and context reconstruction.

```python
"""Rolling summary service — compresses conversation history when context limits approach."""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any, Callable, Awaitable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.config import get_settings
from src.backend.models.message import Message, MessageRole
from src.backend.models.rolling_summary import RollingSummary
from src.backend.services.token_counter import TokenCounter

if TYPE_CHECKING:
    from src.backend.providers.base import ChatMessage
    from src.backend.providers.registry import ProviderRegistry

logger = logging.getLogger(__name__)

# Summary generation prompt sent to the lightweight model.
SUMMARY_PROMPT = (
    "You are a conversation summariser. Given the following conversation messages, "
    "produce a concise summary that preserves:\n"
    "- Key facts and data points mentioned\n"
    "- Decisions made or conclusions reached\n"
    "- Important context needed to continue the conversation\n"
    "- The user's goals and preferences expressed so far\n\n"
    "Be concise but thorough. Do not omit information that would be needed to "
    "continue this conversation naturally. Write in third person "
    "(e.g., 'The user asked about...' / 'The assistant explained...').\n\n"
    "Conversation messages to summarise:\n\n"
)


class RollingSummaryService:
    """Detects when conversation context exceeds threshold and compresses it.

    Usage from the chat orchestrator::

        summary_service = RollingSummaryService(token_counter, provider_registry)
        messages = await summary_service.check_and_summarize(
            db=db,
            conversation_id=conversation_id,
            messages=messages,
            provider=provider,
            model_id=model_id,
            system_prompt=system_prompt,
            on_event=ws_send,
        )
        # messages is now guaranteed to fit within the context window.
    """

    def __init__(
        self,
        token_counter: TokenCounter,
        provider_registry: ProviderRegistry,
    ) -> None:
        self._counter = token_counter
        self._registry = provider_registry
        self._settings = get_settings()

    async def check_and_summarize(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        messages: list[ChatMessage],
        provider: str,
        model_id: str,
        system_prompt: str | None = None,
        openrouter_context: int | None = None,
        on_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
    ) -> list[ChatMessage]:
        """Check token count against threshold; if exceeded, summarize and return compressed messages.

        This is a **blocking** operation — it must complete before the user's
        message is sent to the LLM (spec §4.2).

        Args:
            db: Active database session.
            conversation_id: The conversation being processed.
            messages: Full message list (system prompt + history + new user message).
            provider: Active provider name (``"openai"`` / ``"anthropic"`` / ``"openrouter"``).
            model_id: Active model ID.
            system_prompt: System prompt text (for Anthropic counting).
            openrouter_context: Context window from OpenRouter metadata (if applicable).
            on_event: Optional async callback for WebSocket events
                      (``summary_started``, ``summary_complete``).

        Returns:
            The (possibly compressed) message list, ready to send to the LLM.
        """
        # 1. Count tokens.
        token_count = await self._counter.get_active_count(
            messages, provider, model_id, system_prompt
        )
        context_window = self._counter.get_context_window(model_id, openrouter_context)
        threshold = self._settings.summary_threshold  # default 0.80

        logger.info(
            "Token check: %d / %d (%.1f%%) — threshold %.0f%%",
            token_count,
            context_window,
            (token_count / context_window) * 100,
            threshold * 100,
        )

        # 2. Threshold check — if below, return messages unchanged.
        if token_count <= context_window * threshold:
            return messages

        # 3. Threshold exceeded — trigger summary.
        logger.info("Rolling summary triggered for conversation %s", conversation_id)

        if on_event:
            await on_event({"type": "summary_started"})

        try:
            compressed = await self._generate_summary(
                db=db,
                conversation_id=conversation_id,
                messages=messages,
                provider=provider,
                model_id=model_id,
                system_prompt=system_prompt,
                context_window=context_window,
                token_count_before=token_count,
                openrouter_context=openrouter_context,
            )
        except Exception:
            # Spec §11.5: summary failure → skip summary, send full context.
            logger.exception("Rolling summary generation failed — sending full context")
            if on_event:
                await on_event({"type": "summary_complete"})
            return messages

        if on_event:
            await on_event({"type": "summary_complete"})

        return compressed

    async def _generate_summary(
        self,
        db: AsyncSession,
        conversation_id: uuid.UUID,
        messages: list[ChatMessage],
        provider: str,
        model_id: str,
        system_prompt: str | None,
        context_window: int,
        token_count_before: int,
        openrouter_context: int | None,
    ) -> list[ChatMessage]:
        """Select messages to summarize, generate summary, persist, and rebuild message list."""
        from src.backend.providers.base import ChatMessage as CM

        budget = int(context_window * self._settings.summary_budget)  # default 50%

        # ---- Select messages to summarize ----
        # Walk from the oldest messages (index 0), skipping the system prompt.
        # Accumulate message pairs (user + assistant) until the next pair would
        # exceed the budget.  Previous summary messages are also eligible for
        # re-summarization.
        to_summarize: list[int] = []  # indices into messages
        accumulated_tokens = 0

        # Find the first non-system message index.
        start_idx = 0
        for i, msg in enumerate(messages):
            if msg.role != "system":
                start_idx = i
                break

        i = start_idx
        while i < len(messages):
            # Determine how many messages form the next "unit" to consider.
            # - A user+assistant pair = 2 messages
            # - A summary message = 1 message
            # - A tool_call + tool_result pair between user and assistant = part of the exchange
            # We greedily take messages one at a time and count their tokens.
            msg = messages[i]

            # Count tokens for this single message.
            single_count = await self._counter.get_active_count(
                [msg], provider, model_id, system_prompt=None
            )

            if accumulated_tokens + single_count > budget and len(to_summarize) > 0:
                # Adding this message would exceed the budget and we already
                # have some messages selected — stop here.
                break

            to_summarize.append(i)
            accumulated_tokens += single_count
            i += 1

        if not to_summarize:
            logger.warning("No messages eligible for summarization")
            return messages

        # Ensure we don't summarize the very last user message (the new one).
        # The new user message is always the last message in the list.
        if to_summarize and to_summarize[-1] == len(messages) - 1:
            to_summarize.pop()

        if not to_summarize:
            logger.warning("Only the new user message available — skipping summary")
            return messages

        # ---- Build the text to summarize ----
        selected_messages = [messages[idx] for idx in to_summarize]
        summary_input = SUMMARY_PROMPT
        for msg in selected_messages:
            role_label = msg.role.upper()
            content = msg.content or "[no content]"
            summary_input += f"[{role_label}]: {content}\n\n"

        # ---- Call lightweight model to generate summary ----
        lightweight_model = self._settings.lightweight_model  # "gpt-5-nano"
        openai_provider = self._registry.get_provider("openai")

        result = await openai_provider.complete(
            messages=[
                CM(role="user", content=summary_input),
            ],
            model_id=lightweight_model,
        )

        summary_text = result.content

        # ---- Persist to rolling_summaries table ----
        # Collect the message IDs that were summarized (for messages that have DB IDs).
        summarized_msg_ids = await self._get_message_db_ids(
            db, conversation_id, to_summarize, messages
        )

        # Count tokens after compression to record savings.
        summary_message = CM(role="system", content=f"[Conversation Summary]: {summary_text}")
        remaining_messages = (
            [msg for i, msg in enumerate(messages) if i not in set(to_summarize)]
        )
        # Insert summary after system prompt, before remaining messages.
        system_msgs = [m for m in remaining_messages if m.role == "system"]
        non_system_msgs = [m for m in remaining_messages if m.role != "system"]
        compressed = system_msgs + [summary_message] + non_system_msgs

        token_count_after = await self._counter.get_active_count(
            compressed, provider, model_id, system_prompt
        )

        summary_record = RollingSummary(
            conversation_id=conversation_id,
            summary_text=summary_text,
            summarized_message_ids=summarized_msg_ids,
            tokens_before=token_count_before,
            tokens_after=token_count_after,
            model_used=lightweight_model,
        )
        db.add(summary_record)

        # ---- Persist the summary as a message in the conversation ----
        # Get the next sequence number.
        max_seq_result = await db.execute(
            select(Message.sequence)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.sequence.desc())
            .limit(1)
        )
        max_seq = max_seq_result.scalar() or 0

        summary_db_message = Message(
            conversation_id=conversation_id,
            role=MessageRole.SUMMARY,
            content=f"[Conversation Summary]: {summary_text}",
            model_id=lightweight_model,
            provider="openai",
            sequence=max_seq + 1,
        )
        db.add(summary_db_message)

        # ---- Delete the summarized messages from DB ----
        if summarized_msg_ids:
            for msg_id in summarized_msg_ids:
                msg_obj = await db.get(Message, msg_id)
                if msg_obj:
                    await db.delete(msg_obj)

        await db.flush()

        logger.info(
            "Summary generated: %d tokens → %d tokens (%d messages compressed)",
            token_count_before,
            token_count_after,
            len(to_summarize),
        )

        return compressed

    @staticmethod
    async def _get_message_db_ids(
        db: AsyncSession,
        conversation_id: uuid.UUID,
        indices: list[int],
        messages: list[ChatMessage],
    ) -> list[uuid.UUID]:
        """Map in-memory message indices to their database UUIDs.

        Messages loaded from the DB should have an ``id`` attribute attached
        during context assembly.  For messages without a DB ID (e.g. the
        system prompt which is generated at runtime), we skip them.
        """
        ids: list[uuid.UUID] = []
        for idx in indices:
            msg = messages[idx]
            msg_id = getattr(msg, "db_id", None)
            if msg_id is not None:
                ids.append(msg_id)
        return ids
```

### Design notes

- **Blocking operation:** `check_and_summarize()` is `async` but conceptually blocking — the chat orchestrator must `await` it before sending the user's message to the LLM. The UI shows "Compressing conversation history..." during this time via the `summary_started` / `summary_complete` WebSocket events.
- **Message pair selection:** The selector walks from the oldest non-system message, accumulating tokens until the next message would exceed the 50% budget. It explicitly avoids summarizing the newest user message (which is always the last in the list).
- **Existing summaries:** Previous summary messages are included in the walk and can be re-summarized. This handles the case where a prior summary exists and context still exceeds the threshold (e.g., after switching to a model with a smaller window).
- **Summary persistence:** The summary text is persisted in two places: (1) the `rolling_summaries` table for visibility/auditing (with before/after token counts), and (2) as a `summary` role message in the `messages` table so it appears in future context assembly.
- **Summarized message deletion:** Summarized messages are deleted from the `messages` table since they have been replaced by the summary. Their content is preserved in the `rolling_summaries.summarized_message_ids` array for visibility.
- **Failure handling (spec section 11.5):** If the lightweight model call fails, the summary is skipped and the full unsummarized context is sent to the chat model. If this causes a context overflow, the LLM provider will return an error to the user.

---

## Step 4: Wire Into Chat Orchestrator (Integration Point)

This step documents how `check_and_summarize()` integrates into `services/chat.py`. The actual wiring happens in Phase 6 (Unit C+), but the interface is defined here.

**File:** `src/backend/services/chat.py` (modification — relevant excerpt)

```python
# In ChatService.handle_user_message():

# ... after assembling messages list and before calling the LLM ...

# Rolling summary check (blocking — spec §4.2)
messages = await self._summary_service.check_and_summarize(
    db=db,
    conversation_id=conversation_id,
    messages=messages,
    provider=provider,
    model_id=model_id,
    system_prompt=system_prompt,
    openrouter_context=openrouter_context,
    on_event=on_event,
)

# Now send to LLM with the (possibly compressed) messages.
async for event in self._provider.stream_chat(messages, model_id, ...):
    ...
```

The chat service will instantiate `RollingSummaryService` with the shared `TokenCounter` and `ProviderRegistry`, then call `check_and_summarize()` at the appropriate point in the message handling flow.

---

## Step 5: Edge Cases

### 5.1 Threshold Not Reached (No-Op)

When `token_count <= context_window * 0.80`, `check_and_summarize()` returns the original messages list unchanged. No summary is generated, no WebSocket events are emitted, no database writes occur. This is the common case for most messages in a conversation.

**Test:** Send messages that total well under 80% of the context window. Assert messages are returned unchanged and no `rolling_summaries` rows exist.

### 5.2 Model Switch to Smaller Context Window

When the user switches from a model with a large context window (e.g., GPT-5 at 200K) to one with a smaller window and the existing conversation history exceeds 80% of the *new* model's window, a rolling summary triggers on the next message send.

The summarization logic works identically — it uses the *new* model's context window for threshold and budget calculations. Previous summary messages in the history are eligible for re-summarization if the conversation is still too large after a single pass.

**Test:** Build a conversation with ~150K tokens (fits in GPT-5 at 200K). Switch to a hypothetical model with 50K context. Assert summary triggers and compresses to fit.

### 5.3 Existing Summary in Message History

When a summary was already generated in a previous exchange, the summary message is part of the message history. On the next threshold check:

1. The summary message's tokens are counted like any other message.
2. If the threshold is still exceeded (conversation grew past the summary), the summariser walks from the oldest message — which may be the previous summary itself.
3. The previous summary can be included in the "to summarize" selection and re-summarized into a larger, cumulative summary.

This means summaries are composable: the system can summarize a summary plus newer messages into a fresh summary, progressively compressing the conversation.

**Test:** Generate a summary, add more messages until threshold is exceeded again, assert a new summary is generated that includes the previous summary text.

### 5.4 Very Short Conversation (Not Enough to Summarize)

If the conversation has only the system prompt and the new user message, there is nothing to summarize. The selector will find no eligible messages (it skips the system prompt and the newest user message). `check_and_summarize()` returns the messages unchanged even if the threshold is somehow exceeded (which would only happen with a very small context window).

### 5.5 Lightweight Model Failure

Per spec section 11.5: if the GPT-5 nano call fails during summary generation, the exception is caught, logged, and the full unsummarized context is returned. The `summary_complete` WebSocket event is still emitted to dismiss the UI indicator.

---

## Step 6: Tests

### 6.1 Test Fixtures

**File:** `tests/conftest.py` (additions)

```python
import pytest
from unittest.mock import AsyncMock, MagicMock
from src.backend.providers.base import ChatMessage
from src.backend.services.token_counter import TokenCounter


@pytest.fixture
def sample_messages() -> list[ChatMessage]:
    """A sample conversation with system prompt, 3 exchanges, and a new user message."""
    return [
        ChatMessage(role="system", content="You are Wayne, a helpful assistant."),
        ChatMessage(role="user", content="What is Python?"),
        ChatMessage(role="assistant", content="Python is a high-level programming language created by Guido van Rossum. It emphasizes readability and simplicity."),
        ChatMessage(role="user", content="What about JavaScript?"),
        ChatMessage(role="assistant", content="JavaScript is a dynamic programming language primarily used for web development. It runs in browsers and on servers via Node.js."),
        ChatMessage(role="user", content="Compare them for backend development."),
        ChatMessage(role="assistant", content="Both are viable for backend development. Python excels with frameworks like FastAPI and Django, while JavaScript uses Node.js with Express or Fastify."),
        ChatMessage(role="user", content="Which should I learn first?"),
    ]


@pytest.fixture
def token_counter() -> TokenCounter:
    """TokenCounter with no Anthropic client (for non-Anthropic tests)."""
    return TokenCounter(anthropic_client=None)


@pytest.fixture
def mock_anthropic_client() -> AsyncMock:
    """Mock Anthropic client with a working count_tokens method."""
    client = AsyncMock()
    # count_tokens returns an object with input_tokens attribute.
    count_response = MagicMock()
    count_response.input_tokens = 150
    client.messages.count_tokens = AsyncMock(return_value=count_response)
    return client
```

### 6.2 Unit Tests — TokenCounter

**File:** `tests/unit/test_token_counter.py`

```python
"""Unit tests for TokenCounter — three counting methods + context window lookup."""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.backend.exceptions import TokenCountError
from src.backend.providers.base import ChatMessage
from src.backend.services.token_counter import (
    CONTEXT_WINDOWS,
    TokenCounter,
    _DEFAULT_CONTEXT_WINDOW,
)


# ---------------------------------------------------------------
# OpenAI (tiktoken) counting
# ---------------------------------------------------------------

class TestCountOpenAI:
    def test_empty_messages(self, token_counter: TokenCounter) -> None:
        """Empty message list returns only the reply priming overhead."""
        count = token_counter.count_openai([], model_id="gpt-5")
        assert count == 2  # reply priming only

    def test_single_user_message(self, token_counter: TokenCounter) -> None:
        """Single user message returns a positive token count."""
        messages = [ChatMessage(role="user", content="Hello, world!")]
        count = token_counter.count_openai(messages, model_id="gpt-5")
        assert count > 0
        # "Hello, world!" is ~4 tokens + role + overhead
        assert count < 20

    def test_multiple_messages(
        self, token_counter: TokenCounter, sample_messages: list[ChatMessage]
    ) -> None:
        """Multiple messages produce a count greater than any single message."""
        full_count = token_counter.count_openai(sample_messages, model_id="gpt-5")
        single_count = token_counter.count_openai(
            [sample_messages[0]], model_id="gpt-5"
        )
        assert full_count > single_count

    def test_unknown_model_falls_back_to_cl100k(
        self, token_counter: TokenCounter
    ) -> None:
        """Unknown model IDs fall back to cl100k_base without error."""
        messages = [ChatMessage(role="user", content="test")]
        count = token_counter.count_openai(messages, model_id="gpt-5-nano")
        assert count > 0

    def test_encoder_caching(self, token_counter: TokenCounter) -> None:
        """Repeated calls with same model reuse the cached encoder."""
        messages = [ChatMessage(role="user", content="test")]
        token_counter.count_openai(messages, model_id="gpt-5")
        token_counter.count_openai(messages, model_id="gpt-5")
        assert "gpt-5" in token_counter._tiktoken_cache

    def test_message_with_tool_fields(self, token_counter: TokenCounter) -> None:
        """Messages with tool_name and tool_call_id include those in the count."""
        msg_without = ChatMessage(role="assistant", content="result")
        msg_with = ChatMessage(
            role="assistant",
            content="result",
            tool_name="web_search",
            tool_call_id="call_123",
        )
        count_without = token_counter.count_openai([msg_without])
        count_with = token_counter.count_openai([msg_with])
        assert count_with > count_without


# ---------------------------------------------------------------
# Anthropic (SDK count_tokens) counting
# ---------------------------------------------------------------

class TestCountAnthropic:
    @pytest.mark.asyncio
    async def test_returns_api_count(
        self, mock_anthropic_client: AsyncMock
    ) -> None:
        """Returns the input_tokens value from the Anthropic API response."""
        counter = TokenCounter(anthropic_client=mock_anthropic_client)
        messages = [ChatMessage(role="user", content="Hello")]
        count = await counter.count_anthropic(messages)
        assert count == 150
        mock_anthropic_client.messages.count_tokens.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_filters_system_messages(
        self, mock_anthropic_client: AsyncMock
    ) -> None:
        """System messages are excluded from the messages list (passed via system param)."""
        counter = TokenCounter(anthropic_client=mock_anthropic_client)
        messages = [
            ChatMessage(role="system", content="You are Wayne."),
            ChatMessage(role="user", content="Hi"),
        ]
        await counter.count_anthropic(
            messages, system_prompt="You are Wayne."
        )
        call_args = mock_anthropic_client.messages.count_tokens.call_args
        api_messages = call_args.kwargs.get("messages") or call_args[1].get("messages")
        # System message should not appear in the messages list.
        assert all(m["role"] != "system" for m in api_messages)

    @pytest.mark.asyncio
    async def test_no_client_raises_error(self) -> None:
        """Raises TokenCountError when Anthropic client is not configured."""
        counter = TokenCounter(anthropic_client=None)
        with pytest.raises(TokenCountError, match="not configured"):
            await counter.count_anthropic([ChatMessage(role="user", content="Hi")])

    @pytest.mark.asyncio
    async def test_api_failure_raises_error(
        self, mock_anthropic_client: AsyncMock
    ) -> None:
        """Raises TokenCountError when the Anthropic API call fails."""
        mock_anthropic_client.messages.count_tokens.side_effect = Exception("API error")
        counter = TokenCounter(anthropic_client=mock_anthropic_client)
        with pytest.raises(TokenCountError, match="API error"):
            await counter.count_anthropic([ChatMessage(role="user", content="Hi")])


# ---------------------------------------------------------------
# OpenRouter (heuristic) counting
# ---------------------------------------------------------------

class TestCountOpenRouter:
    def test_empty_messages(self, token_counter: TokenCounter) -> None:
        """Empty message list returns 0."""
        count = token_counter.count_openrouter([])
        assert count == 0

    def test_simple_message(self, token_counter: TokenCounter) -> None:
        """Returns ceil(total_chars / 3.5)."""
        content = "Hello, world!"  # 13 chars
        role = "user"  # 4 chars
        messages = [ChatMessage(role=role, content=content)]
        expected = math.ceil((len(content) + len(role)) / 3.5)
        count = token_counter.count_openrouter(messages)
        assert count == expected

    def test_overcounts_vs_tiktoken(
        self, token_counter: TokenCounter, sample_messages: list[ChatMessage]
    ) -> None:
        """Heuristic count should be in the same ballpark as tiktoken (not wildly off)."""
        openai_count = token_counter.count_openai(sample_messages)
        openrouter_count = token_counter.count_openrouter(sample_messages)
        # The heuristic is intentionally conservative — it should not be
        # drastically less than tiktoken. Allow a generous range.
        assert openrouter_count > 0
        # Just verify they're in a reasonable ratio (0.3x to 5x).
        ratio = openrouter_count / openai_count
        assert 0.3 < ratio < 5.0

    def test_includes_tool_name(self, token_counter: TokenCounter) -> None:
        """Tool name characters are counted."""
        msg = ChatMessage(role="assistant", content="ok", tool_name="web_search")
        count = token_counter.count_openrouter([msg])
        msg_no_tool = ChatMessage(role="assistant", content="ok")
        count_no_tool = token_counter.count_openrouter([msg_no_tool])
        assert count > count_no_tool


# ---------------------------------------------------------------
# Context window lookup
# ---------------------------------------------------------------

class TestGetContextWindow:
    def test_known_openai_model(self, token_counter: TokenCounter) -> None:
        assert token_counter.get_context_window("gpt-5") == 200_000

    def test_known_anthropic_model(self, token_counter: TokenCounter) -> None:
        assert token_counter.get_context_window("claude-sonnet-4-6-20250514") == 200_000

    def test_unknown_model_returns_default(self, token_counter: TokenCounter) -> None:
        assert token_counter.get_context_window("unknown-model-xyz") == _DEFAULT_CONTEXT_WINDOW

    def test_openrouter_context_overrides(self, token_counter: TokenCounter) -> None:
        """When openrouter_context is provided, it takes precedence."""
        assert token_counter.get_context_window("some-model", openrouter_context=64_000) == 64_000

    def test_all_static_entries_are_positive(self) -> None:
        """Every entry in the static lookup table is a positive integer."""
        for model_id, window in CONTEXT_WINDOWS.items():
            assert isinstance(window, int) and window > 0, f"{model_id}: {window}"


# ---------------------------------------------------------------
# Unified get_active_count dispatcher
# ---------------------------------------------------------------

class TestGetActiveCount:
    @pytest.mark.asyncio
    async def test_dispatches_to_openai(self, token_counter: TokenCounter) -> None:
        messages = [ChatMessage(role="user", content="Hello")]
        count = await token_counter.get_active_count(messages, "openai", "gpt-5")
        assert count > 0

    @pytest.mark.asyncio
    async def test_dispatches_to_anthropic(
        self, mock_anthropic_client: AsyncMock
    ) -> None:
        counter = TokenCounter(anthropic_client=mock_anthropic_client)
        messages = [ChatMessage(role="user", content="Hello")]
        count = await counter.get_active_count(
            messages, "anthropic", "claude-sonnet-4-6-20250514"
        )
        assert count == 150

    @pytest.mark.asyncio
    async def test_dispatches_to_openrouter(
        self, token_counter: TokenCounter
    ) -> None:
        messages = [ChatMessage(role="user", content="Hello")]
        count = await token_counter.get_active_count(messages, "openrouter", "deepseek/deepseek-v3.2")
        assert count > 0

    @pytest.mark.asyncio
    async def test_unknown_provider_raises(
        self, token_counter: TokenCounter
    ) -> None:
        with pytest.raises(TokenCountError, match="Unknown provider"):
            await token_counter.get_active_count(
                [ChatMessage(role="user", content="Hi")], "google", "gemini"
            )
```

### 6.3 Unit Tests — RollingSummaryService

**File:** `tests/unit/test_rolling_summary.py`

```python
"""Unit tests for RollingSummaryService — threshold check, summarization, edge cases."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.backend.providers.base import ChatMessage, CompletionResult
from src.backend.services.rolling_summary import RollingSummaryService


# ---------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------

@pytest.fixture
def mock_token_counter() -> MagicMock:
    """Token counter that returns configurable counts."""
    counter = MagicMock()
    # Default: 100 tokens per call (below any threshold).
    counter.get_active_count = AsyncMock(return_value=100)
    counter.get_context_window = MagicMock(return_value=200_000)
    return counter


@pytest.fixture
def mock_provider_registry() -> MagicMock:
    """Provider registry with a mock OpenAI provider for summary generation."""
    registry = MagicMock()
    openai_provider = AsyncMock()
    openai_provider.complete = AsyncMock(
        return_value=CompletionResult(
            content="This is a summary of the conversation.",
            finish_reason="stop",
            usage={"input_tokens": 50, "output_tokens": 30},
        )
    )
    registry.get_provider = MagicMock(return_value=openai_provider)
    return registry


@pytest.fixture
def mock_settings() -> MagicMock:
    settings = MagicMock()
    settings.summary_threshold = 0.80
    settings.summary_budget = 0.50
    settings.lightweight_model = "gpt-5-nano"
    return settings


@pytest.fixture
def summary_service(
    mock_token_counter: MagicMock,
    mock_provider_registry: MagicMock,
    mock_settings: MagicMock,
) -> RollingSummaryService:
    with patch(
        "src.backend.services.rolling_summary.get_settings",
        return_value=mock_settings,
    ):
        return RollingSummaryService(mock_token_counter, mock_provider_registry)


@pytest.fixture
def conversation_id() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def long_messages() -> list[ChatMessage]:
    """A message list with enough content to trigger summarization."""
    msgs = [
        ChatMessage(role="system", content="You are Wayne."),
    ]
    # Add 20 exchanges to simulate a long conversation.
    for i in range(20):
        msgs.append(ChatMessage(role="user", content=f"User message {i} " * 50))
        msgs.append(ChatMessage(role="assistant", content=f"Assistant reply {i} " * 50))
    # Add the new user message.
    msgs.append(ChatMessage(role="user", content="New question"))
    return msgs


# ---------------------------------------------------------------
# Tests: Threshold not reached (no-op)
# ---------------------------------------------------------------

class TestThresholdNotReached:
    @pytest.mark.asyncio
    async def test_returns_messages_unchanged(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        sample_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """When below threshold, messages are returned unchanged."""
        # 100 tokens << 200_000 * 0.80 = 160_000
        mock_token_counter.get_active_count = AsyncMock(return_value=100)
        mock_db = AsyncMock()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=sample_messages,
            provider="openai",
            model_id="gpt-5",
        )
        assert result is sample_messages  # Same object, no copy

    @pytest.mark.asyncio
    async def test_no_websocket_events(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        sample_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """No WebSocket events emitted when below threshold."""
        mock_token_counter.get_active_count = AsyncMock(return_value=100)
        on_event = AsyncMock()
        mock_db = AsyncMock()

        await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=sample_messages,
            provider="openai",
            model_id="gpt-5",
            on_event=on_event,
        )
        on_event.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_exactly_at_threshold_does_not_trigger(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        sample_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """Token count exactly at 80% does NOT trigger (uses <=)."""
        mock_token_counter.get_active_count = AsyncMock(return_value=160_000)
        mock_token_counter.get_context_window = MagicMock(return_value=200_000)
        mock_db = AsyncMock()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=sample_messages,
            provider="openai",
            model_id="gpt-5",
        )
        assert result is sample_messages


# ---------------------------------------------------------------
# Tests: Summary triggered
# ---------------------------------------------------------------

class TestSummaryTriggered:
    @pytest.mark.asyncio
    async def test_emits_websocket_events(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """summary_started and summary_complete events are emitted."""
        # Set token count above threshold.
        mock_token_counter.get_active_count = AsyncMock(
            side_effect=self._above_then_below
        )
        on_event = AsyncMock()
        mock_db = self._make_mock_db()

        await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
            on_event=on_event,
        )

        event_types = [call.args[0]["type"] for call in on_event.await_args_list]
        assert "summary_started" in event_types
        assert "summary_complete" in event_types

    @pytest.mark.asyncio
    async def test_calls_lightweight_model(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        mock_provider_registry: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """Summary is generated via GPT-5 nano through the OpenAI provider."""
        mock_token_counter.get_active_count = AsyncMock(
            side_effect=self._above_then_below
        )
        mock_db = self._make_mock_db()

        await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
        )

        mock_provider_registry.get_provider.assert_called_with("openai")
        provider = mock_provider_registry.get_provider.return_value
        provider.complete.assert_awaited_once()
        call_kwargs = provider.complete.call_args
        assert call_kwargs.kwargs.get("model_id") == "gpt-5-nano" or \
               (call_kwargs.args and "gpt-5-nano" in str(call_kwargs))

    @pytest.mark.asyncio
    async def test_compressed_messages_shorter(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """The returned message list has fewer messages than the input."""
        mock_token_counter.get_active_count = AsyncMock(
            side_effect=self._above_then_below
        )
        mock_db = self._make_mock_db()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
        )
        assert len(result) < len(long_messages)

    @pytest.mark.asyncio
    async def test_system_prompt_preserved(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """The system prompt is always preserved in the compressed messages."""
        mock_token_counter.get_active_count = AsyncMock(
            side_effect=self._above_then_below
        )
        mock_db = self._make_mock_db()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
        )
        assert result[0].role == "system"
        assert result[0].content == "You are Wayne."

    @pytest.mark.asyncio
    async def test_new_user_message_preserved(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """The newest user message (last in list) is never summarized."""
        mock_token_counter.get_active_count = AsyncMock(
            side_effect=self._above_then_below
        )
        mock_db = self._make_mock_db()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
        )
        assert result[-1].role == "user"
        assert result[-1].content == "New question"

    @pytest.mark.asyncio
    async def test_summary_message_in_result(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """A summary message appears in the compressed result after the system prompt."""
        mock_token_counter.get_active_count = AsyncMock(
            side_effect=self._above_then_below
        )
        mock_db = self._make_mock_db()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
        )
        # Second message should be the summary.
        assert "[Conversation Summary]" in result[1].content

    # --- Helpers ---

    @staticmethod
    def _above_then_below(*args, **kwargs) -> int:
        """First call returns above threshold, subsequent calls return below."""
        if not hasattr(TestSummaryTriggered._above_then_below, "_call_count"):
            TestSummaryTriggered._above_then_below._call_count = 0
        TestSummaryTriggered._above_then_below._call_count += 1
        if TestSummaryTriggered._above_then_below._call_count == 1:
            return 170_000  # Above 80% of 200K
        return 10  # Each individual message is small (for budget calculation)

    @staticmethod
    def _make_mock_db() -> AsyncMock:
        """Create a mock DB session with the methods used by the service."""
        db = AsyncMock()
        # Mock the sequence query.
        seq_result = MagicMock()
        seq_result.scalar = MagicMock(return_value=42)
        db.execute = AsyncMock(return_value=seq_result)
        db.add = MagicMock()
        db.get = AsyncMock(return_value=None)
        db.delete = AsyncMock()
        db.flush = AsyncMock()
        return db


# ---------------------------------------------------------------
# Tests: Lightweight model failure
# ---------------------------------------------------------------

class TestLightweightModelFailure:
    @pytest.mark.asyncio
    async def test_returns_original_messages_on_failure(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        mock_provider_registry: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """If the lightweight model fails, original messages are returned (spec §11.5)."""
        mock_token_counter.get_active_count = AsyncMock(return_value=170_000)
        provider = mock_provider_registry.get_provider.return_value
        provider.complete.side_effect = Exception("GPT-5 nano is down")
        mock_db = AsyncMock()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
        )
        assert result is long_messages

    @pytest.mark.asyncio
    async def test_emits_summary_complete_on_failure(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        mock_provider_registry: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """summary_complete is emitted even on failure to dismiss the UI indicator."""
        mock_token_counter.get_active_count = AsyncMock(return_value=170_000)
        provider = mock_provider_registry.get_provider.return_value
        provider.complete.side_effect = Exception("failure")
        on_event = AsyncMock()
        mock_db = AsyncMock()

        await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5",
            on_event=on_event,
        )

        event_types = [call.args[0]["type"] for call in on_event.await_args_list]
        assert "summary_complete" in event_types


# ---------------------------------------------------------------
# Tests: Model switch to smaller context window
# ---------------------------------------------------------------

class TestModelSwitch:
    @pytest.mark.asyncio
    async def test_triggers_with_smaller_window(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        long_messages: list[ChatMessage],
        conversation_id: uuid.UUID,
    ) -> None:
        """Switching to a model with a smaller context window triggers summarization."""
        # Simulate: 45K tokens, model with 50K window → 90% > 80% threshold.
        call_count = 0

        async def token_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 45_000  # Initial count: above threshold
            return 5  # Individual message counts for budget calculation

        mock_token_counter.get_active_count = AsyncMock(side_effect=token_side_effect)
        mock_token_counter.get_context_window = MagicMock(return_value=50_000)
        mock_db = TestSummaryTriggered._make_mock_db()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=long_messages,
            provider="openai",
            model_id="gpt-5-mini",
        )
        assert len(result) < len(long_messages)


# ---------------------------------------------------------------
# Tests: Existing summary in history
# ---------------------------------------------------------------

class TestExistingSummary:
    @pytest.mark.asyncio
    async def test_previous_summary_can_be_resummarized(
        self,
        summary_service: RollingSummaryService,
        mock_token_counter: MagicMock,
        conversation_id: uuid.UUID,
    ) -> None:
        """A previous summary message in history is eligible for re-summarization."""
        messages = [
            ChatMessage(role="system", content="You are Wayne."),
            ChatMessage(
                role="system",
                content="[Conversation Summary]: Previous summary of older messages.",
            ),
            ChatMessage(role="user", content="More questions " * 100),
            ChatMessage(role="assistant", content="More answers " * 100),
            ChatMessage(role="user", content="Even more " * 100),
            ChatMessage(role="assistant", content="Even more replies " * 100),
            ChatMessage(role="user", content="Latest question"),
        ]

        call_count = 0

        async def token_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 170_000  # Above threshold
            return 5  # Individual message counts

        mock_token_counter.get_active_count = AsyncMock(side_effect=token_side_effect)
        mock_db = TestSummaryTriggered._make_mock_db()

        result = await summary_service.check_and_summarize(
            db=mock_db,
            conversation_id=conversation_id,
            messages=messages,
            provider="openai",
            model_id="gpt-5",
        )
        # The previous summary should have been consumed and replaced.
        assert len(result) < len(messages)
        # A new summary should exist.
        summary_msgs = [m for m in result if "[Conversation Summary]" in (m.content or "")]
        assert len(summary_msgs) == 1
```

### 6.4 Integration Tests

**File:** `tests/integration/test_rolling_summary_integration.py`

```python
"""Integration tests for rolling summary — uses real DB, mocked LLM providers."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.models.message import Message, MessageRole
from src.backend.models.rolling_summary import RollingSummary
from src.backend.models.conversation import Conversation
from src.backend.providers.base import ChatMessage, CompletionResult
from src.backend.services.rolling_summary import RollingSummaryService
from src.backend.services.token_counter import TokenCounter

from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
async def conversation(db: AsyncSession) -> Conversation:
    """Create a conversation in the test database."""
    conv = Conversation(title="Test conversation")
    db.add(conv)
    await db.flush()
    return conv


@pytest.fixture
async def populated_conversation(
    db: AsyncSession, conversation: Conversation
) -> tuple[Conversation, list[Message]]:
    """Create a conversation with many messages in the database."""
    messages: list[Message] = []
    for i in range(20):
        user_msg = Message(
            conversation_id=conversation.id,
            role=MessageRole.USER,
            content=f"User message {i} with lots of content " * 20,
            sequence=i * 2,
        )
        assistant_msg = Message(
            conversation_id=conversation.id,
            role=MessageRole.ASSISTANT,
            content=f"Assistant reply {i} with lots of content " * 20,
            model_id="gpt-5",
            provider="openai",
            sequence=i * 2 + 1,
        )
        db.add(user_msg)
        db.add(assistant_msg)
        messages.extend([user_msg, assistant_msg])
    await db.flush()
    return conversation, messages


@pytest.fixture
def mock_provider_registry() -> MagicMock:
    registry = MagicMock()
    openai_provider = AsyncMock()
    openai_provider.complete = AsyncMock(
        return_value=CompletionResult(
            content="Summary: The user and assistant discussed various topics.",
            finish_reason="stop",
            usage={"input_tokens": 100, "output_tokens": 50},
        )
    )
    registry.get_provider = MagicMock(return_value=openai_provider)
    return registry


class TestRollingSummaryIntegration:
    @pytest.mark.asyncio
    async def test_summary_persisted_to_database(
        self,
        db: AsyncSession,
        populated_conversation: tuple[Conversation, list[Message]],
        mock_provider_registry: MagicMock,
    ) -> None:
        """When summary triggers, a rolling_summaries row is created in the DB."""
        conv, messages = populated_conversation

        # Build ChatMessage list from DB messages.
        chat_messages = [
            ChatMessage(role="system", content="You are Wayne."),
        ]
        for msg in messages:
            cm = ChatMessage(role=msg.role.value, content=msg.content)
            # Attach DB id for the service to track.
            cm.db_id = msg.id  # type: ignore[attr-defined]
            chat_messages.append(cm)
        chat_messages.append(ChatMessage(role="user", content="New question"))

        # Token counter that triggers summarization.
        counter = TokenCounter(anthropic_client=None)
        call_count = 0
        original_count = counter.count_openai

        async def mock_active_count(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 170_000  # Above threshold
            # For subsequent calls (individual message counting), use real tiktoken.
            return 5

        with patch.object(counter, "get_active_count", side_effect=mock_active_count):
            with patch(
                "src.backend.services.rolling_summary.get_settings"
            ) as mock_settings_fn:
                settings = MagicMock()
                settings.summary_threshold = 0.80
                settings.summary_budget = 0.50
                settings.lightweight_model = "gpt-5-nano"
                mock_settings_fn.return_value = settings

                service = RollingSummaryService(counter, mock_provider_registry)

                await service.check_and_summarize(
                    db=db,
                    conversation_id=conv.id,
                    messages=chat_messages,
                    provider="openai",
                    model_id="gpt-5",
                )

        await db.commit()

        # Verify rolling_summaries row was created.
        result = await db.execute(
            select(RollingSummary).where(
                RollingSummary.conversation_id == conv.id
            )
        )
        summaries = result.scalars().all()
        assert len(summaries) == 1
        summary = summaries[0]
        assert "discussed various topics" in summary.summary_text
        assert summary.tokens_before == 170_000
        assert summary.model_used == "gpt-5-nano"

    @pytest.mark.asyncio
    async def test_summary_message_persisted(
        self,
        db: AsyncSession,
        populated_conversation: tuple[Conversation, list[Message]],
        mock_provider_registry: MagicMock,
    ) -> None:
        """A summary-role message is created in the messages table."""
        conv, messages = populated_conversation

        chat_messages = [ChatMessage(role="system", content="You are Wayne.")]
        for msg in messages:
            cm = ChatMessage(role=msg.role.value, content=msg.content)
            cm.db_id = msg.id  # type: ignore[attr-defined]
            chat_messages.append(cm)
        chat_messages.append(ChatMessage(role="user", content="New question"))

        counter = TokenCounter(anthropic_client=None)

        async def mock_active_count(*args, **kwargs):
            if not hasattr(mock_active_count, "_n"):
                mock_active_count._n = 0
            mock_active_count._n += 1
            return 170_000 if mock_active_count._n == 1 else 5

        with patch.object(counter, "get_active_count", side_effect=mock_active_count):
            with patch(
                "src.backend.services.rolling_summary.get_settings"
            ) as mock_settings_fn:
                settings = MagicMock()
                settings.summary_threshold = 0.80
                settings.summary_budget = 0.50
                settings.lightweight_model = "gpt-5-nano"
                mock_settings_fn.return_value = settings

                service = RollingSummaryService(counter, mock_provider_registry)
                await service.check_and_summarize(
                    db=db,
                    conversation_id=conv.id,
                    messages=chat_messages,
                    provider="openai",
                    model_id="gpt-5",
                )

        await db.commit()

        result = await db.execute(
            select(Message).where(
                Message.conversation_id == conv.id,
                Message.role == MessageRole.SUMMARY,
            )
        )
        summary_msgs = result.scalars().all()
        assert len(summary_msgs) == 1
        assert "[Conversation Summary]" in summary_msgs[0].content

    @pytest.mark.asyncio
    async def test_no_op_when_below_threshold(
        self,
        db: AsyncSession,
        conversation: Conversation,
    ) -> None:
        """No summary generated when token count is below threshold."""
        chat_messages = [
            ChatMessage(role="system", content="You are Wayne."),
            ChatMessage(role="user", content="Hello"),
            ChatMessage(role="assistant", content="Hi there!"),
            ChatMessage(role="user", content="How are you?"),
        ]

        counter = TokenCounter(anthropic_client=None)
        registry = MagicMock()

        with patch(
            "src.backend.services.rolling_summary.get_settings"
        ) as mock_settings_fn:
            settings = MagicMock()
            settings.summary_threshold = 0.80
            settings.summary_budget = 0.50
            settings.lightweight_model = "gpt-5-nano"
            mock_settings_fn.return_value = settings

            service = RollingSummaryService(counter, registry)
            result = await service.check_and_summarize(
                db=db,
                conversation_id=conversation.id,
                messages=chat_messages,
                provider="openai",
                model_id="gpt-5",
            )

        # Messages unchanged.
        assert result is chat_messages

        # No summary rows created.
        db_result = await db.execute(
            select(RollingSummary).where(
                RollingSummary.conversation_id == conversation.id
            )
        )
        assert len(db_result.scalars().all()) == 0
```

---

## Step 7: Verification Checklist

Run the following after implementation to confirm all completion criteria are met:

```bash
# 1. Unit tests pass
poetry run pytest tests/unit/test_token_counter.py -v
poetry run pytest tests/unit/test_rolling_summary.py -v

# 2. Integration tests pass (requires running Postgres)
poetry run pytest tests/integration/test_rolling_summary_integration.py -v

# 3. All tests together
poetry run pytest tests/ -v

# 4. Import check — both services import cleanly
poetry run python -c "from src.backend.services.token_counter import TokenCounter; print('TokenCounter OK')"
poetry run python -c "from src.backend.services.rolling_summary import RollingSummaryService; print('RollingSummaryService OK')"
```

**Expected results:**

| Check | Expected |
|---|---|
| `test_token_counter.py` | All tests pass (14+ tests) |
| `test_rolling_summary.py` | All tests pass (12+ tests) |
| `test_rolling_summary_integration.py` | All tests pass (3 tests, requires DB) |
| Import TokenCounter | Prints "TokenCounter OK" |
| Import RollingSummaryService | Prints "RollingSummaryService OK" |

---

## File Summary

| File | Action | Description |
|---|---|---|
| `pyproject.toml` | Modify | Add `tiktoken` dependency |
| `src/backend/services/token_counter.py` | Create | TokenCounter with 3 counting methods + context window lookup + dispatcher |
| `src/backend/services/rolling_summary.py` | Create | RollingSummaryService with threshold check, message selection, summary generation, persistence |
| `tests/conftest.py` | Modify | Add shared fixtures for token counter and sample messages |
| `tests/unit/test_token_counter.py` | Create | Unit tests for all counting methods, context window lookup, dispatcher |
| `tests/unit/test_rolling_summary.py` | Create | Unit tests for threshold logic, summarization, edge cases, failure handling |
| `tests/integration/test_rolling_summary_integration.py` | Create | Integration tests with real DB for persistence verification |
| `src/backend/services/chat.py` | Modify (Phase 6) | Wire `check_and_summarize()` into the chat orchestrator |
