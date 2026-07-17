"""Phase 2 unit tests — permission_service private-task ACL."""
import uuid

import pytest

from app.models.task import TaskAssignee, TaskShareMember
from app.models.workspace import WorkspaceMember
from app.services.permission_service import PermissionError403, PermissionService
from app.tests.helpers import add_project_member, add_task, build_project_stack


def _private(db, project, owner, number: int = 88) -> "Task":
    from app.models.task import Task

    task = add_task(db, project, owner, title="Private", number=number)
    task.is_private = True
    db.flush()
    return task


@pytest.mark.unit
def test_can_view_public_task_as_project_member(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "unit-member@test.dev")
    task = add_task(db, project, owner, number=1)

    perms = PermissionService(db, member)
    assert perms.can_view_task(task) is True


@pytest.mark.unit
def test_cannot_view_private_task_without_share(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "unit-outsider@test.dev")
    task = _private(db, project, owner)

    perms = PermissionService(db, member)
    assert perms.can_view_task(task) is False


@pytest.mark.unit
def test_creator_always_views_private_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    task = _private(db, project, owner)

    perms = PermissionService(db, owner)
    assert perms.can_view_task(task) is True
    assert perms.require_task_edit(task) is task


@pytest.mark.unit
def test_share_editor_can_edit_private_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    editor = add_project_member(db, org, workspace, project, "unit-editor@test.dev")
    task = _private(db, project, owner, number=89)
    db.add(TaskShareMember(task_id=task.id, user_id=editor.id, role="editor", created_by=owner.id))
    db.flush()

    perms = PermissionService(db, editor)
    assert perms.require_task_edit(task) is task


@pytest.mark.unit
def test_share_viewer_cannot_edit_private_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    viewer = add_project_member(db, org, workspace, project, "unit-viewer@test.dev")
    task = _private(db, project, owner, number=90)
    db.add(TaskShareMember(task_id=task.id, user_id=viewer.id, role="viewer", created_by=owner.id))
    db.flush()

    perms = PermissionService(db, viewer)
    with pytest.raises(PermissionError403):
        perms.require_task_edit(task)


