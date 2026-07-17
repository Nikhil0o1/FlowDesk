"""Coverage — RealtimeBus publish with mocked Redis client."""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.core.realtime_bus import RealtimeBus, CHANNEL


@pytest.mark.coverage
@patch("app.core.realtime_bus.get_redis_client")
def test_realtime_bus_publish_success(mock_client):
    redis = MagicMock()
    mock_client.return_value = redis
    bus = RealtimeBus("redis://localhost:6379/0")

    ok = bus.publish(["project:abc"], {"type": "sprint.updated", "sprint_id": "1"})
    assert ok is True
    payload = json.loads(redis.publish.call_args[0][1])
    assert payload["rooms"] == ["project:abc"]
    assert payload["message"]["type"] == "sprint.updated"
    redis.publish.assert_called_once_with(CHANNEL, json.dumps(payload, default=str))


@pytest.mark.coverage
@patch("app.core.realtime_bus.get_redis_client")
def test_realtime_bus_publish_handles_redis_error(mock_client):
    redis = MagicMock()
    redis.publish.side_effect = RuntimeError("connection lost")
    mock_client.return_value = redis
    bus = RealtimeBus("redis://localhost:6379/0")

    assert bus.publish(["room"], {"type": "fail"}) is False


@pytest.mark.coverage
@patch("app.core.realtime_bus.redis_ping", return_value=True)
def test_realtime_bus_ping_delegates(_mock_ping):
    bus = RealtimeBus("redis://localhost:6379/0")
    assert bus.ping() is True
