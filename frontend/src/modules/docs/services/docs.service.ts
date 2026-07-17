import type { Folder } from '../types/folder'
import type { FlowDoc } from '../types/document'
import type { DocFilterRule, DocFilters, DocSort, DocSortDir } from '../types/editor'
import { formatDate, timeAgo } from '../../../lib/utils'

/**
 * Document domain helpers (pure search / filtering / sorting).
 */

/** Strip HTML tags so search matches on the visible text of `content`. */
export function plainText(html: string): string {
  if (typeof document === 'undefined') return html.replace(/<[^>]+>/g, ' ')
  const el = document.createElement('div')
  el.innerHTML = html
  return el.textContent ?? ''
}

export const isTrashed = (d: FlowDoc) => !!d.deletedAt
export const isArchived = (d: FlowDoc) => !!d.archivedAt && !d.deletedAt
export const isActive = (d: FlowDoc) => !d.deletedAt && !d.archivedAt

export function searchDocuments(docs: FlowDoc[], folders: Folder[], query: string): FlowDoc[] {
  const q = query.trim().toLowerCase()
  if (!q) return docs
  const folderName = new Map(folders.map((f) => [f.id, f.name.toLowerCase()]))
  return docs.filter((d) => {
    if (d.title.toLowerCase().includes(q)) return true
    if (plainText(d.content).toLowerCase().includes(q)) return true
    if (d.author.toLowerCase().includes(q)) return true
    if (d.status.toLowerCase().includes(q)) return true
    if ((d.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true
    const fname = d.folderId ? folderName.get(d.folderId) : undefined
    return fname ? fname.includes(q) : false
  })
}

function parseDay(value: string): Date | null {
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(d.getTime()) ? null : d
}

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function dayEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

function matchDate(iso: string | null | undefined, op: DocFilterRule['operator'], needle: string): boolean {
  if (!iso) return false
  const value = new Date(iso)
  const target = parseDay(needle)
  if (!target) return true
  if (op === 'on') return dayStart(value).getTime() === dayStart(target).getTime()
  if (op === 'before') return value < dayStart(target)
  if (op === 'after') return value > dayEnd(target)
  return true
}

function sharingKind(doc: FlowDoc): 'private' | 'public' | 'shared' {
  if (doc.publicEnabled) return 'public'
  if (doc.isShared) return 'shared'
  return 'private'
}

/** Apply selected tag chips (AND). */
export function filterByTags(docs: FlowDoc[], tags: string[]): FlowDoc[] {
  if (!tags.length) return docs
  const set = new Set(tags.map((t) => t.toLowerCase()))
  return docs.filter((d) => {
    const docTags = new Set((d.tags ?? []).map((t) => t.toLowerCase()))
    for (const t of set) if (!docTags.has(t)) return false
    return true
  })
}

/** Apply ClickUp-style filter rules to a document list. */
export function applyFilterRules(docs: FlowDoc[], rules: DocFilterRule[], folders: Folder[]): FlowDoc[] {
  if (!rules.length) return docs
  const folderMap = new Map(folders.map((f) => [f.id, f.name]))
  return docs.filter((doc) =>
    rules.every((rule) => {
      const val = rule.value.trim()
      if (!val && rule.field !== 'wiki') return true
      switch (rule.field) {
        case 'title': {
          const title = doc.title.toLowerCase()
          const needle = val.toLowerCase()
          if (rule.operator === 'contains') return title.includes(needle)
          if (rule.operator === 'equals') return title === needle
          if (rule.operator === 'not_equals') return title !== needle
          return true
        }
        case 'location': {
          const loc = doc.folderId ?? '__root__'
          if (rule.operator === 'is_not') return loc !== val
          return loc === val
        }
        case 'tag': {
          const tags = (doc.tags ?? []).map((t) => t.toLowerCase())
          const needle = val.toLowerCase()
          if (rule.operator === 'contains') return tags.some((t) => t.includes(needle))
          if (rule.operator === 'is_not') return !tags.includes(needle)
          return tags.includes(needle)
        }
        case 'owner': {
          const ownerId = doc.authorId ?? ''
          const ownerName = doc.author.toLowerCase()
          if (rule.operator === 'is_not') return ownerId !== val && ownerName !== val.toLowerCase()
          return ownerId === val || ownerName === val.toLowerCase()
        }
        case 'contributors': {
          const cid = doc.updatedById ?? ''
          const cname = (doc.updatedBy ?? '').toLowerCase()
          if (!cid && !cname) return false
          if (rule.operator === 'is_not') return cid !== val && cname !== val.toLowerCase()
          return cid === val || cname === val.toLowerCase()
        }
        case 'sharing': {
          const kind = sharingKind(doc)
          if (rule.operator === 'is_not') return kind !== val
          return kind === val
        }
        case 'wiki': {
          const want = val === 'true'
          if (rule.operator === 'is_not') return doc.isWiki !== want
          return doc.isWiki === want
        }
        case 'dateViewed':
          return matchDate(doc.lastViewedAt, rule.operator, val)
        case 'dateUpdated':
          return matchDate(doc.updatedAt, rule.operator, val)
        case 'dateCreated':
          return matchDate(doc.createdAt, rule.operator, val)
        default:
          return true
      }
    }),
  )
}

/** Legacy list filters (status, favorite, author, date window, template). */
export function filterDocuments(
  docs: FlowDoc[],
  filters: DocFilters,
  isFavorite: (id: string) => boolean,
): FlowDoc[] {
  return docs.filter((d) => {
    if (isTrashed(d)) return false
    if (!filters.includeArchived && isArchived(d)) return false
    if (filters.status !== 'all' && d.status !== filters.status) return false
    if (filters.favorite === 'yes' && !isFavorite(d.id)) return false
    if (filters.favorite === 'no' && isFavorite(d.id)) return false
    if (filters.author && d.author !== filters.author) return false
    if (filters.template === 'yes' && !d.templateId) return false
    if (filters.template === 'no' && d.templateId) return false
    if (filters.date === 'week') {
      const cutoff = Date.now() - 7 * 86_400_000
      if (new Date(d.updatedAt).getTime() < cutoff) return false
    }
    if (filters.date === 'month') {
      const cutoff = Date.now() - 30 * 86_400_000
      if (new Date(d.updatedAt).getTime() < cutoff) return false
    }
    return true
  })
}

export function sortDocuments(docs: FlowDoc[], sort: DocSort, dir: DocSortDir = 'desc'): FlowDoc[] {
  const copy = [...docs]
  if (sort === 'title') {
    copy.sort((a, b) => a.title.localeCompare(b.title))
    return copy
  }
  if (sort === 'views') {
    copy.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
    return copy
  }
  if (sort === 'oldest') {
    copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return copy
  }
  const mult = dir === 'asc' ? 1 : -1
  copy.sort((a, b) => {
    let av = ''
    let bv = ''
    if (sort === 'created') {
      av = a.createdAt
      bv = b.createdAt
    } else if (sort === 'viewed') {
      av = a.lastViewedAt ?? ''
      bv = b.lastViewedAt ?? ''
    } else {
      av = a.updatedAt
      bv = b.updatedAt
    }
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av.localeCompare(bv) * mult
  })
  return copy
}

/** Sorted unique author display names (for legacy filter pickers). */
export function distinctAuthors(docs: FlowDoc[]): string[] {
  return [...new Set(docs.map((d) => d.author))].sort((a, b) => a.localeCompare(b))
}

/** ClickUp-style time for doc table columns (e.g. "5:11 pm"). */
export function formatDocListTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (seconds < 7 * 86_400) return timeAgo(iso)
  return formatDate(iso)
}

/** All distinct tags across documents (for the Tags toolbar). */
export function distinctTags(docs: FlowDoc[]): string[] {
  const set = new Set<string>()
  for (const d of docs) for (const t of d.tags ?? []) if (t.trim()) set.add(t)
  return Array.from(set).sort((a, b) => a.localeCompare(b))
}

/** Distinct owner options for filter value pickers. */
export function distinctOwners(docs: FlowDoc[]): { id: string; name: string }[] {
  const map = new Map<string, string>()
  for (const d of docs) {
    if (d.authorId) map.set(d.authorId, d.author)
  }
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Distinct contributor options for filter value pickers. */
export function distinctContributors(docs: FlowDoc[]): { id: string; name: string }[] {
  const map = new Map<string, string>()
  for (const d of docs) {
    if (d.updatedById && d.updatedBy) map.set(d.updatedById, d.updatedBy)
  }
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
