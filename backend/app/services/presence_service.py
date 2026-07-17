"""Presence lifecycle: heartbeats, explicit status changes, and session close.

Backend flow (see FRD):
    login → create session → heartbeat every 30–60s → update last activity
          → mark away after timeout → logout → end session → mark offline
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.presence import PresenceEvent, UserPresence, UserSession

# A user is considered offline once their last heartbeat is older than this.
OFFLINE_AFTER = timedelta(minutes=5)
# Explicit user choice — automatic tab-visibility heartbeats must not override these.
MANUAL_PRESENCE_STATUSES = frozenset({"busy"})
AUTOMATIC_HEARTBEAT_STATUSES = frozenset({"online", "away"})
# Heartbeats inside the same open session older than this start a fresh session
# (treat a long gap as a new login rather than one giant session).
SESSION_GAP = timedelta(minutes=30)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def parse_user_agent(ua: str | None) -> tuple[str | None, str | None]:
    """Best-effort device + browser extraction — no external dependency."""
    if not ua:
        return None, None
    low = ua.lower()

    if "tablet" in low or "ipad" in low:
        device = "Tablet"
    elif "mobi" in low or "android" in low or "iphone" in low:
        device = "Mobile"
    else:
        device = "Desktop"

    if "edg" in low:
        browser = "Edge"
    elif "opr" in low or "opera" in low:
        browser = "Opera"
    elif "chrome" in low and "chromium" not in low:
        browser = "Chrome"
    elif "firefox" in low:
        browser = "Firefox"
    elif "safari" in low:
        browser = "Safari"
    else:
        browser = "Other"
    return device, browser


def effective_status(status: str | None, last_seen: datetime | None, now: datetime | None = None) -> str:
    """Resolve the stored status against heartbeat staleness."""
    now = now or _now()
    if last_seen is None:
        return "offline"
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if now - last_seen > OFFLINE_AFTER:
        return "offline"
    if status in ("busy", "away"):
        return status
    return "online"


def _get_presence(db: Session, user_id: uuid.UUID) -> UserPresence:
    presence = db.scalar(select(UserPresence).where(UserPresence.user_id == user_id))
    if presence is None:
        presence = UserPresence(user_id=user_id, status="offline")
        db.add(presence)
        db.flush()
    return presence


def _open_session(db: Session, user_id: uuid.UUID) -> UserSession | None:
    return db.scalar(
        select(UserSession)
        .where(UserSession.user_id == user_id, UserSession.logout_time.is_(None))
        .order_by(UserSession.login_time.desc())
    )


def _close_session(session: UserSession, when: datetime) -> None:
    session.logout_time = when
    login = session.login_time
    if login.tzinfo is None:
        login = login.replace(tzinfo=timezone.utc)
    session.session_duration = max(0, int((when - login).total_seconds()))


def _log_event(
    db: Session,
    user_id: uuid.UUID,
    event_type: str,
    old_status: str | None,
    new_status: str | None,
    when: datetime,
) -> None:
    db.add(
        PresenceEvent(
            user_id=user_id,
            event_type=event_type,
            old_status=old_status,
            new_status=new_status,
            created_at=when,
        )
    )


def record_heartbeat(
    db: Session,
    user_id: uuid.UUID,
    status: str | None,
    user_agent: str | None,
    ip_address: str | None,
) -> UserPresence:
    now = _now()
    device, browser = parse_user_agent(user_agent)
    presence = _get_presence(db, user_id)
    prev_effective = effective_status(presence.status, presence.last_seen, now)

    session = _open_session(db, user_id)
    if session is not None:
        last = session.last_activity or session.login_time
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if now - last > SESSION_GAP:
            # Stale open session — close it and start fresh (counts as a new login).
            _close_session(session, last)
            session = None

    if session is None:
        session = UserSession(
            user_id=user_id,
            login_time=now,
            last_activity=now,
            device=device,
            browser=browser,
            ip_address=ip_address,
        )
        db.add(session)
        _log_event(db, user_id, "login", prev_effective, "online", now)
    else:
        session.last_activity = now
        if device and not session.device:
            session.device = device
        if browser and not session.browser:
            session.browser = browser

    if (
        presence.status in MANUAL_PRESENCE_STATUSES
        and status in AUTOMATIC_HEARTBEAT_STATUSES
    ):
        # User set busy (e.g. in a meeting) — keep it even when the client sends away/online.
        new_status = presence.status
    elif status:
        new_status = status
    else:
        new_status = "online" if presence.status == "offline" else presence.status
    if new_status != presence.status:
        _log_event(db, user_id, "status_change", presence.status, new_status, now)
    presence.status = new_status
    presence.last_seen = now
    db.commit()
    return presence


def set_status(db: Session, user_id: uuid.UUID, status: str) -> UserPresence:
    now = _now()
    presence = _get_presence(db, user_id)
    old = presence.status
    if status == "offline":
        return end_session(db, user_id)
    if status != old:
        _log_event(db, user_id, status, old, status, now)
    presence.status = status
    presence.last_seen = now
    db.commit()
    return presence


def end_session(db: Session, user_id: uuid.UUID) -> UserPresence:
    now = _now()
    presence = _get_presence(db, user_id)
    old = presence.status
    session = _open_session(db, user_id)
    if session is not None:
        _close_session(session, now)
    if old != "offline":
        _log_event(db, user_id, "logout", old, "offline", now)
    presence.status = "offline"
    db.commit()
    return presence
