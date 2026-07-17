"""Shared Google API plumbing: one OAuth connection per user powering
Calendar (read), Gmail (send + read) and Sheets (export / live sync).

The connection row lives in calendar_connections (provider="google") — it predates
the wider integration. The `scope` column records what the user actually granted,
so each feature degrades gracefully if its scope is missing.
"""
import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import requests as http
from fastapi import HTTPException
from sqlalchemy import select


class GoogleConnectionExpired(Exception):
    """Raised when a Google OAuth token cannot be refreshed. Safe to raise in background tasks."""
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.calendar import CalendarConnection
from app.services.token_vault import reveal, seal

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
GMAIL_LIST_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets"
CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

# calendar.events (not readonly): the Planner reads events AND tasks can push
# their due dates onto the user's calendar.
SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar.events"
SCOPE_GMAIL_SEND = "https://www.googleapis.com/auth/gmail.send"
SCOPE_GMAIL_READ = "https://www.googleapis.com/auth/gmail.readonly"
SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets"

# Requested when connecting every tool at once (legacy / tests).
ALL_SCOPES = " ".join([SCOPE_CALENDAR, SCOPE_GMAIL_SEND, SCOPE_GMAIL_READ, SCOPE_SHEETS, "email"])

GOOGLE_TOOL_KEYS = frozenset({"calendar", "gmail", "sheets"})
GOOGLE_CONNECT_TOOLS = frozenset({"calendar", "gmail", "sheets", "all"})
TOOL_SCOPES: dict[str, tuple[str, ...]] = {
    "calendar": (SCOPE_CALENDAR, "email"),
    "gmail": (SCOPE_GMAIL_SEND, SCOPE_GMAIL_READ, "email"),
    "sheets": (SCOPE_SHEETS, "email"),
}
TOOL_LABELS = {
    "calendar": "Google Calendar",
    "gmail": "Gmail",
    "sheets": "Google Sheets",
}

# Google may return these instead of our short "email" token.
SCOPE_ALIASES: dict[str, str] = {
    "https://www.googleapis.com/auth/userinfo.email": "email",
    "https://www.googleapis.com/auth/userinfo.profile": "profile",
    "calendar.events": SCOPE_CALENDAR,
    "gmail.send": SCOPE_GMAIL_SEND,
    "gmail.readonly": SCOPE_GMAIL_READ,
    "spreadsheets": SCOPE_SHEETS,
}

GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


def scopes_for_tool(tool: str) -> str:
    if tool not in GOOGLE_TOOL_KEYS:
        raise ValueError(f"Unknown Google tool: {tool}")
    return " ".join(TOOL_SCOPES[tool])


def scopes_for_connect(tool: str) -> str:
    if tool == "all":
        return ALL_SCOPES
    return scopes_for_tool(tool)


def merge_scopes(existing: str | None, granted: str | None) -> str:
    parts = scope_set(existing) | scope_set(granted)
    return " ".join(sorted(parts))


def scope_set(scope: str | None) -> set[str]:
    return {s for s in (scope or "").split() if s}


def normalize_scope_token(raw: str) -> str:
    return SCOPE_ALIASES.get(raw, raw)


def normalize_scope_set(scope: str | None) -> set[str]:
    return {normalize_scope_token(s) for s in scope_set(scope)}


def fetch_tokeninfo_scopes(access_token: str) -> str:
    """Fallback when the token exchange omits the scope field (common with granular consent)."""
    if not access_token:
        return ""
    try:
        res = http.get(
            GOOGLE_TOKENINFO_URL,
            params={"access_token": access_token},
            timeout=10,
        )
        if res.ok:
            return res.json().get("scope") or ""
    except http.RequestException:
        logger.debug("Google tokeninfo scope lookup failed", exc_info=True)
    return ""


def resolve_oauth_granted_scopes(tokens: dict) -> str:
    granted = (tokens.get("scope") or "").strip()
    if not granted:
        granted = fetch_tokeninfo_scopes(tokens.get("access_token", ""))
    return granted


