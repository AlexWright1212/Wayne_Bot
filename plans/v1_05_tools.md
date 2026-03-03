# Unit T — Tool Framework + Web Search: Implementation Plan (`plans/v1_05_tools.md`)

## Overview

This plan covers the complete implementation of Wayne v1 Unit T — the pluggable tool framework and the web search tool (the only tool shipped in v1). The tool framework provides registration, provider-specific schema normalization (OpenAI / Anthropic / OpenRouter), tool call routing, and step-by-step trace callbacks. The web search tool implements a 5-step deterministic research harness using Tavily, with query refinement, entity extraction, filtering, and a coverage-check retry loop.

All spec references are to `spec/v1_spec.md` v1.1. Model references verified against `docs/llm_models_reference.md` (2026-03-02).

**Completion criteria:**

1. `ToolFramework` can register tools, emit schemas in all three provider formats, route calls, and report tool support per model
2. `WebSearchTool` registers with correct schema and delegates to the harness
3. The harness runs the full 5-step pipeline (query gen, search round 1, template fill + search round 2, deterministic filter, coverage check with retry)
4. Deterministic filters correctly apply score, date, domain, and dedup rules
5. Tavily client handles retries and errors per spec section 11.4
6. `on_step` callback fires for every pipeline step with `ToolStep` data
7. All unit and integration tests pass with mocked Tavily and mocked lightweight LLM

**Dependencies:** Unit F (config, exceptions, database), Unit P (provider registry, `LLMProvider.complete()` for lightweight model calls)

---

## Step 1: Pydantic Schemas — `src/backend/schemas/tools.py`

These schemas define the data shapes that flow through the tool framework and are persisted in visibility records.

**File:** `src/backend/schemas/tools.py`

```python
"""Pydantic schemas for the tool framework and web search harness."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Tool framework core schemas
# ---------------------------------------------------------------------------

class ToolStepStatus(str, Enum):
    running = "running"
    complete = "complete"
    error = "error"


class ToolStepSchema(BaseModel):
    """One discrete step inside a tool execution pipeline."""
    name: str
    status: ToolStepStatus
    data: dict[str, Any] = Field(default_factory=dict)
    duration_ms: int = 0


class ToolResultSchema(BaseModel):
    """The final output of a tool execution."""
    content: str | dict[str, Any]
    trace: list[ToolStepSchema] = Field(default_factory=list)


class ToolCallData(BaseModel):
    """Represents a tool call emitted by an LLM."""
    id: str
    name: str
    arguments: dict[str, Any]


# ---------------------------------------------------------------------------
# Web search harness schemas
# ---------------------------------------------------------------------------

class QueryGenerationOutput(BaseModel):
    """Output of Step 1 — query generation."""
    ready_queries: list[str]
    pending_queries: list[str] = Field(default_factory=list)


class TavilySearchResult(BaseModel):
    """A single result from the Tavily API."""
    title: str
    url: str
    content: str  # snippet
    score: float
    published_date: str | None = None
    raw_content: str | None = None


class EntityExtractionOutput(BaseModel):
    """Output of entity extraction sub-step in Step 2."""
    entities: dict[str, str]  # slot_name -> extracted_value


class FilteredResult(BaseModel):
    """A search result that survived deterministic filtering."""
    title: str
    url: str
    content: str
    score: float
    published_date: str | None = None


class FilterDecision(BaseModel):
    """Records why a result was kept or discarded."""
    url: str
    kept: bool
    reason: str  # e.g. "score_below_threshold", "domain_blacklisted", "duplicate", "ok"


class CoverageCheckOutput(BaseModel):
    """Output of Step 5 — coverage check."""
    sufficient: bool
    missing: list[str] = Field(default_factory=list)
    confidence: float = 0.0


class WebSearchToolResult(BaseModel):
    """The structured result returned to the chat LLM as the tool result."""
    results: list[FilteredResult]
    total_results_before_filter: int
    total_results_after_filter: int
    search_rounds: int
    gaps: list[str] = Field(default_factory=list)  # unfilled gaps after max retries
```

---

## Step 2: Tool Base Classes — `src/backend/tools/base.py`

Defines the abstract `Tool` interface, `ToolResult`, `ToolStep`, and `ToolContext` dataclasses used by the framework and all tool implementations.

**File:** `src/backend/tools/base.py`

```python
"""Abstract base classes and dataclasses for the tool framework."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class ToolContext:
    """Contextual information passed to a tool during execution.

    Provides the tool with access to the user's original message
    and any configuration it may need.
    """
    user_message: str
    conversation_id: str
    lightweight_model: str  # e.g. "gpt-5-nano"
    # Callable to make lightweight LLM completions — injected by ChatService
    # Signature: async (messages: list[dict], response_format: dict | None) -> str
    llm_complete: Any = None  # typed loosely to avoid circular imports


@dataclass
class ToolStep:
    """A single logged step within a tool execution pipeline."""
    name: str
    status: Literal["running", "complete", "error"]
    data: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0


@dataclass
class ToolResult:
    """The outcome of a tool execution, including a trace of all steps."""
    content: str | dict[str, Any]
    trace: list[ToolStep] = field(default_factory=list)


class Tool(ABC):
    """Abstract base for all Wayne tools.

    Subclasses must set `name`, `description`, and `parameters` (JSON Schema),
    and implement `execute`.
    """
    name: str
    description: str
    parameters: dict[str, Any]  # JSON Schema for the tool's arguments

    @abstractmethod
    async def execute(
        self,
        arguments: dict[str, Any],
        context: ToolContext,
        on_step: Any = None,  # Callable[[ToolStep], Awaitable[None]]
    ) -> ToolResult:
        """Execute the tool and return a result with a trace.

        Args:
            arguments: The arguments provided by the LLM's tool call.
            context: Contextual info (user message, conversation, LLM helper).
            on_step: Async callback fired for every pipeline step, enabling
                     real-time WebSocket progress updates.
        """
        ...
```

---

## Step 3: Tool Framework — `src/backend/tools/framework.py`

The framework handles registration, provider-specific schema translation, tool call routing, and model capability checks.

**File:** `src/backend/tools/framework.py`