@pytest.mark.unit
def test_assignee_can_view_private_task(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    assignee = add_project_member(db, org, workspace, project, "unit-assignee@test.dev")
    task = _private(db, project, owner, number=91)
    db.add(TaskAssignee(task_id=task.id, user_id=assignee.id))
    db.flush()

    perms = PermissionService(db, assignee)
    assert perms.can_view_task(task) is True


@pytest.mark.unit
def test_require_task_view_raises_not_found_for_hidden(db, org, owner):
    from app.services.permission_service import NotFound404

    workspace, project = build_project_stack(db, org, owner)
    stranger = add_project_member(db, org, workspace, project, "unit-hidden@test.dev")
    task = _private(db, project, owner, number=92)

    perms = PermissionService(db, stranger)
    with pytest.raises(NotFound404):
        perms.require_task_view(task)


@pytest.mark.unit
def test_project_viewer_cannot_edit(db, org, owner):
    from app.services.permission_service import PermissionError403

    workspace, project = build_project_stack(db, org, owner)
    viewer = add_project_member(db, org, workspace, project, "unit-proj-viewer@test.dev", role="viewer")
    task = add_task(db, project, owner, number=2)

    perms = PermissionService(db, viewer)
    assert perms.can_view_task(task) is True
    with pytest.raises(PermissionError403):
        perms.require_project_edit(project.id)


@pytest.mark.unit
def test_org_owner_can_view_any_workspace_in_org(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    perms = PermissionService(db, owner)
    assert perms.can_view_workspace(workspace.id) is True
    assert perms.require_workspace_member(workspace.id).id == workspace.id


@pytest.mark.unit
def test_disabled_org_member_rejected(db, org, owner):
    from app.services.permission_service import PermissionError403

    org.is_disabled = True
    db.flush()
    perms = PermissionService(db, owner)
    with pytest.raises(PermissionError403):
        perms.require_org_member(org.id)


@pytest.mark.unit
def test_require_explicit_project_admin(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "proj-admin@test.dev", role="admin")
    viewer = add_project_member(db, org, workspace, project, "proj-viewer@test.dev", role="viewer")

    assert PermissionService(db, member).require_explicit_project_admin(project.id).id == project.id
    with pytest.raises(PermissionError403):
        PermissionService(db, viewer).require_explicit_project_admin(project.id)


@pytest.mark.unit
def test_require_workspace_people_manager(db, org, owner):
    from app.models.organization import OrganizationMember
    from app.models.project import ProjectMember, SpaceMember
    from app.tests.conftest import make_user

    workspace, project = build_project_stack(db, org, owner)
    plain = make_user(db, "plain-people@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=plain.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=plain.id, role="member"))

    project_admin = make_user(db, "people-proj-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=project_admin.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=project_admin.id, role="admin"))

    space_admin = make_user(db, "people-space-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=space_admin.id, role="member"))
    db.add(SpaceMember(space_id=project.space_id, user_id=space_admin.id, role="admin"))
    db.flush()

    assert (
        PermissionService(db, project_admin).require_workspace_people_manager(workspace.id).id
        == workspace.id
    )
    assert (
        PermissionService(db, space_admin).require_workspace_people_manager(workspace.id).id
        == workspace.id
    )
    with pytest.raises(PermissionError403):
        PermissionService(db, plain).require_workspace_people_manager(workspace.id)

    ws_admin = make_user(db, "people-ws-admin@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=ws_admin.id, role="member"))
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=ws_admin.id, role="admin"))
    db.flush()
    assert (
        PermissionService(db, ws_admin).require_workspace_people_manager(workspace.id).id
        == workspace.id
    )

    assert (
        PermissionService(db, owner).require_workspace_people_manager(workspace.id).id
        == workspace.id
    )


@pytest.mark.unit
def test_assignable_org_members_filters_leaders():
    from app.models.organization import OrganizationMember
    from app.services.member_candidates import assignable_org_members

    owner = OrganizationMember(organization_id=uuid.uuid4(), user_id=uuid.uuid4(), role="owner")
    admin = OrganizationMember(organization_id=uuid.uuid4(), user_id=uuid.uuid4(), role="admin")
    member = OrganizationMember(organization_id=uuid.uuid4(), user_id=uuid.uuid4(), role="member")
    result = assignable_org_members([owner, admin, member])
    assert [m.role for m in result] == ["member"]


@pytest.mark.unit
def test_goal_share_member_has_explicit_access(db, org, owner):
    from app.models.goal import Goal, GoalShareMember

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "goal-perm-share@test.dev")
    goal = Goal(
        workspace_id=workspace.id,
        name="Shared goal",
        owner_id=owner.id,
        created_by=owner.id,
        is_private=True,
    )
    db.add(goal)
    db.flush()
    db.add(GoalShareMember(goal_id=goal.id, user_id=member.id, role="viewer", created_by=owner.id))
    db.flush()

    member_perms = PermissionService(db, member)
    assert member_perms.has_explicit_goal_access(workspace.id) is True
    assert member_perms.can_access_goals(workspace.id) is True
    assert member_perms.can_view_goal(goal) is True


@pytest.mark.unit
def test_goal_coowner_has_explicit_access(db, org, owner):
    from app.models.goal import Goal, GoalOwner

    workspace, project = build_project_stack(db, org, owner)
    coowner = add_project_member(db, org, workspace, project, "goal-perm-coowner@test.dev")
    goal = Goal(
        workspace_id=workspace.id,
        name="Co-owned goal",
        owner_id=owner.id,
        created_by=owner.id,
        is_private=True,
    )
    db.add(goal)
    db.flush()
    db.add(GoalOwner(goal_id=goal.id, user_id=coowner.id))
    db.flush()

    coowner_perms = PermissionService(db, coowner)
    assert coowner_perms.has_explicit_goal_access(workspace.id) is True
    assert coowner_perms.can_view_goal(goal) is True


@pytest.mark.unit
def test_goal_in_shared_folder_is_viewable(db, org, owner):
    from app.models.goal import Goal, GoalFolder, GoalFolderShareMember

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "goal-perm-folder@test.dev")
    folder = GoalFolder(
        workspace_id=workspace.id,
        name="Shared folder",
        created_by=owner.id,
        is_private=True,
    )
    db.add(folder)
    db.flush()
    goal = Goal(
        workspace_id=workspace.id,
        name="Folder goal",
        owner_id=owner.id,
        created_by=owner.id,
        folder_id=folder.id,
        is_private=True,
    )
    db.add(goal)
    db.flush()
    db.add(
        GoalFolderShareMember(
            folder_id=folder.id,
            user_id=member.id,
            role="viewer",
            created_by=owner.id,
        )
    )
    db.flush()

    member_perms = PermissionService(db, member)
    assert member_perms.has_explicit_goal_access(workspace.id) is True
    assert member_perms.can_view_goal(goal) is True


@pytest.mark.unit
def test_plain_member_without_goal_access(db, org, owner):
    from sqlalchemy import select

    from app.models.goal import Goal

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "goal-perm-none@test.dev")
    db.add(
        Goal(
            workspace_id=workspace.id,
            name="Public workspace goal",
            owner_id=owner.id,
            created_by=owner.id,
            is_private=False,
        )
    )
    db.flush()

    member_perms = PermissionService(db, member)
    assert member_perms.has_explicit_goal_access(workspace.id) is False
    assert member_perms.can_access_goals(workspace.id) is False

    query = select(Goal).where(Goal.workspace_id == workspace.id, Goal.deleted_at.is_(None))
    filtered = member_perms.apply_goals_list_filter(workspace.id, query)
    assert db.scalars(filtered).all() == []


@pytest.mark.unit
def test_folder_creator_has_explicit_access(db, org, owner):
    from app.models.goal import GoalFolder

    workspace, project = build_project_stack(db, org, owner)
    creator = add_project_member(db, org, workspace, project, "folder-creator@test.dev", role="admin")
    folder = GoalFolder(
        workspace_id=workspace.id,
        name="Creator folder",
        created_by=creator.id,
        is_private=True,
    )
    db.add(folder)
    db.flush()

    assert PermissionService(db, creator).has_explicit_goal_access(workspace.id) is True


@pytest.mark.unit
def test_section_admin_apply_goals_list_filter_includes_public(db, org, owner):
    from sqlalchemy import select

    from app.models.goal import Goal

    workspace, project = build_project_stack(db, org, owner)
    admin = add_project_member(db, org, workspace, project, "goal-list-admin@test.dev", role="admin")
    public_goal = Goal(
        workspace_id=workspace.id,
        name="Public goal",
        owner_id=owner.id,
        created_by=owner.id,
        is_private=False,
    )
    db.add(public_goal)
    db.flush()

    query = select(Goal).where(Goal.workspace_id == workspace.id, Goal.deleted_at.is_(None))
    rows = db.scalars(
        PermissionService(db, admin).apply_goals_list_filter(workspace.id, query)
    ).all()
    assert any(g.id == public_goal.id for g in rows)


@pytest.mark.unit
def test_goal_share_editor_can_manage(db, org, owner):
    from app.models.goal import Goal, GoalShareMember

    workspace, project = build_project_stack(db, org, owner)
    editor = add_project_member(db, org, workspace, project, "goal-share-editor@test.dev")
    goal = Goal(
        workspace_id=workspace.id,
        name="Editable shared goal",
        owner_id=owner.id,
        created_by=owner.id,
        is_private=True,
    )
    db.add(goal)
    db.flush()
    db.add(GoalShareMember(goal_id=goal.id, user_id=editor.id, role="editor", created_by=owner.id))
    db.flush()

    assert PermissionService(db, editor).require_goal_manage(goal) is goal


@pytest.mark.unit
def test_section_admin_can_view_public_goal_folder(db, org, owner):
    from app.models.goal import GoalFolder

    workspace, project = build_project_stack(db, org, owner)
    admin = add_project_member(db, org, workspace, project, "folder-view-admin@test.dev", role="admin")
    folder = GoalFolder(
        workspace_id=workspace.id,
        name="Public folder",
        created_by=owner.id,
        is_private=False,
    )
    db.add(folder)
    db.flush()

    assert PermissionService(db, admin).can_view_goal_folder(folder) is True


@pytest.mark.unit
def test_folder_share_editor_can_manage(db, org, owner):
    from app.models.goal import GoalFolder, GoalFolderShareMember

    workspace, project = build_project_stack(db, org, owner)
    editor = add_project_member(db, org, workspace, project, "folder-share-editor@test.dev")
    folder = GoalFolder(
        workspace_id=workspace.id,
        name="Editable folder",
        created_by=owner.id,
        is_private=True,
    )
    db.add(folder)
    db.flush()
    db.add(
        GoalFolderShareMember(
            folder_id=folder.id,
            user_id=editor.id,
            role="editor",
            created_by=owner.id,
        )
    )
    db.flush()

    assert PermissionService(db, editor).require_goal_folder_manage(folder) is folder


@pytest.mark.unit
def test_goal_coowner_can_manage_and_share(db, org, owner):
    from app.models.goal import Goal, GoalOwner

    workspace, project = build_project_stack(db, org, owner)
    coowner = add_project_member(db, org, workspace, project, "goal-coowner-manage@test.dev")
    goal = Goal(
        workspace_id=workspace.id,
        name="Co-managed goal",
        owner_id=owner.id,
        created_by=owner.id,
        is_private=True,
    )
    db.add(goal)
    db.flush()
    db.add(GoalOwner(goal_id=goal.id, user_id=coowner.id))
    db.flush()

    coowner_perms = PermissionService(db, coowner)
    assert coowner_perms.require_goal_manage(goal) is goal
    assert coowner_perms.require_goal_share_manage(goal) is goal


@pytest.mark.unit
def test_apply_goal_folders_list_filter_for_share_member(db, org, owner):
    from sqlalchemy import select

    from app.models.goal import GoalFolder, GoalFolderShareMember

    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "folder-list-share@test.dev")
    folder = GoalFolder(
        workspace_id=workspace.id,
        name="Shared only folder",
        created_by=owner.id,
        is_private=True,
    )
    db.add(folder)
    db.flush()
    db.add(
        GoalFolderShareMember(
            folder_id=folder.id,
            user_id=member.id,
            role="viewer",
            created_by=owner.id,
        )
    )
    db.flush()

    query = select(GoalFolder).where(GoalFolder.workspace_id == workspace.id)
    rows = db.scalars(
        PermissionService(db, member).apply_goal_folders_list_filter(workspace.id, query)
    ).all()
    assert any(f.id == folder.id for f in rows)