def filter_granted_scopes_for_tool(granted: str | None, tool: str) -> str:
    """Keep integration scopes the user actually approved for this connect flow.

    Google's token response can include every scope the user has ever granted this
    OAuth client (especially with include_granted_scopes). For a single-tool flow we
    only persist that tool. For connect-all we persist whichever integration scopes
    were granted (partial granular selection is supported).
    """
    normalized = normalize_scope_set(granted)
    if tool == "all":
        allowed = normalize_scope_set(ALL_SCOPES)
        kept = normalized & allowed
    else:
        allowed = normalize_scope_set(scopes_for_tool(tool))
        kept = normalized & allowed
    return " ".join(sorted(kept))


def tools_satisfied_by_scope(scope: str | None) -> list[str]:
    """Return tool keys whose required scopes are all present in scope."""
    probe = CalendarConnection(
        user_id=uuid.uuid4(),
        provider="google",
        access_token="",
        scope=scope or "",
    )
    return [tool for tool in GOOGLE_TOOL_KEYS if tool_is_connected(probe, tool)]


def tools_newly_connected(existing_scope: str | None, incoming_scope: str) -> list[str]:
    """Tools that became fully connected after merging incoming scopes."""
    before = tools_satisfied_by_scope(existing_scope)
    after = tools_satisfied_by_scope(merge_scopes(existing_scope, incoming_scope))
    return [tool for tool in after if tool not in before]


def remove_tool_scopes(existing: str | None, tool: str) -> str:
    to_remove = set(TOOL_SCOPES[tool])
    return " ".join(s for s in (existing or "").split() if s and s not in to_remove)


def tool_is_connected(connection: CalendarConnection | None, tool: str) -> bool:
    if not connection:
        return False
    if tool == "calendar":
        return has_scope(connection, SCOPE_CALENDAR)
    if tool == "gmail":
        return has_scope(connection, SCOPE_GMAIL_SEND) and has_scope(connection, SCOPE_GMAIL_READ)
    if tool == "sheets":
        return has_scope(connection, SCOPE_SHEETS)
    return False


def other_tools_connected(connection: CalendarConnection | None, tool: str) -> bool:
    """True when the user already has a different Google tool connected in FlowDesk."""
    return any(
        tool_is_connected(connection, other)
        for other in GOOGLE_TOOL_KEYS
        if other != tool
    )


def any_tool_connected(connection: CalendarConnection | None) -> bool:
    return any(tool_is_connected(connection, tool) for tool in GOOGLE_TOOL_KEYS)


def all_tools_connected(connection: CalendarConnection | None) -> bool:
    return all(tool_is_connected(connection, tool) for tool in GOOGLE_TOOL_KEYS)


def _quote_segment(value: str) -> str:
    return quote(value, safe="")


def _sheets_values_url(spreadsheet_id: str, range_: str) -> str:
    return f"{SHEETS_URL}/{_quote_segment(spreadsheet_id)}/values/{_quote_segment(range_)}"


def _calendar_event_url(event_id: str) -> str:
    return f"{CALENDAR_EVENTS_URL}/{_quote_segment(event_id)}"


def google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def get_connection(db: Session, user_id: uuid.UUID) -> CalendarConnection | None:
    return db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user_id, CalendarConnection.provider == "google"
        )
    )


def has_scope(connection: CalendarConnection | None, scope: str) -> bool:
    return scope in scope_set(connection.scope if connection else None)