```python
"""Tool framework: registration, schema normalization, routing, execution."""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from src.backend.tools.base import Tool, ToolContext, ToolResult, ToolStep

logger = logging.getLogger(__name__)

# Models known NOT to support tool calling.  The framework checks this set
# in `supports_tools` to gracefully degrade.
_NO_TOOL_SUPPORT: set[str] = {
    # DeepSeek R1 does not support function calling
    "deepseek/deepseek-r1",
}


class ToolFramework:
    """Central registry and dispatcher for all Wayne tools."""

    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(self, tool: Tool) -> None:
        """Register a tool instance.  Raises ValueError on duplicate name."""
        if tool.name in self._tools:
            raise ValueError(f"Tool already registered: {tool.name}")
        self._tools[tool.name] = tool
        logger.info("Registered tool: %s", tool.name)

    # ------------------------------------------------------------------
    # Schema generation — provider-specific formats
    # ------------------------------------------------------------------

    def get_schemas_for_provider(self, provider: str) -> list[dict[str, Any]]:
        """Return tool schemas formatted for the given provider.

        Supported providers: "openai", "anthropic", "openrouter".
        OpenRouter uses the OpenAI-compatible format.
        """
        schemas: list[dict[str, Any]] = []
        for tool in self._tools.values():
            if provider == "anthropic":
                schemas.append(self._to_anthropic_schema(tool))
            else:
                # OpenAI and OpenRouter share the same format
                schemas.append(self._to_openai_schema(tool))
        return schemas

    @staticmethod
    def _to_openai_schema(tool: Tool) -> dict[str, Any]:
        """OpenAI function-calling format.

        ```json
        {
          "type": "function",
          "function": {
            "name": "...",
            "description": "...",
            "parameters": { ... JSON Schema ... }
          }
        }
        ```
        """
        return {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }

    @staticmethod
    def _to_anthropic_schema(tool: Tool) -> dict[str, Any]:
        """Anthropic tool-use format.

        ```json
        {
          "name": "...",
          "description": "...",
          "input_schema": { ... JSON Schema ... }
        }
        ```
        """
        return {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.parameters,
        }

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        context: ToolContext,
        on_step: Callable[[ToolStep], Awaitable[None]] | None = None,
    ) -> ToolResult:
        """Route a tool call to its handler and return the result.

        Args:
            tool_name: Name of the registered tool to invoke.
            arguments: Arguments from the LLM's tool call.
            context: Execution context (user message, LLM helper, etc.).
            on_step: Optional async callback for real-time step progress.

        Returns:
            ToolResult with content and a full execution trace.

        Raises:
            KeyError: If the tool_name is not registered.
        """
        if tool_name not in self._tools:
            raise KeyError(f"Unknown tool: {tool_name}")

        tool = self._tools[tool_name]
        logger.info("Executing tool: %s with arguments: %s", tool_name, arguments)

        start = time.monotonic()
        try:
            result = await tool.execute(arguments, context, on_step=on_step)
        except Exception as e:
            logger.exception("Tool %s failed", tool_name)
            error_step = ToolStep(
                name="tool_execution_error",
                status="error",
                data={"error": str(e), "tool_name": tool_name},
                duration_ms=int((time.monotonic() - start) * 1000),
            )
            if on_step:
                await on_step(error_step)
            return ToolResult(
                content=f"Tool '{tool_name}' failed: {e}",
                trace=[error_step],
            )

        total_ms = int((time.monotonic() - start) * 1000)
        logger.info("Tool %s completed in %d ms", tool_name, total_ms)
        return result

    # ------------------------------------------------------------------
    # Capability checks
    # ------------------------------------------------------------------

    def supports_tools(self, model_id: str) -> bool:
        """Return True if the given model supports tool calling.

        Models in the known no-tool-support set return False.
        All other models are assumed to support tools.
        """
        return model_id not in _NO_TOOL_SUPPORT

    @property
    def registered_tool_names(self) -> list[str]:
        """List all registered tool names (for diagnostics)."""
        return list(self._tools.keys())
```

---

## Step 4: Tavily Client — `src/backend/tools/web_search/tavily_client.py`

An async httpx client with retry logic per spec section 11.4 (retry once on failure, then abort).

**File:** `src/backend/tools/web_search/tavily_client.py`

```python
"""Async Tavily Search API client with retry logic."""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# Timeout: 15s connect, 30s read — Tavily can be slow on complex queries
_TIMEOUT = httpx.Timeout(connect=15.0, read=30.0, write=10.0, pool=10.0)


class TavilyError(Exception):
    """Raised when Tavily API calls fail after retries."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class TavilyClient:
    """Async wrapper around the Tavily Search API.

    Handles a single retry on failure per spec §11.4.
    """

    def __init__(self, api_key: str, max_retries: int = 1) -> None:
        self._api_key = api_key
        self._max_retries = max_retries
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=_TIMEOUT)
        return self._client

    async def search(
        self,
        query: str,
        *,
        max_results: int = 10,
        search_depth: str = "advanced",
        include_raw_content: bool = False,
    ) -> list[dict[str, Any]]:
        """Execute a single search query against Tavily.

        Args:
            query: The search query string.
            max_results: Maximum number of results to return.
            search_depth: "basic" or "advanced" (advanced is more thorough).
            include_raw_content: Whether to include raw page content.

        Returns:
            List of result dicts, each with keys: title, url, content, score,
            published_date (optional), raw_content (optional).

        Raises:
            TavilyError: If the request fails after all retries.
        """
        payload = {
            "api_key": self._api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": search_depth,
            "include_raw_content": include_raw_content,
        }

        last_error: Exception | None = None
        attempts = 1 + self._max_retries  # 1 initial + 1 retry = 2 attempts

        for attempt in range(1, attempts + 1):
            try:
                client = await self._get_client()
                response = await client.post(TAVILY_SEARCH_URL, json=payload)
                response.raise_for_status()
                data = response.json()
                results = data.get("results", [])
                logger.info(
                    "Tavily search for %r returned %d results (attempt %d)",
                    query, len(results), attempt,
                )
                return results

            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_error = exc
                status = getattr(getattr(exc, "response", None), "status_code", None)
                logger.warning(
                    "Tavily search attempt %d/%d failed for %r: %s (status=%s)",
                    attempt, attempts, query, exc, status,
                )
                if attempt < attempts:
                    logger.info("Retrying Tavily search for %r...", query)

        raise TavilyError(
            f"Tavily search failed after {attempts} attempts for query {query!r}: {last_error}",
            status_code=getattr(
                getattr(last_error, "response", None), "status_code", None
            ),
        )

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
```

---

## Step 5: Deterministic Filters — `src/backend/tools/web_search/filters.py`

Step 4 of the harness pipeline. Pure Python, no LLM calls. Each filter returns `FilterDecision` records for full visibility into what was kept or discarded.

**File:** `src/backend/tools/web_search/filters.py`

