"""Per-user private Personal List project (ClickUp-style)."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.project import Project, ProjectMember, TaskList
from app.models.task import CustomStatus

DEFAULT_STATUSES = [
    ("To Do", "#87909E", "todo", 0),
    ("In Progress", "#5B9FF0", "in_progress", 1),
    ("Complete", "#4CB782", "done", 2),
]

PERSONAL_PROJECT_NAME = "Personal List"
PERSONAL_PROJECT_COLOR = "#7B68EE"
PERSONAL_LIST_NAME = "Personal List"


def get_personal_project(
    db: Session, *, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> Project | None:
    return db.scalar(
        select(Project).where(
            Project.workspace_id == workspace_id,
            Project.is_personal.is_(True),
            Project.personal_owner_id == user_id,
            Project.deleted_at.is_(None),
        )
    )


def get_or_create_personal_project(
    db: Session, *, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> Project:
    existing = get_personal_project(db, workspace_id=workspace_id, user_id=user_id)
    if existing:
        return existing

    project = Project(
        workspace_id=workspace_id,
        space_id=None,
        name=PERSONAL_PROJECT_NAME,
        color=PERSONAL_PROJECT_COLOR,
        icon="lock",
        created_by=user_id,
        is_personal=True,
        personal_owner_id=user_id,
    )
    db.add(project)
    db.flush()
    db.add(ProjectMember(project_id=project.id, user_id=user_id, role="admin"))
    for name, color, category, position in DEFAULT_STATUSES:
        db.add(
            CustomStatus(
                project_id=project.id,
                name=name,
                color=color,
                category=category,
                position=position,
            )
        )
    db.add(
        TaskList(
            project_id=project.id,
            name=PERSONAL_LIST_NAME,
            position=0,
            created_by=user_id,
        )
    )
    db.commit()
    db.refresh(project)
    return project
