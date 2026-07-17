"""FlowDesk Docs — folders, documents, comments, sharing, versions, favorites, recent."""
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_permissions
from app.core.websocket import emit
from app.db.session import get_db
from app.models.document import (
    DocFolder,
    DocFolderShareMember,
    Document,
    DocumentActivity,
    DocumentComment,
    DocumentFavorite,
    DocumentLink,
    DocumentRecent,
    DocumentShareMember,
    DocumentTemplate,
    DocumentVersion,
)
from app.models.organization import OrganizationMember
from app.models.user import User
from app.models.workspace import Workspace
from app.schemas.common import Message
from app.schemas.document import (
    DocFolderCreate,
    DocFolderOut,
    DocFolderShareMemberAdd,
    DocFolderShareMemberUpdate,
    DocFolderShareState,
    DocFolderShareUpdate,
    DocFolderUpdate,
    DocTemplateCreate,
    DocTemplateOut,
    DocTemplateUpdate,
    DocumentActivityOut,
    DocumentBodyMentionIn,
    DocumentCommentCreate,
    DocumentCommentOut,
    DocumentCommentUpdate,
    DocumentCreate,
    DocumentFavoriteCreate,
    DocumentFavoriteOut,
    DocumentImportIn,
    DocumentLinkCreate,
    DocumentLinkOut,
    DocumentLinksOut,
    DocumentListOut,
    DocumentOut,
    DocumentRecentOut,
    DocumentShareOut,
    DocumentShareUpdate,
    DocumentUpdate,
    DocumentVersionCreate,
    DocumentVersionOut,
    PublicDocumentOut,
    ShareMemberCreate,
    ShareMemberOut,
    ShareMemberUpdate,
)
from app.services import doc_export_service, doc_service
from app.services.mention_service import (
    create_mentions,
    excerpt,
    notify_doc_people_mentions,
    notify_new_doc_body_mentions,
)
from app.services.notification_service import notify
from app.services.permission_service import PermissionError403, PermissionService

router = APIRouter(tags=["docs"])

MAX_RECENT = 50


# ── Helpers ────────────────────────────────────────────────────────


def _visible_documents(db: Session, perms: PermissionService, workspace_id: uuid.UUID) -> list[Document]:
    perms.require_workspace_member(workspace_id)
    docs = db.scalars(select(Document).where(Document.workspace_id == workspace_id)).all()
    return [d for d in docs if doc_service.user_can_view_doc(db, perms, d)]


