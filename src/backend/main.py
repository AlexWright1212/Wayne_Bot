import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from src.backend.config import settings
from src.backend.database import engine
from src.backend.exceptions import WayneError, wayne_error_handler
from src.backend.routes.conversations import router as conversations_router
from src.backend.routes.models import router as models_router
from src.backend.routes.ws import router as ws_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: verify DB connectivity
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("Database connection verified")
    except Exception as e:
        logger.error(f"Database connection failed on startup: {e}")
        raise

    yield

    # Shutdown: dispose engine
    await engine.dispose()
    logger.info("Database engine disposed")


app = FastAPI(title="Wayne", lifespan=lifespan)

app.add_exception_handler(WayneError, wayne_error_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(models_router, prefix="/api")
app.include_router(conversations_router, prefix="/api")
app.include_router(ws_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


def run() -> None:
    uvicorn.run("src.backend.main:app", host=settings.host, port=settings.port, reload=False)