```python
"""Deterministic result filters for the web search harness (Step 4).

All filters are pure functions — no LLM calls, no network.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from src.backend.schemas.tools import FilterDecision, FilteredResult, TavilySearchResult

logger = logging.getLogger(__name__)


def apply_all_filters(
    results: list[TavilySearchResult],
    *,
    score_threshold: float = 0.75,
    date_threshold_days: int = 365,
    domain_blacklist: list[str] | None = None,
) -> tuple[list[FilteredResult], list[FilterDecision]]:
    """Run all deterministic filters on raw Tavily results.

    Returns:
        A tuple of (kept_results, all_decisions).
        `all_decisions` includes both kept and discarded entries
        for visibility/trace purposes.
    """
    if domain_blacklist is None:
        domain_blacklist = []

    # Normalize blacklist to lowercase
    blacklist_lower = [d.lower().strip() for d in domain_blacklist]

    decisions: list[FilterDecision] = []
    kept: list[FilteredResult] = []
    seen_urls: set[str] = set()

    for result in results:
        url = result.url.strip()
        url_normalized = url.lower().rstrip("/")

        # --- Dedup by URL ---
        if url_normalized in seen_urls:
            decisions.append(FilterDecision(url=url, kept=False, reason="duplicate"))
            continue
        seen_urls.add(url_normalized)

        # --- Score filter ---
        if result.score < score_threshold:
            decisions.append(FilterDecision(
                url=url, kept=False,
                reason=f"score_below_threshold ({result.score:.2f} < {score_threshold})",
            ))
            continue

        # --- Domain blacklist ---
        if _is_domain_blacklisted(url, blacklist_lower):
            decisions.append(FilterDecision(
                url=url, kept=False,
                reason="domain_blacklisted",
            ))
            continue

        # --- Date filter ---
        if result.published_date and _is_too_old(result.published_date, date_threshold_days):
            decisions.append(FilterDecision(
                url=url, kept=False,
                reason=f"older_than_{date_threshold_days}_days",
            ))
            continue

        # --- Passed all filters ---
        decisions.append(FilterDecision(url=url, kept=True, reason="ok"))
        kept.append(FilteredResult(
            title=result.title,
            url=url,
            content=result.content,
            score=result.score,
            published_date=result.published_date,
        ))

    logger.info(
        "Filtering: %d raw -> %d kept, %d discarded",
        len(results), len(kept), len(results) - len(kept),
    )
    return kept, decisions


def _is_domain_blacklisted(url: str, blacklist_lower: list[str]) -> bool:
    """Check if the URL's domain matches any blacklisted domain."""
    try:
        # Extract domain from URL: "https://www.example.com/path" -> "www.example.com"
        from urllib.parse import urlparse
        domain = urlparse(url).netloc.lower()
        for blocked in blacklist_lower:
            if domain == blocked or domain.endswith("." + blocked):
                return True
    except Exception:
        pass
    return False


def _is_too_old(published_date: str, max_age_days: int) -> bool:
    """Check if the published date is older than the threshold.

    Tavily dates come in various formats; we try common ones.
    If parsing fails, we keep the result (fail-open).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)

    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            parsed = datetime.strptime(published_date, fmt).replace(tzinfo=timezone.utc)
            return parsed < cutoff
        except ValueError:
            continue

    # Could not parse — fail-open (keep the result)
    logger.debug("Could not parse date %r, keeping result", published_date)
    return False
```

---

## Step 6: Web Search Harness — `src/backend/tools/web_search/harness.py`

The 5-step pipeline orchestrator. Uses the lightweight model (GPT-5 nano via `context.llm_complete`) for Steps 1, 2 (entity extraction), and 5. Uses the Tavily client for search. Uses deterministic filters for Step 4.

**File:** `src/backend/tools/web_search/harness.py`

