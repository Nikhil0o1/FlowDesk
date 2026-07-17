"""Integration — chat message attachments, editing and deletion."""
import io

import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


def _create_channel(client, headers, workspace_id, name="eng"):
    res = client.post(
        f"/api/v1/workspaces/{workspace_id}/channels",
        headers=headers,
        json={"name": name, "is_private": False},
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _upload(client, headers, channel_id, filename="notes.txt", content=b"hello world"):
    return client.post(
        f"/api/v1/channels/{channel_id}/attachments",
        headers=headers,
        files={"file": (filename, io.BytesIO(content), "text/plain")},
    )


@pytest.mark.integration
def test_send_message_with_attachment(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    channel_id = _create_channel(client, headers, workspace.id)

    upload = _upload(client, headers, channel_id)
    assert upload.status_code == 201, upload.text
    attachment_id = upload.json()["id"]
    assert upload.json()["message_id"] is None

    sent = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=headers,
        json={"body": "see attached", "attachment_ids": [attachment_id]},
    )
    assert sent.status_code == 201, sent.text
    assert [a["id"] for a in sent.json()["attachments"]] == [attachment_id]

    listed = client.get(f"/api/v1/channels/{channel_id}/messages", headers=headers)
    msg = next(m for m in listed.json()["items"] if m["id"] == sent.json()["id"])
    assert msg["attachments"][0]["file_name"] == "notes.txt"

    download = client.get(f"/api/v1/chat-attachments/{attachment_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.content == b"hello world"


@pytest.mark.integration
def test_attachment_only_message_allowed_but_empty_message_rejected(client, db, org, owner):
    workspace, _project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    channel_id = _create_channel(client, headers, workspace.id, name="files")

    empty = client.post(
        f"/api/v1/channels/{channel_id}/messages", headers=headers, json={"body": "   "}
    )
    assert empty.status_code == 400

    attachment_id = _upload(client, headers, channel_id).json()["id"]
    sent = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=headers,
        json={"body": "", "attachment_ids": [attachment_id]},
    )
    assert sent.status_code == 201, sent.text


@pytest.mark.integration
def test_cannot_claim_someone_elses_attachment(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "chat-claimer@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)
    channel_id = _create_channel(client, owner_headers, workspace.id, name="shared")

    attachment_id = _upload(client, owner_headers, channel_id).json()["id"]
    steal = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=member_headers,
        json={"body": "mine now", "attachment_ids": [attachment_id]},
    )
    assert steal.status_code == 400


@pytest.mark.integration
def test_pending_attachment_can_be_removed_by_uploader_only(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "chat-remover@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)
    channel_id = _create_channel(client, owner_headers, workspace.id, name="uploads")

    attachment_id = _upload(client, owner_headers, channel_id).json()["id"]
    denied = client.delete(f"/api/v1/chat-attachments/{attachment_id}", headers=member_headers)
    assert denied.status_code == 404
    removed = client.delete(f"/api/v1/chat-attachments/{attachment_id}", headers=owner_headers)
    assert removed.status_code == 200


@pytest.mark.integration
def test_edit_own_message_sets_edited_at_and_rejects_others(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "chat-editor@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)
    channel_id = _create_channel(client, owner_headers, workspace.id, name="editing")

    message_id = client.post(
        f"/api/v1/channels/{channel_id}/messages",
        headers=owner_headers,
        json={"body": "first draft"},
    ).json()["id"]

    edited = client.patch(
        f"/api/v1/channels/{channel_id}/messages/{message_id}",
        headers=owner_headers,
        json={"body": "final version"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["body"] == "final version"
    assert edited.json()["edited_at"] is not None

    forbidden = client.patch(
        f"/api/v1/channels/{channel_id}/messages/{message_id}",
        headers=member_headers,
        json={"body": "hijacked"},
    )
    assert forbidden.status_code == 403


@pytest.mark.integration
def test_delete_message_author_and_admin_but_not_plain_member(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "chat-deleter@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)
    channel_id = _create_channel(client, owner_headers, workspace.id, name="deleting")

    owner_msg = client.post(
        f"/api/v1/channels/{channel_id}/messages", headers=owner_headers, json={"body": "admin says"}
    ).json()["id"]
    member_msg = client.post(
        f"/api/v1/channels/{channel_id}/messages", headers=member_headers, json={"body": "member says"}
    ).json()["id"]

    # Plain member cannot delete someone else's message.
    denied = client.delete(
        f"/api/v1/channels/{channel_id}/messages/{owner_msg}", headers=member_headers
    )
    assert denied.status_code == 403

    # Author deletes their own; workspace admin deletes anyone's.
    assert (
        client.delete(f"/api/v1/channels/{channel_id}/messages/{member_msg}", headers=member_headers).status_code
        == 200
    )
    assert (
        client.delete(f"/api/v1/channels/{channel_id}/messages/{owner_msg}", headers=owner_headers).status_code
        == 200
    )

    listed = client.get(f"/api/v1/channels/{channel_id}/messages", headers=owner_headers)
    ids = {m["id"] for m in listed.json()["items"]}
    assert owner_msg not in ids and member_msg not in ids
