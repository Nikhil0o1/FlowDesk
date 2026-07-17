"""Phase 2 unit tests — email service URL helpers and invite/role templates."""
from unittest.mock import MagicMock, patch

import pytest

from app.services import email_service


@pytest.mark.unit
def test_activate_url_uses_fragment_token(monkeypatch):
    monkeypatch.setattr("app.services.email_service.settings.FRONTEND_URL", "https://app.example.com")
    url = email_service._activate_url("activate-token")
    assert url.startswith("https://app.example.com/activate-invite?token=")
    assert "activate-token" in url


@pytest.mark.unit
def test_accept_url_uses_fragment_token(monkeypatch):
    monkeypatch.setattr("app.services.email_service.settings.FRONTEND_URL", "https://app.example.com")
    url = email_service._accept_url("accept-token")
    assert "?token=" in url


@pytest.mark.unit
def test_fragment_token_url_encodes_special_chars(monkeypatch):
    monkeypatch.setattr("app.services.email_service.settings.FRONTEND_URL", "https://app.example.com")
    url = email_service._fragment_token_url("/reset-password", "a+b/c")
    assert "%2B" in url or "a+b" in url


@pytest.mark.unit
def test_new_user_invite_email_clean_copy():
    subject, title, body = email_service.role_access_email_content(
        "organization", "admin", org_name="Acme Corp", is_welcome=True
    )
    assert title == 'Welcome to "Acme Corp" organization'
    assert "org admin" in body.lower()
    assert "manage workspaces" in body.lower()


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_new_user_invite_email_dispatches(mock_send):
    email_service.send_new_user_invite_email("new@test.dev", "Acme Corp", "Alice", "token-1")
    mock_send.assert_called_once()
    html = mock_send.call_args[0][2]
    assert "Alice" in html
    assert "Acme Corp" in html
    assert "Activate your account" in html
    assert "org admin" not in html.lower()
    assert "workspace admin" not in html.lower()


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_new_user_invite_email_welcome_variant_when_scope_known(mock_send):
    email_service.send_new_user_invite_email(
        "new@test.dev",
        "Acme Corp",
        "Alice",
        "token-1",
        scope="workspace",
        role="admin",
        workspace_name="Engineering",
    )
    html = mock_send.call_args[0][2]
    subject = mock_send.call_args[0][1]
    assert subject == 'Welcome to "Acme Corp" organization on FlowDesk'
    assert "Welcome to &quot;Acme Corp&quot; organization" in html
    assert "workspace admin" in html.lower()
    assert "Engineering" in html
    assert "Activate your account" in html


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_bulk_new_user_invite_single_uses_welcome_design(mock_send):
    email_service.send_bulk_new_user_invite_email(
        "new@test.dev",
        "Alice",
        "Acme Corp",
        [("project", "viewer", "Phoenix", "tok-1")],
    )
    html = mock_send.call_args[0][2]
    subject = mock_send.call_args[0][1]
    assert subject == 'Welcome to "Acme Corp" organization on FlowDesk'
    assert "Welcome to &quot;Acme Corp&quot; organization" in html
    assert "project viewer" in html.lower()
    assert "Phoenix" in html
    assert "Activate your account" in html


@pytest.mark.unit
def test_role_access_welcome_org_owner_copy():
    _, title, body = email_service.role_access_email_content(
        "organization", "owner", org_name="Acme Corp", is_welcome=True
    )
    assert title == 'Welcome to "Acme Corp" organization'
    assert "organisation owner" in body.lower()
    assert "manage workspaces" in body.lower()


