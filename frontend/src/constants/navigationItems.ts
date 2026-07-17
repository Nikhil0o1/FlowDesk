import {
  CalendarDays,
  ClipboardList,
  Clock4,
  FileText,
  LayoutGrid,
  PenTool,
  Trophy,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'

import type { NavItemId, SidebarNavSettings } from '../types/sidebarSettings'

/**
 * Single source of truth for the primary navigation rail. Both the `IconRail`
 * (rendering) and the Navigation customization UI (toggles) read from this
 * array, so a new entry here shows up in both places with zero extra wiring.
 */
export interface NavigationItem {
  id: NavItemId
  /** Full label shown in the customization list. */
  label: string
  /** Shorter label used inside the compact rail (falls back to `label`). */
  railLabel?: string
  /** Destination route. Visibility never affects routing — only the shortcut. */
  to: string
  /** Accent used for the rail glyph. */
  color: string
  /** Lucide glyph. Omitted for `home`, which renders the brand image instead. */
  icon?: LucideIcon
  /**
   * Locked items can never be hidden (their checkbox is disabled). `home`
   * guarantees the "at least one item always visible" invariant.
   */
  locked?: boolean
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { id: 'home', label: 'Home', to: '/app/dashboard', color: '#2B88EE', locked: true },
  { id: 'planner', label: 'Planner', to: '/app/planner', color: '#4285F4', icon: CalendarDays },
  { id: 'teams', label: 'Teams', to: '/app/teams', color: '#E667A8', icon: UsersRound },
  { id: 'docs', label: 'Docs', to: '/app/docs', color: '#7A5AF8', icon: FileText },
  {
    id: 'whiteboards',
    label: 'Whiteboards',
    railLabel: 'Whiteboa..',
    to: '/app/whiteboards',
    color: '#F2994A',
    icon: PenTool,
  },
  { id: 'goals', label: 'Goals', to: '/app/goals', color: '#C9A227', icon: Trophy },
  { id: 'forms', label: 'Forms', to: '/app/forms', color: '#4CB782', icon: ClipboardList },
  { id: 'timesheet', label: 'Timesheet', to: '/app/timesheet', color: '#26B5CE', icon: Clock4 },
  { id: 'apps', label: 'More', to: '/app/apps', color: '#B07BE0', icon: LayoutGrid },
] as const

/** Fast id → item lookup for guard logic and rendering. */
export const NAV_ITEM_BY_ID: Record<NavItemId, NavigationItem> = NAVIGATION_ITEMS.reduce(
  (acc, item) => {
    acc[item.id] = item
    return acc
  },
  {} as Record<NavItemId, NavigationItem>,
)

/** New users (and unknown/missing keys) default to every item visible. */
export const DEFAULT_NAV_SETTINGS: SidebarNavSettings = NAVIGATION_ITEMS.reduce((acc, item) => {
  acc[item.id] = true
  return acc
}, {} as SidebarNavSettings)
