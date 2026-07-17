"""CAPTCHA verification for unauthenticated public endpoints."""
from __future__ import annotations

import logging

import httpx
from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def captcha_required() -> bool:
    return bool(settings.TURNSTILE_SECRET_KEY.strip())


def verify_turnstile(token: str | None, remote_ip: str | None = None) -> None:
    """Verify a Cloudflare Turnstile response token. No-op when CAPTCHA is disabled."""
    if not captcha_required():
        return
    if not token or not token.strip():
        raise HTTPException(status_code=422, detail="CAPTCHA verification is required")

    payload: dict[str, str] = {
        "secret": settings.TURNSTILE_SECRET_KEY,
        "response": token.strip(),
    }
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(TURNSTILE_VERIFY_URL, data=payload)
            response.raise_for_status()
            result = response.json()
    except Exception:
        logger.exception("Turnstile verification request failed")
        raise HTTPException(status_code=503, detail="CAPTCHA verification is temporarily unavailable")

    if not result.get("success"):
        raise HTTPException(status_code=422, detail="CAPTCHA verification failed")
