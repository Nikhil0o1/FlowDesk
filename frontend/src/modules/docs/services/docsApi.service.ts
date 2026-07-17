import { api } from '../../../lib/api'
import { API_BASE } from '../../../lib/env'
import type { Page, Project, Task } from '../../../lib/types'
import type { ActivityEvent, ActivityType } from '../types/activity'
import type { DocComment, InlineAnchor } from '../types/comment'
import type { DocLink, DocLinkTargetType } from '../types/docLink'
import type { DocStatus, FlowDoc } from '../types/document'
import type { DocFilterRule, DocSort, DocSortDir } from '../types/editor'
import type { Folder } from '../types/folder'
import type { FavoriteType } from '../types/favorites'
import type { DocRole, DocShareMember, DocShareState } from '../types/permissions'
import type { DocPageSettings } from '../types/pageSettings'
import { DEFAULT_PAGE_SETTINGS } from '../types/pageSettings'
import type { DocVersion } from '../types/version'

// ── API response shapes (snake_case) ─────────────────────────────

interface ApiFolder {
  id: string
  workspace_id: string
  name: string
  parent_id: string | null
  is_private?: boolean
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface DocFolderShareMember {
  user_id: string
  role: string
  user?: {
    id: string
    email: string
    full_name: string | null
    avatar_url: string | null
    avatar_color: string | null
  } | null
}

export interface DocFolderShareState {
  folder_id: string
  is_private: boolean
  members: DocFolderShareMember[]
}

interface ApiDocument {
  id: string
  workspace_id: string
  folder_id: string | null
  title: string
  content: string
  status: DocStatus
  author: string
  author_id: string
  updated_by: string | null
  updated_by_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  deleted_at: string | null
  deleted_by: string | null
  original_folder_id: string | null
  tags: string[]
  view_count: number
  template_id: string | null
  is_private: boolean
  is_wiki: boolean
  is_protected: boolean
  icon: string | null
  cover_url: string | null
  page_settings: Record<string, unknown> | null
  public_enabled: boolean
  is_shared: boolean
  folder_name: string | null
  comment_count: number
  share_member_count: number
  user_role: DocRole | null
  last_viewed_at: string | null
}

interface ApiComment {
  id: string
  document_id: string
  author_id: string
  author_name: string
  body: string
  parent_id: string | null
  inline_anchor: { marker_id: string; quote: string } | null
  resolved: boolean
  created_at: string
  updated_at: string
}

interface ApiShareMember {
  id: string
  type: 'user'
  target_id: string
  name: string
  email?: string | null
  avatar_url?: string | null
  avatar_color?: string | null
  role: DocRole
  added_at: string
  added_by: string
}

interface ApiShare {
  document_id: string
  is_private: boolean
  public_enabled: boolean
  public_token: string | null
  public_url: string | null
  members: ApiShareMember[]
}

interface ApiVersion {
  id: string
  document_id: string
  version_number: number
  title: string
  content: string
  author_id: string
  author_name: string
  summary: string
  word_count: number
  created_at: string
}

interface ApiActivity {
  id: string
  document_id: string
  type: ActivityType
  actor_id: string
  actor_name: string
  detail: string
  at: string
}

interface ApiFavorite {
  id: string
  target_id: string
  target_type: FavoriteType
  created_at: string
}

interface ApiRecent {
  document_id: string
  opened_at: string
  document: ApiDocument | null
}

// ── Mappers ───────────────────────────────────────────────────────

export function mapFolder(f: ApiFolder): Folder {
  return {
    id: f.id,
    name: f.name,
    parentId: f.parent_id,
    isPrivate: Boolean(f.is_private),
    createdBy: f.created_by ?? null,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  }
}

interface ApiDocLink {
  id: string
  target_type: DocLinkTargetType
  target_id: string
  title: string
  subtitle?: string | null
  icon?: string | null
  href: string
}

interface ApiDocLinks {
  links: ApiDocLink[]
}

function mapPageSettings(raw: ApiDocument['page_settings']): DocPageSettings {
  if (!raw) return { ...DEFAULT_PAGE_SETTINGS }
  const r = raw as Record<string, unknown>
  return {
    fontStyle: (r.font_style as DocPageSettings['fontStyle']) || DEFAULT_PAGE_SETTINGS.fontStyle,
    fontSize: (r.font_size as DocPageSettings['fontSize']) || DEFAULT_PAGE_SETTINGS.fontSize,
    pageWidth: (r.page_width as DocPageSettings['pageWidth']) || DEFAULT_PAGE_SETTINGS.pageWidth,
    showCover: r.show_cover !== undefined ? Boolean(r.show_cover) : DEFAULT_PAGE_SETTINGS.showCover,
    headerEnabled: Boolean(r.header_enabled ?? DEFAULT_PAGE_SETTINGS.headerEnabled),
    showPageIcon: r.show_page_icon !== undefined ? Boolean(r.show_page_icon) : DEFAULT_PAGE_SETTINGS.showPageIcon,
    showOwners: r.show_owners !== undefined ? Boolean(r.show_owners) : DEFAULT_PAGE_SETTINGS.showOwners,
    showContributors:
      r.show_contributors !== undefined ? Boolean(r.show_contributors) : DEFAULT_PAGE_SETTINGS.showContributors,
    showSubtitle: r.show_subtitle !== undefined ? Boolean(r.show_subtitle) : DEFAULT_PAGE_SETTINGS.showSubtitle,
    showLastModified:
      r.show_last_modified !== undefined ? Boolean(r.show_last_modified) : DEFAULT_PAGE_SETTINGS.showLastModified,
    subtitle: typeof r.subtitle === 'string' ? r.subtitle : DEFAULT_PAGE_SETTINGS.subtitle,
    subpagesView: (r.subpages_view as DocPageSettings['subpagesView']) || DEFAULT_PAGE_SETTINGS.subpagesView,
    relationshipsView:
      (r.relationships_view as DocPageSettings['relationshipsView']) || DEFAULT_PAGE_SETTINGS.relationshipsView,
    showPageOutline:
      r.show_page_outline !== undefined ? Boolean(r.show_page_outline) : DEFAULT_PAGE_SETTINGS.showPageOutline,
    focusBlock: r.focus_block !== undefined ? Boolean(r.focus_block) : DEFAULT_PAGE_SETTINGS.focusBlock,
    focusPage: r.focus_page !== undefined ? Boolean(r.focus_page) : DEFAULT_PAGE_SETTINGS.focusPage,
    showStatsOnPage:
      r.show_stats_on_page !== undefined ? Boolean(r.show_stats_on_page) : DEFAULT_PAGE_SETTINGS.showStatsOnPage,
  }
}

function serializePageSettings(settings: DocPageSettings): Record<string, unknown> {
  return {
    font_style: settings.fontStyle,
    font_size: settings.fontSize,
    page_width: settings.pageWidth,
    show_cover: settings.showCover,
    header_enabled: settings.headerEnabled,
    show_page_icon: settings.showPageIcon,
    show_owners: settings.showOwners,
    show_contributors: settings.showContributors,
    show_subtitle: settings.showSubtitle,
    show_last_modified: settings.showLastModified,
    subtitle: settings.subtitle,
    subpages_view: settings.subpagesView,
    relationships_view: settings.relationshipsView,
    show_page_outline: settings.showPageOutline,
    focus_block: settings.focusBlock,
    focus_page: settings.focusPage,
    show_stats_on_page: settings.showStatsOnPage,
  }
}

function mapDocLink(row: ApiDocLink): DocLink {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    icon: row.icon,
    href: row.href,
  }
}

