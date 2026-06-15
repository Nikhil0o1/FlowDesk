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
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests as http
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.calendar import CalendarConnection

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

# Requested on connect. Users who connected before the Gmail/Sheets rollout
# simply re-connect to grant the new scopes (prompt=consent forces the screen).
ALL_SCOPES = " ".join([SCOPE_CALENDAR, SCOPE_GMAIL_SEND, SCOPE_GMAIL_READ, SCOPE_SHEETS, "email"])


def google_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def get_connection(db: Session, user_id: uuid.UUID) -> CalendarConnection | None:
    return db.scalar(
        select(CalendarConnection).where(
            CalendarConnection.user_id == user_id, CalendarConnection.provider == "google"
        )
    )


def has_scope(connection: CalendarConnection | None, scope: str) -> bool:
    return bool(connection and connection.scope and scope in connection.scope)


def fresh_access_token(db: Session, connection: CalendarConnection) -> str:
    """Refresh the access token if it expires within 2 minutes."""
    now = datetime.now(timezone.utc)
    if connection.token_expiry and connection.token_expiry > now + timedelta(minutes=2):
        return connection.access_token
    if not connection.refresh_token:
        raise HTTPException(status_code=401, detail="Google connection expired — reconnect your Google account")
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
        raise HTTPException(status_code=401, detail="Google connection expired — reconnect your Google account")
    tokens = res.json()
    connection.access_token = tokens["access_token"]
    connection.token_expiry = now + timedelta(seconds=int(tokens.get("expires_in", 3600)))
    db.commit()
    return connection.access_token


# ---------------- Gmail ----------------

def try_gmail_send(db: Session, sender_user_id: uuid.UUID, to: str, subject: str, html: str) -> bool:
    """Send via the user's own Gmail when connected with gmail.send.
    Returns False (caller falls back to SMTP) on any failure — never raises."""
    try:
        connection = get_connection(db, sender_user_id)
        if not has_scope(connection, SCOPE_GMAIL_SEND):
            return False
        token = fresh_access_token(db, connection)
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["To"] = to
        msg.attach(MIMEText(html, "html", "utf-8"))
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")
        res = http.post(
            GMAIL_SEND_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
            timeout=15,
        )
        if res.ok:
            return True
        logger.warning("Gmail send failed (%s): %s", res.status_code, res.text[:300])
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
            f"{GMAIL_LIST_URL}/{ref['id']}",
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
                          description: str, day) -> str:
    """Create an all-day event on the user's primary calendar; returns its link."""
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
        },
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Calendar API error (create event)")
    return res.json().get("htmlLink", "")


def calendar_create_timed_event(db: Session, connection: CalendarConnection, *, summary: str,
                                description: str, start_at: datetime, end_at: datetime) -> str:
    """Create a timed event on the user's primary calendar; returns its link."""
    token = fresh_access_token(db, connection)
    res = http.post(
        CALENDAR_EVENTS_URL,
        headers={"Authorization": f"Bearer {token}"},
        json={
            "summary": summary,
            "description": description,
            "start": {"dateTime": start_at.isoformat()},
            "end": {"dateTime": end_at.isoformat()},
        },
        timeout=15,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Calendar API error (create event)")
    return res.json().get("htmlLink", "")


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
        f"{SHEETS_URL}/{spreadsheet_id}/values/{range_}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (read)")
    return res.json().get("values", [])


def sheets_write(db: Session, connection: CalendarConnection, spreadsheet_id: str,
                 range_: str, rows: list[list]) -> None:
    """Write rows starting at the given range (e.g. 'Entries!A1')."""
    token = fresh_access_token(db, connection)
    res = http.put(
        f"{SHEETS_URL}/{spreadsheet_id}/values/{range_}",
        headers={"Authorization": f"Bearer {token}"},
        params={"valueInputOption": "RAW"},
        json={"values": rows},
        timeout=30,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (write)")


def sheets_overwrite(db: Session, connection: CalendarConnection, spreadsheet_id: str, rows: list[list]) -> None:
    """Clear the first sheet and write rows starting at A1."""
    token = fresh_access_token(db, connection)
    headers = {"Authorization": f"Bearer {token}"}
    http.post(f"{SHEETS_URL}/{spreadsheet_id}/values/A1:Z10000:clear", headers=headers, json={}, timeout=15)
    res = http.put(
        f"{SHEETS_URL}/{spreadsheet_id}/values/A1",
        headers=headers,
        params={"valueInputOption": "RAW"},
        json={"values": rows},
        timeout=30,
    )
    if not res.ok:
        raise HTTPException(status_code=502, detail="Google Sheets API error (write)")