def fresh_access_token(db: Session, connection: CalendarConnection) -> str:
    """Refresh the access token if it expires within 2 minutes."""
    now = datetime.now(timezone.utc)
    expiry = connection.token_expiry
    if expiry is not None:
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry > now + timedelta(minutes=2):
            token = reveal(connection.access_token)
            if not token:
                raise GoogleConnectionExpired("Google connection expired — reconnect your Google account")
            return token
    refresh = reveal(connection.refresh_token)
    if not refresh:
        raise GoogleConnectionExpired("Google connection expired — reconnect your Google account")
    res = http.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        },
        timeout=15,
    )
    if not res.ok:
        logger.warning("Google token refresh failed (status=%s)", res.status_code)
        raise GoogleConnectionExpired("Google connection expired — reconnect your Google account")
    tokens = res.json()
    connection.access_token = seal(tokens["access_token"]) or ""
    connection.token_expiry = now + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    db.commit()
    return reveal(connection.access_token) or ""


# ---------------- Gmail ----------------

def try_gmail_send(db: Session, sender_user_id: uuid.UUID, to: str, subject: str, html: str) -> bool:
    """Send via the user's own Gmail when connected with gmail.send.
    Returns False (caller falls back to SMTP) on any failure — never raises."""
    try:
        connection = get_connection(db, sender_user_id)
        if not has_scope(connection, SCOPE_GMAIL_SEND):
            return False
        token = fresh_access_token(db, connection)
        from app.email.mime import build_email_message

        msg = build_email_message(
            to=to,
            subject=subject,
            html=html,
            from_addr=settings.EMAIL_FROM,
        )
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        res = http.post(
            GMAIL_SEND_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
            timeout=15,
        )
        if res.ok:
            return True
        logger.warning("Gmail send failed (status=%s)", res.status_code)
        return False
    except Exception:  # noqa: BLE001 — always fall back to SMTP
        logger.exception("Gmail send raised; falling back to SMTP")
        return False


def gmail_search(db: Session, connection: CalendarConnection, query: str, limit: int = 10) -> list[dict]:
    """Search the user's Gmail and return light message metadata."""
    token = fresh_access_token(db, connection)
    headers = {"Authorization": f"Bearer {token}"}
    res = http.get(GMAIL_LIST_URL, headers=headers, params={"q": query, "maxResults": limit}, timeout=15)
    if not res.ok:
        raise HTTPException(status_code=502, detail="Gmail API error")
    results = []
    for ref in res.json().get("messages", []) or []:
        detail = http.get(
            f"{GMAIL_LIST_URL}/{_quote_segment(ref['id'])}",
            headers=headers,
            params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]},
            timeout=15,
        )
        if not detail.ok:
            continue
        data = detail.json()
        meta = {h["name"]: h["value"] for h in data.get("payload", {}).get("headers", [])}
        results.append(
            {
                "id": data["id"],
                "subject": meta.get("Subject", "(no subject)"),
                "sender": meta.get("From", ""),
                "date": meta.get("Date", ""),
                "snippet": data.get("snippet", ""),
                "link": f"https://mail.google.com/mail/u/0/#all/{data['id']}",
            }
        )
    return results


# ---------------- Calendar ----------------

