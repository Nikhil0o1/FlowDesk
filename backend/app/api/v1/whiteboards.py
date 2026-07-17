import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.core.websocket import emit
from app.db.session import get_db
from app.models.project import Project
from app.models.whiteboard import Whiteboard
from app.schemas.common import Message
from app.schemas.whiteboard import (
    WhiteboardCreate,
    WhiteboardListOut,
    WhiteboardOut,
    WhiteboardUpdate,
)
from app.services.activity_service import log_activity
from app.services.permission_service import PermissionError403, PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["whiteboards"])

# content is an Excalidraw scene: {elements: [...], appState: {...}, files: {...}}
MAX_ELEMENTS = 5000
MAX_CONTENT_BYTES = 6_000_000  # ~6 MB serialized — protects JSONB from huge embedded images


def _can_delete_board(perms: PermissionService, board: Whiteboard) -> bool:
    """Deletion is admin-only: project admin, space/workspace admin, or org owner/admin.
    Legacy (project-less) boards fall back to their creator or a workspace admin."""
    if board.project_id is not None:
        try:
            perms.require_project_admin(board.project_id)
            return True
        except (PermissionError403, HTTPException):
            return False
    if board.created_by == perms.user.id:
        return True
    try:
        perms.require_workspace_admin(board.workspace_id)
        return True
    except (PermissionError403, HTTPException):
        return False


def _list_out(
    db: Session, perms: PermissionService, board: Whiteboard, project_names: dict[uuid.UUID, str]
) -> WhiteboardListOut:
    out = WhiteboardListOut.model_validate(board)
    out.element_count = len((board.content or {}).get("elements", []))
    out.project_name = project_names.get(board.project_id) if board.project_id else None
    out.can_delete = _can_delete_board(perms, board)
    if board.created_by:
        out.creator = user_briefs(db, [board.created_by]).get(board.created_by)
    return out


def _require_board_view(perms: PermissionService, board: Whiteboard) -> None:
    """Only members of the board's project may see/open it. Legacy project-less
    boards remain visible to their creator and workspace admins only."""
    if board.project_id is not None:
        perms.require_project_view(board.project_id)
        return
    if board.created_by != perms.user.id:
        perms.require_workspace_admin(board.workspace_id)


def _get_board(db: Session, perms: PermissionService, board_id: uuid.UUID) -> Whiteboard:
    board = db.get(Whiteboard, board_id)
    if not board or board.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    _require_board_view(perms, board)
    return board


def _require_whiteboard_manage(perms: PermissionService, board: Whiteboard) -> None:
    """Any member of the board's project may edit/duplicate it (collaborative canvas).
    Legacy project-less boards remain editable by their creator or a workspace admin."""
    _require_board_view(perms, board)


