"""Organization API: CRUD, members, invites, audit logs."""
from unittest.mock import patch

import pytest

from app.models.invite import Invite
from app.models.organization import OrganizationMember
from app.tests.conftest import auth_headers, make_user

pytestmark = pytest.mark.integration


def test_list_my_organizations(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    response = client.get("/api/v1/organizations", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert any(o["id"] == str(org.id) and o["my_role"] == "owner" for o in data)


def test_get_organization_requires_membership(client, db, org, owner):
    outsider = make_user(db, "org-outsider@test.dev")
    db.flush()

    assert client.get(
        f"/api/v1/organizations/{org.id}",
        headers=auth_headers(client, outsider.email),
    ).status_code == 404

    response = client.get(
        f"/api/v1/organizations/{org.id}",
        headers=auth_headers(client, owner.email),
    )
    assert response.status_code == 200
    assert response.json()["name"] == org.name


def test_only_owner_can_patch_organization(client, db, org, owner):
    member = make_user(db, "org-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    member_headers = auth_headers(client, member.email)
    assert client.patch(
        f"/api/v1/organizations/{org.id}",
        headers=member_headers,
        json={"name": "Hacked"},
    ).status_code == 403

    owner_headers = auth_headers(client, owner.email)
    patch = client.patch(
        f"/api/v1/organizations/{org.id}",
        headers=owner_headers,
        json={"name": "Renamed Org"},
    )
    assert patch.status_code == 200
    assert patch.json()["name"] == "Renamed Org"


def test_list_and_update_org_members(client, db, org, owner):
    member = make_user(db, "org-promote@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()
    headers = auth_headers(client, owner.email)

    members = client.get(f"/api/v1/organizations/{org.id}/members", headers=headers)
    assert members.status_code == 200
    assert len(members.json()) >= 2

    role_change = client.patch(
        f"/api/v1/organizations/{org.id}/members/{member.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert role_change.status_code == 200


def test_owner_cannot_demote_last_owner(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    response = client.patch(
        f"/api/v1/organizations/{org.id}/members/{owner.id}",
        headers=headers,
        json={"role": "member"},
    )
    assert response.status_code == 400


@patch("app.services.invite_service.email_service")
def test_org_invite_create_list_revoke(mock_email, client, db, org, owner):
    headers = auth_headers(client, owner.email)

    create = client.post(
        f"/api/v1/organizations/{org.id}/invites",
        headers=headers,
        json={"email": "neworg@test.dev", "role": "member"},
    )
    assert create.status_code == 201, create.text
    invite_id = create.json()["id"]

    listed = client.get(f"/api/v1/organizations/{org.id}/invites", headers=headers)
    assert listed.status_code == 200
    assert any(i["id"] == invite_id for i in listed.json())

    revoke = client.delete(f"/api/v1/organizations/{org.id}/invites/{invite_id}", headers=headers)
    assert revoke.status_code == 200
    invite = db.get(Invite, invite_id)
    assert invite.status == "revoked"


@patch("app.services.invite_service.email_service")
def test_member_cannot_create_org_invite(_mock_email, client, db, org, owner):
    member = make_user(db, "org-inviter@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    response = client.post(
        f"/api/v1/organizations/{org.id}/invites",
        headers=auth_headers(client, member.email),
        json={"email": "blocked@test.dev", "role": "member"},
    )
    assert response.status_code == 403


def test_org_audit_logs_owner_only(client, db, org, owner):
    headers = auth_headers(client, owner.email)
    client.patch(f"/api/v1/organizations/{org.id}", headers=headers, json={"name": "Audit Test Org"})

    logs = client.get(f"/api/v1/organizations/{org.id}/audit-logs", headers=headers)
    assert logs.status_code == 200
    assert logs.json()["total"] >= 1
    assert any(item["action"] == "organization.updated" for item in logs.json()["items"])

    member = make_user(db, "org-audit@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()
    assert client.get(
        f"/api/v1/organizations/{org.id}/audit-logs",
        headers=auth_headers(client, member.email),
    ).status_code == 403


