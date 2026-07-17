import { MENTION_MARKUP_RE } from '../../../lib/utils'

import type { DocNotificationType } from '../types/notification'

/**
 * Docs notification helpers (mock). TODO(backend): wire to notification_service.notify().
 */

export function extractMentionedUserIds(body: string): string[] {
  const ids: string[] = []
  const re = /@\[([^\]]+)\]\(([0-9a-fA-F-]{36})\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) ids.push(m[2])
  return [...new Set(ids)]
}

export function notificationTitle(type: DocNotificationType, documentTitle: string): string {
  switch (type) {
    case 'mention':
      return `You were mentioned in "${documentTitle}"`
    case 'reply':
      return `New reply in "${documentTitle}"`
    case 'comment':
      return `New comment on "${documentTitle}"`
    case 'shared':
      return `"${documentTitle}" was shared with you`
    case 'permission_changed':
      return `Your access to "${documentTitle}" changed`
    case 'restored':
      return `"${documentTitle}" was restored`
    default:
      return documentTitle
  }
}

export function plainBodyPreview(body: string, max = 120): string {
  const plain = body.replace(MENTION_MARKUP_RE, '@$1').replace(/<[^>]+>/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max)}…` : plain
}
