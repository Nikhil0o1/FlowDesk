"""Extended Docs integration coverage — links, archive, import, comments, versions."""
import json
import uuid

import pytest

from app.models.organization import OrganizationMember
from app.models.workspace import WorkspaceMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_task, build_project_stack

pytestmark = pytest.mark.integration


def test_doc_links_task_and_document(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="DocsLink")
    headers = auth_headers(client, owner.email)
    task = add_task(db, project, owner, title="Linked task", number=1)

    doc_a = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Source", "content": "<p>A</p>"},
    )
    assert doc_a.status_code == 201
    doc_a_id = doc_a.json()["id"]

    doc_b = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Target", "content": "<p>B</p>"},
    )
    doc_b_id = doc_b.json()["id"]

    link_task = client.post(
        f"/api/v1/documents/{doc_a_id}/links",
        headers=headers,
        json={"target_type": "task", "target_id": str(task.id)},
    )
    assert link_task.status_code == 201, link_task.text
    assert link_task.json()["target_type"] == "task"
    assert link_task.json()["title"] == "Linked task"

    link_doc = client.post(
        f"/api/v1/documents/{doc_a_id}/links",
        headers=headers,
        json={"target_type": "document", "target_id": doc_b_id},
    )
    assert link_doc.status_code == 201, link_doc.text

    dup = client.post(
        f"/api/v1/documents/{doc_a_id}/links",
        headers=headers,
        json={"target_type": "document", "target_id": doc_b_id},
    )
    assert dup.status_code == 201

    listed = client.get(f"/api/v1/documents/{doc_a_id}/links", headers=headers)
    assert listed.status_code == 200
    links = listed.json()["links"]
    assert len([l for l in links if l["target_type"] == "task"]) == 1
    assert len([l for l in links if l["target_type"] == "document"]) == 1

    link_id = next(l["id"] for l in links if l["target_type"] == "task")
    removed = client.delete(f"/api/v1/documents/{doc_a_id}/links/{link_id}", headers=headers)
    assert removed.status_code == 200


def test_doc_archive_import_nested_folders(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    parent = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-folders",
        headers=headers,
        json={"name": "Parent"},
    )
    assert parent.status_code == 201
    parent_id = parent.json()["id"]

    child = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-folders",
        headers=headers,
        json={"name": "Child", "parent_id": parent_id},
    )
    assert child.status_code == 201
    child_id = child.json()["id"]

    renamed = client.patch(
        f"/api/v1/doc-folders/{child_id}",
        headers=headers,
        json={"name": "Child Renamed", "parent_id": parent_id},
    )
    assert renamed.status_code == 200

    moved = client.patch(
        f"/api/v1/doc-folders/{child_id}",
        headers=headers,
        json={"parent_id": None},
    )
    assert moved.status_code == 200

    imported = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents/import",
        headers=headers,
        json={
            "title": "Imported",
            "content": "# Hello",
            "format": "markdown",
            "folder_id": child_id,
        },
    )
    assert imported.status_code == 201, imported.text
    doc_id = imported.json()["id"]

    archived = client.post(f"/api/v1/documents/{doc_id}/archive", headers=headers)
    assert archived.status_code == 200
    assert archived.json()["archived_at"]

    blocked = client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={"content": "<p>nope</p>"},
    )
    assert blocked.status_code == 400

    unarchived = client.post(f"/api/v1/documents/{doc_id}/unarchive", headers=headers)
    assert unarchived.status_code == 200
    assert unarchived.json()["archived_at"] is None

    archived_list = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?archived=true",
        headers=headers,
    )
    assert archived_list.status_code == 200
    assert not any(d["id"] == doc_id for d in archived_list.json())


def test_doc_comments_versions_activity(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Collab", "content": "<p>v1</p>"},
    )
    doc_id = create.json()["id"]

    comment = client.post(
        f"/api/v1/documents/{doc_id}/comments",
        headers=headers,
        json={"body": "Please review"},
    )
    assert comment.status_code == 201
    comment_id = comment.json()["id"]

    reply = client.post(
        f"/api/v1/documents/{doc_id}/comments",
        headers=headers,
        json={"body": "On it", "parent_id": comment_id},
    )
    assert reply.status_code == 201

    resolved = client.patch(
        f"/api/v1/document-comments/{comment_id}",
        headers=headers,
        json={"resolved": True},
    )
    assert resolved.status_code == 200
    assert resolved.json()["resolved"] is True

    listed = client.get(f"/api/v1/documents/{doc_id}/comments", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) >= 2

    version = client.post(
        f"/api/v1/documents/{doc_id}/versions",
        headers=headers,
        json={"title": "Collab", "content": "<p>snapshot</p>", "summary": "Manual save"},
    )
    assert version.status_code == 201
    version_id = version.json()["id"]

    client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={"content": "<p>v2</p>"},
    )
    restored = client.post(
        f"/api/v1/documents/{doc_id}/versions/{version_id}/restore",
        headers=headers,
    )
    assert restored.status_code == 200
    assert restored.json()["content"] == "<p>snapshot</p>"

    activity = client.get(f"/api/v1/documents/{doc_id}/activity", headers=headers)
    assert activity.status_code == 200
    types = {e["type"] for e in activity.json()}
    assert "comment_added" in types
    assert "version_restored" in types

    deleted = client.delete(f"/api/v1/document-comments/{comment_id}", headers=headers)
    assert deleted.status_code == 200


