"""Final coverage boost — sprints rollover, Google calendar types, auth refresh, calendar/chat APIs."""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.core.security import create_access_token, generate_token, hash_token
from app.models.user import RefreshToken
from app.services import auth_service, google_service
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, add_task, build_project_stack, seed_google_connection


@pytest.mark.coverage
@patch("app.api.v1.sprints.email_service.send_sprint_completed_email")
def test_sprint_complete_with_rollover(mock_email, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="ROL")
    headers = auth_headers(client, owner.email)
    s1 = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Sprint A", "project_id": str(project.id)},
    ).json()
    s2 = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Sprint B", "project_id": str(project.id)},
    ).json()
    open_task = add_task(db, project, owner, title="Carry over", number=1)
    open_task.story_points = 3
    db.flush()
    client.post(f"/api/v1/sprints/{s1['id']}/start", headers=headers)
    client.post(f"/api/v1/sprints/{s1['id']}/tasks", headers=headers, json={"task_ids": [str(open_task.id)]})

    done = client.post(
        f"/api/v1/sprints/{s1['id']}/complete",
        headers=headers,
        json={"move_incomplete_to": s2["id"]},
    )
    assert done.status_code == 200
    assert done.json()["sprint"]["status"] == "completed"
    mock_email.assert_called()


@pytest.mark.coverage
def test_sprint_tasks_list_and_burndown(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    sprint = client.post(
        f"/api/v1/workspaces/{workspace.id}/sprints",
        headers=headers,
        json={"name": "Burndown", "project_id": str(project.id)},
    ).json()
    task = add_task(db, project, owner, title="SP task", number=2)
    task.story_points = 5
    db.flush()
    client.post(f"/api/v1/sprints/{sprint['id']}/tasks", headers=headers, json={"task_ids": [str(task.id)]})

    tasks = client.get(f"/api/v1/sprints/{sprint['id']}/tasks", headers=headers)
    assert tasks.status_code == 200
    assert len(tasks.json()) >= 1

    burndown = client.get(f"/api/v1/sprints/{sprint['id']}/burndown", headers=headers)
    assert burndown.status_code == 200


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.post")
def test_calendar_focus_time_event(mock_post, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"id": "focus-1", "htmlLink": "https://cal/f"})
    start = datetime.now(timezone.utc)
    end = start + timedelta(hours=2)
    result = google_service.calendar_create_timed_event(
        db,
        conn,
        summary="Focus block",
        description="Deep work",
        start_at=start,
        end_at=end,
        event_type="focusTime",
        auto_decline=True,
    )
    assert result["id"] == "focus-1"
    body = mock_post.call_args.kwargs["json"]
    assert body["eventType"] == "focusTime"
    assert body["transparency"] == "opaque"
    assert "extendedProperties" not in body
    assert body["focusTimeProperties"]["autoDeclineMode"] == "declineAllConflictingInvitations"
    assert body["focusTimeProperties"]["chatStatus"] == "doNotDisturb"
    assert "dateTime" in body["start"]


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.post")
def test_calendar_out_of_office_event(mock_post, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    mock_post.return_value = MagicMock(ok=True, json=lambda: {"id": "ooo-1", "htmlLink": "https://cal/o"})
    start = datetime.now(timezone.utc)
    end = start + timedelta(days=1)
    result = google_service.calendar_create_timed_event(
        db,
        conn,
        summary="OOO",
        description="Away",
        start_at=start,
        end_at=end,
        event_type="outOfOffice",
    )
    assert result["id"] == "ooo-1"
    body = mock_post.call_args.kwargs["json"]
    assert body["eventType"] == "outOfOffice"
    assert body["transparency"] == "opaque"
    assert "extendedProperties" not in body
    assert body["outOfOfficeProperties"]["autoDeclineMode"] == "declineNone"
    assert "dateTime" in body["start"]


@pytest.mark.coverage
@patch("app.services.google_service.fresh_access_token", return_value="tok")
@patch("app.services.google_service.http.post")
def test_calendar_focus_time_falls_back_when_google_rejects(mock_post, _tok, db, owner):
    conn = seed_google_connection(db, owner)
    start = datetime.now(timezone.utc)
    end = start + timedelta(hours=2)
    mock_post.side_effect = [
        MagicMock(
            ok=False,
            status_code=400,
            text='{"error":{"message":"Invalid focus time"}}',
            json=lambda: {"error": {"message": "Invalid focus time"}},
        ),
        MagicMock(ok=True, json=lambda: {"id": "evt-fallback", "htmlLink": "https://cal/f"}),
    ]
    result = google_service.calendar_create_timed_event(
        db,
        conn,
        summary="Focus block",
        description="",
        start_at=start,
        end_at=end,
        event_type="focusTime",
    )
    assert result["id"] == "evt-fallback"
    assert mock_post.call_count == 2
    fallback_body = mock_post.call_args_list[1].kwargs["json"]
    assert "eventType" not in fallback_body


@pytest.mark.coverage
def test_calendar_api_error_surfaces_google_message():
    res = MagicMock()
    res.status_code = 400
    res.text = '{"error":{"message":"Quota exceeded"}}'
    res.json.return_value = {"error": {"message": "Quota exceeded"}}
    assert "Quota exceeded" in google_service._calendar_api_error(res, "create event")


@pytest.mark.coverage
def test_calendar_api_error_when_response_is_not_json():
    res = MagicMock()
    res.status_code = 500
    res.text = "upstream error"
    res.json.side_effect = ValueError("not json")
    detail = google_service._calendar_api_error(res, "create event")
    assert detail == "Google Calendar API error (create event)"


@pytest.mark.coverage
def test_auth_refresh_token_reuse_revokes_family(db, org, owner):
    raw = generate_token()
    record = RefreshToken(
        user_id=owner.id,
        token_hash=hash_token(raw),
        family_id=owner.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        revoked_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        replaced_by_hash=hash_token(generate_token()),
    )
    db.add(record)
    db.flush()
    with pytest.raises(auth_service.AuthError):
        auth_service.rotate_refresh_token(db, raw, user_agent="test", ip_address="127.0.0.1")


@pytest.mark.coverage
def test_auth_revoke_access_and_refresh(db, owner):
    raw_refresh = generate_token()
    db.add(
        RefreshToken(
            user_id=owner.id,
            token_hash=hash_token(raw_refresh),
            family_id=owner.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        )
    )
    db.flush()
    auth_service.revoke_refresh_token(db, raw_refresh)
    access = create_access_token(owner.id, False)
    auth_service.revoke_access_token_from_raw(db, access)
    assert auth_service.is_access_token_revoked(db, "nonexistent-jti") is False


@pytest.mark.coverage
def test_task_share_add_member_by_user_id(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "share-id@test.dev")
    task = add_task(db, project, owner, title="Share by id", number=9)
    task.is_private = True
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/tasks/{task.id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert response.status_code == 201
    assert any(m["user_id"] == str(member.id) for m in response.json()["members"])


@pytest.mark.coverage
@patch("app.api.v1.calendar.http.get")
def test_calendar_upcoming_events(mock_get, client, db, owner):
    seed_google_connection(db, owner)
    mock_get.return_value = MagicMock(
        ok=True,
        json=lambda: {
            "items": [
                {
                    "id": "evt-1",
                    "summary": "Standup",
                    "start": {"dateTime": "2026-06-20T09:00:00Z"},
                    "end": {"dateTime": "2026-06-20T09:30:00Z"},
                }
            ]
        },
    )
    headers = auth_headers(client, owner.email)
    response = client.get("/api/v1/calendar/events", headers=headers)
    assert response.status_code == 200
    assert response.json()[0]["summary"] == "Standup"


@pytest.mark.coverage
def test_chat_channel_messages_and_read(client, db, org, owner):
    from app.models.chat import ChatChannel, ChatMember

    workspace, _ = build_project_stack(db, org, owner)
    channel = ChatChannel(workspace_id=workspace.id, name="boost-chat", is_private=True, created_by=owner.id)
    db.add(channel)
    db.flush()
    db.add(ChatMember(channel_id=channel.id, user_id=owner.id))
    db.flush()
    headers = auth_headers(client, owner.email)

    sent = client.post(
        f"/api/v1/channels/{channel.id}/messages",
        headers=headers,
        json={"body": "Hello coverage"},
    )
    assert sent.status_code == 201
    message_id = sent.json()["id"]

    listed = client.get(f"/api/v1/channels/{channel.id}/messages", headers=headers)
    assert listed.status_code == 200

    read = client.post(
        f"/api/v1/channels/{channel.id}/read",
        headers=headers,
        json={"message_id": message_id},
    )
    assert read.status_code == 200


@pytest.mark.coverage
@patch("app.api.v1.integrations.run_sync")
@patch("app.api.v1.integrations.google_service.sheets_create")
def test_integrations_toggle_sheet_sync(mock_create, mock_run, client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_key="SYN")
    seed_google_connection(db, owner)
    mock_create.return_value = ("sheet-new", "https://sheets/new")
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/projects/{project.id}/sheets/sync",
        headers=headers,
        json={"enabled": True, "mode": "export"},
    )
    assert response.status_code == 200
    assert response.json()["enabled"] is True
    mock_run.assert_called_once()
