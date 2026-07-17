export const SECONDARY_SIDEBAR_DEFAULT_WIDTH = 256
export const SECONDARY_SIDEBAR_MIN_WIDTH = 200
export const SECONDARY_SIDEBAR_MAX_WIDTH = 480

export function clampSecondarySidebarWidth(width: number): number {
  return Math.round(Math.min(SECONDARY_SIDEBAR_MAX_WIDTH, Math.max(SECONDARY_SIDEBAR_MIN_WIDTH, width)))
}
