/**
 * Sidebar "sections" — the logical groups rendered in the left sidebar
 * (Home, Channels, Spaces, …) as opposed to individual navigation items.
 *
 * Users can reorder, hide/restore, and create custom sections. The whole
 * system is configuration-driven: adding a new built-in section only requires
 * a new id here + a `constants/sidebarSections.ts` entry — the sidebar and the
 * Customize dialog pick it up automatically.
 */

/** Built-in sections that map to real sidebar content. */
export type BuiltInSectionId = 'home' | 'channels' | 'spaces'

/** A section id is either a known built-in or a user-created custom id. */
export type SectionId = BuiltInSectionId | string

/** A user-created section. `items` is reserved for a future "drag nav items in". */
export interface CustomSection {
  id: string
  name: string
  items: string[]
}

/**
 * Persisted shape (also the localStorage payload under `flowdesk-sidebar-sections`):
 *
 * {
 *   "order":  ["home", "channels", "spaces"],
 *   "hidden": [],
 *   "custom": [{ "id": "planning", "name": "Planning", "items": [] }]
 * }
 */
export interface SidebarSectionsState {
  order: SectionId[]
  hidden: SectionId[]
  custom: CustomSection[]
}

/** A section resolved for rendering: metadata + whether it is user-created. */
export interface ResolvedSection {
  id: SectionId
  title: string
  isCustom: boolean
}
