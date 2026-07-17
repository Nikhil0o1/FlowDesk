import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.workspace import Workspace, WorkspaceMember

ORG_LEADER_ROLES = frozenset({"owner", "admin"})


def assignable_org_members(members: list[OrganizationMember]) -> list[OrganizationMember]:
    """Org members eligible for existing-people flows (excludes org owner/admin)."""
    return [member for member in members if member.role not in ORG_LEADER_ROLES]


def goal_owner_candidate_user_ids(db: Session, workspace_id: uuid.UUID) -> set[uuid.UUID]:
    """Users who may own goals/targets: org leaders and scoped admins in the workspace."""
    ws = db.get(Workspace, workspace_id)
    if not ws:
        return set()

    org_id = ws.organization_id
    ids: set[uuid.UUID] = set()

    ids.update(
        db.scalars(
            select(OrganizationMember.user_id).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.role.in_(("owner", "admin")),
            )
        ).all()
    )
    ids.update(
        db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.role.in_(("admin", "owner")),
            )
        ).all()
    )
    ids.update(
        db.scalars(
            select(SpaceMember.user_id)
            .join(Space, Space.id == SpaceMember.space_id)
            .where(
                Space.workspace_id == workspace_id,
                Space.deleted_at.is_(None),
                SpaceMember.role == "admin",
            )
        ).all()
    )
    ids.update(
        db.scalars(
            select(ProjectMember.user_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(
                Project.workspace_id == workspace_id,
                Project.deleted_at.is_(None),
                Project.is_personal.is_(False),
                ProjectMember.role == "admin",
            )
        ).all()
    )
    return ids
