import secrets
import time
import uuid
from urllib.parse import urlencode

import requests as http
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.oauth_origins import (
    cross_site_cookie,
    google_sso_redirect_uri,
    is_cross_site_deployment,
    oauth_state_cookie_path,
)
from app.core.security import create_2fa_challenge_token, decode_2fa_challenge_token
from app.db.session import get_db
from app.core.rate_limit import limiter, otp_request_rate_key, otp_verify_rate_key, trusted_client_ip
from app.api.deps import get_current_user
from app.core.pat_route_registry import pat_allow
from app.models.user import User
from app.schemas.auth import (
    AcceptInviteByIdRequest,
    AcceptInviteRequest,
    ActivateInviteRequest,
    GoogleLoginRequest,
    InvitePreviewOut,
    InvitePreviewRequest,
    Login2faEnrollResponse,
    LoginContextOut,
    MeResponse,
    MicrosoftLoginRequest,
    OtpRequestRequest,
    OtpVerifyRequest,
    OtpVerifyResponse,
    RefreshRequest,
    RefreshResponse,
    TokenResponse,
    Totp2faChallengeSetup,
    Totp2faChallengeVerify,
    Totp2faSetupResponse,
)
from app.schemas.common import Message
from app.schemas.user import UserOut
from app.services import auth_service, invite_service, two_factor_service
from app.services.audit_service import audit
from app.services.captcha_service import verify_turnstile
from app.services.login_access_service import LoginContext, assert_can_login

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "flowdesk_refresh"
REFRESH_PATH = "/api/v1/auth"

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

# Floor for the OTP-request response so its timing can't reveal whether an email
# is a registered account (user enumeration). The handler's real work is a few ms;
# padding to a constant minimum makes the known/unknown paths indistinguishable.
_OTP_REQUEST_MIN_SECONDS = 0.5


def _reject_cross_site(request: Request) -> None:
    """CSRF guard for cookie-authenticated, state-changing endpoints.

    Browsers always attach an Origin header to cross-origin POSTs, so a request
    whose Origin (or Referer, as a fallback) isn't our own frontend is rejected.
    Requests with neither header (native / server-to-server clients) aren't a
    browser CSRF vector and are allowed through.
    """
    origin = request.headers.get("origin") or request.headers.get("referer")
    if origin is None:
        return
    allowed = [o.rstrip("/") for o in settings.cors_origins]
    if not any(origin == a or origin.startswith(a + "/") for a in allowed):
        raise HTTPException(status_code=403, detail="Cross-site request blocked")


def _cross_site_cookie() -> bool:
    return cross_site_cookie()


def _google_oauth_redirect_uri() -> str:
    return google_sso_redirect_uri()


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    cross_site = _cross_site_cookie()
    response.set_cookie(
        REFRESH_COOKIE,
        raw_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        secure=cross_site,
        samesite="none" if cross_site else "lax",
        path=REFRESH_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        REFRESH_COOKIE,
        path=REFRESH_PATH,
        secure=_cross_site_cookie(),
        samesite="none" if _cross_site_cookie() else "lax",
    )


def _set_oauth_state_cookie(response: Response, state: str) -> None:
    cross_site = _cross_site_cookie()
    response.set_cookie(
        "g_oauth_state",
        state,
        max_age=600,
        httponly=True,
        secure=cross_site,
        samesite="none" if cross_site else "lax",
        path=oauth_state_cookie_path(),
    )


def _clear_oauth_state_cookie(response: Response) -> None:
    cross_site = _cross_site_cookie()
    response.delete_cookie(
        "g_oauth_state",
        path=oauth_state_cookie_path(),
        secure=cross_site,
        samesite="none" if cross_site else "lax",
    )


def _read_refresh_raw(request: Request, body: RefreshRequest | None) -> str | None:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        return raw
    if body and body.refresh_token:
        token = body.refresh_token.strip()
        return token or None
    return None


def _login_context_out(ctx: LoginContext) -> LoginContextOut:
    return LoginContextOut.model_validate(ctx.model_dump())


def _token_response(
    access: str, user: User, login_ctx: LoginContext, raw_refresh: str | None = None
) -> TokenResponse:
    return TokenResponse(
        access_token=access,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
        login_context=_login_context_out(login_ctx),
        refresh_token=raw_refresh if is_cross_site_deployment() else None,
    )


def _refresh_response(access: str, raw_refresh: str | None) -> RefreshResponse:
    return RefreshResponse(
        access_token=access,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        refresh_token=raw_refresh if is_cross_site_deployment() else None,
    )


@router.post("/otp/request", response_model=Message)
@limiter.limit("5/minute", key_func=otp_request_rate_key)
def request_otp(request: Request, body: OtpRequestRequest, db: Session = Depends(get_db)):
    """Email a one-time sign-in code. Always returns the same message — and pads
    the response to a constant minimum duration — so neither the body nor the
    response timing reveals whether the email is a registered (invited) account."""
    started = time.monotonic()
    verify_turnstile(
        body.captcha_token,
        request.client.host if request.client else None,
    )
    auth_service.request_login_otp(db, body.email)
    elapsed = time.monotonic() - started
    if elapsed < _OTP_REQUEST_MIN_SECONDS:
        time.sleep(_OTP_REQUEST_MIN_SECONDS - elapsed)
    return Message(detail="If your email has access, we've sent a sign-in code.")


