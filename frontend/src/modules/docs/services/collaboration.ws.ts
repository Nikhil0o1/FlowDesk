/**
 * WebSocket contracts + helpers for realtime document collaboration
 * (mirrors whiteboard.subscribe / scene / cursor).
 */
import { realtime } from '../../../lib/ws'

export type DocRealtimeEvent =
  | { type: 'doc.comment.created'; documentId: string; commentId: string }
  | { type: 'doc.comment.updated'; documentId: string; commentId: string }
  | { type: 'doc.presence'; documentId: string; userId: string; action?: string }
  | { type: 'doc.content'; documentId: string; version: number }
  | { type: 'doc.cursor'; documentId: string; userId: string; offset: number }

export function subscribeDocRoom(documentId: string, payload?: Record<string, unknown>) {
  realtime.send({
    type: 'doc.subscribe',
    document_id: documentId,
    payload: payload ?? {},
  })
}

export function publishDocContent(
  documentId: string,
  content: string,
  version: number,
  meta?: { username?: string; color?: string },
) {
  realtime.send({
    type: 'doc.content',
    document_id: documentId,
    payload: { content, version, ...meta },
  })
}

export function publishDocCursor(
  documentId: string,
  offset: number,
  meta?: { username?: string; color?: string },
) {
  realtime.send({
    type: 'doc.cursor',
    document_id: documentId,
    payload: { offset, ...meta },
  })
}

export function publishDocPresence(
  documentId: string,
  action: 'join' | 'leave' | 'heartbeat',
  meta?: { username?: string; avatarUrl?: string | null; avatarColor?: string | null; color?: string },
) {
  realtime.send({
    type: 'doc.presence',
    document_id: documentId,
    payload: { action, ...meta },
  })
}
