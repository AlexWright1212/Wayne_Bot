# Unit F â€” Foundation: Implementation Plan (`plans/v1_01_foundation.md`)

## Overview

This plan covers the complete implementation of Wayne v1 Unit F â€” Foundation. This unit creates the skeleton that every other unit depends on: Python project setup, Docker Compose for PostgreSQL, FastAPI app factory, Pydantic Settings configuration, async SQLAlchemy database layer, all four ORM models, Alembic migrations, the error hierarchy, the system prompt service, and the test infrastructure.

All spec references are to `spec/v1_spec.md` v1.1.

**Completion criteria:**
1. `docker compose up -d` starts PostgreSQL 15+ with the wayne database
2. `alembic upgrade head` creates all four tables with correct columns, types, and indexes
3. `pytest tests/` passes: basic DB connectivity test plus create-and-retrieve conversation test
4. `uvicorn src.backend.main:app --reload` starts; `GET /api/health` returns HTTP 200 `{"status": "ok"}`

---

## Step 0: Verify Prerequisites

Before writing a single file, confirm the environment:

```bash
python --version     # Must be 3.11+
poetry --version     # Must be available
docker --version     # Must be available
docker compose version   # Must be v2 (not v1 docker-compose)
```

If any of these fail, resolve them before proceeding. Poetry must be installed globally (not just in a venv). If `docker compose` (v2 plugin) is not present but `docker-compose` (v1 binary) is, either upgrade Docker Desktop or adjust commands accordingly.

---

## Step 1: Update `pyproject.toml` â€” Add All Dependencies

**File:** `C:\Code\wayne_bot\pyproject.toml`

Replace the current minimal `pyproject.toml` with the following. Keep the existing `[tool.poetry]` header fields (`name`, `version`, `description`, `authors`, `readme`, `package-mode = false`). Replace the `[tool.poetry.dependencies]` and dev group sections entirely.

### Main dependencies (`[tool.poetry.dependencies]`)

```toml
python = "^3.11"
fastapi = "^0.115"
uvicorn = {extras = ["standard"], version = "^0.32"}
sqlalchemy = {extras = ["asyncio"], version = "^2.0"}
asyncpg = "^0.30"
alembic = "^1.14"
pydantic = "^2.10"
pydantic-settings = "^2.7"
python-dotenv = "^1.0"
httpx = "^0.28"
openai = "^1.60"
anthropic = "^0.42"
tiktoken = "^0.8"
```

### Dev dependencies (`[tool.poetry.group.dev.dependencies]`)

```toml
pytest = "^8.3"
pytest-asyncio = "^0.25"
pytest-cov = "^6.0"
anyio = {extras = ["trio"], version = "^4.7"}
```

### Tool configuration sections to add at the bottom

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.coverage.run]
source = ["src/backend"]
omit = ["src/backend/migrations/*"]
```

**Why these versions:** FastAPI 0.115+ has native Pydantic v2 support. SQLAlchemy 2.0 is required for the async session API. asyncpg 0.30 works with PostgreSQL 15+. pytest-asyncio 0.25 supports `asyncio_mode = "auto"` which avoids decorating every async test.

After editing, run:

```bash
poetry install
```

This resolves and locks all dependencies into `poetry.lock`. If Poetry complains about version conflicts, check that `asyncpg` and `sqlalchemy[asyncio]` are compatible â€” they always have been in the 0.29+/2.0 range.

---

## Step 2: Create `docker-compose.yml`

**File:** `C:\Code\wayne_bot\docker-compose.yml`

```yaml
services:
  db:
    image: postgres:15
    container_name: wayne_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: wayne
      POSTGRES_PASSWORD: wayne
      POSTGRES_DB: wayne
    ports:
      - "5432:5432"
    volumes:
      - wayne_pgdata:/var/lib/postgresql/data

volumes:
  wayne_pgdata:
```

**Key decisions:**
- Image is `postgres:15` (not `postgres:latest`) to pin to a specific major version matching the spec minimum (Â§14.1).
- `container_name: wayne_postgres` makes it easy to reference from CLI (`docker exec wayne_postgres psql ...`).
- `restart: unless-stopped` means the DB starts automatically when Docker Desktop starts.
- Volume `wayne_pgdata` is a named Docker volume â€” data persists across `docker compose down` and container rebuilds. To wipe the database completely you would run `docker compose down -v`.
- Credentials are hardcoded as `wayne/wayne` matching the default `database_url` in config (Step 4).

**Verification:**

```bash
docker compose up -d
docker compose ps       # should show wayne_postgres running
docker compose logs db  # should end with "database system is ready to accept connections"
```

---

## Step 3: Create `.env.example`

**File:** `C:\Code\wayne_bot\.env.example`

```
# Copy this file to .env and fill in your API keys.
# The .env file is gitignored and never committed.

# Provider API keys (leave blank to disable that provider)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
TAVILY_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://wayne:wayne@localhost:5432/wayne

# Server
HOST=0.0.0.0
PORT=8000
```

Note: `.env` itself should be gitignored. Verify `.gitignore` contains `.env` (if there is no `.gitignore` yet, create one that includes `.env`, `__pycache__/`, `*.pyc`, `.venv/`).

The actual `.env` used locally is a copy of this file with real API keys filled in. The `DATABASE_URL` in `.env.example` matches the default in `config.py` so developers can run with just `docker compose up -d` without setting `DATABASE_URL` explicitly.

---

## Step 4: Create `src/backend/config.py`

**File:** `C:\Code\wayne_bot\src\backend\config.py`

This is the Pydantic Settings v2 configuration class. It loads from the `.env` file and provides typed, validated settings to the rest of the application.

```python
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Database ---
    database_url: str = Field(
        default="postgresql+asyncpg://wayne:wayne@localhost:5432/wayne"
    )

    # --- API Keys ---
    openai_api_key: str = Field(default="")
    anthropic_api_key: str = Field(default="")
    openrouter_api_key: str = Field(default="")
    tavily_api_key: str = Field(default="")

    # --- Models ---
    lightweight_model: str = Field(default="gpt-5-nano")

    # --- Rolling Summary ---
    summary_threshold: float = Field(default=0.80)
    summary_budget: float = Field(default=0.50)

    # --- Search ---
    tavily_score_threshold: float = Field(default=0.75)
    tavily_date_threshold_days: int = Field(default=365)
    tavily_domain_blacklist: list[str] = Field(default_factory=list)
    search_max_retries: int = Field(default=2)

    # --- Server ---
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])


