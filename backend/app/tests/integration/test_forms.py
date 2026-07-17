"""Phase 3 integration — forms (admin CRUD + public submission)."""
import pytest
from sqlalchemy import select

from app.models.form import Form, FormSubmission
from app.models.task import Task
from app.tests.conftest import auth_headers
from app.tests.helpers import add_project_member, build_project_stack


@pytest.mark.integration
def test_form_create_list_and_member_submit(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Bug Report", "project_id": str(project.id), "description": "Report bugs"},
    )
    assert create.status_code == 201, create.text
    form_id = create.json()["id"]
    assert create.json()["public_token"]

    listed = client.get(f"/api/v1/workspaces/{workspace.id}/forms", headers=headers)
    assert listed.status_code == 200
    assert any(f["id"] == form_id for f in listed.json())

    submit = client.post(
        f"/api/v1/forms/{form_id}/submit",
        headers=headers,
        json={"values": {"title": "Login broken", "details": "Cannot sign in"}, "submitter_email": owner.email},
    )
    assert submit.status_code == 200
    assert submit.json()["task_ref"]

    submissions = client.get(f"/api/v1/forms/{form_id}/submissions", headers=headers)
    assert submissions.status_code == 200
    assert submissions.json()["total"] >= 1


@pytest.mark.integration
def test_public_form_get_and_submit(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Public Intake", "project_id": str(project.id)},
    )
    form = db.get(Form, create.json()["id"])
    token = form.public_token

    public_get = client.get(f"/api/v1/public/forms/{token}")
    assert public_get.status_code == 200
    assert public_get.json()["name"] == "Public Intake"

    submit = client.post(
        f"/api/v1/public/forms/{token}",
        json={"values": {"title": "External request", "details": "From web"}, "submitter_email": "guest@test.dev"},
    )
    assert submit.status_code == 201

    task = db.scalar(select(Task).where(Task.project_id == project.id, Task.title == "External request"))
    assert task is not None
    submission = db.scalar(select(FormSubmission).where(FormSubmission.form_id == form.id, FormSubmission.task_id == task.id))
    assert submission is not None


@pytest.mark.integration
def test_public_form_honeypot_silent_success(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=headers,
        json={"name": "Spam Trap", "project_id": str(project.id)},
    )
    form = db.get(Form, create.json()["id"])

    count_before = len(db.scalars(select(Task).where(Task.project_id == project.id)).all())

    response = client.post(
        f"/api/v1/public/forms/{form.public_token}",
        json={"values": {"title": "Spam"}, "website": "http://spam.bot"},
    )
    assert response.status_code == 201
    count_after = len(db.scalars(select(Task).where(Task.project_id == project.id)).all())
    assert count_after == count_before


@pytest.mark.integration
def test_member_cannot_create_form(client, db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "form-member@test.dev", role="member")

    response = client.post(
        f"/api/v1/workspaces/{workspace.id}/forms",
        headers=auth_headers(client, member.email),
        json={"name": "Blocked", "project_id": str(project.id)},
    )
    assert response.status_code == 403
