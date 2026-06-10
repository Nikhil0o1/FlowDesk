"""Scoped RBAC permission checks.

Role resolution is always membership-based (organization_members,
workspace_members, project_members) — never a global role on the user,
except platform superadmin which is platform-scope only and explicitly
EXCLUDED from organization data access.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember


class PermissionError403(HTTPException):
    def __init__(self, detail: str = "You do not have permission to perform this action"):
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


class NotFound404(HTTPException):
    def __init__(self, detail: str = "Resource not found"):
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


class PermissionService:
    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user

    # ---------- role lookups ----------

    def org_role(self, org_id: uuid.UUID) -> str | None:
        member = self.db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == self.user.id,
            )
        )
        return member.role if member else None

    def workspace_role(self, workspace_id: uuid.UUID) -> str | None:
        member = self.db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id == self.user.id,
            )
        )
        return member.role if member else None

    def project_role(self, project_id: uuid.UUID) -> str | None:
        member = self.db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == self.user.id,
            )
        )
        return member.role if member else None

    # ---------- superadmin (platform scope ONLY) ----------

    def require_superadmin(self) -> None:
        if not self.user.is_platform_superadmin:
            raise PermissionError403("Platform superadmin access required")

    def forbid_superadmin_org_data(self) -> None:
        """Superadmins must never read org-private data (tasks, chat, files...)."""
        if self.user.is_platform_superadmin and not self._has_any_membership():
            raise PermissionError403("Superadmin cannot access organization data")

    def _has_any_membership(self) -> bool:
        return (
            self.db.scalar(
                select(OrganizationMember.id)
                .where(OrganizationMember.user_id == self.user.id)
                .limit(1)
            )
            is not None
        )

    # ---------- organization scope ----------

    def get_org_or_404(self, org_id: uuid.UUID) -> Organization:
        org = self.db.get(Organization, org_id)
        if not org or org.deleted_at is not None:
            raise NotFound404("Organization not found")
        return org

    def require_org_member(self, org_id: uuid.UUID) -> str:
        role = self.org_role(org_id)
        if role is None:
            raise NotFound404("Organization not found")
        org = self.get_org_or_404(org_id)
        if org.is_disabled:
            raise PermissionError403("This organization has been disabled")
        return role

    def require_org_owner(self, org_id: uuid.UUID) -> str:
        role = self.require_org_member(org_id)
        if role != "owner":
            raise PermissionError403("Organization owner access required")
        return role

    # ---------- workspace scope ----------

    def get_workspace_or_404(self, workspace_id: uuid.UUID) -> Workspace:
        ws = self.db.get(Workspace, workspace_id)
        if not ws or ws.deleted_at is not None:
            raise NotFound404("Workspace not found")
        return ws

    def can_view_workspace(self, workspace_id: uuid.UUID) -> bool:
        ws = self.get_workspace_or_404(workspace_id)
        # Org owners see all workspaces in their org
        if self.org_role(ws.organization_id) == "owner":
            return True
        return self.workspace_role(workspace_id) is not None

    def require_workspace_member(self, workspace_id: uuid.UUID) -> Workspace:
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self.org_role(ws.organization_id) == "owner":
            return ws
        if self.workspace_role(workspace_id) is None:
            raise NotFound404("Workspace not found")
        return ws

    def require_workspace_admin(self, workspace_id: uuid.UUID) -> Workspace:
        """Workspace admin OR org owner."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self.org_role(ws.organization_id) == "owner":
            return ws
        if self.workspace_role(workspace_id) != "admin":
            raise PermissionError403("Workspace admin access required")
        return ws

    def require_workspace_owner(self, workspace_id: uuid.UUID) -> Workspace:
        """Only the organization owner (e.g. delete/archive workspace)."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_owner(ws.organization_id)
        return ws

    # ---------- project scope ----------

    def get_project_or_404(self, project_id: uuid.UUID) -> Project:
        project = self.db.get(Project, project_id)
        if not project or project.deleted_at is not None:
            raise NotFound404("Project not found")
        return project

    def require_project_view(self, project_id: uuid.UUID) -> Project:
        """Project member, workspace admin, or org owner."""
        project = self.get_project_or_404(project_id)
        ws = self.get_workspace_or_404(project.workspace_id)
        self.require_org_member(ws.organization_id)
        if self.org_role(ws.organization_id) == "owner":
            return project
        if self.workspace_role(project.workspace_id) == "admin":
            return project
        if self.project_role(project_id) is None:
            raise NotFound404("Project not found")
        return project

    def require_project_edit(self, project_id: uuid.UUID) -> Project:
        """Can create/update tasks: project member (not viewer), ws admin, org owner."""
        project = self.require_project_view(project_id)
        role = self.project_role(project_id)
        if role == "viewer":
            ws_role = self.workspace_role(project.workspace_id)
            ws = self.get_workspace_or_404(project.workspace_id)
            if ws_role != "admin" and self.org_role(ws.organization_id) != "owner":
                raise PermissionError403("You have view-only access to this project")
        return project

    def require_project_admin(self, project_id: uuid.UUID) -> Project:
        """Manage project structure/settings: project admin, ws admin, org owner."""
        project = self.get_project_or_404(project_id)
        ws = self.get_workspace_or_404(project.workspace_id)
        self.require_org_member(ws.organization_id)
        if self.org_role(ws.organization_id) == "owner":
            return project
        if self.workspace_role(project.workspace_id) == "admin":
            return project
        if self.project_role(project_id) != "admin":
            raise PermissionError403("Project admin access required")
        return project

    # ---------- invites ----------

    def require_can_invite_to_workspace(self, workspace_id: uuid.UUID) -> Workspace:
        return self.require_workspace_admin(workspace_id)

    def require_can_invite_to_project(self, project_id: uuid.UUID) -> Project:
        return self.require_project_admin(project_id)

    # ---------- sprints ----------

    def require_sprint_manager(self, workspace_id: uuid.UUID, scrum_master_id: uuid.UUID | None) -> None:
        """Start/complete sprint: scrum master, workspace admin, or org owner."""
        if scrum_master_id is not None and scrum_master_id == self.user.id:
            ws = self.get_workspace_or_404(workspace_id)
            self.require_org_member(ws.organization_id)
            return
        self.require_workspace_admin(workspace_id)

    # ---------- accessible id sets (for websocket rooms / queries) ----------

    def accessible_workspace_ids(self) -> list[uuid.UUID]:
        owned_orgs = self.db.scalars(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == self.user.id,
                OrganizationMember.role == "owner",
            )
        ).all()
        ids: set[uuid.UUID] = set(
            self.db.scalars(
                select(WorkspaceMember.workspace_id).where(
                    WorkspaceMember.user_id == self.user.id
                )
            ).all()
        )
        if owned_orgs:
            ids |= set(
                self.db.scalars(
                    select(Workspace.id).where(
                        Workspace.organization_id.in_(owned_orgs),
                        Workspace.deleted_at.is_(None),
                    )
                ).all()
            )
        return list(ids)

    def accessible_project_ids(self) -> list[uuid.UUID]:
        direct = set(
            self.db.scalars(
                select(ProjectMember.project_id).where(ProjectMember.user_id == self.user.id)
            ).all()
        )
        admin_ws = self.db.scalars(
            select(WorkspaceMember.workspace_id).where(
                WorkspaceMember.user_id == self.user.id,
                WorkspaceMember.role == "admin",
            )
        ).all()
        owned_orgs = self.db.scalars(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == self.user.id,
                OrganizationMember.role == "owner",
            )
        ).all()
        ws_ids: set[uuid.UUID] = set(admin_ws)
        if owned_orgs:
            ws_ids |= set(
                self.db.scalars(
                    select(Workspace.id).where(Workspace.organization_id.in_(owned_orgs))
                ).all()
            )
        if ws_ids:
            direct |= set(
                self.db.scalars(
                    select(Project.id).where(
                        Project.workspace_id.in_(ws_ids), Project.deleted_at.is_(None)
                    )
                ).all()
            )
        return list(direct)
