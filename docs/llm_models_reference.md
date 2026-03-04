# LLM Models Reference — Wayne Project

**Last verified:** 2026-03-02
**Purpose:** Single source of truth for model names, IDs, pricing, and API parameters used in this project. Claude Code must consult this file when writing or modifying any code, specs, or docs that reference LLM models.

---

## How to Keep This Updated

Before using model information from training data, **always verify** against these sources:

| Provider | Documentation URL |
|---|---|
| OpenAI | https://platform.openai.com/docs/models |
| OpenAI Pricing | https://platform.openai.com/docs/pricing |
| Anthropic | https://docs.anthropic.com/en/docs/about-claude/models |
| Anthropic Pricing | https://docs.anthropic.com/en/docs/about-claude/pricing |
| OpenRouter | https://openrouter.ai/models |
| DeepSeek | https://openrouter.ai/deepseek |

If the information below seems potentially stale (6+ months since "Last verified"), use web search to check for updates before relying on it.

---

## OpenAI Models (Direct SDK)

### Current Models (GPT-5 family)

| Model | API Model ID | Context Window | Max Output | Input $/1M | Output $/1M | Notes |
|---|---|---|---|---|---|---|
| GPT-5.2 | `gpt-5.2` | 400K | 128K | $1.75 | $14.00 | Flagship reasoning model |
| GPT-5 | `gpt-5` | 400K | 128K | ~$1.00 | ~$8.00 | Default workhorse, replaced GPT-4o |
| GPT-5 mini | `gpt-5-mini` | 400K | 128K | $0.25 | $2.00 | Cost-efficient mid-tier |
| GPT-5 nano | `gpt-5-nano` | 400K | 128K | $0.05 | $0.40 | Cheapest/fastest, used as Wayne's lightweight model |

### Legacy Models (Deprecated — avoid in new code)

As of February 2026, the following are retired from ChatGPT and deprecated in the API:
- `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini`
- `o1`, `o3`, `o3-pro`, `o4-mini`

These still work via the API but should not be used in new implementations.

### Reasoning Parameters

- **Parameter:** `reasoning.effort`
- **Values:** `none`, `low`, `medium`, `high`, `xhigh`
- `xhigh` is new as of GPT-5.2
- **Reasoning summaries:** Not included by default. Must be explicitly opted into. Returns concise summaries of the model's reasoning process.

### SDK

- Package: `openai` (Python)
- Streaming: SSE via the SDK's streaming interface

---

## Anthropic Models (Direct SDK)

### Current Models

| Model | API Model ID | Context Window | Input $/1M | Output $/1M | Notes |
|---|---|---|---|---|---|
| Claude Opus 4.6 | `claude-opus-4-6-20250130` | 200K (1M with beta header) | $5.00 | $25.00 | Top-tier reasoning and coding |
| Claude Sonnet 4.6 | `claude-sonnet-4-6-20250514` | 200K (1M with beta header) | $3.00 | $15.00 | Best balance of cost/performance |
| Claude Haiku 4.5 | `claude-haiku-4-5-20251001` | 200K | $1.00 | $5.00 | Cheapest/fastest Claude |

### Retired Models

- Claude Haiku 3 — retired February 19, 2026
- Older Claude 3 / 3.5 models — no longer recommended

### Reasoning Parameters

**Adaptive thinking (recommended):**
```json
{ "thinking": { "type": "adaptive" } }
```
Claude decides if and how much to think based on problem complexity.

**Effort parameter:** Controls thinking depth broadly. Can be combined with adaptive thinking.

**Legacy extended thinking (still works, deprecated):**
```json
{ "thinking": { "type": "enabled", "budget_tokens": 10000 } }
```

### Extended Context

Up to 1M tokens available with the `context-1m-2025-08-07` beta header.

### SDK

- Package: `anthropic` (Python)
- Streaming: SSE via the SDK's streaming interface

---

## OpenRouter Models

### Primary Targets (DeepSeek)

| Model | OpenRouter ID | Input $/1M | Output $/1M | Notes |
|---|---|---|---|---|
| DeepSeek V3.2 | `deepseek/deepseek-v3.2` | $0.14 | $0.28 | Latest general model |
| DeepSeek R1 | `deepseek/deepseek-r1` | $0.55 | $2.19 | Reasoning model, always-on CoT |

### DeepSeek Reasoning

- DeepSeek R1: Reasoning is baked in (always-on). Raw reasoning output is included in the response and must be parsed out separately from the final answer.
- DeepSeek V3.2: No reasoning capability, fast general-purpose model.
- DeepSeek R2: NOT released as of March 2026.

### Other Notable Models on OpenRouter

These are available via OpenRouter's dynamic model list but are not primary targets for Wayne v1:
- Google Gemini 2.5 Pro / Flash
- Qwen 2.5 models
- Meta Llama models
- Mistral models

### API

- OpenRouter uses an OpenAI-compatible API format
- Model list endpoint: `GET https://openrouter.ai/api/v1/models`
- Streaming: SSE, same pattern as OpenAI

---

## Wayne Project Model Assignments

| Role | Model | Rationale |
|---|---|---|
| Lightweight (summarization, auto-titling, harness plumbing) | GPT-5 nano | Cheapest available ($0.05/1M in), fast, sufficient quality for utility tasks |
| User-selectable chat models | All models listed above | User chooses from UI |
| Search harness synthesis (Step 7) | User's selected model | Final answer quality should match user's chosen model |
