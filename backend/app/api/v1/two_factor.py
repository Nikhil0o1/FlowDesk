"""Self-service 2FA management for the signed-in user (Settings → Security)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.auth import (
    RecoveryCodesOut,
    Totp2faConfirmRequest,
    Totp2faSetupResponse,
    Totp2faStatusOut,
)
from app.schemas.common import Message
from app.services import two_factor_service
from app.services.audit_service import audit

router = APIRouter(prefix="/users/me/2fa", tags=["2fa"])


@router.get("", response_model=Totp2faStatusOut)
def get_status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return Totp2faStatusOut(
        enrolled=user.totp_enabled,
        org_required=two_factor_service.org_requires_2fa(db, user),
        recovery_codes_remaining=two_factor_service.recovery_codes_remaining(db, user),
    )


@router.post("/setup", response_model=Totp2faSetupResponse)
def setup(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    secret, uri = two_factor_service.start_enrollment(db, user)
    db.commit()
    return Totp2faSetupResponse(secret=secret, otpauth_uri=uri)


@router.post("/confirm", response_model=RecoveryCodesOut)
def confirm(
    body: Totp2faConfirmRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    codes = two_factor_service.confirm_enrollment(db, user, body.code)
    audit(db, "user.2fa_enabled", actor_id=user.id)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.delete("", response_model=Message)
def disable(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.services import auth_service

    two_factor_service.disable(db, user)
    auth_service.revoke_all_user_tokens(db, user.id)
    audit(db, "user.2fa_disabled", actor_id=user.id)
    db.commit()
    return Message(detail="Two-factor authentication disabled")
