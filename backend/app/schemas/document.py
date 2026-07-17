"""Documents module — Pydantic schemas (API uses snake_case)."""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.email_validation import InviteEmail

from app.schemas.common import ORMModel
from app.schemas.user import UserBrief

DOC_STATUS_PATTERN = "^(draft|published)$"
DOC_ROLE_PATTERN = "^(owner|editor|commenter|viewer)$"
FAVORITE_TYPE_PATTERN = "^(doc|folder)$"


# ── Folders ────────────────────────────────────────────────────────


class DocFolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    parent_id: uuid.UUID | None = None


class DocFolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    parent_id: uuid.UUID | None = None


class DocFolderOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None = None
    is_private: bool = False
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class DocFolderShareMemberOut(BaseModel):
    user_id: uuid.UUID
    role: str
    user: UserBrief | None = None


class DocFolderShareState(BaseModel):
    folder_id: uuid.UUID
    is_private: bool
    members: list[DocFolderShareMemberOut] = Field(default_factory=list)


class DocFolderShareUpdate(BaseModel):
    is_private: bool | None = None


class DocFolderShareMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: str = Field(default="viewer", pattern="^(editor|viewer)$")


class DocFolderShareMemberUpdate(BaseModel):
    role: str = Field(pattern="^(editor|viewer)$")


# ── Documents ──────────────────────────────────────────────────────


class DocumentCreate(BaseModel):
    title: str = Field(default="Untitled", min_length=1, max_length=500)
    folder_id: uuid.UUID | None = None
    content: str = ""
    status: str = Field(default="draft", pattern=DOC_STATUS_PATTERN)
    tags: list[str] = Field(default_factory=list, max_length=30)
    template_id: str | None = Field(default=None, max_length=64)
    is_wiki: bool = False
    icon: str | None = Field(default=None, max_length=16)


class DocumentImportIn(BaseModel):
    title: str = Field(default="Imported document", max_length=500)
    content: str = ""
    folder_id: uuid.UUID | None = None
    format: str = Field(default="html", pattern="^(html|markdown|text)$")

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_import_title(cls, value: object) -> str:
        text = str(value or "").strip()
        return text or "Imported document"


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    content: str | None = None
    status: str | None = Field(default=None, pattern=DOC_STATUS_PATTERN)
    folder_id: uuid.UUID | None = None
    tags: list[str] | None = Field(default=None, max_length=30)
    icon: str | None = Field(default=None, max_length=16)
    is_wiki: bool | None = None
    is_protected: bool | None = None
    cover_url: str | None = Field(default=None, max_length=500_000)
    page_settings: dict | None = None
    create_version: bool = False
    version_summary: str = Field(default="Auto-saved", max_length=500)


class PageSettingsOut(BaseModel):
    font_style: str = "system"
    font_size: str = "default"
    page_width: str = "default"
    show_cover: bool = True
    header_enabled: bool = False
    show_page_icon: bool = True
    show_owners: bool = True
    show_contributors: bool = False
    show_subtitle: bool = False
    show_last_modified: bool = True
    subtitle: str = ""
    subpages_view: str = "table"
    relationships_view: str = "dialog"
    show_page_outline: bool = False
    focus_block: bool = False
    focus_page: bool = False
    show_stats_on_page: bool = False


class DocumentOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    folder_id: uuid.UUID | None = None
    title: str
    content: str
    status: str
    author: str
    author_id: uuid.UUID
    updated_by: str | None = None
    updated_by_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None
    deleted_at: datetime | None = None
    deleted_by: str | None = None
    original_folder_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list)
    view_count: int = 0
    template_id: str | None = None
    is_private: bool = True
    is_wiki: bool = False
    is_protected: bool = False
    icon: str | None = None
    cover_url: str | None = None
    page_settings: PageSettingsOut = Field(default_factory=PageSettingsOut)
    public_enabled: bool = False
    is_shared: bool = False
    folder_name: str | None = None
    comment_count: int = 0
    share_member_count: int = 0
    user_role: str | None = None
    last_viewed_at: datetime | None = None


class DocumentListOut(DocumentOut):
    pass


class DocFilterRuleIn(BaseModel):
    """Single ClickUp-style list filter rule."""

    field: str = Field(
        pattern="^(title|location|tag|owner|dateViewed|dateUpdated|dateCreated|contributors|sharing|wiki)$"
    )
    operator: str = Field(pattern="^(contains|equals|not_equals|before|after|on|is|is_not)$")
    value: str = Field(max_length=500)


# ── Comments ───────────────────────────────────────────────────────


class InlineAnchorIn(BaseModel):
    marker_id: str = Field(min_length=1, max_length=64)
    quote: str = Field(default="", max_length=2000)


class DocumentCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=50000)
    parent_id: uuid.UUID | None = None
    inline_anchor: InlineAnchorIn | None = None