def calendar_create_event(db: Session, connection: CalendarConnection, *, summary: str,
                          description: str, day) -> dict:
    """Create an all-day event on the user's primary calendar."""
    from datetime import timedelta as _td

    token = fresh_access_token(db, connection)
    res = http.post(
        CALENDAR_EVENTS_URL,
        headers={"Authorization": f"Bearer {token}"},
        json={
            "summary": summary,
            "description": description,
            "start": {"date": day.isoformat()},
            "end": {"date": (day + _td(days=1)).isoformat()},
            "extendedProperties": {"private": {"flowdesk": "1"}},
        },
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Calendar API error (create event)")
    data = res.json()
    return {"id": data.get("id", ""), "link": data.get("htmlLink", "")}


_RRULE_FREQ = {"daily": "DAILY", "weekly": "WEEKLY", "monthly": "MONTHLY"}
_STATUS_EVENT_TYPES = frozenset({"focusTime", "outOfOffice"})


def _calendar_api_error(res, action: str) -> str:
    """Surface Google's error message when an API call fails."""
    detail = f"Google Calendar API error ({action})"
    try:
        msg = res.json().get("error", {}).get("message")
        if msg:
            detail = f"Google Calendar: {msg}"
    except Exception:
        pass
    logger.warning("Google Calendar %s failed (%s): %s", action, res.status_code, res.text[:500])
    return detail


def calendar_create_timed_event(
    db: Session,
    connection: CalendarConnection,
    *,
    summary: str,
    description: str,
    start_at: datetime,
    end_at: datetime,
    all_day: bool = False,
    location: str | None = None,
    attendees: list[str] | None = None,
    add_meet: bool = False,
    visibility: str = "default",
    transparency: str = "opaque",
    recurrence: str = "none",
    event_type: str = "default",
    auto_decline: bool = False,
) -> dict:
    """Create an event on the user's primary calendar.

    Supports Google Meet (conferenceData), attendees, location, recurrence,
    visibility, free/busy, and the focusTime / outOfOffice special event types.
    """
    token = fresh_access_token(db, connection)
    is_status_event = event_type in _STATUS_EVENT_TYPES

    body: dict = {"summary": summary}
    if description:
        body["description"] = description

    if is_status_event:
        # Google status events must be timed, busy, and omit extendedProperties.
        body["transparency"] = "opaque"
        body["start"] = {"dateTime": start_at.isoformat()}
        body["end"] = {"dateTime": end_at.isoformat()}
    else:
        body["extendedProperties"] = {"private": {"flowdesk": "1"}}
        body["visibility"] = visibility if visibility in ("default", "private", "public") else "default"
        body["transparency"] = "transparent" if transparency == "transparent" else "opaque"
        if location:
            body["location"] = location
        if all_day:
            sd, ed = start_at.date(), end_at.date()
            if ed <= sd:
                ed = sd + timedelta(days=1)
            body["start"] = {"date": sd.isoformat()}
            body["end"] = {"date": ed.isoformat()}
        else:
            body["start"] = {"dateTime": start_at.isoformat()}
            body["end"] = {"dateTime": end_at.isoformat()}
        if recurrence in _RRULE_FREQ:
            body["recurrence"] = [f"RRULE:FREQ={_RRULE_FREQ[recurrence]}"]

    params: dict = {}
    if is_status_event:
        body["eventType"] = event_type
        mode = "declineAllConflictingInvitations" if auto_decline else "declineNone"
        if event_type == "focusTime":
            body["focusTimeProperties"] = {
                "autoDeclineMode": mode,
                "chatStatus": "doNotDisturb",
            }
        else:
            body["outOfOfficeProperties"] = {"autoDeclineMode": mode}
    else:
        if attendees:
            body["attendees"] = [{"email": e} for e in attendees if e]
            params["sendUpdates"] = "all"
        if add_meet:
            body["conferenceData"] = {
                "createRequest": {
                    "requestId": uuid.uuid4().hex,
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            }
            params["conferenceDataVersion"] = 1

    res = http.post(
        CALENDAR_EVENTS_URL,
        headers={"Authorization": f"Bearer {token}"},
        params=params or None,
        json=body,
        timeout=15,
    )
    if not res.ok and is_status_event and res.status_code == 400:
        # Personal Gmail accounts may not support focusTime / outOfOffice — fall back.
        logger.info(
            "Google rejected %s event (%s), creating as a regular calendar block",
            event_type,
            res.status_code,
        )
        return calendar_create_timed_event(
            db,
            connection,
            summary=summary,
            description=description,
            start_at=start_at,
            end_at=end_at,
            all_day=all_day,
            location=location,
            attendees=attendees,
            add_meet=add_meet,
            visibility=visibility,
            transparency=transparency,
            recurrence=recurrence,
            event_type="default",
            auto_decline=False,
        )
    if not res.ok:
        raise HTTPException(status_code=502, detail=_calendar_api_error(res, "create event"))
    data = res.json()
    return {
        "id": data.get("id", ""),
        "link": data.get("htmlLink", ""),
        "meet_link": data.get("hangoutLink"),
    }


def calendar_update_event(
    db: Session,
    connection: CalendarConnection,
    *,
    event_id: str,
    summary: str,
    description: str,
    start_at: datetime | None = None,
    end_at: datetime | None = None,
    day=None,
) -> None:
    """Update an existing Google Calendar event."""
    token = fresh_access_token(db, connection)
    body: dict = {"summary": summary, "description": description}
    if start_at and end_at:
        body["start"] = {"dateTime": start_at.isoformat()}
        body["end"] = {"dateTime": end_at.isoformat()}
    elif day is not None:
        from datetime import timedelta as _td

        body["start"] = {"date": day.isoformat()}
        body["end"] = {"date": (day + _td(days=1)).isoformat()}
    res = http.patch(
        _calendar_event_url(event_id),
        headers={"Authorization": f"Bearer {token}"},
        json=body,
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Calendar API error (update event)")


def calendar_delete_event(db: Session, connection: CalendarConnection, *, event_id: str) -> None:
    """Delete a Google Calendar event (best-effort)."""
    token = fresh_access_token(db, connection)
    res = http.delete(
        _calendar_event_url(event_id),
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    if res.status_code not in (200, 204, 404):
        raise HTTPException(status_code=502, detail="Google Calendar API error (delete event)")


# ---------------- Sheets ----------------

def sheets_create(
    db: Session, connection: CalendarConnection, title: str, tabs: list[str] | None = None
) -> tuple[str, str]:
    """Create a spreadsheet (optionally with named tabs), return (spreadsheet_id, url)."""
    token = fresh_access_token(db, connection)
    body: dict = {"properties": {"title": title}}
    if tabs:
        body["sheets"] = [{"properties": {"title": t}} for t in tabs]
    res = http.post(
        SHEETS_URL,
        headers={"Authorization": f"Bearer {token}"},
        json=body,
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (create)")
    data = res.json()
    return data["spreadsheetId"], data.get("spreadsheetUrl", "")


def sheets_read(db: Session, connection: CalendarConnection, spreadsheet_id: str,
                range_: str = "A1:Z10000") -> list[list]:
    """Read cell values from a spreadsheet range (unformatted, as entered)."""
    token = fresh_access_token(db, connection)
    res = http.get(
        _sheets_values_url(spreadsheet_id, range_),
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (read)")
    return res.json().get("values", [])


def sheets_write(db: Session, connection: CalendarConnection, spreadsheet_id: str,
                 range_: str, rows: list[list]) -> None:
    """Write rows starting at the given range (e.g. 'Entries!A1')."""
    from app.core.sheet_safety import sanitize_sheet_rows

    token = fresh_access_token(db, connection)
    res = http.put(
        _sheets_values_url(spreadsheet_id, range_),
        headers={"Authorization": f"Bearer {token}"},
        params={"valueInputOption": "RAW"},
        json={"values": sanitize_sheet_rows(rows)},
        timeout=30,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (write)")


def sheets_overwrite(db: Session, connection: CalendarConnection, spreadsheet_id: str, rows: list[list]) -> None:
    """Clear the first sheet and write rows starting at A1."""
    from app.core.sheet_safety import sanitize_sheet_rows

    safe_rows = sanitize_sheet_rows(rows)
    token = fresh_access_token(db, connection)
    headers = {"Authorization": f"Bearer {token}"}
    http.post(
        f"{SHEETS_URL}/{_quote_segment(spreadsheet_id)}/values/A1:Z10000:clear",
        headers=headers,
        json={},
        timeout=15,
    )
    res = http.put(
        _sheets_values_url(spreadsheet_id, "A1"),
        headers=headers,
        params={"valueInputOption": "RAW"},
        json={"values": safe_rows},
        timeout=30,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (write)")
