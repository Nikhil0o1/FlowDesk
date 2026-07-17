"""Scoped RBAC permission checks.

Role resolution is always membership-based (organization_members,
workspace_members, project_members) — never a global role on the user.
Platform superadmin access is enforced at the route level via get_superadmin
and is limited to /admin/* routes only.
"""
import uuid

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.goal import Goal, GoalFolder, GoalFolderShareMember, GoalOwner, GoalShareMember
from app.models.organization import Organization, OrganizationMember
from app.models.project import Project, ProjectMember, Space, SpaceMember
from app.models.sprint import Sprint, SprintTask
from app.models.task import Task, TaskAssignee, TaskShareMember
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
        """Raw explicit ProjectMember role — None if no row."""
        member = self.db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == self.user.id,
            )
        )
        return member.role if member else None

    def effective_project_role(self, project_id: uuid.UUID) -> str | None:
        """Effective role after applying bypass rules.
        Org/workspace/space admins always resolve to 'admin' — a lower
        explicit ProjectMember role cannot override a higher-level admin grant."""
        project = self.db.get(Project, project_id)
        if not project:
            return None
        ws = self.db.get(Workspace, project.workspace_id)
        if ws:
            if self._is_org_admin_or_owner(ws.organization_id):
                return "admin"
            if self.workspace_role(project.workspace_id) in ("admin", "owner"):
                return "admin"
        if project.space_id and self._is_space_admin(project.space_id):
            return "admin"
        return self.project_role(project_id)

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

    def require_org_admin(self, org_id: uuid.UUID) -> str:
        """Org admin or owner — workspace/member management."""
        role = self.require_org_member(org_id)
        if role not in ("owner", "admin"):
            raise PermissionError403("Organization admin access required")
        return role

    def require_org_owner(self, org_id: uuid.UUID) -> str:
        """Org owner only — ownership transfer, org deletion."""
        role = self.require_org_member(org_id)
        if role != "owner":
            raise PermissionError403("Organization owner access required")
        return role

    def has_scoped_admin_role(self, org_id: uuid.UUID) -> bool:
        """True when the user is workspace, space, or non-personal project admin in the org.

        Personal List grants every member project-admin on their private list; that must not
        unlock Analytics, People directory, or other scoped-admin surfaces.
        """
        if self.db.scalar(
            select(WorkspaceMember.id)
            .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Workspace.deleted_at.is_(None),
                WorkspaceMember.user_id == self.user.id,
                WorkspaceMember.role.in_(("admin", "owner")),
            )
        ):
            return True
        if self.db.scalar(
            select(SpaceMember.id)
            .join(Space, Space.id == SpaceMember.space_id)
            .join(Workspace, Workspace.id == Space.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Space.deleted_at.is_(None),
                SpaceMember.user_id == self.user.id,
                SpaceMember.role == "admin",
            )
        ):
            return True
        return self.db.scalar(
            select(ProjectMember.id)
            .join(Project, Project.id == ProjectMember.project_id)
            .join(Workspace, Workspace.id == Project.workspace_id)
            .where(
                Workspace.organization_id == org_id,
                Project.deleted_at.is_(None),
                Project.is_archived.is_(False),
                Project.is_personal.is_(False),
                ProjectMember.user_id == self.user.id,
                ProjectMember.role == "admin",
            )
        ) is not None

    def require_people_directory_access(self, org_id: uuid.UUID) -> str:
        """Org leaders and scoped admins who manage people in their hierarchy."""
        role = self.require_org_member(org_id)
        if role in ("owner", "admin") or self.has_scoped_admin_role(org_id):
            return role
        raise PermissionError403("People management access required")

    def has_analytics_access(self, org_id: uuid.UUID) -> bool:
        """analytics:view — org owner/admin (whole org) or any scoped admin
        (workspace / space / non-personal project) within the org. Plain members
        and Personal List-only admins have no access."""
        role = self.org_role(org_id)
        if role is None:
            return False
        return role in ("owner", "admin") or self.has_scoped_admin_role(org_id)

    def require_analytics_access(self, org_id: uuid.UUID) -> str:
        """Enforce analytics:view on the organization scope."""
        role = self.require_org_member(org_id)
        if role in ("owner", "admin") or self.has_scoped_admin_role(org_id):
            return role
        raise PermissionError403("Analytics access required")

    # ---------- workspace scope ----------

    def get_workspace_or_404(self, workspace_id: uuid.UUID) -> Workspace:
        ws = self.db.get(Workspace, workspace_id)
        if not ws or ws.deleted_at is not None:
            raise NotFound404("Workspace not found")
        return ws

    def _is_org_admin_or_owner(self, org_id: uuid.UUID) -> bool:
        return self.org_role(org_id) in ("owner", "admin")

    def can_view_workspace(self, workspace_id: uuid.UUID) -> bool:
        ws = self.get_workspace_or_404(workspace_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return True
        return self.workspace_role(workspace_id) is not None

    def require_workspace_member(self, workspace_id: uuid.UUID) -> Workspace:
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return ws
        if self.workspace_role(workspace_id) is None:
            raise NotFound404("Workspace not found")
        return ws

    def require_workspace_admin(self, workspace_id: uuid.UUID) -> Workspace:
        """Workspace admin, org admin, or org owner."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return ws
        if self.workspace_role(workspace_id) not in ("admin", "owner"):
            raise PermissionError403("Workspace admin access required")
        return ws

    def require_workspace_people_manager(self, workspace_id: uuid.UUID) -> Workspace:
        """Assign existing people: workspace, space, or project admins (plus org leaders)."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return ws
        if self.workspace_role(workspace_id) in ("admin", "owner"):
            return ws
        if self.db.scalar(
            select(SpaceMember.space_id)
            .join(Space, Space.id == SpaceMember.space_id)
            .where(
                Space.workspace_id == workspace_id,
                Space.deleted_at.is_(None),
                SpaceMember.user_id == self.user.id,
                SpaceMember.role == "admin",
            )
            .limit(1)
        ):
            return ws
        if self.db.scalar(
            select(ProjectMember.project_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(
                Project.workspace_id == workspace_id,
                Project.deleted_at.is_(None),
                ProjectMember.user_id == self.user.id,
                ProjectMember.role == "admin",
            )
            .limit(1)
        ):
            return ws
        raise PermissionError403("People management access required")

    def require_workspace_owner(self, workspace_id: uuid.UUID) -> Workspace:
        """Org admin or owner (manage workspace settings, archive, delete)."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_admin(ws.organization_id)
        return ws

    # ---------- space scope ----------

    def get_space_or_404(self, space_id: uuid.UUID) -> Space:
        space = self.db.get(Space, space_id)
        if not space or space.deleted_at is not None:
            raise NotFound404("Space not found")
        return space

    def space_role(self, space_id: uuid.UUID) -> str | None:
        member = self.db.scalar(
            select(SpaceMember).where(
                SpaceMember.space_id == space_id,
                SpaceMember.user_id == self.user.id,
            )
        )
        return member.role if member else None

    def require_space_member(self, space_id: uuid.UUID) -> Space:
        """Org admin/owner or workspace admin bypass; else explicit space membership required."""
        space = self.get_space_or_404(space_id)
        ws = self.get_workspace_or_404(space.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return space
        if self.workspace_role(space.workspace_id) in ("admin", "owner"):
            return space
        if self.space_role(space_id) is None:
            raise NotFound404("Space not found")
        return space

    def require_space_admin(self, space_id: uuid.UUID) -> Space:
        """Org admin/owner or workspace admin bypass; else space admin role required."""
        space = self.get_space_or_404(space_id)
        ws = self.get_workspace_or_404(space.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return space
        if self.workspace_role(space.workspace_id) in ("admin", "owner"):
            return space
        if self.space_role(space_id) != "admin":
            raise PermissionError403("Space admin access required")
        return space

    def _is_space_admin(self, space_id: uuid.UUID) -> bool:
        return self.space_role(space_id) == "admin"

    # ---------- project scope ----------

    def get_project_or_404(self, project_id: uuid.UUID) -> Project:
        project = self.db.get(Project, project_id)
        if not project or project.deleted_at is not None:
            raise NotFound404("Project not found")
        return project

    def require_project_view(self, project_id: uuid.UUID) -> Project:
        """Project member, space admin, workspace admin, org admin, or org owner."""
        project = self.get_project_or_404(project_id)
        if project.is_personal:
            if project.personal_owner_id != self.user.id:
                raise NotFound404("Project not found")
            return project
        ws = self.get_workspace_or_404(project.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return project
        if self.workspace_role(project.workspace_id) in ("admin", "owner"):
            return project
        if project.space_id and self._is_space_admin(project.space_id):
            return project
        if self.project_role(project_id) is None:
            raise NotFound404("Project not found")
        return project

    def require_project_edit(self, project_id: uuid.UUID) -> Project:
        """Can create/update tasks: project member (not viewer), space/ws/org admin."""
        project = self.require_project_view(project_id)
        role = self.project_role(project_id)
        if role == "viewer":
            ws = self.get_workspace_or_404(project.workspace_id)
            ws_role = self.workspace_role(project.workspace_id)
            if (ws_role not in ("admin", "owner")
                    and not self._is_org_admin_or_owner(ws.organization_id)
                    and not (project.space_id and self._is_space_admin(project.space_id))):
                raise PermissionError403("You have view-only access to this project")
        return project

    def require_project_admin(self, project_id: uuid.UUID) -> Project:
        """Manage project structure/settings: project admin, space admin, ws admin, org admin/owner."""
        project = self.get_project_or_404(project_id)
        ws = self.get_workspace_or_404(project.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return project
        if self.workspace_role(project.workspace_id) in ("admin", "owner"):
            return project
        if project.space_id and self._is_space_admin(project.space_id):
            return project
        if self.project_role(project_id) != "admin":
            raise PermissionError403("Project admin access required")
        return project

    def require_explicit_project_admin(self, project_id: uuid.UUID) -> Project:
        """Manage project membership: explicit project admin role only (listed on the project)."""
        project = self.require_project_view(project_id)
        if self.project_role(project_id) != "admin":
            raise PermissionError403("Project admin access required")
        return project

    # ---------- task scope (per-task privacy ACL) ----------
    #
    # A task with is_private=False is "shared with the project" and follows the
    # normal project rules. A private task is visible only to its creator, the
    # users it's explicitly shared with (task_share_members) and its assignees.

    def _shared_with_me(self, task_id: uuid.UUID) -> TaskShareMember | None:
        return self.db.scalar(
            select(TaskShareMember).where(
                TaskShareMember.task_id == task_id,
                TaskShareMember.user_id == self.user.id,
            )
        )

    def _is_assignee(self, task_id: uuid.UUID) -> bool:
        return (
            self.db.scalar(
                select(TaskAssignee.id).where(
                    TaskAssignee.task_id == task_id, TaskAssignee.user_id == self.user.id
                ).limit(1)
            )
            is not None
        )

    def can_view_task(self, task: Task) -> bool:
        if not task.is_private:
            try:
                self.require_project_view(task.project_id)
                return True
            except (PermissionError403, NotFound404):
                return False
        if task.created_by == self.user.id:
            return True
        return self._shared_with_me(task.id) is not None or self._is_assignee(task.id)

    def require_task_view(self, task: Task) -> Task:
        if not self.can_view_task(task):
            raise NotFound404("Task not found")
        return task

    def require_task_edit(self, task: Task) -> Task:
        if not task.is_private:
            self.require_project_edit(task.project_id)
            return task
        if task.created_by == self.user.id:
            return task
        member = self._shared_with_me(task.id)
        if member and member.role == "editor":
            return task
        raise PermissionError403("You don't have edit access to this task")

    def require_task_admin(self, task: Task) -> Task:
        """Manage sharing/privacy/structure: the task creator or a project admin."""
        if task.created_by == self.user.id:
            return task
        self.require_project_admin(task.project_id)
        return task

    def require_can_manage_task_assignees(self, task: Task) -> Task:
        """Assign/unassign: project admin, task creator, or scrum master of an active sprint containing the task."""
        if task.created_by == self.user.id:
            return task
        try:
            self.require_project_admin(task.project_id)
            return task
        except PermissionError403:
            pass
        if self.is_scrum_master_of_active_sprint_for_task(task.id):
            return task
        raise PermissionError403("You don't have permission to change assignees on this task")

    def visible_task_filter(self):
        """SQLAlchemy condition for list queries — excludes private tasks not shared with me."""
        return or_(
            Task.is_private.is_(False),
            Task.created_by == self.user.id,
            Task.id.in_(select(TaskShareMember.task_id).where(TaskShareMember.user_id == self.user.id)),
            Task.id.in_(select(TaskAssignee.task_id).where(TaskAssignee.user_id == self.user.id)),
        )

    # ---------- invites ----------

    def require_can_invite_to_workspace(self, workspace_id: uuid.UUID) -> Workspace:
        return self.require_workspace_admin(workspace_id)

    def require_can_invite_to_project(self, project_id: uuid.UUID) -> Project:
        """Workspace/space/project admins may invite to projects they manage."""
        return self.require_project_admin(project_id)

    # ---------- sprints ----------

    def require_sprint_manager(
        self,
        workspace_id: uuid.UUID,
        scrum_master_id: uuid.UUID | None,
        delegate_scrum_master_id: uuid.UUID | None = None,
    ) -> None:
        """Start/complete sprint: scrum master, delegate, workspace admin, or org owner."""
        if self._is_sprint_facilitator(scrum_master_id, delegate_scrum_master_id):
            ws = self.get_workspace_or_404(workspace_id)
            self.require_org_member(ws.organization_id)
            return
        self.require_workspace_admin(workspace_id)

    def _is_sprint_facilitator(
        self,
        scrum_master_id: uuid.UUID | None,
        delegate_scrum_master_id: uuid.UUID | None = None,
    ) -> bool:
        return (
            (scrum_master_id is not None and scrum_master_id == self.user.id)
            or (delegate_scrum_master_id is not None and delegate_scrum_master_id == self.user.id)
        )

    def require_sprint_scope_edit(self, sprint: Sprint) -> Sprint:
        """Add/remove/move sprint tasks. When scope is locked during an active sprint, SM/delegate only."""
        if sprint.status == "active" and sprint.scope_locked:
            if not self._is_sprint_facilitator(sprint.scrum_master_id, sprint.delegate_scrum_master_id):
                raise PermissionError403(
                    "Sprint scope is locked — only the scrum master can add or remove tasks"
                )
            ws = self.get_workspace_or_404(sprint.workspace_id)
            self.require_org_member(ws.organization_id)
            return sprint
        self.require_sprint_manager(
            sprint.workspace_id, sprint.scrum_master_id, sprint.delegate_scrum_master_id
        )
        return sprint

    def require_can_follow_up_standup_blocker(self, sprint: Sprint) -> Sprint:
        """Follow up on a standup blocker: active-sprint scrum master/delegate or admin."""
        if sprint.status != "active":
            raise PermissionError403("Follow-up is only available during an active sprint")
        ws = self.get_workspace_or_404(sprint.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_sprint_facilitator(sprint.scrum_master_id, sprint.delegate_scrum_master_id):
            return sprint
        if self._is_org_admin_or_owner(ws.organization_id):
            return sprint
        if self.workspace_role(sprint.workspace_id) in ("admin", "owner"):
            return sprint
        if sprint.project_id:
            try:
                self.require_project_admin(sprint.project_id)
                return sprint
            except PermissionError403:
                pass
        raise PermissionError403("Only scrum master or admins can follow up on standup blockers")

    def can_manage_sprint_retrospective_item(self, sprint: Sprint, author_id: uuid.UUID) -> bool:
        """Author, sprint facilitator, or workspace/org admin may edit/delete a retro item."""
        if author_id == self.user.id:
            return True
        if self._is_sprint_facilitator(sprint.scrum_master_id, sprint.delegate_scrum_master_id):
            return True
        ws = self.get_workspace_or_404(sprint.workspace_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return True
        return self.workspace_role(sprint.workspace_id) in ("admin", "owner")

    def require_can_manage_sprint_retrospective_item(
        self, sprint: Sprint, author_id: uuid.UUID
    ) -> None:
        if not self.can_manage_sprint_retrospective_item(sprint, author_id):
            raise PermissionError403(
                "Only the author, scrum master, or admins can modify this retrospective item"
            )

    def is_scrum_master_of_active_sprint_for_task(self, task_id: uuid.UUID) -> bool:
        """True when the user facilitates an active sprint that contains this task."""
        row = self.db.scalar(
            select(Sprint.id)
            .join(SprintTask, SprintTask.sprint_id == Sprint.id)
            .where(
                SprintTask.task_id == task_id,
                Sprint.status == "active",
                or_(
                    Sprint.scrum_master_id == self.user.id,
                    Sprint.delegate_scrum_master_id == self.user.id,
                ),
                Sprint.deleted_at.is_(None),
            )
            .limit(1)
        )
        return row is not None

    def require_can_set_sprint_task_story_points(self, task: Task) -> Task:
        """Set story points: scrum master/delegate of a planned or active sprint containing the task."""
        row = self.db.scalar(
            select(Sprint.id)
            .join(SprintTask, SprintTask.sprint_id == Sprint.id)
            .where(
                SprintTask.task_id == task.id,
                Sprint.status.in_(("planned", "active")),
                or_(
                    Sprint.scrum_master_id == self.user.id,
                    Sprint.delegate_scrum_master_id == self.user.id,
                ),
                Sprint.deleted_at.is_(None),
            )
            .limit(1)
        )
        if not row:
            raise PermissionError403(
                "Only the scrum master can set story points on tasks in their sprint"
            )
        self.require_project_view(task.project_id)
        return task

    # ---------- accessible id sets (for websocket rooms / queries) ----------

    def accessible_workspace_ids(self) -> list[uuid.UUID]:
        admin_orgs = self.db.scalars(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == self.user.id,
                OrganizationMember.role.in_(("owner", "admin")),
            )
        ).all()
        ids: set[uuid.UUID] = set(
            self.db.scalars(
                select(WorkspaceMember.workspace_id).where(
                    WorkspaceMember.user_id == self.user.id
                )
            ).all()
        )
        if admin_orgs:
            ids |= set(
                self.db.scalars(
                    select(Workspace.id).where(
                        Workspace.organization_id.in_(admin_orgs),
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
                WorkspaceMember.role.in_(("admin", "owner")),
            )
        ).all()
        admin_orgs = self.db.scalars(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == self.user.id,
                OrganizationMember.role.in_(("owner", "admin")),
            )
        ).all()
        ws_ids: set[uuid.UUID] = set(admin_ws)
        if admin_orgs:
            ws_ids |= set(
                self.db.scalars(
                    select(Workspace.id).where(Workspace.organization_id.in_(admin_orgs))
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
        # Space admins see all projects within their spaces
        admin_spaces = self.db.scalars(
            select(SpaceMember.space_id).where(
                SpaceMember.user_id == self.user.id,
                SpaceMember.role == "admin",
            )
        ).all()
        if admin_spaces:
            direct |= set(
                self.db.scalars(
                    select(Project.id).where(
                        Project.space_id.in_(admin_spaces), Project.deleted_at.is_(None)
                    )
                ).all()
            )
        direct |= set(
            self.db.scalars(
                select(Project.id).where(
                    Project.is_personal.is_(True),
                    Project.personal_owner_id == self.user.id,
                    Project.deleted_at.is_(None),
                )
            ).all()
        )
        return list(direct)

    def accessible_space_ids(self) -> list[uuid.UUID]:
        """Spaces the user may see: explicit space membership, spaces that contain a
        project they belong to, plus every space in workspaces/orgs they administer.
        A plain project member sees only the space(s) holding their project(s)."""
        ids: set[uuid.UUID] = set(
            self.db.scalars(
                select(SpaceMember.space_id).where(SpaceMember.user_id == self.user.id)
            ).all()
        )
        ids |= set(
            self.db.scalars(
                select(Project.space_id)
                .join(ProjectMember, ProjectMember.project_id == Project.id)
                .where(
                    ProjectMember.user_id == self.user.id,
                    Project.deleted_at.is_(None),
                    Project.space_id.is_not(None),
                )
            ).all()
        )
        admin_ws: set[uuid.UUID] = set(
            self.db.scalars(
                select(WorkspaceMember.workspace_id).where(
                    WorkspaceMember.user_id == self.user.id,
                    WorkspaceMember.role.in_(("admin", "owner")),
                )
            ).all()
        )
        admin_orgs = self.db.scalars(
            select(OrganizationMember.organization_id).where(
                OrganizationMember.user_id == self.user.id,
                OrganizationMember.role.in_(("owner", "admin")),
            )
        ).all()
        if admin_orgs:
            admin_ws |= set(
                self.db.scalars(
                    select(Workspace.id).where(
                        Workspace.organization_id.in_(admin_orgs),
                        Workspace.deleted_at.is_(None),
                    )
                ).all()
            )
        if admin_ws:
            ids |= set(
                self.db.scalars(
                    select(Space.id).where(
                        Space.workspace_id.in_(admin_ws), Space.deleted_at.is_(None)
                    )
                ).all()
            )
        return list(ids)

    # ---------- goal scope ----------

    def has_goals_section_access(self, workspace_id: uuid.UUID) -> bool:
        """Goals nav + list: org/workspace/space/non-personal project admins — not plain members."""
        try:
            self.require_goal_initiator(workspace_id)
            return True
        except (PermissionError403, NotFound404):
            return False

    def require_goals_section_access(self, workspace_id: uuid.UUID) -> Workspace:
        """Enforce access to the Goals section (list/create entry points)."""
        return self.require_goal_initiator(workspace_id)

    def can_view_all_goals(self, workspace_id: uuid.UUID) -> bool:
        """Org owner/admin see every goal in the workspace."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        return self._is_org_admin_or_owner(ws.organization_id)

    def _is_goal_share_member(self, goal_id: uuid.UUID) -> bool:
        return (
            self.db.scalar(
                select(GoalShareMember.id).where(
                    GoalShareMember.goal_id == goal_id,
                    GoalShareMember.user_id == self.user.id,
                ).limit(1)
            )
            is not None
        )

    def can_view_goal(self, goal: Goal) -> bool:
        """Org admin, owner, creator, share member, folder share, or workspace-public + section access."""
        ws = self.get_workspace_or_404(goal.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return True
        if goal.owner_id == self.user.id or goal.created_by == self.user.id:
            return True
        if self._is_goal_owner(goal.id):
            return True
        if self._is_goal_share_member(goal.id):
            return True
        if goal.folder_id and self._is_goal_folder_share_member(goal.folder_id):
            return True
        if not goal.is_private and self.has_goals_section_access(goal.workspace_id):
            return True
        return False

    def has_explicit_goal_access(self, workspace_id: uuid.UUID) -> bool:
        """Goals reachable via share, ownership, or folder membership — without section admin."""
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self.db.scalar(
            select(Goal.id).where(
                Goal.workspace_id == workspace_id,
                Goal.deleted_at.is_(None),
                or_(Goal.owner_id == self.user.id, Goal.created_by == self.user.id),
            ).limit(1)
        ):
            return True
        if self.db.scalar(
            select(GoalOwner.id)
            .join(Goal, Goal.id == GoalOwner.goal_id)
            .where(
                Goal.workspace_id == workspace_id,
                Goal.deleted_at.is_(None),
                GoalOwner.user_id == self.user.id,
            )
            .limit(1)
        ):
            return True
        if self.db.scalar(
            select(GoalShareMember.id)
            .join(Goal, Goal.id == GoalShareMember.goal_id)
            .where(
                Goal.workspace_id == workspace_id,
                Goal.deleted_at.is_(None),
                GoalShareMember.user_id == self.user.id,
            )
            .limit(1)
        ):
            return True
        if self.db.scalar(
            select(GoalFolderShareMember.id)
            .join(GoalFolder, GoalFolder.id == GoalFolderShareMember.folder_id)
            .where(
                GoalFolder.workspace_id == workspace_id,
                GoalFolderShareMember.user_id == self.user.id,
            )
            .limit(1)
        ):
            return True
        if self.db.scalar(
            select(GoalFolder.id).where(
                GoalFolder.workspace_id == workspace_id,
                GoalFolder.created_by == self.user.id,
            ).limit(1)
        ):
            return True
        return False

    def can_access_goals(self, workspace_id: uuid.UUID) -> bool:
        """Goals section nav/list entry: section admin, org-wide view, or explicit goal access."""
        if self.can_view_all_goals(workspace_id):
            return True
        if self.has_goals_section_access(workspace_id):
            return True
        return self.has_explicit_goal_access(workspace_id)

    def _is_goal_owner(self, goal_id: uuid.UUID) -> bool:
        return (
            self.db.scalar(
                select(GoalOwner.id).where(
                    GoalOwner.goal_id == goal_id,
                    GoalOwner.user_id == self.user.id,
                ).limit(1)
            )
            is not None
        )

    def require_goal_initiator(self, workspace_id: uuid.UUID) -> Workspace:
        """Goals section/create: org/ws/space admin, or project admin on a non-personal project.

        Personal List grants every member project-admin on their private list; that must not
        unlock workspace Goals visibility or creation.
        """
        ws = self.get_workspace_or_404(workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return ws
        if self.workspace_role(workspace_id) in ("admin", "owner"):
            return ws
        if self.db.scalar(
            select(SpaceMember.space_id)
            .join(Space, Space.id == SpaceMember.space_id)
            .where(
                Space.workspace_id == workspace_id,
                Space.deleted_at.is_(None),
                SpaceMember.user_id == self.user.id,
                SpaceMember.role == "admin",
            )
            .limit(1)
        ):
            return ws
        if self.db.scalar(
            select(ProjectMember.project_id)
            .join(Project, Project.id == ProjectMember.project_id)
            .where(
                Project.workspace_id == workspace_id,
                Project.deleted_at.is_(None),
                Project.is_personal.is_(False),
                ProjectMember.user_id == self.user.id,
                ProjectMember.role == "admin",
            )
            .limit(1)
        ):
            return ws
        raise PermissionError403("Goals access required")

    def require_goal_view(self, goal: Goal) -> Goal:
        """View a goal when permitted by ownership, share, or workspace visibility."""
        if not self.can_view_goal(goal):
            raise NotFound404("Goal not found")
        return goal

    def apply_goals_list_filter(self, workspace_id: uuid.UUID, query):
        """Org leaders see all; others see owned/created/shared/folder-shared (+ workspace-public for section admins)."""
        if self.can_view_all_goals(workspace_id):
            return query
        shared_goal_ids = select(GoalShareMember.goal_id).where(GoalShareMember.user_id == self.user.id)
        owned_goal_ids = select(GoalOwner.goal_id).where(GoalOwner.user_id == self.user.id)
        shared_folder_ids = select(GoalFolderShareMember.folder_id).where(
            GoalFolderShareMember.user_id == self.user.id
        )
        explicit = or_(
            Goal.owner_id == self.user.id,
            Goal.created_by == self.user.id,
            Goal.id.in_(owned_goal_ids),
            Goal.id.in_(shared_goal_ids),
            Goal.folder_id.in_(shared_folder_ids),
        )
        if self.has_goals_section_access(workspace_id):
            return query.where(or_(explicit, Goal.is_private.is_(False)))
        return query.where(explicit)

    def require_goal_manage(self, goal: Goal) -> Goal:
        """Edit/delete goals and targets: owner, creator, share editor, or scoped admin."""
        if not self.can_view_goal(goal):
            raise NotFound404("Goal not found")
        if goal.owner_id == self.user.id or goal.created_by == self.user.id:
            return goal
        if self._is_goal_owner(goal.id):
            return goal
        share = self.db.scalar(
            select(GoalShareMember).where(
                GoalShareMember.goal_id == goal.id,
                GoalShareMember.user_id == self.user.id,
            )
        )
        if share and share.role == "editor":
            return goal
        self.require_goal_initiator(goal.workspace_id)
        return goal

    def require_goal_share_manage(self, goal: Goal) -> Goal:
        """Sharing settings: owner, creator, or scoped admin."""
        if not self.can_view_goal(goal):
            raise NotFound404("Goal not found")
        if goal.owner_id == self.user.id or goal.created_by == self.user.id:
            return goal
        if self._is_goal_owner(goal.id):
            return goal
        self.require_goal_initiator(goal.workspace_id)
        return goal

    def _is_goal_folder_share_member(self, folder_id: uuid.UUID) -> bool:
        return (
            self.db.scalar(
                select(GoalFolderShareMember.id).where(
                    GoalFolderShareMember.folder_id == folder_id,
                    GoalFolderShareMember.user_id == self.user.id,
                ).limit(1)
            )
            is not None
        )

    def can_view_goal_folder(self, folder: GoalFolder) -> bool:
        ws = self.get_workspace_or_404(folder.workspace_id)
        self.require_org_member(ws.organization_id)
        if self._is_org_admin_or_owner(ws.organization_id):
            return True
        if folder.created_by == self.user.id:
            return True
        if self._is_goal_folder_share_member(folder.id):
            return True
        if not folder.is_private and self.has_goals_section_access(folder.workspace_id):
            return True
        return False

    def require_goal_folder_view(self, folder: GoalFolder) -> GoalFolder:
        if not self.can_view_goal_folder(folder):
            raise NotFound404("Folder not found")
        return folder

    def require_goal_folder_manage(self, folder: GoalFolder) -> GoalFolder:
        """Folder update/delete/archive: creator, share editor, or Goals-scoped admin."""
        if not self.can_view_goal_folder(folder):
            raise NotFound404("Folder not found")
        if folder.created_by == self.user.id:
            return folder
        share = self.db.scalar(
            select(GoalFolderShareMember).where(
                GoalFolderShareMember.folder_id == folder.id,
                GoalFolderShareMember.user_id == self.user.id,
            )
        )
        if share and share.role == "editor":
            return folder
        self.require_goal_initiator(folder.workspace_id)
        return folder

    def require_goal_folder_share_manage(self, folder: GoalFolder) -> GoalFolder:
        if not self.can_view_goal_folder(folder):
            raise NotFound404("Folder not found")
        if folder.created_by == self.user.id:
            return folder
        self.require_goal_initiator(folder.workspace_id)
        return folder

    def apply_goal_folders_list_filter(self, workspace_id: uuid.UUID, query):
        """Org leaders/section admins see non-private + own/shared; apply after workspace scope."""
        if self.can_view_all_goals(workspace_id):
            return query
        if not self.has_goals_section_access(workspace_id):
            shared_ids = select(GoalFolderShareMember.folder_id).where(
                GoalFolderShareMember.user_id == self.user.id
            )
            return query.where(
                or_(
                    GoalFolder.created_by == self.user.id,
                    GoalFolder.id.in_(shared_ids),
                )
            )
        shared_ids = select(GoalFolderShareMember.folder_id).where(
            GoalFolderShareMember.user_id == self.user.id
        )
        return query.where(
            or_(
                GoalFolder.created_by == self.user.id,
                GoalFolder.id.in_(shared_ids),
                GoalFolder.is_private.is_(False),
            )
        )
