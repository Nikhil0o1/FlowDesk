/** WebSocket client: auto-connect, reconnect with backoff, event bus, presence. */
import { useEffect } from 'react'
import { create } from 'zustand'

import { useAuthStore } from '../stores/auth'

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
    if (!token || !this.shouldRun) return
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/v1/ws?token=${token}`)
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

    ws.onclose = () => {
      if (this.pingInterval) window.clearInterval(this.pingInterval)
      if (!this.shouldRun) return
      setTimeout(() => this.connect(), this.reconnectDelay)
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000)
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
