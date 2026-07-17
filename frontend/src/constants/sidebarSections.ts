import type { BuiltInSectionId } from '../types/sidebarSections'

/**
 * Single source of truth for the sidebar's built-in sections. Never hardcode
 * section order in the sidebar — render from this list (via `useSidebarSections`)
 * so future sections (Favorites, Recent, Teams, Archived, …) drop in with just
 * a new entry here.
 */
export interface SidebarSectionDef {
  id: BuiltInSectionId
  title: string
}

export const SIDEBAR_SECTIONS: readonly SidebarSectionDef[] = [
  { id: 'home', title: 'Home' },
  { id: 'channels', title: 'Channels' },
  { id: 'spaces', title: 'Spaces' },
] as const

/** Default top-to-bottom order for a fresh user (all sections visible). */
export const DEFAULT_SECTION_ORDER: BuiltInSectionId[] = SIDEBAR_SECTIONS.map((s) => s.id)

/** Fast title lookup for built-in sections. */
export const SECTION_TITLE: Record<string, string> = Object.fromEntries(
  SIDEBAR_SECTIONS.map((s) => [s.id, s.title]),
)

export function isBuiltInSection(id: string): id is BuiltInSectionId {
  return id in SECTION_TITLE
}