```python
"""Web search harness — 5-step deterministic research pipeline.

Steps:
  1. Query generation (LLM)
  2. Execute ready queries (Tavily) + entity extraction (LLM)
  3. Fill templates + execute round 2 (Tavily)
  4. Deterministic filtering (Python)
  5. Coverage check with retry loop (LLM)
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from src.backend.schemas.tools import (
    CoverageCheckOutput,
    EntityExtractionOutput,
    FilteredResult,
    QueryGenerationOutput,
    TavilySearchResult,
    WebSearchToolResult,
)
from src.backend.tools.base import ToolContext, ToolResult, ToolStep
from src.backend.tools.web_search.filters import apply_all_filters
from src.backend.tools.web_search.tavily_client import TavilyClient, TavilyError

logger = logging.getLogger(__name__)

# Max coverage-check retry loops (spec §5.3 Step 5: max 2 retries = 3 total rounds)
MAX_COVERAGE_RETRIES = 2


async def run_harness(
    *,
    reason: str,
    query: str,
    context: ToolContext,
    tavily_client: TavilyClient,
    score_threshold: float,
    date_threshold_days: int,
    domain_blacklist: list[str],
    on_step: Callable[[ToolStep], Awaitable[None]] | None = None,
) -> ToolResult:
    """Execute the full web search harness pipeline.

    Args:
        reason: The LLM's stated reason for needing search.
        query: The high-level information need from the LLM.
        context: Tool execution context (user message, LLM helper).
        tavily_client: Configured Tavily API client.
        score_threshold: Minimum Tavily score to keep a result.
        date_threshold_days: Maximum age in days for results.
        domain_blacklist: Domains to exclude.
        on_step: Async callback for real-time progress streaming.

    Returns:
        ToolResult with WebSearchToolResult content and full trace.
    """
    trace: list[ToolStep] = []
    all_raw_results: list[TavilySearchResult] = []
    search_rounds = 0

    async def _emit(step: ToolStep) -> None:
        trace.append(step)
        if on_step:
            await on_step(step)

    # ------------------------------------------------------------------
    # Step 1 — Query Generation
    # ------------------------------------------------------------------
    step_start = time.monotonic()
    await _emit(ToolStep(name="query_generation", status="running", data={}))

    try:
        query_output = await _step_generate_queries(reason, query, context)
    except Exception as e:
        step = ToolStep(
            name="query_generation", status="error",
            data={"error": str(e)},
            duration_ms=int((time.monotonic() - step_start) * 1000),
        )
        await _emit(step)
        return ToolResult(
            content=f"Search harness failed at query generation: {e}",
            trace=trace,
        )

    await _emit(ToolStep(
        name="query_generation", status="complete",
        data={
            "ready_queries": query_output.ready_queries,
            "pending_queries": query_output.pending_queries,
        },
        duration_ms=int((time.monotonic() - step_start) * 1000),
    ))

    # ------------------------------------------------------------------
    # Step 2 — Execute Ready Queries + Entity Extraction
    # ------------------------------------------------------------------
    step_start = time.monotonic()
    await _emit(ToolStep(name="search_round_1", status="running", data={}))

    round_1_results = await _execute_queries(query_output.ready_queries, tavily_client)
    all_raw_results.extend(round_1_results)
    search_rounds += 1

    entities: dict[str, str] = {}
    if query_output.pending_queries and round_1_results:
        try:
            entity_output = await _step_extract_entities(
                query_output.pending_queries, round_1_results, context,
            )
            entities = entity_output.entities
        except Exception as e:
            logger.warning("Entity extraction failed: %s — skipping template queries", e)

    await _emit(ToolStep(
        name="search_round_1", status="complete",
        data={
            "queries_executed": query_output.ready_queries,
            "results_count": len(round_1_results),
            "results": [_result_summary(r) for r in round_1_results],
            "entities_extracted": entities,
        },
        duration_ms=int((time.monotonic() - step_start) * 1000),
    ))

    # ------------------------------------------------------------------
    # Step 3 — Fill Templates + Execute Round 2
    # ------------------------------------------------------------------
    if query_output.pending_queries and entities:
        step_start = time.monotonic()
        await _emit(ToolStep(name="search_round_2", status="running", data={}))

        filled_queries = _fill_templates(query_output.pending_queries, entities)
        round_2_results = await _execute_queries(filled_queries, tavily_client)
        all_raw_results.extend(round_2_results)
        search_rounds += 1

        await _emit(ToolStep(
            name="search_round_2", status="complete",
            data={
                "filled_queries": filled_queries,
                "results_count": len(round_2_results),
                "results": [_result_summary(r) for r in round_2_results],
            },
            duration_ms=int((time.monotonic() - step_start) * 1000),
        ))

    # ------------------------------------------------------------------
    # Step 4 — Deterministic Filtering
    # ------------------------------------------------------------------
    step_start = time.monotonic()
    await _emit(ToolStep(name="filtering", status="running", data={}))

    filtered, decisions = apply_all_filters(
        all_raw_results,
        score_threshold=score_threshold,
        date_threshold_days=date_threshold_days,
        domain_blacklist=domain_blacklist,
    )

    await _emit(ToolStep(
        name="filtering", status="complete",
        data={
            "total_before": len(all_raw_results),
            "total_after": len(filtered),
            "decisions": [d.model_dump() for d in decisions],
        },
        duration_ms=int((time.monotonic() - step_start) * 1000),
    ))

    # ------------------------------------------------------------------
    # Step 5 — Coverage Check with Retry Loop
    # ------------------------------------------------------------------
    remaining_gaps: list[str] = []
    retries_used = 0

    for retry_idx in range(MAX_COVERAGE_RETRIES + 1):  # 0, 1, 2 = up to 3 checks
        step_start = time.monotonic()
        step_name = "coverage_check" if retry_idx == 0 else f"coverage_retry_{retry_idx}"
        await _emit(ToolStep(name=step_name, status="running", data={}))

        try:
            coverage = await _step_coverage_check(query, filtered, context)
        except Exception as e:
            logger.warning("Coverage check failed: %s — proceeding with available results", e)
            await _emit(ToolStep(
                name=step_name, status="error",
                data={"error": str(e)},
                duration_ms=int((time.monotonic() - step_start) * 1000),
            ))
            break

        await _emit(ToolStep(
            name=step_name, status="complete",
            data={
                "sufficient": coverage.sufficient,
                "missing": coverage.missing,
                "confidence": coverage.confidence,
            },
            duration_ms=int((time.monotonic() - step_start) * 1000),
        ))

        if coverage.sufficient or retry_idx >= MAX_COVERAGE_RETRIES:
            remaining_gaps = coverage.missing if not coverage.sufficient else []
            break

        # --- Retry: search for missing items ---
        retries_used += 1
        retry_step_start = time.monotonic()
        await _emit(ToolStep(
            name=f"search_retry_{retries_used}", status="running",
            data={"targeting_gaps": coverage.missing},
        ))

        retry_results = await _execute_queries(coverage.missing, tavily_client)
        retry_raw = [
            TavilySearchResult(**r) if isinstance(r, dict) else r
            for r in retry_results
        ]
        search_rounds += 1

        # Re-filter including new results
        all_raw_results.extend(retry_raw)
        filtered, decisions = apply_all_filters(
            all_raw_results,
            score_threshold=score_threshold,
            date_threshold_days=date_threshold_days,
            domain_blacklist=domain_blacklist,
        )

        await _emit(ToolStep(
            name=f"search_retry_{retries_used}", status="complete",
            data={
                "queries": coverage.missing,
                "new_results_count": len(retry_results),
                "total_filtered": len(filtered),
            },
            duration_ms=int((time.monotonic() - retry_step_start) * 1000),
        ))

    # ------------------------------------------------------------------
    # Build final result
    # ------------------------------------------------------------------
    tool_result_content = WebSearchToolResult(
        results=filtered,
        total_results_before_filter=len(all_raw_results),
        total_results_after_filter=len(filtered),
        search_rounds=search_rounds,
        gaps=remaining_gaps,
    )

    return ToolResult(
        content=tool_result_content.model_dump(),
        trace=trace,
    )


# ======================================================================
# Internal helpers
# ======================================================================

async def _step_generate_queries(
    reason: str, query: str, context: ToolContext,
) -> QueryGenerationOutput:
    """Step 1: Use lightweight LLM to generate optimized search queries."""
    prompt = f"""You are a search query optimizer. Given the user's question and search intent, generate optimized search queries.

User's original message: {context.user_message}
Search reason: {reason}
Information need: {query}

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "ready_queries": ["query1", "query2"],
  "pending_queries": ["query with {{{{entity_name}}}} placeholder"]
}}

Rules:
- ready_queries: 1-3 queries that can be executed immediately
- pending_queries: 0-2 template queries with {{{{slot}}}} placeholders for entities not yet known (e.g. a person's full name when only a partial reference is given)
- Keep queries concise and search-engine-optimized
- If no pending queries are needed, return an empty array"""

    response = await context.llm_complete(
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    data = json.loads(response)
    return QueryGenerationOutput(**data)


async def _step_extract_entities(
    pending_queries: list[str],
    results: list[TavilySearchResult],
    context: ToolContext,
) -> EntityExtractionOutput:
    """Step 2 sub-step: Extract entities from search results to fill templates."""
    # Identify the slot names from pending queries
    import re
    slots: set[str] = set()
    for q in pending_queries:
        slots.update(re.findall(r"\{\{(\w+)\}\}", q))

    if not slots:
        return EntityExtractionOutput(entities={})

    snippets = "\n\n".join(
        f"[{r.title}] {r.content}" for r in results[:10]  # limit to top 10
    )

    prompt = f"""Extract the following entities from the search results below.

Entities needed: {', '.join(sorted(slots))}

Search results:
{snippets}

Respond with ONLY a JSON object mapping each entity name to its extracted value.
Example: {{"entity_name": "extracted value"}}
If an entity cannot be found, omit it from the response."""

    response = await context.llm_complete(
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    data = json.loads(response)
    return EntityExtractionOutput(entities=data)


async def _step_coverage_check(
    original_query: str,
    filtered_results: list[FilteredResult],
    context: ToolContext,
) -> CoverageCheckOutput:
    """Step 5: Use lightweight LLM to assess if results are sufficient."""
    if not filtered_results:
        return CoverageCheckOutput(sufficient=False, missing=[original_query], confidence=0.0)

    snippets = "\n\n".join(
        f"[{r.title}] ({r.url})\n{r.content}" for r in filtered_results[:15]
    )

    prompt = f"""You are evaluating whether search results are sufficient to answer a user's question.

User's question: {original_query}

Search results:
{snippets}

Respond with ONLY a JSON object (no markdown, no explanation):
{{
  "sufficient": true/false,
  "missing": ["specific topic or fact still needed", ...],
  "confidence": 0.0 to 1.0
}}

Rules:
- sufficient: true if the results contain enough information to comprehensively answer the question
- missing: list specific gaps (these will become new search queries). Empty array if sufficient is true.
- confidence: your confidence that the results cover the question (0.0 = no coverage, 1.0 = complete)"""

    response = await context.llm_complete(
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )

    data = json.loads(response)
    return CoverageCheckOutput(**data)


async def _execute_queries(
    queries: list[str], tavily_client: TavilyClient,
) -> list[TavilySearchResult]:
    """Execute a batch of queries against Tavily, collecting all results.

    Individual query failures are logged and skipped (not fatal to the harness).
    """
    all_results: list[TavilySearchResult] = []
    for q in queries:
        try:
            raw = await tavily_client.search(q)
            for r in raw:
                all_results.append(TavilySearchResult(
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("content", ""),
                    score=r.get("score", 0.0),
                    published_date=r.get("published_date"),
                    raw_content=r.get("raw_content"),
                ))
        except TavilyError as e:
            logger.error("Tavily search failed for query %r: %s", q, e)
            # Non-fatal: continue with other queries
    return all_results


def _fill_templates(templates: list[str], entities: dict[str, str]) -> list[str]:
    """Replace {{slot}} placeholders in template queries with entity values."""
    filled: list[str] = []
    for template in templates:
        q = template
        for slot, value in entities.items():
            q = q.replace(f"{{{{{slot}}}}}", value)
        # Only add if all slots were filled (no remaining {{ }})
        if "{{" not in q:
            filled.append(q)
        else:
            logger.warning("Template %r still has unfilled slots after entity substitution", q)
    return filled


def _result_summary(r: TavilySearchResult) -> dict[str, Any]:
    """Create a cleaned summary of a result for trace output (spec §5.5)."""
    return {
        "title": r.title,
        "url": r.url,
        "snippet": r.content[:300] if r.content else "",
        "score": r.score,
    }
```

