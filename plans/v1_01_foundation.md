# Unit F — Foundation

**Master plan:** `plans/v1_master_plan.md`
**Spec:** `spec/v1_spec.md` (v1.1)
**Model reference:** `docs/llm_models_reference.md` — consult before using any model names/IDs
**Spec sections:** §2.1, §7.1, §9, §10, §14

## Overview

Unit F bootstraps the entire Wayne backend: project dependencies, database infrastructure, ORM models, configuration, error hierarchy, system prompt, and the FastAPI application shell. Everything downstream depends on this unit. When complete, `docker compose up` starts Postgres, migrations create the schema, and `GET /api/health` responds.

## Dependencies

None. This is the first unit in the build order.

## Files to Create

```
docker-compose.yml                          — Postgres service (dev + test DBs)
alembic.ini                                 — Alembic config pointing to database.py
.env.example                                — Template for all required env vars
src/backend/__init__.py                     — Package init
src/backend/main.py                         — FastAPI app, lifespan, CORS, health endpoint
src/backend/config.py                       — Pydantic Settings class
src/backend/database.py                     — Async engine, session factory, get_db
src/backend/exceptions.py                   — Error hierarchy + FastAPI exception handler
src/backend/models/__init__.py              — Re-exports all models
src/backend/models/base.py                  — DeclarativeBase, common mixins (id, timestamps)
src/backend/models/conversation.py          — Conversation ORM model
src/backend/models/message.py               — Message ORM model (with role enum)
src/backend/models/visibility.py            — VisibilityRecord ORM model
src/backend/models/rolling_summary.py       — RollingSummary ORM model
src/backend/schemas/__init__.py             — Package init
src/backend/schemas/conversations.py        — Conversation request/response schemas
src/backend/schemas/messages.py             — Message response schemas
src/backend/services/__init__.py            — Package init
src/backend/services/system_prompt.py       — SYSTEM_PROMPT constant
src/backend/migrations/env.py               — Alembic async migration env
src/backend/migrations/script.py.mako       — Migration template
src/backend/migrations/versions/.gitkeep    — Empty versions dir
tests/__init__.py                           — Package init
tests/conftest.py                           — Fixtures: async client, test DB session
tests/factories.py                          — Factory functions for test data
```

## Implementation Steps

### Phase 1 — Project Setup & Infrastructure

#### Step 1: Update `pyproject.toml`

Add all backend dependencies. The existing pyproject.toml has only `python = "^3.11"`.

- **Runtime deps:** fastapi, uvicorn[standard], sqlalchemy[asyncio], asyncpg, alembic, pydantic-settings, python-dotenv, httpx
- **Dev deps:** pytest, pytest-asyncio, respx, factory-boy (or keep factories manual — simpler for this project)
- Do NOT add provider SDKs (openai, anthropic, tiktoken, tavily) — those belong to Unit P and Unit T
- Add a `[tool.poetry.scripts]` entry: `wayne = "src.backend.main:run"` for convenience
- Run `poetry install` after editing

#### Step 2: `docker-compose.yml`

Single Postgres 15+ service with two databases.

- Mount a volume for data persistence across restarts
- Use an init script or healthcheck — the init script approach is simpler: mount a `.sql` file that creates both `wayne` and `wayne_test` databases
- Expose port 5432 on localhost
- Set `POSTGRES_USER=wayne`, `POSTGRES_PASSWORD=wayne`, `POSTGRES_DB=wayne`
- Create `docker/init.sql` with `CREATE DATABASE wayne_test;` (the default DB `wayne` is created by Postgres automatically from `POSTGRES_DB`)

#### Step 3: `.env.example`

Template for all env vars referenced in `config.py`. Include all keys from the master plan §6 Configuration section with empty/default values. Comments explaining each var.

#### Step 4: `src/backend/config.py`

Pydantic Settings v2 class as defined in master plan §6.

- Use `model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")`
- All fields match master plan exactly — `database_url`, API keys (empty string defaults), `lightweight_model`, thresholds, host/port, cors_origins
- Add a `test_database_url` field: same as `database_url` but with `wayne_test` DB name — or derive it programmatically
- Create a module-level `settings = Settings()` singleton for import convenience

**Smoke check:** `poetry run python -c "from src.backend.config import settings; print(settings.database_url)"` prints the default URL.

### Phase 2 — Database & ORM Models

#### Step 5: `src/backend/database.py`

Async engine and session factory.

- `create_async_engine(settings.database_url)` — set `echo=False` (INFO logging handles query visibility)
- `async_sessionmaker` with `expire_on_commit=False` — critical for async usage where objects may be accessed after commit
- `get_db()` async generator: yield session, commit on success, rollback on exception
- Export `engine`, `async_session_factory`, and `get_db`

#### Step 6: `src/backend/models/base.py`

DeclarativeBase and a `TimestampMixin`.

