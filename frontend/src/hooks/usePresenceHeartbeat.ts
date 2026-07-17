import { useEffect } from 'react'

import { heartbeatPresenceStatus, usePresencePreferenceStore } from '../lib/presence'
import { api } from '../lib/api'
import { useAuthStore } from '../stores/auth'

const HEARTBEAT_MS = 45_000

/**
 * Reports the current user's presence to the backend while the app is open.
 *
 * Backend flow: the first heartbeat opens a session (login), subsequent beats
 * refresh last_activity, and the tab going hidden re-asserts an "away" status
 * unless the user has set a manual busy presence (profile Busy / In a meeting).
 * Sessions time out server-side, so a hard close (crash / kill) still resolves
 * to offline without needing a reliable unload beacon.
 */
export function usePresenceHeartbeat() {
  const userId = useAuthStore((s) => s.user?.id)
  const statusText = useAuthStore((s) => s.user?.profile?.status_text)

  useEffect(() => {
    if (!userId) return

    void usePresencePreferenceStore.getState().applyFromProfileStatus(statusText)

    const beat = () => {
      const status = heartbeatPresenceStatus()
      void api.post('/presence/heartbeat', { status }).catch(() => {})
    }

    beat()
    const interval = window.setInterval(beat, HEARTBEAT_MS)

    const onVisibility = () => beat()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId, statusText])
}
