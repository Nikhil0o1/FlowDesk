"""Unit tests — org-wide role hierarchy for people management."""
import uuid

import pytest
from fastapi import HTTPException

from app.models.organization import OrganizationMember
from app.models.project import ProjectMember, SpaceMember
from app.models.workspace import WorkspaceMember
from app.services.permission_service import PermissionService
from app.services.role_hierarchy_service import (
    ROLE_RANK,
    assert_actor_can_manage_member,
    can_viewer_see_member_in_analytics,
    highest_role_from_parts,
    rank_for_org_role,
    rank_for_project_role,
    rank_for_space_role,
    rank_for_workspace_role,
    resolve_user_highest_role,
    role_rank,
)
from app.tests.conftest import make_user


@pytest.mark.unit
def test_can_viewer_see_member_in_analytics():
    assert can_viewer_see_member_in_analytics("org_owner", "org_admin") is True
    assert can_viewer_see_member_in_analytics("org_owner", "org_owner") is True
    assert can_viewer_see_member_in_analytics("org_admin", "org_owner") is True
    assert can_viewer_see_member_in_analytics("org_admin", "org_admin") is True
    assert can_viewer_see_member_in_analytics("org_admin", "workspace_admin") is True
    # Surrounding peers (other WS/space/project admins) are visible to scoped admins.
    assert can_viewer_see_member_in_analytics("workspace_admin", "workspace_admin") is True
    assert can_viewer_see_member_in_analytics("workspace_admin", "project_member") is True
    assert can_viewer_see_member_in_analytics("project_admin", "workspace_admin") is True
    assert can_viewer_see_member_in_analytics("space_admin", "workspace_admin") is True
    # Org leaders stay hidden from scoped admins.
    assert can_viewer_see_member_in_analytics("workspace_admin", "org_admin") is False
    assert can_viewer_see_member_in_analytics("project_admin", "org_owner") is False


@pytest.mark.unit
def test_role_rank_ordering():
    assert role_rank("org_owner") > role_rank("org_admin")
    assert role_rank("org_admin") > role_rank("workspace_admin")
    assert role_rank("workspace_admin") > role_rank("space_admin")
    assert role_rank("space_admin") > role_rank("project_admin")
    assert role_rank("project_admin") > role_rank("project_member")
    assert role_rank("project_member") > role_rank("project_viewer")
    assert role_rank("project_viewer") > role_rank("org_member")
    assert role_rank("unknown_role") == 0


@pytest.mark.unit
def test_rank_helpers_and_highest_role_from_parts():
    assert rank_for_org_role("owner") == ROLE_RANK["org_owner"]
    assert rank_for_org_role("admin") == ROLE_RANK["org_admin"]
    assert rank_for_org_role("member") == ROLE_RANK["org_member"]

    assert rank_for_workspace_role("owner") == ROLE_RANK["workspace_admin"]
    assert rank_for_workspace_role("member") == ROLE_RANK["org_member"]

    assert rank_for_space_role("admin") == ROLE_RANK["space_admin"]
    assert rank_for_space_role("member") == ROLE_RANK["org_member"]

    assert rank_for_project_role("admin") == ROLE_RANK["project_admin"]
    assert rank_for_project_role("member") == ROLE_RANK["project_member"]
    assert rank_for_project_role("viewer") == ROLE_RANK["project_viewer"]
    assert rank_for_project_role("guest") == ROLE_RANK["org_member"]

    from app.schemas.dashboard import ProjectRoleItem, SpaceRoleItem, WorkspaceRoleItem

    viewer_only = [
        ProjectRoleItem(
            project_id=uuid.uuid4(),
            project_name="App",
            workspace_id=uuid.uuid4(),
            role="viewer",
        )
    ]
    assert highest_role_from_parts("member", [], [], viewer_only) == "project_viewer"
    assert (
        highest_role_from_parts(
            None,
            [WorkspaceRoleItem(workspace_id=uuid.uuid4(), workspace_name="Main", role="member")],
            [],
            [],
        )
        == "member"
    )
    assert highest_role_from_parts("owner", [], [], []) == "org_owner"
    assert highest_role_from_parts("admin", [], [], []) == "org_admin"

    assert (
        highest_role_from_parts(
            "member",
            [],
            [
                SpaceRoleItem(
                    space_id=uuid.uuid4(),
                    space_name="Ops",
                    workspace_id=uuid.uuid4(),
                    workspace_name="Main",
                    role="admin",
                )
            ],
            [],
        )
        == "space_admin"
    )
    assert highest_role_from_parts(None, [], [], []) == "member"


