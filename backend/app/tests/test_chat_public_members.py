from sqlalchemy import select

from app.models.chat import ChatChannel, ChatMember
from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space
from app.models.workspace import Workspace, WorkspaceMember
from app.tests.conftest import auth_headers, make_user


def test_public_channel_members_include_legacy_project_members(client, db, org, owner):
    workspace = Workspace(organization_id=org.id, name="Chat WS", created_by=owner.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role="owner"))
    channel = ChatChannel(workspace_id=workspace.id, name="general", created_by=owner.id)
    db.add(channel)
    db.flush()
    db.add(ChatMember(channel_id=channel.id, user_id=owner.id, role="admin"))

    space = Space(workspace_id=workspace.id, name="Space", created_by=owner.id)
    db.add(space)
    db.flush()
    project = Project(
        space_id=space.id,
        workspace_id=workspace.id,
        name="Legacy Project",
        created_by=owner.id,
    )
    db.add(project)
    db.flush()

    legacy_member = make_user(db, "legacy-project-member@test.dev")
    db.add(OrganizationMember(organization_id=org.id, user_id=legacy_member.id, role="member"))
    db.add(ProjectMember(project_id=project.id, user_id=legacy_member.id, role="member"))
    db.flush()

    headers = auth_headers(client, "owner@test.dev")
    response = client.get(f"/api/v1/channels/{channel.id}/members", headers=headers)

    assert response.status_code == 200
    member_ids = {item["user_id"] for item in response.json()}
    assert str(legacy_member.id) in member_ids
    assert db.scalar(
        select(ChatMember).where(
            ChatMember.channel_id == channel.id,
            ChatMember.user_id == legacy_member.id,
        )
    )
