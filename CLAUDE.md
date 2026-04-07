# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Spec-Driven Development

Specs in `spec/` are core artifacts — the source of truth for intended behavior. 

- **Actively Surface Spec Conflicts** - If implementation conflicts with the spec, surface it rather than silently resolving it.
- **Update when decisions change** — If you discover the data model needs to change, update the spec first, then implement.
- **Update when scope changes** — Features added or cut should be reflected in the spec.
- **Commit the spec** — The spec belongs in version control alongside the code.
- **Reference the spec in PRs** — Link back to the spec section that each PR implements.

## References

When working with anything related to *specific* LLM models (model names, model IDs, API parameters, pricing, reasoning controls), you MUST consult `docs/refernces/llm_models_reference.md` before using model information from your training data. Your training data likely contains outdated model names and info.

For backend and frontend architecture — request flow, provider layer, tool framework, visibility layer, rolling summary, state management — consult `docs/refernces/architecture.md` for an overview.

## Project Structure

- `spec/` — Specifications - we follow spec-driven-development - these are contracts, not suggestions
- `docs/` — Reference documents including architecture research and model reference
- `src/backend/` — FastAPI backend (Python)
- `src/frontend/` — React + Vite frontend (TypeScript)
- `plans/` — Implementation plans (created during plan mode). Out-of-scope bugs and follow-up items go in `plans/follow-up.md`.
- `tests/` — `unit/` and `integration/` test suites

## MCP Integrations

| MCP Server | Purpose |
| **shadcn/ui** | Required for all frontend and UI work — provides registry search, component APIs, and project context. Use the `shadcn` skill. |
| **Claude in Chrome** | Live browser access (DOM, console, network). Useful for frontend testing.

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

## Testing Patterns

- `asyncio_mode = "auto"` — all async tests run automatically.
- **Critical:** asyncpg pools are bound to the event loop. Always create a fresh `create_async_engine` inside the `db_session` fixture (per-test scope) and dispose at the end. Module-level engines break on the 2nd test with "Event loop is closed".
- Factories in `tests/factories.py`. HTTP mocking via `respx`.
- Integration tests hit the real `wayne_test` PostgreSQL database — no mocking the DB layer.

## Codebase Practices

**Note Out-of-Scope Bugs in Seperate Follow-Up Doc** 

When working on a dedicated plan/task and encounter bugs/issues that need addressing but are OUT OF SCOPE, make a note in `plans/follow-up.md`

*Example:* While wiring frontend and backend together and using Chrome MCP to assess if backend API responds correctly, agent notices the "rename chat" button has a visual bug but API functions correctly -> DONT FIX NOW (out-of-scope for wiring frontend baclend) -> make a note and stay focused

