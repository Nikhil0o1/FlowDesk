export type DocStatus = 'draft' | 'published'

/**
 * A documentation page. Named `FlowDoc` to avoid clashing with the DOM's global
 * `Document` type. `content` is an HTML string produced by the rich text editor.
 *
 * Phase 2 adds soft lifecycle (`archivedAt` / `deletedAt`) and metadata fields.
 * All Phase 2 fields are optional so documents persisted by Phase 1 keep working
 * without a migration — readers treat `undefined` as the neutral default.
 */
export interface FlowDoc {
  id: string
  title: string
  content: string
  /** `null` = lives at the Docs root (no folder). */
  folderId: string | null
  /** Creator display name (from API). */
  author: string
  /** Creator user id — used for permission resolution when wired to API. */
  authorId?: string
  /** Current user's role on this document (from API). */
  userRole?: import('./permissions').DocRole
  status: DocStatus
  createdAt: string
  updatedAt: string

  // ── Phase 2 metadata ──────────────────────────────────────────
  updatedBy?: string
  updatedById?: string
  /** ISO timestamp when archived; `null`/absent = active. Archived = read-only. */
  archivedAt?: string | null
  /** ISO timestamp when moved to Trash; `null`/absent = not trashed. */
  deletedAt?: string | null
  deletedBy?: string | null
  /** Folder the doc lived in before it was trashed (for "Original folder" + restore). */
  originalFolderId?: string | null
  tags?: string[]
  /** Increments on open — powers the "Most viewed" sort placeholder. */
  viewCount?: number
  /** Template this doc was created from (used by the "Template" filter). */
  templateId?: string | null

  // ── Wiki / protection / presentation ──────────────────────────
  /** True = this doc is a Wiki (knowledge base page). */
  isWiki?: boolean
  /** True = editing is locked to the owner (Protect Doc). */
  isProtected?: boolean
  /** Optional emoji icon shown next to the title. */
  icon?: string | null
  /** True = a public share link is enabled. */
  publicEnabled?: boolean
  /** True = explicitly shared with workspace members. */
  isShared?: boolean
  /** Resolved folder name (from API list). */
  folderName?: string | null
  /** Total non-deleted comments on this doc. */
  commentCount?: number
  /** Number of users explicitly shared with. */
  shareMemberCount?: number
  /** ISO timestamp the current user last opened this doc (from API). */
  lastViewedAt?: string | null

  /** Cover image URL or preset id (`preset:…`). */
  coverUrl?: string | null
  /** Page typography / layout settings. */
  pageSettings?: import('./pageSettings').DocPageSettings
}
