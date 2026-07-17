"""Phase 2 unit tests — core security utilities (JWT, tokens, TOTP encryption)."""
import uuid

import pytest
from app.core.security import (
    create_2fa_challenge_token,
    create_access_token,
    decode_2fa_challenge_token,
    decode_access_token,
    decrypt_secret,
    encrypt_secret,
    generate_token,
    hash_token,
    invite_token_expiry,
    refresh_token_expiry,
)


@pytest.mark.unit
def test_generate_token_and_hash_are_unique():
    a = generate_token()
    b = generate_token()
    assert a != b
    assert hash_token(a) != hash_token(b)
    assert len(hash_token(a)) == 64


@pytest.mark.unit
def test_access_token_roundtrip():
    uid = uuid.uuid4()
    token = create_access_token(uid, is_superadmin=False)
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == str(uid)
    assert payload["type"] == "access"
    assert payload["sa"] is False
    assert payload["jti"]


@pytest.mark.unit
def test_access_token_rejects_tampered_token():
    uid = uuid.uuid4()
    token = create_access_token(uid)
    parts = token.split(".")
    parts[1] = parts[1][::-1]  # corrupt payload segment
    assert decode_access_token(".".join(parts)) is None


@pytest.mark.unit
def test_2fa_challenge_token_roundtrip():
    uid = uuid.uuid4()
    token = create_2fa_challenge_token(uid)
    assert decode_2fa_challenge_token(token) == uid
    assert decode_2fa_challenge_token(create_access_token(uid)) is None


@pytest.mark.unit
def test_totp_secret_encrypt_decrypt_roundtrip():
    plain = "JBSWY3DPEHPK3PXP"
    enc = encrypt_secret(plain)
    assert enc != plain
    assert decrypt_secret(enc) == plain


@pytest.mark.unit
def test_refresh_and_invite_expiry_are_future():
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    assert refresh_token_expiry() > now
    assert invite_token_expiry() > now
