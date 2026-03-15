"""WebSearchTool — implements Tool ABC, delegates to SearchHarness."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from src.backend.config import Settings
from src.backend.tools.base import Tool, ToolContext, ToolResult, ToolStep
from src.backend.tools.web_search.harness import SearchHarness
from src.backend.tools.web_search.tavily_client import TavilyClient

logger = logging.getLogger(__name__)


class WebSearchTool(Tool):
    name = "web_search"
    description = (
        "Search the web for current or factual information needed to answer the user's question. "
        "Use this when the question requires up-to-date information, specific facts, or knowledge "
        "you may not have."
    )
    parameters = {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Brief explanation of why web search is needed",
            },
            "query": {
                "type": "string",
                "description": "The information need described clearly for the search system",
            },
        },
        "required": ["reason", "query"],
    }

    def __init__(self, settings: Settings) -> None:
        self._harness = SearchHarness(
            tavily_client=TavilyClient(api_key=settings.tavily_api_key),
            settings=settings,
        )

    async def execute(
        self,
        arguments: dict,
        context: ToolContext,
        on_step: Callable[[ToolStep], Awaitable[None]],
    ) -> ToolResult:
        reason = arguments.get("reason", "")
        query = arguments.get("query", "")
        return await self._harness.run(
            reason=reason,
            query=query,
            context=context,
            on_step=on_step,
        )
