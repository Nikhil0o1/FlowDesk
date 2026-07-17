import uuid
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.schemas.user import UserOut


class LoginContextOut(BaseModel):
    kind: str
    role: str
    redirect_to: str
    organization_id: str | None = None
    workspace_id: str | None = None
    project_id: str | None = None


class GoogleLoginRequest(BaseModel):
    id_token: str


class MicrosoftLoginRequest(BaseModel):
    id_token: str


class OtpRequestRequest(BaseModel):
    email: EmailStr
    captcha_token: str | None = Field(default=None, max_length=4096)


class OtpVerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut
    login_context: LoginContextOut
    # Present only when UI and API are on different site names — lets privacy
    # browsers persist rotation when cross-site Set-Cookie is blocked.
    refresh_token: str | None = None


class OtpVerifyResponse(BaseModel):
    """Email-code verification result. When 2FA applies, no session is issued yet
    and a short-lived challenge_token is returned to drive the /auth/2fa/* step."""

    status: Literal["authenticated", "totp_required", "totp_enrollment_required"]
    challenge_token: str | None = None
    # Session fields — present only when status == "authenticated".
    access_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: UserOut | None = None
    login_context: LoginContextOut | None = None
    refresh_token: str | None = None


class Totp2faSetupResponse(BaseModel):
    secret: str
    otpauth_uri: str


class Totp2faConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class Totp2faChallengeSetup(BaseModel):
    challenge_token: str


class Totp2faChallengeVerify(BaseModel):
    challenge_token: str
    code: str = Field(min_length=4, max_length=32)  # TOTP (6 digits) or a recovery code


class Totp2faStatusOut(BaseModel):
    enrolled: bool
    org_required: bool
    recovery_codes_remaining: int


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class Login2faEnrollResponse(TokenResponse):
    """Session issued after enrolling 2FA during an org-enforced login, plus the
    one-time recovery codes to show the user once."""

    recovery_codes: list[str]


class MeResponse(BaseModel):
    user: UserOut
    login_context: LoginContextOut


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=512)


class RefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str | None = None


class InvitePreviewRequest(BaseModel):
    token: str = Field(min_length=1)


class ActivateInviteRequest(BaseModel):
    token: str
    full_name: str = Field(min_length=1, max_length=200)


class AcceptInviteRequest(BaseModel):
    token: str


class AcceptInviteByIdRequest(BaseModel):
    invite_id: uuid.UUID


class InvitePreviewOut(BaseModel):
    email: str
    scope: str
    role: str
    organization_name: str
    target_name: str
    existing_user: bool
    expired: bool