@router.post("/otp/verify", response_model=OtpVerifyResponse)
@limiter.limit("10/minute", key_func=otp_verify_rate_key)
def verify_otp(
    request: Request,
    body: OtpVerifyRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user, login_ctx = auth_service.verify_login_otp(db, body.email, body.code)
    # 2FA gate (email-code path only). The OTP is already consumed; commit it and
    # hand back a short-lived challenge instead of a session until 2FA is cleared.
    if user.totp_enabled:
        db.commit()
        return OtpVerifyResponse(status="totp_required", challenge_token=create_2fa_challenge_token(user.id))
    if two_factor_service.org_requires_2fa(db, user):
        db.commit()
        return OtpVerifyResponse(
            status="totp_enrollment_required", challenge_token=create_2fa_challenge_token(user.id)
        )
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    audit(db, "auth.login_otp", actor_id=user.id, ip_address=request.client.host if request.client else None)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return OtpVerifyResponse(
        status="authenticated",
        access_token=access,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
        login_context=_login_context_out(login_ctx),
        refresh_token=raw_refresh if is_cross_site_deployment() else None,
    )


def _user_from_challenge(db: Session, challenge_token: str) -> User:
    user_id = decode_2fa_challenge_token(challenge_token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Your sign-in session expired. Please start again.")
    user = db.get(User, user_id)
    if not user or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="This account is no longer active")
    return user


@router.post("/2fa/verify", response_model=TokenResponse)
@limiter.limit("10/minute")
def verify_2fa(
    request: Request,
    body: Totp2faChallengeVerify,
    response: Response,
    db: Session = Depends(get_db),
):
    """Complete an enrolled user's email-code login with a TOTP or recovery code."""
    user = _user_from_challenge(db, body.challenge_token)
    if not two_factor_service.verify_code(db, user, body.code):
        db.commit()  # persist a consumed recovery code only happens on success; this is a no-op otherwise
        raise HTTPException(status_code=401, detail="That code is invalid. Please try again.")
    login_ctx = assert_can_login(db, user)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    audit(db, "auth.login_2fa", actor_id=user.id, ip_address=request.client.host if request.client else None)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user, login_ctx, raw_refresh)


@router.post("/2fa/setup", response_model=Totp2faSetupResponse)
@limiter.limit("10/minute")
def setup_2fa_at_login(
    request: Request,
    body: Totp2faChallengeSetup,
    db: Session = Depends(get_db),
):
    """Begin TOTP enrollment during an org-enforced login (challenge-authed)."""
    user = _user_from_challenge(db, body.challenge_token)
    secret, uri = two_factor_service.start_enrollment(db, user)
    db.commit()
    return Totp2faSetupResponse(secret=secret, otpauth_uri=uri)


@router.post("/2fa/confirm", response_model=Login2faEnrollResponse)
@limiter.limit("10/minute")
def confirm_2fa_at_login(
    request: Request,
    body: Totp2faChallengeVerify,
    response: Response,
    db: Session = Depends(get_db),
):
    """Finish org-enforced enrollment at login: activate 2FA AND issue the session."""
    user = _user_from_challenge(db, body.challenge_token)
    codes = two_factor_service.confirm_enrollment(db, user, body.code)
    login_ctx = assert_can_login(db, user)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    audit(db, "auth.login_2fa_enrolled", actor_id=user.id, ip_address=request.client.host if request.client else None)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return Login2faEnrollResponse(
        access_token=access,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserOut.model_validate(user),
        login_context=_login_context_out(login_ctx),
        recovery_codes=codes,
        refresh_token=raw_refresh if is_cross_site_deployment() else None,
    )


