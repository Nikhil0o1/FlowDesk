"""FlowDesk Docs — integration tests."""
import json
from unittest.mock import patch

import pytest

from app.models.document import DocFolder
from app.models.organization import OrganizationMember
from app.models.workspace import WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack


@pytest.mark.integration
def test_docs_crud_flow(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-folders",
        headers=headers,
        json={"name": "Engineering"},
    )
    assert folder.status_code == 201, folder.text
    folder_id = folder.json()["id"]

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Getting Started", "folder_id": folder_id, "content": "<p>Hello</p>"},
    )
    assert create.status_code == 201, create.text
    doc_id = create.json()["id"]
    assert create.json()["author_id"]

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/documents", headers=headers)
    assert listed.status_code == 200
    assert any(d["id"] == doc_id for d in listed.json())

    patch = client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={"title": "Getting Started v2", "create_version": True},
    )
    assert patch.status_code == 200
    assert patch.json()["title"] == "Getting Started v2"

    versions = client.get(f"/api/v1/documents/{doc_id}/versions", headers=headers)
    assert versions.status_code == 200
    assert len(versions.json()) >= 1

    comment = client.post(
        f"/api/v1/documents/{doc_id}/comments",
        headers=headers,
        json={"body": "Looks good"},
    )
    assert comment.status_code == 201

    opened = client.post(f"/api/v1/documents/{doc_id}/open", headers=headers)
    assert opened.status_code == 200
    assert opened.json()["view_count"] >= 1

    recent = client.get("/api/v1/users/me/recent-documents", headers=headers)
    assert recent.status_code == 200
    assert any(r["document_id"] == doc_id for r in recent.json())

    remove_recent = client.delete(f"/api/v1/users/me/recent-documents/{doc_id}", headers=headers)
    assert remove_recent.status_code == 200
    recent_after = client.get("/api/v1/users/me/recent-documents", headers=headers)
    assert not any(r["document_id"] == doc_id for r in recent_after.json())

    client.post(f"/api/v1/documents/{doc_id}/open", headers=headers)
    clear_recent = client.delete("/api/v1/users/me/recent-documents", headers=headers)
    assert clear_recent.status_code == 200
    assert client.get("/api/v1/users/me/recent-documents", headers=headers).json() == []

    trash = client.post(f"/api/v1/documents/{doc_id}/trash", headers=headers)
    assert trash.status_code == 200
    assert trash.json()["deleted_at"]

    restore = client.post(f"/api/v1/documents/{doc_id}/restore", headers=headers)
    assert restore.status_code == 200
    assert restore.json()["deleted_at"] is None

    dup = client.post(f"/api/v1/documents/{doc_id}/duplicate", headers=headers)
    assert dup.status_code == 201

    fav = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-favorites",
        headers=headers,
        json={"target_id": doc_id, "target_type": "doc"},
    )
    assert fav.status_code == 201

    delete_folder = client.delete(f"/api/v1/doc-folders/{folder_id}", headers=headers)
    assert delete_folder.status_code == 200
    assert db.get(DocFolder, folder_id) is None


@pytest.mark.integration
def test_doc_export_formats(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Export Me", "content": "<h2>Section</h2><p>Body text</p>"},
    )
    assert create.status_code == 201, create.text
    doc_id = create.json()["id"]

    pdf = client.get(f"/api/v1/documents/{doc_id}/export?format=pdf", headers=headers)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"].startswith("application/pdf")
    assert pdf.content.startswith(b"%PDF")

    docx = client.get(f"/api/v1/documents/{doc_id}/export?format=docx", headers=headers)
    assert docx.status_code == 200
    assert "wordprocessingml.document" in docx.headers["content-type"]
    assert docx.content[:2] == b"PK"

    text = client.get(f"/api/v1/documents/{doc_id}/export?format=text", headers=headers)
    assert text.status_code == 200
    assert text.headers["content-type"].startswith("text/plain")
    assert b"Export Me" in text.content
    assert b"Body text" in text.content


@pytest.mark.integration
def test_doc_share_and_public(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Shared Doc", "content": "<p>Share me</p>"},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "doc-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    add = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "editor"},
    )
    assert add.status_code == 201

    member_headers = auth_headers(client, member.email)
    inbox = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=member_headers)
    assert inbox.status_code == 200
    items = inbox.json()["items"]
    assert any(n["type"] == "doc_shared" and doc_id in (n.get("data") or {}).get("document_id", "") for n in items), items

    share = client.patch(
        f"/api/v1/documents/{doc_id}/share",
        headers=headers,
        json={"public_enabled": True},
    )
    assert share.status_code == 200
    token = share.json()["public_token"]
    assert token

    public = client.get(f"/api/v1/public/documents/{token}")
    assert public.status_code == 200
    assert public.json()["title"] == "Shared Doc"

    get_doc = client.get(f"/api/v1/documents/{doc_id}", headers=member_headers)
    assert get_doc.status_code == 200
    assert get_doc.json()["user_role"] == "editor"