def _get_folder(db: Session, perms: PermissionService, folder_id: uuid.UUID) -> DocFolder:
    folder = db.get(DocFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return doc_service.require_folder_view(db, perms, folder)


def _collect_descendant_folder_ids(db: Session, root_id: uuid.UUID) -> list[uuid.UUID]:
    all_folders = db.scalars(select(DocFolder).where(DocFolder.workspace_id == db.get(DocFolder, root_id).workspace_id)).all()
    by_parent: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for f in all_folders:
        by_parent.setdefault(f.parent_id, []).append(f.id)
    ids = [root_id]
    queue = [root_id]
    while queue:
        current = queue.pop(0)
        for child in by_parent.get(current, []):
            ids.append(child)
            queue.append(child)
    return ids


# ── Folders ────────────────────────────────────────────────────────


@router.get("/workspaces/{workspace_id}/doc-folders", response_model=list[DocFolderOut])
def list_folders(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    return doc_service.visible_folders(db, perms, workspace_id)


@router.post("/workspaces/{workspace_id}/doc-folders", response_model=DocFolderOut, status_code=201)
def create_folder(
    workspace_id: uuid.UUID,
    body: DocFolderCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    if body.parent_id:
        parent = _get_folder(db, perms, body.parent_id)
        if parent.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Parent folder is in another workspace")
    folder = DocFolder(
        workspace_id=workspace_id,
        name=body.name.strip(),
        parent_id=body.parent_id,
        created_by=perms.user.id,
        is_private=False,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.patch("/doc-folders/{folder_id}", response_model=DocFolderOut)
def update_folder(
    folder_id: uuid.UUID,
    body: DocFolderUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    doc_service.require_folder_manage(db, perms, folder)
    if body.name is not None:
        folder.name = body.name.strip()
    if body.parent_id is not None:
        if body.parent_id == folder.id:
            raise HTTPException(status_code=400, detail="A folder cannot be its own parent")
        if body.parent_id:
            parent = _get_folder(db, perms, body.parent_id)
            if parent.workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="Parent folder is in another workspace")
            descendants = _collect_descendant_folder_ids(db, folder.id)
            if body.parent_id in descendants:
                raise HTTPException(status_code=400, detail="Cannot move a folder into its descendant")
        folder.parent_id = body.parent_id
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/doc-folders/{folder_id}", response_model=Message)
def delete_folder(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    doc_service.require_folder_manage(db, perms, folder)
    folder_ids = _collect_descendant_folder_ids(db, folder.id)
    now = datetime.now(timezone.utc)
    docs = db.scalars(
        select(Document).where(
            Document.workspace_id == folder.workspace_id,
            Document.folder_id.in_(folder_ids),
            Document.deleted_at.is_(None),
        )
    ).all()
    for doc in docs:
        doc.deleted_at = now
        doc.deleted_by = perms.user.id
        doc.original_folder_id = doc.folder_id
    db.execute(delete(DocumentFavorite).where(DocumentFavorite.target_id.in_(folder_ids)))
    db.execute(delete(DocFolder).where(DocFolder.id.in_(folder_ids)))
    db.commit()
    return Message(detail="Folder deleted")


@router.get("/doc-folders/{folder_id}/share", response_model=DocFolderShareState)
def get_doc_folder_share(
    folder_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    return doc_service.folder_share_state(db, folder)


@router.patch("/doc-folders/{folder_id}/share", response_model=DocFolderShareState)
def update_doc_folder_share(
    folder_id: uuid.UUID,
    body: DocFolderShareUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    doc_service.require_folder_manage(db, perms, folder)
    if body.is_private is not None:
        folder.is_private = body.is_private
    db.commit()
    db.refresh(folder)
    return doc_service.folder_share_state(db, folder)


@router.post("/doc-folders/{folder_id}/share/members", response_model=DocFolderShareState, status_code=201)
def add_doc_folder_share_member(
    folder_id: uuid.UUID,
    body: DocFolderShareMemberAdd,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    doc_service.require_folder_manage(db, perms, folder)
    doc_service.assert_folder_share_user_is_workspace_member(db, folder.workspace_id, body.user_id)
    existing = db.scalar(
        select(DocFolderShareMember).where(
            DocFolderShareMember.folder_id == folder.id,
            DocFolderShareMember.user_id == body.user_id,
        )
    )
    if existing:
        existing.role = body.role
    else:
        db.add(
            DocFolderShareMember(
                folder_id=folder.id,
                user_id=body.user_id,
                role=body.role,
                created_by=perms.user.id,
            )
        )
    if not folder.is_private:
        folder.is_private = True
    db.commit()
    db.refresh(folder)
    return doc_service.folder_share_state(db, folder)


@router.delete("/doc-folders/{folder_id}/share/members/{user_id}", response_model=DocFolderShareState)
def remove_doc_folder_share_member(
    folder_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    doc_service.require_folder_manage(db, perms, folder)
    member = db.scalar(
        select(DocFolderShareMember).where(
            DocFolderShareMember.folder_id == folder.id,
            DocFolderShareMember.user_id == user_id,
        )
    )
    if member:
        db.delete(member)
        db.commit()
        db.refresh(folder)
    return doc_service.folder_share_state(db, folder)


@router.patch("/doc-folders/{folder_id}/share/members/{user_id}", response_model=DocFolderShareState)
def update_doc_folder_share_member(
    folder_id: uuid.UUID,
    user_id: uuid.UUID,
    body: DocFolderShareMemberUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    folder = _get_folder(db, perms, folder_id)
    doc_service.require_folder_manage(db, perms, folder)
    member = db.scalar(
        select(DocFolderShareMember).where(
            DocFolderShareMember.folder_id == folder.id,
            DocFolderShareMember.user_id == user_id,
        )
    )
    if not member:
        raise HTTPException(status_code=404, detail="Share member not found")
    member.role = body.role
    db.commit()
    db.refresh(folder)
    return doc_service.folder_share_state(db, folder)


# ── Documents ──────────────────────────────────────────────────────


@router.get("/workspaces/{workspace_id}/documents", response_model=list[DocumentListOut])
def list_documents(
    workspace_id: uuid.UUID,
    deleted: bool | None = Query(default=None),
    archived: bool | None = Query(default=None),
    folder_id: uuid.UUID | None = Query(default=None),
    q: str | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine|shared|private)$"),
    is_wiki: bool | None = Query(default=None),
    sort_by: str = Query(default="updated_at", pattern="^(created_at|updated_at|viewed_at)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    filter_rules: str | None = Query(default=None, description="JSON array of filter rules"),
    tags: list[str] | None = Query(default=None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    me = perms.user.id
    docs = _visible_documents(db, perms, workspace_id)
    if deleted is True:
        docs = [d for d in docs if d.deleted_at is not None]
    elif deleted is False or deleted is None:
        docs = [d for d in docs if d.deleted_at is None]
    if archived is True:
        docs = [d for d in docs if d.archived_at is not None and d.deleted_at is None]
    elif archived is False:
        docs = [d for d in docs if d.archived_at is None]
    if folder_id is not None:
        docs = [d for d in docs if d.folder_id == folder_id]
    if is_wiki is not None:
        docs = [d for d in docs if d.is_wiki == is_wiki]
    if scope == "mine":
        docs = [d for d in docs if d.created_by == me]
    elif scope == "shared":
        docs = [d for d in docs if doc_service.is_shared_with_user(db, d, me)]
    elif scope == "private":
        docs = [d for d in docs if d.created_by == me and d.is_private]
    if q:
        needle = q.strip().lower()
        docs = [d for d in docs if needle in d.title.lower() or needle in (d.content or "").lower()]
    if tags:
        tag_set = {t.strip().lower() for t in tags if t.strip()}
        if tag_set:
            docs = [d for d in docs if tag_set.issubset({t.lower() for t in (d.tags or [])})]

    parsed_rules: list[dict] = []
    if filter_rules:
        try:
            raw = json.loads(filter_rules)
            if isinstance(raw, list):
                parsed_rules = [r for r in raw if isinstance(r, dict)]
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid filter_rules JSON")

    doc_ids = [d.id for d in docs]
    shared_ids = doc_service.batch_shared_doc_ids(db, doc_ids)
    recent = doc_service.batch_recent_map(db, me, doc_ids)
    docs = doc_service.apply_filter_rules(
        db, docs, parsed_rules, user_id=me, shared_ids=shared_ids, recent=recent
    )
    docs = doc_service.sort_doc_list(docs, sort_by, sort_dir, recent)
    folder_ids = {d.folder_id for d in docs if d.folder_id}
    folder_names = doc_service.batch_folder_names(db, folder_ids)
    comment_counts = doc_service.batch_comment_counts(db, doc_ids)
    share_counts = doc_service.batch_share_counts(db, doc_ids)
    return [
        doc_service.document_out(
            db,
            d,
            me,
            last_viewed_at=recent.get(d.id),
            is_shared=d.id in shared_ids,
            folder_name=folder_names.get(d.folder_id) if d.folder_id else None,
            comment_count=comment_counts.get(d.id, 0),
            share_member_count=share_counts.get(d.id, 0),
        )
        for d in docs
    ]


@router.post("/workspaces/{workspace_id}/documents", response_model=DocumentOut, status_code=201)
def create_document(
    workspace_id: uuid.UUID,
    body: DocumentCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    if body.folder_id:
        folder = _get_folder(db, perms, body.folder_id)
        if folder.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Folder is in another workspace")
    doc = Document(
        workspace_id=workspace_id,
        folder_id=body.folder_id,
        title=body.title.strip() or "Untitled",
        content=body.content or "",
        status=body.status,
        created_by=perms.user.id,
        updated_by=perms.user.id,
        tags=body.tags or [],
        template_id=body.template_id,
        is_private=True,
        is_wiki=body.is_wiki,
        icon=body.icon,
    )
    db.add(doc)
    db.flush()
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="created",
        actor_id=perms.user.id,
        detail="Created wiki" if body.is_wiki else "Created document",
    )
    db.commit()
    db.refresh(doc)
    emit(
        "doc.created",
        [f"workspace:{workspace_id}"],
        payload={"document_id": str(doc.id), "actor_id": str(perms.user.id)},
        workspace_id=workspace_id,
    )
    return doc_service.document_out(db, doc, perms.user.id)


@router.post("/workspaces/{workspace_id}/documents/import", response_model=DocumentOut, status_code=201)
def import_document(
    workspace_id: uuid.UUID,
    body: DocumentImportIn,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    if body.folder_id:
        folder = _get_folder(db, perms, body.folder_id)
        if folder.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Folder is in another workspace")
    doc = Document(
        workspace_id=workspace_id,
        folder_id=body.folder_id,
        title=body.title.strip() or "Imported document",
        content=body.content or "",
        status="draft",
        created_by=perms.user.id,
        updated_by=perms.user.id,
        tags=[],
        is_private=True,
        page_settings={},
    )
    db.add(doc)
    db.flush()
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="created",
        actor_id=perms.user.id,
        detail=f"Imported document ({body.format})",
    )
    db.commit()
    db.refresh(doc)
    emit(
        "doc.created",
        [f"workspace:{workspace_id}"],
        payload={"document_id": str(doc.id), "actor_id": str(perms.user.id)},
        workspace_id=workspace_id,
    )
    return doc_service.document_out(db, doc, perms.user.id)


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    return doc_service.document_out(db, doc, perms.user.id)


@router.get("/documents/{document_id}/export", include_in_schema=True)
def export_document(
    document_id: uuid.UUID,
    format: str = Query("text", pattern="^(pdf|docx|text)$"),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    try:
        data, media_type, filename = doc_export_service.export_document(doc.title, doc.content, format)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch("/documents/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: uuid.UUID,
    body: DocumentUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    if doc.deleted_at:
        raise HTTPException(status_code=400, detail="Cannot edit a trashed document")
    if doc.archived_at:
        raise HTTPException(status_code=400, detail="Cannot edit an archived document")
    # A protected doc's content is locked; only the owner may change content or the protection flag.
    is_owner = doc_service.resolve_user_role(db, doc, perms.user.id) == "owner"
    if doc.is_protected and body.content is not None and not is_owner:
        raise HTTPException(status_code=403, detail="This document is protected — only the owner can edit it")
    if body.is_protected is not None and not is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can change protection")
    detail = "Edited document"
    previous_content = doc.content
    if body.title is not None and body.title != doc.title:
        detail = f'Renamed to "{body.title.strip()}"'
        doc.title = body.title.strip() or doc.title
    if body.content is not None:
        doc.content = body.content
    if body.status is not None:
        doc.status = body.status
    if "icon" in body.model_fields_set:
        doc.icon = body.icon or None
    if body.is_wiki is not None:
        doc.is_wiki = body.is_wiki
        detail = "Marked as wiki" if body.is_wiki else "Unmarked wiki"
    if body.is_protected is not None:
        doc.is_protected = body.is_protected
        detail = "Protected document" if body.is_protected else "Unprotected document"
    if body.folder_id is not None:
        if body.folder_id:
            folder = _get_folder(db, perms, body.folder_id)
            if folder.workspace_id != doc.workspace_id:
                raise HTTPException(status_code=400, detail="Folder is in another workspace")
        doc.folder_id = body.folder_id
        detail = "Moved document"
    if body.tags is not None:
        doc.tags = body.tags
    if "cover_url" in body.model_fields_set:
        doc.cover_url = body.cover_url or None
        detail = "Updated cover"
    if body.page_settings is not None:
        merged = dict(doc.page_settings or {})
        merged.update(body.page_settings)
        doc.page_settings = merged
        detail = "Updated page settings"
    doc.updated_by = perms.user.id
    if body.create_version:
        doc_service.create_version(db, doc=doc, author_id=perms.user.id, summary=body.version_summary)
    if body.content is not None and body.content != previous_content:
        workspace_ids = doc_service.workspace_member_ids(db, doc.workspace_id)
        notify_new_doc_body_mentions(
            db,
            author=perms.user,
            allowed_user_ids=workspace_ids,
            all_user_ids=workspace_ids,
            document_id=doc.id,
            previous_html=previous_content,
            next_html=body.content,
            context_label=f'"{doc.title}"',
            url=doc_service.doc_url(doc.id),
            workspace_id=doc.workspace_id,
        )
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="renamed" if "Renamed" in detail else "edited" if body.content is not None else "moved" if "Moved" in detail else "edited",
        actor_id=perms.user.id,
        detail=detail,
    )
    db.commit()
    db.refresh(doc)
    emit(
        "doc.updated",
        [f"workspace:{doc.workspace_id}"],
        payload={"document_id": str(doc.id), "actor_id": str(perms.user.id)},
        workspace_id=doc.workspace_id,
    )
    return doc_service.document_out(db, doc, perms.user.id)


@router.post("/documents/{document_id}/duplicate", response_model=DocumentOut, status_code=201)
def duplicate_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    source = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, source, perms.user.id, "viewer")
    copy = Document(
        workspace_id=source.workspace_id,
        folder_id=source.folder_id,
        title=f"{source.title} (Copy)",
        content=source.content,
        status="draft",
        created_by=perms.user.id,
        updated_by=perms.user.id,
        tags=list(source.tags or []),
        is_private=source.is_private,
        is_wiki=source.is_wiki,
        is_protected=source.is_protected,
        icon=source.icon,
        cover_url=source.cover_url,
        page_settings=dict(source.page_settings or {}),
        public_enabled=False,
        public_token=None,
    )
    db.add(copy)
    db.flush()
    doc_service.log_activity(db, document_id=copy.id, type="created", actor_id=perms.user.id, detail="Duplicated document")
    db.commit()
    db.refresh(copy)
    return doc_service.document_out(db, copy, perms.user.id)


@router.post("/documents/{document_id}/archive", response_model=DocumentOut)
def archive_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    doc.archived_at = datetime.now(timezone.utc)
    doc_service.log_activity(db, document_id=doc.id, type="archived", actor_id=perms.user.id, detail="Archived document")
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


@router.post("/documents/{document_id}/unarchive", response_model=DocumentOut)
def unarchive_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    doc.archived_at = None
    doc_service.log_activity(db, document_id=doc.id, type="restored", actor_id=perms.user.id, detail="Unarchived document")
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


@router.post("/documents/{document_id}/trash", response_model=DocumentOut)
def trash_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    doc.deleted_at = datetime.now(timezone.utc)
    doc.deleted_by = perms.user.id
    doc.original_folder_id = doc.folder_id
    doc_service.log_activity(db, document_id=doc.id, type="deleted", actor_id=perms.user.id, detail="Moved to trash")
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


@router.post("/documents/{document_id}/restore", response_model=DocumentOut)
def restore_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    original = doc.original_folder_id
    if original:
        folder = db.get(DocFolder, original)
        doc.folder_id = original if folder else None
    doc.deleted_at = None
    doc.deleted_by = None
    doc.original_folder_id = None
    doc_service.log_activity(db, document_id=doc.id, type="restored", actor_id=perms.user.id, detail="Restored from trash")
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


@router.delete("/documents/{document_id}", response_model=Message)
def delete_document_permanent(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    if doc.created_by != perms.user.id:
        doc_service.require_doc_role(db, doc, perms.user.id, "owner")
    if not doc.deleted_at:
        raise HTTPException(status_code=400, detail="Document must be in trash before permanent delete")
    db.execute(delete(DocumentFavorite).where(DocumentFavorite.target_id == doc.id))
    db.execute(delete(DocumentRecent).where(DocumentRecent.document_id == doc.id))
    db.delete(doc)
    db.commit()
    return Message(detail="Document permanently deleted")


@router.post("/documents/{document_id}/open", response_model=DocumentOut)
def open_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc.view_count += 1
    now = datetime.now(timezone.utc)
    recent = db.scalar(
        select(DocumentRecent).where(
            DocumentRecent.user_id == perms.user.id,
            DocumentRecent.document_id == doc.id,
        )
    )
    if recent:
        recent.opened_at = now
    else:
        db.add(DocumentRecent(user_id=perms.user.id, document_id=doc.id, opened_at=now))
    excess = db.scalars(
        select(DocumentRecent)
        .where(DocumentRecent.user_id == perms.user.id)
        .order_by(DocumentRecent.opened_at.desc())
        .offset(MAX_RECENT)
    ).all()
    for row in excess:
        db.delete(row)
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


# ── Body mentions (immediate notify on @people pick) ───────────────


@router.post("/documents/{document_id}/body-mentions", response_model=Message)
def notify_document_body_mention(
    document_id: uuid.UUID,
    body: DocumentBodyMentionIn,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    """Fire a doc_mention notification as soon as a people chip is inserted."""
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    if doc.deleted_at or doc.archived_at:
        raise HTTPException(status_code=400, detail="Cannot mention in a trashed or archived document")
    mention_all = body.user_id == "all"
    # Same audience as the People @ picker: workspace members (author excluded later).
    workspace_ids = doc_service.workspace_member_ids(db, doc.workspace_id)
    user_ids = [] if mention_all else [uuid.UUID(body.user_id)]
    created = notify_doc_people_mentions(
        db,
        author=perms.user,
        allowed_user_ids=workspace_ids,
        document_id=doc.id,
        user_ids=user_ids,
        mention_all=mention_all,
        all_user_ids=workspace_ids if mention_all else None,
        context_label=f'"{doc.title}"',
        url=doc_service.doc_url(doc.id),
        workspace_id=doc.workspace_id,
        preview_html=body.preview_html or doc.content,
    )
    db.commit()
    if not created:
        if mention_all and len(workspace_ids - {perms.user.id}) == 0:
            return Message(detail="No teammates in this workspace to notify")
        return Message(detail="No notification sent")
    return Message(detail=f"Mention notification sent ({len(created)})")


# ── Comments ───────────────────────────────────────────────────────


@router.get("/documents/{document_id}/comments", response_model=list[DocumentCommentOut])
def list_comments(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    comments = db.scalars(
        select(DocumentComment)
        .where(DocumentComment.document_id == doc.id, DocumentComment.deleted_at.is_(None))
        .order_by(DocumentComment.created_at)
    ).all()
    return [doc_service.comment_out(db, c) for c in comments]


@router.post("/documents/{document_id}/comments", response_model=DocumentCommentOut, status_code=201)
def create_comment(
    document_id: uuid.UUID,
    body: DocumentCommentCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "commenter")
    if body.parent_id:
        parent = db.get(DocumentComment, body.parent_id)
        if not parent or parent.document_id != doc.id or parent.deleted_at:
            raise HTTPException(status_code=400, detail="Invalid parent comment")
    comment = DocumentComment(
        document_id=doc.id,
        author_id=perms.user.id,
        parent_id=body.parent_id,
        body=body.body.strip(),
        inline_marker_id=body.inline_anchor.marker_id if body.inline_anchor else None,
        inline_quote=body.inline_anchor.quote if body.inline_anchor else None,
    )
    db.add(comment)
    db.flush()
    # People @ picker is workspace-scoped; @all expands to the same audience.
    workspace_ids = doc_service.workspace_member_ids(db, doc.workspace_id)
    create_mentions(
        db,
        body=body.body,
        author=perms.user,
        allowed_user_ids=workspace_ids,
        all_user_ids=workspace_ids,
        document_comment_id=comment.id,
        document_id=doc.id,
        context_label=f'"{doc.title}"',
        url=doc_service.doc_url(doc.id),
        workspace_id=doc.workspace_id,
        notification_type="doc_mention",
    )
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="comment_added",
        actor_id=perms.user.id,
        detail="Replied to a comment" if body.parent_id else "Added a comment",
    )
    db.commit()
    db.refresh(comment)
    emit(
        "doc.comment.created",
        [f"workspace:{doc.workspace_id}"],
        payload={"document_id": str(doc.id), "comment_id": str(comment.id)},
        workspace_id=doc.workspace_id,
    )
    return doc_service.comment_out(db, comment)


@router.patch("/document-comments/{comment_id}", response_model=DocumentCommentOut)
def update_comment(
    comment_id: uuid.UUID,
    body: DocumentCommentUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    comment = db.get(DocumentComment, comment_id)
    if not comment or comment.deleted_at:
        raise HTTPException(status_code=404, detail="Comment not found")
    doc = doc_service.get_document(db, perms, comment.document_id)
    if comment.author_id != perms.user.id:
        doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    if body.body is not None:
        comment.body = body.body.strip()
    if body.resolved is not None:
        comment.resolved = body.resolved
    db.commit()
    db.refresh(comment)
    return doc_service.comment_out(db, comment)


@router.delete("/document-comments/{comment_id}", response_model=Message)
def delete_comment(
    comment_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    comment = db.get(DocumentComment, comment_id)
    if not comment or comment.deleted_at:
        raise HTTPException(status_code=404, detail="Comment not found")
    doc = doc_service.get_document(db, perms, comment.document_id)
    if comment.author_id != perms.user.id:
        doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    comment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return Message(detail="Comment deleted")


# ── Document links (task / doc) ─────────────────────────────────────


@router.get("/documents/{document_id}/links", response_model=DocumentLinksOut)
def list_document_links(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    return doc_service.links_out(db, perms, doc)


@router.post("/documents/{document_id}/links", response_model=DocumentLinkOut, status_code=201)
def add_document_link(
    document_id: uuid.UUID,
    body: DocumentLinkCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    doc_service.validate_link_target(
        db, perms, doc, target_type=body.target_type, target_id=body.target_id
    )
    existing = db.scalar(
        select(DocumentLink).where(
            DocumentLink.document_id == doc.id,
            DocumentLink.target_type == body.target_type,
            DocumentLink.target_id == body.target_id,
        )
    )
    if existing:
        resolved = doc_service.resolve_link_row(db, perms, existing)
        if resolved:
            return resolved
        raise HTTPException(status_code=409, detail="Link already exists")
    link = DocumentLink(
        document_id=doc.id,
        target_type=body.target_type,
        target_id=body.target_id,
        created_by=perms.user.id,
    )
    db.add(link)
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="linked",
        actor_id=perms.user.id,
        detail=f"Linked {body.target_type}",
    )
    db.commit()
    db.refresh(link)
    resolved = doc_service.resolve_link_row(db, perms, link)
    if not resolved:
        raise HTTPException(status_code=500, detail="Failed to resolve link")
    return resolved


@router.delete("/documents/{document_id}/links/{link_id}", response_model=Message)
def remove_document_link(
    document_id: uuid.UUID,
    link_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    link = db.get(DocumentLink, link_id)
    if not link or link.document_id != doc.id:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return Message(detail="Link removed")


# ── Sharing ────────────────────────────────────────────────────────


@router.get("/documents/{document_id}/share", response_model=DocumentShareOut)
def get_share(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    return doc_service.share_out(db, doc)


@router.patch("/documents/{document_id}/share", response_model=DocumentShareOut)
def update_share(
    document_id: uuid.UUID,
    body: DocumentShareUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "owner")
    was_private = doc.is_private
    if body.is_private is not None:
        doc.is_private = body.is_private
        if was_private and not body.is_private:
            # Workspace-wide share: notify other workspace members (same as individual share).
            doc_link = doc_service.doc_url(doc.id)
            for user_id in doc_service.workspace_member_ids(db, doc.workspace_id):
                if user_id == perms.user.id:
                    continue
                notify(
                    db,
                    user_id,
                    "doc_shared",
                    f'"{doc.title}" was shared with your workspace',
                    "Everyone in the workspace can now open this doc.",
                    data={"document_id": str(doc.id), "url": doc_link},
                    workspace_id=doc.workspace_id,
                )
            doc_service.log_activity(
                db,
                document_id=doc.id,
                type="shared",
                actor_id=perms.user.id,
                detail="Shared with workspace members",
            )
        elif not was_private and body.is_private:
            doc_service.log_activity(
                db,
                document_id=doc.id,
                type="shared",
                actor_id=perms.user.id,
                detail="Made document private",
            )
    if body.public_enabled is not None:
        doc.public_enabled = body.public_enabled
        if body.public_enabled:
            doc_service.ensure_public_token(doc)
        doc_service.log_activity(
            db,
            document_id=doc.id,
            type="shared",
            actor_id=perms.user.id,
            detail="Updated public link sharing",
        )
    db.commit()
    db.refresh(doc)
    emit(
        "doc.updated",
        [f"workspace:{doc.workspace_id}"],
        payload={"document_id": str(doc.id), "actor_id": str(perms.user.id), "shared": True},
        workspace_id=doc.workspace_id,
    )
    return doc_service.share_out(db, doc)


@router.post("/documents/{document_id}/share/members", response_model=DocumentShareOut, status_code=201)
def add_share_member(
    document_id: uuid.UUID,
    body: ShareMemberCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    from app.services import email_service, invite_service

    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "owner")
    if body.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot assign owner role via invite")

    ws = db.get(Workspace, doc.workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    sharer = doc_service.display_name(perms.user)
    doc_link = doc_service.doc_url(doc.id)
    user_id = body.user_id

    if not user_id and body.email:
        email = body.email
        existing = db.scalar(select(User).where(func.lower(User.email) == email))
        in_org = existing and db.scalar(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == ws.organization_id,
                OrganizationMember.user_id == existing.id,
            ).limit(1)
        )
        if in_org:
            user_id = existing.id
            if user_id not in doc_service.workspace_member_ids(db, doc.workspace_id):
                invite_service.create_invite(
                    db,
                    inviter=perms.user,
                    email=body.email,
                    scope="workspace",
                    role="member",
                    organization_id=ws.organization_id,
                    workspace_id=doc.workspace_id,
                )
        else:
            invite_service.create_invite(
                db,
                inviter=perms.user,
                email=body.email,
                scope="workspace",
                role="member",
                organization_id=ws.organization_id,
                workspace_id=doc.workspace_id,
            )
            email_service.send_doc_shared_email(body.email, doc.title, sharer, doc_link)
            doc_service.log_activity(
                db,
                document_id=doc.id,
                type="shared",
                actor_id=perms.user.id,
                detail=f"Invited {body.email} as {body.role}",
            )
            db.commit()
            db.refresh(doc)
            return doc_service.share_out(db, doc)

    if not user_id:
        raise HTTPException(status_code=422, detail="Provide a user_id or email")

    allowed = doc_service.workspace_member_ids(db, doc.workspace_id)
    if user_id not in allowed:
        in_org = db.scalar(
            select(OrganizationMember.id).where(
                OrganizationMember.organization_id == ws.organization_id,
                OrganizationMember.user_id == user_id,
            ).limit(1)
        )
        if not in_org:
            raise HTTPException(status_code=400, detail="User is not in this workspace")

    existing = doc_service.get_share_member(db, doc.id, user_id)
    if existing:
        raise HTTPException(status_code=409, detail="User already has access")

    if not doc.is_private:
        doc.is_private = True

    member = DocumentShareMember(
        document_id=doc.id,
        user_id=user_id,
        role=body.role,
        created_by=perms.user.id,
    )
    db.add(member)
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="shared",
        actor_id=perms.user.id,
        detail=f"Shared with user as {body.role}",
    )
    notify(
        db,
        user_id,
        "doc_shared",
        f'"{doc.title}" was shared with you',
        f"You were added as {body.role}.",
        data={"document_id": str(doc.id), "url": doc_link},
        workspace_id=doc.workspace_id,
    )
    target = db.get(User, user_id)
    if target and target.email:
        email_service.send_doc_shared_email(target.email, doc.title, sharer, doc_link)
    db.commit()
    db.refresh(doc)
    emit(
        "doc.updated",
        [f"workspace:{doc.workspace_id}"],
        payload={"document_id": str(doc.id), "actor_id": str(perms.user.id), "shared": True},
        workspace_id=doc.workspace_id,
    )
    return doc_service.share_out(db, doc)


@router.patch("/documents/{document_id}/share/members/{member_id}", response_model=ShareMemberOut)
def update_share_member(
    document_id: uuid.UUID,
    member_id: uuid.UUID,
    body: ShareMemberUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "owner")
    member = db.get(DocumentShareMember, member_id)
    if not member or member.document_id != doc.id:
        raise HTTPException(status_code=404, detail="Share member not found")
    member.role = body.role
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="permission_changed",
        actor_id=perms.user.id,
        detail=f"Changed role to {body.role}",
    )
    notify(
        db,
        member.user_id,
        "doc_permission_changed",
        f'Access to "{doc.title}" changed',
        f"Your role is now {body.role}.",
        data={"document_id": str(doc.id), "url": doc_service.doc_url(doc.id)},
        workspace_id=doc.workspace_id,
    )
    db.commit()
    db.refresh(member)
    share = doc_service.share_out(db, doc)
    updated = next((m for m in share.members if m.id == member_id), None)
    if not updated:
        raise HTTPException(status_code=404, detail="Share member not found")
    return updated


@router.delete("/documents/{document_id}/share/members/{member_id}", response_model=Message)
def remove_share_member(
    document_id: uuid.UUID,
    member_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "owner")
    member = db.get(DocumentShareMember, member_id)
    if not member or member.document_id != doc.id:
        raise HTTPException(status_code=404, detail="Share member not found")
    db.delete(member)
    db.commit()
    return Message(detail="Access removed")


# ── Versions ───────────────────────────────────────────────────────


@router.get("/documents/{document_id}/versions", response_model=list[DocumentVersionOut])
def list_versions(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    versions = db.scalars(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == doc.id)
        .order_by(DocumentVersion.version_number.desc())
    ).all()
    return [doc_service.version_out(db, v) for v in versions]


@router.post("/documents/{document_id}/versions", response_model=DocumentVersionOut, status_code=201)
def create_version(
    document_id: uuid.UUID,
    body: DocumentVersionCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    version = DocumentVersion(
        document_id=doc.id,
        version_number=doc_service.next_version_number(db, doc.id),
        title=body.title,
        content=body.content,
        author_id=perms.user.id,
        summary=body.summary,
        word_count=body.word_count or doc_service.word_count(body.content),
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return doc_service.version_out(db, version)


@router.post("/documents/{document_id}/versions/{version_id}/restore", response_model=DocumentOut)
def restore_version(
    document_id: uuid.UUID,
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    doc_service.require_doc_role(db, doc, perms.user.id, "editor")
    version = db.get(DocumentVersion, version_id)
    if not version or version.document_id != doc.id:
        raise HTTPException(status_code=404, detail="Version not found")
    doc.title = version.title
    doc.content = version.content
    doc.updated_by = perms.user.id
    doc_service.log_activity(
        db,
        document_id=doc.id,
        type="version_restored",
        actor_id=perms.user.id,
        detail=f"Restored version {version.version_number}",
    )
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


# ── Activity ───────────────────────────────────────────────────────


@router.get("/documents/{document_id}/activity", response_model=list[DocumentActivityOut])
def list_activity(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    doc = doc_service.get_document(db, perms, document_id)
    events = db.scalars(
        select(DocumentActivity)
        .where(DocumentActivity.document_id == doc.id)
        .order_by(DocumentActivity.created_at.desc())
    ).all()
    return [doc_service.activity_out(db, e) for e in events]


# ── Favorites ──────────────────────────────────────────────────────


@router.get("/workspaces/{workspace_id}/doc-favorites", response_model=list[DocumentFavoriteOut])
def list_favorites(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    return db.scalars(
        select(DocumentFavorite).where(
            DocumentFavorite.workspace_id == workspace_id,
            DocumentFavorite.user_id == perms.user.id,
        )
    ).all()


@router.post("/workspaces/{workspace_id}/doc-favorites", response_model=DocumentFavoriteOut, status_code=201)
def add_favorite(
    workspace_id: uuid.UUID,
    body: DocumentFavoriteCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    existing = db.scalar(
        select(DocumentFavorite).where(
            DocumentFavorite.user_id == perms.user.id,
            DocumentFavorite.target_id == body.target_id,
        )
    )
    if existing:
        return existing
    fav = DocumentFavorite(
        workspace_id=workspace_id,
        user_id=perms.user.id,
        target_id=body.target_id,
        target_type=body.target_type,
    )
    db.add(fav)
    db.commit()
    db.refresh(fav)
    return fav


@router.delete("/workspaces/{workspace_id}/doc-favorites/{target_id}", response_model=Message)
def remove_favorite(
    workspace_id: uuid.UUID,
    target_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    fav = db.scalar(
        select(DocumentFavorite).where(
            DocumentFavorite.workspace_id == workspace_id,
            DocumentFavorite.user_id == perms.user.id,
            DocumentFavorite.target_id == target_id,
        )
    )
    if fav:
        db.delete(fav)
        db.commit()
    return Message(detail="Favorite removed")


# ── Recent ─────────────────────────────────────────────────────────


@router.get("/users/me/recent-documents", response_model=list[DocumentRecentOut])
def list_recent(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    perms: PermissionService = Depends(get_permissions),
):
    rows = db.scalars(
        select(DocumentRecent)
        .where(DocumentRecent.user_id == user.id)
        .order_by(DocumentRecent.opened_at.desc())
        .limit(MAX_RECENT)
    ).all()
    out: list[DocumentRecentOut] = []
    for row in rows:
        doc = db.get(Document, row.document_id)
        doc_out = doc_service.document_out(db, doc, user.id) if doc and doc_service.user_can_view_doc(db, perms, doc) else None
        out.append(DocumentRecentOut(document_id=row.document_id, opened_at=row.opened_at, document=doc_out))
    return out


@router.delete("/users/me/recent-documents", response_model=Message)
def clear_recent(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.execute(delete(DocumentRecent).where(DocumentRecent.user_id == user.id))
    db.commit()
    return Message(detail="Recent history cleared")


@router.delete("/users/me/recent-documents/{document_id}", response_model=Message)
def remove_recent(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    db.execute(
        delete(DocumentRecent).where(
            DocumentRecent.user_id == user.id,
            DocumentRecent.document_id == document_id,
        )
    )
    db.commit()
    return Message(detail="Removed from recent")


# ── Custom templates ───────────────────────────────────────────────


@router.get("/workspaces/{workspace_id}/doc-templates", response_model=list[DocTemplateOut])
def list_templates(
    workspace_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    return db.scalars(
        select(DocumentTemplate)
        .where(DocumentTemplate.workspace_id == workspace_id)
        .order_by(DocumentTemplate.name)
    ).all()


@router.post("/workspaces/{workspace_id}/doc-templates", response_model=DocTemplateOut, status_code=201)
def create_template(
    workspace_id: uuid.UUID,
    body: DocTemplateCreate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    content = body.content
    icon = body.icon
    # "Save as template" from an existing document copies its current content.
    if body.document_id:
        source = doc_service.get_document(db, perms, body.document_id)
        content = source.content
        icon = icon or source.icon
    template = DocumentTemplate(
        workspace_id=workspace_id,
        name=body.name.strip(),
        description=body.description,
        icon=icon,
        content=content or "",
        created_by=perms.user.id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@router.patch("/doc-templates/{template_id}", response_model=DocTemplateOut)
def update_template(
    template_id: uuid.UUID,
    body: DocTemplateUpdate,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    template = db.get(DocumentTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    perms.require_workspace_member(template.workspace_id)
    if body.name is not None:
        template.name = body.name.strip()
    if body.description is not None:
        template.description = body.description
    if body.icon is not None:
        template.icon = body.icon or None
    if body.content is not None:
        template.content = body.content
    # "Update existing template" from a document replaces the stored content.
    if body.document_id:
        source = doc_service.get_document(db, perms, body.document_id)
        template.content = source.content
    db.commit()
    db.refresh(template)
    return template


@router.delete("/doc-templates/{template_id}", response_model=Message)
def delete_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    template = db.get(DocumentTemplate, template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    perms.require_workspace_member(template.workspace_id)
    db.delete(template)
    db.commit()
    return Message(detail="Template deleted")


@router.post("/workspaces/{workspace_id}/doc-templates/{template_id}/apply", response_model=DocumentOut, status_code=201)
def apply_template(
    workspace_id: uuid.UUID,
    template_id: uuid.UUID,
    folder_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    perms: PermissionService = Depends(get_permissions),
):
    perms.require_workspace_member(workspace_id)
    template = db.get(DocumentTemplate, template_id)
    if not template or template.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Template not found")
    if folder_id:
        folder = _get_folder(db, perms, folder_id)
        if folder.workspace_id != workspace_id:
            raise HTTPException(status_code=400, detail="Folder is in another workspace")
    doc = Document(
        workspace_id=workspace_id,
        folder_id=folder_id,
        title=template.name,
        content=template.content,
        status="draft",
        created_by=perms.user.id,
        updated_by=perms.user.id,
        tags=[],
        is_private=True,
        icon=template.icon,
    )
    db.add(doc)
    db.flush()
    doc_service.log_activity(
        db, document_id=doc.id, type="created", actor_id=perms.user.id, detail=f'Created from template "{template.name}"'
    )
    db.commit()
    db.refresh(doc)
    return doc_service.document_out(db, doc, perms.user.id)


# ── Public read ────────────────────────────────────────────────────


@router.get("/public/documents/{token}", response_model=PublicDocumentOut, include_in_schema=False)
def public_document(token: str, db: Session = Depends(get_db)):
    doc = db.scalar(
        select(Document).where(
            Document.public_token == token,
            Document.public_enabled.is_(True),
            Document.deleted_at.is_(None),
            Document.archived_at.is_(None),
        )
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    author = db.get(User, doc.created_by)
    return PublicDocumentOut(
        id=doc.id,
        title=doc.title,
        content=doc.content,
        status=doc.status,
        author=doc_service.display_name(author),
        updated_at=doc.updated_at,
        icon=doc.icon,
        cover_url=doc.cover_url,
        page_settings=dict(doc.page_settings or {}),
        is_wiki=doc.is_wiki,
    )
