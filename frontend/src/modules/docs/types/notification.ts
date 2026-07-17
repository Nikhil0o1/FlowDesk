export type DocNotificationType =
  | 'mention'
  | 'reply'
  | 'comment'
  | 'shared'
  | 'permission_changed'
  | 'restored'

export interface DocNotification {
  id: string
  type: DocNotificationType
  title: string
  body: string
  documentId: string
  documentTitle: string
  /** Target user id (mock inbox is per-browser; future: server-side). */
  userId: string
  read: boolean
  at: string
}
