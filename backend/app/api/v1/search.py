import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.pat_route_registry import pat_allow
from app.db.session import get_db
from app.models.comment import Comment
from app.models.goal import Goal, GoalFolder
from app.models.organization import OrganizationMember
from app.models.project import Project
from app.models.task import Task
from app.models.user import Profile, User
from app.schemas.goal import GoalFolderOut, GoalOut
from app.schemas.project import ProjectOut
from app.schemas.task import TaskOut
from app.schemas.user import UserBrief
from app.services import goal_service, task_service
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(prefix="/search", tags=["search"])


class CommentHit(BaseModel):
    comment_id: uuid.UUID
    task_id: uuid.UUID
    task_title: str
    excerpt: str
    author: UserBrief | None = None


class SearchResults(BaseModel):
    tasks: list[TaskOut] = []
    projects: list[ProjectOut] = []
    comments: list[CommentHit] = []
    users: list[UserBrief] = []
    goals: list[GoalOut] = []
    goal_folders: list[GoalFolderOut] = []


@router.get("", response_model=SearchResults)
@pat_allow(
    "search:read",
    rate_category="expensive_read",
    authz_class="principal",
    tenant_resolution="Results filtered by PermissionService visibility",
)
def global_search(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(8, ge=1, le=25),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Global search across tasks, projects, comments, users, goals and folders."""
    accessible_projects = perms.accessible_project_ids()
    like = f"%{q}%"
    results = SearchResults()

    if accessible_projects:
        tasks = db.scalars(
            select(Task)
            .where(
                Task.project_id.in_(accessible_projects),
                Task.deleted_at.is_(None),
                perms.visible_task_filter(),
                or_(Task.title.ilike(like), Task.description.ilike(like)),
            )
            .order_by(Task.updated_at.desc())
            .limit(limit)
        ).all()
        by_project: dict[uuid.UUID, list[Task]] = {}
        for t in tasks:
            by_project.setdefault(t.project_id, []).append(t)
        ordered = {t.id: i for i, t in enumerate(tasks)}
        outs = []
        for pid, ts in by_project.items():
            project = db.get(Project, pid)
            outs.extend(task_service.build_task_outs(db, project, ts))
        outs.sort(key=lambda o: ordered.get(o.id, 0))
        results.tasks = outs

        projects = db.scalars(
            select(Project)
            .where(
                Project.id.in_(accessible_projects),
                Project.deleted_at.is_(None),
                Project.name.ilike(like),
            )
            .limit(limit)
        ).all()
        results.projects = [ProjectOut.model_validate(p) for p in projects]

        comment_rows = db.execute(
            select(Comment, Task.title)
            .join(Task, Task.id == Comment.task_id)
            .where(
                Task.project_id.in_(accessible_projects),
                Task.deleted_at.is_(None),
                perms.visible_task_filter(),
                Comment.deleted_at.is_(None),
                Comment.body.ilike(like),
            )
            .order_by(Comment.created_at.desc())
            .limit(limit)
        ).all()
        briefs = user_briefs(db, [c.author_id for c, _ in comment_rows])
        for comment, task_title in comment_rows:
            body = comment.body
            idx = body.lower().find(q.lower())
            start = max(0, idx - 40)
            excerpt = ("…" if start > 0 else "") + body[start : start + 160]
            results.comments.append(
                CommentHit(
                    comment_id=comment.id,
                    task_id=comment.task_id,
                    task_title=task_title,
                    excerpt=excerpt,
                    author=briefs.get(comment.author_id),
                )
            )

    for ws_id in perms.accessible_workspace_ids():
        if (
            not perms.has_goals_section_access(ws_id)
            and not perms.can_view_all_goals(ws_id)
            and not perms.has_explicit_goal_access(ws_id)
        ):
            continue
        gq = select(Goal).where(
            Goal.workspace_id == ws_id,
            Goal.deleted_at.is_(None),
            or_(Goal.name.ilike(like), Goal.description.ilike(like)),
        )
        gq = perms.apply_goals_list_filter(ws_id, gq)
        for goal in db.scalars(gq.order_by(Goal.updated_at.desc()).limit(limit)).all():
            results.goals.append(goal_service.goal_out(db, goal))

        fq = select(GoalFolder).where(
            GoalFolder.workspace_id == ws_id,
            GoalFolder.is_archived.is_(False),
            or_(GoalFolder.name.ilike(like), GoalFolder.description.ilike(like)),
        )
        fq = perms.apply_goal_folders_list_filter(ws_id, fq)
        for folder in db.scalars(fq.order_by(GoalFolder.updated_at.desc()).limit(limit)).all():
            results.goal_folders.append(goal_service.folder_out(db, folder))

    results.goals = results.goals[:limit]
    results.goal_folders = results.goal_folders[:limit]

    my_orgs = select(OrganizationMember.organization_id).where(
        OrganizationMember.user_id == perms.user.id
    )
    shared_user_ids = select(OrganizationMember.user_id).where(
        OrganizationMember.organization_id.in_(my_orgs)
    )
    users = db.execute(
        select(User.id, User.email, Profile.full_name, Profile.avatar_url)
        .outerjoin(Profile, Profile.user_id == User.id)
        .where(
            User.id.in_(shared_user_ids),
            User.is_active.is_(True),
            User.deleted_at.is_(None),
            or_(User.email.ilike(like), Profile.full_name.ilike(like)),
        )
        .limit(limit)
    ).all()
    results.users = [
        UserBrief(id=r.id, email=r.email, full_name=r.full_name or "", avatar_url=r.avatar_url)
        for r in users
    ]
    return results
