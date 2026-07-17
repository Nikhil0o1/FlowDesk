"""Unit tests for PAT usage status derivation and memory counters."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.core.pat_usage import (
    clear_usage_memory_for_tests,
    derive_usage_status,
    read_usage_snapshot,
    record_pat_usage,
)

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clear_usage():
    clear_usage_memory_for_tests()
    yield
    clear_usage_memory_for_tests()


def test_derive_usage_status_matrix():
    now = datetime(2026, 7, 14, tzinfo=timezone.utc)
    assert (
        derive_usage_status(
            revoked_at=now,
            expires_at=None,
            requests_24h=10,
            errors_24h=0,
            last_success_at=None,
            last_fail_at=None,
            now=now,
        )
        == "revoked"
    )
    assert (
        derive_usage_status(
            revoked_at=None,
            expires_at=now - timedelta(hours=1),
            requests_24h=0,
            errors_24h=0,
            last_success_at=None,
            last_fail_at=None,
            now=now,
        )
        == "expired"
    )
    assert (
        derive_usage_status(
            revoked_at=None,
            expires_at=None,
            requests_24h=0,
            errors_24h=0,
            last_success_at=None,
            last_fail_at=None,
            now=now,
        )
        == "idle"
    )
    assert (
        derive_usage_status(
            revoked_at=None,
            expires_at=None,
            requests_24h=5,
            errors_24h=5,
            last_success_at=None,
            last_fail_at=now.isoformat(),
            now=now,
        )
        == "failing"
    )
    assert (
        derive_usage_status(
            revoked_at=None,
            expires_at=None,
            requests_24h=100,
            errors_24h=10,
            last_success_at=now.isoformat(),
            last_fail_at=now.isoformat(),
            now=now,
        )
        == "degraded"
    )
    assert (
        derive_usage_status(
            revoked_at=None,
            expires_at=None,
            requests_24h=10,
            errors_24h=0,
            last_success_at=now.isoformat(),
            last_fail_at=None,
            now=now,
        )
        == "healthy"
    )


def test_record_and_read_memory_usage():
    tid = uuid4()
    record_pat_usage(token_id=tid, route="/api/v1/auth/me", status_code=200, ip_address="1.2.3.4")
    record_pat_usage(token_id=tid, route="/api/v1/auth/me", status_code=200)
    record_pat_usage(token_id=tid, route="/api/v1/me/tasks", status_code=403, event="failed")
    record_pat_usage(token_id=tid, route="/api/v1/search", status_code=429, event="rate_limited")

    snap = read_usage_snapshot(tid)
    assert snap["metrics_available"] is True
    assert snap["requests_24h"] == 4
    assert snap["errors_24h"] == 2
    assert snap["rate_limited_24h"] == 1
    assert snap["top_endpoint"] == "/api/v1/auth/me"
    assert snap["last_ip"] == "1.2.3.4"
    assert snap["last_success_route"] == "/api/v1/auth/me"
    assert snap["last_fail_status"] == 429
    assert len(snap["timeline"]) >= 3
