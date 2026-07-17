"""Phase 4 security — cross-tenant resource access blocked."""
import pytest

from app.models.organization import Organization, OrganizationMember
from app.tests.conftest import auth_headers, make_user
from app.tests.helpers import build_project_stack


@pytest.mark.security
def test_user_cannot_read_project_in_other_organization(client, db, org, owner):
    other_org = Organization(name="Other Org")
    db.add(other_org)
    db.flush()

    other_owner = make_user(db, "other-owner@test.dev")
    db.add(OrganizationMember(organization_id=other_org.id, user_id=other_owner.id, role="owner"))
    _workspace, other_project = build_project_stack(db, other_org, other_owner)

    member = make_user(db, "member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    headers = auth_headers(client, member.email)
    response = client.get(f"/api/v1/projects/{other_project.id}", headers=headers)
    assert response.status_code == 404