def test_doc_share_members_and_private_scope(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Private Doc", "content": "<p>x</p>", "is_private": True},
    )
    doc_id = create.json()["id"]

    member = make_user(db, "share-upd@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.commit()

    added = client.post(
        f"/api/v1/documents/{doc_id}/share/members",
        headers=headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert added.status_code == 201
    assert "members" in added.json()

    share_get = client.get(f"/api/v1/documents/{doc_id}/share", headers=headers)
    assert share_get.status_code == 200
    assert any(m["target_id"] == str(member.id) for m in share_get.json()["members"])
    member_row_id = next(m["id"] for m in share_get.json()["members"] if m["target_id"] == str(member.id))

    updated = client.patch(
        f"/api/v1/documents/{doc_id}/share/members/{member_row_id}",
        headers=headers,
        json={"role": "commenter"},
    )
    assert updated.status_code == 200
    assert updated.json()["role"] == "commenter"

    private_list = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?scope=private",
        headers=headers,
    )
    assert private_list.status_code == 200
    assert any(d["id"] == doc_id for d in private_list.json())

    removed = client.delete(
        f"/api/v1/documents/{doc_id}/share/members/{member_row_id}",
        headers=headers,
    )
    assert removed.status_code == 200


def test_doc_favorites_template_search_permanent_delete(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-folders",
        headers=headers,
        json={"name": "Fav Folder"},
    )
    folder_id = folder.json()["id"]

    fav_folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-favorites",
        headers=headers,
        json={"target_id": folder_id, "target_type": "folder"},
    )
    assert fav_folder.status_code == 201

    favs = client.get(f"/api/v1/workspaces/{workspace.id}/doc-favorites", headers=headers)
    assert any(f["target_id"] == folder_id for f in favs.json())

    tpl = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-templates",
        headers=headers,
        json={"name": "Sprint Notes", "content": "<p>T</p>"},
    )
    tpl_id = tpl.json()["id"]

    patched = client.patch(
        f"/api/v1/doc-templates/{tpl_id}",
        headers=headers,
        json={"description": "Updated desc"},
    )
    assert patched.status_code == 200

    doc = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Searchable Alpha", "content": "<p>findme</p>"},
    )
    doc_id = doc.json()["id"]

    active = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Still Active", "content": "<p>no</p>"},
    )
    active_id = active.json()["id"]

    search = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?q=Alpha",
        headers=headers,
    )
    assert search.status_code == 200
    assert any(d["id"] == doc_id for d in search.json())

    rules = json.dumps([{"field": "title", "operator": "contains", "value": "Alpha"}])
    filtered = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={rules}",
        headers=headers,
    )
    assert any(d["id"] == doc_id for d in filtered.json())

    blocked = client.delete(f"/api/v1/documents/{active_id}", headers=headers)
    assert blocked.status_code == 400

    trashed = client.post(f"/api/v1/documents/{doc_id}/trash", headers=headers)
    assert trashed.status_code == 200

    deleted = client.delete(f"/api/v1/documents/{doc_id}", headers=headers)
    assert deleted.status_code == 200

    unfav = client.delete(
        f"/api/v1/workspaces/{workspace.id}/doc-favorites/{folder_id}",
        headers=headers,
    )
    assert unfav.status_code == 200


def test_apply_filter_rules_tag_contains(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Tagged", "content": "<p>x</p>", "tags": ["alpha-beta"]},
    )
    doc_id = create.json()["id"]
    rules = json.dumps([{"field": "tag", "operator": "contains", "value": "beta"}])
    res = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={rules}",
        headers=headers,
    )
    assert doc_id in [d["id"] for d in res.json()]


