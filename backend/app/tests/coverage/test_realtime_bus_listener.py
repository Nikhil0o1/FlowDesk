"""Coverage — realtime bus listener thread with mocked Redis."""
import json
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from app.core.realtime_bus import RealtimeBus, CHANNEL


@pytest.mark.coverage
@patch("app.core.realtime_bus.get_redis_client")
def test_realtime_bus_listener_invokes_handler(mock_get_client):
    bus = RealtimeBus("redis://localhost:6379/0")
    received: list[tuple] = []

    def handler(rooms, message):
        received.append((rooms, message))

    mock_pool = MagicMock()
    mock_get_client.return_value = mock_pool

    fake_pubsub = MagicMock()
    fake_pubsub.get_message.side_effect = [
        {"type": "message", "data": json.dumps({"rooms": ["project:1"], "message": {"type": "ping"}}).encode()},
        None,
    ]

    fake_client = MagicMock()
    fake_client.pubsub.return_value = fake_pubsub
    mock_pool.connection_pool = MagicMock()

    with patch("redis.Redis", return_value=fake_client):
        bus.start_listener(handler)
        time.sleep(0.2)
        bus.stop_listener()

    assert received
    assert received[0][0] == ["project:1"]


@pytest.mark.coverage
@patch("app.core.realtime_bus.get_redis_client")
def test_realtime_bus_publish_success(mock_get_client):
    bus = RealtimeBus("redis://localhost:6379/0")
    client = MagicMock()
    mock_get_client.return_value = client
    assert bus.publish(["room"], {"type": "evt"}) is True
    client.publish.assert_called_once()
