"""Model catalog — static model definitions and OpenRouter dynamic fetch."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


@dataclass
class ModelInfo:
    """Metadata for a single LLM model."""

    id: str
    name: str
    provider: str
    context_window: int
    max_output: int
    supports_tools: bool
    supports_reasoning: bool
    reasoning_type: str | None = None  # "effort", "thinking", "builtin", or None


# ---------------------------------------------------------------------------
# Static models — OpenAI and Anthropic
# ---------------------------------------------------------------------------

_STATIC_MODELS: dict[str, ModelInfo] = {
    # OpenAI GPT-5 family — all 400K context, 128K max output
    "gpt-5.2": ModelInfo(
        id="gpt-5.2",
        name="GPT-5.2",
        provider="openai",
        context_window=400_000,
        max_output=128_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
    ),
    "gpt-5": ModelInfo(
        id="gpt-5",
        name="GPT-5",
        provider="openai",
        context_window=400_000,
        max_output=128_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
    ),
    "gpt-5-mini": ModelInfo(
        id="gpt-5-mini",
        name="GPT-5 mini",
        provider="openai",
        context_window=400_000,
        max_output=128_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
    ),
    "gpt-5-nano": ModelInfo(
        id="gpt-5-nano",
        name="GPT-5 nano",
        provider="openai",
        context_window=400_000,
        max_output=128_000,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="effort",
    ),
    # Anthropic Claude 4.x family — all 200K context
    "claude-opus-4-6-20250130": ModelInfo(
        id="claude-opus-4-6-20250130",
        name="Claude Opus 4.6",
        provider="anthropic",
        context_window=200_000,
        max_output=8_192,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="thinking",
    ),
    "claude-sonnet-4-6-20250514": ModelInfo(
        id="claude-sonnet-4-6-20250514",
        name="Claude Sonnet 4.6",
        provider="anthropic",
        context_window=200_000,
        max_output=8_192,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="thinking",
    ),
    "claude-haiku-4-5-20251001": ModelInfo(
        id="claude-haiku-4-5-20251001",
        name="Claude Haiku 4.5",
        provider="anthropic",
        context_window=200_000,
        max_output=8_192,
        supports_tools=True,
        supports_reasoning=True,
        reasoning_type="thinking",
    ),
}


# ---------------------------------------------------------------------------
# OpenRouter dynamic models — cached in memory
# ---------------------------------------------------------------------------

_openrouter_cache: list[ModelInfo] = []


async def fetch_openrouter_models(api_key: str) -> list[ModelInfo]:
    """Fetch available models from OpenRouter API and update the cache."""
    global _openrouter_cache

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("Failed to fetch OpenRouter models: %s", e)
        return _openrouter_cache  # Return stale cache on failure

    data = response.json()
    models: list[ModelInfo] = []

    for entry in data.get("data", []):
        model_id = entry.get("id", "")
        name = entry.get("name", model_id)
        context_length = entry.get("context_length") or 0
        max_output = entry.get("top_provider", {}).get("max_completion_tokens") or 4096

        # Detect tool support from model architecture/description
        architecture = entry.get("architecture", {})
        supports_tools = "tool" in str(architecture).lower() or "function" in str(architecture).lower()

        # DeepSeek R1 models have built-in reasoning
        is_r1 = "deepseek-r1" in model_id.lower() or "r1" in name.lower()
        supports_reasoning = is_r1
        reasoning_type = "builtin" if is_r1 else None

        models.append(
            ModelInfo(
                id=model_id,
                name=name,
                provider="openrouter",
                context_window=context_length,
                max_output=max_output,
                supports_tools=supports_tools,
                supports_reasoning=supports_reasoning,
                reasoning_type=reasoning_type,
            )
        )

    _openrouter_cache = models
    logger.info("Fetched %d models from OpenRouter", len(models))
    return models


def get_openrouter_cache() -> list[ModelInfo]:
    """Return the current OpenRouter model cache (may be empty if not yet fetched)."""
    return _openrouter_cache


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_static_models() -> dict[str, ModelInfo]:
    """Return all statically defined models (OpenAI + Anthropic)."""
    return dict(_STATIC_MODELS)


def get_context_window(model_id: str, provider: str) -> int:
    """Look up context window size for a model.

    For static models (OpenAI/Anthropic), uses the hardcoded catalog.
    For OpenRouter models, checks the cached dynamic list.
    Returns 0 if the model is not found.
    """
    # Check static models first
    if model_id in _STATIC_MODELS:
        return _STATIC_MODELS[model_id].context_window

    # Check OpenRouter cache
    if provider == "openrouter":
        for model in _openrouter_cache:
            if model.id == model_id:
                return model.context_window

    return 0


def get_all_models() -> dict[str, list[ModelInfo]]:
    """Return all models grouped by provider."""
    grouped: dict[str, list[ModelInfo]] = {
        "openai": [],
        "anthropic": [],
        "openrouter": list(_openrouter_cache),
    }

    for model in _STATIC_MODELS.values():
        grouped[model.provider].append(model)

    return grouped
