"""Provider registry — instantiates and looks up LLM providers."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from src.backend.exceptions import ProviderKeyMissing
from src.backend.providers.anthropic import AnthropicProvider
from src.backend.providers.openai import OpenAIProvider
from src.backend.providers.openrouter import OpenRouterProvider

if TYPE_CHECKING:
    from src.backend.config import Settings
    from src.backend.providers.base import LLMProvider

logger = logging.getLogger(__name__)


class ProviderRegistry:
    """Registry that maps provider names to instantiated provider objects."""

    def __init__(self, settings: Settings) -> None:
        self._providers: dict[str, LLMProvider] = {}

        if settings.openai_api_key:
            self._providers["openai"] = OpenAIProvider(api_key=settings.openai_api_key)
            logger.info("OpenAI provider registered")

        if settings.anthropic_api_key:
            self._providers["anthropic"] = AnthropicProvider(api_key=settings.anthropic_api_key)
            logger.info("Anthropic provider registered")

        if settings.openrouter_api_key:
            self._providers["openrouter"] = OpenRouterProvider(api_key=settings.openrouter_api_key)
            logger.info("OpenRouter provider registered")

    def get(self, provider_name: str) -> LLMProvider:
        """Return the provider instance for the given name.

        Raises ProviderKeyMissing if the provider is not configured.
        """
        provider = self._providers.get(provider_name)
        if provider is None:
            raise ProviderKeyMissing(
                f"Provider '{provider_name}' is not configured. Check your API key in .env"
            )
        return provider

    def available_providers(self) -> list[str]:
        """Return names of providers that have configured API keys."""
        return list(self._providers.keys())
