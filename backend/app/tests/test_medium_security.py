"""Regression tests for medium-severity security issues #11-#18."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.core.email_safety import escape_html
from app.core.sheet_safety import sanitize_sheet_cell
from app.services import ws_ticket_service
from app.services.login_lockout_service import assert_not_locked, clear_lockout, record_failed_attempt


def test_escape_html_neutralises_script_tags():
    assert "&lt;script&gt;" in escape_html("<script>alert(1)</script>")


def test_sanitize_sheet_cell_prefixes_formula():
    assert sanitize_sheet_cell("=1+1") == "'=1+1"
    assert sanitize_sheet_cell("+cmd") == "'+cmd"
    assert sanitize_sheet_cell("hello") == "hello"
    assert sanitize_sheet_cell(None) is None
    assert sanitize_sheet_cell(42) == 42


def test_ws_ticket_single_use():
    user_id = uuid.uuid4()
    ticket, _ = ws_ticket_service.issue_ws_ticket(user_id)
    assert ws_ticket_service.redeem_ws_ticket(ticket) == user_id
    assert ws_ticket_service.redeem_ws_ticket(ticket) is None


def test_login_lockout_blocks_after_repeated_failures(monkeypatch):
    monkeypatch.setattr("app.services.login_lockout_service.settings.OTP_LOCKOUT_ATTEMPTS", 2)
    email = "lockout@test.dev"
    clear_lockout(email)
    record_failed_attempt(email)
    record_failed_attempt(email)
    with pytest.raises(HTTPException) as exc:
        assert_not_locked(email)
    assert exc.value.status_code == 429
    clear_lockout(email)


def test_microsoft_allowed_tenant_rejects_consumer_for_organizations(monkeypatch):
    from app.services.auth_service import _MS_CONSUMER_TENANT, _microsoft_allowed_tenant

    monkeypatch.setattr("app.services.auth_service.settings.MICROSOFT_TENANT", "organizations")
    assert _microsoft_allowed_tenant("contoso-tenant-id") is True
    assert _microsoft_allowed_tenant(_MS_CONSUMER_TENANT) is False
