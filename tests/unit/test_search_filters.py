"""Unit tests for deterministic search result filtering.

Pure logic tests — no IO, no mocking needed.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from src.backend.tools.web_search.filters import FilterReason, filter_results
from src.backend.tools.web_search.tavily_client import TavilyResult


def _make_settings(
    score_threshold: float = 0.75,
    date_threshold_days: int = 365,
    domain_blacklist: list[str] | None = None,
) -> MagicMock:
    s = MagicMock()
    s.tavily_score_threshold = score_threshold
    s.tavily_date_threshold_days = date_threshold_days
    s.tavily_domain_blacklist = domain_blacklist or []
    return s


def _result(
    url: str = "https://example.com/a",
    score: float = 0.9,
    published_date: str | None = None,
    title: str = "Title",
    content: str = "Content",
) -> TavilyResult:
    return TavilyResult(title=title, url=url, content=content, score=score, published_date=published_date)


def _recent() -> str:
    return (datetime.now(tz=timezone.utc) - timedelta(days=10)).isoformat()


def _old() -> str:
    return (datetime.now(tz=timezone.utc) - timedelta(days=500)).isoformat()


# ---------------------------------------------------------------------------
# Empty input
# ---------------------------------------------------------------------------

def test_empty_input():
    kept, removed = filter_results([], _make_settings())
    assert kept == []
    assert removed == []


# ---------------------------------------------------------------------------
# Score filtering
# ---------------------------------------------------------------------------

def test_score_below_threshold_filtered():
    results = [_result(score=0.5)]
    kept, removed = filter_results(results, _make_settings(score_threshold=0.75))
    assert kept == []
    assert len(removed) == 1
    assert removed[0].reason == FilterReason.low_score


def test_score_at_threshold_passes():
    results = [_result(score=0.75)]
    kept, removed = filter_results(results, _make_settings(score_threshold=0.75))
    assert len(kept) == 1
    assert removed == []


def test_score_above_threshold_passes():
    results = [_result(score=0.95)]
    kept, removed = filter_results(results, _make_settings(score_threshold=0.75))
    assert len(kept) == 1


# ---------------------------------------------------------------------------
# Date filtering
# ---------------------------------------------------------------------------

def test_old_date_filtered():
    results = [_result(published_date=_old())]
    kept, removed = filter_results(results, _make_settings(date_threshold_days=365))
    assert kept == []
    assert removed[0].reason == FilterReason.too_old


def test_recent_date_passes():
    results = [_result(published_date=_recent())]
    kept, removed = filter_results(results, _make_settings(date_threshold_days=365))
    assert len(kept) == 1


def test_no_date_passes_through():
    """Results without a date should not be filtered."""
    results = [_result(published_date=None)]
    kept, removed = filter_results(results, _make_settings())
    assert len(kept) == 1
    assert removed == []


def test_unparseable_date_passes_through():
    results = [_result(published_date="not-a-date")]
    kept, removed = filter_results(results, _make_settings())
    assert len(kept) == 1


# ---------------------------------------------------------------------------
# Blacklist filtering
# ---------------------------------------------------------------------------

def test_blacklisted_domain_filtered():
    results = [_result(url="https://spam.com/article")]
    kept, removed = filter_results(results, _make_settings(domain_blacklist=["spam.com"]))
    assert kept == []
    assert removed[0].reason == FilterReason.blacklisted


def test_non_blacklisted_domain_passes():
    results = [_result(url="https://good.com/article")]
    kept, removed = filter_results(results, _make_settings(domain_blacklist=["spam.com"]))
    assert len(kept) == 1


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def test_duplicate_url_filtered_second_occurrence():
    r1 = _result(url="https://example.com/a", title="First")
    r2 = _result(url="https://example.com/a", title="Second")
    kept, removed = filter_results([r1, r2], _make_settings())
    assert len(kept) == 1
    assert kept[0].title == "First"
    assert removed[0].reason == FilterReason.duplicate


def test_different_urls_both_kept():
    results = [
        _result(url="https://a.com"),
        _result(url="https://b.com"),
    ]
    kept, removed = filter_results(results, _make_settings())
    assert len(kept) == 2
    assert removed == []


# ---------------------------------------------------------------------------
# Combined filters
# ---------------------------------------------------------------------------

def test_rules_applied_in_order():
    """Score check fires before date/blacklist checks."""
    # Low score + old date — should be removed as low_score, not too_old
    results = [_result(score=0.3, published_date=_old())]
    kept, removed = filter_results(results, _make_settings())
    assert removed[0].reason == FilterReason.low_score


def test_all_results_filtered():
    results = [_result(score=0.1), _result(score=0.2)]
    kept, removed = filter_results(results, _make_settings(score_threshold=0.75))
    assert kept == []
    assert len(removed) == 2


def test_mixed_keep_and_remove():
    results = [
        _result(url="https://good.com", score=0.9, published_date=_recent()),
        _result(url="https://bad.com", score=0.5),  # low score
        _result(url="https://old.com", score=0.9, published_date=_old()),  # too old
    ]
    kept, removed = filter_results(results, _make_settings())
    assert len(kept) == 1
    assert kept[0].url == "https://good.com"
    assert len(removed) == 2