settings = Settings()
```

**Key decisions:**
- `case_sensitive=False` means `DATABASE_URL` in `.env` maps to `database_url` in code.
- `extra="ignore"` prevents Pydantic from raising errors if the `.env` file has extra variables (e.g., editor-added comments or future keys).
- `settings = Settings()` at module level creates a singleton. All other modules import `from src.backend.config import settings`. This is intentional â€” it gives a single source of truth and allows overriding in tests via environment variables before import.
- `lightweight_model = "gpt-5-nano"` matches the spec (Â§3.3) and the model reference doc.
- `cors_origins` defaults to Vite's dev server port (5173).

---

## Step 5: Create `src/backend/database.py`

**File:** `C:\Code\wayne_bot\src\backend\database.py`

This module creates the async SQLAlchemy engine and session factory, and provides the `get_db` FastAPI dependency.

```python
from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.backend.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,         # Set to True during local debugging to see SQL
    pool_pre_ping=True, # Validates connections before use (handles DB restarts)
    pool_size=5,
    max_overflow=10,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that provides an async database session.

    Usage in a route:
        async def my_route(db: AsyncSession = Depends(get_db)):
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

**Key decisions:**
- `pool_pre_ping=True` is important for a local dev environment where the Docker container may be stopped and restarted. Without it, SQLAlchemy may use a stale connection from the pool and fail silently.
- `expire_on_commit=False` â€” after a commit, loaded ORM objects remain accessible without triggering a lazy reload. This is the correct default for async usage since lazy loading is not supported in async SQLAlchemy.
- `autoflush=False` â€” we control when SQL is issued, making behavior more predictable in async context.
- The `get_db` dependency commits on success and rolls back on exception. This is the standard pattern for FastAPI + SQLAlchemy. Routes do not need to call `db.commit()` or `db.rollback()` explicitly.
- `engine` and `AsyncSessionLocal` are module-level singletons. The engine is shared across the application lifetime.

---

## Step 6: Create ORM Models

### Step 6a: `src/backend/models/base.py`

**File:** `C:\Code\wayne_bot\src\backend\models\base.py`

This defines the `DeclarativeBase` and common column mixins that all models inherit.

```python
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """SQLAlchemy declarative base for all Wayne ORM models."""
    pass


class UUIDPrimaryKeyMixin:
    """Mixin that adds a UUID primary key column named 'id'."""
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        nullable=False,
    )


class TimestampMixin:
    """Mixin that adds created_at and updated_at TIMESTAMPTZ columns.

    created_at is set by the database on INSERT.
    updated_at is set by the database on INSERT and updated on UPDATE.
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class CreatedAtMixin:
    """Mixin that adds only a created_at TIMESTAMPTZ column (no updated_at).

    Used for immutable records like messages and visibility records.
    """
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
```

**Key decisions:**
- Three separate mixin classes: `UUIDPrimaryKeyMixin` (UUID PK), `TimestampMixin` (created + updated), `CreatedAtMixin` (created only). This avoids adding `updated_at` to immutable tables (messages, visibility records) where it makes no semantic sense.
- `UUID(as_uuid=True)` stores as a native PostgreSQL UUID type and maps to Python's `uuid.UUID` object. This is the correct choice vs storing as VARCHAR.
- `server_default=func.now()` means the database sets the timestamp, not the Python application. This is more reliable in async context.
- `onupdate=func.now()` on `updated_at` uses SQLAlchemy's event hook to update the timestamp when the ORM updates the row.
- `Mapped[uuid.UUID]` uses SQLAlchemy 2.0's type-annotated column style, which is the modern approach and provides IDE type inference.

### Step 6b: `src/backend/models/conversation.py`

**File:** `C:\Code\wayne_bot\src\backend\models\conversation.py`

```python
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from src.backend.models.message import Message
    from src.backend.models.rolling_summary import RollingSummary


class Conversation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "conversations"

    __table_args__ = (
        Index("ix_conversations_updated_at", "updated_at", postgresql_ops={"updated_at": "DESC"}),
    )

    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_model_id: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    last_provider: Mapped[str] = mapped_column(String(20), nullable=False, default="")

    # Relationships
    messages: Mapped[list[Message]] = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.sequence",
    )
    rolling_summaries: Mapped[list[RollingSummary]] = relationship(
        "RollingSummary",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="RollingSummary.created_at",
    )
```

**Key decisions:**
- `last_model_id` and `last_provider` default to empty string (not null) so they can be updated after the first exchange without needing a separate "first update" migration.
- `title` is nullable per spec â€” it starts null and gets set by auto-titling after the first exchange.
- The `Index` on `updated_at DESC` is specified with `postgresql_ops` for a descending index, which PostgreSQL uses efficiently for ORDER BY updated_at DESC queries (the sidebar list).
- `cascade="all, delete-orphan"` on both relationships means deleting a Conversation cascades to all its Messages and RollingSummaries, matching the ON DELETE CASCADE in the schema requirements.
- Relationships use string class names in quotes to avoid circular import issues (the `TYPE_CHECKING` guard handles IDE type inference).
- `order_by="Message.sequence"` ensures that when you load `conversation.messages`, they come back in sequence order without an explicit ORDER BY in every query.