---

## Step 7: Web Search Tool Registration — `src/backend/tools/web_search/tool.py`

The `WebSearchTool` class that registers with the framework and delegates to the harness.

**File:** `src/backend/tools/web_search/tool.py`

```python
"""WebSearchTool — registers with the tool framework and delegates to the harness."""

from __future__ import annotations

import logging
from typing import Any

from src.backend.tools.base import Tool, ToolContext, ToolResult, ToolStep
from src.backend.tools.web_search.harness import run_harness
from src.backend.tools.web_search.tavily_client import TavilyClient

logger = logging.getLogger(__name__)


class WebSearchTool(Tool):
    """Web search tool using the deterministic research harness.

    Schema matches spec §5.3:
    - reason: Brief explanation of why web search is needed
    - query: The information need described clearly for the search system
    """

    name = "web_search"
    description = (
        "Search the web for current or factual information needed to answer "
        "the user's question. Use this when the question requires up-to-date "
        "information, specific facts, or knowledge you may not have."
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
                "description": (
                    "The information need described clearly for the search system"
                ),
            },
        },
        "required": ["reason", "query"],
    }

    def __init__(
        self,
        *,
        tavily_api_key: str,
        score_threshold: float = 0.75,
        date_threshold_days: int = 365,
        domain_blacklist: list[str] | None = None,
    ) -> None:
        self._tavily_client = TavilyClient(api_key=tavily_api_key)
        self._score_threshold = score_threshold
        self._date_threshold_days = date_threshold_days
        self._domain_blacklist = domain_blacklist or []

    async def execute(
        self,
        arguments: dict[str, Any],
        context: ToolContext,
        on_step: Any = None,
    ) -> ToolResult:
        """Execute the web search harness pipeline.

        Args:
            arguments: Must contain "reason" and "query" keys.
            context: Tool execution context.
            on_step: Async callback for step progress.

        Returns:
            ToolResult with WebSearchToolResult content and full trace.
        """
        reason = arguments.get("reason", "")
        query = arguments.get("query", "")

        if not query:
            return ToolResult(
                content="Error: 'query' argument is required for web_search.",
                trace=[],
            )

        logger.info("WebSearchTool invoked: reason=%r, query=%r", reason, query)

        return await run_harness(
            reason=reason,
            query=query,
            context=context,
            tavily_client=self._tavily_client,
            score_threshold=self._score_threshold,
            date_threshold_days=self._date_threshold_days,
            domain_blacklist=self._domain_blacklist,
            on_step=on_step,
        )

    async def close(self) -> None:
        """Clean up the Tavily HTTP client."""
        await self._tavily_client.close()
```

---

## Step 8: Package Init Files

**File:** `src/backend/tools/__init__.py`

```python
"""Wayne tool framework."""
```

**File:** `src/backend/tools/web_search/__init__.py`

```python
"""Wayne web search tool."""
```

---

## Step 9: Wire Into Application — `src/backend/main.py` (additions)

At application startup, the tool framework is instantiated, the web search tool is registered, and the framework is made available to the chat service.

**Additions to `main.py` lifespan (pseudocode showing the relevant section only):**

```python
from src.backend.config import get_settings
from src.backend.tools.framework import ToolFramework
from src.backend.tools.web_search.tool import WebSearchTool


async def lifespan(app: FastAPI):
    settings = get_settings()

    # --- Tool framework setup ---
    tool_framework = ToolFramework()

    if settings.tavily_api_key:
        web_search_tool = WebSearchTool(
            tavily_api_key=settings.tavily_api_key,
            score_threshold=settings.tavily_score_threshold,
            date_threshold_days=settings.tavily_date_threshold_days,
            domain_blacklist=settings.tavily_domain_blacklist,
        )
        tool_framework.register(web_search_tool)

    app.state.tool_framework = tool_framework

    yield

    # Cleanup
    if settings.tavily_api_key and hasattr(app.state, "tool_framework"):
        for name in tool_framework.registered_tool_names:
            tool = tool_framework._tools.get(name)
            if hasattr(tool, "close"):
                await tool.close()
```

**How ChatService uses the framework (relevant excerpt):**

```python
# In services/chat.py — handle_user_message() tool call branch

# 1. Include tools in the LLM request (if model supports them)
tools = None
if tool_framework.supports_tools(model_id):
    tools = tool_framework.get_schemas_for_provider(provider)

# 2. When the LLM returns a tool_call StreamEvent:
async def handle_tool_call(tool_call_data):
    context = ToolContext(
        user_message=user_message,
        conversation_id=str(conversation_id),
        lightweight_model=settings.lightweight_model,
        llm_complete=lightweight_complete,  # bound async function
    )

    result = await tool_framework.execute_tool_call(
        tool_name=tool_call_data.name,
        arguments=tool_call_data.arguments,
        context=context,
        on_step=ws_step_callback,  # streams ToolSteps to WebSocket
    )

    # 3. Return result to the LLM as a tool_result message
    # ... (persist and send back for synthesis)
```

---

## Step 10: Test Plan

### 10.1 Unit Tests — Tool Framework

**File:** `tests/unit/test_tool_framework.py`

