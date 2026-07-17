/** Presence (online/away/busy) — separate from profile status_text emoji labels. */
import { create } from 'zustand'

import { api } from './api'
import { parseStatus } from './status'

const BUSY_LABELS = new Set(['busy', 'in a meeting', 'focusing'])

export function isBusyStatusText(statusText: string | null | undefined): boolean {
  const { text } = parseStatus(statusText)
  return BUSY_LABELS.has(text.trim().toLowerCase())
}

export type HeartbeatPresenceStatus = 'online' | 'away' | 'busy'

interface PresencePreferenceState {
  /** User chose a do-not-disturb style status — survives tab hidden / away heartbeats. */
  manualBusy: boolean
  setManualBusy: (busy: boolean) => void
  /** Sync presence API + local flag after profile status_text changes. */
  applyFromProfileStatus: (statusText: string | null | undefined) => Promise<void>
}

export const usePresencePreferenceStore = create<PresencePreferenceState>((set, get) => ({
  manualBusy: false,
  setManualBusy: (busy) => set({ manualBusy: busy }),
  applyFromProfileStatus: async (statusText) => {
    const busy = isBusyStatusText(statusText)
    const prev = get().manualBusy
    set({ manualBusy: busy })
    if (busy === prev) return
    try {
      await api.post('/presence/status', { status: busy ? 'busy' : 'online' })
    } catch {
      /* presence is best-effort */
    }
  },
}))

/** Status sent on each heartbeat — busy users stay busy even when the tab is hidden. */
export function heartbeatPresenceStatus(): HeartbeatPresenceStatus {
  if (usePresencePreferenceStore.getState().manualBusy) return 'busy'
  return document.visibilityState === 'hidden' ? 'away' : 'online'
}
