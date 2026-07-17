import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ActivityEvent, ActivityType } from '../types/activity'

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface ActivityState {
  events: ActivityEvent[]
  log: (input: {
    documentId: string
    type: ActivityType
    actorId: string
    actorName: string
    detail: string
  }) => ActivityEvent
}

/** Document activity timeline (localStorage `flowdesk-doc-activity`). TODO(backend). */
export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      events: [],
      log: (input) => {
        const event: ActivityEvent = { ...input, id: newId(), at: new Date().toISOString() }
        set((s) => ({ events: [event, ...s.events] }))
        return event
      },
    }),
    { name: 'flowdesk-doc-activity' },
  ),
)