```python
"""Unit tests for the tool framework: registration, schema normalization, routing."""

from __future__ import annotations

import pytest

from src.backend.tools.base import Tool, ToolContext, ToolResult, ToolStep
from src.backend.tools.framework import ToolFramework


class FakeTool(Tool):
    """A minimal tool for testing."""

    name = "fake_tool"
    description = "A fake tool for testing"
    parameters = {
        "type": "object",
        "properties": {
            "input": {"type": "string", "description": "Test input"},
        },
        "required": ["input"],
    }

    async def execute(self, arguments, context, on_step=None):
        if on_step:
            await on_step(ToolStep(name="fake_step", status="complete", data={"echo": arguments["input"]}))
        return ToolResult(content={"echo": arguments["input"]}, trace=[])


class FailingTool(Tool):
    """A tool that always raises."""

    name = "failing_tool"
    description = "Always fails"
    parameters = {"type": "object", "properties": {}}

    async def execute(self, arguments, context, on_step=None):
        raise RuntimeError("Intentional failure")


@pytest.fixture
def framework() -> ToolFramework:
    fw = ToolFramework()
    fw.register(FakeTool())
    return fw


# --- Registration ---

class TestRegistration:
    def test_register_tool(self, framework: ToolFramework):
        assert "fake_tool" in framework.registered_tool_names

    def test_duplicate_registration_raises(self, framework: ToolFramework):
        with pytest.raises(ValueError, match="already registered"):
            framework.register(FakeTool())

    def test_register_multiple_tools(self):
        fw = ToolFramework()
        fw.register(FakeTool())
        fw.register(FailingTool())
        assert sorted(fw.registered_tool_names) == ["failing_tool", "fake_tool"]


# --- Schema normalization ---

class TestSchemaNormalization:
    def test_openai_schema_format(self, framework: ToolFramework):
        schemas = framework.get_schemas_for_provider("openai")
        assert len(schemas) == 1
        s = schemas[0]
        assert s["type"] == "function"
        assert s["function"]["name"] == "fake_tool"
        assert s["function"]["description"] == "A fake tool for testing"
        assert s["function"]["parameters"]["type"] == "object"
        assert "input" in s["function"]["parameters"]["properties"]

    def test_anthropic_schema_format(self, framework: ToolFramework):
        schemas = framework.get_schemas_for_provider("anthropic")
        assert len(schemas) == 1
        s = schemas[0]
        # Anthropic format: top-level name, description, input_schema
        assert "type" not in s  # No wrapping "type": "function"
        assert s["name"] == "fake_tool"
        assert s["description"] == "A fake tool for testing"
        assert s["input_schema"]["type"] == "object"
        assert "input" in s["input_schema"]["properties"]

    def test_openrouter_uses_openai_format(self, framework: ToolFramework):
        openai_schemas = framework.get_schemas_for_provider("openai")
        openrouter_schemas = framework.get_schemas_for_provider("openrouter")
        assert openai_schemas == openrouter_schemas

    def test_empty_framework_returns_empty_schemas(self):
        fw = ToolFramework()
        assert fw.get_schemas_for_provider("openai") == []


# --- Execution ---

class TestExecution:
    @pytest.fixture
    def context(self) -> ToolContext:
        return ToolContext(
            user_message="test message",
            conversation_id="test-conv-id",
            lightweight_model="gpt-5-nano",
        )

    async def test_execute_returns_result(self, framework, context):
        result = await framework.execute_tool_call(
            "fake_tool", {"input": "hello"}, context,
        )
        assert result.content == {"echo": "hello"}

    async def test_execute_unknown_tool_raises(self, framework, context):
        with pytest.raises(KeyError, match="Unknown tool"):
            await framework.execute_tool_call("nonexistent", {}, context)

    async def test_execute_with_on_step_callback(self, framework, context):
        steps_received: list[ToolStep] = []

        async def on_step(step: ToolStep):
            steps_received.append(step)

        await framework.execute_tool_call(
            "fake_tool", {"input": "hello"}, context, on_step=on_step,
        )
        assert len(steps_received) == 1
        assert steps_received[0].name == "fake_step"

    async def test_execute_failing_tool_returns_error_result(self, context):
        fw = ToolFramework()
        fw.register(FailingTool())

        result = await fw.execute_tool_call("failing_tool", {}, context)
        assert "failed" in result.content
        assert result.trace[0].status == "error"

    async def test_execute_failing_tool_fires_on_step(self, context):
        fw = ToolFramework()
        fw.register(FailingTool())
        steps: list[ToolStep] = []

        async def on_step(step: ToolStep):
            steps.append(step)

        await fw.execute_tool_call("failing_tool", {}, context, on_step=on_step)
        assert any(s.status == "error" for s in steps)


# --- supports_tools ---

class TestSupportsTools:
    def test_standard_models_support_tools(self, framework):
        assert framework.supports_tools("gpt-5") is True
        assert framework.supports_tools("gpt-5-nano") is True
        assert framework.supports_tools("claude-sonnet-4-6-20250514") is True
        assert framework.supports_tools("deepseek/deepseek-v3.2") is True

    def test_deepseek_r1_does_not_support_tools(self, framework):
        assert framework.supports_tools("deepseek/deepseek-r1") is False
```

### 10.2 Unit Tests — Deterministic Filters

**File:** `tests/unit/test_search_filters.py`

