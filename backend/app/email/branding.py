"""Product branding for outbound emails."""
from app.core.config import APP_NAME, settings


def email_product_name() -> str:
    explicit = (settings.EMAIL_PRODUCT_NAME or "").strip()
    return explicit or APP_NAME
