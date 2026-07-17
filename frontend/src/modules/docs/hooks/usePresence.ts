import { useEffect, useMemo } from 'react'

import { useRealtime } from '../../../lib/ws'
import { displayName, useAuthStore } from '../../../stores/auth'
import { publishDocPresence, subscribeDocRoom } from '../services/collaboration.ws'
import { useDocPresenceStore } from '../stores/presenceStore'

const CURSOR_COLORS = ['#4f8bff', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#06b6d4', '#ef4444', '#14b8a6']

export function colorForUser(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CURSOR_COLORS[h % CURSOR_COLORS.length]
}

/** Live document presence over the shared WebSocket (document room). */
export function usePresence(documentId: string) {
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? ''
  const name = displayName(user) || 'You'
  const avatarUrl = user?.profile?.avatar_url ?? null
  const avatarColor = user?.profile?.avatar_color ?? null

  const upsert = useDocPresenceStore((s) => s.upsert)
  const leave = useDocPresenceStore((s) => s.leave)
  const prune = useDocPresenceStore((s) => s.prune)
  const viewersRaw = useDocPresenceStore((s) => s.byDocument[documentId])

  useEffect(() => {
    if (!documentId || !userId) return
    const meta = {
      username: name,
      avatarUrl,
      avatarColor,
      color: colorForUser(userId),
    }
    const sub = () => {
      subscribeDocRoom(documentId, meta)
      publishDocPresence(documentId, 'heartbeat', meta)
    }
    sub()
    // Re-join often so reconnects re-enter the document room quickly.
    const iv = window.setInterval(sub, 3_000)
    return () => {
      window.clearInterval(iv)
      publishDocPresence(documentId, 'leave', meta)
      leave(documentId, userId)
    }
  }, [documentId, userId, name, avatarUrl, avatarColor, leave])

  useRealtime(
    'doc.presence',
    (event) => {
      if (event.document_id !== documentId) return
      const id = String(event.payload.user_id || '')
      if (!id || id === userId) return
      if (event.payload.action === 'leave') {
        leave(documentId, id)
        return
      }
      upsert(documentId, {
        userId: id,
        name: event.payload.username || 'Teammate',
        avatarUrl: event.payload.avatarUrl ?? null,
        avatarColor: event.payload.avatarColor ?? event.payload.color ?? null,
      })
    },
    [documentId, userId, upsert, leave],
  )

  useRealtime(
    'doc.cursor',
    (event) => {
      if (event.document_id !== documentId) return
      const id = String(event.payload.user_id || '')
      if (!id || id === userId) return
      upsert(documentId, {
        userId: id,
        name: event.payload.username || 'Teammate',
        avatarUrl: event.payload.avatarUrl ?? null,
        avatarColor: event.payload.avatarColor ?? event.payload.color ?? null,
      })
    },
    [documentId, userId, upsert],
  )

  useEffect(() => {
    if (!documentId) return
    const iv = window.setInterval(() => prune(documentId), 5_000)
    return () => window.clearInterval(iv)
  }, [documentId, prune])

  const viewers = useMemo(() => {
    const now = Date.now()
    return (viewersRaw ?? []).filter((v) => now - v.lastSeen < 15_000 && v.userId !== userId)
  }, [viewersRaw, userId])

  return { viewers, viewerCount: viewers.length }
}
