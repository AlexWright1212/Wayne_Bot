"""Application-level dependency providers.

Module-level singletons for all services. Routes import these and use them
via FastAPI's Depends system, making them easy to override in tests.
"""

from __future__ import annotations

from src.backend.config import settings
from src.backend.providers.registry import ProviderRegistry
from src.backend.services.auto_title import AutoTitleService
from src.backend.services.chat import ChatService
from src.backend.services.conversation import ConversationService

_provider_registry = ProviderRegistry(settings)
_conv_service = ConversationService()
_auto_title_service = AutoTitleService(_provider_registry, _conv_service)
_chat_service = ChatService(_provider_registry, _conv_service, _auto_title_service)


def get_provider_registry() -> ProviderRegistry:
    return _provider_registry


def get_conv_service() -> ConversationService:
    return _conv_service


def get_chat_service() -> ChatService:
    return _chat_service
