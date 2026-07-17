import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { DocComment } from '../types/comment'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface CommentsState {
  comments: DocComment[]
  addComment: (input: Omit<DocComment, 'id' | 'createdAt' | 'updatedAt' | 'resolved'> & { resolved?: boolean }) => DocComment
  updateComment: (id: string, patch: Partial<Pick<DocComment, 'body' | 'resolved'>>) => void
  removeComment: (id: string) => void
}

/** Document comments (localStorage `flowdesk-doc-comments`). TODO(backend): sync via API + WS. */
export const useCommentsStore = create<CommentsState>()(
  persist(
    (set) => ({
      comments: [],
      addComment: (input) => {
        const ts = new Date().toISOString()
        const comment: DocComment = {
          ...input,
          id: newId(),
          resolved: input.resolved ?? false,
          createdAt: ts,
          updatedAt: ts,
        }
        set((s) => ({ comments: [...s.comments, comment] }))
        return comment
      },
      updateComment: (id, patch) =>
        set((s) => ({
          comments: s.comments.map((c) =>
            c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
          ),
        })),
      removeComment: (id) => set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
    }),
    { name: 'flowdesk-doc-comments' },
  ),
)
