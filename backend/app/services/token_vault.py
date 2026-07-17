"""Encrypt OAuth tokens at rest (Google Calendar, GitHub connections).

Legacy rows may still hold plaintext tokens; reveal() transparently handles both.
"""
from __future__ import annotations

from cryptography.fernet import InvalidToken

from app.core.security import decrypt_secret, encrypt_secret

_PREFIX = "enc:v1:"


def seal(plain: str | None) -> str | None:
    if not plain:
        return plain
    if plain.startswith(_PREFIX):
        return plain
    return _PREFIX + encrypt_secret(plain)


def reveal(stored: str | None) -> str | None:
    if not stored:
        return stored
    if stored.startswith(_PREFIX):
        try:
            return decrypt_secret(stored[len(_PREFIX) :])
        except InvalidToken:
            # SECRET_KEY rotated or corrupted ciphertext — treat as missing so callers
            # can prompt reconnect instead of crashing mid-request.
            return None
    return stored
