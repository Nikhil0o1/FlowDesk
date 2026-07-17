import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { DocStatus, FlowDoc } from '../types/document'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface CreateInput {
  title: string
  folderId: string | null
  author: string
  content?: string
  status?: DocStatus
  tags?: string[]
  templateId?: string | null
}

type DocPatch = Partial<Pick<FlowDoc, 'title' | 'content' | 'status' | 'folderId' | 'updatedBy' | 'tags'>>

interface DocumentsState {
  documents: FlowDoc[]
  setDocuments: (documents: FlowDoc[]) => void
  addDocument: (input: CreateInput) => FlowDoc
  updateDocument: (id: string, patch: DocPatch) => void
  /** Permanent removal (Trash → delete forever, or empty trash). */
  removeDocuments: (ids: string[]) => void
  duplicateDocument: (id: string, author: string) => FlowDoc | null

  // ── Phase 2 lifecycle ─────────────────────────────────────────
  trashDocuments: (ids: string[], deletedBy: string) => void
  restoreDocuments: (ids: string[], resolveFolder?: (originalFolderId: string | null) => string | null) => void
  archiveDocuments: (ids: string[]) => void
  unarchiveDocuments: (ids: string[]) => void
  setTags: (id: string, tags: string[]) => void
  incrementViews: (id: string) => void
}

/** Persisted documents (localStorage `flowdesk-documents`). */
export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set, get) => ({
      documents: [],
      setDocuments: (documents) => set({ documents }),

      addDocument: (input) => {
        const ts = new Date().toISOString()
        const doc: FlowDoc = {
          id: newId(),
          title: input.title.trim() || 'Untitled',
          content: input.content ?? '',
          folderId: input.folderId,
          author: input.author,
          updatedBy: input.author,
          status: input.status ?? 'draft',
          createdAt: ts,
          updatedAt: ts,
          archivedAt: null,
          deletedAt: null,
          deletedBy: null,
          originalFolderId: null,
          tags: input.tags ?? [],
          viewCount: 0,
          templateId: input.templateId ?? null,
        }
        set((s) => ({ documents: [doc, ...s.documents] }))
        return doc
      },

      updateDocument: (id, patch) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: new Date().toISOString() } : d,
          ),
        })),

      removeDocuments: (ids) =>
        set((s) => {
          const set_ = new Set(ids)
          return { documents: s.documents.filter((d) => !set_.has(d.id)) }
        }),

      duplicateDocument: (id, author) => {
        const source = get().documents.find((d) => d.id === id)
        if (!source) return null
        const ts = new Date().toISOString()
        const copy: FlowDoc = {
          ...source,
          id: newId(),
          title: `${source.title} (Copy)`,
          author,
          updatedBy: author,
          status: 'draft',
          createdAt: ts,
          updatedAt: ts,
          archivedAt: null,
          deletedAt: null,
          deletedBy: null,
          originalFolderId: null,
          viewCount: 0,
          tags: [...(source.tags ?? [])],
        }
        set((s) => ({ documents: [copy, ...s.documents] }))
        return copy
      },

      trashDocuments: (ids, deletedBy) =>
        set((s) => {
          const set_ = new Set(ids)
          const ts = new Date().toISOString()
          return {
            documents: s.documents.map((d) =>
              set_.has(d.id) && !d.deletedAt
                ? { ...d, deletedAt: ts, deletedBy, originalFolderId: d.folderId }
                : d,
            ),
          }
        }),

      restoreDocuments: (ids, resolveFolder) =>
        set((s) => {
          const set_ = new Set(ids)
          const ts = new Date().toISOString()
          return {
            documents: s.documents.map((d) => {
              if (!set_.has(d.id)) return d
              const folderId = resolveFolder ? resolveFolder(d.originalFolderId ?? null) : d.folderId
              return {
                ...d,
                deletedAt: null,
                deletedBy: null,
                originalFolderId: null,
                folderId,
                updatedAt: ts,
              }
            }),
          }
        }),

      archiveDocuments: (ids) =>
        set((s) => {
          const set_ = new Set(ids)
          const ts = new Date().toISOString()
          return {
            documents: s.documents.map((d) => (set_.has(d.id) ? { ...d, archivedAt: ts } : d)),
          }
        }),

      unarchiveDocuments: (ids) =>
        set((s) => {
          const set_ = new Set(ids)
          const ts = new Date().toISOString()
          return {
            documents: s.documents.map((d) =>
              set_.has(d.id) ? { ...d, archivedAt: null, updatedAt: ts } : d,
            ),
          }
        }),

      setTags: (id, tags) =>
        set((s) => ({ documents: s.documents.map((d) => (d.id === id ? { ...d, tags } : d)) })),

      incrementViews: (id) =>
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, viewCount: (d.viewCount ?? 0) + 1 } : d)),
        })),
    }),
    { name: 'flowdesk-documents' },
  ),
)
