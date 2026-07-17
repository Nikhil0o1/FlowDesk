"""Google Calendar integration (OAuth code flow + readonly events).

Requires GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in the root .env. Until
configured, /calendar/status reports configured=false and the UI explains it.
Outlook requires a Microsoft Azure app registration and is reported as
not configured (no fake connect).
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import requests as http
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.calendar import CalendarConnection
from app.models.user import User
from app.schemas.common import Message

router = APIRouter(prefix="/calendar", tags=["calendar"])

from app.services import google_service
from app.services.token_vault import reveal, seal

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
# Per-tool OAuth — each App Center tile requests only its scopes (see google_service).
GOOGLE_SCOPE = google_service.ALL_SCOPES  # legacy alias for tests


def _google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def _redirect_uri() -> str:
    return f"{settings.BACKEND_URL}/api/v1/calendar/google/callback"


def _state_token(user_id: uuid.UUID, next_page: str = "planner", tool: str = "calendar") -> str:
    return jwt.encode(
        {
            "sub": str(user_id),
            "purpose": "gcal",
            "next": next_page,
            "tool": tool,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
            "nonce": secrets.token_hex(8),
        },
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def _verify_state(state: str) -> tuple[uuid.UUID, str, str]:
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    if payload.get("purpose") != "gcal":
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    next_page = payload.get("next") if payload.get("next") in ("planner", "apps") else "planner"
    tool = payload.get("tool") if payload.get("tool") in google_service.GOOGLE_CONNECT_TOOLS else "calendar"
    return uuid.UUID(payload["sub"]), next_page, tool


class ProviderStatus(BaseModel):
    configured: bool
    connected: bool
    account_email: str | None = None


class CalendarStatus(BaseModel):
    google: ProviderStatus
    outlook: ProviderStatus


class CalendarEvent(BaseModel):
    id: str
    summary: str
    start: str
    end: str
    all_day: bool
    link: str | None = None
    meet_link: str | None = None


@router.get("/status", response_model=CalendarStatus)
def calendar_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    google = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    return CalendarStatus(
        google=ProviderStatus(
            configured=_google_configured(),
            connected=google is not None and google_service.has_scope(google, google_service.SCOPE_CALENDAR),
            account_email=google.account_email if google else None,
        ),
        outlook=ProviderStatus(configured=False, connected=False),
    )


@router.get("/google/auth-url")
def google_auth_url(
    next: str = Query(default="planner"),
    tool: str = Query(default="calendar", pattern="^(calendar|gmail|sheets|all)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not _google_configured():
        raise HTTPException(
            status_code=503,
            detail="Google integration is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env.",
        )
    from urllib.parse import urlencode

    existing = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    params: dict[str, str] = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": google_service.scopes_for_connect(tool),
        "access_type": "offline",
        "state": _state_token(user.id, next, tool),
        "enable_granular_consent": "true",
    }
    if tool == "all":
        if existing and google_service.any_tool_connected(existing):
            params["include_granted_scopes"] = "true"
        if not existing or not existing.refresh_token or not google_service.all_tools_connected(existing):
            params["prompt"] = "consent"
        else:
            params["prompt"] = "select_account"
    else:
        if existing and google_service.other_tools_connected(existing, tool):
            params["include_granted_scopes"] = "true"
        if not existing or not existing.refresh_token or not google_service.tool_is_connected(existing, tool):
            params["prompt"] = "consent"
        else:
            params["prompt"] = "select_account"

    return {"url": f"{GOOGLE_AUTH_URL}?{urlencode(params)}"}


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    user_id, next_page, tool = _verify_state(state)
    fail = RedirectResponse(
        f"{settings.FRONTEND_URL}/app/{next_page}?calendar_error=1"
    )
    if error or not code:
        return fail

    token_res = http.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": _redirect_uri(),
        },
        timeout=15,
    )
    if not token_res.ok:
        return fail
    tokens = token_res.json()

    email = None
    try:
        info = http.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
            timeout=15,
        )
        if info.ok:
            email = info.json().get("email")
    except http.RequestException:
        pass

    expiry = datetime.now(timezone.utc) + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    existing = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user_id, CalendarConnection.provider == "google"
        )
    )
    granted_raw = google_service.resolve_oauth_granted_scopes(tokens)
    incoming_scope = google_service.filter_granted_scopes_for_tool(granted_raw, tool)
    merged_scope = google_service.merge_scopes(
        existing.scope if existing else None,
        incoming_scope,
    )
    probe = CalendarConnection(
        user_id=user_id,
        provider="google",
        access_token="",
        scope=merged_scope,
    )
    if tool == "all":
        newly_connected = google_service.tools_newly_connected(
            existing.scope if existing else None,
            incoming_scope,
        )
        if not google_service.any_tool_connected(probe):
            return RedirectResponse(
                f"{settings.FRONTEND_URL}/app/{next_page}?calendar_error=partial"
            )
    elif not google_service.tool_is_connected(probe, tool):
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/{next_page}?calendar_error=partial"
        )

    if existing:
        existing.access_token = seal(tokens["access_token"]) or ""
        if tokens.get("refresh_token"):
            existing.refresh_token = seal(tokens["refresh_token"])
        existing.token_expiry = expiry
        existing.account_email = email or existing.account_email
        existing.scope = merged_scope
    else:
        db.add(
            CalendarConnection(
                user_id=user_id,
                provider="google",
                account_email=email,
                access_token=seal(tokens["access_token"]) or "",
                refresh_token=seal(tokens.get("refresh_token")),
                token_expiry=expiry,
                scope=merged_scope,
            )
        )
    db.commit()
    if tool == "all":
        tools_param = ",".join(newly_connected) if newly_connected else ",".join(
            google_service.tools_satisfied_by_scope(merged_scope)
        )
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/app/{next_page}?connected=google&tools={tools_param}"
        )
    return RedirectResponse(
        f"{settings.FRONTEND_URL}/app/{next_page}?connected=google&tool={tool}"
    )


def _fresh_access_token(db: Session, connection: CalendarConnection) -> str:
    try:
        return google_service.fresh_access_token(db, connection)
    except google_service.GoogleConnectionExpired as e:
        raise HTTPException(status_code=401, detail=str(e)) from e


@router.get("/events", response_model=list[CalendarEvent])
def upcoming_events(
    days: int = Query(7, ge=1, le=31),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Events between start/end (e.g. the Planner's visible week); falls back to now+days."""
    connection = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    if not connection:
        raise HTTPException(status_code=404, detail="No calendar connected")
    token = _fresh_access_token(db, connection)

    now = datetime.now(timezone.utc)
    time_min = start or now
    time_max = end or (now + timedelta(days=days))
    if time_min.tzinfo is None:
        time_min = time_min.replace(tzinfo=timezone.utc)
    if time_max.tzinfo is None:
        time_max = time_max.replace(tzinfo=timezone.utc)
    res = http.get(
        GOOGLE_EVENTS_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "timeMin": time_min.isoformat(),
            "timeMax": time_max.isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 100,
        },
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Calendar API error")
    events: list[CalendarEvent] = []
    for item in res.json().get("items", []):
        start = item.get("start", {})
        end = item.get("end", {})
        all_day = "date" in start
        meet_link = item.get("hangoutLink")
        if not meet_link:
            for ep in (item.get("conferenceData", {}).get("entryPoints") or []):
                if ep.get("entryPointType") == "video" and ep.get("uri"):
                    meet_link = ep["uri"]
                    break
        events.append(
            CalendarEvent(
                id=item.get("id", ""),
                summary=item.get("summary", "(no title)"),
                start=start.get("dateTime") or start.get("date") or "",
                end=end.get("dateTime") or end.get("date") or "",
                all_day=all_day,
                link=item.get("htmlLink"),
                meet_link=meet_link,
            )
        )
    return events


