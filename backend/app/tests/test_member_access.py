"""Member access directory — scoped admins can load the access panel."""
from app.models.organization import OrganizationMember
from app.models.project import ProjectMember, Space, SpaceMember
from app.models.workspace import Workspace, WorkspaceMember
from app.services.member_access_service import build_member_access_detail
from app.services.permission_service import PermissionError403, PermissionService
from app.tests.conftest import make_user
from app.tests.helpers import build_project_stack


def test_has_scoped_admin_role_workspace_admin(db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    ws_admin = make_user(db, "ws-admin2@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()
    perms = PermissionService(db, ws_admin)
    assert perms.has_scoped_admin_role(org.id)
    perms.require_people_directory_access(org.id)


def test_has_scoped_admin_role_space_admin_without_workspace_membership(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    space = db.get(Space, project.space_id)
    space_admin = make_user(db, "space-only-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    db.flush()
    perms = PermissionService(db, space_admin)
    assert perms.has_scoped_admin_role(org.id)


def test_build_member_access_detail_for_workspace_admin(db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    ws_admin = make_user(db, "ws-admin3@test.dev")
    target = make_user(db, "target-ws@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=target.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=target.id, role="member"))
    db.flush()
    perms = PermissionService(db, ws_admin)
    detail = build_member_access_detail(db, perms, org.id, target.id)
    assert detail.user_id == target.id


def test_plain_member_denied(db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    member = make_user(db, "plain2@test.dev")
    target = make_user(db, "target-plain@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    perms = PermissionService(db, member)
    try:
        perms.require_people_directory_access(org.id)
        assert False, "expected 403"
    except PermissionError403:
        pass


def test_personal_list_admin_not_scoped_admin(db, org, owner):
    """Personal List admin alone must not unlock Analytics / People directory."""
    from app.services.personal_list_service import get_or_create_personal_project

    workspace, _ = build_project_stack(db, org, owner)
    member = make_user(db, "personal-scoped@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=member.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=member.id, role="member"))
    db.flush()
    personal = get_or_create_personal_project(db, workspace_id=workspace.id, user_id=member.id)
    assert personal.is_personal is True

    perms = PermissionService(db, member)
    assert perms.has_scoped_admin_role(org.id) is False
    assert perms.has_analytics_access(org.id) is False
    try:
        perms.require_analytics_access(org.id)
        assert False, "expected 403"
    except PermissionError403:
        pass
    try:
        perms.require_people_directory_access(org.id)
        assert False, "expected 403"
    except PermissionError403:
        pass


def test_build_member_access_detail_scoped_workspace(db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    ws_admin = make_user(db, "ws-admin-scoped@test.dev")
    target = make_user(db, "target-scoped@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=target.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=target.id, role="member"))
    db.flush()
    perms = PermissionService(db, ws_admin)
    detail = build_member_access_detail(
        db, perms, org.id, target.id, workspace_id=workspace.id
    )
    assert detail.user_id == target.id
    assert all(w.workspace_id == workspace.id for w in detail.workspace_access)


def test_scoped_workspace_denies_out_of_scope_target(db, org, owner):
    workspace, _ = build_project_stack(db, org, owner)
    other_ws = Workspace(organization_id=org.id, name="Other", created_by=owner.id)
    db.add(other_ws)
    db.flush()
    ws_admin = make_user(db, "ws-admin-scope-deny@test.dev")
    outsider = make_user(db, "outsider@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=outsider.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.add(WorkspaceMember(workspace_id=other_ws.id, user_id=outsider.id, role="member"))
    db.flush()
    perms = PermissionService(db, ws_admin)
    try:
        build_member_access_detail(
            db, perms, org.id, outsider.id, workspace_id=workspace.id
        )
        assert False, "expected 403"
    except PermissionError403:
        pass


def test_space_admin_scoped_access(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    space = db.get(Space, project.space_id)
    space_admin = make_user(db, "space-admin-scoped@test.dev")
    target = make_user(db, "space-target@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=target.id, role="member"))
    db.add(SpaceMember(space_id=space.id, user_id=space_admin.id, role="admin"))
    db.add(SpaceMember(space_id=space.id, user_id=target.id, role="member"))
    db.flush()
    perms = PermissionService(db, space_admin)
    detail = build_member_access_detail(
        db, perms, org.id, target.id, space_id=space.id
    )
    assert detail.user_id == target.id
    assert all(s.space_id == space.id for s in detail.space_access)


def test_project_admin_scoped_access(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    proj_admin = make_user(db, "proj-admin-scoped@test.dev")
    target = make_user(db, "proj-target@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=proj_admin.id, role="member"))
    db.add(OrganizationMember(organization_id=org.id, user_id=target.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=proj_admin.id, role="admin"))
    db.add(ProjectMember(project_id=project.id, user_id=target.id, role="member"))
    db.flush()
    perms = PermissionService(db, proj_admin)
    detail = build_member_access_detail(
        db, perms, org.id, target.id, project_id=project.id
    )
    assert detail.user_id == target.id
    assert all(p.project_id == project.id for p in detail.project_access)