@router.get("/workspaces/{workspace_id}/whiteboards", response_model=list[WhiteboardListOut])
def list_whiteboards(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    accessible = set(perms.accessible_project_ids())
    is_ws_admin = False
    try:
        perms.require_workspace_admin(workspace_id)
        is_ws_admin = True
    except (PermissionError403, HTTPException):
        is_ws_admin = False
    boards = db.scalars(
        select(Whiteboard)
        .where(Whiteboard.workspace_id == workspace_id, Whiteboard.deleted_at.is_(None))
        .order_by(Whiteboard.updated_at.desc())
    ).all()
    # Project boards: visible only to that project's members. Legacy project-less
    # boards: visible to their creator or workspace admins only.
    visible = [
        b
        for b in boards
        if (b.project_id in accessible)
        or (b.project_id is None and (b.created_by == perms.user.id or is_ws_admin))
    ]
    project_ids = {b.project_id for b in visible if b.project_id}
    project_names = (
        {
            p.id: p.name
            for p in db.scalars(select(Project).where(Project.id.in_(project_ids))).all()
        }
        if project_ids
        else {}
    )
    return [_list_out(db, perms, b, project_names) for b in visible]


@router.post("/workspaces/{workspace_id}/whiteboards", response_model=WhiteboardOut, status_code=201)
def create_whiteboard(
    workspace_id: uuid.UUID,
    body: WhiteboardCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    # Anyone who can see the project may create a whiteboard in it.
    project = perms.require_project_view(body.project_id)
    if project.workspace_id != workspace_id:
        raise HTTPException(status_code=400, detail="Project is not in this workspace")
    board = Whiteboard(
        workspace_id=workspace_id,
        project_id=body.project_id,
        name=body.name,
        content={"elements": []},
        created_by=perms.user.id,
    )
    db.add(board)
    db.flush()
    log_activity(db, workspace_id=workspace_id, action="whiteboard.created",
                 actor_id=perms.user.id, project_id=body.project_id,
                 data={"whiteboard_id": str(board.id), "name": board.name})
    db.commit()
    emit(
        "whiteboard.created",
        [f"workspace:{workspace_id}"],
        payload={"whiteboard_id": str(board.id), "name": board.name,
                 "actor_id": str(perms.user.id)},
        workspace_id=workspace_id,
    )
    out = WhiteboardOut.model_validate(board)
    out.element_count = 0
    return out


@router.get("/whiteboards/{board_id}", response_model=WhiteboardOut)
def get_whiteboard(
    board_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    board = _get_board(db, perms, board_id)
    out = WhiteboardOut.model_validate(board)
    out.element_count = len((board.content or {}).get("elements", []))
    if board.created_by:
        out.creator = user_briefs(db, [board.created_by]).get(board.created_by)
    return out


@router.patch("/whiteboards/{board_id}", response_model=WhiteboardOut)
def update_whiteboard(
    board_id: uuid.UUID,
    body: WhiteboardUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    board = _get_board(db, perms, board_id)
    _require_whiteboard_manage(perms, board)
    if body.name is not None:
        board.name = body.name
    if body.content is not None:
        elements = body.content.get("elements", [])
        if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
            raise HTTPException(status_code=422, detail=f"A whiteboard holds at most {MAX_ELEMENTS} elements")
        app_state = body.content.get("appState") if isinstance(body.content.get("appState"), dict) else {}
        files = body.content.get("files") if isinstance(body.content.get("files"), dict) else {}
        new_content = {"elements": elements, "appState": app_state, "files": files}
        if len(json.dumps(new_content, default=str)) > MAX_CONTENT_BYTES:
            raise HTTPException(status_code=413, detail="Whiteboard is too large — reduce embedded images")
        board.content = new_content
    db.commit()
    db.refresh(board)
    emit(
        "whiteboard.updated",
        [f"workspace:{board.workspace_id}"],
        payload={
            "whiteboard_id": str(board.id),
            "actor_id": str(perms.user.id),
            "name": board.name,
            "content": board.content,
            "updated_at": board.updated_at.isoformat(),
        },
        workspace_id=board.workspace_id,
    )
    out = WhiteboardOut.model_validate(board)
    out.element_count = len((board.content or {}).get("elements", []))
    return out


@router.delete("/whiteboards/{board_id}", response_model=Message)
def delete_whiteboard(
    board_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    board = _get_board(db, perms, board_id)
    if not _can_delete_board(perms, board):
        raise PermissionError403("Only a project/space/workspace admin can delete this whiteboard")
    board.deleted_at = datetime.now(timezone.utc)
    db.commit()
    emit(
        "whiteboard.deleted",
        [f"workspace:{board.workspace_id}"],
        payload={"whiteboard_id": str(board.id), "actor_id": str(perms.user.id)},
        workspace_id=board.workspace_id,
    )
    return Message(detail="Whiteboard deleted")


@router.post("/whiteboards/{board_id}/duplicate", response_model=WhiteboardOut, status_code=201)
def duplicate_whiteboard(
    board_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    board = _get_board(db, perms, board_id)
    _require_whiteboard_manage(perms, board)
    copy = Whiteboard(
        workspace_id=board.workspace_id,
        project_id=board.project_id,
        name=f"{board.name} (copy)",
        content=board.content or {"elements": []},
        created_by=perms.user.id,
    )
    db.add(copy)
    db.flush()
    log_activity(db, workspace_id=board.workspace_id, action="whiteboard.created",
                 actor_id=perms.user.id, project_id=board.project_id,
                 data={"whiteboard_id": str(copy.id), "name": copy.name})
    db.commit()
    emit(
        "whiteboard.created",
        [f"workspace:{board.workspace_id}"],
        payload={"whiteboard_id": str(copy.id), "name": copy.name, "actor_id": str(perms.user.id)},
        workspace_id=board.workspace_id,
    )
    out = WhiteboardOut.model_validate(copy)
    out.element_count = len((copy.content or {}).get("elements", []))
    return out
