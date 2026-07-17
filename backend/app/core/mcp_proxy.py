"""Reverse-proxy the FlowDesk MCP Node sidecar when colocated with the API."""

from __future__ import annotations

import logging

import httpx
from fastapi import FastAPI, Request, Response
from starlette.responses import StreamingResponse

from app.core.config import settings

logger = logging.getLogger(__name__)

HOP_BY_HOP_REQUEST = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
    }
)

HOP_BY_HOP_RESPONSE = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
    }
)

PROXY_TIMEOUT = httpx.Timeout(300.0, connect=10.0)


def _forward_headers(request: Request) -> dict[str, str]:
    return {
        name: value
        for name, value in request.headers.items()
        if name.lower() not in HOP_BY_HOP_REQUEST
    }


def _response_headers(headers: httpx.Headers) -> dict[str, str]:
    return {
        name: value
        for name, value in headers.items()
        if name.lower() not in HOP_BY_HOP_RESPONSE
    }


def _sidecar_url(path: str, query: str | None) -> str:
    base = settings.mcp_sidecar_url.rstrip("/")
    url = f"{base}{path}"
    if query:
        url = f"{url}?{query}"
    return url


async def _proxy(request: Request, path: str) -> Response:
    url = _sidecar_url(path, request.url.query or None)
    headers = _forward_headers(request)
    body = await request.body()

    try:
        if request.method == "GET":
            client = httpx.AsyncClient(timeout=PROXY_TIMEOUT)
            req = client.build_request(request.method, url, headers=headers)
            response = await client.send(req, stream=True)

            async def body_stream():
                try:
                    async for chunk in response.aiter_bytes():
                        yield chunk
                finally:
                    await response.aclose()
                    await client.aclose()

            return StreamingResponse(
                body_stream(),
                status_code=response.status_code,
                headers=_response_headers(response.headers),
                media_type=response.headers.get("content-type"),
            )

        async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
            response = await client.request(
                request.method,
                url,
                headers=headers,
                content=body,
            )
            return Response(
                content=response.content,
                status_code=response.status_code,
                headers=_response_headers(response.headers),
                media_type=response.headers.get("content-type"),
            )
    except httpx.ConnectError:
        logger.error("MCP sidecar unreachable at %s", settings.mcp_sidecar_url)
        return Response(
            content='{"detail":"MCP sidecar unavailable"}',
            status_code=503,
            media_type="application/json",
        )
    except httpx.HTTPError:
        logger.exception("MCP proxy error for %s %s", request.method, path)
        return Response(
            content='{"detail":"MCP proxy error"}',
            status_code=502,
            media_type="application/json",
        )


def mount_mcp_proxy(app: FastAPI) -> None:
    """Expose /mcp and /icon.png on the API host, proxied to the Node sidecar."""

    @app.api_route("/mcp", methods=["GET", "POST", "DELETE"], include_in_schema=False)
    async def proxy_mcp(request: Request) -> Response:
        return await _proxy(request, "/mcp")

    @app.api_route("/icon.png", methods=["GET"], include_in_schema=False)
    async def proxy_mcp_icon(request: Request) -> Response:
        return await _proxy(request, "/icon.png")
