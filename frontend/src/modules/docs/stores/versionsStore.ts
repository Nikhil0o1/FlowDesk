import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { DocVersion } from '../types/version'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface VersionsState {
  versions: DocVersion[]
  addVersion: (input: Omit<DocVersion, 'id' | 'versionNumber'>) => DocVersion
  removeVersionsForDoc: (documentId: string) => void
}

/** Document version snapshots (localStorage `flowdesk-doc-versions`). TODO(backend). */
export const useVersionsStore = create<VersionsState>()(
  persist(
    (set, get) => ({
      versions: [],
      addVersion: (input) => {
        const existing = get().versions.filter((v) => v.documentId === input.documentId)
        const versionNumber = existing.length + 1
        const version: DocVersion = { ...input, id: newId(), versionNumber }
        set((s) => ({ versions: [version, ...s.versions] }))
        return version
      },
      removeVersionsForDoc: (documentId) =>
        set((s) => ({ versions: s.versions.filter((v) => v.documentId !== documentId) })),
    }),
    { name: 'flowdesk-doc-versions' },
  ),
)
