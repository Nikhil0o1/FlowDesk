"""Structured API errors for PAT authentication (stable machine-readable codes)."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


def error_body(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}


INVALID_CREDENTIALS = error_body(
    "invalid_credentials",
    "Invalid authentication credentials.",
)
PAT_NOT_ALLOWED = error_body(
    "pat_not_allowed",
    "This endpoint does not support API token authentication.",
)
INSUFFICIENT_SCOPE = error_body(
    "insufficient_scope",
    "The API token does not have the required scope.",
)
RATE_LIMITED = error_body(
    "rate_limited",
    "Rate limit exceeded. Retry after the indicated delay.",
)
SERVICE_UNAVAILABLE = error_body(
    "service_unavailable",
    "Authentication rate limiting temporarily unavailable.",
)


class PatApiError(Exception):
    def __init__(self, status_code: int, body: dict[str, Any], *, headers: dict[str, str] | None = None):
        self.status_code = status_code
        self.body = body
        self.headers = headers or {}
        super().__init__(body.get("error", {}).get("message", "error"))


async def pat_api_error_handler(_request: Request, exc: PatApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.body, headers=exc.headers)
