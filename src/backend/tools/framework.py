"""ToolFramework: registry, schema normalization, and routing."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from src.backend.exceptions import ToolExecutionError
from src.backend.tools.base import Tool, ToolContext, ToolResult, ToolStep

logger = logging.getLogger(__name__)

# OpenRouter models known to support tool calling
TOOL_CAPABLE_PREFIXES: set[str] = {
    "openai/",
    "anthropic/",
    "deepseek/deepseek-chat",
    "deepseek/deepseek-r1",
    "deepseek/deepseek-coder",
}


class ToolFramework:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' is already registered")
        self._tools[tool.name] = tool
        logger.info("Registered tool: %s", tool.name)

    def get_schemas_for_provider(self, provider: str) -> list[dict]:
        """Return tool schemas in the format expected by the given provider.

        Canonical format is OpenAI (function wrapper). Anthropic needs translation.
        OpenRouter uses the same format as OpenAI.
        """
        schemas = []
        for tool in self._tools.values():
            canonical = {
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                },
            }
            if provider == "anthropic":
                # Anthropic: no "type"/"function" wrapper, parameters -> input_schema
                schemas.append(
                    {
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.parameters,
                    }
                )
            else:
                # OpenAI and OpenRouter use the same format
                schemas.append(canonical)
        return schemas

    async def execute_tool_call(
        self,
        tool_name: str,
        arguments: dict,
        context: ToolContext,
        on_step: Callable[[ToolStep], Awaitable[None]],
    ) -> ToolResult:
        if tool_name not in self._tools:
            raise ToolExecutionError(f"Unknown tool: {tool_name}")
        tool = self._tools[tool_name]
        try:
            return await tool.execute(arguments, context, on_step)
        except ToolExecutionError:
            raise
        except Exception as exc:
            raise ToolExecutionError(f"Tool '{tool_name}' failed: {exc}") from exc

    def supports_tools(self, model_id: str, provider: str) -> bool:
        if provider in ("openai", "anthropic"):
            return True
        if provider == "openrouter":
            return any(model_id.startswith(p) for p in TOOL_CAPABLE_PREFIXES)
        return False
