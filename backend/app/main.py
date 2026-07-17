import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.v1.router import api_router
from app.api.v1.mcp_oauth import oauth_authorization_server_metadata, oauth_protected_resource_metadata
from app.core.api_errors import PatApiError, pat_api_error_handler
from app.core.config import APP_NAME, settings
from app.core.cors_guard import CorsGuardMiddleware
from app.core.cors_policy import cors_origin_regex
from app.core.health import build_health_payload
from app.core.lifecycle import (
    start_realtime_bus,
    start_scheduler,
    stop_services,
    validate_runtime_config,
)
from app.core.mcp_proxy import mount_mcp_proxy
from app.core.pat_route_registry import collect_pat_routes, validate_pat_inventory
from app.core.pat_usage_middleware import PatUsageMiddleware
from app.core.rate_limit import limiter
from app.core.request_body_limit import RequestBodyLimitMiddleware
from app.core.security_headers import SecurityHeadersMiddleware
from app.core.websocket import manager

logging.basicConfig(level=logging.INFO if not settings.DEBUG else logging.DEBUG)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_runtime_config()
    pat_rows = collect_pat_routes(app)
    validate_pat_inventory(pat_rows)
    logger.info("PAT allowlist routes=%s", len(pat_rows))
    logger.info("CORS allow_origins=%s regex=%s", settings.cors_origins, cors_origin_regex(settings))
    manager.set_loop(asyncio.get_running_loop())
    start_realtime_bus()

    scheduler = None
    if settings.use_apscheduler:
        scheduler = start_scheduler()
    elif settings.celery_configured:
        logger.info("Celery Beat handles scheduled jobs — APScheduler not started on API")

    yield

    stop_services(scheduler)


app = FastAPI(
    title=f"{APP_NAME} API",
    version="1.0.0",
    docs_url="/api/docs" if settings.DEBUG else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.DEBUG else None,
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(PatApiError, pat_api_error_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(PatUsageMiddleware)

if settings.trusted_host_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_host_list)

app.add_middleware(SecurityHeadersMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=cors_origin_regex(settings),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
    expose_headers=["Content-Disposition"],
    max_age=600,
)

# Reject oversized bodies before parsers buffer them (#10) — inside CORS so 413s still get ACAO.
app.add_middleware(RequestBodyLimitMiddleware, max_body_bytes=settings.max_request_body_bytes)

# Outermost — ensures ACAO survives early rejects and proxy-visible error paths.
app.add_middleware(CorsGuardMiddleware)

app.include_router(api_router)

if settings.mcp_colocated_enabled:
    mount_mcp_proxy(app)
    logger.info("MCP sidecar proxy enabled → %s", settings.mcp_sidecar_url)


@app.get("/.well-known/oauth-authorization-server")
def well_known_oauth_authorization_server():
    return oauth_authorization_server_metadata()


@app.get("/.well-known/oauth-protected-resource")
def well_known_oauth_protected_resource():
    return oauth_protected_resource_metadata()


@app.get("/.well-known/oauth-protected-resource/mcp")
def well_known_oauth_protected_resource_mcp():
    """Path-specific PRM (RFC 9728) when MCP is served at /mcp on this host."""
    return oauth_protected_resource_metadata()


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
def health():
    return build_health_payload()
