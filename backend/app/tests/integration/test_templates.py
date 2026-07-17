"""Integration — Template Center: save / apply / apply-payload / update / delete,
plus snapshot+rebuild fidelity and permission/visibility gates."""
import pytest

from app.models.custom_field import CustomFieldDefinition
from app.models.project import Project, Space, TaskList
from app.models.task import CustomStatus, Task
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack

API = "/api/v1"


def _seed_structure(db, project, owner):
    """Give the source project statuses, a custom field, two lists, and a task + subtask."""
    s_todo = CustomStatus(project_id=project.id, name="To Do", color="#87909E", category="todo", position=0)
    s_prog = CustomStatus(project_id=project.id, name="In Progress", color="#5B9FF0", category="in_progress", position=1)
    s_done = CustomStatus(project_id=project.id, name="Done", color="#4CB782", category="done", position=2)
    db.add_all([s_todo, s_prog, s_done])
    db.add(CustomFieldDefinition(project_id=project.id, name="Priority", field_type="select",
                                 options=["High", "Low"], position=0, created_by=owner.id))
    list_a = TaskList(project_id=project.id, name="List A", position=0, created_by=owner.id)
    list_b = TaskList(project_id=project.id, name="List B", position=1, created_by=owner.id)
    db.add_all([list_a, list_b])
    db.flush()
    parent = Task(project_id=project.id, number=1, title="Parent task", status_id=s_todo.id,
                  list_id=list_a.id, position=0, created_by=owner.id)
    db.add(parent)
    db.flush()
    child = Task(project_id=project.id, number=2, title="Child task", status_id=s_prog.id,
                 list_id=list_b.id, parent_task_id=parent.id, position=1, created_by=owner.id)
    db.add(child)
    project.next_task_number = 3
    db.flush()


def _save_project_template(client, db, org, owner, *, visibility="workspace", name="My Project Template"):
    workspace, project = build_project_stack(db, org, owner)
    _seed_structure(db, project, owner)
    headers = auth_headers(client, owner.email)
    resp = client.post(f"{API}/templates/save", headers=headers, json={
        "kind": "project", "source_id": str(project.id), "name": name, "visibility": visibility,
        "tags": ["eng"], "include_tasks": True,
    })
    return workspace, project, headers, resp


@pytest.mark.integration
def test_save_project_template_captures_structure(client, db, org, owner):
    workspace, project, headers, resp = _save_project_template(client, db, org, owner)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["kind"] == "project"
    inc = body["includes"]
    assert inc["statuses"] == 3
    assert inc["custom_fields"] == 1
    assert inc["lists"] == 2
    assert inc["tasks"] == 2

    # list + get
    listed = client.get(f"{API}/workspaces/{workspace.id}/templates", headers=headers)
    assert listed.status_code == 200
    assert any(t["id"] == body["id"] for t in listed.json())
    got = client.get(f"{API}/templates/{body['id']}", headers=headers)
    assert got.status_code == 200
    assert got.json()["name"] == "My Project Template"

    # filter by kind
    proj_only = client.get(f"{API}/workspaces/{workspace.id}/templates?kind=project", headers=headers)
    assert proj_only.status_code == 200 and len(proj_only.json()) >= 1


@pytest.mark.integration
def test_apply_project_template_rebuilds_everything(client, db, org, owner):
    workspace, project, headers, resp = _save_project_template(client, db, org, owner)
    template_id = resp.json()["id"]
    target_space = Space(workspace_id=workspace.id, name="Target Space", created_by=owner.id)
    db.add(target_space)
    db.flush()

    applied = client.post(f"{API}/templates/{template_id}/apply", headers=headers, json={
        "name": "Rebuilt Project", "target_space_id": str(target_space.id),
    })
    assert applied.status_code == 201, applied.text
    result = applied.json()
    assert result["kind"] == "project" and result["name"] == "Rebuilt Project"
    new_id = result["project_id"]

    new_proj = db.get(Project, new_id)
    assert new_proj.space_id == target_space.id
    assert db.query(CustomStatus).filter(CustomStatus.project_id == new_proj.id).count() == 3
    assert db.query(TaskList).filter(TaskList.project_id == new_proj.id).count() == 2
    assert db.query(CustomFieldDefinition).filter(CustomFieldDefinition.project_id == new_proj.id).count() == 1
    tasks = db.query(Task).filter(Task.project_id == new_proj.id).all()
    assert len(tasks) == 2
    # subtask parent linkage survived the rebuild
    child = next(t for t in tasks if t.title == "Child task")
    parent = next(t for t in tasks if t.title == "Parent task")
    assert child.parent_task_id == parent.id

    # usage_count incremented
    assert client.get(f"{API}/templates/{template_id}", headers=headers).json()["usage_count"] == 1


@pytest.mark.integration
def test_apply_project_template_requires_target_space(client, db, org, owner):
    _workspace, _project, headers, resp = _save_project_template(client, db, org, owner)
    template_id = resp.json()["id"]
    bad = client.post(f"{API}/templates/{template_id}/apply", headers=headers, json={"name": "x"})
    assert bad.status_code == 400


