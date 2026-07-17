"""Coverage — form schema validators and forms API edge paths."""
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.form import Form, FormSubmission
from app.schemas.form import FormUpdate, _validate_fields
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.coverage
def test_validate_fields_rejects_empty_and_too_many():
    with pytest.raises(ValueError, match="at least one field"):
        _validate_fields([])
    with pytest.raises(ValueError, match="at most"):
        _validate_fields([{"id": f"f{i}", "type": "text", "label": f"L{i}"} for i in range(26)])


@pytest.mark.coverage
def test_validate_fields_rejects_bad_shape_and_duplicates():
    with pytest.raises(ValueError, match="must be an object"):
        _validate_fields(["not-a-dict"])
    with pytest.raises(ValueError, match="unique id"):
        _validate_fields([
            {"id": "dup", "type": "text", "label": "A"},
            {"id": "dup", "type": "text", "label": "B"},
        ])
    with pytest.raises(ValueError, match="Unknown field type"):
        _validate_fields([{"id": "x", "type": "nope", "label": "X"}])
    with pytest.raises(ValueError, match="needs a label"):
        _validate_fields([{"id": "x", "type": "text", "label": ""}])


@pytest.mark.coverage
def test_validate_fields_select_and_first_field_rules():
    with pytest.raises(ValueError, match="options list"):
        _validate_fields([{"id": "s", "type": "select", "label": "Pick"}])
    with pytest.raises(ValueError, match="options list"):
        _validate_fields([{"id": "c", "type": "checklist", "label": "Todos"}])
    with pytest.raises(ValueError, match="non-empty option"):
        _validate_fields([
            {"id": "title", "type": "text", "label": "Task name"},
            {"id": "s", "type": "select", "label": "Pick", "options": ["  ", ""]},
        ])
    with pytest.raises(ValueError, match="first field must be a text field"):
        _validate_fields([{"id": "n", "type": "textarea", "label": "Num"}])

    valid = _validate_fields([
        {"id": "title", "type": "text", "label": "Task name"},
        {"id": "pick", "type": "select", "label": "Choice", "options": ["a", "b"]},
        {"id": "todos", "type": "checklist", "label": "Todos", "options": ["One", "Two", "Three"]},
    ])
    assert len(valid) == 3


@pytest.mark.coverage
def test_form_update_validator_via_schema():
    with pytest.raises(ValidationError):
        FormUpdate(fields=[{"id": "bad", "type": "text", "label": ""}])


@pytest.mark.coverage
def test_form_crud_update_delete_and_member_list(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "form-viewer@test.dev")
    headers = auth_headers(client, owner.email)

    created = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Support", "project_id": str(project.id)},
    )
    assert created.status_code == 201
    form_id = created.json()["id"]

    updated = client.patch(
        f"/api/v1/forms/{form_id}",
        headers=headers,
        json={
            "name": "Support v2",
            "is_active": False,
            "fields": [
                {"id": "title", "type": "text", "label": "Subject"},
                {"id": "details", "type": "textarea", "label": "Details"},
            ],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Support v2"
    assert updated.json()["is_active"] is False

    member_list = client.get(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=auth_headers(client, member.email),
    )
    assert member_list.status_code == 200
    assert any(f["id"] == form_id for f in member_list.json())

    deleted = client.delete(f"/api/v1/forms/{form_id}", headers=headers)
    assert deleted.status_code == 200


@pytest.mark.coverage
def test_form_create_rejects_project_in_other_workspace(client, db, org, owner):
    workspace_a, project_a = build_project_stack(db, org, owner, project_key="FMA")
    workspace_b, _ = build_project_stack(db, org, owner, project_key="FMB", project_name="Other")
    headers = auth_headers(client, owner.email)

    response = client.post(
        f"/api/v1/workspaces/{workspace_b.id}/forms",
        headers=headers,
        json={"name": "Cross", "project_id": str(project_a.id)},
    )
    assert response.status_code == 400


@pytest.mark.coverage
def test_public_form_submission_validation_errors(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    form_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Validated", "project_id": str(project.id)},
    ).json()["id"]
    form = db.get(Form, form_id)
    form.fields = [
        {"id": "title", "type": "text", "label": "Title", "required": True},
        {"id": "email", "type": "email", "label": "Email"},
        {"id": "when", "type": "date", "label": "When"},
        {"id": "choice", "type": "select", "label": "Pick", "options": ["a"]},
        {
            "id": "todos",
            "type": "checklist",
            "label": "Todos",
            "options": ["Ship", "Review"],
            "required": True,
        },
    ]
    db.flush()

    missing = client.post(
        f"/api/v1/public/forms/{form.public_token}",
        json={"values": {}},
    )
    assert missing.status_code == 422

    bad_email = client.post(
        f"/api/v1/public/forms/{form.public_token}",
        json={"values": {"title": "Hi", "email": "not-email"}, "submitter_email": "also-bad"},
    )
    assert bad_email.status_code == 422

    bad_checklist = client.post(
        f"/api/v1/public/forms/{form.public_token}",
        json={"values": {"title": "Hi", "todos": "Nope"}},
    )
    assert bad_checklist.status_code == 422

    ok = client.post(
        f"/api/v1/public/forms/{form.public_token}",
        json={"values": {"title": "Hi", "todos": "Ship\nReview"}},
    )
    assert ok.status_code == 201
    sub = db.scalars(select(FormSubmission).where(FormSubmission.form_id == form.id)).first()
    assert sub is not None
    assert sub.data["todos"] == "Ship, Review"


@pytest.mark.coverage
def test_public_form_paused_returns_404(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)
    form_id = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Paused", "project_id": str(project.id)},
    ).json()["id"]
    client.patch(f"/api/v1/forms/{form_id}", headers=headers, json={"is_active": False})
    form = db.get(Form, form_id)

    response = client.post(
        f"/api/v1/public/forms/{form.public_token}",
        json={"values": {"title": "Should fail"}},
    )
    assert response.status_code == 404
