import { describe, expect, it } from 'vitest'

import {
  distinctAuthors,
  filterDocuments,
  isActive,
  isArchived,
  isTrashed,
  searchDocuments,
  sortDocuments,
} from '@/modules/docs/services/docs.service'
import { getArchived } from '@/modules/docs/services/archive.service'
import { getTrashed } from '@/modules/docs/services/trash.service'
import { resolveRecent } from '@/modules/docs/services/recent.service'
import { readingMinutes, wordCount } from '@/modules/docs/services/metadata.service'
import { DEFAULT_DOC_FILTERS, type DocFilters } from '@/modules/docs/types/editor'
import type { FlowDoc } from '@/modules/docs/types/document'
import type { Folder } from '@/modules/docs/types/folder'

const ts = '2026-01-01T00:00:00.000Z'
const iso = (d: Date) => d.toISOString()
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000))

function doc(partial: Partial<FlowDoc> & { id: string }): FlowDoc {
  return {
    title: partial.id,
    content: '',
    folderId: null,
    author: 'Alex',
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
    archivedAt: null,
    deletedAt: null,
    ...partial,
  }
}

const FOLDERS: Folder[] = [{ id: 'eng', name: 'Engineering', parentId: null, createdAt: ts, updatedAt: ts }]

describe('lifecycle predicates', () => {
  it('classifies active / archived / trashed', () => {
    expect(isActive(doc({ id: 'a' }))).toBe(true)
    expect(isArchived(doc({ id: 'b', archivedAt: ts }))).toBe(true)
    expect(isTrashed(doc({ id: 'c', deletedAt: ts }))).toBe(true)
    // trashed wins over archived
    expect(isArchived(doc({ id: 'd', archivedAt: ts, deletedAt: ts }))).toBe(false)
    expect(isActive(doc({ id: 'e', archivedAt: ts }))).toBe(false)
  })
})

describe('filterDocuments', () => {
  const docs = [
    doc({ id: 'draft', status: 'draft', author: 'Alex', updatedAt: daysAgo(0), templateId: 't1' }),
    doc({ id: 'pub', status: 'published', author: 'Sam', updatedAt: daysAgo(20) }),
    doc({ id: 'arch', archivedAt: ts, author: 'Alex' }),
  ]
  const fav = (id: string) => id === 'draft'

  it('hides archived unless includeArchived is set', () => {
    expect(filterDocuments(docs, DEFAULT_DOC_FILTERS, fav).map((d) => d.id)).toEqual(['draft', 'pub'])
    expect(filterDocuments(docs, { ...DEFAULT_DOC_FILTERS, includeArchived: true }, fav).map((d) => d.id)).toEqual([
      'draft',
      'pub',
      'arch',
    ])
  })

  it('filters by status, favorite, author, date and template', () => {
    const f = (p: Partial<DocFilters>) => filterDocuments(docs, { ...DEFAULT_DOC_FILTERS, ...p }, fav).map((d) => d.id)
    expect(f({ status: 'published' })).toEqual(['pub'])
    expect(f({ favorite: 'yes' })).toEqual(['draft'])
    expect(f({ favorite: 'no' })).toEqual(['pub'])
    expect(f({ author: 'Sam' })).toEqual(['pub'])
    expect(f({ date: 'week' })).toEqual(['draft'])
    expect(f({ template: 'yes' })).toEqual(['draft'])
    expect(f({ template: 'no' })).toEqual(['pub'])
  })
})

describe('sortDocuments', () => {
  const docs = [
    doc({ id: 'b', title: 'Beta', createdAt: daysAgo(10), updatedAt: daysAgo(1), viewCount: 1, content: 'one two three' }),
    doc({ id: 'a', title: 'Alpha', createdAt: daysAgo(1), updatedAt: daysAgo(10), viewCount: 9, content: 'x' }),
  ]

  it('orders by each key', () => {
    expect(sortDocuments(docs, 'title').map((d) => d.id)).toEqual(['a', 'b'])
    expect(sortDocuments(docs, 'updated').map((d) => d.id)).toEqual(['b', 'a'])
    expect(sortDocuments(docs, 'created').map((d) => d.id)).toEqual(['a', 'b'])
    expect(sortDocuments(docs, 'oldest').map((d) => d.id)).toEqual(['b', 'a'])
    expect(sortDocuments(docs, 'views').map((d) => d.id)).toEqual(['a', 'b'])
  })
})

describe('advanced searchDocuments', () => {
  const docs = [
    doc({ id: 'd1', title: 'Guide', author: 'Priya', status: 'published', tags: ['onboarding'] }),
    doc({ id: 'd2', title: 'Notes', author: 'Alex' }),
  ]
  it('matches author, status and tags', () => {
    expect(searchDocuments(docs, FOLDERS, 'priya').map((d) => d.id)).toEqual(['d1'])
    expect(searchDocuments(docs, FOLDERS, 'published').map((d) => d.id)).toEqual(['d1'])
    expect(searchDocuments(docs, FOLDERS, 'onboarding').map((d) => d.id)).toEqual(['d1'])
  })
})

describe('trash & archive views', () => {
  const docs = [
    doc({ id: 'active' }),
    doc({ id: 'trash1', deletedAt: daysAgo(2) }),
    doc({ id: 'trash2', deletedAt: daysAgo(1) }),
    doc({ id: 'arch1', archivedAt: daysAgo(3) }),
  ]
  it('returns trashed newest-first', () => {
    expect(getTrashed(docs).map((d) => d.id)).toEqual(['trash2', 'trash1'])
  })
  it('returns archived (excluding trashed)', () => {
    expect(getArchived(docs).map((d) => d.id)).toEqual(['arch1'])
  })
})

describe('resolveRecent', () => {
  it('preserves order and drops trashed / missing', () => {
    const docs = [doc({ id: 'a' }), doc({ id: 'b', deletedAt: ts })]
    const entries = [
      { id: 'b', at: 3 },
      { id: 'a', at: 2 },
      { id: 'gone', at: 1 },
    ]
    expect(resolveRecent(entries, docs).map((r) => r.doc.id)).toEqual(['a'])
  })
})

describe('metadata', () => {
  it('counts words and estimates reading time', () => {
    expect(wordCount('<p>hello world</p>')).toBe(2)
    expect(wordCount('')).toBe(0)
    expect(readingMinutes('<p>' + 'word '.repeat(400) + '</p>')).toBe(2)
    expect(readingMinutes('')).toBe(0)
  })
})

describe('distinctAuthors', () => {
  it('returns sorted unique authors', () => {
    expect(distinctAuthors([doc({ id: '1', author: 'Sam' }), doc({ id: '2', author: 'Alex' }), doc({ id: '3', author: 'Sam' })])).toEqual([
      'Alex',
      'Sam',
    ])
  })
})
