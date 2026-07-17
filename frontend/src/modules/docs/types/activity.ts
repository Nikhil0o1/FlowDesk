export type ActivityType =
  | 'created'
  | 'edited'
  | 'renamed'
  | 'moved'
  | 'archived'
  | 'restored'
  | 'deleted'
  | 'shared'
  | 'permission_changed'
  | 'comment_added'
  | 'mentioned'
  | 'version_restored'

export interface ActivityEvent {
  id: string
  documentId: string
  type: ActivityType
  actorId: string
  actorName: string
  /** Human-readable detail, e.g. "Changed role to Editor". */
  detail: string
  at: string
}
