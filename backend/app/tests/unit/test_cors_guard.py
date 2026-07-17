"""Unit tests for the outermost CORS guard middleware."""
import pytest

from app.core.cors_guard import CorsGuardMiddleware, _has_header, _header


@pytest.mark.unit
def test_header_helpers():
    scope = {"headers": [(b"Origin", b"https://app.test"), (b"X-Test", b"1")]}
    assert _header(scope, b"origin") == "https://app.test"
    assert _header(scope, b"missing") is None
    headers = [(b"Access-Control-Allow-Origin", b"https://app.test")]
    assert _has_header(headers, b"access-control-allow-origin") is True
    assert _has_header(headers, b"vary") is False


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cors_guard_skips_non_http_scopes():
    seen = []

    async def app(scope, receive, send):
        seen.append(scope["type"])

    middleware = CorsGuardMiddleware(app)
    await middleware({"type": "websocket"}, lambda: None, lambda _: None)
    assert seen == ["websocket"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cors_guard_adds_headers_for_allowed_origin(monkeypatch):
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    middleware = CorsGuardMiddleware(app)
    messages = []

    async def capture(message):
        messages.append(message)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    scope = {
        "type": "http",
        "headers": [(b"origin", b"https://app.test")],
    }
    monkeypatch.setattr("app.core.cors_guard.origin_allowed", lambda _settings, _origin: True)

    await middleware(scope, receive, capture)

    start = messages[0]
    header_map = {key.decode().lower(): value.decode() for key, value in start["headers"]}
    assert header_map["access-control-allow-origin"] == "https://app.test"
    assert header_map["access-control-allow-credentials"] == "true"
    assert header_map["vary"] == "Origin"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_cors_guard_preserves_existing_acao_header(monkeypatch):
    async def app(scope, receive, send):
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"access-control-allow-origin", b"https://existing.test")],
            }
        )

    middleware = CorsGuardMiddleware(app)
    messages = []

    async def capture(message):
        messages.append(message)

    scope = {
        "type": "http",
        "headers": [(b"origin", b"https://app.test")],
    }
    monkeypatch.setattr("app.core.cors_guard.origin_allowed", lambda _settings, _origin: True)

    await middleware(scope, lambda: None, capture)

    header_map = {key.decode().lower(): value.decode() for key, value in messages[0]["headers"]}
    assert header_map["access-control-allow-origin"] == "https://existing.test"
    assert "access-control-allow-credentials" not in header_map
