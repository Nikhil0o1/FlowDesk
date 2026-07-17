"""MIME helpers for HTML product emails with optional inline images."""
from __future__ import annotations

from collections.abc import Sequence
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.email_safety import sanitize_email_address, sanitize_email_subject
from app.email.assets import brightcone_logo_inline


def build_email_message(
    *,
    to: str,
    subject: str,
    html: str,
    from_addr: str,
    text: str | None = None,
    inline_images: Sequence[tuple[str, bytes, str]] | None = None,
) -> MIMEMultipart:
    safe_to = sanitize_email_address(to, field="recipient")
    safe_subject = sanitize_email_subject(subject)
    safe_from = sanitize_email_address(from_addr, field="sender")

    images = list(inline_images or [])
    if not images:
        logo = brightcone_logo_inline()
        if logo is not None:
            images.append(logo)

    if images:
        root = MIMEMultipart("related")
        root["Subject"] = safe_subject
        root["From"] = safe_from
        root["To"] = safe_to

        alt = MIMEMultipart("alternative")
        if text:
            alt.attach(MIMEText(text, "plain", "utf-8"))
        alt.attach(MIMEText(html, "html", "utf-8"))
        root.attach(alt)

        for cid, data, subtype in images:
            img = MIMEImage(data, _subtype=subtype)
            img.add_header("Content-ID", f"<{cid}>")
            img.add_header("Content-Disposition", "inline", filename="brightcone-logo.png")
            root.attach(img)
        return root

    msg = MIMEMultipart("alternative")
    msg["Subject"] = safe_subject
    msg["From"] = safe_from
    msg["To"] = safe_to
    if text:
        msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    return msg
