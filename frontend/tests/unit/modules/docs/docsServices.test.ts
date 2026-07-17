import { describe, expect, it } from 'vitest'

import {
  buildFolderTree,
  canMoveInto,
  collectFolderAndDescendants,
  folderPath,
} from '@/modules/docs/services/folder.service'
import { plainText, searchDocuments } from '@/modules/docs/services/docs.service'
import type { Folder } from '@/modules/docs/types/folder'
import type { FlowDoc } from '@/modules/docs/types/document'

const ts = '2026-01-01T00:00:00.000Z'
const folder = (id: string, name: string, parentId: string | null): Folder => ({
  id,
  name,
  parentId,
  createdAt: ts,
  updatedAt: ts,
})

const FOLDERS: Folder[] = [
  folder('eng', 'Engineering', null),
  folder('be', 'Backend', 'eng'),
  folder('fe', 'Frontend', 'eng'),
  folder('prod', 'Product', null),
  folder('api', 'Auth API', 'be'),
]

const doc = (id: string, title: string, folderId: string | null, content: string): FlowDoc => ({
  id,
  title,
  content,
  folderId,
  author: 'Tester',
  status: 'draft',
  createdAt: ts,
  updatedAt: ts,
})

describe('buildFolderTree', () => {
  it('nests children under their parent and sorts alphabetically', () => {
    const tree = buildFolderTree(FOLDERS)
    expect(tree.map((n) => n.name)).toEqual(['Engineering', 'Product'])
    const eng = tree.find((n) => n.id === 'eng')!
    expect(eng.children.map((c) => c.name)).toEqual(['Backend', 'Frontend'])
    expect(eng.children.find((c) => c.id === 'be')!.children.map((c) => c.name)).toEqual(['Auth API'])
  })

  it('treats folders with a missing parent as top-level', () => {
    const tree = buildFolderTree([folder('orphan', 'Orphan', 'ghost')])
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('orphan')
  })
})

describe('collectFolderAndDescendants', () => {
  it('returns the folder plus every nested descendant', () => {
    expect(new Set(collectFolderAndDescendants(FOLDERS, 'eng'))).toEqual(new Set(['eng', 'be', 'fe', 'api']))
    expect(collectFolderAndDescendants(FOLDERS, 'prod')).toEqual(['prod'])
  })
})

describe('folderPath', () => {
  it('builds the root → target chain', () => {
    expect(folderPath(FOLDERS, 'api').map((f) => f.id)).toEqual(['eng', 'be', 'api'])
    expect(folderPath(FOLDERS, null)).toEqual([])
  })
})

describe('canMoveInto', () => {
  it('allows moving to root and disallows cycles', () => {
    expect(canMoveInto(FOLDERS, 'be', null)).toBe(true)
    expect(canMoveInto(FOLDERS, 'be', 'prod')).toBe(true)
    expect(canMoveInto(FOLDERS, 'eng', 'eng')).toBe(false)
    expect(canMoveInto(FOLDERS, 'eng', 'api')).toBe(false) // into own descendant
  })
})

describe('plainText', () => {
  it('strips HTML tags to visible text', () => {
    expect(plainText('<h1>Hello</h1><p>world</p>')).toBe('Helloworld')
    expect(plainText('<p>a <strong>b</strong> c</p>')).toBe('a b c')
  })
})

describe('searchDocuments', () => {
  const docs = [
    doc('d1', 'Authentication API', 'be', '<p>bearer token flow</p>'),
    doc('d2', 'Roadmap', 'prod', '<p>quarterly plans</p>'),
  ]

  it('returns everything for an empty query', () => {
    expect(searchDocuments(docs, FOLDERS, '   ')).toHaveLength(2)
  })

  it('matches on title, content and folder name', () => {
    expect(searchDocuments(docs, FOLDERS, 'auth').map((d) => d.id)).toEqual(['d1'])
    expect(searchDocuments(docs, FOLDERS, 'bearer').map((d) => d.id)).toEqual(['d1'])
    expect(searchDocuments(docs, FOLDERS, 'product').map((d) => d.id)).toEqual(['d2'])
  })

  it('returns no results when nothing matches', () => {
    expect(searchDocuments(docs, FOLDERS, 'zzz')).toHaveLength(0)
  })
})
