import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Cap on tracked recent documents — oldest are dropped past this. */
export const MAX_RECENT = 50

export interface RecentEntry {
  id: string
  /** Epoch ms of last open. */
  at: number
}

interface RecentState {
  entries: RecentEntry[]
  track: (id: string) => void
  remove: (id: string) => void
  clear: () => void
}

/** Persisted recently-opened documents (localStorage `flowdesk-recent`). */
export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      entries: [],
      track: (id) =>
        set((s) => {
          const without = s.entries.filter((e) => e.id !== id)
          return { entries: [{ id, at: Date.now() }, ...without].slice(0, MAX_RECENT) }
        }),
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      clear: () => set({ entries: [] }),
    }),
    { name: 'flowdesk-recent' },
  ),
)
