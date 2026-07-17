"""ASGI middleware — reject oversized request bodies before they buffer in RAM (issue #10)."""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings


class RequestBodyLimitMiddleware:
    """Early Content-Length check + bounded receive() wrapper."""

    def __init__(self, app: ASGIApp, max_body_bytes: int | None = None) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes or settings.max_request_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "GET").upper()
        if method in {"GET", "HEAD", "OPTIONS", "TRACE"}:
            await self.app(scope, receive, send)
            return

        content_length = _content_length(scope)
        if content_length is not None and content_length > self.max_body_bytes:
            await _reject(scope, receive, send, self.max_body_bytes)
            return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] != "http.request":
                return message
            received += len(message.get("body", b""))
            if received > self.max_body_bytes:
                if not response_started:
                    await _reject(scope, receive, send, self.max_body_bytes)
                # Drain any trailing chunks so the client finishes cleanly.
                while message.get("more_body"):
                    message = await receive()
                return {"type": "http.disconnect"}
            return message

        async def limited_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        await self.app(scope, limited_receive, limited_send)


def _content_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers", ()):
        if name.lower() == b"content-length":
            try:
                return int(value.decode())
            except ValueError:
                return None
    return None


async def _reject(scope: Scope, receive: Receive, send: Send, max_bytes: int) -> None:
    max_mb = max(1, max_bytes // (1024 * 1024))
    response = JSONResponse(
        status_code=413,
        content={"detail": f"Request body exceeds the {max_mb}MB limit"},
    )
    await response(scope, receive, send)


def reject_content_length(request: Request, max_bytes: int) -> None:
    """Endpoint-level early reject when Content-Length is known (defense in depth)."""
    raw = request.headers.get("content-length")
    if raw is None:
        return
    try:
        length = int(raw)
    except ValueError:
        return
    if length > max_bytes:
        max_mb = max(1, max_bytes // (1024 * 1024))
        from fastapi import HTTPException

        raise HTTPException(
            status_code=413,
            detail=f"Request body exceeds the {max_mb}MB limit",
        )
