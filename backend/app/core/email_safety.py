"""Defenses against SMTP header injection and HTML injection in email bodies."""
from __future__ import annotations

import re
from html import escape

_CRLF_RE = re.compile(r"[\r\n\x00]")


def escape_html(value: str | None) -> str:
    """Escape user-controlled text before interpolating into HTML email bodies."""
    return escape(value or "", quote=True)


def sanitize_email_address(value: str, *, field: str = "address") -> str:
    """Reject addresses/envelope recipients that contain CRLF or null bytes."""
    cleaned = (value or "").strip()
    if not cleaned or _CRLF_RE.search(cleaned):
        raise ValueError(f"Invalid email {field}")
    return cleaned


def sanitize_email_subject(subject: str) -> str:
    """Reject subjects that could inject additional SMTP headers."""
    cleaned = (subject or "").strip()
    if not cleaned or _CRLF_RE.search(cleaned):
        raise ValueError("Invalid email subject")
    return cleaned[:998]
