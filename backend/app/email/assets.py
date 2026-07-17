"""Bundled email assets — served inline (CID) so logos work in all mail clients."""
from __future__ import annotations

import logging
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

BRIGHTCONE_LOGO_CID = "brightcone-logo@flowdesk"
_LOGO_PATH = Path(__file__).resolve().parent / "assets" / "brightcone-logo.png"


def load_brightcone_logo() -> bytes | None:
    if not _LOGO_PATH.is_file():
        logger.warning("Brightcone email logo missing at %s", _LOGO_PATH)
        return None
    return _LOGO_PATH.read_bytes()


def brightcone_logo_inline() -> tuple[str, bytes, str] | None:
    """Return (content_id, bytes, subtype) for MIME inline attachment."""
    data = load_brightcone_logo()
    if data is None:
        return None
    return BRIGHTCONE_LOGO_CID, data, "png"


def brightcone_logo_src() -> str:
    """Img src for HTML — CID when bundled asset exists, else public URL fallback."""
    if load_brightcone_logo() is not None:
        return f"cid:{BRIGHTCONE_LOGO_CID}"
    return settings.email_logo_url