@pytest.mark.integration
def test_doc_folder_share_member_role_can_be_updated(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-folders",
        headers=headers,
        json={"name": "Private Folder"},
    )
    assert folder.status_code == 201, folder.text
    folder_id = folder.json()["id"]

    client.patch(
        f"/api/v1/doc-folders/{folder_id}/share",
        headers=headers,
        json={"is_private": True},
    )

    member = make_user(db, "doc-folder-role@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    add = client.post(
        f"/api/v1/doc-folders/{folder_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert add.status_code == 201, add.text

    updated = client.patch(
        f"/api/v1/doc-folders/{folder_id}/share/members/{member.id}",
        headers=headers,
        json={"role": "editor"},
    )
    assert updated.status_code == 200, updated.text
    row = next(m for m in updated.json()["members"] if m["user_id"] == str(member.id))
    assert row["role"] == "editor"


@pytest.mark.integration
def test_doc_workspace_share_notifies_members(client, db, org, owner):
    """Toggling workspace members share (is_private=false) notifies other members."""
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Workspace Wide Doc", "content": "<p>Hello team</p>"},
    )
    assert create.status_code == 201
    doc_id = create.json()["id"]

    member = make_user(db, "ws-share-notify@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    share = client.patch(
        f"/api/v1/documents/{doc_id}/share",
        headers=headers,
        json={"is_private": False},
    )
    assert share.status_code == 200, share.text
    assert share.json()["is_private"] is False

    member_headers = auth_headers(client, member.email)
    inbox = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=member_headers)
    assert inbox.status_code == 200
    items = inbox.json()["items"]
    assert any(
        n["type"] == "doc_shared" and n["data"].get("document_id") == doc_id
        for n in items
    ), items

    # Member can open the doc after workspace share.
    opened = client.get(f"/api/v1/documents/{doc_id}", headers=member_headers)
    assert opened.status_code == 200


@pytest.mark.integration
@patch("app.services.invite_service.create_invite")
def test_doc_share_member_by_email_invites_outsider(mock_invite, client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Email Share Doc", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"email": "outsider-doc@test.dev", "role": "viewer"},
    )
    assert response.status_code == 201
    assert "members" in response.json()
    mock_invite.assert_called_once()


@pytest.mark.integration
def test_doc_share_member_rejects_invalid_email(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Bad Email Doc", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"email": "not-an-email", "role": "viewer"},
    )
    assert response.status_code == 422


@pytest.mark.integration
@patch("app.services.email_service.send_doc_shared_email")
def test_doc_share_member_by_email_sends_doc_email(mock_email, client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Outsider Email Doc", "content": "<p>Hi</p>", "is_private": False},
    )
    doc_id = create.json()["id"]

    with patch("app.services.invite_service.create_invite") as mock_invite:
        response = client.post(
            f"/api/v1/documents/{doc_id}/share/members",
            headers=headers,
            json={"email": "brand-new-doc@test.dev", "role": "viewer"},
        )
    assert response.status_code == 201
    mock_invite.assert_called_once()
    mock_email.assert_called_once()
    assert mock_email.call_args.args[0] == "brand-new-doc@test.dev"


@pytest.mark.integration
@patch("app.services.invite_service.create_invite")
@patch("app.services.email_service.send_doc_shared_email")
def test_doc_share_by_email_org_member_not_in_workspace(mock_email, mock_invite, client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Org Member Doc", "content": "<p>Hi</p>", "is_private": False},
    )
    doc_id = create.json()["id"]

    org_member = make_user(db, "org-only-doc@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_member.id, role="member"))
    db.commit()

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"email": "org-only-doc@test.dev", "role": "commenter"},
    )
    assert response.status_code == 201
    mock_invite.assert_called_once()
    mock_email.assert_called_once()
    share = client.get(f"/api/v1/documents/{doc_id}/share", headers=headers)
    assert any(m["target_id"] == str(org_member.id) for m in share.json()["members"])
    doc = client.get(f"/api/v1/documents/{doc_id}", headers=headers)
    assert doc.json()["is_private"] is True


