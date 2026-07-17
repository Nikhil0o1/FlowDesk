"""Phase 6 — task API extensions (custom fields, labels)."""
import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


@pytest.mark.coverage
def test_task_custom_field_lifecycle(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner, title="CF task", number=1)
    headers = auth_headers(client, owner.email)

    field = client.post(
        f"/api/v1/projects/{project.id}/custom-fields",
        headers=headers,
        json={"name": "Severity", "field_type": "select", "options": ["low", "high"]},
    )
    assert field.status_code == 201
    field_id = field.json()["id"]

    listed = client.get(f"/api/v1/projects/{project.id}/custom-fields", headers=headers)
    assert listed.status_code == 200
    assert any(f["id"] == field_id for f in listed.json())

    set_value = client.put(
        f"/api/v1/tasks/{task.id}/custom-fields/{field_id}",
        headers=headers,
        json={"value": {"v": "high"}},
    )
    assert set_value.status_code == 200

    detail = client.get(f"/api/v1/tasks/{task.id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["custom_fields"]

    deleted = client.delete(f"/api/v1/custom-fields/{field_id}", headers=headers)
    assert deleted.status_code == 200
    remaining = client.get(f"/api/v1/projects/{project.id}/custom-fields", headers=headers)
    assert all(f["id"] != field_id for f in remaining.json())


@pytest.mark.coverage
def test_task_labels_patch(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/projects/{project.id}/tasks",
        headers=headers,
        json={"title": "Label task", "priority": "normal", "task_type": "task", "labels": ["alpha"]},
    )
    assert create.status_code == 201
    task_id = create.json()["id"]

    patch = client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=headers,
        json={"labels": ["alpha", "beta"]},
    )
    assert patch.status_code == 200
    assert set(patch.json()["labels"]) == {"alpha", "beta"}