def test_import_text_document(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    imported = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents/import",
        headers=headers,
        json={"title": "Plain import", "content": "Hello plain", "format": "text"},
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["title"] == "Plain import"


def test_filter_title_equals_and_sharing_public(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Exact Title", "content": "<p>x</p>"},
    )
    doc_id = create.json()["id"]

    equals = json.dumps([{"field": "title", "operator": "equals", "value": "Exact Title"}])
    res = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={equals}",
        headers=headers,
    )
    assert doc_id in [d["id"] for d in res.json()]

    client.patch(
        f"/api/v1/documents/{doc_id}/share",
        headers=headers,
        json={"public_enabled": True},
    )
    public_rules = json.dumps([{"field": "sharing", "operator": "is", "value": "public"}])
    public_res = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={public_rules}",
        headers=headers,
    )
    assert doc_id in [d["id"] for d in public_res.json()]


def test_filter_tag_and_owner_is_not(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Negation", "content": "<p>x</p>", "tags": ["keep"]},
    )
    doc_id = create.json()["id"]
    tag_rules = json.dumps([{"field": "tag", "operator": "is_not", "value": "missing"}])
    owner_rules = json.dumps([{"field": "owner", "operator": "is_not", "value": str(uuid.uuid4())}])
    assert doc_id in [d["id"] for d in client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={tag_rules}",
        headers=headers,
    ).json()]
    assert doc_id in [d["id"] for d in client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={owner_rules}",
        headers=headers,
    ).json()]


def test_list_trashed_mine_and_invalid_filter_rules(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={"title": "Trash list", "content": "<p>x</p>"},
    )
    doc_id = create.json()["id"]

    trashed = client.post(f"/api/v1/documents/{doc_id}/trash", headers=headers)
    assert trashed.status_code == 200

    listed = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?deleted=true",
        headers=headers,
    )
    assert listed.status_code == 200
    assert doc_id in [d["id"] for d in listed.json()]

    mine = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?scope=mine",
        headers=headers,
    )
    assert mine.status_code == 200

    bad_rules = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?filter_rules=not-json",
        headers=headers,
    )
    assert bad_rules.status_code == 400


def test_doc_advanced_filter_rules_and_share_update(client, db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    folder = client.post(
        f"/api/v1/workspaces/{workspace.id}/doc-folders",
        headers=headers,
        json={"name": "Specs"},
    )
    folder_id = folder.json()["id"]

    doc = client.post(
        f"/api/v1/workspaces/{workspace.id}/documents",
        headers=headers,
        json={
            "title": "Filter Me",
            "content": "<p>Body</p>",
            "folder_id": folder_id,
            "tags": ["spec"],
        },
    )
    doc_id = doc.json()["id"]
    client.patch(
        f"/api/v1/documents/{doc_id}",
        headers=headers,
        json={"content": "<p>Updated by owner</p>"},
    )

    def filtered(rules: list[dict]) -> list[str]:
        payload = json.dumps(rules)
        res = client.get(
            f"/api/v1/workspaces/{workspace.id}/documents?filter_rules={payload}",
            headers=headers,
        )
        assert res.status_code == 200
        return [d["id"] for d in res.json()]

    assert doc_id in filtered([{"field": "location", "operator": "is", "value": folder_id}])
    assert doc_id in filtered([{"field": "tag", "operator": "is", "value": "spec"}])
    assert doc_id in filtered([{"field": "owner", "operator": "is", "value": str(owner.id)}])
    assert doc_id in filtered([{"field": "contributors", "operator": "is", "value": str(owner.id)}])
    assert doc_id in filtered([{"field": "sharing", "operator": "is", "value": "private"}])
    assert doc_id in filtered([{"field": "wiki", "operator": "is", "value": "false"}])
    assert doc_id in filtered([{"field": "wiki", "operator": "is_not", "value": "true"}])
    assert doc_id in filtered([{"field": "sharing", "operator": "is_not", "value": "public"}])
    assert doc_id in filtered([{"field": "title", "operator": "contains", "value": "Filter"}])
    assert doc_id not in filtered([{"field": "title", "operator": "not_equals", "value": "Filter Me"}])
    assert doc_id in filtered([{"field": "dateUpdated", "operator": "after", "value": "2020-01-01"}])

    share = client.patch(
        f"/api/v1/documents/{doc_id}/share",
        headers=headers,
        json={"is_private": False, "public_enabled": False},
    )
    assert share.status_code == 200
    assert share.json()["is_private"] is False

    sorted_docs = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?sort_by=created_at&sort_dir=asc",
        headers=headers,
    )
    assert sorted_docs.status_code == 200
    assert sorted_docs.json()[0]["id"] == doc_id

    asc_updated = client.get(
        f"/api/v1/workspaces/{workspace.id}/documents?sort_by=updated_at&sort_dir=asc",
        headers=headers,
    )
    assert asc_updated.status_code == 200
    assert doc_id in [d["id"] for d in asc_updated.json()]

    assert doc_id in filtered([{"field": "location", "operator": "is_not", "value": "__root__"}])
