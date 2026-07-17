import uuid

from pydantic import BaseModel, Field


class McpOAuthClientRegisterIn(BaseModel):
    client_name: str = Field(max_length=200)
    redirect_uris: list[str] = Field(min_length=1)
    token_endpoint_auth_method: str = "none"
    grant_types: list[str] | None = None
    response_types: list[str] | None = None


class McpOAuthClientRegisterOut(BaseModel):
    client_id: str
    client_name: str
    redirect_uris: list[str]
    token_endpoint_auth_method: str
    client_id_issued_at: int | None = None
    client_secret: str | None = None
    client_secret_expires_at: int | None = None


class McpOAuthAuthRequestOut(BaseModel):
    request_id: uuid.UUID
    client_name: str
    scopes: list[str]
    resource: str | None = None


class McpOAuthApproveIn(BaseModel):
    request_id: uuid.UUID


class McpOAuthApproveOut(BaseModel):
    redirect_to: str


class McpOAuthIntrospectOut(BaseModel):
    active: bool
    sub: str | None = None
    client_id: str | None = None
    scope: str | None = None
    exp: int | None = None


class McpConnectInfoOut(BaseModel):
    mcp_url: str
    oauth_issuer: str
    scopes_supported: list[str]
    cursor_deeplink: str
    claude_desktop_deeplink: str
    claude_code_install_command: str
    claude_code_reset_command: str
    cursor_config: dict
    claude_config: dict
