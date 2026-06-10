import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_permissions
from app.db.session import get_db
from app.models.whiteboard import Whiteboard
from app.schemas.common import Message
from app.schemas.whiteboard import (
    WhiteboardCreate,
    WhiteboardListOut,
    WhiteboardOut,
    WhiteboardUpdate,
)
from app.services.activity_service import log_activity
from app.services.permission_service import PermissionService
from app.services.user_service import user_briefs

router = APIRouter(tags=["whiteboards"])

MAX_ELEMENTS = 500


def _list_out(db: Session, board: Whiteboard) -> WhiteboardListOut:
    out = WhiteboardListOut.model_validate(board)
    out.element_count = len((board.content or {}).get("elements", []))
    if board.created_by:
        out.creator = user_briefs(db, [board.created_by]).get(board.created_by)
    return out


def _get_board(db: Session, perms: PermissionService, board_id: uuid.UUID) -> Whiteboard:
    board = db.get(Whiteboard, board_id)
    if not board or board.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Whiteboard not found")
    perms.require_workspace_member(board.workspace_id)
    return board


@router.get("/workspaces/{workspace_id}/whiteboards", response_model=list[WhiteboardListOut])
def list_whiteboards(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    boards = db.scalars(
        select(Whiteboard)
        .where(Whiteboard.workspace_id == workspace_id, Whiteboard.deleted_at.is_(None))
        .order_by(Whiteboard.updated_at.desc())
    ).all()
    return [_list_out(db, b) for b in boards]


@router.post("/workspaces/{workspace_id}/whiteboards", response_model=WhiteboardOut, status_code=201)
def create_whiteboard(
    workspace_id: uuid.UUID,
    body: WhiteboardCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    board = Whiteboard(
        workspace_id=workspace_id,
        name=body.name,
        content={"elements": []},
        created_by=perms.user.id,
    )
    db.add(board)
    db.flush()
    log_activity(db, workspace_id=workspace_id, action="whiteboard.created",
                 actor_id=perms.user.id, data={"whiteboard_id": str(board.id), "name": board.name})
    db.commit()
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
    if body.name is not None:
        board.name = body.name
    if body.content is not None:
        elements = body.content.get("elements", [])
        if not isinstance(elements, list) or len(elements) > MAX_ELEMENTS:
            raise HTTPException(status_code=422, detail=f"A whiteboard holds at most {MAX_ELEMENTS} elements")
        board.content = {"elements": elements}
    db.commit()
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
    if board.created_by != perms.user.id:
        perms.require_workspace_admin(board.workspace_id)
    board.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="Whiteboard deleted")
