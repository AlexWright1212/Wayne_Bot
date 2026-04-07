# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## References

When working with anything related to *specific* LLM models (model names, model IDs, API parameters, pricing, reasoning controls), you MUST consult `docs/refernces/llm_models_reference.md` before using model information from your training data. Your training data likely contains outdated model names and info.

For backend and frontend architecture — request flow, provider layer, tool framework, visibility layer, rolling summary, state management — consult `docs/refernces/architecture.md` for an overview.

## Project Structure

- `spec/` — Specifications - we follow spec-driven-development - these are contracts, not suggestions
- `docs/` — Reference documents including architecture research and model reference
- `src/backend/` — FastAPI backend (Python)
- `src/frontend/` — React + Vite frontend (TypeScript)
- `plans/` — Implementation plans (created during plan mode)
- `tests/` — `unit/` and `integration/` test suites

## Spec-Driven Development

Specs in `spec/` are core artifacts — the source of truth for intended behavior. If implementation conflicts with the spec, surface it rather than silently resolving it:

```
SPEC CONFLICT:
Spec says X, but [existing code / your plan] does Y.

Options:
A) Follow the spec — [implication]
B) Follow the code — update the spec to match
C) Unsure — needs your call

→ Which approach?
```

## Development Commands

### Backend

```bash
# Start the backend (port 8000)
poetry run uvicorn src.backend.main:app --reload

# Or via the installed script
poetry run wayne

# Run all tests
poetry run pytest

# Run a single test file
poetry run pytest tests/unit/test_conversation_service.py

# Run a single test by name
poetry run pytest tests/unit/test_conversation_service.py::test_create_conversation -v

# Run only integration tests
poetry run pytest tests/integration/

# Run database migrations
poetry run alembic upgrade head

# Create a new migration
poetry run alembic revision --autogenerate -m "description"
```

### Frontend

All frontend commands run from `src/frontend/`:

```bash
cd src/frontend
npm run dev        # Dev server on port 5173
npm run build      # TypeScript check + Vite build
npm run lint       # ESLint
npm run preview    # Preview production build
```

## Tech Stack

### Backend

- **Python 3.13**, managed with Poetry
- **FastAPI** — HTTP REST + WebSocket server
- **SQLAlchemy 2 (async)** + **asyncpg** — async ORM against PostgreSQL 18
- **Alembic** — database migrations
- **pydantic-settings** — config via `.env`
- **openai** + **anthropic** SDKs — direct provider integrations; OpenRouter via OpenAI-compatible HTTP
- **Tavily** — web search tool (via `httpx`)

### Frontend

- **React 18** + **Vite** + **TypeScript**
- **Tailwind v4** + **shadcn/ui** (style: `base-nova`, Radix primitives)
- **Zustand** — state management
- **react-markdown** + **remark-gfm** + **rehype-highlight** — markdown rendering

## MCP Integrations

| MCP Server | Purpose |
| **shadcn/ui** | Required for all frontend and UI work — provides registry search, component APIs, and project context. Use the `shadcn` skill. |
| **Claude in Chrome** | Live browser access (DOM, console, network). Only use when explicitly instructed — primarily for frontend testing. |

## Testing Patterns

- `asyncio_mode = "auto"` — all async tests run automatically.
- **Critical:** asyncpg pools are bound to the event loop. Always create a fresh `create_async_engine` inside the `db_session` fixture (per-test scope) and dispose at the end. Module-level engines break on the 2nd test with "Event loop is closed".
- Factories in `tests/factories.py`. HTTP mocking via `respx`.
- Integration tests hit the real `wayne_test` PostgreSQL database — no mocking the DB layer.
