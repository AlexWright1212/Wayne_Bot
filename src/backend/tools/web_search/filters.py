"""Deterministic result filtering for the search harness (Step 4)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from src.backend.config import Settings
from src.backend.tools.web_search.tavily_client import TavilyResult


class FilterReason(str, Enum):
    low_score = "low_score"
    too_old = "too_old"
    blacklisted = "blacklisted"
    duplicate = "duplicate"


@dataclass
class FilteredOut:
    result: TavilyResult
    reason: FilterReason


def filter_results(
    results: list[TavilyResult],
    settings: Settings,
) -> tuple[list[TavilyResult], list[FilteredOut]]:
    """Apply four deterministic filter rules in order.

    Rules:
    1. Score below threshold
    2. Published date older than threshold_days (skip if no date)
    3. Domain in blacklist
    4. Duplicate URL (keep first)

    Returns (kept, filtered_out).
    """
    kept: list[TavilyResult] = []
    filtered_out: list[FilteredOut] = []
    seen_urls: set[str] = set()
    cutoff = datetime.now(tz=timezone.utc) - timedelta(days=settings.tavily_date_threshold_days)

    for result in results:
        # Rule 1: score threshold
        if result.score < settings.tavily_score_threshold:
            filtered_out.append(FilteredOut(result=result, reason=FilterReason.low_score))
            continue

        # Rule 2: date threshold (skip if no date)
        if result.published_date is not None:
            try:
                pub_dt = datetime.fromisoformat(result.published_date.rstrip("Z"))
                if pub_dt.tzinfo is None:
                    pub_dt = pub_dt.replace(tzinfo=timezone.utc)
                if pub_dt < cutoff:
                    filtered_out.append(FilteredOut(result=result, reason=FilterReason.too_old))
                    continue
            except (ValueError, AttributeError):
                pass  # Unparseable date — let it through

        # Rule 3: domain blacklist
        domain = _extract_domain(result.url)
        if domain in settings.tavily_domain_blacklist:
            filtered_out.append(FilteredOut(result=result, reason=FilterReason.blacklisted))
            continue

        # Rule 4: duplicate URL
        if result.url in seen_urls:
            filtered_out.append(FilteredOut(result=result, reason=FilterReason.duplicate))
            continue

        seen_urls.add(result.url)
        kept.append(result)

    return kept, filtered_out


def _extract_domain(url: str) -> str:
    """Extract hostname from a URL for blacklist matching."""
    try:
        # Simple extraction without urllib to keep it dependency-free
        stripped = url.split("://", 1)[-1]
        return stripped.split("/")[0].split(":")[0].lower()
    except Exception:
        return url
