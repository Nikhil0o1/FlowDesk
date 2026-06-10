import mimetypes
import os
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.db.session import get_db
from app.models.activity import ActivityLog
from app.models.user import Profile, User
from app.schemas.project import ActivityOut
from app.schemas.user import ProfileUpdate, UserOut
from app.services.permission_service import PermissionService
from app.services.storage_service import get_storage

router = APIRouter(prefix="/users", tags=["users"])

MAX_AVATAR_BYTES = 2 * 1024 * 1024


def _ensure_profile(db: Session, user: User) -> Profile:
    if user.profile is None:
        profile = Profile(user_id=user.id, full_name="")
        db.add(profile)
        user.profile = profile
    return user.profile


@router.patch("/me/profile", response_model=UserOut)
def update_my_profile(
    body: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    profile = _ensure_profile(db, user)
    changes = body.model_dump(exclude_unset=True)
    if changes.pop("clear_status", False):
        profile.status_text = None
        changes.pop("status_text", None)
    for field, value in changes.items():
        if value is not None:
            setattr(profile, field, value)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be under 2MB")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Avatar must be an image")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".webp"):
        ext = ".png"
    key = f"avatars/{user.id}/{uuid.uuid4().hex}{ext}"
    storage = get_storage()
    storage.save(key, content)

    profile = _ensure_profile(db, user)
    if profile.avatar_key:
        try:
            storage.delete(profile.avatar_key)
        except Exception:  # noqa: BLE001
            pass
    profile.avatar_key = key
    # Cache-busting relative URL served by the public avatar endpoint below
    profile.avatar_url = f"/api/v1/users/{user.id}/avatar?v={int(time.time())}"
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/{user_id}/avatar", include_in_schema=False)
def get_avatar(user_id: uuid.UUID, db: Session = Depends(get_db)):
    """Serves uploaded avatar bytes. Unauthenticated so plain <img> tags work."""
    profile = db.scalar(select(Profile).where(Profile.user_id == user_id))
    if not profile or not profile.avatar_key:
        raise HTTPException(status_code=404, detail="No avatar")
    content = get_storage().read(profile.avatar_key)
    mime = mimetypes.guess_type(profile.avatar_key)[0] or "image/png"
    return Response(
        content,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/me/activity", response_model=list[ActivityOut])
def my_activity(
    limit: int = 30,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    """The current user's recent actions across their accessible workspaces."""
    workspace_ids = perms.accessible_workspace_ids()
    if not workspace_ids:
        return []
    rows = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.actor_id == user.id, ActivityLog.workspace_id.in_(workspace_ids))
        .order_by(ActivityLog.created_at.desc())
        .limit(min(max(limit, 1), 100))
    ).all()
    return [ActivityOut.model_validate(r) for r in rows]