@pytest.mark.integration
def test_space_template_save_and_apply(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    _seed_structure(db, project, owner)
    headers = auth_headers(client, owner.email)

    saved = client.post(f"{API}/templates/save", headers=headers, json={
        "kind": "space", "source_id": str(project.space_id), "name": "Space Template",
    })
    assert saved.status_code == 201, saved.text
    assert saved.json()["includes"]["projects"] == 1
    template_id = saved.json()["id"]

    applied = client.post(f"{API}/templates/{template_id}/apply", headers=headers, json={"name": "New Space"})
    assert applied.status_code == 201, applied.text
    assert applied.json()["kind"] == "space"
    new_space_id = applied.json()["space_id"]
    # the space template recreated its child project
    assert db.query(Project).filter(Project.space_id == new_space_id).count() == 1


@pytest.mark.integration
def test_apply_payload_starter(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    payload = {
        "name": "Bug Tracking", "description": "d", "color": "#F0506E", "icon": None,
        "statuses": [{"name": "Open", "color": "#87909E", "category": "todo", "position": 0},
                     {"name": "Closed", "color": "#4CB782", "category": "done", "position": 1}],
        "custom_fields": [{"name": "Severity", "field_type": "select", "options": ["Hi"], "position": 0}],
        "lists": [{"name": "Bugs", "position": 0}],
        "tasks": [{"title": "Example bug", "status_name": "Open", "list_name": "Bugs", "priority": "high", "position": 0}],
    }
    resp = client.post(f"{API}/templates/apply-payload", headers=headers, json={
        "kind": "project", "name": "Bugs From Starter", "payload": payload,
        "target_space_id": str(project.space_id),
    })
    assert resp.status_code == 201, resp.text
    new_id = resp.json()["project_id"]
    assert db.query(CustomStatus).filter(CustomStatus.project_id == new_id).count() == 2
    assert db.query(Task).filter(Task.project_id == new_id).count() == 1


@pytest.mark.integration
def test_apply_payload_rejects_oversized(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    payload = {"name": "Big", "statuses": [], "custom_fields": [], "lists": [],
               "tasks": [{"title": f"t{i}", "position": i} for i in range(501)]}
    resp = client.post(f"{API}/templates/apply-payload", headers=headers, json={
        "kind": "project", "name": "Big", "payload": payload, "target_space_id": str(project.space_id),
    })
    assert resp.status_code == 400


@pytest.mark.integration
def test_update_template_metadata_and_resync(client, db, org, owner):
    workspace, project, headers, resp = _save_project_template(client, db, org, owner)
    template_id = resp.json()["id"]

    # metadata-only update
    upd = client.put(f"{API}/templates/{template_id}", headers=headers, json={
        "name": "Renamed Template", "visibility": "private", "tags": ["x", "y"],
    })
    assert upd.status_code == 200, upd.text
    assert upd.json()["name"] == "Renamed Template"
    assert upd.json()["visibility"] == "private"

    # resync from a richer source -> includes change
    _, project2 = build_project_stack(db, org, owner)
    db.add(CustomStatus(project_id=project2.id, name="Only", color="#000", category="todo", position=0))
    db.flush()
    resync = client.put(f"{API}/templates/{template_id}", headers=headers, json={
        "resync_from_source_id": str(project2.id),
    })
    assert resync.status_code == 200, resync.text
    assert resync.json()["includes"]["statuses"] == 1


@pytest.mark.integration
def test_delete_template(client, db, org, owner):
    _workspace, _project, headers, resp = _save_project_template(client, db, org, owner)
    template_id = resp.json()["id"]
    deleted = client.delete(f"{API}/templates/{template_id}", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"{API}/templates/{template_id}", headers=headers).status_code == 404


@pytest.mark.integration
def test_get_missing_template_404(client, db, org, owner):
    build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    import uuid
    assert client.get(f"{API}/templates/{uuid.uuid4()}", headers=headers).status_code == 404


@pytest.mark.integration
def test_private_template_hidden_from_others(client, db, org, owner):
    workspace, _project, headers, resp = _save_project_template(client, db, org, owner, visibility="private")
    template_id = resp.json()["id"]

    # a plain org member (not admin, not creator) cannot view or manage it
    from app.models.organization import OrganizationMember
    from app.models.workspace import WorkspaceMember
    other = make_user(db, "member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=other.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=other.id, role="member"))
    db.flush()
    other_headers = auth_headers(client, other.email)

    assert client.get(f"{API}/templates/{template_id}", headers=other_headers).status_code == 403
    assert client.delete(f"{API}/templates/{template_id}", headers=other_headers).status_code == 403
    # private template excluded from the member's list
    listed = client.get(f"{API}/workspaces/{workspace.id}/templates", headers=other_headers)
    assert listed.status_code == 200
    assert all(t["id"] != template_id for t in listed.json())


@pytest.mark.integration
def test_non_admin_cannot_save_template(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    from app.models.organization import OrganizationMember
    from app.models.project import ProjectMember
    from app.models.workspace import WorkspaceMember
    member = make_user(db, "viewer@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, member.email)
    resp = client.post(f"{API}/templates/save", headers=headers, json={
        "kind": "project", "source_id": str(project.id), "name": "Nope",
    })
    assert resp.status_code == 403
