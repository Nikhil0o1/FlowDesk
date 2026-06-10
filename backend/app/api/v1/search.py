import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.comment import Comment
from app.models.organization import OrganizationMember
from app.models.project import Project
from app.models.task import Task
from app.models.user import Profile, User
from app.schemas.task import TaskOut
from app.schemas.project import ProjectOut
from app.schemas.user import UserBrief
from app.services import task_service
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


@router.get("", response_model=SearchResults)
def global_search(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(8, ge=1, le=25),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Global search across tasks, projects, comments and users — scoped to access."""
    accessible_projects = perms.accessible_project_ids()
    like = f"%{q}%"
    results = SearchResults()

    if accessible_projects:
        tasks = db.scalars(
            select(Task)
            .where(
                Task.project_id.in_(accessible_projects),
                Task.deleted_at.is_(None),
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
                or_(Project.name.ilike(like), Project.key.ilike(like)),
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

    # Users: anyone sharing an organization with me
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
