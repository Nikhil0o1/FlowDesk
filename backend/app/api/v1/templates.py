import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.project import Space
from app.models.template import WorkspaceTemplate
from app.models.workspace import Workspace
from app.schemas.common import Message
from app.schemas.template import (
    TemplateApplyPayloadRequest,
    TemplateApplyRequest,
    TemplateApplyResult,
    TemplateIncludes,
    TemplateOut,
    TemplateSaveRequest,
    TemplateUpdateRequest,
)
from app.services import template_service
from app.services.activity_service import log_activity
from app.services.audit_service import audit
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["templates"])


# --------------------------------------------------------------------------- #
# Helpers                                                                     #
# --------------------------------------------------------------------------- #

def _can_view(perms: PermissionService, tpl: WorkspaceTemplate) -> bool:
    if tpl.created_by == perms.user.id:
        return True
    if tpl.visibility == "workspace":
        return perms.can_view_workspace(tpl.workspace_id)
    if tpl.visibility == "admins":
        return perms.workspace_role(tpl.workspace_id) in ("admin", "owner") or perms._is_org_admin_or_owner(
            tpl.organization_id
        )
    return False  # private


def _can_manage(perms: PermissionService, tpl: WorkspaceTemplate) -> bool:
    if tpl.created_by == perms.user.id:
        return True
    return perms.workspace_role(tpl.workspace_id) in ("admin", "owner") or perms._is_org_admin_or_owner(
        tpl.organization_id
    )


def _template_out(db: Session, tpl: WorkspaceTemplate, *, with_creator: bool = True) -> TemplateOut:
    out = TemplateOut.model_validate(tpl)
    out.includes = TemplateIncludes(**template_service.summarize(tpl.payload or {}, tpl.kind))
    if with_creator and tpl.created_by:
        out.creator = user_briefs(db, [tpl.created_by]).get(tpl.created_by)
    return out


