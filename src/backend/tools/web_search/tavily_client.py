"""Async Tavily Search API client."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

import httpx

from src.backend.exceptions import ToolExecutionError

logger = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"
_RETRY_DELAY = 1.0  # seconds before retry
_TIMEOUT = 15.0  # seconds per request


@dataclass
class TavilyResult:
    title: str
    url: str
    content: str
    score: float
    published_date: str | None = field(default=None)


class TavilyClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def search(self, query: str) -> list[TavilyResult]:
        """Search Tavily and return results. Retries once on failure."""
        payload = {
            "api_key": self._api_key,
            "query": query,
            "search_depth": "advanced",
            "include_raw_content": False,
            "max_results": 10,
        }
        last_error: Exception | None = None
        for attempt in range(2):
            if attempt > 0:
                await asyncio.sleep(_RETRY_DELAY)
            try:
                async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                    resp = await client.post(TAVILY_URL, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    return [
                        TavilyResult(
                            title=r.get("title", ""),
                            url=r.get("url", ""),
                            content=r.get("content", ""),
                            score=r.get("score", 0.0),
                            published_date=r.get("published_date"),
                        )
                        for r in data.get("results", [])
                    ]
            except Exception as exc:
                last_error = exc
                logger.warning("Tavily attempt %d failed: %s", attempt + 1, exc)

        raise ToolExecutionError(f"Tavily search failed after 2 attempts: {last_error}")