### Step 6c: `src/backend/models/message.py`

**File:** `C:\Code\wayne_bot\src\backend\models\message.py`

```python
from __future__ import annotations

import enum
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from src.backend.models.conversation import Conversation
    from src.backend.models.visibility import VisibilityRecord


class MessageRole(str, enum.Enum):
    """Valid roles for a message in a conversation."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    SUMMARY = "summary"


class Message(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "messages"

    __table_args__ = (
        Index("ix_messages_conversation_sequence", "conversation_id", "sequence"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[MessageRole] = mapped_column(
        SAEnum(MessageRole, name="message_role", create_type=True),
        nullable=False,
    )
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    reasoning_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    tool_arguments: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tool_result_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tool_result_name: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    # Relationships
    conversation: Mapped[Conversation] = relationship(
        "Conversation",
        back_populates="messages",
    )
    visibility_record: Mapped[VisibilityRecord | None] = relationship(
        "VisibilityRecord",
        back_populates="message",
        uselist=False,
        cascade="all, delete-orphan",
    )
```

**Key decisions:**
- `MessageRole` is a Python `str` enum and is mapped to a PostgreSQL native ENUM type via `SAEnum`. The `create_type=True` argument tells Alembic/SQLAlchemy to CREATE TYPE in PostgreSQL. The `name="message_role"` must match between model definition and Alembic-generated migration.
- `content` is nullable because tool_call messages may store arguments in `tool_arguments` (JSONB) rather than text, and summary messages have their text in `content`.
- `sequence` is non-nullable integer â€” set by application code when inserting a message. It is the 0-based position within the conversation. The composite index `(conversation_id, sequence)` serves the primary query pattern: "give me all messages for conversation X ordered by sequence."
- `tool_arguments` is JSONB (not JSON) â€” JSONB is indexed and queryable, which is important for visibility queries. Per spec (Â§9.2), tool_arguments is a structured object.
- All provider/model fields are nullable because they only apply to assistant messages.
- The `visibility_record` relationship uses `uselist=False` (one-to-one). `cascade="all, delete-orphan"` means deleting a Message cascades to its VisibilityRecord.

### Step 6d: `src/backend/models/visibility.py`

**File:** `C:\Code\wayne_bot\src\backend\models\visibility.py`

```python
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.backend.models.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from src.backend.models.message import Message


class VisibilityRecord(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "visibility_records"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    request_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    response_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tokens_openai: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_anthropic: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_openrouter: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    context_window_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_token_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_event: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    tool_trace: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Relationship
    message: Mapped[Message] = relationship(
        "Message",
        back_populates="visibility_record",
    )
```

**Key decisions:**
- `message_id` has `unique=True` enforcing the one-to-one constraint at the database level, matching the spec (Â§9.3 "one-to-one with assistant messages").
- `request_payload` is non-nullable (`nullable=False`) â€” this is the most important field in the table; a visibility record without a payload is useless and indicates a bug.
- All token counts are nullable because non-active-provider counts are populated asynchronously after the response is delivered (spec Â§4.3). They start null and get backfilled.
- `reasoning_content` uses `Text` rather than JSONB because reasoning output is freeform text, not a structured document.
- `summary_event` and `tool_trace` are JSONB because they have structure that the visibility UI will need to traverse. Using JSONB allows efficient partial queries via PostgreSQL JSON operators in future.
- `three tokens_*` columns (openai, anthropic, openrouter) match spec Â§6.2 "Three provider token counts."

### Step 6e: `src/backend/models/rolling_summary.py`

**File:** `C:\Code\wayne_bot\src\backend\models\rolling_summary.py`

```python
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import ForeignKey

from src.backend.models.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from src.backend.models.conversation import Conversation


class RollingSummary(Base, UUIDPrimaryKeyMixin, CreatedAtMixin):
    __tablename__ = "rolling_summaries"

    __table_args__ = (
        Index("ix_rolling_summaries_conversation_created", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    summary_text: Mapped[str] = mapped_column(Text, nullable=False)
    summarized_message_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)),
        nullable=False,
    )
    tokens_before: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_after: Mapped[int] = mapped_column(Integer, nullable=False)
    model_used: Mapped[str] = mapped_column(String(100), nullable=False)

    # Relationship
    conversation: Mapped[Conversation] = relationship(
        "Conversation",
        back_populates="rolling_summaries",
    )
```

**Key decisions:**
- `summarized_message_ids` uses PostgreSQL's `ARRAY(UUID)` type. This is the cleanest representation of an ordered list of UUIDs and avoids a join table. PostgreSQL has full support for array operations (GIN indexes, `@>` containment, `= ANY()` queries).
- `tokens_before` and `tokens_after` are non-nullable â€” they are required by spec (Â§9.4) and are the core observability data for the summary event.
- `model_used` is non-nullable â€” always recorded which model performed the summary (always `gpt-5-nano` in v1 per spec Â§3.3, but stored explicitly for forward compatibility).
- Composite index on `(conversation_id, created_at)` supports the query pattern "get all summaries for conversation X in chronological order."

### Step 6f: `src/backend/models/__init__.py`

**File:** `C:\Code\wayne_bot\src\backend\models\__init__.py`

```python
"""ORM model package for Wayne backend.

Importing this package makes all models available and registers them
with the SQLAlchemy metadata, which is required for Alembic autogenerate.
"""

from src.backend.models.base import Base
from src.backend.models.conversation import Conversation
from src.backend.models.message import Message, MessageRole
from src.backend.models.rolling_summary import RollingSummary
from src.backend.models.visibility import VisibilityRecord

__all__ = [
    "Base",
    "Conversation",
    "Message",
    "MessageRole",
    "RollingSummary",
    "VisibilityRecord",
]
```

