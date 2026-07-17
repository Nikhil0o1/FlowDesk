import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { Folder } from '../types/folder'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface FoldersState {
  folders: Folder[]
  /** One-time seed marker so we never re-seed after the user edits/clears. */
  seeded: boolean
  setSeeded: (v: boolean) => void
  setFolders: (folders: Folder[]) => void
  addFolder: (name: string, parentId: string | null) => Folder
  renameFolder: (id: string, name: string) => void
  removeFolders: (ids: string[]) => void
  moveFolder: (id: string, parentId: string | null) => void
}

/** Persisted folder tree (localStorage `flowdesk-folders`). */
export const useFoldersStore = create<FoldersState>()(
  persist(
    (set) => ({
      folders: [],
      seeded: false,
      setSeeded: (seeded) => set({ seeded }),
      setFolders: (folders) => set({ folders }),

      addFolder: (name, parentId) => {
        const ts = new Date().toISOString()
        const folder: Folder = { id: newId(), name: name.trim(), parentId, createdAt: ts, updatedAt: ts }
        set((s) => ({ folders: [...s.folders, folder] }))
        return folder
      },

      renameFolder: (id, name) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, name: name.trim(), updatedAt: new Date().toISOString() } : f,
          ),
        })),

      removeFolders: (ids) =>
        set((s) => {
          const set_ = new Set(ids)
          return { folders: s.folders.filter((f) => !set_.has(f.id)) }
        }),

      moveFolder: (id, parentId) =>
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, parentId, updatedAt: new Date().toISOString() } : f,
          ),
        })),
    }),
    { name: 'flowdesk-folders' },
  ),
)
