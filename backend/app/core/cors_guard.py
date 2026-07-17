"""Outermost CORS guard — adds ACAO on responses that bypass Starlette CORSMiddleware."""
from __future__ import annotations

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.core.cors_policy import origin_allowed


class CorsGuardMiddleware:
    """Belt-and-suspenders CORS headers for allowed browser origins."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        origin = _header(scope, b"origin")
        allow = origin_allowed(settings, origin)

        async def send_wrapper(message: Message) -> None:
            if allow and message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                if not _has_header(headers, b"access-control-allow-origin"):
                    headers.append((b"access-control-allow-origin", origin.encode()))
                    headers.append((b"access-control-allow-credentials", b"true"))
                    headers.append((b"vary", b"Origin"))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_wrapper)


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", ()):
        if key.lower() == name:
            return value.decode()
    return None


def _has_header(headers: list[tuple[bytes, bytes]], name: bytes) -> bool:
    lowered = name.lower()
    return any(key.lower() == lowered for key, _ in headers)