**Critical:** This `__init__.py` must import all model classes. Alembic's `env.py` will import `Base` and call `Base.metadata`, but SQLAlchemy only knows about a table's metadata if the ORM class has been imported at least once. If a model class is never imported, Alembic autogenerate will not detect its table. The `__init__.py` guarantees all models are imported whenever `from src.backend.models import Base` is used.

---

## Step 7: Create `src/backend/exceptions.py`

**File:** `C:\Code\wayne_bot\src\backend\exceptions.py`

```python
"""Wayne application error hierarchy.

All application-level errors inherit from WayneError. HTTP status codes
are attached to the exception class so FastAPI exception handlers can
use them without needing to know the specific error type.
"""
from __future__ import annotations


class WayneError(Exception):
    """Base class for all Wayne application errors.

    Attributes:
        status_code: HTTP status code to return when this error reaches
                     the FastAPI exception handler.
        detail: Human-readable error message for the client.
    """
    status_code: int = 500
    detail: str = "Internal server error"

    def __init__(self, detail: str | None = None) -> None:
        self.detail = detail or self.__class__.detail
        super().__init__(self.detail)


class ProviderError(WayneError):
    """An LLM provider returned an error response (e.g., rate limit, server error).

    Maps to HTTP 502 Bad Gateway â€” the provider is an upstream service.
    """
    status_code: int = 502
    detail: str = "LLM provider error"


class ProviderKeyMissing(WayneError):
    """An API key required for the requested provider is not configured.

    Maps to HTTP 422 Unprocessable Entity â€” the request cannot be
    fulfilled with the current configuration.
    """
    status_code: int = 422
    detail: str = "API key not configured for this provider"


class ToolExecutionError(WayneError):
    """A tool (e.g., web search) failed during execution.

    Maps to HTTP 502 Bad Gateway â€” tools typically call external services.
    """
    status_code: int = 502
    detail: str = "Tool execution failed"


class TokenCountError(WayneError):
    """Token counting failed for a provider.

    Maps to HTTP 500 â€” this is an internal operation failure.
    """
    status_code: int = 500
    detail: str = "Token counting failed"
```

**Key decisions:**
- `status_code` and `detail` are class-level attributes, not instance attributes. This means `ProviderError.status_code` works without instantiation, useful for exception handlers.
- `__init__` accepts an optional `detail` override. This allows raising `ProviderError("OpenAI returned 429 â€” rate limit exceeded")` with a specific message while keeping the default for generic cases.
- Error classes have no additional fields for now. Future units (B, C, D) can subclass these with provider-specific fields.
- `ToolExecutionError` and `ProviderError` both return 502 because they both represent "an upstream service failed."

---

## Step 8: Create `src/backend/services/system_prompt.py`

**File:** `C:\Code\wayne_bot\src\backend\services\system_prompt.py`

This implements spec Â§7.1: a single hardcoded system prompt, provider-agnostic, under 500 tokens, identifying the assistant as Wayne.

```python
"""System prompt service for Wayne.

Provides the global system prompt that is prepended to every conversation.
The prompt is hardcoded (not user-configurable in v1 per spec Â§7.1) and
designed to be provider-agnostic â€” it works equally well with OpenAI,
Anthropic, and OpenRouter models.
"""
from __future__ import annotations

SYSTEM_PROMPT = """You are Wayne, a personal AI assistant. You help with research, analysis, writing, coding, and general questions.

Communication style:
- Be direct and concise. Get to the point without unnecessary preamble.
- Be thorough when thoroughness is warranted. Don't oversimplify complex topics.
- Use markdown formatting where it improves clarity: headers for structure, code blocks for code, bullet lists for enumerated items.
- Do not use filler phrases like "Certainly!", "Of course!", "Great question!", or similar.
- When you are uncertain, say so explicitly rather than hedging vaguely.

Capabilities:
- You have access to a web search tool. Use it when the question requires current information, specific facts, or when your knowledge may be outdated.
- Cite sources inline when using search results (e.g., [Source](url)).

Limitations:
- You do not have access to the user's files, email, calendar, or other personal data in this version.
- You cannot execute code, access external systems, or take actions beyond web search.

Be helpful, honest, and accurate."""


def get_system_prompt() -> str:
    """Return the global system prompt for Wayne.

    Returns a string suitable for use as the 'system' role message
    in any provider's API (OpenAI, Anthropic, OpenRouter).
    """
    return SYSTEM_PROMPT
```

**Token estimate:** This prompt is approximately 210-230 tokens (OpenAI tiktoken), well under the 500-token spec limit (Â§7.1). If the prompt is expanded in future, check against this limit before committing.

**Key decisions:**
- `get_system_prompt()` is a function rather than a module-level constant import, which makes it easy to swap out the implementation in future (e.g., load from a file, load from the database) without changing all call sites.
- The prompt is deliberately minimal and factual. No personality gimmicks, no roleplay setup (per spec Â§7.1). It establishes Wayne's name, communication style, capabilities, and limitations.
- The tool mention ("You have access to a web search tool") is included so that all three providers understand the tool context. Without this, some models are more reluctant to use tools.

---

## Step 9: Create `src/backend/main.py`

**File:** `C:\Code\wayne_bot\src\backend\main.py`

This is the FastAPI application factory with lifespan management, CORS configuration, and route mounting. In Unit F it has only a health check route; route modules from other units will be mounted here.