export function mapDocument(d: ApiDocument): FlowDoc {
  return {
    id: d.id,
    title: d.title,
    content: d.content,
    folderId: d.folder_id,
    author: d.author,
    authorId: d.author_id,
    userRole: d.user_role ?? undefined,
    status: d.status,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    updatedBy: d.updated_by ?? undefined,
    updatedById: d.updated_by_id ?? undefined,
    archivedAt: d.archived_at,
    deletedAt: d.deleted_at,
    deletedBy: d.deleted_by,
    originalFolderId: d.original_folder_id,
    tags: d.tags ?? [],
    viewCount: d.view_count,
    templateId: d.template_id,
    isWiki: d.is_wiki ?? false,
    isProtected: d.is_protected ?? false,
    icon: d.icon,
    publicEnabled: d.public_enabled ?? false,
    isShared: d.is_shared ?? false,
    folderName: d.folder_name,
    commentCount: d.comment_count ?? 0,
    shareMemberCount: d.share_member_count ?? 0,
    lastViewedAt: d.last_viewed_at,
    coverUrl: d.cover_url,
    pageSettings: mapPageSettings(d.page_settings),
  }
}

function mapComment(c: ApiComment): DocComment {
  const inlineAnchor: InlineAnchor | null = c.inline_anchor
    ? { markerId: c.inline_anchor.marker_id, quote: c.inline_anchor.quote }
    : null
  return {
    id: c.id,
    documentId: c.document_id,
    authorId: c.author_id,
    authorName: c.author_name,
    body: c.body,
    parentId: c.parent_id,
    inlineAnchor,
    resolved: c.resolved,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }
}

