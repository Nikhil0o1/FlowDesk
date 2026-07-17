import type { ActivityEvent } from '../types/activity'

/** Activity for one document, newest first. */
export function activityForDoc(events: ActivityEvent[], documentId: string): ActivityEvent[] {
  return events.filter((e) => e.documentId === documentId).sort((a, b) => b.at.localeCompare(a.at))
}

export const ACTIVITY_LABELS: Record<ActivityEvent['type'], string> = {
  created: 'Created document',
  edited: 'Edited document',
  renamed: 'Renamed document',
  moved: 'Moved document',
  archived: 'Archived document',
  restored: 'Restored document',
  deleted: 'Deleted document',
  shared: 'Shared document',
  permission_changed: 'Changed permissions',
  comment_added: 'Added a comment',
  mentioned: 'Mentioned someone',
  version_restored: 'Restored a version',
}