@pytest.mark.integration
@patch("app.services.email_service.send_doc_shared_email")
def test_doc_share_member_sends_email_to_workspace_member(mock_email, client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Notify Doc", "content": "<p>Hi</p>", "is_private": False},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "notify-doc@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert response.status_code == 201
    mock_email.assert_called_once()
    assert client.get(f"/api/v1/documents/{doc_id}", headers=headers).json()["is_private"] is True


@pytest.mark.integration
def test_doc_share_rejects_owner_role(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Owner Role Doc", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "owner-role-doc@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "owner"},
    )
    assert response.status_code == 400


@pytest.mark.integration
def test_doc_public_includes_page_metadata(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={
            "title": "Public Meta Doc",
            "content": "<p>Public body</p>",
            "is_wiki": True,
            "icon": "📘",
        },
    )
    doc_id = create.json()["id"]
    client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={
            "cover_url": "https://cdn.example/cover.png",
            "page_settings": {"subtitle": "A subtitle", "show_subtitle": True},
        },
    )

    share = client.patch(
        f"/api/v1/documents/{doc_id}/share",
        headers=headers,
        json={"public_enabled": True},
    )
    token = share.json()["public_token"]

    public = client.get(f"/api/v1/public/documents/{token}")
    assert public.status_code == 200
    body = public.json()
    assert body["title"] == "Public Meta Doc"
    assert body["icon"] == "📘"
    assert body["cover_url"] == "https://cdn.example/cover.png"
    assert body["is_wiki"] is True
    assert body["page_settings"]["subtitle"] == "A subtitle"


@pytest.mark.integration
def test_doc_duplicate_copies_share_metadata(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={
            "title": "Source Doc",
            "content": "<p>Body</p>",
            "is_wiki": True,
            "icon": "📝",
        },
    )
    doc_id = create.json()["id"]
    client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={
            "cover_url": "https://cdn.example/source.png",
            "page_settings": {"font_style": "serif"},
            "is_protected": True,
        },
    )

    dup = client.post(f"/api/v1/documents/{doc_id}/duplicate", headers=headers)
    assert dup.status_code == 201
    copy = dup.json()
    assert copy["title"] == "Source Doc (Copy)"
    assert copy["is_wiki"] is True
    assert copy["icon"] == "📝"
    assert copy["cover_url"] == "https://cdn.example/source.png"
    assert copy["is_protected"] is True
    assert copy["page_settings"]["font_style"] == "serif"
    assert copy["public_enabled"] is False


@pytest.mark.integration
def test_public_document_hides_archived_doc(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Archived Public", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]
    share = client.patch(
        f"/api/v1/documents/{doc_id}/share",
        headers=headers,
        json={"public_enabled": True},
    )
    token = share.json()["public_token"]

    archive = client.post(f"/api/v1/documents/{doc_id}/archive", headers=headers)
    assert archive.status_code == 200

    public = client.get(f"/api/v1/public/documents/{token}")
    assert public.status_code == 404


@pytest.mark.integration
def test_doc_share_member_rejects_duplicate_access(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Dup Share", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "dup-share-doc@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    first = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert first.status_code == 201
    second = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "editor"},
    )
    assert second.status_code == 409


@pytest.mark.integration
def test_doc_share_requires_user_or_email(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Missing Target", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"role": "viewer"},
    )
    assert response.status_code == 422


@pytest.mark.integration
def test_doc_share_rejects_user_outside_org(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Outside Org", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    outsider = make_user(db, "outside-org-doc@test.dev")
    db.commit()

    response = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(outsider.id), "role": "viewer"},
    )
    assert response.status_code == 400


@pytest.mark.integration
def test_doc_comment_mention_notifies_member(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Mention Doc", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "mention-doc-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "commenter"},
    )

    comment = client.post(
        f"/api/v1/documents/{doc_id}/comments",
        headers=headers,
        json={"body": f"Please review @[Member]({member.id})"},
    )
    assert comment.status_code == 201

    member_headers = auth_headers(client, member.email)
    inbox = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=member_headers)
    assert inbox.status_code == 200
    assert any(n["type"] == "doc_mention" for n in inbox.json()["items"])


@pytest.mark.integration
def test_doc_body_people_mention_notifies_member(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Body Mention Doc", "content": "<p>Hi</p>"},
    )
    assert create.status_code == 201
    doc_id = create.json()["id"]

    member = make_user(db, "mention-doc-body@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    chip = (
        f'<p>Hey <span class="doc-mention doc-mention-people" data-mention-type="people" '
        f'data-mention-id="{member.id}" contenteditable="false">@Member</span></p>'
    )
    patched = client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={"content": chip},
    )
    assert patched.status_code == 200, patched.text

    member_headers = auth_headers(client, member.email)
    inbox = client.get("/api/v1/notifications?tab=primary&view=inbox", headers=member_headers)
    assert inbox.status_code == 200
    items = inbox.json()["items"]
    assert any(n["type"] == "doc_mention" and n["data"].get("document_id") == doc_id for n in items)

    mentions = client.get(
        "/api/v1/notifications?tab=primary&view=inbox&filter=mentions",
        headers=member_headers,
    )
    assert mentions.status_code == 200
    assert any(n["type"] == "doc_mention" for n in mentions.json()["items"])


