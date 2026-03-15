"""Token counting for all three LLM providers.

Three methods:
  - OpenAI:    tiktoken (local, exact)
  - Anthropic: count_tokens SDK method (network call, exact)
  - OpenRouter: characters / 3.5 heuristic (local, approximate)
"""

from __future__ import annotations

import logging
import math

import tiktoken
from anthropic import AsyncAnthropic

from src.backend.config import Settings
from src.backend.exceptions import TokenCountError
from src.backend.providers.base import ChatMessage
from src.backend.providers.model_catalog import get_context_window as catalog_get_context_window

logger = logging.getLogger(__name__)


class TokenCounter:
    """Counts tokens across all three provider integrations."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        # Create our own Anthropic client for count_tokens calls
        self._anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key) if settings.anthropic_api_key else None

    # ------------------------------------------------------------------
    # OpenAI — tiktoken (local, exact)
    # ------------------------------------------------------------------

    def count_openai(self, messages: list[ChatMessage]) -> int:
        """Count tokens for an OpenAI model using tiktoken.

        Uses the chat format overhead: 4 tokens per message for role/separator
        delimiters, plus 3 tokens priming the reply at the end.
        """
        try:
            encoding = tiktoken.encoding_for_model("gpt-4o")  # o200k_base encoding
        except KeyError:
            logger.warning("tiktoken: model encoding not found, falling back to o200k_base")
            encoding = tiktoken.get_encoding("o200k_base")

        total = 0
        for msg in messages:
            # 4 tokens overhead per message (role marker, content delimiters)
            total += 4
            content = msg.content or ""
            total += len(encoding.encode(content))
            # tool_calls have no text content but still incur overhead
        # 3 tokens to prime the reply
        total += 3
        return total

    # ------------------------------------------------------------------
    # Anthropic — count_tokens API (network call, exact)
    # ------------------------------------------------------------------

    async def count_anthropic(self, messages: list[ChatMessage], model_id: str) -> int:
        """Count tokens for an Anthropic model via the SDK's count_tokens API.

        Extracts system messages for the top-level system param and converts
        remaining messages to Anthropic format.
        """
        if self._anthropic is None:
            raise TokenCountError("Anthropic API key not configured")

        # Separate system messages from conversation messages
        system_parts: list[str] = []
        anthropic_messages: list[dict] = []

        for msg in messages:
            if msg.role == "system":
                if msg.content:
                    system_parts.append(msg.content)
            elif msg.role in ("user", "assistant"):
                anthropic_messages.append({
                    "role": msg.role,
                    "content": msg.content or "",
                })
            # tool_call and tool_result: treat content as assistant/user text
            # for a conservative approximation
            elif msg.role == "tool_call":
                anthropic_messages.append({
                    "role": "assistant",
                    "content": msg.content or "",
                })
            elif msg.role == "tool_result":
                anthropic_messages.append({
                    "role": "user",
                    "content": msg.content or "",
                })

        if not anthropic_messages:
            return 0

        system_text = "\n\n".join(system_parts) if system_parts else None

        try:
            kwargs: dict = {
                "model": model_id,
                "messages": anthropic_messages,
            }
            if system_text:
                kwargs["system"] = system_text

            result = await self._anthropic.messages.count_tokens(**kwargs)
            return result.input_tokens
        except Exception as e:
            raise TokenCountError(f"Anthropic token count failed: {e}") from e

    # ------------------------------------------------------------------
    # OpenRouter — characters / 3.5 heuristic (local, approximate)
    # ------------------------------------------------------------------

    def count_openrouter(self, messages: list[ChatMessage]) -> int:
        """Estimate tokens for an OpenRouter model using the char/3.5 heuristic.

        Intentionally overcounts slightly vs reality — safer for threshold detection.
        """
        total_chars = sum(len(msg.content or "") for msg in messages)
        return math.ceil(total_chars / 3.5)

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    async def count_for_provider(
        self,
        messages: list[ChatMessage],
        provider: str,
        model_id: str,
    ) -> int:
        """Count tokens using the method appropriate for the given provider."""
        if provider == "openai":
            return self.count_openai(messages)
        if provider == "anthropic":
            return await self.count_anthropic(messages, model_id)
        if provider == "openrouter":
            return self.count_openrouter(messages)
        raise TokenCountError(f"Unknown provider for token counting: {provider}")

    # ------------------------------------------------------------------
    # Context window lookup
    # ------------------------------------------------------------------

    def get_context_window(self, model_id: str, provider: str) -> int:
        """Return the context window size in tokens for the given model."""
        return catalog_get_context_window(model_id, provider)