@router.get("/google/redirect", include_in_schema=False)
@limiter.limit("20/minute")
def google_oauth_redirect(request: Request):
    """Start Google OAuth 2.0 authorization code flow — no GIS SDK needed."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Google SSO is not configured")
    state = secrets.token_urlsafe(32)
    redirect_uri = _google_oauth_redirect_uri()
    params = urlencode({
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    })
    resp = RedirectResponse(f"{_GOOGLE_AUTH_URL}?{params}")
    _set_oauth_state_cookie(resp, state)
    return resp


@router.get("/google/callback", include_in_schema=False)
@limiter.limit("20/minute")
def google_oauth_callback(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    """Handle Google OAuth callback: exchange code → issue session → redirect to frontend."""
    fail = RedirectResponse(f"{settings.FRONTEND_URL}/login?error=google_failed")

    if error or not code or not state:
        return fail

    stored = request.cookies.get("g_oauth_state")
    if not stored or not secrets.compare_digest(stored, state):
        return fail

    token_res = http.post(
        _GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": _google_oauth_redirect_uri(),
        },
        timeout=15,
    )
    if not token_res.ok:
        return fail

    id_token_jwt = token_res.json().get("id_token")
    if not id_token_jwt:
        return fail

    try:
        user, login_ctx = auth_service.login_with_google(db, id_token_jwt)
    except HTTPException:
        return RedirectResponse(f"{settings.FRONTEND_URL}/login?error=google_unauthorized")

    access_tok, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    audit(db, "auth.login_google", actor_id=user.id)
    db.commit()

    resp = RedirectResponse(f"{settings.FRONTEND_URL}/auth/google/complete")
    _set_refresh_cookie(resp, raw_refresh)
    _clear_oauth_state_cookie(resp)
    return resp


@router.post("/google", response_model=TokenResponse)
@limiter.limit("10/minute")
def google_login(
    request: Request,
    body: GoogleLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user, login_ctx = auth_service.login_with_google(db, body.id_token)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    audit(db, "auth.login_google", actor_id=user.id)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user, login_ctx, raw_refresh)


@router.post("/microsoft", response_model=TokenResponse)
@limiter.limit("10/minute")
def microsoft_login(
    request: Request,
    body: MicrosoftLoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    user, login_ctx = auth_service.login_with_microsoft(db, body.id_token)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    audit(db, "auth.login_microsoft", actor_id=user.id)
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user, login_ctx, raw_refresh)


@router.post("/session/establish", response_model=TokenResponse)
@limiter.limit("30/minute")
def establish_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    body: RefreshRequest | None = None,
):
    """Issue an access token from the refresh cookie without rotation.

    Used after the Google OAuth redirect so bootstrap/refresh cannot revoke the
    cookie before privacy browsers store a rotated replacement."""
    raw = _read_refresh_raw(request, body)
    if not raw:
        raise HTTPException(status_code=401, detail="No active session")
    access, user, login_ctx = auth_service.establish_session_from_refresh(db, raw)
    _set_refresh_cookie(response, raw)
    return _token_response(access, user, login_ctx, raw)


@router.post("/refresh", response_model=RefreshResponse)
@limiter.limit("60/minute")
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    body: RefreshRequest | None = None,
):
    raw = _read_refresh_raw(request, body)
    if not raw:
        raise HTTPException(status_code=401, detail="No active session")
    access, raw_new, _user, _login_ctx = auth_service.rotate_refresh_token(
        db, raw, request.headers.get("user-agent"), request.client.host if request.client else None
    )
    db.commit()
    _set_refresh_cookie(response, raw_new)
    return _refresh_response(access, raw_new)


@router.post("/logout", response_model=Message)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    body: RefreshRequest | None = None,
):
    # Logout is driven solely by the refresh cookie, so guard it against CSRF —
    # otherwise any site could force-log-out a signed-in user.
    _reject_cross_site(request)
    changed = False
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        # Blocklist this bearer token's jti so it can't be reused after logout (#30).
        auth_service.revoke_access_token_from_raw(db, auth_header[7:].strip())
        changed = True
    raw = _read_refresh_raw(request, body)
    if raw:
        auth_service.revoke_refresh_token(db, raw)
        changed = True
    if changed:
        db.commit()
    _clear_refresh_cookie(response)
    return Message(detail="Logged out")


@router.post("/invite-preview", response_model=InvitePreviewOut)
@limiter.limit("20/minute")
def invite_preview_post(request: Request, body: InvitePreviewRequest, db: Session = Depends(get_db)):
    return invite_service.preview_invite(db, body.token)


@router.get("/invite-preview", response_model=InvitePreviewOut, deprecated=True)
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
    user = invite_service.activate_invite(db, body.token, body.full_name)
    login_ctx = assert_can_login(db, user)
    access, raw_refresh = auth_service.issue_tokens(
        db, user, request.headers.get("user-agent"), trusted_client_ip(request)
    )
    db.commit()
    _set_refresh_cookie(response, raw_refresh)
    return _token_response(access, user, login_ctx, raw_refresh)


@router.post("/accept-invite", response_model=Message)
def accept_invite(
    body: AcceptInviteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invite = invite_service.accept_invite(db, body.token, user)
    return Message(detail=f"You've joined. Scope: {invite.scope}")


@router.get("/invites/{invite_id}", response_model=InvitePreviewOut)
def invite_by_id(
    invite_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Preview an invite addressed to the signed-in user (in-app notification flow,
    which carries the invite id instead of the raw token)."""
    return invite_service.preview_invite_for_user(db, invite_id, user)


@router.post("/accept-invite-by-id", response_model=Message)
def accept_invite_by_id(
    body: AcceptInviteByIdRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Accept an invite by id from the in-app notification — authenticated and
    email-matched, so no raw token is exposed in notifications."""
    invite = invite_service.accept_invite_by_id(db, body.invite_id, user)
    return Message(detail=f"You've joined. Scope: {invite.scope}")


@router.get("/me", response_model=MeResponse)
@pat_allow(
    "profile:read",
    rate_category="standard",
    authz_class="principal",
    tenant_resolution="No tenant; returns authenticated user only",
)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    login_ctx = assert_can_login(db, user)
    return MeResponse(
        user=UserOut.model_validate(user),
        login_context=_login_context_out(login_ctx),
    )