- Use `DeclarativeBase` from SQLAlchemy 2.0+ (not the legacy `declarative_base()`)
- `TimestampMixin`: `created_at` (server_default=func.now()) and `updated_at` (server_default=func.now(), onupdate=func.now())
- Use `mapped_column` with `Mapped[]` type annotations throughout — this is the modern SQLAlchemy 2.0 style
- UUID primary keys: use `uuid.uuid4` as default, mapped as `Mapped[uuid.UUID]`

#### Step 7: `src/backend/models/conversation.py`

Follows master plan §2 schema exactly.

- Fields: `id` (UUID PK), `title` (nullable VARCHAR 255), `last_model_id`, `last_provider`, `created_at`, `updated_at`
- Relationship to messages: `messages: Mapped[list["Message"]]` with `cascade="all, delete-orphan"`, ordered by `sequence`
- Relationship to rolling_summaries: same pattern
- Index on `updated_at DESC` for sidebar ordering

#### Step 8: `src/backend/models/message.py`

The most complex model. Follows master plan §2 schema.

- **Role enum:** Use Python `enum.Enum` mapped to a Postgres ENUM via SQLAlchemy's `Enum` type. Values: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `summary`
- Fields: `id`, `conversation_id` (FK), `role`, `content` (nullable TEXT), `model_id`, `provider`, `reasoning_level`, `tool_call_id`, `tool_name`, `tool_arguments` (JSONB), `tool_result_call_id`, `tool_result_name`, `sequence`, `created_at`
- Index on `(conversation_id, sequence)` for efficient context assembly
- Relationship back to conversation
- One-to-one relationship to visibility_record (optional, only assistant messages have one)

#### Step 9: `src/backend/models/visibility.py`

Follows master plan §2 schema.

- One-to-one with Message via `message_id` (UNIQUE FK)
- JSONB fields: `request_payload`, `response_metadata`, `summary_event`, `tool_trace`
- Integer fields for token counts: `tokens_openai`, `tokens_anthropic`, `tokens_openrouter`, `output_tokens`, `context_window_size`, `active_token_count`
- `reasoning_content` as TEXT (can be large for Anthropic extended thinking)

#### Step 10: `src/backend/models/rolling_summary.py`

Follows master plan §2 schema.

- `conversation_id` FK (not unique — a conversation can have multiple summaries over time)
- `summarized_message_ids` as `ARRAY(UUID)` — use SQLAlchemy's `ARRAY` type with `postgresql.UUID`
- `tokens_before`, `tokens_after` as INTEGER
- `model_used` VARCHAR
- Index on `(conversation_id, created_at)`

#### Step 11: `src/backend/models/__init__.py`

Re-export all models so Alembic's `env.py` can discover them via a single import.

- Import `Base` from `base.py` and all four model classes
- This ensures `Base.metadata` contains all tables when Alembic runs

### Phase 2 Smoke Check

Set up Alembic and verify the schema.

#### Step 12: Alembic setup

- `alembic.ini`: set `sqlalchemy.url` to empty (will be overridden by env.py)
- `migrations/env.py`: import `Base.metadata` from models, configure async engine from `settings.database_url`
- Use `run_async` pattern for async Alembic migrations (Alembic 1.12+ supports this natively)
- Generate initial migration: `alembic revision --autogenerate -m "initial schema"`

**Smoke check:** `docker compose up -d` then `alembic upgrade head` succeeds. Connect with `psql` and verify all four tables exist with correct columns.

### Phase 3 — Error Handling, System Prompt, Schemas

#### Step 13: `src/backend/exceptions.py`

Error hierarchy as defined in master plan §6.

- `WayneError(Exception)` base with `status_code` and `detail` class attributes
- Subclasses: `ProviderError` (502), `ProviderKeyMissing` (422), `ToolExecutionError` (502), `TokenCountError` (500)
- A FastAPI exception handler function that converts `WayneError` to JSON responses — register this in `main.py`

#### Step 14: `src/backend/services/system_prompt.py`

A single `SYSTEM_PROMPT` string constant.

- Under 500 tokens as spec §7.1 requires
- Identify as "Wayne", helpful and direct, thorough but concise, no personality gimmicks
- Provider-agnostic — works with OpenAI, Anthropic, and OpenRouter models
- Include the current date as a dynamic element (formatted at import time or via a function) so the model knows what day it is
- Keep it simple — this can be refined later without architectural changes

#### Step 15: `src/backend/schemas/conversations.py`

Pydantic v2 request/response schemas for conversation CRUD.

- `ConversationCreate`: empty (no required fields — title is auto-generated)
- `ConversationUpdate`: optional `title`
- `ConversationResponse`: id, title, last_model_id, last_provider, created_at, updated_at
- `ConversationSummary`: id, title, updated_at (for sidebar list)
- `ConversationDetail`: extends ConversationResponse with `messages: list[MessageResponse]`
- Use `model_config = ConfigDict(from_attributes=True)` for ORM compatibility