@pytest.mark.unit
def test_resolve_user_highest_role_for_non_member(db, org):
    outsider = make_user(db, "outsider-hier@test.dev")
    db.flush()
    assert resolve_user_highest_role(db, org.id, outsider.id) == "member"


@pytest.mark.unit
def test_actor_cannot_manage_self(db, org, owner):
    with pytest.raises(HTTPException) as exc:
        assert_actor_can_manage_member(
            db,
            PermissionService(db, owner),
            org.id,
            owner.id,
        )
    assert exc.value.status_code == 403


@pytest.mark.unit
def test_workspace_admin_cannot_manage_peer(db, org, owner):
    ws_admin = make_user(db, "ws-hier-admin@test.dev")
    peer = make_user(db, "ws-hier-peer@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=peer.id, role="member"))
    from app.tests.helpers import build_project_stack

    workspace, _ = build_project_stack(db, org, owner)
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=peer.id, role="admin"))
    db.flush()

    perms = PermissionService(db, ws_admin)
    with pytest.raises(HTTPException) as exc:
        assert_actor_can_manage_member(db, perms, org.id, peer.id)
    assert exc.value.status_code == 403


@pytest.mark.unit
def test_org_admin_can_manage_workspace_admin(db, org, owner):
    org_admin = make_user(db, "hier-org-admin@test.dev")
    ws_admin = make_user(db, "hier-ws-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    from app.tests.helpers import build_project_stack

    workspace, _ = build_project_stack(db, org, owner)
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    assert_actor_can_manage_member(
        db, PermissionService(db, org_admin), org.id, ws_admin.id
    )


@pytest.mark.unit
def test_workspace_admin_cannot_grant_workspace_admin(db, org, owner):
    ws_admin = make_user(db, "ws-grant-admin@test.dev")
    member = make_user(db, "ws-grant-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    from app.tests.helpers import build_project_stack

    workspace, _ = build_project_stack(db, org, owner)
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()

    perms = PermissionService(db, ws_admin)
    with pytest.raises(HTTPException) as exc:
        assert_actor_can_manage_member(
            db,
            perms,
            org.id,
            member.id,
            grant_rank=rank_for_workspace_role("admin"),
        )
    assert exc.value.status_code == 403


@pytest.mark.unit
def test_org_admin_cannot_promote_to_org_admin(db, org, owner):
    org_admin = make_user(db, "promote-admin@test.dev")
    member = make_user(db, "promote-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.flush()

    with pytest.raises(HTTPException) as exc:
        assert_actor_can_manage_member(
            db,
            PermissionService(db, org_admin),
            org.id,
            member.id,
            grant_rank=rank_for_org_role("admin"),
        )
    assert exc.value.status_code == 403


@pytest.mark.unit
def test_project_admin_can_manage_project_member(db, org, owner):
    from app.tests.helpers import build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    proj_admin = make_user(db, "proj-hier-admin@test.dev")
    proj_member = make_user(db, "proj-hier-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=proj_member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_member.id, role="member"))
    db.flush()

    assert resolve_user_highest_role(db, org.id, proj_admin.id) == "project_admin"
    assert resolve_user_highest_role(db, org.id, proj_member.id) == "project_member"
    assert_actor_can_manage_member(
        db,
        PermissionService(db, proj_admin),
        org.id,
        proj_member.id,
        grant_rank=rank_for_project_role("viewer"),
    )


@pytest.mark.unit
def test_project_admin_cannot_grant_workspace_admin(db, org, owner):
    from app.tests.helpers import build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    proj_admin = make_user(db, "proj-grant-ws@test.dev")
    member = make_user(db, "proj-grant-ws-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.flush()

    with pytest.raises(HTTPException) as exc:
        assert_actor_can_manage_member(
            db,
            PermissionService(db, proj_admin),
            org.id,
            member.id,
            grant_rank=rank_for_workspace_role("admin"),
        )
    assert exc.value.status_code == 403
    assert "above your own level" in exc.value.detail


@pytest.mark.unit
def test_project_admin_can_grant_project_admin_to_org_member(db, org, owner):
    from app.tests.helpers import build_project_stack

    workspace, project = build_project_stack(db, org, owner)
    proj_admin = make_user(db, "proj-grant-admin@test.dev")
    candidate = make_user(db, "proj-grant-candidate@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=candidate.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.flush()

    assert_actor_can_manage_member(
        db,
        PermissionService(db, proj_admin),
        org.id,
        candidate.id,
        grant_rank=rank_for_project_role("admin"),
    )
