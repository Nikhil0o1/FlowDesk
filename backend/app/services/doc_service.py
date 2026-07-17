"""Document permission checks, serialization, and side-effect helpers."""
import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.document import (
    DocFolder,
    DocFolderShareMember,
    Document,
    DocumentActivity,
    DocumentComment,
    DocumentLink,
    DocumentRecent,
    DocumentShareMember,
    DocumentVersion,
)
from app.models.project import Project
from app.models.task import Task
from app.models.organization import OrganizationMember
from app.models.user import User
from app.models.workspace import Workspace, WorkspaceMember
from app.schemas.document import (
    DocumentActivityOut,
    DocumentCommentOut,
    DocumentLinkOut,
    DocumentLinksOut,
    DocumentOut,
    DocumentShareOut,
    DocumentVersionOut,
    DocFolderShareMemberOut,
    DocFolderShareState,
    InlineAnchorOut,
    PageSettingsOut,
    ShareMemberOut,
)
from app.services.permission_service import PermissionError403, PermissionService
from app.services.user_service import user_briefs

ROLE_RANK = {"owner": 4, "editor": 3, "commenter": 2, "viewer": 1}


def word_count(html: str) -> int:
    plain = re.sub(r"<[^>]+>", " ", html or "")
    return len([w for w in plain.split() if w.strip()])


def display_name(user: User | None) -> str:
    if not user:
        return "Unknown"
    if user.profile and user.profile.full_name:
        return user.profile.full_name
    return user.email


def get_share_member(db: Session, document_id: uuid.UUID, user_id: uuid.UUID) -> DocumentShareMember | None:
    return db.scalar(
        select(DocumentShareMember).where(
            DocumentShareMember.document_id == document_id,
            DocumentShareMember.user_id == user_id,
        )
    )


def is_shared_with_user(db: Session, doc: Document, user_id: uuid.UUID) -> bool:
    """True when a doc belongs in the recipient's "Shared with me" list."""
    if doc.created_by == user_id:
        return False
    if get_share_member(db, doc.id, user_id) is not None:
        return True
    return not doc.is_private


def resolve_user_role(db: Session, doc: Document, user_id: uuid.UUID) -> str:
    if doc.created_by == user_id:
        return "owner"
    member = get_share_member(db, doc.id, user_id)
    if member:
        return member.role
    if not doc.is_private:
        return "viewer"
    return "viewer"


def user_can_view_doc(db: Session, perms: PermissionService, doc: Document) -> bool:
    try:
        perms.require_workspace_member(doc.workspace_id)
    except (PermissionError403, HTTPException):
        return False
    if doc.created_by == perms.user.id:
        return True
    if get_share_member(db, doc.id, perms.user.id):
        return True
    if not doc.is_private:
        return True
    return False


def require_doc_view(db: Session, perms: PermissionService, doc: Document) -> None:
    if not user_can_view_doc(db, perms, doc):
        raise HTTPException(status_code=404, detail="Document not found")


def require_doc_role(db: Session, doc: Document, user_id: uuid.UUID, min_role: str) -> str:
    role = resolve_user_role(db, doc, user_id)
    if ROLE_RANK.get(role, 0) < ROLE_RANK.get(min_role, 0):
        raise PermissionError403(f"Requires {min_role} access")
    return role


def get_document(db: Session, perms: PermissionService, document_id: uuid.UUID) -> Document:
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    require_doc_view(db, perms, doc)
    return doc