@pytest.mark.unit
def test_scope_name_slots_routes_each_scope():
    assert email_service._scope_name_slots("workspace", "WS")["workspace_name"] == "WS"
    assert email_service._scope_name_slots("space", "SP")["space_name"] == "SP"
    assert email_service._scope_name_slots("project", "PR")["project_name"] == "PR"
    org = email_service._scope_name_slots("organization", "Org")
    assert org == {"workspace_name": None, "space_name": None, "project_name": None}


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_existing_user_invite_email_org_scope_uses_org_name(mock_send):
    email_service.send_existing_user_invite_email(
        "user@test.dev", "organization", "member", "Alice", "tok", "Acme Corp", "Acme Corp"
    )
    subject = mock_send.call_args[0][1]
    html = mock_send.call_args[0][2]
    assert subject == 'Alice invited you to "Acme Corp" organization on FlowDesk'
    assert "Accept invitation" in html


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_onboarding_aliases_use_clean_invite(mock_send):
    token = "invite-token"
    email_service.send_org_admin_onboarding_email("admin@test.dev", "Acme", "Alice", token)
    email_service.send_workspace_admin_onboarding_email("ws@test.dev", "Eng", "Acme", "Alice", token)
    assert mock_send.call_count == 2
    for call in mock_send.call_args_list:
        html = call[0][2]
        assert "Activate your account" in html
        assert "org admin" not in html.lower()


@pytest.mark.unit
def test_role_access_email_existing_user_space_admin():
    _, title, body = email_service.role_access_email_content(
        "space",
        "admin",
        org_name="Acme",
        workspace_name="Engineering",
        space_name="Design",
        is_welcome=False,
    )
    assert title == "Your access has been updated"
    assert "space admin" in body.lower()
    assert "Design" in body
    assert "Engineering" in body


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_existing_user_invite_email_no_role_details(mock_send):
    email_service.send_existing_user_invite_email(
        "existing@test.dev",
        "space",
        "admin",
        "Alice",
        "token-123",
        "Acme",
        "Design",
    )
    mock_send.assert_called_once()
    html = mock_send.call_args[0][2]
    assert "Design" in html
    assert "Accept invitation" in html
    assert "space admin" not in html.lower()


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
def test_role_access_email_dispatches(mock_send):
    email_service.send_role_access_email(
        "user@test.dev",
        "organization",
        "admin",
        org_name="Acme Corp",
        is_welcome=True,
    )
    mock_send.assert_called_once()
    html = mock_send.call_args[0][2]
    assert "Welcome to &quot;Acme Corp&quot; organization" in html
    assert "org admin" in html.lower()


@pytest.mark.unit
def test_superadmin_inviter_uses_platform_team_label():
    from app.services.invite_service import _inviter_label
    from app.models.user import User

    superadmin = User(email="super@test.dev", is_platform_superadmin=True)
    assert _inviter_label(superadmin).startswith("The ")
    assert "team" in _inviter_label(superadmin).lower()


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
@patch("app.services.google_service.try_gmail_send", return_value=True)
def test_send_invite_uses_gmail_when_enabled(mock_gmail, mock_send, monkeypatch):
    monkeypatch.setattr("app.services.email_service.settings.INVITE_EMAILS_VIA_USER_GMAIL", True)
    email_service._send_invite("to@test.dev", "Subject", "<p>Hi</p>", db=MagicMock(), sender_id="user-id")
    mock_gmail.assert_called_once()
    mock_send.assert_not_called()


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
def test_bulk_new_user_invite_email_uses_single_activation_link(mock_send):
    items = [
        ("project", "member", "Alpha", "token-alpha"),
        ("project", "viewer", "Beta", "token-beta"),
    ]
    email_service.send_bulk_new_user_invite_email(
        "new@test.dev", "Alice", "Acme Corp", items
    )
    mock_send.assert_called_once()
    html = mock_send.call_args[0][2]
    # A single "Activate your account" CTA (primary token) unlocks every place.
    assert "Activate your account" in html
    assert "token-alpha" in html
    assert html.count("token-alpha") == 1
    assert "token-beta" not in html
    assert "Activate this access" not in html
    # Places are still listed so the invitee sees what they will get.
    assert "Alpha" in html
    assert "Beta" in html
    # No role details leaked.
    assert "project member" not in html.lower()
    assert "project viewer" not in html.lower()


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
def test_bulk_new_user_invite_email_single_uses_primary_cta(mock_send):
    items = [("workspace", "member", "Engineering", "solo-token")]
    email_service.send_bulk_new_user_invite_email(
        "new@test.dev", "Alice", "Acme Corp", items
    )
    html = mock_send.call_args[0][2]
    assert "solo-token" in html
    assert "Activate your account" in html
    assert "Activate this access" not in html


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
def test_bulk_existing_user_invite_email_lists_accept_link_per_invite(mock_send):
    items = [
        ("project", "member", "Alpha", "token-alpha"),
        ("project", "admin", "Beta", "token-beta"),
    ]
    email_service.send_bulk_existing_user_invite_email(
        "existing@test.dev", "Alice", "Acme Corp", items
    )
    html = mock_send.call_args[0][2]
    assert html.count("Accept this invitation") == 2
    assert "token-alpha" in html
    assert "token-beta" in html


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_bulk_existing_user_invite_email_single_place(mock_send):
    email_service.send_bulk_existing_user_invite_email(
        "existing@test.dev",
        "Alice",
        "Acme Corp",
        [("workspace", "member", "Engineering", "solo-token")],
    )
    subject = mock_send.call_args[0][1]
    html = mock_send.call_args[0][2]
    assert subject == "You're invited to Engineering on FlowDesk"
    assert "Engineering" in html
    assert "Accept invitation" in html
    assert "solo-token" in html