```python
"""Unit tests for the deterministic search result filters."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.backend.schemas.tools import TavilySearchResult
from src.backend.tools.web_search.filters import apply_all_filters


def _make_result(
    *,
    url: str = "https://example.com/page",
    title: str = "Example",
    content: str = "Some content",
    score: float = 0.9,
    published_date: str | None = None,
) -> TavilySearchResult:
    return TavilySearchResult(
        title=title, url=url, content=content,
        score=score, published_date=published_date,
    )


class TestScoreFilter:
    def test_above_threshold_kept(self):
        results = [_make_result(score=0.80)]
        kept, decisions = apply_all_filters(results, score_threshold=0.75)
        assert len(kept) == 1
        assert decisions[0].kept is True

    def test_below_threshold_discarded(self):
        results = [_make_result(score=0.50)]
        kept, decisions = apply_all_filters(results, score_threshold=0.75)
        assert len(kept) == 0
        assert decisions[0].kept is False
        assert "score_below_threshold" in decisions[0].reason

    def test_exactly_at_threshold_discarded(self):
        """Score must be >= threshold; exactly equal is kept (not strictly less)."""
        results = [_make_result(score=0.75)]
        kept, _ = apply_all_filters(results, score_threshold=0.75)
        assert len(kept) == 1


class TestDateFilter:
    def test_recent_date_kept(self):
        recent = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        results = [_make_result(published_date=recent)]
        kept, _ = apply_all_filters(results, date_threshold_days=365)
        assert len(kept) == 1

    def test_old_date_discarded(self):
        old = (datetime.now(timezone.utc) - timedelta(days=400)).strftime("%Y-%m-%d")
        results = [_make_result(published_date=old)]
        kept, decisions = apply_all_filters(results, date_threshold_days=365)
        assert len(kept) == 0
        assert "older_than" in decisions[0].reason

    def test_no_date_kept(self):
        """Results without a published_date are kept (fail-open)."""
        results = [_make_result(published_date=None)]
        kept, _ = apply_all_filters(results)
        assert len(kept) == 1

    def test_unparseable_date_kept(self):
        """Results with unparseable dates are kept (fail-open)."""
        results = [_make_result(published_date="not-a-date")]
        kept, _ = apply_all_filters(results)
        assert len(kept) == 1


class TestDomainFilter:
    def test_blacklisted_domain_discarded(self):
        results = [_make_result(url="https://spam.com/page")]
        kept, decisions = apply_all_filters(results, domain_blacklist=["spam.com"])
        assert len(kept) == 0
        assert decisions[0].reason == "domain_blacklisted"

    def test_subdomain_of_blacklisted_discarded(self):
        results = [_make_result(url="https://www.spam.com/page")]
        kept, _ = apply_all_filters(results, domain_blacklist=["spam.com"])
        assert len(kept) == 0

    def test_non_blacklisted_kept(self):
        results = [_make_result(url="https://good.com/page")]
        kept, _ = apply_all_filters(results, domain_blacklist=["spam.com"])
        assert len(kept) == 1

    def test_blacklist_case_insensitive(self):
        results = [_make_result(url="https://SPAM.COM/page")]
        kept, _ = apply_all_filters(results, domain_blacklist=["spam.com"])
        assert len(kept) == 0


class TestDedup:
    def test_duplicate_urls_deduped(self):
        results = [
            _make_result(url="https://example.com/page", score=0.9),
            _make_result(url="https://example.com/page", score=0.8),
        ]
        kept, decisions = apply_all_filters(results)
        assert len(kept) == 1
        # Second one should be marked as duplicate
        dup_decisions = [d for d in decisions if d.reason == "duplicate"]
        assert len(dup_decisions) == 1

    def test_trailing_slash_normalized(self):
        results = [
            _make_result(url="https://example.com/page"),
            _make_result(url="https://example.com/page/"),
        ]
        kept, _ = apply_all_filters(results)
        assert len(kept) == 1

    def test_case_insensitive_dedup(self):
        results = [
            _make_result(url="https://Example.com/Page"),
            _make_result(url="https://example.com/page"),
        ]
        kept, _ = apply_all_filters(results)
        assert len(kept) == 1


class TestCombinedFilters:
    def test_multiple_filters_applied_in_order(self):
        results = [
            _make_result(url="https://good.com/1", score=0.9),       # kept
            _make_result(url="https://good.com/2", score=0.5),       # score
            _make_result(url="https://spam.com/3", score=0.9),       # domain
            _make_result(url="https://good.com/1", score=0.95),      # dedup
        ]
        kept, decisions = apply_all_filters(
            results, score_threshold=0.75, domain_blacklist=["spam.com"],
        )
        assert len(kept) == 1
        assert kept[0].url == "https://good.com/1"

    def test_empty_input(self):
        kept, decisions = apply_all_filters([])
        assert kept == []
        assert decisions == []
```

### 10.3 Integration Test — Full Harness with Mocked Tavily and LLM

**File:** `tests/integration/test_web_search_harness.py`