class EventCreate(BaseModel):
    summary: str
    description: str | None = None
    start_at: datetime
    end_at: datetime
    all_day: bool = False
    location: str | None = Field(default=None, max_length=500)
    attendees: list[str] = Field(default_factory=list, max_length=50)
    add_meet: bool = False
    visibility: str = Field(default="default", pattern="^(default|private|public)$")
    transparency: str = Field(default="opaque", pattern="^(opaque|transparent)$")  # opaque=busy, transparent=free
    recurrence: str = Field(default="none", pattern="^(none|daily|weekly|monthly)$")
    event_type: str = Field(default="default", pattern="^(default|focusTime|outOfOffice)$")
    auto_decline: bool = False


@router.post("/events", response_model=CalendarEvent, status_code=201)
def create_event(
    body: EventCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Time-block: create an event on the user's primary Google Calendar."""
    from app.services import google_service as gs

    connection = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    if not gs.has_scope(connection, gs.SCOPE_CALENDAR):
        raise HTTPException(
            status_code=412,
            detail="Re-connect your Google account in the App Center to allow calendar write access",
        )
    if body.end_at <= body.start_at:
        raise HTTPException(status_code=422, detail="End time must be after start time")
    if body.event_type in ("focusTime", "outOfOffice") and body.all_day:
        raise HTTPException(
            status_code=422,
            detail="Focus time and out-of-office blocks must have start and end times (not all-day)",
        )
    summary = body.summary.strip()
    if not summary:
        raise HTTPException(status_code=422, detail="Event title is required")
    result = gs.calendar_create_timed_event(
        db, connection, summary=summary, description=body.description or "",
        start_at=body.start_at, end_at=body.end_at,
        all_day=body.all_day, location=body.location, attendees=body.attendees,
        add_meet=body.add_meet, visibility=body.visibility, transparency=body.transparency,
        recurrence=body.recurrence, event_type=body.event_type, auto_decline=body.auto_decline,
    )
    return CalendarEvent(
        id=result.get("id", ""), summary=summary, start=body.start_at.isoformat(),
        end=body.end_at.isoformat(), all_day=body.all_day, link=result.get("link") or None,
        meet_link=result.get("meet_link") or None,
    )


def _revoke_google_token(connection: CalendarConnection) -> None:
    try:
        http.post(
            "https://oauth2.googleapis.com/revoke",
            params={"token": reveal(connection.access_token)},
            timeout=10,
        )
    except http.RequestException:
        pass


def _deactivate_sheet_syncs(db: Session, connection_id: uuid.UUID) -> None:
    from app.models.integration import GoogleSheetSync

    for sync in db.scalars(
        select(GoogleSheetSync).where(
            GoogleSheetSync.connection_id == connection_id,
            GoogleSheetSync.is_active.is_(True),
        )
    ).all():
        sync.is_active = False


@router.delete("/google", response_model=Message)
def disconnect_google(
    tool: str | None = Query(default=None, pattern="^(calendar|gmail|sheets)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    connection = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    if not connection:
        raise HTTPException(status_code=404, detail="No Google connection")

    label = google_service.TOOL_LABELS.get(tool or "", "Google account")

    if tool is None:
        _revoke_google_token(connection)
        db.delete(connection)
        db.commit()
        return Message(detail="Google account disconnected")

    if not google_service.tool_is_connected(connection, tool):
        raise HTTPException(status_code=404, detail=f"{label} is not connected")

    remaining = google_service.remove_tool_scopes(connection.scope, tool)
    if not remaining.strip():
        _revoke_google_token(connection)
        db.delete(connection)
    else:
        if tool == "sheets":
            _deactivate_sheet_syncs(db, connection.id)
        connection.scope = remaining
    db.commit()
    return Message(detail=f"{label} disconnected")
