/** WebSocket client: auto-connect, reconnect with backoff, event bus, presence. */
import { useEffect } from 'react'
import { create } from 'zustand'

import { useAuthStore } from '../stores/auth'
import { API_ORIGIN, tryRefresh } from './api'

export interface RealtimeEvent {
  type: string
  payload: Record<string, any>
  workspace_id?: string
  project_id?: string
  task_id?: string
  channel_id?: string
}

type Handler = (event: RealtimeEvent) => void

interface PresenceState {
  online: Set<string>
  setOnline: (ids: string[]) => void
  add: (id: string) => void
  remove: (id: string) => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  online: new Set(),
  setOnline: (ids) => set({ online: new Set(ids) }),
  add: (id) =>
    set((s) => {
      const next = new Set(s.online)
      next.add(id)
      return { online: next }
    }),
  remove: (id) =>
    set((s) => {
      const next = new Set(s.online)
      next.delete(id)
      return { online: next }
    }),
}))

class RealtimeClient {
  private ws: WebSocket | null = null
  private handlers = new Map<string, Set<Handler>>()
  private reconnectDelay = 1000
  private shouldRun = false
  private pingInterval: number | null = null

  start() {
    this.shouldRun = true
    this.connect()
  }

  stop() {
    this.shouldRun = false
    if (this.pingInterval) window.clearInterval(this.pingInterval)
    this.ws?.close()
    this.ws = null
  }

  private connect() {
    const token = useAuthStore.getState().accessToken
    if (!this.shouldRun) return
    if (!token) {
      // Token not in memory yet (or refresh in flight) — retry shortly
      setTimeout(() => this.connect(), this.reconnectDelay)
      return
    }
    // Connect to VITE_API_URL when set (Vercel ↔ Render), else same origin (dev proxy)
    const httpBase =
      API_ORIGIN || `${window.location.protocol === 'https:' ? 'https' : 'http'}://${window.location.host}`
    const ws = new WebSocket(`${httpBase.replace(/^http/, 'ws')}/api/v1/ws?token=${token}`)
    this.ws = ws

    ws.onopen = () => {
      this.reconnectDelay = 1000
      if (this.pingInterval) window.clearInterval(this.pingInterval)
      this.pingInterval = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      }, 30000)
    }

    ws.onmessage = (raw) => {
      let event: RealtimeEvent
      try {
        event = JSON.parse(raw.data)
      } catch {
        return
      }
      if (event.type === 'presence.state') {
        usePresenceStore.getState().setOnline(event.payload.online_user_ids ?? [])
      } else if (event.type === 'presence.online') {
        usePresenceStore.getState().add(event.payload.user_id)
      } else if (event.type === 'presence.offline') {
        usePresenceStore.getState().remove(event.payload.user_id)
      }
      this.dispatch(event)
    }

    ws.onclose = (e) => {
      if (this.pingInterval) window.clearInterval(this.pingInterval)
      if (!this.shouldRun) return
      const delay = this.reconnectDelay
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000)
      setTimeout(() => {
        // 4401 = server explicitly closed with expired-token reason.
        // 1006 = abnormal close, which is what browsers report when the server
        // rejects the WebSocket upgrade with HTTP 403 (token expired at connect
        // time). Both cases need a token refresh before reconnecting.
        if (e.code === 4401 || e.code === 1006) {
          void tryRefresh().then((result) => {
            if (result === 'denied') {
              useAuthStore.getState().clear()
            } else {
              this.connect()
            }
          })
        } else {
          this.connect()
        }
      }, delay)
    }
  }

  send(message: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  on(type: string, handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  private dispatch(event: RealtimeEvent) {
    this.handlers.get(event.type)?.forEach((h) => h(event))
    this.handlers.get('*')?.forEach((h) => h(event))
  }
}

export const realtime = new RealtimeClient()

/** Subscribe to one or more realtime event types for the lifetime of a component. */
export function useRealtime(types: string | string[], handler: Handler, deps: unknown[] = []) {
  useEffect(() => {
    const list = Array.isArray(types) ? types : [types]
    const offs = list.map((t) => realtime.on(t, handler))
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