function mapShareMember(m: ApiShareMember): DocShareMember {
  return {
    id: m.id,
    type: m.type,
    targetId: m.target_id,
    name: m.name,
    email: m.email ?? undefined,
    avatarUrl: m.avatar_url,
    avatarColor: m.avatar_color,
    role: m.role,
    addedAt: m.added_at,
    addedBy: m.added_by,
  }
}

export function mapShare(s: ApiShare): DocShareState {
  return {
    documentId: s.document_id,
    isPrivate: s.is_private,
    publicEnabled: s.public_enabled,
    publicToken: s.public_token,
    publicUrl: s.public_url,
    members: s.members.map(mapShareMember),
  }
}

function mapVersion(v: ApiVersion): DocVersion {
  return {
    id: v.id,
    documentId: v.document_id,
    versionNumber: v.version_number,
    title: v.title,
    content: v.content,
    authorId: v.author_id,
    authorName: v.author_name,
    summary: v.summary,
    wordCount: v.word_count,
    createdAt: v.created_at,
  }
}

function mapActivity(e: ApiActivity): ActivityEvent {
  return {
    id: e.id,
    documentId: e.document_id,
    type: e.type,
    actorId: e.actor_id,
    actorName: e.actor_name,
    detail: e.detail,
    at: e.at,
  }
}

// ── Query keys ────────────────────────────────────────────────────

export const docsKeys = {
  all: ['docs'] as const,
  folders: (ws: string) => [...docsKeys.all, 'folders', ws] as const,
  documents: (ws: string, scope?: string) => [...docsKeys.all, 'documents', ws, scope ?? 'active'] as const,
  document: (id: string) => [...docsKeys.all, 'document', id] as const,
  comments: (id: string) => [...docsKeys.all, 'comments', id] as const,
  share: (id: string) => [...docsKeys.all, 'share', id] as const,
  links: (id: string) => [...docsKeys.all, 'links', id] as const,
  versions: (id: string) => [...docsKeys.all, 'versions', id] as const,
  activity: (id: string) => [...docsKeys.all, 'activity', id] as const,
  favorites: (ws: string) => [...docsKeys.all, 'favorites', ws] as const,
  recent: () => [...docsKeys.all, 'recent'] as const,
  templates: (ws: string) => [...docsKeys.all, 'doc-templates', ws] as const,
  folderShare: (folderId: string) => [...docsKeys.all, 'folder-share', folderId] as const,
}

// ── API calls ─────────────────────────────────────────────────────

export async function fetchFolders(workspaceId: string): Promise<Folder[]> {
  const rows = await api.get<ApiFolder[]>(`/workspaces/${workspaceId}/doc-folders`)
  return rows.map(mapFolder)
}

export async function createFolderApi(workspaceId: string, name: string, parentId: string | null): Promise<Folder> {
  const row = await api.post<ApiFolder>(`/workspaces/${workspaceId}/doc-folders`, {
    name,
    parent_id: parentId,
  })
  return mapFolder(row)
}

export async function renameFolderApi(folderId: string, name: string): Promise<Folder> {
  const row = await api.patch<ApiFolder>(`/doc-folders/${folderId}`, { name })
  return mapFolder(row)
}

export async function moveFolderApi(folderId: string, parentId: string | null): Promise<Folder> {
  const row = await api.patch<ApiFolder>(`/doc-folders/${folderId}`, { parent_id: parentId })
  return mapFolder(row)
}

