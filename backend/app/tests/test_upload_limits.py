"""Regression tests for issue #10 — upload memory-exhaustion DoS."""
from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException, UploadFile
from io import BytesIO
from starlette.requests import Request

from app.core.config import settings
from app.core.request_body_limit import RequestBodyLimitMiddleware, reject_content_length
from app.services.upload_service import max_attachment_bytes, read_bounded_upload


def _make_request(content_length: str | None) -> Request:
    headers = []
    if content_length is not None:
        headers.append((b"content-length", content_length.encode()))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/test",
        "headers": headers,
        "query_string": b"",
        "client": ("127.0.0.1", 12345),
        "server": ("test", 80),
        "scheme": "http",
        "root_path": "",
    }
    return Request(scope)


def test_reject_content_length_over_limit():
    max_bytes = 1024
    request = _make_request("2048")
    with pytest.raises(HTTPException) as exc:
        reject_content_length(request, max_bytes)
    assert exc.value.status_code == 413


def test_reject_content_length_allows_under_limit():
    reject_content_length(_make_request("512"), 1024)


def test_reject_content_length_skips_missing_header():
    reject_content_length(_make_request(None), 1024)


def test_read_bounded_upload_accepts_small_file():
    payload = b"hello"
    file = UploadFile(filename="ok.txt", file=BytesIO(payload))
    assert asyncio.run(read_bounded_upload(file, 1024)) == payload


def test_read_bounded_upload_rejects_oversize():
    file = UploadFile(filename="big.bin", file=BytesIO(b"x" * 2048))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(read_bounded_upload(file, 1024))
    assert exc.value.status_code == 413


def test_read_bounded_upload_rejects_empty():
    file = UploadFile(filename="empty.txt", file=BytesIO(b""))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(read_bounded_upload(file, 1024))
    assert exc.value.status_code == 400


def test_max_request_body_bytes_includes_overhead():
    expected = (settings.MAX_UPLOAD_SIZE_MB + settings.UPLOAD_MULTIPART_OVERHEAD_MB) * 1024 * 1024
    assert settings.max_request_body_bytes == expected
    assert max_attachment_bytes() < settings.max_request_body_bytes


def test_middleware_rejects_oversized_content_length():
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route
    from starlette.testclient import TestClient

    async def ok(request):
        return PlainTextResponse("ok")

    inner = Starlette(routes=[Route("/upload", ok, methods=["POST"])])
    app = RequestBodyLimitMiddleware(inner, max_body_bytes=1024)
    client = TestClient(app)
    response = client.post("/upload", content=b"x" * 10, headers={"Content-Length": "2048"})
    assert response.status_code == 413