#### Step 16: `src/backend/schemas/messages.py`

- `MessageResponse`: id, role, content, model_id, provider, reasoning_level, tool_call_id, tool_name, tool_arguments, tool_result_call_id, tool_result_name, sequence, created_at
- All optional fields that are role-specific (tool fields, model attribution) should be `None` by default
- Use the same `from_attributes=True` pattern

### Phase 4 — FastAPI Application Shell

#### Step 17: `src/backend/main.py`

The FastAPI application entry point.

- Use `@asynccontextmanager` lifespan for startup/shutdown: verify DB connectivity on startup, dispose engine on shutdown
- Register the `WayneError` exception handler
- CORS middleware using `settings.cors_origins`
- Mount a health endpoint: `GET /api/health` returns `{ "status": "ok" }` — the full provider health check (spec §11.1) will be added by Unit P
- Include conversation router (stub for now — just the router mount point, actual routes come in Unit C, but we can include a minimal conversations router here for verification)
- `run()` function that calls `uvicorn.run` with `settings.host` and `settings.port`

**Smoke check:** `docker compose up -d` then `poetry run uvicorn src.backend.main:app --reload`. Hit `http://localhost:8000/api/health` — returns `{"status": "ok"}`. Hit `http://localhost:8000/docs` — OpenAPI docs render.

### Phase 5 — Test Infrastructure

#### Step 18: `tests/conftest.py`

Pytest fixtures for async database testing.

- Use `pytest-asyncio` with `asyncio_mode = "auto"` in pyproject.toml
- **Test DB setup:** Create async engine pointing to `wayne_test` database URL
- **Per-test isolation:** Use a transaction-per-test pattern — start a transaction, bind a session to it, yield the session, then rollback. This is faster than create/drop tables per test.
- Alternative simpler approach: create all tables before each test, drop after. Slower but more straightforward — either approach works for v1's scale.
- Fixture: `db_session` — async session for test use
- Fixture: `client` — `httpx.AsyncClient` using FastAPI's `TestClient` with dependency override for `get_db`
- Override `get_db` to return the test session

#### Step 19: `tests/factories.py`

Helper functions (not factory-boy — keep it simple) for creating test data.

- `create_conversation(db, **overrides)` → creates and flushes a Conversation
- `create_message(db, conversation_id, role, content, sequence, **overrides)` → creates and flushes a Message
- Default values should be sensible: `title="Test Conversation"`, `content="Hello"`, etc.
- These are async functions that take the db session as first arg

#### Step 20: Basic verification tests

Write a small test file `tests/unit/test_foundation.py`:

- Test DB connectivity: create a conversation, query it back, verify fields
- Test message creation with various roles
- Test cascade delete: delete conversation → messages deleted
- Test health endpoint returns 200 with `{"status": "ok"}`
- Test that `Settings` loads defaults correctly

**Final check:** `poetry run pytest` — all tests pass.

## Completion Criteria

1. `docker compose up -d` starts Postgres and both databases (`wayne`, `wayne_test`) exist
2. `alembic upgrade head` creates all four tables with correct columns, types, and indexes
3. FastAPI starts and `GET /api/health` returns `{"status": "ok"}`
4. `SYSTEM_PROMPT` is defined, under 500 tokens, and provider-agnostic
5. All ORM models match the master plan §2 schema (field names, types, constraints, indexes)
6. Pydantic schemas serialize ORM models correctly (`from_attributes`)
7. `WayneError` hierarchy is in place with correct status codes
8. `pytest` passes with DB connectivity test, CRUD operations, and cascade delete
9. `get_db()` yields a working async session with commit/rollback behavior
10. `.env.example` documents all required environment variables

## Implementation Notes

### asyncpg engine must be created per-test, not at module level

asyncpg connection pools are bound to the event loop they were created on. pytest-asyncio 0.24 creates a new event loop per test function. A module-level `create_async_engine()` works for the first test, then every subsequent async DB test fails with `RuntimeError: Event loop is closed`.

The implemented `conftest.py` creates a fresh engine inside the `db_session` fixture (create → create_all → yield session → drop_all → dispose), all within one fixture invocation. **All future units adding DB test fixtures must follow this same per-test engine pattern.** Do not refactor to a module-level engine.

### `src/__init__.py` is required but absent from the Files to Create list

The file list omits `src/__init__.py`. Without it, `src.backend` is not a proper Python package and all `from src.backend.*` imports fail with `ModuleNotFoundError: No module named 'src'`. It has been created (empty file).

### Alembic env.py requires explicit sys.path insertion

Alembic runs `env.py` without the project root on `sys.path`, so `from src.backend.config import settings` fails. The fix — already in the committed `env.py` — is:

```python
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
```

`parents[3]` from `src/backend/migrations/env.py` resolves to the project root. If the migrations directory is ever moved, this depth must be recalculated.
