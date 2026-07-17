"""Phase 4 security — deeply nested / oversized JSON rejected at API validation."""
import pytest

from app.tests.conftest import auth_headers
from app.tests.helpers import add_task, build_project_stack


def _deep_object(depth: int) -> dict:
    node: dict = {"v": 1}
    current = node
    for _ in range(depth - 1):
        nested: dict = {}
        current["nested"] = nested
        current = nested
    return node


@pytest.mark.security
def test_org_settings_rejects_excessive_nesting(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    response = client.patch(
        f"/api/v1/organizations/{org.id}",
        headers=headers,
        json={"settings": _deep_object(7)},
    )
    assert response.status_code == 422


@pytest.mark.security
def test_custom_field_value_rejects_excessive_nesting(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = add_task(db, project, owner)
    headers = auth_headers(client, owner.email)

    field = client.post(
        f"/api/v1/projects/{project.id}/custom-fields",
        headers=headers,
        json={"name": "Notes", "field_type": "text"},
    )
    assert field.status_code == 201
    field_id = field.json()["id"]

    response = client.put(
        f"/api/v1/tasks/{task.id}/custom-fields/{field_id}",
        headers=headers,
        json={"value": _deep_object(7)},
    )
    assert response.status_code == 422