```python
"""Wayne FastAPI application factory.

This module defines the FastAPI app instance with:
- Lifespan context for startup/shutdown (database connection lifecycle)
- CORS middleware for the React frontend
- Health check endpoint
- Route mounting (expanded in later units)
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.backend.config import settings
from src.backend.database import engine
from src.backend.exceptions import WayneError
from src.backend.routes import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle: startup and shutdown events."""
    # Startup: verify DB connection is reachable
    async with engine.connect() as conn:
        await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
    yield
    # Shutdown: dispose of all connection pool connections
    await engine.dispose()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    app = FastAPI(
        title="Wayne Bot API",
        description="Personal AI assistant backend",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS â€” allow the React dev server (and future production origin)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Global exception handler for WayneError subclasses
    @app.exception_handler(WayneError)
    async def wayne_error_handler(request, exc: WayneError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    # Mount API routes
    app.include_router(api_router, prefix="/api")

    return app


app = create_app()
```

**Key decisions:**
- The `lifespan` context manager replaces the deprecated `on_event("startup")` / `on_event("shutdown")` pattern. At startup it verifies the DB is reachable with `SELECT 1` â€” if Docker Compose isn't running, the app fails fast with a clear error rather than silently accepting connections that will fail later.
- `create_app()` factory function is used instead of a module-level `app = FastAPI(...)`. This enables test code to call `create_app()` to get a fresh application instance, and allows overriding settings (e.g., pointing to a test database) before the app is created.
- The `WayneError` exception handler maps any exception in the hierarchy to its `status_code` and `detail`, making error handling uniform across all routes.
- `app = create_app()` at module level is what `uvicorn src.backend.main:app` references. Tests can call `create_app()` directly.

---

## Step 10: Create `src/backend/routes/__init__.py`

**File:** `C:\Code\wayne_bot\src\backend\routes\__init__.py`

In Unit F this only needs a health endpoint. Other route modules (conversations, messages, visibility) will be added in subsequent units and imported here.

```python
"""API routes package for Wayne backend.

This module assembles all route sub-modules into a single APIRouter
that gets mounted at /api in main.py.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", tags=["system"])
async def health_check() -> dict[str, str]:
    """Liveness probe. Returns 200 if the backend is running."""
    return {"status": "ok"}
```

**Key decisions:**
- Single `router` object at module level. When subsequent units add route modules, they will import their sub-router and do `router.include_router(conversations_router, prefix="/conversations", tags=["conversations"])` etc.
- The health check has no database dependency â€” it checks only that the process is running. A deeper "readiness" probe that checks DB connectivity could be added later at `/api/ready`.
- `tags=["system"]` puts the health endpoint in its own group in the auto-generated OpenAPI docs.

---

## Step 11: Create Remaining `__init__.py` Files

These files are minimal stubs that make the directories importable Python packages.

### `src/backend/__init__.py`

Empty file. Just needs to exist to make `src.backend` importable.

### `src/backend/services/__init__.py`

Empty file. Just needs to exist to make `src.backend.services` importable.

### `src/backend/schemas/__init__.py`

Empty file plus a brief comment. In Unit F there are no schemas yet; they will be added in Units B/C/D. The file exists to make the package importable.

```python
"""Pydantic schemas for Wayne API request/response validation.

Schemas are defined per-domain in subsequent units.
"""
```

---

## Step 12: Configure Alembic

### Step 12a: Initialize Alembic

Run the following from the project root:

```bash
poetry run alembic init src/backend/migrations
```

This creates:
- `alembic.ini` in the project root
- `src/backend/migrations/env.py`
- `src/backend/migrations/script.py.mako`
- `src/backend/migrations/versions/` (empty directory)

### Step 12b: Update `alembic.ini`

**File:** `C:\Code\wayne_bot\alembic.ini`

After `alembic init`, change the `sqlalchemy.url` line and the `script_location` line:

```ini
# The migrations directory (relative to this ini file)
script_location = src/backend/migrations

# Database URL â€” overridden in env.py to use settings, but required here as fallback
sqlalchemy.url = postgresql+asyncpg://wayne:wayne@localhost:5432/wayne
```

The rest of `alembic.ini` can remain at defaults. The key change is `script_location` pointing into `src/backend/migrations/`.

### Step 12c: Update `src/backend/migrations/env.py`

**File:** `C:\Code\wayne_bot\src\backend\migrations\env.py`

This is the most critical Alembic configuration file. Replace the generated content with:

```python
"""Alembic environment configuration for Wayne.

This file configures:
- The database URL from Pydantic Settings (not hardcoded in alembic.ini)
- The target metadata from all ORM models (for autogenerate)
- Async engine support via run_async_migrations()
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from src.backend.config import settings
# Import all models to register them with Base.metadata (required for autogenerate)
from src.backend.models import Base  # noqa: F401  (imports all models via __init__.py)

# Alembic Config object â€” access alembic.ini settings
config = context.config

# Set up Python logging from alembic.ini [loggers] section
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# This is the metadata object autogenerate inspects to find model definitions
target_metadata = Base.metadata

# Override the sqlalchemy.url from alembic.ini with the value from settings
# This ensures migrations always use the same URL as the running application
config.set_main_option("sqlalchemy.url", settings.database_url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (generate SQL without a live DB connection).

    Useful for generating migration scripts to review before applying.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations using an async engine (required for asyncpg driver)."""
    connectable = create_async_engine(settings.database_url)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def do_run_migrations(connection) -> None:
    """Execute migrations within a sync context (called by run_sync)."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,   # Detect column type changes during autogenerate
        compare_server_default=True,  # Detect server_default changes
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode with a live DB connection."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

**Key decisions:**
- `from src.backend.models import Base` triggers the model `__init__.py`, which imports all four model classes. This registers all tables with `Base.metadata`, which is what Alembic reads during autogenerate.
- `config.set_main_option("sqlalchemy.url", settings.database_url)` overrides the URL in `alembic.ini` with the value from Pydantic Settings (which reads from `.env`). This means you only configure the URL in one place (`.env` or `settings.py`).
- `run_async_migrations()` is required because `asyncpg` is an async-only driver. Alembic's default `env.py` template uses a synchronous engine. The async pattern (`connection.run_sync(do_run_migrations)`) is the official Alembic recommendation for async drivers.
- `compare_type=True` â€” without this, Alembic will not detect column type changes (e.g., VARCHAR(100) to VARCHAR(200)) during autogenerate.
- `asyncio.run(run_async_migrations())` â€” using `asyncio.run` rather than getting an existing event loop is correct for Alembic's offline migration runner, which runs in a plain Python context (not an already-running async context).

### Step 12d: Update `src/backend/migrations/script.py.mako`

The default template generated by `alembic init` is sufficient. No changes needed. It controls the header of generated migration files.

### Step 12e: Generate the Initial Migration

After all models are defined:

```bash
poetry run alembic revision --autogenerate -m "initial_schema"
```

This creates `src/backend/migrations/versions/<hash>_initial_schema.py`.

**Review the generated migration carefully before applying.** Things to verify:
1. All four tables are created: `conversations`, `messages`, `visibility_records`, `rolling_summaries`
2. The `message_role` ENUM type is created before the `messages` table
3. All indexes are created (check for `op.create_index` calls)
4. `ARRAY(UUID)` is present for `rolling_summaries.summarized_message_ids`
5. All `JSONB` columns are present (not `JSON`)
6. All `TIMESTAMPTZ` columns use `timezone=True` in the `sa.DateTime` call
7. Foreign key constraints include `ondelete="CASCADE"`

If any of these are wrong, manually edit the migration file to correct them rather than re-running autogenerate.

**Apply the migration:**

```bash
poetry run alembic upgrade head
```

**Verify:**

```bash
docker exec wayne_postgres psql -U wayne -d wayne -c "\dt"
# Should list: conversations, messages, rolling_summaries, visibility_records

docker exec wayne_postgres psql -U wayne -d wayne -c "\d messages"
# Should show all columns including the message_role enum and JSONB columns
```

---

## Step 13: Create Test Infrastructure

### Step 13a: `tests/conftest.py`

**File:** `C:\Code\wayne_bot\tests\conftest.py`

```python
"""Pytest configuration and shared fixtures for Wayne backend tests.

Provides:
- A test database session that uses transactions with rollback for isolation
- A FastAPI TestClient with the async engine configured for the test DB
- An async test session factory
"""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Point tests at the same DB URL as dev by default.
# In CI, set TEST_DATABASE_URL to a separate test database.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://wayne:wayne@localhost:5432/wayne",
)

# Override the settings database_url BEFORE importing the app,
# so the app's engine is created with the test URL.
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from src.backend.database import AsyncSessionLocal  # noqa: E402
from src.backend.main import create_app  # noqa: E402
from src.backend.models import Base  # noqa: E402, F401


@pytest.fixture(scope="session")
def test_engine():
    """Create a single async engine for the entire test session."""
    return create_async_engine(TEST_DATABASE_URL, echo=False)


