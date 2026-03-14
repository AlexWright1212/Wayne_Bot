"""Pydantic response schemas for the model list API."""

from pydantic import BaseModel


class ModelResponse(BaseModel):
    id: str
    name: str
    provider: str
    context_window: int
    max_output: int
    supports_tools: bool
    supports_reasoning: bool
    reasoning_levels: list[str]


class ProviderModels(BaseModel):
    provider: str
    available: bool
    models: list[ModelResponse]


class ModelsListResponse(BaseModel):
    providers: dict[str, ProviderModels]