def _get_template_or_404(db: Session, template_id: uuid.UUID) -> WorkspaceTemplate:
    tpl = db.get(WorkspaceTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
    return tpl


# --------------------------------------------------------------------------- #
# List & detail                                                               #
# --------------------------------------------------------------------------- #

@router.get("/workspaces/{workspace_id}/templates", response_model=list[TemplateOut])
def list_templates(
    workspace_id: uuid.UUID,
    kind: str | None = Query(default=None, pattern="^(project|space)$"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    stmt = select(WorkspaceTemplate).where(WorkspaceTemplate.workspace_id == workspace_id)
    if kind:
        stmt = stmt.where(WorkspaceTemplate.kind == kind)
    rows = db.scalars(stmt.order_by(WorkspaceTemplate.created_at.desc())).all()
    visible = [t for t in rows if _can_view(perms, t)]
    creator_ids = [t.created_by for t in visible if t.created_by]
    briefs = user_briefs(db, creator_ids) if creator_ids else {}
    result: list[TemplateOut] = []
    for t in visible:
        out = TemplateOut.model_validate(t)
        out.includes = TemplateIncludes(**template_service.summarize(t.payload or {}, t.kind))
        if t.created_by:
            out.creator = briefs.get(t.created_by)
        result.append(out)
    return result


@router.get("/templates/{template_id}", response_model=TemplateOut)
def get_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    tpl = _get_template_or_404(db, template_id)
    if not _can_view(perms, tpl):
        raise HTTPException(status_code=403, detail="You don't have access to this template")
    return _template_out(db, tpl)


# --------------------------------------------------------------------------- #
# Save (from a live Space/Project)                                            #
# --------------------------------------------------------------------------- #

@router.post("/templates/save", response_model=TemplateOut, status_code=201)
def save_template(
    body: TemplateSaveRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    if body.kind == "project":
        source = perms.require_project_view(body.source_id)
        if not perms._is_space_admin(source.space_id):
            perms.require_workspace_admin(source.workspace_id)
        workspace_id = source.workspace_id
        payload = template_service.snapshot_project(db, source, include_tasks=body.include_tasks)
        color, icon = source.color, source.icon
    else:  # space
        source = perms.require_space_member(body.source_id)
        if not perms._is_space_admin(source.id):
            perms.require_workspace_admin(source.workspace_id)
        workspace_id = source.workspace_id
        payload = template_service.snapshot_space(db, source, include_tasks=body.include_tasks)
        color, icon = source.color, source.icon

    ws = perms.get_workspace_or_404(workspace_id)
    tpl = WorkspaceTemplate(
        workspace_id=workspace_id,
        organization_id=ws.organization_id,
        kind=body.kind,
        name=body.name,
        description=body.description,
        color=color or "#9B59B6",
        icon=icon,
        tags=body.tags,
        visibility=body.visibility,
        payload=payload,
        created_by=perms.user.id,
    )
    db.add(tpl)
    db.flush()
    log_activity(db, workspace_id=workspace_id, action="template.created", actor_id=perms.user.id,
                 data={"template_id": str(tpl.id), "name": tpl.name, "kind": tpl.kind})
    audit(db, "template.created", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="template", target_id=tpl.id, data={"name": tpl.name, "kind": tpl.kind})
    db.commit()
    return _template_out(db, tpl)


# --------------------------------------------------------------------------- #
# Apply (instantiate)                                                         #
# --------------------------------------------------------------------------- #

@router.post("/templates/{template_id}/apply", response_model=TemplateApplyResult, status_code=201)
def apply_template(
    template_id: uuid.UUID,
    body: TemplateApplyRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    tpl = _get_template_or_404(db, template_id)
    if not _can_view(perms, tpl):
        raise HTTPException(status_code=403, detail="You don't have access to this template")
    ws = perms.get_workspace_or_404(tpl.workspace_id)
    name = (body.name or tpl.name).strip() or tpl.name

    if tpl.kind == "project":
        if not body.target_space_id:
            raise HTTPException(status_code=400, detail="target_space_id is required for project templates")
        space = perms.get_space_or_404(body.target_space_id)
        if space.workspace_id != tpl.workspace_id:
            raise HTTPException(status_code=400, detail="Target space is not in this template's workspace")
        # Same gate as creating a project in the space.
        if not perms._is_space_admin(space.id):
            perms.require_workspace_admin(space.workspace_id)
        project = template_service.apply_project_payload(
            db, tpl.payload or {}, space_id=space.id, workspace_id=space.workspace_id,
            name=name, user_id=perms.user.id,
        )
        result = TemplateApplyResult(kind="project", space_id=space.id, project_id=project.id, name=project.name)
        target_id = project.id
        log_data = {"name": project.name, "project_id": str(project.id), "from_template": str(tpl.id)}
    else:  # space
        perms.require_workspace_admin(tpl.workspace_id)
        add_space_member = not (
            perms._is_org_admin_or_owner(tpl.organization_id)
            or perms.workspace_role(tpl.workspace_id) in ("admin", "owner")
        )
        space = template_service.apply_space_payload(
            db, tpl.payload or {}, workspace_id=tpl.workspace_id, name=name,
            user_id=perms.user.id, add_space_member=add_space_member,
        )
        result = TemplateApplyResult(kind="space", space_id=space.id, name=space.name)
        target_id = space.id
        log_data = {"name": space.name, "space_id": str(space.id), "from_template": str(tpl.id)}

    tpl.usage_count += 1
    log_activity(db, workspace_id=tpl.workspace_id, action=f"{tpl.kind}.created",
                 actor_id=perms.user.id, data=log_data)
    audit(db, "template.applied", organization_id=tpl.organization_id, actor_id=perms.user.id,
          target_type=tpl.kind, target_id=target_id, data={"template": tpl.name, **log_data})
    db.commit()
    return result


@router.post("/templates/apply-payload", response_model=TemplateApplyResult, status_code=201)
def apply_template_payload(
    body: TemplateApplyPayloadRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Instantiate an app-shipped starter template (payload sent by the client,
    not stored in the DB). Same permission gates as creating a project/space."""
    payload = body.payload or {}
    # Cheap abuse guard — starter payloads are small.
    if body.kind == "space":
        total_tasks = sum(len(p.get("tasks", [])) for p in payload.get("projects", []))
    else:
        total_tasks = len(payload.get("tasks", []))
    if total_tasks > 500:
        raise HTTPException(status_code=400, detail="Template payload is too large")

    name = body.name.strip() or "Untitled"
    if body.kind == "project":
        if not body.target_space_id:
            raise HTTPException(status_code=400, detail="target_space_id is required for project templates")
        space = perms.get_space_or_404(body.target_space_id)
        if not perms._is_space_admin(space.id):
            perms.require_workspace_admin(space.workspace_id)
        ws = perms.get_workspace_or_404(space.workspace_id)
        project = template_service.apply_project_payload(
            db, payload, space_id=space.id, workspace_id=space.workspace_id, name=name, user_id=perms.user.id,
        )
        log_activity(db, workspace_id=space.workspace_id, action="project.created", actor_id=perms.user.id,
                     data={"name": project.name, "project_id": str(project.id), "from_starter": True})
        audit(db, "template.applied", organization_id=ws.organization_id, actor_id=perms.user.id,
              target_type="project", target_id=project.id, data={"name": project.name, "starter": True})
        db.commit()
        return TemplateApplyResult(kind="project", space_id=space.id, project_id=project.id, name=project.name)

    # space kind
    if not body.workspace_id:
        raise HTTPException(status_code=400, detail="workspace_id is required for space templates")
    ws = perms.require_workspace_admin(body.workspace_id)
    add_space_member = not (
        perms._is_org_admin_or_owner(ws.organization_id)
        or perms.workspace_role(body.workspace_id) in ("admin", "owner")
    )
    space = template_service.apply_space_payload(
        db, payload, workspace_id=body.workspace_id, name=name, user_id=perms.user.id, add_space_member=add_space_member,
    )
    log_activity(db, workspace_id=body.workspace_id, action="space.created", actor_id=perms.user.id,
                 data={"name": space.name, "space_id": str(space.id), "from_starter": True})
    audit(db, "template.applied", organization_id=ws.organization_id, actor_id=perms.user.id,
          target_type="space", target_id=space.id, data={"name": space.name, "starter": True})
    db.commit()
    return TemplateApplyResult(kind="space", space_id=space.id, name=space.name)


# --------------------------------------------------------------------------- #
# Update & delete                                                             #
# --------------------------------------------------------------------------- #

@router.put("/templates/{template_id}", response_model=TemplateOut)
def update_template(
    template_id: uuid.UUID,
    body: TemplateUpdateRequest,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    tpl = _get_template_or_404(db, template_id)
    if not _can_manage(perms, tpl):
        raise HTTPException(status_code=403, detail="You can't edit this template")

    if body.name is not None:
        tpl.name = body.name
    if body.description is not None:
        tpl.description = body.description
    if body.tags is not None:
        tpl.tags = body.tags
    if body.visibility is not None:
        tpl.visibility = body.visibility

    # Re-snapshot the structure from a live source of the matching kind.
    if body.resync_from_source_id is not None:
        if tpl.kind == "project":
            source = perms.require_project_view(body.resync_from_source_id)
            if not perms._is_space_admin(source.space_id):
                perms.require_workspace_admin(source.workspace_id)
            tpl.payload = template_service.snapshot_project(db, source, include_tasks=body.include_tasks)
            tpl.color, tpl.icon = source.color or tpl.color, source.icon
        else:
            source = perms.require_space_member(body.resync_from_source_id)
            if not perms._is_space_admin(source.id):
                perms.require_workspace_admin(source.workspace_id)
            tpl.payload = template_service.snapshot_space(db, source, include_tasks=body.include_tasks)
            tpl.color, tpl.icon = source.color or tpl.color, source.icon

    db.commit()
    return _template_out(db, tpl)


@router.delete("/templates/{template_id}", response_model=Message)
def delete_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    tpl = _get_template_or_404(db, template_id)
    if not _can_manage(perms, tpl):
        raise HTTPException(status_code=403, detail="You can't delete this template")
    audit(db, "template.deleted", organization_id=tpl.organization_id, actor_id=perms.user.id,
          target_type="template", target_id=tpl.id, data={"name": tpl.name})
    db.delete(tpl)
    db.commit()
    return Message(detail="Template deleted")
