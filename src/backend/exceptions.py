from fastapi import Request
from fastapi.responses import JSONResponse


class WayneError(Exception):
    status_code: int = 500
    detail: str = "Internal server error"

    def __init__(self, detail: str | None = None) -> None:
        self.detail = detail or self.__class__.detail
        super().__init__(self.detail)


class ProviderError(WayneError):
    status_code = 502
    detail = "LLM provider error"


class ProviderKeyMissing(WayneError):
    status_code = 422
    detail = "Provider API key is not configured"


class ToolExecutionError(WayneError):
    status_code = 502
    detail = "Tool execution failed"


class TokenCountError(WayneError):
    status_code = 500
    detail = "Token counting failed"


async def wayne_error_handler(request: Request, exc: WayneError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )
