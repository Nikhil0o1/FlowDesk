"""Unit tests for analytics timezone resolution and day bounds."""
from datetime import datetime, timezone

from app.services.analytics_timezone import (
    canonical_timezone_name,
    local_day_bounds,
    local_hour_slots,
    overlaps,
    period_bounds,
    resolve_timezone,
    to_local_date,
)


def test_resolve_ist_alias():
    tz = resolve_timezone("IST")
    assert tz.key == "Asia/Kolkata"


def test_local_day_bounds_ist():
    tz = resolve_timezone("Asia/Kolkata")
    # 2026-07-05 20:30 UTC = 2026-07-06 02:00 IST
    now = datetime(2026, 7, 5, 20, 30, tzinfo=timezone.utc)
    start, end, iso = local_day_bounds(None, now, tz)
    assert iso == "2026-07-06"
    assert start == datetime(2026, 7, 5, 18, 30, tzinfo=timezone.utc)
    assert end == datetime(2026, 7, 6, 18, 30, tzinfo=timezone.utc)


def test_period_bounds_returns_local_day_keys():
    tz = resolve_timezone("Asia/Kolkata")
    now = datetime(2026, 7, 6, 10, 0, tzinfo=timezone.utc)
    start, end, keys = period_bounds(3, now, tz)
    assert len(keys) == 3
    assert keys[-1].isoformat() == "2026-07-06"
    assert to_local_date(start, tz).isoformat() == "2026-07-04"


def test_local_hour_slots_cover_24_hours():
    tz = resolve_timezone("UTC")
    day = datetime(2026, 7, 6, tzinfo=timezone.utc).date()
    slots = local_hour_slots(day, tz)
    assert len(slots) == 24
    assert slots[0][0] == 0
    assert slots[23][0] == 23


def test_canonical_timezone_name_empty():
    assert canonical_timezone_name(None) == "UTC"
    assert canonical_timezone_name("") == "UTC"


def test_resolve_timezone_defaults_and_invalid():
    assert resolve_timezone(None).key == "UTC"
    assert resolve_timezone("  ").key == "UTC"
    assert resolve_timezone("Not/A/Zone").key == "UTC"
    assert resolve_timezone("EST").key == "America/New_York"
    assert canonical_timezone_name("IST") == "Asia/Kolkata"


def test_local_day_bounds_invalid_date_falls_back_to_today():
    tz = resolve_timezone("UTC")
    now = datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc)
    _start, _end, iso = local_day_bounds("not-a-date", now, tz)
    assert iso == "2026-07-06"


def test_local_day_bounds_specific_date():
    tz = resolve_timezone("UTC")
    now = datetime(2026, 7, 6, 12, 0, tzinfo=timezone.utc)
    _start, _end, iso = local_day_bounds("2026-07-01", now, tz)
    assert iso == "2026-07-01"


def test_to_local_date_handles_naive_datetime():
    tz = resolve_timezone("UTC")
    naive = datetime(2026, 7, 6, 12, 0)
    assert to_local_date(naive, tz).isoformat() == "2026-07-06"


def test_overlaps_detects_intersection():
    a_start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    a_end = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    b_start = datetime(2026, 1, 1, 11, tzinfo=timezone.utc)
    b_end = datetime(2026, 1, 1, 13, tzinfo=timezone.utc)
    assert overlaps(a_start, a_end, b_start, b_end) is True
    assert overlaps(a_start, a_end, a_end, b_end) is False
