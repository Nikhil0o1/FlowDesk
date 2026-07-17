import {
  Boxes,
  CornerDownLeft,
  Hash,
  Inbox,
  ListChecks,
  MessageSquareText,
  SquareCheck,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { HomeItemId, HomeSidebarSettings } from '../types/sidebarSettings'

/**
 * Single source of truth for the "Home" section shortcuts. The Home sidebar
 * (rendering) and the Home customization UI (toggles) both read from this
 * array, so adding a real feature here surfaces it in both places.
 *
 * Every entry maps to an existing FlowDesk route — no placeholders.
 */
export interface HomeItem {
  id: HomeItemId
  label: string
  to: string
  icon: LucideIcon
  /** Which unread counter to show next to the shortcut, if any. */
  badge?: 'inbox' | 'replies'
}

export const HOME_ITEMS: readonly HomeItem[] = [
  { id: 'notifications', label: 'Inbox', to: '/app/notifications', icon: Inbox, badge: 'inbox' },
  { id: 'replies', label: 'Replies', to: '/app/replies', icon: CornerDownLeft, badge: 'replies' },
  { id: 'myTasks', label: 'My Tasks', to: '/app/my-tasks', icon: SquareCheck },
  { id: 'myAnalytics', label: 'My Analytics', to: '/app/my-analytics', icon: TrendingUp },
  { id: 'sprints', label: 'Sprints', to: '/app/sprints', icon: Zap },
  { id: 'assignedComments', label: 'Assigned Comments', to: '/app/assigned-comments', icon: MessageSquareText },
  { id: 'allTasks', label: 'All Tasks', to: '/app/all-tasks', icon: ListChecks },
  { id: 'allSpaces', label: 'All Spaces', to: '/app/all-spaces', icon: Boxes },
  { id: 'allChannels', label: 'All Channels', to: '/app/all-channels', icon: Hash },
] as const

/** Fast id → item lookup for guard logic and rendering. */
export const HOME_ITEM_BY_ID: Record<HomeItemId, HomeItem> = HOME_ITEMS.reduce(
  (acc, item) => {
    acc[item.id] = item
    return acc
  },
  {} as Record<HomeItemId, HomeItem>,
)

/** New users (and unknown/missing keys) default to every shortcut visible. */
export const DEFAULT_HOME_SETTINGS: HomeSidebarSettings = HOME_ITEMS.reduce((acc, item) => {
  acc[item.id] = true
  return acc
}, {} as HomeSidebarSettings)
