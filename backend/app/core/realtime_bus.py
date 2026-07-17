"""Redis pub/sub bridge for realtime events across API instances and Celery workers."""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Callable

from app.core.redis_client import get_redis_client, redis_ping

logger = logging.getLogger(__name__)

CHANNEL = "flowdesk:realtime"
_RECONNECT_DELAY_SEC = 5
_bus: RealtimeBus | None = None


class RealtimeBus:
    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._listener_thread: threading.Thread | None = None
        self._stop = threading.Event()

    @property
    def enabled(self) -> bool:
        return bool(self._redis_url.strip())

    def ping(self) -> bool:
        if not self.enabled:
            return False
        return redis_ping()

    def publish(self, rooms: list[str], message: dict[str, Any]) -> bool:
        client = get_redis_client()
        if client is None:
            return False
        try:
            payload = json.dumps({"rooms": rooms, "message": message}, default=str)
            client.publish(CHANNEL, payload)
            return True
        except Exception:
            logger.exception("Realtime bus publish failed")
            return False

    def start_listener(self, handler: Callable[[list[str], dict[str, Any]], None]) -> None:
        if self._listener_thread and self._listener_thread.is_alive():
            return

        def _listen() -> None:
            import redis

            while not self._stop.is_set():
                client = None
                pubsub = None
                try:
                    pool_client = get_redis_client()
                    if pool_client is None:
                        return
                    client = redis.Redis(connection_pool=pool_client.connection_pool)
                    pubsub = client.pubsub(ignore_subscribe_messages=True)
                    pubsub.subscribe(CHANNEL)
                    logger.info("Realtime bus listening on %s", CHANNEL)
                    while not self._stop.is_set():
                        msg = pubsub.get_message(timeout=1.0)
                        if msg is None or msg.get("type") != "message":
                            continue
                        try:
                            data = json.loads(msg["data"])
                            handler(data["rooms"], data["message"])
                        except Exception:
                            logger.exception("Realtime bus message handling failed")
                except Exception:
                    logger.exception("Realtime bus listener error — reconnecting in %ss", _RECONNECT_DELAY_SEC)
                    if self._stop.wait(_RECONNECT_DELAY_SEC):
                        break
                finally:
                    if pubsub is not None:
                        try:
                            pubsub.unsubscribe(CHANNEL)
                            pubsub.close()
                        except Exception:
                            pass
                    if client is not None:
                        try:
                            client.close()
                        except Exception:
                            pass
                if not self._stop.is_set():
                    time.sleep(_RECONNECT_DELAY_SEC)

        self._listener_thread = threading.Thread(
            target=_listen, name="realtime-bus", daemon=True
        )
        self._listener_thread.start()

    def stop_listener(self) -> None:
        self._stop.set()
        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=5)


def get_realtime_bus() -> RealtimeBus:
    global _bus
    if _bus is None:
        from app.core.config import settings

        _bus = RealtimeBus(settings.REDIS_URL)
    return _bus
