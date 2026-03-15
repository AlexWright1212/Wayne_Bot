"""5-step web search harness orchestrator."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable

from src.backend.config import Settings
from src.backend.providers.base import ChatMessage
from src.backend.tools.base import ToolContext, ToolResult, ToolStep
from src.backend.tools.web_search.filters import filter_results
from src.backend.tools.web_search.tavily_client import TavilyClient, TavilyResult

logger = logging.getLogger(__name__)


class SearchHarness:
    def __init__(self, tavily_client: TavilyClient, settings: Settings) -> None:
        self._tavily = tavily_client
        self._settings = settings

    async def run(
        self,
        reason: str,
        query: str,
        context: ToolContext,
        on_step: Callable[[ToolStep], Awaitable[None]],
    ) -> ToolResult:
        trace: list[ToolStep] = []
        all_results: list[TavilyResult] = []

        # --- Step 1: Query Generation ---
        t0 = time.monotonic()
        await on_step(ToolStep(name="query_generation", status="running", data={}))
        ready_queries, pending_queries = await self._step1_query_gen(reason, query, context)
        step1 = ToolStep(
            name="query_generation",
            status="complete",
            data={"ready_queries": ready_queries, "pending_queries": pending_queries},
            duration_ms=int((time.monotonic() - t0) * 1000),
        )
        trace.append(step1)
        await on_step(step1)

        # --- Step 2: Execute Ready Queries + Entity Extraction ---
        t0 = time.monotonic()
        await on_step(ToolStep(name="execute_queries", status="running", data={}))
        round1_results, entities = await self._step2_execute_and_extract(
            ready_queries, pending_queries, context
        )
        all_results.extend(round1_results)
        step2 = ToolStep(
            name="execute_queries",
            status="complete",
            data={
                "queries": ready_queries,
                "result_count": len(round1_results),
                "entities": entities,
            },
            duration_ms=int((time.monotonic() - t0) * 1000),
        )
        trace.append(step2)
        await on_step(step2)

        # --- Step 3: Fill Templates + Round 2 ---
        if pending_queries and entities:
            t0 = time.monotonic()
            await on_step(ToolStep(name="round2_search", status="running", data={}))
            filled_queries, round2_results = await self._step3_fill_and_search(
                pending_queries, entities
            )
            all_results.extend(round2_results)
            step3 = ToolStep(
                name="round2_search",
                status="complete",
                data={"filled_queries": filled_queries, "result_count": len(round2_results)},
                duration_ms=int((time.monotonic() - t0) * 1000),
            )
            trace.append(step3)
            await on_step(step3)

        # --- Step 4: Deterministic Filter ---
        t0 = time.monotonic()
        await on_step(ToolStep(name="filter_results", status="running", data={}))
        filtered, filtered_out = filter_results(all_results, self._settings)
        step4 = ToolStep(
            name="filter_results",
            status="complete",
            data={
                "kept": len(filtered),
                "removed": len(filtered_out),
                "removed_reasons": [
                    {"url": fo.result.url, "reason": fo.reason.value} for fo in filtered_out
                ],
            },
            duration_ms=int((time.monotonic() - t0) * 1000),
        )
        trace.append(step4)
        await on_step(step4)

        # --- Step 5: Coverage Check + Retry Loop ---
        max_retries = self._settings.search_max_retries
        for retry_num in range(max_retries + 1):
            t0 = time.monotonic()
            step_name = "coverage_check" if retry_num == 0 else f"coverage_retry_{retry_num}"
            await on_step(ToolStep(name=step_name, status="running", data={}))
            sufficient, missing, confidence = await self._step5_coverage_check(
                context.user_message, filtered, context
            )
            step5 = ToolStep(
                name=step_name,
                status="complete",
                data={"sufficient": sufficient, "missing": missing, "confidence": confidence},
                duration_ms=int((time.monotonic() - t0) * 1000),
            )
            trace.append(step5)
            await on_step(step5)

            if sufficient or retry_num >= max_retries:
                break

            # Retry: search for missing items
            logger.info("Coverage insufficient, retrying for: %s", missing)
            retry_queries = missing[:3]  # cap to 3 new queries
            retry_results: list[TavilyResult] = []
            for q in retry_queries:
                try:
                    retry_results.extend(await self._tavily.search(q))
                except Exception as exc:
                    logger.warning("Retry search failed: %s", exc)

            if retry_results:
                new_filtered, new_out = filter_results(retry_results, self._settings)
                filtered = _dedup_by_url(filtered + new_filtered)

        # Assemble result content for the LLM
        content = json.dumps(
            [
                {
                    "title": r.title,
                    "url": r.url,
                    "snippet": r.content,
                    "score": r.score,
                }
                for r in filtered
            ]
        )
        return ToolResult(content=content, trace=trace)

    async def _step1_query_gen(
        self, reason: str, query: str, context: ToolContext
    ) -> tuple[list[str], list[dict]]:
        """Use lightweight LLM to generate ready + pending queries."""
        system = (
            "You generate optimized web search queries based on an information need. "
            "Return JSON with two fields: "
            '"ready_queries" (list of strings, queries to execute immediately) and '
            '"pending_queries" (list of objects with "template" and "slot" fields, '
            'where {{slot}} is a placeholder for an entity to be extracted from initial results). '
            "Keep ready_queries to 1-3 items. Only use pending_queries when the information need "
            "genuinely requires two-step searching."
        )
        prompt = f"Reason: {reason}\nQuery: {query}\nUser message: {context.user_message}"
        messages = [
            ChatMessage(role="system", content=system),
            ChatMessage(role="user", content=prompt),
        ]
        try:
            result = await context.lightweight_complete(
                messages, response_format={"type": "json_object"}
            )
            data = json.loads(result.content)
            ready = data.get("ready_queries", [query])
            pending = data.get("pending_queries", [])
            if not isinstance(ready, list) or not ready:
                ready = [query]
            if not isinstance(pending, list):
                pending = []
            return ready, pending
        except Exception as exc:
            logger.warning("Query generation failed, falling back to raw query: %s", exc)
            return [query], []

    async def _step2_execute_and_extract(
        self,
        ready_queries: list[str],
        pending_queries: list[dict],
        context: ToolContext,
    ) -> tuple[list[TavilyResult], dict[str, str]]:
        """Run ready queries concurrently, then extract entities for pending queries."""
        # Concurrent Tavily calls
        tasks = [self._safe_search(q) for q in ready_queries]
        results_lists = await asyncio.gather(*tasks)
        all_results: list[TavilyResult] = [r for results in results_lists for r in results]

        entities: dict[str, str] = {}
        if not pending_queries or not all_results:
            return all_results, entities

        # Extract entities needed for pending queries
        slots = list({pq["slot"] for pq in pending_queries if "slot" in pq})
        if not slots:
            return all_results, entities

        snippets = "\n".join(
            f"- {r.title}: {r.content[:200]}" for r in all_results[:5]
        )
        system = (
            "Extract specific named entities from search results. "
            f"Return JSON with these exact keys: {slots}. "
            "Each value should be the most relevant entity name found in the results."
        )
        prompt = f"Results:\n{snippets}"
        messages = [
            ChatMessage(role="system", content=system),
            ChatMessage(role="user", content=prompt),
        ]
        try:
            result = await context.lightweight_complete(
                messages, response_format={"type": "json_object"}
            )
            extracted = json.loads(result.content)
            entities = {k: v for k, v in extracted.items() if isinstance(v, str)}
        except Exception as exc:
            logger.warning("Entity extraction failed, skipping pending queries: %s", exc)

        return all_results, entities

    async def _step3_fill_and_search(
        self,
        pending_queries: list[dict],
        entities: dict[str, str],
    ) -> tuple[list[str], list[TavilyResult]]:
        """Fill template slots and execute round 2 searches."""
        filled_queries: list[str] = []
        for pq in pending_queries:
            template = pq.get("template", "")
            slot = pq.get("slot", "")
            value = entities.get(slot, "")
            if value:
                filled = template.replace(f"{{{{{slot}}}}}", value)
                filled_queries.append(filled)

        if not filled_queries:
            return [], []

        tasks = [self._safe_search(q) for q in filled_queries]
        results_lists = await asyncio.gather(*tasks)
        all_results = [r for results in results_lists for r in results]
        return filled_queries, all_results

    async def _step5_coverage_check(
        self,
        user_message: str,
        results: list[TavilyResult],
        context: ToolContext,
    ) -> tuple[bool, list[str], float]:
        """Ask LLM if results are sufficient to answer the user's question."""
        if not results:
            return False, ["No results available"], 0.0

        snippets = "\n".join(
            f"- {r.title}: {r.content[:300]}" for r in results[:8]
        )
        system = (
            "Evaluate if search results contain enough information to answer the user's question. "
            'Return JSON with: "sufficient" (boolean), "missing" (list of strings describing '
            'gaps), "confidence" (float 0-1).'
        )
        prompt = f"Question: {user_message}\n\nResults:\n{snippets}"
        messages = [
            ChatMessage(role="system", content=system),
            ChatMessage(role="user", content=prompt),
        ]
        try:
            result = await context.lightweight_complete(
                messages, response_format={"type": "json_object"}
            )
            data = json.loads(result.content)
            sufficient = bool(data.get("sufficient", True))
            missing = data.get("missing", [])
            confidence = float(data.get("confidence", 1.0))
            if not isinstance(missing, list):
                missing = []
            return sufficient, missing, confidence
        except Exception as exc:
            logger.warning("Coverage check failed, assuming sufficient: %s", exc)
            return True, [], 1.0

    async def _safe_search(self, query: str) -> list[TavilyResult]:
        """Search with per-query error isolation."""
        try:
            return await self._tavily.search(query)
        except Exception as exc:
            logger.warning("Search failed for query '%s': %s", query, exc)
            return []


def _dedup_by_url(results: list[TavilyResult]) -> list[TavilyResult]:
    seen: set[str] = set()
    deduped: list[TavilyResult] = []
    for r in results:
        if r.url not in seen:
            seen.add(r.url)
            deduped.append(r)
    return deduped
