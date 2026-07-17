import { create } from 'zustand'

import type { DocViewer } from '../types/presence'

const STALE_MS = 15_000

interface PresenceState {
  /** documentId → viewers (transient; WS + heartbeat refresh). */
  byDocument: Record<string, DocViewer[]>
  upsert: (documentId: string, viewer: Omit<DocViewer, 'lastSeen'> & { lastSeen?: number }) => void
  leave: (documentId: string, userId: string) => void
  viewers: (documentId: string, excludeUserId?: string) => DocViewer[]
  prune: (documentId: string) => void
}

/** Document presence — populated from `doc.presence` / `doc.cursor` WS events. */
export const useDocPresenceStore = create<PresenceState>((set, get) => ({
  byDocument: {},
  upsert: (documentId, viewer) => {
    const now = Date.now()
    set((s) => {
      const list = (s.byDocument[documentId] ?? []).filter(
        (v) => now - v.lastSeen < STALE_MS && v.userId !== viewer.userId,
      )
      return {
        byDocument: {
          ...s.byDocument,
          [documentId]: [...list, { ...viewer, lastSeen: viewer.lastSeen ?? now }],
        },
      }
    })
  },
  leave: (documentId, userId) =>
    set((s) => ({
      byDocument: {
        ...s.byDocument,
        [documentId]: (s.byDocument[documentId] ?? []).filter((v) => v.userId !== userId),
      },
    })),
  viewers: (documentId, excludeUserId) => {
    const now = Date.now()
    return (get().byDocument[documentId] ?? []).filter(
      (v) => now - v.lastSeen < STALE_MS && v.userId !== excludeUserId,
    )
  },
  prune: (documentId) => {
    const now = Date.now()
    set((s) => ({
      byDocument: {
        ...s.byDocument,
        [documentId]: (s.byDocument[documentId] ?? []).filter((v) => now - v.lastSeen < STALE_MS),
      },
    }))
  },
}))