def name_map(db: Session, user_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    users = db.scalars(select(User).where(User.id.in_(user_ids))).all()
    return {u.id: display_name(u) for u in users}


def normalize_page_settings(raw: dict | None) -> PageSettingsOut:
    data = raw or {}
    return PageSettingsOut(
        font_style=data.get("font_style") or data.get("fontStyle") or "system",
        font_size=data.get("font_size") or data.get("fontSize") or "default",
        page_width=data.get("page_width") or data.get("pageWidth") or "default",
        show_cover=bool(data.get("show_cover", data.get("showCover", True))),
        header_enabled=bool(data.get("header_enabled", data.get("headerEnabled", False))),
        show_page_icon=bool(data.get("show_page_icon", data.get("showPageIcon", True))),
        show_owners=bool(data.get("show_owners", data.get("showOwners", True))),
        show_contributors=bool(data.get("show_contributors", data.get("showContributors", False))),
        show_subtitle=bool(data.get("show_subtitle", data.get("showSubtitle", False))),
        show_last_modified=bool(data.get("show_last_modified", data.get("showLastModified", True))),
        subtitle=str(data.get("subtitle") or ""),
        subpages_view=str(data.get("subpages_view") or data.get("subpagesView") or "table"),
        relationships_view=str(data.get("relationships_view") or data.get("relationshipsView") or "dialog"),
        show_page_outline=bool(data.get("show_page_outline", data.get("showPageOutline", False))),
        focus_block=bool(data.get("focus_block", data.get("focusBlock", False))),
        focus_page=bool(data.get("focus_page", data.get("focusPage", False))),
        show_stats_on_page=bool(data.get("show_stats_on_page", data.get("showStatsOnPage", False))),
    )


def document_out(
    db: Session,
    doc: Document,
    user_id: uuid.UUID | None = None,
    *,
    last_viewed_at: datetime | None = None,
    is_shared: bool | None = None,
    folder_name: str | None = None,
    comment_count: int | None = None,
    share_member_count: int | None = None,
) -> DocumentOut:
    ids = {doc.created_by}
    if doc.updated_by:
        ids.add(doc.updated_by)
    if doc.deleted_by:
        ids.add(doc.deleted_by)
    names = name_map(db, ids)
    role = resolve_user_role(db, doc, user_id) if user_id else None
    if last_viewed_at is None and user_id:
        recent = db.scalar(
            select(DocumentRecent).where(
                DocumentRecent.user_id == user_id,
                DocumentRecent.document_id == doc.id,
            )
        )
        last_viewed_at = recent.opened_at if recent else None
    if is_shared is None:
        share_member_count = share_member_count if share_member_count is not None else (
            db.scalar(
                select(func.count())
                .select_from(DocumentShareMember)
                .where(DocumentShareMember.document_id == doc.id)
            )
            or 0
        )
        is_shared = share_member_count > 0
    elif share_member_count is None:
        share_member_count = (
            db.scalar(
                select(func.count())
                .select_from(DocumentShareMember)
                .where(DocumentShareMember.document_id == doc.id)
            )
            or 0
        )
    if comment_count is None:
        comment_count = (
            db.scalar(
                select(func.count())
                .select_from(DocumentComment)
                .where(DocumentComment.document_id == doc.id, DocumentComment.deleted_at.is_(None))
            )
            or 0
        )
    if folder_name is None and doc.folder_id:
        folder = db.get(DocFolder, doc.folder_id)
        folder_name = folder.name if folder else None
    return DocumentOut(
        id=doc.id,
        workspace_id=doc.workspace_id,
        folder_id=doc.folder_id,
        title=doc.title,
        content=doc.content,
        status=doc.status,
        author=names.get(doc.created_by, "Unknown"),
        author_id=doc.created_by,
        updated_by=names.get(doc.updated_by) if doc.updated_by else None,
        updated_by_id=doc.updated_by,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
        archived_at=doc.archived_at,
        deleted_at=doc.deleted_at,
        deleted_by=names.get(doc.deleted_by) if doc.deleted_by else None,
        original_folder_id=doc.original_folder_id,
        tags=doc.tags or [],
        view_count=doc.view_count,
        template_id=doc.template_id,
        is_private=doc.is_private,
        is_wiki=doc.is_wiki,
        is_protected=doc.is_protected,
        icon=doc.icon,
        cover_url=doc.cover_url,
        page_settings=normalize_page_settings(doc.page_settings),
        public_enabled=doc.public_enabled,
        is_shared=is_shared,
        folder_name=folder_name,
        comment_count=comment_count,
        share_member_count=share_member_count,
        user_role=role,
        last_viewed_at=last_viewed_at,
    )


def comment_out(db: Session, comment: DocumentComment) -> DocumentCommentOut:
    author = db.get(User, comment.author_id)
    anchor = None
    if comment.inline_marker_id:
        anchor = InlineAnchorOut(marker_id=comment.inline_marker_id, quote=comment.inline_quote or "")
    return DocumentCommentOut(
        id=comment.id,
        document_id=comment.document_id,
        author_id=comment.author_id,
        author_name=display_name(author),
        body=comment.body,
        parent_id=comment.parent_id,
        inline_anchor=anchor,
        resolved=comment.resolved,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


def version_out(db: Session, version: DocumentVersion) -> DocumentVersionOut:
    author = db.get(User, version.author_id)
    return DocumentVersionOut(
        id=version.id,
        document_id=version.document_id,
        version_number=version.version_number,
        title=version.title,
        content=version.content,
        author_id=version.author_id,
        author_name=display_name(author),
        summary=version.summary,
        word_count=version.word_count,
        created_at=version.created_at,
    )


def activity_out(db: Session, event: DocumentActivity) -> DocumentActivityOut:
    actor = db.get(User, event.actor_id)
    return DocumentActivityOut(
        id=event.id,
        document_id=event.document_id,
        type=event.type,
        actor_id=event.actor_id,
        actor_name=display_name(actor),
        detail=event.detail,
        at=event.created_at,
    )


def share_out(db: Session, doc: Document) -> DocumentShareOut:
    members = db.scalars(
        select(DocumentShareMember).where(DocumentShareMember.document_id == doc.id)
    ).all()
    user_ids = {m.user_id for m in members} | {m.created_by for m in members if m.created_by}
    briefs = user_briefs(db, list(user_ids))
    added_by_names = name_map(db, {m.created_by for m in members if m.created_by})
    member_outs: list[ShareMemberOut] = []
    for m in members:
        brief = briefs.get(m.user_id)
        member_outs.append(
            ShareMemberOut(
                id=m.id,
                type="user",
                target_id=m.user_id,
                name=brief.full_name if brief else "User",
                email=brief.email if brief else None,
                avatar_url=brief.avatar_url if brief else None,
                avatar_color=brief.avatar_color if brief else None,
                role=m.role,
                added_at=m.created_at,
                added_by=added_by_names.get(m.created_by, "Unknown") if m.created_by else "Unknown",
            )
        )
    public_url = None
    if doc.public_enabled and doc.public_token:
        public_url = f"{settings.FRONTEND_URL.rstrip('/')}/d/{doc.public_token}"
    return DocumentShareOut(
        document_id=doc.id,
        is_private=doc.is_private,
        public_enabled=doc.public_enabled,
        public_token=doc.public_token if doc.public_enabled else None,
        public_url=public_url,
        members=member_outs,
    )


def log_activity(
    db: Session,
    *,
    document_id: uuid.UUID,
    type: str,
    actor_id: uuid.UUID,
    detail: str = "",
) -> DocumentActivity:
    event = DocumentActivity(document_id=document_id, type=type, actor_id=actor_id, detail=detail)
    db.add(event)
    return event


def next_version_number(db: Session, document_id: uuid.UUID) -> int:
    current = db.scalar(
        select(func.max(DocumentVersion.version_number)).where(DocumentVersion.document_id == document_id)
    )
    return (current or 0) + 1


def create_version(
    db: Session,
    *,
    doc: Document,
    author_id: uuid.UUID,
    summary: str = "Auto-saved",
) -> DocumentVersion:
    version = DocumentVersion(
        document_id=doc.id,
        version_number=next_version_number(db, doc.id),
        title=doc.title,
        content=doc.content,
        author_id=author_id,
        summary=summary,
        word_count=word_count(doc.content),
    )
    db.add(version)
    return version


def ensure_public_token(doc: Document) -> None:
    if doc.public_enabled and not doc.public_token:
        doc.public_token = secrets.token_urlsafe(24)


def workspace_member_ids(db: Session, workspace_id: uuid.UUID) -> set[uuid.UUID]:
    """User ids who belong to this workspace for @All / people mentions.

    Matches the People picker: explicit WorkspaceMember rows plus org owners/admins
    who have implicit workspace access but may lack a membership row.
    """
    ids = set(
        db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)).all()
    )
    org_id = db.scalar(select(Workspace.organization_id).where(Workspace.id == workspace_id))
    if org_id is not None:
        ids.update(
            db.scalars(
                select(OrganizationMember.user_id).where(
                    OrganizationMember.organization_id == org_id,
                    OrganizationMember.role.in_(("owner", "admin")),
                )
            ).all()
        )
    return ids


