"""Phase 3 integration — global search."""
import pytest

from app.models.comment import Comment
from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


@pytest.mark.integration
def test_search_finds_task_by_title(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    add_task(db, project, owner, title="UniqueSearchableWidget", number=70)
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/search", headers=headers, params={"q": "UniqueSearchable"})
    assert response.status_code == 200
    tasks = response.json().get("tasks") or []
    assert any("UniqueSearchableWidget" in (t.get("title") or "") for t in tasks)


@pytest.mark.integration
def test_search_finds_project_by_name(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner, project_name="UniqueProjectSearchable")
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/search", headers=headers, params={"q": "UniqueProjectSearch"})
    assert response.status_code == 200
    projects = response.json().get("projects") or []
    assert any(p.get("name") == "UniqueProjectSearchable" for p in projects)


@pytest.mark.integration
def test_search_excludes_private_tasks_for_non_members(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    from app.tests.helpers import add_project_member

    member = add_project_member(db, org, workspace, project, "search-member@test.dev")
    task = add_task(db, project, owner, title="SecretSearchTokenXYZ", number=71)
    task.is_private = True
    db.flush()

    headers = auth_headers(client, member.email)
    response = client.get("/api/v1/search", headers=headers, params={"q": "SecretSearchTokenXYZ"})
    assert response.status_code == 200
    tasks = response.json().get("tasks") or []
    assert not any(t.get("title") == "SecretSearchTokenXYZ" for t in tasks)


@pytest.mark.integration
def test_search_requires_auth(client):
    assert client.get("/api/v1/search", params={"q": "x"}).status_code == 401


@pytest.mark.integration
def test_search_finds_comment_excerpt_with_ellipsis(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="Comment host", number=72)
    padding = "x" * 50
    token = "NeedleCommentToken"
    db.add(Comment(task_id=task.id, author_id=owner.id, body=f"{padding} {token} trailing text"))
    db.flush()
    headers = auth_headers(client, owner.email)

    response = client.get("/api/v1/search", headers=headers, params={"q": token})
    assert response.status_code == 200
    comments = response.json().get("comments") or []
    assert any(token in (c.get("excerpt") or "") for c in comments)
    assert any(c.get("excerpt", "").startswith("…") for c in comments)


@pytest.mark.integration
def test_search_finds_org_member_by_email(client, db, org, owner):
    from app.tests.helpers import add_project_member

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "searchable.member@test.dev")
    headers = auth_headers(client, owner.email)

    response = client.get(
        "/api/v1/search",
        headers=headers,
        params={"q": "searchable.member"},
    )
    assert response.status_code == 200
    users = response.json().get("users") or []
    assert any(u.get("email") == member.email for u in users)


@pytest.mark.integration
def test_search_finds_shared_goal_for_member(client, db, org, owner):
    from app.tests.helpers import add_project_member

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "search-goal-share@test.dev")
    owner_headers = auth_headers(client, owner.email)
    member_headers = auth_headers(client, member.email)

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/goals",
        headers=owner_headers,
        json={
            "name": "UniqueSharedGoalSearchToken",
            "owner_id": str(owner.id),
            "is_private": True,
        },
    )
    assert created.status_code == 201, created.text
    goal_id = created.json()["id"]

    share = client.post(
        f"/api/v1/goals/{goal_id}/share/members",
        headers=owner_headers,
        json={"user_id": str(member.id), "role": "viewer"},
    )
    assert share.status_code == 201, share.text

    response = client.get(
        "/api/v1/search",
        headers=member_headers,
        params={"q": "UniqueSharedGoalSearchToken"},
    )
    assert response.status_code == 200
    goals = response.json().get("goals") or []
    assert any(g.get("id") == goal_id for g in goals)