@pytest_asyncio.fixture(scope="function")
async def db_session(test_engine) -> AsyncSession:
    """Provide an async database session with transaction rollback for test isolation.

    Each test gets a fresh transaction that is rolled back at the end,
    so tests do not affect each other and no cleanup is needed.
    """
    async with test_engine.begin() as conn:
        # Run all DDL to ensure tables exist
        await conn.run_sync(Base.metadata.create_all)

    async with test_engine.connect() as conn:
        await conn.begin_nested()
        session_factory = async_sessionmaker(
            bind=conn,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
        async with session_factory() as session:
            yield session
            await session.rollback()


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncClient:
    """Provide an async HTTP client for FastAPI endpoint testing.

    The client is wired to the same db_session as the test, so
    assertions about DB state in tests reflect what routes actually wrote.
    """
    from src.backend.database import get_db

    app = create_app()

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as ac:
        yield ac
```

**Key decisions:**
- `os.environ["DATABASE_URL"] = TEST_DATABASE_URL` must happen before `from src.backend.main import create_app`. This is why the env override is at the top of the file, before the app imports.
- `Base.metadata.create_all` in the `db_session` fixture ensures tables exist. This means tests can run against a fresh database (or a database that has had `alembic upgrade head` applied â€” both work).
- The nested transaction pattern (`conn.begin_nested()` + rollback) ensures test isolation without truncating tables. Each test function gets a fresh savepoint; rollback on teardown resets state.
- `dependency_overrides[get_db]` is FastAPI's built-in mechanism for replacing dependencies in tests. The test routes will use the same `db_session` as the test assertions.
- `httpx.AsyncClient` with `ASGITransport` is the modern replacement for FastAPI's `TestClient` in async tests. `TestClient` wraps the app in a thread and cannot easily share the same async session.

### Step 13b: `tests/factories.py`

**File:** `C:\Code\wayne_bot\tests\factories.py`

```python
"""Test data factories for creating ORM model instances in tests.

These are plain Python functions (not using factory_boy) to keep
dependencies minimal. Each factory creates an instance and adds it
to the provided session without committing (the test fixture handles
transaction lifecycle).
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.backend.models.conversation import Conversation
from src.backend.models.message import Message, MessageRole
from src.backend.models.rolling_summary import RollingSummary
from src.backend.models.visibility import VisibilityRecord


async def make_conversation(
    db: AsyncSession,
    title: str | None = None,
    last_model_id: str = "gpt-5-nano",
    last_provider: str = "openai",
) -> Conversation:
    """Create and persist a Conversation instance."""
    conv = Conversation(
        title=title,
        last_model_id=last_model_id,
        last_provider=last_provider,
    )
    db.add(conv)
    await db.flush()  # Get the DB-assigned id without committing
    return conv


async def make_message(
    db: AsyncSession,
    conversation: Conversation,
    role: MessageRole = MessageRole.USER,
    content: str = "Test message content",
    sequence: int = 0,
    model_id: str | None = None,
    provider: str | None = None,
) -> Message:
    """Create and persist a Message instance."""
    msg = Message(
        conversation_id=conversation.id,
        role=role,
        content=content,
        sequence=sequence,
        model_id=model_id,
        provider=provider,
    )
    db.add(msg)
    await db.flush()
    return msg


async def make_visibility_record(
    db: AsyncSession,
    message: Message,
    request_payload: dict | None = None,
) -> VisibilityRecord:
    """Create and persist a VisibilityRecord instance."""
    record = VisibilityRecord(
        message_id=message.id,
        request_payload=request_payload or {"messages": [], "model": "gpt-5-nano"},
    )
    db.add(record)
    await db.flush()
    return record


async def make_rolling_summary(
    db: AsyncSession,
    conversation: Conversation,
    summary_text: str = "Summary of the conversation so far.",
    tokens_before: int = 10000,
    tokens_after: int = 2000,
    model_used: str = "gpt-5-nano",
    summarized_message_ids: list[uuid.UUID] | None = None,
) -> RollingSummary:
    """Create and persist a RollingSummary instance."""
    summary = RollingSummary(
        conversation_id=conversation.id,
        summary_text=summary_text,
        summarized_message_ids=summarized_message_ids or [uuid.uuid4(), uuid.uuid4()],
        tokens_before=tokens_before,
        tokens_after=tokens_after,
        model_used=model_used,
    )
    db.add(summary)
    await db.flush()
    return summary
```

**Key decisions:**
- `await db.flush()` after each `db.add()` â€” this writes to the transaction without committing, giving us back the DB-generated `id` (from `server_default=uuid4` or sequences). This is required to use the id in subsequent operations within the same test.
- No `factory_boy` or `faker` dependency â€” plain functions keep the test infrastructure minimal and explicit. Factory_boy adds complexity that is not worth it for a small test suite.
- All factory functions take `db: AsyncSession` as the first argument and are `async`. This matches the test fixture pattern and makes them easy to call from async test functions.
- Default values are sensible but overridable. Tests that care about specific values pass them explicitly; tests that just need "a conversation exists" use defaults.

---

## Step 14: Create Initial Tests

### `tests/__init__.py`

Empty file. Makes the `tests` directory a Python package, which is required for some import resolution scenarios.

### `tests/test_foundation.py`

**File:** `C:\Code\wayne_bot\tests\test_foundation.py`

```python
"""Foundation unit tests â€” verifies DB connectivity, ORM, and health endpoint."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import make_conversation, make_message
from src.backend.models.conversation import Conversation
from src.backend.models.message import MessageRole


class TestDatabaseConnectivity:
    """Verify that the async database connection works correctly."""

    async def test_db_session_is_usable(self, db_session: AsyncSession) -> None:
        """Confirm the test session can execute a simple query."""
        result = await db_session.execute(text("SELECT 1 AS value"))
        row = result.fetchone()
        assert row is not None
        assert row.value == 1

    async def test_conversations_table_exists(self, db_session: AsyncSession) -> None:
        """Confirm the conversations table was created by Alembic."""
        result = await db_session.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_name = 'conversations'")
        )
        assert result.fetchone() is not None

    async def test_messages_table_exists(self, db_session: AsyncSession) -> None:
        result = await db_session.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_name = 'messages'")
        )
        assert result.fetchone() is not None


class TestConversationORM:
    """Verify that the Conversation ORM model works correctly."""

    async def test_create_conversation(self, db_session: AsyncSession) -> None:
        """Create a conversation and retrieve it by id."""
        conv = await make_conversation(db_session, title="Test Conversation")
        assert conv.id is not None
        assert conv.title == "Test Conversation"
        assert conv.last_model_id == "gpt-5-nano"
        assert conv.created_at is not None

    async def test_create_conversation_without_title(self, db_session: AsyncSession) -> None:
        """Conversations can be created without a title (auto-title is set later)."""
        conv = await make_conversation(db_session, title=None)
        assert conv.id is not None
        assert conv.title is None

    async def test_conversation_with_messages(self, db_session: AsyncSession) -> None:
        """Create a conversation with a user message and assistant message."""
        conv = await make_conversation(db_session, title="Chat about Python")
        user_msg = await make_message(
            db_session, conv, role=MessageRole.USER, content="What is Python?", sequence=0
        )
        assistant_msg = await make_message(
            db_session, conv, role=MessageRole.ASSISTANT, content="Python is a language.", sequence=1,
            model_id="gpt-5-nano", provider="openai"
        )

        assert user_msg.conversation_id == conv.id
        assert assistant_msg.conversation_id == conv.id
        assert assistant_msg.sequence > user_msg.sequence

    async def test_delete_conversation_cascades_messages(self, db_session: AsyncSession) -> None:
        """Deleting a conversation should delete all its messages (ON DELETE CASCADE)."""
        conv = await make_conversation(db_session)
        msg = await make_message(db_session, conv, sequence=0)
        conv_id = conv.id
        msg_id = msg.id

        await db_session.delete(conv)
        await db_session.flush()

        # Message should no longer exist
        result = await db_session.execute(
            text("SELECT id FROM messages WHERE id = :id"),
            {"id": str(msg_id)}
        )
        assert result.fetchone() is None


class TestHealthEndpoint:
    """Verify the /api/health endpoint."""

    async def test_health_returns_200(self, client: AsyncClient) -> None:
        response = await client.get("/api/health")
        assert response.status_code == 200

    async def test_health_returns_ok_status(self, client: AsyncClient) -> None:
        response = await client.get("/api/health")
        data = response.json()
        assert data == {"status": "ok"}