export async function deleteFolderApi(folderId: string): Promise<void> {
  await api.delete(`/doc-folders/${folderId}`)
}

export type DocScope = 'all' | 'mine' | 'shared' | 'private'

const SORT_API: Partial<Record<DocSort, string>> = {
  created: 'created_at',
  updated: 'updated_at',
  viewed: 'viewed_at',
}

export interface DocListQuery {
  deleted?: boolean
  archived?: boolean
  scope?: DocScope
  isWiki?: boolean
  folderId?: string | null
  sort?: DocSort
  sortDir?: DocSortDir
  filterRules?: DocFilterRule[]
  tags?: string[]
  q?: string
}

export async function fetchDocuments(workspaceId: string, opts: DocListQuery = {}): Promise<FlowDoc[]> {
  const params = new URLSearchParams()
  if (opts.deleted === true) params.set('deleted', 'true')
  if (opts.deleted === false) params.set('deleted', 'false')
  if (opts.archived === true) params.set('archived', 'true')
  if (opts.archived === false) params.set('archived', 'false')
  if (opts.scope && opts.scope !== 'all') params.set('scope', opts.scope)
  if (opts.isWiki !== undefined) params.set('is_wiki', opts.isWiki ? 'true' : 'false')
  if (opts.folderId) params.set('folder_id', opts.folderId)
  if (opts.q) params.set('q', opts.q)
  if (opts.sort && SORT_API[opts.sort]) params.set('sort_by', SORT_API[opts.sort]!)
  if (opts.sortDir) params.set('sort_dir', opts.sortDir)
  if (opts.filterRules?.length) {
    params.set(
      'filter_rules',
      JSON.stringify(opts.filterRules.map(({ field, operator, value }) => ({ field, operator, value }))),
    )
  }
  if (opts.tags?.length) opts.tags.forEach((t) => params.append('tags', t))
  const qs = params.toString()
  const rows = await api.get<ApiDocument[]>(
    `/workspaces/${workspaceId}/documents${qs ? `?${qs}` : ''}`,
  )
  return rows.map(mapDocument)
}

export async function fetchDocument(documentId: string): Promise<FlowDoc> {
  const row = await api.get<ApiDocument>(`/documents/${documentId}`)
  return mapDocument(row)
}

export async function importDocumentApi(
  workspaceId: string,
  input: { title: string; content: string; folderId?: string | null; format?: 'html' | 'markdown' | 'text' },
): Promise<FlowDoc> {
  const title = (input.title || '').trim() || 'Imported document'
  const row = await api.post<ApiDocument>(`/workspaces/${workspaceId}/documents/import`, {
    title,
    content: input.content || '',
    folder_id: input.folderId ?? null,
    format: input.format ?? 'html',
  })
  return mapDocument(row)
}

export async function createDocumentApi(
  workspaceId: string,
  input: {
    title?: string
    folderId?: string | null
    content?: string
    status?: DocStatus
    tags?: string[]
    templateId?: string | null
    isWiki?: boolean
    icon?: string | null
  },
): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/workspaces/${workspaceId}/documents`, {
    title: input.title ?? 'Untitled',
    folder_id: input.folderId ?? null,
    content: input.content ?? '',
    status: input.status ?? 'draft',
    tags: input.tags ?? [],
    template_id: input.templateId ?? null,
    is_wiki: input.isWiki ?? false,
    icon: input.icon ?? null,
  })
  return mapDocument(row)
}

export async function updateDocumentApi(
  documentId: string,
  patch: Partial<
    Pick<FlowDoc, 'title' | 'content' | 'status' | 'folderId' | 'tags' | 'icon' | 'isProtected' | 'coverUrl' | 'pageSettings' | 'isWiki'>
  > & {
    createVersion?: boolean
    versionSummary?: string
  },
): Promise<FlowDoc> {
  const pageSettings = patch.pageSettings ? serializePageSettings(patch.pageSettings) : undefined
  const payload: Record<string, unknown> = {
    title: patch.title,
    content: patch.content,
    status: patch.status,
    folder_id: patch.folderId,
    tags: patch.tags,
    is_wiki: patch.isWiki,
    is_protected: patch.isProtected,
    page_settings: pageSettings,
    create_version: patch.createVersion,
    version_summary: patch.versionSummary,
  }
  if ('icon' in patch) payload.icon = patch.icon ?? null
  if ('coverUrl' in patch) payload.cover_url = patch.coverUrl ?? null

  const row = await api.patch<ApiDocument>(`/documents/${documentId}`, payload)
  return mapDocument(row)
}

export async function duplicateDocumentApi(documentId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/duplicate`)
  return mapDocument(row)
}

