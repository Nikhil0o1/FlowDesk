"""Capture live Spaces/Projects into template snapshots and rebuild them on apply.

A snapshot is a plain JSON dict stored on ``WorkspaceTemplate.payload``. It is
intentionally free of absolute dates, assignees and IDs so a template is portable
across spaces and workspaces."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.custom_field import CustomFieldDefinition
from app.models.project import Project, ProjectMember, Space, SpaceMember, TaskList
from app.models.task import CustomStatus, Task

# Mirrors the defaults used when creating a fresh project.
DEFAULT_STATUSES = [
    {"name": "To Do", "color": "#87909E", "category": "todo", "position": 0},
    {"name": "In Progress", "color": "#5B9FF0", "category": "in_progress", "position": 1},
    {"name": "Complete", "color": "#6BC950", "category": "done", "position": 2},
]


# --------------------------------------------------------------------------- #
# Snapshot (capture)                                                          #
# --------------------------------------------------------------------------- #

def snapshot_project(db: Session, project: Project, include_tasks: bool = True) -> dict:
    statuses = db.scalars(
        select(CustomStatus).where(CustomStatus.project_id == project.id).order_by(CustomStatus.position)
    ).all()
    fields = db.scalars(
        select(CustomFieldDefinition)
        .where(CustomFieldDefinition.project_id == project.id)
        .order_by(CustomFieldDefinition.position)
    ).all()
    lists = db.scalars(
        select(TaskList)
        .where(TaskList.project_id == project.id, TaskList.deleted_at.is_(None))
        .order_by(TaskList.position)
    ).all()

    payload: dict = {
        "name": project.name,
        "description": project.description,
        "color": project.color,
        "icon": project.icon,
        "statuses": [
            {"name": s.name, "color": s.color, "category": s.category, "position": s.position}
            for s in statuses
        ],
        "custom_fields": [
            {"name": f.name, "field_type": f.field_type, "options": f.options, "position": f.position}
            for f in fields
        ],
        "lists": [{"name": tl.name, "position": tl.position} for tl in lists],
        "tasks": [],
    }

    if include_tasks:
        tasks = db.scalars(
            select(Task)
            .where(Task.project_id == project.id, Task.deleted_at.is_(None), Task.is_archived.is_(False))
            .order_by(Task.position)
        ).all()
        status_name_by_id = {s.id: s.name for s in statuses}
        list_name_by_id = {tl.id: tl.name for tl in lists}
        for t in tasks:
            payload["tasks"].append({
                "tid": str(t.id),
                "parent_tid": str(t.parent_task_id) if t.parent_task_id else None,
                "title": t.title,
                "description": t.description,
                "priority": t.priority,
                "task_type": t.task_type,
                "status_name": status_name_by_id.get(t.status_id),
                "list_name": list_name_by_id.get(t.list_id),
                "position": t.position,
                "labels": t.labels or [],
                "story_points": t.story_points,
                "time_estimate_seconds": t.time_estimate_seconds,
            })
    return payload


def snapshot_space(db: Session, space: Space, include_tasks: bool = True) -> dict:
    projects = db.scalars(
        select(Project)
        .where(Project.space_id == space.id, Project.deleted_at.is_(None), Project.is_archived.is_(False))
        .order_by(Project.position)
    ).all()
    return {
        "name": space.name,
        "color": space.color,
        "icon": space.icon,
        "projects": [snapshot_project(db, p, include_tasks) for p in projects],
    }


def summarize(payload: dict, kind: str) -> dict:
    """Counts shown in the template "Template includes" panel."""
    if kind == "space":
        projects = payload.get("projects", [])
        return {
            "projects": len(projects),
            "statuses": sum(len(p.get("statuses", [])) for p in projects),
            "custom_fields": sum(len(p.get("custom_fields", [])) for p in projects),
            "lists": sum(len(p.get("lists", [])) for p in projects),
            "tasks": sum(len(p.get("tasks", [])) for p in projects),
        }
    return {
        "projects": 0,
        "statuses": len(payload.get("statuses", [])),
        "custom_fields": len(payload.get("custom_fields", [])),
        "lists": len(payload.get("lists", [])),
        "tasks": len(payload.get("tasks", [])),
    }


# --------------------------------------------------------------------------- #
# Apply (rebuild)                                                             #
# --------------------------------------------------------------------------- #

def apply_project_payload(
    db: Session,
    payload: dict,
    *,
    space_id: uuid.UUID,
    workspace_id: uuid.UUID,
    name: str,
    user_id: uuid.UUID,
    add_creator_as_admin: bool = True,
) -> Project:
    project = Project(
        space_id=space_id,
        workspace_id=workspace_id,
        name=name,
        description=payload.get("description"),
        color=payload.get("color") or "#9B59B6",
        icon=payload.get("icon"),
        created_by=user_id,
    )
    db.add(project)
    db.flush()

    if add_creator_as_admin:
        db.add(ProjectMember(project_id=project.id, user_id=user_id, role="admin"))

    # Statuses (fall back to defaults if the snapshot somehow has none).
    status_specs = payload.get("statuses") or DEFAULT_STATUSES
    status_id_by_name: dict[str, uuid.UUID] = {}
    for spec in status_specs:
        st = CustomStatus(
            project_id=project.id,
            name=spec["name"],
            color=spec.get("color", "#87909E"),
            category=spec.get("category", "todo"),
            position=spec.get("position", 0),
        )
        db.add(st)
        db.flush()
        status_id_by_name[st.name] = st.id

    # Custom fields.
    for spec in payload.get("custom_fields", []):
        db.add(CustomFieldDefinition(
            project_id=project.id,
            name=spec["name"],
            field_type=spec.get("field_type", "text"),
            options=spec.get("options", []),
            position=spec.get("position", 0),
            created_by=user_id,
        ))

    # Lists (always guarantee at least one).
    list_specs = payload.get("lists") or [{"name": "Tasks", "position": 0}]
    list_id_by_name: dict[str, uuid.UUID] = {}
    for spec in list_specs:
        tl = TaskList(project_id=project.id, name=spec["name"], position=spec.get("position", 0), created_by=user_id)
        db.add(tl)
        db.flush()
        list_id_by_name[tl.name] = tl.id
    default_list_id = next(iter(list_id_by_name.values()), None)

    # Tasks — two passes so subtasks can reference their parent.
    task_specs = payload.get("tasks", [])
    new_id_by_tid: dict[str, uuid.UUID] = {}
    number = 1
    # First pass: create every task (parent linked in second pass).
    created: list[tuple[Task, dict]] = []
    for spec in task_specs:
        t = Task(
            project_id=project.id,
            list_id=list_id_by_name.get(spec.get("list_name")) or default_list_id,
            number=number,
            title=spec.get("title") or "Untitled",
            description=spec.get("description"),
            priority=spec.get("priority"),
            task_type=spec.get("task_type", "task"),
            status_id=status_id_by_name.get(spec.get("status_name")),
            position=spec.get("position", number),
            labels=spec.get("labels", []),
            story_points=spec.get("story_points"),
            time_estimate_seconds=(
                spec.get("time_estimate_seconds")
                if spec.get("time_estimate_seconds") is not None
                else (
                    int(spec["time_estimate_minutes"]) * 60
                    if spec.get("time_estimate_minutes") is not None
                    else None
                )
            ),
            created_by=user_id,
        )
        db.add(t)
        db.flush()
        if spec.get("tid"):
            new_id_by_tid[spec["tid"]] = t.id
        created.append((t, spec))
        number += 1
    # Second pass: resolve parents.
    for t, spec in created:
        parent_tid = spec.get("parent_tid")
        if parent_tid and parent_tid in new_id_by_tid:
            t.parent_task_id = new_id_by_tid[parent_tid]
    project.next_task_number = number

    return project


def apply_space_payload(
    db: Session,
    payload: dict,
    *,
    workspace_id: uuid.UUID,
    name: str,
    user_id: uuid.UUID,
    add_space_member: bool = True,
) -> Space:
    space = Space(
        workspace_id=workspace_id,
        name=name,
        color=payload.get("color") or "#4F8BFF",
        icon=payload.get("icon"),
        created_by=user_id,
    )
    db.add(space)
    db.flush()
    # Org/workspace admins bypass membership, so the caller may skip this (mirrors create_space).
    if add_space_member:
        db.add(SpaceMember(space_id=space.id, user_id=user_id, role="admin"))

    for proj_payload in payload.get("projects", []):
        apply_project_payload(
            db,
            proj_payload,
            space_id=space.id,
            workspace_id=workspace_id,
            name=proj_payload.get("name") or "Project",
            user_id=user_id,
            add_creator_as_admin=True,
        )
    return space
