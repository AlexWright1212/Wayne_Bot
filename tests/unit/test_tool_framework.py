"""Unit tests for ToolFramework — schema normalization and supports_tools.

Focus: pure logic/transforms (schema normalization is a data-in/data-out transform).
"""

from __future__ import annotations

import pytest

from src.backend.tools.base import Tool, ToolContext, ToolResult, ToolStep
from src.backend.tools.framework import ToolFramework


# ---------------------------------------------------------------------------
# Minimal concrete tool for testing
# ---------------------------------------------------------------------------

class EchoTool(Tool):
    name = "echo"
    description = "Echoes the input"
    parameters = {
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
    }

    async def execute(self, arguments, context, on_step):
        return ToolResult(content=arguments.get("text", ""), trace=[])


# ---------------------------------------------------------------------------
# Schema normalization tests (pure transform, no IO)
# ---------------------------------------------------------------------------

def test_openai_schema_format():
    fw = ToolFramework()
    fw.register(EchoTool())
    schemas = fw.get_schemas_for_provider("openai")
    assert len(schemas) == 1
    s = schemas[0]
    assert s["type"] == "function"
    assert s["function"]["name"] == "echo"
    assert s["function"]["description"] == "Echoes the input"
    assert "properties" in s["function"]["parameters"]


def test_openrouter_schema_same_as_openai():
    fw = ToolFramework()
    fw.register(EchoTool())
    openai_schemas = fw.get_schemas_for_provider("openai")
    openrouter_schemas = fw.get_schemas_for_provider("openrouter")
    assert openai_schemas == openrouter_schemas


def test_anthropic_schema_format():
    fw = ToolFramework()
    fw.register(EchoTool())
    schemas = fw.get_schemas_for_provider("anthropic")
    assert len(schemas) == 1
    s = schemas[0]
    # No function wrapper, no "type" field
    assert "type" not in s
    assert "function" not in s
    assert s["name"] == "echo"
    assert s["description"] == "Echoes the input"
    # parameters -> input_schema
    assert "input_schema" in s
    assert "parameters" not in s
    assert "properties" in s["input_schema"]


def test_anthropic_schema_has_no_openai_wrapper():
    """Verify Anthropic doesn't accidentally get the function wrapper."""
    fw = ToolFramework()
    fw.register(EchoTool())
    schemas = fw.get_schemas_for_provider("anthropic")
    for s in schemas:
        assert "function" not in s
        assert s.get("type") is None


def test_duplicate_registration_raises():
    fw = ToolFramework()
    fw.register(EchoTool())
    with pytest.raises(ValueError, match="already registered"):
        fw.register(EchoTool())


def test_multiple_tools_all_appear_in_schemas():
    class AnotherTool(Tool):
        name = "another"
        description = "Another tool"
        parameters = {"type": "object", "properties": {}}

        async def execute(self, arguments, context, on_step):
            return ToolResult(content="", trace=[])

    fw = ToolFramework()
    fw.register(EchoTool())
    fw.register(AnotherTool())
    for provider in ("openai", "anthropic", "openrouter"):
        assert len(fw.get_schemas_for_provider(provider)) == 2


# ---------------------------------------------------------------------------
# supports_tools tests
# ---------------------------------------------------------------------------

def test_supports_tools_openai_always_true():
    fw = ToolFramework()
    assert fw.supports_tools("gpt-5", "openai") is True
    assert fw.supports_tools("gpt-5-nano", "openai") is True
    assert fw.supports_tools("anything", "openai") is True


def test_supports_tools_anthropic_always_true():
    fw = ToolFramework()
    assert fw.supports_tools("claude-opus-4-6-20250130", "anthropic") is True
    assert fw.supports_tools("anything", "anthropic") is True


def test_supports_tools_openrouter_allowlisted():
    fw = ToolFramework()
    assert fw.supports_tools("openai/gpt-5", "openrouter") is True
    assert fw.supports_tools("anthropic/claude-opus-4-6", "openrouter") is True
    assert fw.supports_tools("deepseek/deepseek-chat", "openrouter") is True
    assert fw.supports_tools("deepseek/deepseek-r1", "openrouter") is True
    assert fw.supports_tools("deepseek/deepseek-coder", "openrouter") is True


def test_supports_tools_openrouter_unknown_returns_false():
    fw = ToolFramework()
    assert fw.supports_tools("meta-llama/llama-3-8b", "openrouter") is False
    assert fw.supports_tools("mistralai/mistral-7b", "openrouter") is False
    assert fw.supports_tools("google/gemini-flash", "openrouter") is False
    assert fw.supports_tools("qwen/qwen-2.5-72b", "openrouter") is False


def test_supports_tools_unknown_provider_returns_false():
    fw = ToolFramework()
    assert fw.supports_tools("some-model", "unknown_provider") is False
