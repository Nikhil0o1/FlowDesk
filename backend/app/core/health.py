"""Production health checks for API dependencies."""
import httpx

from app.core.config import APP_NAME, settings
from app.core.realtime_bus import get_realtime_bus
from app.core.redis_client import redis_ping
from app.core.websocket import manager
from app.services import ws_ticket_service


def _mcp_sidecar_status() -> str | None:
    if not settings.mcp_colocated_enabled:
        return None
    try:
        response = httpx.get(f"{settings.mcp_sidecar_url}/health", timeout=1.5)
        return "ok" if response.status_code == 200 else "degraded"
    except httpx.HTTPError:
        return "unavailable"


def build_health_payload() -> dict:
    bus = get_realtime_bus()
    redis_configured = bus.enabled
    redis_ok = redis_ping() if redis_configured else None

    status = "ok"
    if redis_configured and redis_ok is False:
        status = "degraded"
    if settings.celery_configured and not redis_ok:
        status = "degraded"

    mcp_sidecar = _mcp_sidecar_status()
    if mcp_sidecar == "unavailable":
        status = "degraded"

    payload = {
        "status": status,
        "app": APP_NAME,
        "environment": settings.ENVIRONMENT,
        "redis": {
            "configured": redis_configured,
            "reachable": redis_ok,
        },
        "celery": {
            "configured": settings.celery_configured,
        },
        "scheduler": {
            "apscheduler": settings.use_apscheduler,
        },
        "websocket": {
            **manager.stats(),
            "ticket_redeem_failures": ws_ticket_service.redeem_failure_count(),
        },
    }
    if mcp_sidecar is not None:
        payload["mcp_sidecar"] = mcp_sidecar
    return payload
