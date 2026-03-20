# Wayne Bot — Claude Code Instructions

## LLM Model References — MANDATORY

**When writing or modifying ANY code, specs, plans, or documentation that references LLM models (model names, model IDs, API parameters, pricing, reasoning controls), you MUST consult `docs/llm_models_reference.md` before using model information from your training data.** Your training data likely contains outdated model names (e.g., GPT-4o, Claude 3, etc.) that have been superseded.

Key facts that are easy to get wrong:
- OpenAI's current family is **GPT-5.x** (GPT-4o is deprecated)
- Anthropic's current family is **Claude 4.x** (Claude 3.x is retired)
- DeepSeek's latest general model is **V3.2** (not V3)
- DeepSeek R2 has **not been released** as of March 2026
- Wayne's lightweight model is **GPT-5 nano**, not GPT-4o-mini

## Project Structure

- `spec/` — Specifications (v1 spec is the current contract)
- `docs/` — Reference documents including architecture research and model reference
- `src/` — Source code (Python backend, React frontend)
- `plans/` — Implementation plans (created during plan mode)

## ShadCN

- **Mandatory Skill Use** - This project uses ShadCN for ALL UI work. You MUST ALWAYS refernce the ShadCN skill when working on frontend, React, or UI creation tasks.
