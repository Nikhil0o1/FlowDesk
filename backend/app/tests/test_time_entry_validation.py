"""Unit tests for manual time-entry range validation (issue #32)."""
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.schemas.time_entry import ManualTimeEntry


def _entry(*, hours: float = 1.0, future: bool = False) -> dict:
    now = datetime.now(timezone.utc)
    if future:
        started = now + timedelta(hours=2)
        ended = started + timedelta(hours=1)
    else:
        ended = now - timedelta(minutes=5)
        started = ended - timedelta(hours=hours)
    return {
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
    }


def test_manual_time_entry_accepts_valid_range():
    entry = ManualTimeEntry(**_entry(hours=2))
    assert entry.ended_at > entry.started_at


def test_manual_time_entry_rejects_future_end():
    with pytest.raises(ValidationError, match="future"):
        ManualTimeEntry(**_entry(future=True))


def test_manual_time_entry_rejects_excessive_duration():
    with pytest.raises(ValidationError, match="cannot exceed"):
        ManualTimeEntry(**_entry(hours=721))


def test_manual_time_entry_accepts_multi_day_duration():
    entry = ManualTimeEntry(**_entry(hours=48))
    assert entry.ended_at > entry.started_at


def test_manual_time_entry_rejects_inverted_range():
    now = datetime.now(timezone.utc)
    with pytest.raises(ValidationError, match="after"):
        ManualTimeEntry(
            started_at=now,
            ended_at=now - timedelta(hours=1),
        )
