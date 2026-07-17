"""Application startup/shutdown for background services."""
from __future__ import annotations

import logging

from app.core.config import settings
from app.core.migrations_check import ensure_migrations_current
from app.core.realtime_bus import get_realtime_bus
from app.core.websocket import manager

logger = logging.getLogger(__name__)


def validate_runtime_config() -> None:
    ensure_migrations_current()

    if settings.is_production:
        if not settings.SECRET_KEY.strip():
            raise RuntimeError("SECRET_KEY must be set in production")
        if settings.DEBUG:
            raise RuntimeError("DEBUG must be false in production")
        if not settings.GITHUB_WEBHOOK_SECRET.strip():
            raise RuntimeError("GITHUB_WEBHOOK_SECRET must be set in production")
        if not settings.trusted_host_list:
            logger.warning(
                "TRUSTED_HOSTS is empty in production — consider setting an explicit host allowlist"
            )
        if settings.uses_default_database_url:
            raise RuntimeError("DATABASE_URL must be explicitly set in production")



def start_realtime_bus() -> None:
    bus = get_realtime_bus()
    if not bus.enabled:
        return
    if not bus.ping():
        logger.error("REDIS_URL is set but Redis is unreachable — realtime pub/sub disabled")
        return

    def _on_event(rooms: list[str], message: dict) -> None:
        manager.broadcast_sync(rooms, message)

    bus.start_listener(_on_event)
    logger.info("Realtime bus enabled (Redis pub/sub)")


def start_scheduler():
    from workers.scheduler import start_scheduler as _start

    validate_runtime_config()
    scheduler = _start()
    logger.info("APScheduler started")
    return scheduler


def stop_services(scheduler) -> None:
    get_realtime_bus().stop_listener()
    if scheduler is not None:
        from workers.scheduler import shutdown_scheduler

        shutdown_scheduler()