def document_accessible_user_ids(db: Session, doc: Document) -> set[uuid.UUID]:
    """Users who can open this document (targets for @all).

    Private docs: owner + explicit share members.
    Workspace-visible docs: every workspace member.
    """
    if doc.is_private:
        ids = {doc.created_by}
        ids.update(
            db.scalars(
                select(DocumentShareMember.user_id).where(DocumentShareMember.document_id == doc.id)
            ).all()
        )
        return ids
    return workspace_member_ids(db, doc.workspace_id)


def doc_url(document_id: uuid.UUID) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/app/docs/{document_id}"


def batch_shared_doc_ids(db: Session, doc_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not doc_ids:
        return set()
    return set(
        db.scalars(
            select(DocumentShareMember.document_id).where(DocumentShareMember.document_id.in_(doc_ids))
        ).all()
    )


def batch_share_counts(db: Session, doc_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not doc_ids:
        return {}
    rows = db.execute(
        select(DocumentShareMember.document_id, func.count())
        .where(DocumentShareMember.document_id.in_(doc_ids))
        .group_by(DocumentShareMember.document_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def batch_comment_counts(db: Session, doc_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not doc_ids:
        return {}
    rows = db.execute(
        select(DocumentComment.document_id, func.count())
        .where(DocumentComment.document_id.in_(doc_ids), DocumentComment.deleted_at.is_(None))
        .group_by(DocumentComment.document_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def batch_folder_names(db: Session, folder_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not folder_ids:
        return {}
    rows = db.scalars(select(DocFolder).where(DocFolder.id.in_(folder_ids))).all()
    return {f.id: f.name for f in rows}


def batch_recent_map(db: Session, user_id: uuid.UUID, doc_ids: list[uuid.UUID]) -> dict[uuid.UUID, datetime]:
    if not doc_ids:
        return {}
    rows = db.scalars(
        select(DocumentRecent).where(
            DocumentRecent.user_id == user_id,
            DocumentRecent.document_id.in_(doc_ids),
        )
    ).all()
    return {r.document_id: r.opened_at for r in rows}


def _parse_day(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=timezone.utc)
    except ValueError:
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return None


def _day_start(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _day_end(dt: datetime) -> datetime:
    return dt.replace(hour=23, minute=59, second=59, microsecond=999999)


def _match_date(value: datetime | None, op: str, needle: str) -> bool:
    if value is None:
        return False
    target = _parse_day(needle)
    if not target:
        return True
    if op == "on":
        return _day_start(value) == _day_start(target)
    if op == "before":
        return value < _day_start(target)
    if op == "after":
        return value > _day_end(target)
    return True


def apply_filter_rules(
    db: Session,
    docs: list[Document],
    rules: list[dict],
    *,
    user_id: uuid.UUID,
    shared_ids: set[uuid.UUID],
    recent: dict[uuid.UUID, datetime],
) -> list[Document]:
    if not rules:
        return docs
    author_ids = {d.created_by for d in docs}
    author_ids.update(d.updated_by for d in docs if d.updated_by)
    names = name_map(db, author_ids)
    out: list[Document] = []
    for doc in docs:
        ok = True
        for rule in rules:
            field = rule.get("field", "")
            op = rule.get("operator", "is")
            val = (rule.get("value") or "").strip()
            if not val and field not in ("wiki",):
                continue
            if field == "title":
                title = doc.title.lower()
                needle = val.lower()
                if op == "contains" and needle not in title:
                    ok = False
                elif op == "equals" and title != needle:
                    ok = False
                elif op == "not_equals" and title == needle:
                    ok = False
            elif field == "location":
                loc = str(doc.folder_id) if doc.folder_id else "__root__"
                if op in ("is", "equals") and loc != val:
                    ok = False
                elif op == "is_not" and loc == val:
                    ok = False
            elif field == "tag":
                tags = [t.lower() for t in (doc.tags or [])]
                needle = val.lower()
                if op == "contains" and not any(needle in t for t in tags):
                    ok = False
                elif op in ("is", "equals") and needle not in tags:
                    ok = False
                elif op == "is_not" and needle in tags:
                    ok = False
            elif field == "owner":
                owner_val = str(doc.created_by)
                owner_name = names.get(doc.created_by, "").lower()
                if op in ("is", "equals") and owner_val != val and owner_name != val.lower():
                    ok = False
                elif op == "is_not" and (owner_val == val or owner_name == val.lower()):
                    ok = False
            elif field == "contributors":
                if not doc.updated_by:
                    ok = False
                else:
                    contrib_val = str(doc.updated_by)
                    contrib_name = names.get(doc.updated_by, "").lower()
                    if op in ("is", "equals") and contrib_val != val and contrib_name != val.lower():
                        ok = False
                    elif op == "is_not" and (contrib_val == val or contrib_name == val.lower()):
                        ok = False
            elif field == "sharing":
                sharing = "public" if doc.public_enabled else "shared" if doc.id in shared_ids else "private"
                if op in ("is", "equals") and sharing != val:
                    ok = False
                elif op == "is_not" and sharing == val:
                    ok = False
            elif field == "wiki":
                want = val.lower() in ("true", "yes", "1")
                if op in ("is", "equals") and doc.is_wiki != want:
                    ok = False
                elif op == "is_not" and doc.is_wiki == want:
                    ok = False
            elif field == "dateViewed":
                if not _match_date(recent.get(doc.id), op, val):
                    ok = False
            elif field == "dateUpdated":
                if not _match_date(doc.updated_at, op, val):
                    ok = False
            elif field == "dateCreated":
                if not _match_date(doc.created_at, op, val):
                    ok = False
            if not ok:
                break
        if ok:
            out.append(doc)
    return out


def sort_doc_list(
    docs: list[Document],
    sort_by: str,
    sort_dir: str,
    recent: dict[uuid.UUID, datetime],
) -> list[Document]:
    reverse = sort_dir != "asc"
    min_dt = datetime.min.replace(tzinfo=timezone.utc)

    def viewed_at(d: Document) -> datetime:
        return recent.get(d.id) or min_dt

    key_fn = {
        "created_at": lambda d: d.created_at,
        "updated_at": lambda d: d.updated_at,
        "viewed_at": viewed_at,
    }.get(sort_by, lambda d: d.updated_at)
    return sorted(docs, key=key_fn, reverse=reverse)


def _can_view_task(perms: PermissionService, task: Task) -> bool:
    try:
        perms.require_task_view(task)
        return True
    except HTTPException:
        return False


def _can_view_doc(db: Session, perms: PermissionService, doc: Document) -> bool:
    try:
        require_doc_view(db, perms, doc)
        return True
    except HTTPException:
        return False


def resolve_link_row(
    db: Session,
    perms: PermissionService,
    link: DocumentLink,
) -> DocumentLinkOut | None:
    if link.target_type == "task":
        task = db.get(Task, link.target_id)
        if not task or task.deleted_at is not None:
            return None
        if not _can_view_task(perms, task):
            return None
        project = db.get(Project, task.project_id)
        subtitle = project.name if project else "Task"
        return DocumentLinkOut(
            id=link.id,
            target_type="task",
            target_id=task.id,
            title=task.title,
            subtitle=subtitle,
            icon=None,
            href=f"/app/tasks/{task.id}",
        )
    if link.target_type == "document":
        target = db.get(Document, link.target_id)
        if not target or target.deleted_at is not None:
            return None
        if not _can_view_doc(db, perms, target):
            return None
        folder_name = None
        if target.folder_id:
            folder = db.get(DocFolder, target.folder_id)
            folder_name = folder.name if folder else None
        return DocumentLinkOut(
            id=link.id,
            target_type="document",
            target_id=target.id,
            title=target.title,
            subtitle=folder_name or "Document",
            icon=target.icon,
            href=f"/app/docs/{target.id}",
        )
    return None


def links_out(db: Session, perms: PermissionService, doc: Document) -> DocumentLinksOut:
    rows = db.scalars(select(DocumentLink).where(DocumentLink.document_id == doc.id).order_by(DocumentLink.created_at)).all()
    links: list[DocumentLinkOut] = []
    for row in rows:
        resolved = resolve_link_row(db, perms, row)
        if resolved:
            links.append(resolved)
    return DocumentLinksOut(links=links)


def validate_link_target(
    db: Session,
    perms: PermissionService,
    doc: Document,
    *,
    target_type: str,
    target_id: uuid.UUID,
) -> None:
    if target_type == "document":
        if target_id == doc.id:
            raise HTTPException(status_code=400, detail="Cannot link a document to itself")
        target = db.get(Document, target_id)
        if not target or target.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Document not found")
        if target.workspace_id != doc.workspace_id:
            raise HTTPException(status_code=400, detail="Document is in another workspace")
        require_doc_view(db, perms, target)
        return
    if target_type == "task":
        task = db.get(Task, target_id)
        if not task or task.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Task not found")
        perms.require_task_view(task)
        return
    raise HTTPException(status_code=400, detail="Invalid link target type")


# ── Doc folders (privacy / share) ─────────────────────────────────


def user_can_view_folder(db: Session, perms: PermissionService, folder: DocFolder) -> bool:
    try:
        perms.require_workspace_member(folder.workspace_id)
    except PermissionError403:
        return False
    if not folder.is_private:
        return True
    if folder.created_by == perms.user.id:
        return True
    return (
        db.scalar(
            select(DocFolderShareMember.id).where(
                DocFolderShareMember.folder_id == folder.id,
                DocFolderShareMember.user_id == perms.user.id,
            ).limit(1)
        )
        is not None
    )


def require_folder_view(db: Session, perms: PermissionService, folder: DocFolder) -> DocFolder:
    if not user_can_view_folder(db, perms, folder):
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def require_folder_manage(db: Session, perms: PermissionService, folder: DocFolder) -> DocFolder:
    """Rename/delete folder when user owns it, can edit it, or is a workspace admin."""
    require_folder_view(db, perms, folder)
    if folder.created_by == perms.user.id:
        return folder
    share = db.scalar(
        select(DocFolderShareMember).where(
            DocFolderShareMember.folder_id == folder.id,
            DocFolderShareMember.user_id == perms.user.id,
        )
    )
    if share and share.role == "editor":
        return folder
    perms.require_workspace_admin(folder.workspace_id)
    return folder


def assert_folder_share_user_is_workspace_member(
    db: Session, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    member = db.scalar(
        select(WorkspaceMember.id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=422, detail="User must be a workspace member")


def folder_share_state(db: Session, folder: DocFolder) -> DocFolderShareState:
    members = db.scalars(
        select(DocFolderShareMember).where(DocFolderShareMember.folder_id == folder.id)
    ).all()
    briefs = user_briefs(db, [m.user_id for m in members])
    return DocFolderShareState(
        folder_id=folder.id,
        is_private=folder.is_private,
        members=[
            DocFolderShareMemberOut(user_id=m.user_id, role=m.role, user=briefs.get(m.user_id))
            for m in members
        ],
    )


def visible_folders(db: Session, perms: PermissionService, workspace_id: uuid.UUID) -> list[DocFolder]:
    perms.require_workspace_member(workspace_id)
    folders = db.scalars(
        select(DocFolder).where(DocFolder.workspace_id == workspace_id).order_by(DocFolder.name)
    ).all()
    return [f for f in folders if user_can_view_folder(db, perms, f)]
