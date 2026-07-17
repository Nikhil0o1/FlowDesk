import type { InboxFilter, InboxTab } from './types'

export type ShortcutKey = string | { label: string; icon?: 'shift' | 'up' | 'down' }

export interface ShortcutItem {
  description: string
  keys: ShortcutKey[]
}

export interface ShortcutSection {
  title: string
  subtitle?: string
  items: ShortcutItem[]
}

export interface ShortcutCategory {
  id: string
  label: string
  sections: ShortcutSection[]
}

const SHIFT: ShortcutKey = { label: 'Shift', icon: 'shift' }
const UP: ShortcutKey = { label: '↑', icon: 'up' }
const DOWN: ShortcutKey = { label: '↓', icon: 'down' }

export function buildInboxShortcutCategories(modKey: string): ShortcutCategory[] {
  return [
    {
      id: 'global',
      label: 'Global',
      sections: [
        {
          title: 'Global',
          items: [
            { description: 'Open search', keys: [modKey, 'K'] },
            { description: 'Close dialog, menu, or filter', keys: ['Esc'] },
          ],
        },
      ],
    },
    {
      id: 'inbox',
      label: 'Inbox',
      sections: [
        {
          title: 'Tabs & Filters',
          subtitle: 'Jump between inbox tabs and filter your notifications',
          items: [
            { description: 'Go to All tab', keys: [SHIFT, 'A'] },
            { description: 'Go to Primary tab', keys: [SHIFT, 'P'] },
            { description: 'Go to Other tab', keys: [SHIFT, 'O'] },
            { description: 'Go to Later tab', keys: [SHIFT, 'Z'] },
            { description: 'Go to Cleared tab', keys: [SHIFT, 'C'] },
            { description: 'Toggle @Mentions filter', keys: [SHIFT, '1'] },
            { description: 'Toggle Assigned filter', keys: [SHIFT, '2'] },
            { description: 'Toggle Unread filter', keys: [SHIFT, '3'] },
            { description: 'Toggle Reminders filter', keys: [SHIFT, '4'] },
          ],
        },
        {
          title: 'Navigation',
          subtitle: 'Navigate your notifications with ease',
          items: [
            { description: 'Open selected notification', keys: ['Enter'] },
            { description: 'Open selected notification', keys: ['O'] },
            { description: 'Clear selection / close panel', keys: ['Esc'] },
            { description: 'Next notification', keys: ['J'] },
            { description: 'Next notification', keys: [DOWN] },
            { description: 'Previous notification', keys: ['K'] },
            { description: 'Previous notification', keys: [UP] },
            { description: 'Jump to top', keys: [SHIFT, UP] },
            { description: 'Jump to bottom', keys: [SHIFT, DOWN] },
            { description: 'Refresh inbox', keys: ['Space'] },
          ],
        },
        {
          title: 'Notifications',
          subtitle: 'Clear, snooze, and take action in your Inbox',
          items: [
            { description: 'Clear selected notification', keys: ['E'] },
            { description: 'Clear all in current tab', keys: [SHIFT, 'E'] },
            { description: 'Snooze selected notification', keys: ['Z'] },
            { description: 'Undo last clear, snooze, or read change', keys: [modKey, 'Z'] },
            { description: 'Mark selected as read or unread', keys: ['U'] },
          ],
        },
      ],
    },
  ]
}

export const INBOX_FILTER_BY_INDEX: Record<string, InboxFilter> = {
  '1': 'mentions',
  '2': 'assigned',
  '3': 'unread',
  '4': 'reminders',
}

export const INBOX_TAB_BY_KEY: Record<string, InboxTab> = {
  a: 'all',
  p: 'primary',
  o: 'other',
  z: 'later',
  c: 'cleared',
}