```

---

## Step 15: Final Verification Sequence

Run these commands in order to verify the complete unit:

```bash
# 1. Start PostgreSQL
docker compose up -d
docker compose ps   # Confirm wayne_postgres is Up

# 2. Install dependencies
poetry install

# 3. Apply migrations (must have run alembic revision --autogenerate first)
poetry run alembic upgrade head

# 4. Verify tables exist
docker exec wayne_postgres psql -U wayne -d wayne -c "\dt"
# Expected output:
#  Schema |        Name         | Type  | Owner
# --------+---------------------+-------+-------
#  public | conversations       | table | wayne
#  public | messages            | table | wayne
#  public | rolling_summaries   | table | wayne
#  public | visibility_records  | table | wayne

# 5. Run tests
poetry run pytest tests/ -v
# Expected: All tests in TestDatabaseConnectivity, TestConversationORM,
#           and TestHealthEndpoint pass.

# 6. Start the development server
poetry run uvicorn src.backend.main:app --reload --host 0.0.0.0 --port 8000

# 7. In another terminal, verify health endpoint
curl http://localhost:8000/api/health
# Expected: {"status":"ok"}

# 8. Check OpenAPI docs
# Open http://localhost:8000/docs in browser
# Should show 1 endpoint: GET /api/health
```

---

## File Creation Order and Dependencies

The files must be created in this order to avoid import errors during development and testing:

1. `pyproject.toml` â€” dependencies must be installed first
2. `docker-compose.yml` â€” needed before any DB operations
3. `.env.example` / `.env` â€” needed before config
4. `src/backend/config.py` â€” no internal dependencies
5. `src/backend/exceptions.py` â€” no internal dependencies
6. `src/backend/models/base.py` â€” no internal dependencies
7. `src/backend/models/conversation.py` â€” depends on base
8. `src/backend/models/message.py` â€” depends on base
9. `src/backend/models/visibility.py` â€” depends on base
10. `src/backend/models/rolling_summary.py` â€” depends on base
11. `src/backend/models/__init__.py` â€” imports all models
12. `src/backend/database.py` â€” depends on config
13. `src/backend/services/system_prompt.py` â€” no dependencies
14. `src/backend/routes/__init__.py` â€” no internal dependencies beyond FastAPI
15. `src/backend/main.py` â€” depends on config, database, exceptions, routes
16. `src/backend/__init__.py`, `src/backend/services/__init__.py`, `src/backend/schemas/__init__.py` â€” empty stubs
17. `alembic.ini` + `src/backend/migrations/env.py` + `src/backend/migrations/script.py.mako` â€” after all models exist
18. Run `alembic revision --autogenerate` â€” generates the migration file
19. `tests/conftest.py` â€” depends on all backend modules
20. `tests/factories.py` â€” depends on models
21. `tests/test_foundation.py` â€” depends on conftest and factories

---

## Common Pitfalls and How to Avoid Them

**Pitfall 1: Alembic cannot find models**
Symptom: `alembic revision --autogenerate` generates an empty migration (no table creation).
Cause: `Base.metadata` is empty because models were never imported.
Fix: Ensure `src/backend/migrations/env.py` imports from `src.backend.models`, not from `src.backend.models.base` directly. The `__init__.py` is what triggers all model imports.

**Pitfall 2: `asyncpg` driver not found**
Symptom: `Could not load backend asyncpg: No module named 'asyncpg'`
Fix: Run `poetry install`. If asyncpg is listed in `pyproject.toml` but still not found, check that Poetry's venv is the active Python environment (`poetry env info`).

**Pitfall 3: `MESSAGE_ROLE` enum type conflict**
Symptom: `psycopg2.errors.DuplicateObject: type "message_role" already exists`
Fix: This happens if `alembic upgrade head` is run twice or the enum type exists from a previous schema. Either drop the database entirely (`docker compose down -v`) or add a `IF NOT EXISTS` guard. The cleanest solution for dev is `docker compose down -v && docker compose up -d && alembic upgrade head`.

**Pitfall 4: `ImportError: attempted relative import beyond top-level package`**
Symptom: Running `alembic upgrade head` fails with an import error.
Cause: Alembic runs from the project root, but `src.backend.config` may not be on `sys.path`.
Fix: Run alembic from the project root with `poetry run alembic upgrade head`, not from inside the `src/` directory. Poetry's venv sets up the path correctly.

**Pitfall 5: pytest cannot find `conftest.py`**
Symptom: Fixtures not recognized, or `db_session` fixture not found.
Fix: Ensure `[tool.pytest.ini_options] testpaths = ["tests"]` is in `pyproject.toml`. Run `poetry run pytest tests/ -v` from the project root.

**Pitfall 6: `asyncio_mode` not recognized**
Symptom: `PytestUnraisableExceptionWarning` or async tests not running.
Fix: Ensure `pytest-asyncio >= 0.21` is installed and `asyncio_mode = "auto"` is set in `[tool.pytest.ini_options]` in `pyproject.toml`.

---

### Critical Files for Implementation

- `C:\Code\wayne_bot\src\backend\migrations\env.py` - Core Alembic configuration requiring async engine setup and model import order; errors here prevent migrations from running
- `C:\Code\wayne_bot\src\backend\models\__init__.py` - Must import all four model classes to register them with Base.metadata; omitting any model causes Alembic to miss that table entirely
- `C:\Code\wayne_bot\src\backend\database.py` - Async engine and session factory; the `get_db` dependency is used by every route in every subsequent unit
- `C:\Code\wayne_bot\tests\conftest.py` - Test session isolation pattern; sets up the nested transaction rollback and FastAPI dependency override that all subsequent unit tests inherit
- `C:\Code\wayne_bot\pyproject.toml` - Dependency declarations and pytest configuration; wrong versions here cause cascading failures across the entire project