```python
"""Integration tests for the web search harness with mocked Tavily + LLM."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from src.backend.schemas.tools import TavilySearchResult
from src.backend.tools.base import ToolContext, ToolStep
from src.backend.tools.web_search.harness import run_harness
from src.backend.tools.web_search.tavily_client import TavilyClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_tavily_results() -> list[dict[str, Any]]:
    """Standard mock Tavily API response."""
    return [
        {
            "title": "Best JS Frameworks 2026",
            "url": "https://dev.to/frameworks-2026",
            "content": "React, Vue, and Svelte remain the top JavaScript frameworks in 2026...",
            "score": 0.92,
            "published_date": "2026-02-15",
        },
        {
            "title": "JavaScript State of 2026",
            "url": "https://stateofjs.com/2026",
            "content": "Annual survey results show React maintaining dominance...",
            "score": 0.88,
            "published_date": "2026-01-20",
        },
        {
            "title": "Old Irrelevant Page",
            "url": "https://old.site/page",
            "content": "jQuery is the best...",
            "score": 0.40,
            "published_date": "2020-01-01",
        },
    ]


@pytest.fixture
def mock_llm_complete():
    """Mock lightweight LLM that returns appropriate JSON for each harness step."""
    call_count = 0

    async def _complete(messages: list[dict], response_format: dict | None = None) -> str:
        nonlocal call_count
        call_count += 1
        content = messages[-1]["content"] if messages else ""

        # Step 1: query generation
        if "search query optimizer" in content.lower():
            return json.dumps({
                "ready_queries": [
                    "best javascript frameworks 2026",
                    "top JS frameworks comparison 2026",
                ],
                "pending_queries": [],
            })

        # Step 5: coverage check
        if "evaluating whether search results" in content.lower():
            return json.dumps({
                "sufficient": True,
                "missing": [],
                "confidence": 0.9,
            })

        return json.dumps({"error": "unexpected prompt"})

    return _complete


@pytest.fixture
def context(mock_llm_complete) -> ToolContext:
    return ToolContext(
        user_message="What are the best JS frameworks in 2026?",
        conversation_id="test-conv-123",
        lightweight_model="gpt-5-nano",
        llm_complete=mock_llm_complete,
    )


@pytest.fixture
def mock_tavily_client(mock_tavily_results) -> TavilyClient:
    client = TavilyClient(api_key="test-key")
    client.search = AsyncMock(return_value=mock_tavily_results)
    return client


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestHarnessFullPipeline:
    async def test_successful_search_returns_filtered_results(
        self, context, mock_tavily_client,
    ):
        result = await run_harness(
            reason="Need current framework recommendations",
            query="Best JavaScript frameworks in 2026",
            context=context,
            tavily_client=mock_tavily_client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        # Should have content as a dict (WebSearchToolResult)
        assert isinstance(result.content, dict)
        assert result.content["total_results_after_filter"] == 2  # old/low-score one filtered
        assert result.content["search_rounds"] >= 1

        # Trace should have steps
        completed_steps = [s for s in result.trace if s.status == "complete"]
        step_names = [s.name for s in completed_steps]
        assert "query_generation" in step_names
        assert "search_round_1" in step_names
        assert "filtering" in step_names
        assert "coverage_check" in step_names

    async def test_on_step_callback_fires_for_all_steps(
        self, context, mock_tavily_client,
    ):
        steps_received: list[ToolStep] = []

        async def on_step(step: ToolStep):
            steps_received.append(step)

        await run_harness(
            reason="test",
            query="test query",
            context=context,
            tavily_client=mock_tavily_client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
            on_step=on_step,
        )

        # Should receive both "running" and "complete" for each step
        running_steps = [s for s in steps_received if s.status == "running"]
        complete_steps = [s for s in steps_received if s.status == "complete"]
        assert len(running_steps) >= 3  # query_gen, search, filter, coverage
        assert len(complete_steps) >= 3

    async def test_filtering_removes_low_score_results(
        self, context, mock_tavily_client,
    ):
        result = await run_harness(
            reason="test",
            query="test",
            context=context,
            tavily_client=mock_tavily_client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        content = result.content
        assert content["total_results_before_filter"] > content["total_results_after_filter"]

        # The low-score "Old Irrelevant Page" should be gone
        result_urls = [r["url"] for r in content["results"]]
        assert "https://old.site/page" not in result_urls


class TestHarnessCoverageRetry:
    async def test_coverage_retry_triggers_additional_search(self, mock_tavily_client):
        """When coverage check says insufficient, harness retries."""
        call_count = 0

        async def llm_with_retry(messages, response_format=None):
            nonlocal call_count
            call_count += 1
            content = messages[-1]["content"]

            if "search query optimizer" in content.lower():
                return json.dumps({
                    "ready_queries": ["initial query"],
                    "pending_queries": [],
                })

            if "evaluating whether search results" in content.lower():
                # First coverage check: insufficient
                if call_count <= 2:
                    return json.dumps({
                        "sufficient": False,
                        "missing": ["performance benchmarks 2026"],
                        "confidence": 0.4,
                    })
                # Second coverage check: sufficient
                return json.dumps({
                    "sufficient": True,
                    "missing": [],
                    "confidence": 0.85,
                })

            return json.dumps({})

        ctx = ToolContext(
            user_message="Compare JS framework performance",
            conversation_id="retry-test",
            lightweight_model="gpt-5-nano",
            llm_complete=llm_with_retry,
        )

        result = await run_harness(
            reason="test",
            query="JS framework performance comparison",
            context=ctx,
            tavily_client=mock_tavily_client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        assert result.content["search_rounds"] >= 2
        step_names = [s.name for s in result.trace if s.status == "complete"]
        assert any("retry" in name for name in step_names)

    async def test_coverage_retry_caps_at_max(self, mock_tavily_client):
        """Harness stops retrying after MAX_COVERAGE_RETRIES."""
        async def always_insufficient(messages, response_format=None):
            content = messages[-1]["content"]

            if "search query optimizer" in content.lower():
                return json.dumps({
                    "ready_queries": ["query"],
                    "pending_queries": [],
                })

            if "evaluating whether search results" in content.lower():
                return json.dumps({
                    "sufficient": False,
                    "missing": ["something still missing"],
                    "confidence": 0.3,
                })

            return json.dumps({})

        ctx = ToolContext(
            user_message="test",
            conversation_id="cap-test",
            lightweight_model="gpt-5-nano",
            llm_complete=always_insufficient,
        )

        result = await run_harness(
            reason="test",
            query="test",
            context=ctx,
            tavily_client=mock_tavily_client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        # Should have gaps noted
        assert len(result.content["gaps"]) > 0
        # Should not exceed 3 total search rounds (initial + 2 retries)
        assert result.content["search_rounds"] <= 3


class TestHarnessErrorHandling:
    async def test_tavily_failure_returns_partial_result(self, context):
        """If Tavily fails for all queries, harness returns empty results gracefully."""
        from src.backend.tools.web_search.tavily_client import TavilyError

        failing_client = TavilyClient(api_key="bad-key")
        failing_client.search = AsyncMock(side_effect=TavilyError("API error"))

        result = await run_harness(
            reason="test",
            query="test",
            context=context,
            tavily_client=failing_client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        # Should still return a result (not crash)
        assert isinstance(result.content, dict)
        assert result.content["total_results_after_filter"] == 0

    async def test_query_generation_failure_returns_error(self):
        """If the lightweight LLM fails at step 1, harness returns error."""
        async def failing_llm(messages, response_format=None):
            raise RuntimeError("LLM unavailable")

        ctx = ToolContext(
            user_message="test",
            conversation_id="fail-test",
            lightweight_model="gpt-5-nano",
            llm_complete=failing_llm,
        )

        client = TavilyClient(api_key="test")
        client.search = AsyncMock(return_value=[])

        result = await run_harness(
            reason="test",
            query="test",
            context=ctx,
            tavily_client=client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        assert "failed" in result.content.lower()
        assert any(s.status == "error" for s in result.trace)


class TestHarnessWithTemplateQueries:
    async def test_pending_queries_filled_and_executed(self):
        """Step 3: pending queries get entity-filled and searched."""
        call_count = 0

        async def llm_with_entities(messages, response_format=None):
            nonlocal call_count
            call_count += 1
            content = messages[-1]["content"]

            if "search query optimizer" in content.lower():
                return json.dumps({
                    "ready_queries": ["who is the CEO of OpenAI"],
                    "pending_queries": ["{{ceo_name}} biography and career"],
                })

            if "extract the following entities" in content.lower():
                return json.dumps({"ceo_name": "Sam Altman"})

            if "evaluating whether search results" in content.lower():
                return json.dumps({
                    "sufficient": True,
                    "missing": [],
                    "confidence": 0.9,
                })

            return json.dumps({})

        ctx = ToolContext(
            user_message="Tell me about the CEO of OpenAI",
            conversation_id="template-test",
            lightweight_model="gpt-5-nano",
            llm_complete=llm_with_entities,
        )

        mock_results = [
            {
                "title": "OpenAI Leadership",
                "url": "https://openai.com/about",
                "content": "Sam Altman is the CEO of OpenAI...",
                "score": 0.95,
            },
        ]

        client = TavilyClient(api_key="test")
        client.search = AsyncMock(return_value=mock_results)

        result = await run_harness(
            reason="test",
            query="CEO of OpenAI",
            context=ctx,
            tavily_client=client,
            score_threshold=0.75,
            date_threshold_days=365,
            domain_blacklist=[],
        )

        step_names = [s.name for s in result.trace if s.status == "complete"]
        assert "search_round_2" in step_names
        assert result.content["search_rounds"] == 2

        # Verify the template was filled correctly
        round_2_step = next(s for s in result.trace if s.name == "search_round_2" and s.status == "complete")
        assert "Sam Altman biography and career" in round_2_step.data["filled_queries"]
```

---

## Execution Checklist

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 1 | Create Pydantic schemas | `schemas/tools.py` | — |
| 2 | Create tool base classes | `tools/base.py` | — |
| 3 | Create tool framework | `tools/framework.py` | Step 2 |
| 4 | Create Tavily client | `tools/web_search/tavily_client.py` | — |
| 5 | Create deterministic filters | `tools/web_search/filters.py` | Step 1 |
| 6 | Create harness pipeline | `tools/web_search/harness.py` | Steps 1, 2, 4, 5 |
| 7 | Create WebSearchTool | `tools/web_search/tool.py` | Steps 2, 4, 6 |
| 8 | Create `__init__.py` files | `tools/__init__.py`, `tools/web_search/__init__.py` | — |
| 9 | Wire into `main.py` lifespan | `main.py` (additions) | Step 7 |
| 10 | Write and run unit tests (framework) | `tests/unit/test_tool_framework.py` | Step 3 |
| 11 | Write and run unit tests (filters) | `tests/unit/test_search_filters.py` | Step 5 |
| 12 | Write and run integration tests (harness) | `tests/integration/test_web_search_harness.py` | Steps 6, 7 |

Steps 1-2-4 can be done in parallel. Step 3 needs Step 2. Step 5 needs Step 1. Step 6 needs 1+2+4+5. Step 7 needs 2+4+6. Tests (10-12) run after their dependencies.
