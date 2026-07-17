"""Email sending abstraction. Swap providers by implementing EmailBackend."""
import logging
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor

from app.core.config import settings
from app.core.email_safety import sanitize_email_address

logger = logging.getLogger(__name__)

_MAX_EMAIL_WORKERS = 8
_executor = ThreadPoolExecutor(max_workers=_MAX_EMAIL_WORKERS, thread_name_prefix="email")


class EmailBackend(ABC):
    @abstractmethod
    def send(self, to: str, subject: str, html: str, text: str | None = None) -> None: ...


class SMTPBackend(EmailBackend):
    def send(self, to: str, subject: str, html: str, text: str | None = None) -> None:
        import smtplib

        from app.email.mime import build_email_message

        safe_to = sanitize_email_address(to, field="recipient")
        msg = build_email_message(
            to=to,
            subject=subject,
            html=html,
            text=text,
            from_addr=settings.EMAIL_FROM,
        )

        with smtplib.SMTP(settings.EMAIL_SMTP_SERVER, settings.EMAIL_SMTP_PORT) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.login(settings.EMAIL_USERNAME, settings.EMAIL_PASSWORD)
            smtp.sendmail(settings.EMAIL_FROM, safe_to, msg.as_bytes())


class ConsoleBackend(EmailBackend):
    def send(self, to: str, subject: str, html: str, text: str | None = None) -> None:
        logger.info("EMAIL (console backend) to=%s subject=%s", to, subject)


def get_email_backend() -> EmailBackend:
    if not settings.EMAIL_USERNAME:
        return ConsoleBackend()
    return SMTPBackend()


def send_email_async(to: str, subject: str, html: str, text: str | None = None) -> None:
    """Queue email on a bounded thread pool (never blocks a request)."""

    def _send() -> None:
        try:
            get_email_backend().send(to, subject, html, text)
        except Exception:
            logger.exception("Failed to send email to %s (subject=%s)", to, subject)

    try:
        _executor.submit(_send)
    except Exception:
        logger.exception("Email queue is saturated; dropped message to %s", to)
