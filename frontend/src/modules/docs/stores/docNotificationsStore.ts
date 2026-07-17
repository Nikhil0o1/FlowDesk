import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { DocNotification, DocNotificationType } from '../types/notification'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface DocNotificationsState {
  items: DocNotification[]
  push: (input: {
    type: DocNotificationType
    title: string
    body: string
    documentId: string
    documentTitle: string
    userId: string
  }) => void
  markRead: (id: string) => void
  markAllRead: (userId: string) => void
  unreadCount: (userId: string) => number
}

/**
 * Docs-scoped notification inbox (localStorage `flowdesk-doc-notifications`).
 * TODO(backend): merge into global notification_service + Inbox.
 */
export const useDocNotificationsStore = create<DocNotificationsState>()(
  persist(
    (set, get) => ({
      items: [],
      push: (input) => {
        const item: DocNotification = { ...input, id: newId(), read: false, at: new Date().toISOString() }
        set((s) => ({ items: [item, ...s.items] }))
      },
      markRead: (id) => set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
      markAllRead: (userId) =>
        set((s) => ({
          items: s.items.map((n) => (n.userId === userId ? { ...n, read: true } : n)),
        })),
      unreadCount: (userId) => get().items.filter((n) => n.userId === userId && !n.read).length,
    }),
    { name: 'flowdesk-doc-notifications' },
  ),
)
