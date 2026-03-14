"""Routes for model listing and OpenRouter refresh."""

from fastapi import APIRouter

from src.backend.config import settings
from src.backend.providers.base import REASONING_LEVELS
from src.backend.providers.model_catalog import (
    fetch_openrouter_models,
    get_all_models,
    get_openrouter_cache,
)
from src.backend.schemas.models_list import (
    ModelResponse,
    ModelsListResponse,
    ProviderModels,
)

router = APIRouter(tags=["models"])

# Which providers have keys configured
_PROVIDER_KEYS = {
    "openai": lambda: bool(settings.openai_api_key),
    "anthropic": lambda: bool(settings.anthropic_api_key),
    "openrouter": lambda: bool(settings.openrouter_api_key),
}


def _model_to_response(model) -> ModelResponse:
    return ModelResponse(
        id=model.id,
        name=model.name,
        provider=model.provider,
        context_window=model.context_window,
        max_output=model.max_output,
        supports_tools=model.supports_tools,
        supports_reasoning=model.supports_reasoning,
        reasoning_levels=REASONING_LEVELS.get(model.provider, []),
    )


@router.get("/models", response_model=ModelsListResponse)
async def list_models() -> ModelsListResponse:
    """Return all available models grouped by provider."""
    # Fetch OpenRouter models on first request if cache is empty and key exists
    if not get_openrouter_cache() and settings.openrouter_api_key:
        await fetch_openrouter_models(settings.openrouter_api_key)

    all_models = get_all_models()
    providers: dict[str, ProviderModels] = {}

    for provider_name in ("openai", "anthropic", "openrouter"):
        available = _PROVIDER_KEYS[provider_name]()
        models = [_model_to_response(m) for m in all_models.get(provider_name, [])]
        providers[provider_name] = ProviderModels(
            provider=provider_name,
            available=available,
            models=models,
        )

    return ModelsListResponse(providers=providers)


@router.get("/models/openrouter/refresh")
async def refresh_openrouter_models() -> dict:
    """Force re-fetch of OpenRouter model list."""
    if not settings.openrouter_api_key:
        return {"models": [], "error": "OpenRouter API key not configured"}

    models = await fetch_openrouter_models(settings.openrouter_api_key)
    return {"models": [_model_to_response(m).model_dump() for m in models]}
