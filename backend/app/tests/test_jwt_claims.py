"""Unit tests for JWT claim validation (issue #30)."""
import uuid

import jwt

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token


def test_access_token_includes_aud_iss_jti():
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == str(user_id)
    assert payload["iss"] == settings.JWT_ISSUER
    assert payload["aud"] == settings.JWT_AUDIENCE
    assert payload["jti"]


def test_decode_rejects_wrong_audience():
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    raw = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        options={"verify_aud": False, "verify_iss": False},
    )
    raw["aud"] = "wrong-audience"
    tampered = jwt.encode(raw, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    assert decode_access_token(tampered) is None


def test_decode_rejects_wrong_issuer():
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    raw = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        options={"verify_aud": False, "verify_iss": False},
    )
    raw["iss"] = "wrong-issuer"
    tampered = jwt.encode(raw, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    assert decode_access_token(tampered) is None