@pytest.mark.integration
def test_doc_body_mention_endpoint_notifies_immediately(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Instant Mention", "content": "<p>Hi</p>"},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "mention-doc-instant@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    chip = (
        f'<p>Ping <span data-mention-type="people" data-mention-id="{member.id}">@Member</span></p>'
    )
    resp = client.post(
        f"/api/v1/documents/{doc_id}/body-mentions",
        headers=headers,
        json={"user_id": str(member.id), "preview_html": chip},
    )
    assert resp.status_code == 200, resp.text

    member_headers = auth_headers(client, member.email)
    inbox = client.get("/api/v1/notifications?tab=primary&view=inbox&filter=mentions", headers=member_headers)
    assert inbox.status_code == 200
    items = inbox.json()["items"]
    assert any(n["type"] == "doc_mention" and n["data"].get("document_id") == doc_id for n in items)
    # Clean preview — no raw HTML entities
    match = next(n for n in items if n["type"] == "doc_mention")
    assert "&nbsp;" not in (match.get("body") or "")
    assert "<span" not in (match.get("body") or "")

    # Deduped: second call + save path should not spam another row.
    client.post(
        f"/api/v1/documents/{doc_id}/body-mentions",
        headers=headers,
        json={"user_id": str(member.id), "preview_html": chip},
    )
    client.patch(f"/api/v1/documents/{doc_id}", headers=headers, json={"content": chip})
    inbox2 = client.get("/api/v1/notifications?tab=primary&view=inbox&filter=mentions", headers=member_headers)
    doc_mentions = [n for n in inbox2.json()["items"] if n["type"] == "doc_mention" and n["data"].get("document_id") == doc_id]
    assert len(doc_mentions) == 1


@pytest.mark.integration
def test_doc_body_all_mention_notifies_accessible_members(client, db, org, owner):
    """@All notifies other workspace members (same audience as the People picker)."""
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "All Mentions", "content": "<p>Hi</p>", "is_private": True},
    )
    assert create.status_code == 201
    doc_id = create.json()["id"]

    teammate = make_user(db, "mention-doc-all-shared@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=teammate.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=teammate.id, role="member"))

    # Org admin with implicit workspace access (no WorkspaceMember row) — still in picker.
    org_admin = make_user(db, "mention-doc-all-org-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.commit()

    chip = (
        '<p>Heads up <span class="doc-mention doc-mention-people" data-mention-type="people" '
        'data-mention-id="all" contenteditable="false">@All</span></p>'
    )
    resp = client.post(
        f"/api/v1/documents/{doc_id}/body-mentions",
        headers=headers,
        json={"user_id": "all", "preview_html": chip},
    )
    assert resp.status_code == 200, resp.text
    assert "sent" in resp.json()["detail"].lower()

    for email in (teammate.email, org_admin.email):
        inbox = client.get(
            "/api/v1/notifications?tab=primary&view=inbox&filter=mentions",
            headers=auth_headers(client, email),
        )
        assert inbox.status_code == 200
        items = inbox.json()["items"]
        match = next(
            (n for n in items if n["type"] == "doc_mention" and n["data"].get("document_id") == doc_id),
            None,
        )
        assert match is not None, email
        assert "mentioned you" in (match.get("title") or "")
        # Preview is the doc snippet once — not "@All … @All" from a synthetic prefix.
        body = match.get("body") or ""
        assert body.count("@All") <= 1
        assert "@[All](all)" not in body

    # Author must not notify themselves.
    owner_inbox = client.get(
        "/api/v1/notifications?tab=primary&view=inbox&filter=mentions",
        headers=headers,
    )
    assert not any(
        n["type"] == "doc_mention"
        and n["data"].get("document_id") == doc_id
        and "mentioned you" in (n.get("title") or "")
        for n in owner_inbox.json()["items"]
    )


@pytest.mark.integration
def test_wiki_protect_scope_and_templates(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    # Create a Wiki doc.
    wiki = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Team Wiki", "is_wiki": True, "content": "<p>Knowledge</p>"},
    )
    assert wiki.status_code == 201, wiki.text
    assert wiki.json()["is_wiki"] is True
    wiki_id = wiki.json()["id"]

    # A plain doc, plus a doc shared with a member.
    doc = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Owner Doc", "content": "<p>Mine</p>"},
    )
    doc_id = doc.json()["id"]

    member = make_user(db, "scope-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()
    client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "editor"},
    )

    # Scope: wiki filter.
    wikis = client.get(f"/api/v1/workspaces/{workspace.id}/documents?is_wiki=true", headers=headers)
    assert wikis.status_code == 200
    assert {d["id"] for d in wikis.json()} == {wiki_id}

    # Scope: shared with me (as the member).
    member_headers = auth_headers(client, member.email)
    shared = client.get(f"/api/v1/workspaces/{workspace.id}/documents?scope=shared", headers=member_headers)
    assert shared.status_code == 200
    assert any(d["id"] == doc_id for d in shared.json())

    # Workspace-wide share also appears in Shared with me for other members.
    workspace_doc = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Workspace Shared", "content": "<p>All</p>"},
    )
    workspace_doc_id = workspace_doc.json()["id"]
    client.patch(
        f"/api/v1/documents/{workspace_doc_id}/share",
        headers=headers,
        json={"is_private": False},
    )
    shared_workspace = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?scope=shared",
        headers=member_headers,
    )
    assert any(d["id"] == workspace_doc_id for d in shared_workspace.json())

    # Scope: mine (as the owner).
    mine = client.get(f"/api/v1/workspaces/{workspace.id}/documents?scope=mine", headers=headers)
    assert {d["id"] for d in mine.json()} >= {doc_id, wiki_id}

    # Protect the doc: the shared editor can no longer edit content.
    protect = client.patch(f"/api/v1/documents/{doc_id}", headers=headers, json={"is_protected": True})
    assert protect.status_code == 200
    assert protect.json()["is_protected"] is True

    blocked = client.patch(f"/api/v1/documents/{doc_id}", headers=member_headers, json={"content": "<p>hack</p>"})
    assert blocked.status_code == 403

    # Owner can still edit while protected.
    owner_edit = client.patch(f"/api/v1/documents/{doc_id}", headers=headers, json={"content": "<p>updated</p>"})
    assert owner_edit.status_code == 200

    # Save-as-template from the doc, then apply it into a new document.
    tpl = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-templates",
        headers=headers,
        json={"name": "My Template", "document_id": doc_id},
    )
    assert tpl.status_code == 201, tpl.text
    tpl_id = tpl.json()["id"]
    assert tpl.json()["content"] == "<p>updated</p>"

    templates = client.get(f"/api/v1/workspaces/{workspace.id}/doc-templates", headers=headers)
    assert any(t["id"] == tpl_id for t in templates.json())

    applied = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-templates/{tpl_id}/apply",
        headers=headers,
    )
    assert applied.status_code == 201, applied.text
    assert applied.json()["content"] == "<p>updated</p>"
    assert applied.json()["title"] == "My Template"

    deleted = client.delete(f"/api/v1/doc-templates/{tpl_id}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.integration
def test_doc_list_filters_and_sort(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    wiki = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Knowledge Base", "is_wiki": True, "content": "<p>Wiki</p>", "tags": ["guide"]},
    )
    assert wiki.status_code == 201
    wiki_id = wiki.json()["id"]

    plain = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Meeting Notes", "content": "<p>Notes</p>", "tags": ["team"]},
    )
    assert plain.status_code == 201
    plain_id = plain.json()["id"]

    client.post(f"/api/v1/documents/{plain_id}/open", headers=headers)

    rules = json.dumps([{"field": "wiki", "operator": "is", "value": "true"}])
    filtered = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={rules}",
        headers=headers,
    )
    assert filtered.status_code == 200
    assert {d["id"] for d in filtered.json()} == {wiki_id}

    title_rules = json.dumps([{"field": "title", "operator": "contains", "value": "Meeting"}])
    by_title = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={title_rules}",
        headers=headers,
    )
    assert by_title.status_code == 200
    assert any(d["id"] == plain_id for d in by_title.json())

    by_tag = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?tags=guide",
        headers=headers,
    )
    assert by_tag.status_code == 200
    assert all("guide" in (d.get("tags") or []) for d in by_tag.json())

    sorted_viewed = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?sort_by=viewed_at&sort_dir=desc",
        headers=headers,
    )
    assert sorted_viewed.status_code == 200
    rows = sorted_viewed.json()
    assert rows[0]["id"] == plain_id
    assert rows[0]["last_viewed_at"] is not None
    assert rows[0]["is_shared"] is False
