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
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.calendar import CalendarConnection
from app.models.user import User
from app.schemas.common import Message

router = APIRouter(prefix="/calendar", tags=["calendar"])

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.readonly email"


def _google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def _redirect_uri() -> str:
    return f"{settings.BACKEND_URL}/api/v1/calendar/google/callback"


def _state_token(user_id: uuid.UUID) -> str:
    return jwt.encode(
        {
            "sub": str(user_id),
            "purpose": "gcal",
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
            "nonce": secrets.token_hex(8),
        },
        settings.SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def _verify_state(state: str) -> uuid.UUID:
    try:
        payload = jwt.decode(state, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    if payload.get("purpose") != "gcal":
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    return uuid.UUID(payload["sub"])


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
            connected=google is not None,
            account_email=google.account_email if google else None,
        ),
        outlook=ProviderStatus(configured=False, connected=False),
    )


@router.get("/google/auth-url")
def google_auth_url(user: User = Depends(get_current_user)):
    if not _google_configured():
        raise HTTPException(
            status_code=503,
            detail="Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the root .env.",
        )
    from urllib.parse import urlencode

    params = urlencode(
        {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": _redirect_uri(),
            "response_type": "code",
            "scope": GOOGLE_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": _state_token(user.id),
        }
    )
    return {"url": f"{GOOGLE_AUTH_URL}?{params}"}


@router.get("/google/callback", include_in_schema=False)
def google_callback(
    state: str,
    code: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
):
    fail = RedirectResponse(f"{settings.FRONTEND_URL}/app/planner?calendar_error=1")
    if error or not code:
        return fail
    user_id = _verify_state(state)

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
    if existing:
        existing.access_token = tokens["access_token"]
        if tokens.get("refresh_token"):
            existing.refresh_token = tokens["refresh_token"]
        existing.token_expiry = expiry
        existing.account_email = email or existing.account_email
        existing.scope = tokens.get("scope")
    else:
        db.add(
            CalendarConnection(
                user_id=user_id,
                provider="google",
                account_email=email,
                access_token=tokens["access_token"],
                refresh_token=tokens.get("refresh_token"),
                token_expiry=expiry,
                scope=tokens.get("scope"),
            )
        )
    db.commit()
    return RedirectResponse(f"{settings.FRONTEND_URL}/app/planner?connected=google")


def _fresh_access_token(db: Session, connection: CalendarConnection) -> str:
    """Refresh the access token if it expires within 2 minutes."""
    now = datetime.now(timezone.utc)
    if connection.token_expiry and connection.token_expiry > now + timedelta(minutes=2):
        return connection.access_token
    if not connection.refresh_token:
        raise HTTPException(status_code=401, detail="Google connection expired — reconnect your calendar")
    res = http.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": connection.refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=401, detail="Google connection expired — reconnect your calendar")
    tokens = res.json()
    connection.access_token = tokens["access_token"]
    connection.token_expiry = now + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    db.commit()
    return connection.access_token


@router.get("/events", response_model=list[CalendarEvent])
def upcoming_events(
    days: int = Query(7, ge=1, le=31),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    connection = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    if not connection:
        raise HTTPException(status_code=404, detail="No calendar connected")
    token = _fresh_access_token(db, connection)

    now = datetime.now(timezone.utc)
    res = http.get(
        GOOGLE_EVENTS_URL,
        headers={"Authorization": f"Bearer {token}"},
        params={
            "timeMin": now.isoformat(),
            "timeMax": (now + timedelta(days=days)).isoformat(),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": 25,
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
        events.append(
            CalendarEvent(
                id=item.get("id", ""),
                summary=item.get("summary", "(no title)"),
                start=start.get("dateTime") or start.get("date") or "",
                end=end.get("dateTime") or end.get("date") or "",
                all_day=all_day,
                link=item.get("htmlLink"),
            )
        )
    return events


@router.delete("/google", response_model=Message)
def disconnect_google(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    connection = db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user.id, CalendarConnection.provider == "google"
        )
    )
    if not connection:
        raise HTTPException(status_code=404, detail="No calendar connected")
    try:
        http.post("https://oauth2.googleapis.com/revoke", params={"token": connection.access_token}, timeout=10)
    except http.RequestException:
        pass
    db.delete(connection)
    db.commit()
    return Message(detail="Google Calendar disconnected")
