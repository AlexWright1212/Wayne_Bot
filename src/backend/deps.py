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
from src.backend.services.rolling_summary import RollingSummaryService
from src.backend.services.token_counter import TokenCounter
from src.backend.services.visibility import VisibilityService
from src.backend.tools.framework import ToolFramework
from src.backend.tools.web_search.tool import WebSearchTool

_provider_registry = ProviderRegistry(settings)
_conv_service = ConversationService()
_auto_title_service = AutoTitleService(_provider_registry, _conv_service)
_token_counter = TokenCounter(settings)
_rolling_summary_service = RollingSummaryService(_token_counter, _provider_registry, settings)
_tool_framework = ToolFramework()
_tool_framework.register(WebSearchTool(settings))
_visibility_service = VisibilityService(_token_counter, settings)
_chat_service = ChatService(
    provider_registry=_provider_registry,
    conversation_service=_conv_service,
    auto_title_service=_auto_title_service,
    rolling_summary_service=_rolling_summary_service,
    tool_framework=_tool_framework,
    visibility_service=_visibility_service,
    token_counter=_token_counter,
    settings=settings,
)


def get_provider_registry() -> ProviderRegistry:
    return _provider_registry


def get_conv_service() -> ConversationService:
    return _conv_service


def get_chat_service() -> ChatService:
    return _chat_service


def get_visibility_service() -> VisibilityService:
    return _visibility_service
