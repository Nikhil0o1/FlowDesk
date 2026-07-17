"""Integration — user avatar upload and profile activity."""
from io import BytesIO
from unittest.mock import patch

import pytest

from app.models.activity import ActivityLog
from app.tests.conftest import auth_headers


@pytest.mark.integration
@patch("app.services.storage_service.get_storage")
def test_upload_avatar_and_fetch(mock_get_storage, client, db, owner, tmp_path):
    from app.services.storage_service import LocalStorage

    storage = LocalStorage(str(tmp_path / "avatars"))
    mock_get_storage.return_value = storage
    headers = auth_headers(client, owner.email)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16

    response = client.post(
        "/api/v1/users/me/avatar",
        headers=headers,
        files={"file": ("avatar.png", BytesIO(png), "image/png")},
    )
    assert response.status_code == 200
    assert response.json()["profile"]["avatar_url"]

    avatar = client.get(f"/api/v1/users/{owner.id}/avatar")
    assert avatar.status_code == 200
    assert avatar.content.startswith(b"\x89PNG")


@pytest.mark.integration
def test_my_activity_feed(client, db, org, owner):
    from app.tests.helpers import build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    db.add(
        ActivityLog(
            workspace_id=workspace.id,
            project_id=project.id,
            actor_id=owner.id,
            action="task.created",
            data={"title": "Activity item"},
        )
    )
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/users/me/activity", headers=headers)
    assert response.status_code == 200
    assert len(response.json()) >= 1


@pytest.mark.integration
def test_update_profile_clears_status(client, owner):
    headers = auth_headers(client, owner.email)
    set_status = client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"status_text": "In a meeting"},
    )
    assert set_status.status_code == 200

    cleared = client.patch(
        "/api/v1/users/me/profile",
        headers=headers,
        json={"clear_status": True},
    )
    assert cleared.status_code == 200
    assert cleared.json()["profile"]["status_text"] is None
