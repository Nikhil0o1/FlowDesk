"""Timezone helpers for analytics — buckets use the viewer's profile timezone."""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import Profile

# Abbreviations users often type in Settings (e.g. IST instead of Asia/Kolkata).
TZ_ALIASES: dict[str, str] = {
    "UTC": "UTC",
    "GMT": "UTC",
    "IST": "Asia/Kolkata",
    "BST": "Europe/London",
    "EST": "America/New_York",
    "EDT": "America/New_York",
    "CST": "America/Chicago",
    "CDT": "America/Chicago",
    "MST": "America/Denver",
    "MDT": "America/Denver",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "JST": "Asia/Tokyo",
    "CET": "Europe/Paris",
    "CEST": "Europe/Paris",
    "AEST": "Australia/Sydney",
    "AEDT": "Australia/Sydney",
}


def resolve_timezone(name: str | None) -> ZoneInfo:
    if not name or not str(name).strip():
        return ZoneInfo("UTC")
    raw = str(name).strip()
    candidate = TZ_ALIASES.get(raw.upper(), raw)
    try:
        return ZoneInfo(candidate)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def canonical_timezone_name(name: str | None) -> str:
    return resolve_timezone(name).key


def viewer_timezone(db: Session, user_id: uuid.UUID) -> ZoneInfo:
    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))
    return resolve_timezone(profile.timezone if profile else None)


def local_day_bounds(
    date_str: str | None, now_utc: datetime, tz: ZoneInfo
) -> tuple[datetime, datetime, str]:
    """UTC [start, end) for one calendar day in `tz`, plus YYYY-MM-DD in that zone."""
    now_local = now_utc.astimezone(tz)
    if date_str:
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            day = now_local.date()
    else:
        day = now_local.date()
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
        day.isoformat(),
    )


def period_bounds(
    days: int, now_utc: datetime, tz: ZoneInfo
) -> tuple[datetime, datetime, list[date]]:
    """UTC window covering `days` local calendar days ending today in `tz`."""
    now_local = now_utc.astimezone(tz)
    end_local = datetime.combine(now_local.date() + timedelta(days=1), time.min, tzinfo=tz)
    start_local = end_local - timedelta(days=days)
    day_keys = [(start_local + timedelta(days=i)).date() for i in range(days)]
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
        day_keys,
    )


def to_local_date(dt: datetime, tz: ZoneInfo) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date()


def local_hour_slots(day: date, tz: ZoneInfo) -> list[tuple[int, datetime, datetime]]:
    """Local hours 0–23 as UTC half-open intervals [start, end)."""
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    slots: list[tuple[int, datetime, datetime]] = []
    for hour in range(24):
        slot_start = start_local + timedelta(hours=hour)
        slot_end = slot_start + timedelta(hours=1)
        slots.append(
            (hour, slot_start.astimezone(timezone.utc), slot_end.astimezone(timezone.utc))
        )
    return slots


def overlaps(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end