export async function trashDocumentApi(documentId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/trash`)
  return mapDocument(row)
}

export async function restoreDocumentApi(documentId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/restore`)
  return mapDocument(row)
}

export async function archiveDocumentApi(documentId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/archive`)
  return mapDocument(row)
}

export async function unarchiveDocumentApi(documentId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/unarchive`)
  return mapDocument(row)
}

export async function deleteDocumentPermanentApi(documentId: string): Promise<void> {
  await api.delete(`/documents/${documentId}`)
}

export async function openDocumentApi(documentId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/open`)
  return mapDocument(row)
}

/** Immediate inbox notify when a people @mention chip (@user or @All) is inserted. */
export async function notifyDocumentBodyMentionApi(
  documentId: string,
  userId: string,
  previewHtml?: string,
): Promise<{ detail: string }> {
  return api.post<{ detail: string }>(`/documents/${documentId}/body-mentions`, {
    user_id: userId,
    preview_html: previewHtml ?? null,
  })
}

export type DocServerExportFormat = 'pdf' | 'docx' | 'text'

export async function exportDocumentApi(documentId: string, format: DocServerExportFormat): Promise<Blob> {
  return api.get<Blob>(`/documents/${documentId}/export?format=${format}`)
}

export async function fetchComments(documentId: string): Promise<DocComment[]> {
  const rows = await api.get<ApiComment[]>(`/documents/${documentId}/comments`)
  return rows.map(mapComment)
}

export async function createCommentApi(
  documentId: string,
  body: string,
  opts: { parentId?: string | null; inlineAnchor?: InlineAnchor | null } = {},
): Promise<DocComment> {
  const row = await api.post<ApiComment>(`/documents/${documentId}/comments`, {
    body,
    parent_id: opts.parentId ?? null,
    inline_anchor: opts.inlineAnchor
      ? { marker_id: opts.inlineAnchor.markerId, quote: opts.inlineAnchor.quote }
      : null,
  })
  return mapComment(row)
}

export async function updateCommentApi(
  commentId: string,
  patch: Partial<Pick<DocComment, 'body' | 'resolved'>>,
): Promise<DocComment> {
  const row = await api.patch<ApiComment>(`/document-comments/${commentId}`, patch)
  return mapComment(row)
}

export async function deleteCommentApi(commentId: string): Promise<void> {
  await api.delete(`/document-comments/${commentId}`)
}

export async function fetchShare(documentId: string): Promise<DocShareState> {
  const row = await api.get<ApiShare>(`/documents/${documentId}/share`)
  return mapShare(row)
}

export async function updateShareApi(
  documentId: string,
  patch: { isPrivate?: boolean; publicEnabled?: boolean },
): Promise<DocShareState> {
  const row = await api.patch<ApiShare>(`/documents/${documentId}/share`, {
    is_private: patch.isPrivate,
    public_enabled: patch.publicEnabled,
  })
  return mapShare(row)
}

export async function addShareMemberApi(
  documentId: string,
  payload: { userId?: string; email?: string; role: DocRole },
): Promise<DocShareState> {
  const row = await api.post<ApiShare>(`/documents/${documentId}/share/members`, {
    ...(payload.userId ? { user_id: payload.userId } : {}),
    ...(payload.email ? { email: payload.email } : {}),
    role: payload.role,
  })
  return mapShare(row)
}

export async function updateShareMemberApi(
  documentId: string,
  memberId: string,
  role: DocRole,
): Promise<DocShareMember> {
  const row = await api.patch<ApiShareMember>(`/documents/${documentId}/share/members/${memberId}`, { role })
  return mapShareMember(row)
}

export async function removeShareMemberApi(documentId: string, memberId: string): Promise<void> {
  await api.delete(`/documents/${documentId}/share/members/${memberId}`)
}

export async function fetchDocumentLinks(documentId: string): Promise<DocLink[]> {
  const row = await api.get<ApiDocLinks>(`/documents/${documentId}/links`)
  return row.links.map(mapDocLink)
}

export async function addDocumentLinkApi(
  documentId: string,
  targetType: DocLinkTargetType,
  targetId: string,
): Promise<DocLink> {
  const row = await api.post<ApiDocLink>(`/documents/${documentId}/links`, {
    target_type: targetType,
    target_id: targetId,
  })
  return mapDocLink(row)
}

export async function removeDocumentLinkApi(documentId: string, linkId: string): Promise<void> {
  await api.delete(`/documents/${documentId}/links/${linkId}`)
}

interface ApiSearchResults {
  tasks: { id: string; title: string }[]
}

export async function searchTasksForLink(q: string): Promise<{ id: string; title: string }[]> {
  if (q.trim().length < 2) return []
  const row = await api.get<ApiSearchResults>(`/search?q=${encodeURIComponent(q.trim())}&limit=12`)
  return (row.tasks ?? []).map((t) => ({ id: String(t.id), title: t.title }))
}

/** Recent tasks for the doc link picker — assigned, created, then workspace fallback. */
export async function fetchRecentTasksForLink(workspaceId?: string): Promise<{ id: string; title: string }[]> {
  const byId = new Map<string, { id: string; title: string }>()

  const addTasks = (tasks: Task[]) => {
    for (const t of tasks) {
      if (t.parent_task_id) continue
      byId.set(t.id, { id: t.id, title: t.title })
    }
  }

  try {
    const [assigned, created] = await Promise.all([
      api.get<Page<Task>>('/me/tasks?relation=assigned&page_size=15&include_completed=true'),
      api.get<Page<Task>>('/me/tasks?relation=created&page_size=15&include_completed=true'),
    ])
    addTasks(assigned.items ?? [])
    addTasks(created.items ?? [])
  } catch {
    /* fall through to workspace tasks */
  }

  if (byId.size === 0 && workspaceId) {
    try {
      const projects = await api.get<Project[]>(`/workspaces/${workspaceId}/projects`)
      const batches = await Promise.all(
        projects.slice(0, 5).map((p) =>
          api
            .get<Page<Task>>(`/projects/${p.id}/tasks?page_size=12`)
            .then((r) => r.items ?? [])
            .catch(() => [] as Task[]),
        ),
      )
      for (const batch of batches) addTasks(batch)
    } catch {
      /* no tasks available */
    }
  }

  return Array.from(byId.values()).slice(0, 20)
}

export async function fetchVersions(documentId: string): Promise<DocVersion[]> {
  const rows = await api.get<ApiVersion[]>(`/documents/${documentId}/versions`)
  return rows.map(mapVersion)
}

export async function createVersionApi(
  documentId: string,
  input: { title: string; content: string; summary?: string; wordCount?: number },
): Promise<DocVersion> {
  const row = await api.post<ApiVersion>(`/documents/${documentId}/versions`, {
    title: input.title,
    content: input.content,
    summary: input.summary ?? 'Auto-saved',
    word_count: input.wordCount ?? 0,
  })
  return mapVersion(row)
}

export async function restoreVersionApi(documentId: string, versionId: string): Promise<FlowDoc> {
  const row = await api.post<ApiDocument>(`/documents/${documentId}/versions/${versionId}/restore`)
  return mapDocument(row)
}

export async function fetchActivity(documentId: string): Promise<ActivityEvent[]> {
  const rows = await api.get<ApiActivity[]>(`/documents/${documentId}/activity`)
  return rows.map(mapActivity)
}

export async function fetchFavorites(workspaceId: string): Promise<{ id: string; targetId: string; type: FavoriteType; at: number }[]> {
  const rows = await api.get<ApiFavorite[]>(`/workspaces/${workspaceId}/doc-favorites`)
  return rows.map((f) => ({
    id: f.id,
    targetId: f.target_id,
    type: f.target_type,
    at: new Date(f.created_at).getTime(),
  }))
}

export async function addFavoriteApi(workspaceId: string, targetId: string, type: FavoriteType): Promise<void> {
  await api.post(`/workspaces/${workspaceId}/doc-favorites`, { target_id: targetId, target_type: type })
}

export async function removeFavoriteApi(workspaceId: string, targetId: string): Promise<void> {
  await api.delete(`/workspaces/${workspaceId}/doc-favorites/${targetId}`)
}

export async function fetchRecent(): Promise<{ documentId: string; openedAt: string; doc?: FlowDoc }[]> {
  const rows = await api.get<ApiRecent[]>('/users/me/recent-documents')
  return rows.map((r) => ({
    documentId: r.document_id,
    openedAt: r.opened_at,
    doc: r.document ? mapDocument(r.document) : undefined,
  }))
}

export async function removeRecentApi(documentId: string): Promise<void> {
  await api.delete(`/users/me/recent-documents/${documentId}`)
}

export async function clearRecentApi(): Promise<void> {
  await api.delete('/users/me/recent-documents')
}

interface ApiPublicDocument {
  id: string
  title: string
  content: string
  status: DocStatus
  author: string
  updated_at: string
  icon?: string | null
  cover_url?: string | null
  page_settings?: Record<string, unknown>
  is_wiki?: boolean
}

export interface PublicDocument {
  id: string
  title: string
  content: string
  status: DocStatus
  author: string
  updatedAt: string
  icon?: string | null
  coverUrl?: string | null
  pageSettings?: Record<string, unknown>
  isWiki?: boolean
}

// ── Custom templates ──────────────────────────────────────────────

interface ApiDocTemplate {
  id: string
  workspace_id: string
  name: string
  description: string
  icon: string | null
  content: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CustomDocTemplate {
  id: string
  name: string
  description: string
  icon: string | null
  content: string
  createdAt: string
  updatedAt: string
}

function mapDocTemplate(t: ApiDocTemplate): CustomDocTemplate {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    content: t.content,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }
}

export async function fetchDocTemplates(workspaceId: string): Promise<CustomDocTemplate[]> {
  const rows = await api.get<ApiDocTemplate[]>(`/workspaces/${workspaceId}/doc-templates`)
  return rows.map(mapDocTemplate)
}

export async function createDocTemplateApi(
  workspaceId: string,
  input: { name: string; description?: string; icon?: string | null; content?: string; documentId?: string },
): Promise<CustomDocTemplate> {
  const row = await api.post<ApiDocTemplate>(`/workspaces/${workspaceId}/doc-templates`, {
    name: input.name,
    description: input.description ?? '',
    icon: input.icon ?? null,
    content: input.content ?? '',
    document_id: input.documentId ?? null,
  })
  return mapDocTemplate(row)
}

export async function updateDocTemplateApi(
  templateId: string,
  patch: { name?: string; description?: string; icon?: string | null; content?: string; documentId?: string },
): Promise<CustomDocTemplate> {
  const row = await api.patch<ApiDocTemplate>(`/doc-templates/${templateId}`, {
    name: patch.name,
    description: patch.description,
    icon: patch.icon,
    content: patch.content,
    document_id: patch.documentId ?? null,
  })
  return mapDocTemplate(row)
}

export async function deleteDocTemplateApi(templateId: string): Promise<void> {
  await api.delete(`/doc-templates/${templateId}`)
}

export async function applyDocTemplateApi(
  workspaceId: string,
  templateId: string,
  folderId?: string | null,
): Promise<FlowDoc> {
  const qs = folderId ? `?folder_id=${folderId}` : ''
  const row = await api.post<ApiDocument>(
    `/workspaces/${workspaceId}/doc-templates/${templateId}/apply${qs}`,
  )
  return mapDocument(row)
}

export async function fetchPublicDocument(token: string): Promise<PublicDocument> {
  // Unauthenticated read — use raw fetch so the auth wrapper doesn't try to refresh/redirect.
  const res = await fetch(`${API_BASE}/public/documents/${token}`)
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({})))?.detail ?? 'Document not available')
  }
  const row = (await res.json()) as ApiPublicDocument
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    author: row.author,
    updatedAt: row.updated_at,
    icon: row.icon ?? null,
    coverUrl: row.cover_url ?? null,
    pageSettings: row.page_settings ?? {},
    isWiki: row.is_wiki ?? false,
  }
}