@pytest.mark.unit
@patch("app.services.email_service._send_invite")
def test_onboarding_alias_wrappers_delegate_to_new_user_invite(mock_send):
    token = "invite-token"
    email_service.send_owner_onboarding_email("owner@test.dev", "Acme", "Alice", token)
    email_service.send_org_member_onboarding_email("member@test.dev", "Acme", "Alice", token)
    email_service.send_workspace_member_onboarding_email("ws@test.dev", "Eng", "Acme", "Alice", token)
    email_service.send_space_admin_onboarding_email("space@test.dev", "Design", "Acme", "Alice", token)
    email_service.send_space_member_onboarding_email("space-m@test.dev", "Design", "Acme", "Alice", token)
    email_service.send_project_admin_onboarding_email("proj@test.dev", "Phoenix", "Acme", "Alice", token)
    email_service.send_project_member_onboarding_email("proj-m@test.dev", "Phoenix", "Acme", "Alice", token)
    email_service.send_project_viewer_onboarding_email("viewer@test.dev", "Phoenix", "Acme", "Alice", token)
    assert mock_send.call_count == 8
    for call in mock_send.call_args_list:
        assert "Activate your account" in call[0][2]


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
def test_send_test_notification_email_dispatches(mock_send):
    email_service.send_test_notification_email("user@test.dev")
    mock_send.assert_called_once()
    subject = mock_send.call_args[0][1]
    html = mock_send.call_args[0][2]
    assert subject == "FlowDesk test notification"
    assert "test email from FlowDesk" in html
    assert "Open inbox" in html


@pytest.mark.unit
@patch("app.services.email_service.send_email_async")
def test_product_notification_emails_dispatch(mock_send):
    email_service.send_task_assigned_email("u@test.dev", "Fix bug", "FD-1", "Bob", "https://app/task/1")
    email_service.send_task_shared_email("u@test.dev", "Fix bug", "FD-1", "Bob", "https://app/task/1")
    email_service.send_doc_shared_email("u@test.dev", "Team Notes", "Bob", "https://app/docs/1")
    email_service.send_mention_email("u@test.dev", "Bob", "FD-1", "hello", "https://app/task/1")
    email_service.send_comment_reply_email("u@test.dev", "Bob", "FD-1", "reply", "https://app/task/1")
    email_service.send_due_date_reminder_email("u@test.dev", "Fix bug", "FD-1", "today", "https://app/task/1")
    email_service.send_sprint_started_email("u@test.dev", "Sprint 1", "Ship it", "Friday", "https://app/sprint/1")
    email_service.send_sprint_started_email("u@test.dev", "Sprint 2", None, None, "https://app/sprint/2")
    email_service.send_sprint_completed_email("u@test.dev", "Sprint 1", 8, 10, "https://app/sprint/1")
    email_service.send_login_otp_email("u@test.dev", "123456", 10)
    email_service.send_daily_digest_email("u@test.dev", "Sam", "<ul><li>Task</li></ul>")
    email_service.send_daily_digest_email("u@test.dev", "", "<ul><li>Task</li></ul>")
    email_service.send_github_pr_email("u@test.dev", "merged", "Add feature", "org/repo", "https://github.com/pr/1")
    assert mock_send.call_count == 13