class DocumentBodyMentionIn(BaseModel):
    """Immediate notify when a people chip (@user or @All) is inserted in the doc body."""

    user_id: str = Field(min_length=1, max_length=36, description='User UUID or "all"')
    preview_html: str | None = Field(default=None, max_length=200_000)

    @model_validator(mode="after")
    def _validate_user_id(self):
        raw = (self.user_id or "").strip().lower()
        if raw == "all":
            self.user_id = "all"
            return self
        try:
            self.user_id = str(uuid.UUID(self.user_id.strip()))
        except ValueError as exc:
            raise ValueError('user_id must be a UUID or "all"') from exc
        return self


class DocumentCommentUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=50000)
    resolved: bool | None = None


class InlineAnchorOut(BaseModel):
    marker_id: str
    quote: str


class DocumentCommentOut(ORMModel):
    id: uuid.UUID
    document_id: uuid.UUID
    author_id: uuid.UUID
    author_name: str
    body: str
    parent_id: uuid.UUID | None = None
    inline_anchor: InlineAnchorOut | None = None
    resolved: bool
    created_at: datetime
    updated_at: datetime


# ── Sharing ────────────────────────────────────────────────────────


class ShareMemberCreate(BaseModel):
    user_id: uuid.UUID | None = None
    email: InviteEmail | None = None
    role: str = Field(default="viewer", pattern=DOC_ROLE_PATTERN)

    @model_validator(mode="after")
    def require_user_or_email(self) -> "ShareMemberCreate":
        if not self.user_id and not self.email:
            raise ValueError("Provide user_id or email")
        if self.user_id and self.email:
            raise ValueError("Provide user_id or email, not both")
        return self


class ShareMemberUpdate(BaseModel):
    role: str = Field(pattern=DOC_ROLE_PATTERN)


class ShareMemberOut(ORMModel):
    id: uuid.UUID
    type: str = "user"
    target_id: uuid.UUID
    name: str
    email: str | None = None
    avatar_url: str | None = None
    avatar_color: str | None = None
    role: str
    added_at: datetime
    added_by: str


class DocumentShareOut(BaseModel):
    document_id: uuid.UUID
    is_private: bool
    public_enabled: bool
    public_token: str | None = None
    public_url: str | None = None
    members: list[ShareMemberOut] = Field(default_factory=list)


class DocumentShareUpdate(BaseModel):
    is_private: bool | None = None
    public_enabled: bool | None = None


# ── Versions ───────────────────────────────────────────────────────


class DocumentVersionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    content: str = ""
    summary: str = Field(default="Auto-saved", max_length=500)
    word_count: int = Field(default=0, ge=0)


class DocumentVersionOut(ORMModel):
    id: uuid.UUID
    document_id: uuid.UUID
    version_number: int
    title: str
    content: str
    author_id: uuid.UUID
    author_name: str
    summary: str
    word_count: int
    created_at: datetime


# ── Activity ───────────────────────────────────────────────────────


class DocumentActivityOut(ORMModel):
    id: uuid.UUID
    document_id: uuid.UUID
    type: str
    actor_id: uuid.UUID
    actor_name: str
    detail: str
    at: datetime


# ── Favorites & Recent ─────────────────────────────────────────────


class DocumentFavoriteCreate(BaseModel):
    target_id: uuid.UUID
    target_type: str = Field(pattern=FAVORITE_TYPE_PATTERN)


class DocumentFavoriteOut(ORMModel):
    id: uuid.UUID
    target_id: uuid.UUID
    target_type: str
    created_at: datetime


class DocumentRecentOut(ORMModel):
    document_id: uuid.UUID
    opened_at: datetime
    document: DocumentListOut | None = None


class PublicDocumentOut(BaseModel):
    id: uuid.UUID
    title: str
    content: str
    status: str
    author: str
    updated_at: datetime
    icon: str | None = None
    cover_url: str | None = None
    page_settings: dict = Field(default_factory=dict)
    is_wiki: bool = False


# ── Custom templates ───────────────────────────────────────────────


class DocTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)
    icon: str | None = Field(default=None, max_length=16)
    content: str = ""
    document_id: uuid.UUID | None = None


class DocTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    icon: str | None = Field(default=None, max_length=16)
    content: str | None = None
    document_id: uuid.UUID | None = None


class DocTemplateOut(ORMModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str
    icon: str | None = None
    content: str
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


# ── Document links (task / doc) ───────────────────────────────────


LINK_TARGET_PATTERN = "^(task|document)$"


class DocumentLinkCreate(BaseModel):
    target_type: str = Field(pattern=LINK_TARGET_PATTERN)
    target_id: uuid.UUID


class DocumentLinkOut(BaseModel):
    id: uuid.UUID
    target_type: str
    target_id: uuid.UUID
    title: str
    subtitle: str | None = None
    icon: str | None = None
    href: str


class DocumentLinksOut(BaseModel):
    links: list[DocumentLinkOut] = Field(default_factory=list)