@pytest.mark.unit
def test_apply_goal_folders_list_filter_for_section_admin(db, org, owner):
    from sqlalchemy import select

    from app.models.goal import GoalFolder

    workspace, project = build_project_stack(db, org, owner)
    admin = add_project_member(db, org, workspace, project, "folder-list-admin@test.dev", role="admin")
    public_folder = GoalFolder(
        workspace_id=workspace.id,
        name="Public folder list",
        created_by=owner.id,
        is_private=False,
    )
    db.add(public_folder)
    db.flush()

    query = select(GoalFolder).where(GoalFolder.workspace_id == workspace.id)
    rows = db.scalars(
        PermissionService(db, admin).apply_goal_folders_list_filter(workspace.id, query)
    ).all()
    assert any(f.id == public_folder.id for f in rows)


@pytest.mark.unit
def test_folder_creator_can_manage_and_share_settings(db, org, owner):
    from app.models.goal import GoalFolder

    workspace, project = build_project_stack(db, org, owner)
    creator = add_project_member(db, org, workspace, project, "folder-creator-manage@test.dev", role="admin")
    folder = GoalFolder(
        workspace_id=workspace.id,
        name="Creator managed folder",
        created_by=creator.id,
        is_private=True,
    )
    db.add(folder)
    db.flush()

    creator_perms = PermissionService(db, creator)
    assert creator_perms.require_goal_folder_manage(folder) is folder
    assert creator_perms.require_goal_folder_share_manage(folder) is folder
    assert creator_perms.can_view_goal_folder(folder) is True


@pytest.mark.unit
def test_accessible_space_ids_for_project_member(db, org, owner):
    workspace, project = build_project_stack(db, org, owner)
    member = add_project_member(db, org, workspace, project, "space-via-project@test.dev")

    perms = PermissionService(db, member)
    assert project.space_id in perms.accessible_space_ids()


@pytest.mark.unit
def test_accessible_space_ids_for_org_admin(db, org, owner):
    from app.models.organization import OrganizationMember
    from app.tests.conftest import make_user

    workspace, project = build_project_stack(db, org, owner)
    org_admin = make_user(db, "org-admin-spaces@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=org_admin.id, role="admin"))
    db.flush()

    perms = PermissionService(db, org_admin)
    assert project.space_id in perms.accessible_space_ids()
