"""Phase 2 unit tests — login lockout service."""
import pytest
from fastapi import HTTPException

from app.services.login_lockout_service import assert_not_locked, clear_lockout, record_failed_attempt


@pytest.mark.unit
def test_lockout_after_threshold(monkeypatch):
    monkeypatch.setattr("app.services.login_lockout_service.settings.OTP_LOCKOUT_ATTEMPTS", 3)
    email = "lockout-unit@test.dev"
    clear_lockout(email)

    record_failed_attempt(email)
    record_failed_attempt(email)
    assert_not_locked(email)

    record_failed_attempt(email)
    with pytest.raises(HTTPException) as exc:
        assert_not_locked(email)
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers
    clear_lockout(email)


@pytest.mark.unit
def test_clear_lockout_resets_counter(monkeypatch):
    monkeypatch.setattr("app.services.login_lockout_service.settings.OTP_LOCKOUT_ATTEMPTS", 1)
    email = "clear-lock@test.dev"
    record_failed_attempt(email)
    clear_lockout(email)
    assert_not_locked(email)


@pytest.mark.unit
def test_email_normalized_to_lowercase(monkeypatch):
    monkeypatch.setattr("app.services.login_lockout_service.settings.OTP_LOCKOUT_ATTEMPTS", 1)
    clear_lockout("Mixed@Test.dev")
    record_failed_attempt("MIXED@test.dev")
    with pytest.raises(HTTPException):
        assert_not_locked("mixed@test.dev")
    clear_lockout("mixed@test.dev")
