import { useEffect, useState } from 'react'

import type { User } from './types'
import { displayName } from '../stores/auth'

/** Morning / afternoon / evening based on local time. */
export function timeGreeting(now = new Date()): string {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** First name (or email local-part) for "Good evening, Alex". */
export function greetingFirstName(user: User | null): string {
  if (!user) return ''
  const raw = displayName(user).trim()
  if (!raw) return ''
  if (raw.includes('@')) {
    const local = raw.split('@')[0] ?? ''
    if (!local) return ''
    return local.charAt(0).toUpperCase() + local.slice(1)
  }
  return raw.split(/\s+/)[0] ?? ''
}

const GREETING_TICK_MS = 60_000

/** Recomputes greeting every minute and when the tab becomes visible again. */
export function useTimeGreeting(): string {
  const [greeting, setGreeting] = useState(() => timeGreeting())

  useEffect(() => {
    const refresh = () => setGreeting(timeGreeting())
    refresh()
    const interval = window.setInterval(refresh, GREETING_TICK_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return greeting
}
