"""Unit tests for PAT digests, pepper map, and production pepper validation."""

from __future__ import annotations

import hmac

import pytest
from pydantic import ValidationError

from app.core import api_key_digest
from app.core.api_key_digest import (
    digest_legacy_full_token,
    digest_v1_secret,
    parse_pepper_map,
)
from app.core.config import Settings


def test_legacy_digests_full_raw_token():
    raw = "fd_pat_abc123secret"
    assert digest_legacy_full_token(raw) == digest_legacy_full_token(raw)
    assert digest_legacy_full_token(raw) != digest_legacy_full_token("abc123secret")


def test_v1_hmac_uses_pepper():
    a = digest_v1_secret("secret", b"pepper-a")
    b = digest_v1_secret("secret", b"pepper-b")
    assert a != b
    assert hmac.compare_digest(a, digest_v1_secret("secret", b"pepper-a"))


def test_parse_pepper_map():
    m = parse_pepper_map('{"1":"one","2":"two"}')
    assert m[1] == b"one"
    assert m[2] == b"two"


def test_resolve_pepper_exact_version(monkeypatch):
    api_key_digest.clear_pepper_cache()
    from app.core.config import settings as s

    monkeypatch.setattr(s, "API_KEY_PEPPERS", '{"1":"p1","2":"p2"}')
    api_key_digest.clear_pepper_cache()
    assert api_key_digest.resolve_pepper(1) == b"p1"
    assert api_key_digest.resolve_pepper(2) == b"p2"
    assert api_key_digest.resolve_pepper(99) is None


def _prod_settings_kwargs(**overrides):
    base = {
        "ENVIRONMENT": "production",
        "DEBUG": False,
        "SECRET_KEY": "prod-test-secret-key-32chars-min!!",
        "FRONTEND_URL": "https://example.com",
        "BACKEND_URL": "https://api.example.com",
        "DATABASE_URL": "postgresql+psycopg2://u:p@db.example.com:5432/flowdesk",
        "MICROSOFT_TENANT": "common",
        "STORAGE_BACKEND": "local",
        "GITHUB_WEBHOOK_SECRET": "whsec",
        "API_KEY_PEPPERS": '{"1":"REDACTED-PEPPER"}',
        "API_KEY_PEPPER_CURRENT": 1,
    }
    base.update(overrides)
    return base


def test_production_rejects_empty_peppers():
    with pytest.raises(ValidationError, match="API_KEY_PEPPERS must be set"):
        Settings(_env_file=None, **_prod_settings_kwargs(API_KEY_PEPPERS=""))


def test_production_rejects_malformed_peppers_json():
    with pytest.raises(ValidationError, match="API_KEY_PEPPERS"):
        Settings(_env_file=None, **_prod_settings_kwargs(API_KEY_PEPPERS="not-json"))


def test_production_rejects_current_missing_from_map():
    with pytest.raises(ValidationError, match="API_KEY_PEPPER_CURRENT"):
        Settings(
            _env_file=None,
            **_prod_settings_kwargs(
                API_KEY_PEPPERS='{"1":"REDACTED"}',
                API_KEY_PEPPER_CURRENT=99,
            ),
        )


def test_production_accepts_valid_pepper_map():
    s = Settings(_env_file=None, **_prod_settings_kwargs())
    assert s.API_KEY_PEPPER_CURRENT == 1
