"""Email sending abstraction. Swap providers by implementing EmailBackend."""
import logging
import smtplib
import threading
from abc import ABC, abstractmethod
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailBackend(ABC):
    @abstractmethod
    def send(self, to: str, subject: str, html: str, text: str | None = None) -> None: ...


class SMTPBackend(EmailBackend):
    def send(self, to: str, subject: str, html: str, text: str | None = None) -> None:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.EMAIL_FROM
        msg["To"] = to
        if text:
            msg.attach(MIMEText(text, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.EMAIL_FROM, [to], msg.as_string())


class ConsoleBackend(EmailBackend):
    def send(self, to: str, subject: str, html: str, text: str | None = None) -> None:
        logger.info("EMAIL (console backend) to=%s subject=%s", to, subject)


def get_email_backend() -> EmailBackend:
    if not settings.EMAIL_ENABLED:
        return ConsoleBackend()
    return SMTPBackend()


def send_email_async(to: str, subject: str, html: str, text: str | None = None) -> None:
    """Fire-and-forget email send on a daemon thread (never blocks a request)."""

    def _send() -> None:
        try:
            get_email_backend().send(to, subject, html, text)
        except Exception:
            logger.exception("Failed to send email to %s (subject=%s)", to, subject)

    threading.Thread(target=_send, daemon=True).start()
