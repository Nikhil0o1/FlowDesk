import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { DocShareMember, DocShareState } from '../types/permissions'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function token() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : `pub-${Date.now()}`
}

interface SharingState {
  shares: Record<string, DocShareState>
  getShare: (documentId: string) => DocShareState | undefined
  ensureShare: (documentId: string, ownerId: string, ownerName: string) => DocShareState
  addMember: (documentId: string, member: Omit<DocShareMember, 'id' | 'addedAt'>) => void
  updateMemberRole: (documentId: string, memberId: string, role: DocShareMember['role']) => void
  removeMember: (documentId: string, memberId: string) => void
  setPublic: (documentId: string, enabled: boolean) => void
  setPrivate: (documentId: string, isPrivate: boolean) => void
}

/** Per-document sharing state (localStorage `flowdesk-doc-sharing`). TODO(backend). */
export const useSharingStore = create<SharingState>()(
  persist(
    (set, get) => ({
      shares: {},
      getShare: (documentId) => get().shares[documentId],
      ensureShare: (documentId, ownerId, ownerName) => {
        const existing = get().shares[documentId]
        if (existing) return existing
        const ts = new Date().toISOString()
        const state: DocShareState = {
          documentId,
          isPrivate: true,
          publicEnabled: false,
          publicToken: null,
          publicUrl: null,
          members: [
            {
              id: newId(),
              type: 'user',
              targetId: ownerId,
              name: ownerName,
              role: 'owner',
              addedAt: ts,
              addedBy: ownerName,
            },
          ],
        }
        set((s) => ({ shares: { ...s.shares, [documentId]: state } }))
        return state
      },
      addMember: (documentId, member) =>
        set((s) => {
          const share = s.shares[documentId]
          if (!share) return s
          const entry: DocShareMember = { ...member, id: newId(), addedAt: new Date().toISOString() }
          return { shares: { ...s.shares, [documentId]: { ...share, members: [...share.members, entry] } } }
        }),
      updateMemberRole: (documentId, memberId, role) =>
        set((s) => {
          const share = s.shares[documentId]
          if (!share) return s
          return {
            shares: {
              ...s.shares,
              [documentId]: {
                ...share,
                members: share.members.map((m) => (m.id === memberId ? { ...m, role } : m)),
              },
            },
          }
        }),
      removeMember: (documentId, memberId) =>
        set((s) => {
          const share = s.shares[documentId]
          if (!share) return s
          return {
            shares: {
              ...s.shares,
              [documentId]: { ...share, members: share.members.filter((m) => m.id !== memberId) },
            },
          }
        }),
      setPublic: (documentId, enabled) =>
        set((s) => {
          const share = s.shares[documentId]
          if (!share) return s
          const t = enabled ? share.publicToken ?? token() : share.publicToken
          return {
            shares: {
              ...s.shares,
              [documentId]: {
                ...share,
                publicEnabled: enabled,
                publicToken: t,
                publicUrl: enabled && t ? `${typeof window !== 'undefined' ? window.location.origin : ''}/d/${t}` : null,
              },
            },
          }
        }),
      setPrivate: (documentId, isPrivate) =>
        set((s) => {
          const share = s.shares[documentId]
          if (!share) return s
          return { shares: { ...s.shares, [documentId]: { ...share, isPrivate } } }
        }),
    }),
    { name: 'flowdesk-doc-sharing' },
  ),
)
