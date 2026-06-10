from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.core.rate_limit import limiter
from app.api.deps import get_current_user
from app.models.user import User
from app.schemas.auth import (
    AcceptInviteRequest,
    ActivateInviteRequest,
    ForgotPasswordRequest,
    GoogleLoginRequest,
    InvitePreviewOut,
    LoginRequest,
    RefreshResponse,
    ResetPasswordRequest,
    TokenResponse,
)
from app.schemas.common import Message
from app.schemas.user import UserOut
from app.services import auth_service, invite_service
from app.services.audit_service import audit

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "flowdesk_refresh"
REFRESH_PATH = "/api/v1/auth"


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        raw_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        path=REFRESH_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH)


def _token_response(access: str, user: User) -> TokenResponse:
    return TokenResponse(
        access_token=access,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user = auth_service.authenticate(db, body.email, body.password)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    audit(db, "auth.login", actor_id=user.id, ip_address=request.client.host if request.client else None)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user)


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
def google_login(
    request: Request,
    body: GoogleLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user = auth_service.login_with_google(db, body.id_token)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    audit(db, "auth.login_google", actor_id=user.id)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user)


@router.post("/refresh", response_model=RefreshResponse)
@limiter.limit("60/minute")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status_code=401, detail="No active session")
    access, raw_new, _user = auth_service.rotate_refresh_token(
        db, raw, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    db.commit()
    _set_refresh_cookie(response, raw_new)
    return RefreshResponse(access_token=access, expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)


@router.post("/logout", response_model=Message)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        auth_service.revoke_refresh_token(db, raw)
        db.commit()
    _clear_refresh_cookie(response)
    return Message(detail="Logged out")


@router.post("/forgot-password", response_model=Message)
@limiter.limit("5/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    auth_service.request_password_reset(db, body.email)
    return Message(detail="If an account exists for that email, a reset link has been sent.")


@router.post("/reset-password", response_model=Message)
@limiter.limit("5/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(get_db)):
    auth_service.reset_password(db, body.token, body.password)
    return Message(detail="Password updated. You can now sign in.")


@router.get("/invite-preview", response_model=InvitePreviewOut)
@limiter.limit("20/minute")
def invite_preview(request: Request, token: str, db: Session = Depends(get_db)):
    return invite_service.preview_invite(db, token)


@router.post("/activate-invite", response_model=TokenResponse)
@limiter.limit("10/minute")
def activate_invite(
    request: Request,
    body: ActivateInviteRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user = invite_service.activate_invite(db, body.token, body.full_name, body.password)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user)


@router.post("/accept-invite", response_model=Message)
def accept_invite(
    body: AcceptInviteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = invite_service.accept_invite(db, body.token, user)
    return Message(detail=f"You've joined. Scope: {invite.scope}")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)
