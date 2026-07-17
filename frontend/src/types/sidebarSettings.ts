import type { SectionKey } from '../stores/ui'

/**
 * A navigation item is identified by its rail section key. Reusing `SectionKey`
 * keeps the customization feature in lock-step with the actual rail sections —
 * adding a new section automatically makes it customizable.
 */
export type NavItemId = SectionKey

/** Per-user visibility map: `true` = shown in the rail, `false` = hidden. */
export type SidebarNavSettings = Record<NavItemId, boolean>

/**
 * Rail rendering density:
 * - `labels` → icon + text label (default, current behaviour)
 * - `icons`  → icon only, no text label
 */
export type NavAppearance = 'labels' | 'icons'

/**
 * Shortcuts shown under the "Home" section of the sidebar.
 *
 * Adding a new Home feature is just a matter of adding an id here and a config
 * entry in `constants/homeItems.ts` — no sidebar refactoring required.
 */
export type HomeItemId =
  | 'notifications'
  | 'replies'
  | 'myTasks'
  | 'myAnalytics'
  | 'sprints'
  | 'assignedComments'
  | 'allTasks'
  | 'allSpaces'
  | 'allChannels'

/** Per-user visibility map for the Home section shortcuts. */
export type HomeSidebarSettings = Record<HomeItemId, boolean>
