/** Timestamp + actor last-write-wins helpers for live doc content sync. */

export interface DocContentStamp {
  /** Wall-clock ms (client). */
  version: number
  /** Actor user id — tie-break when versions match. */
  userId?: string | null
}

/**
 * Independent per-client counters collide (both go 1→2→3) and peers drop
 * equal versions. Wall-clock stamps almost never collide; userId breaks ties.
 */
export function shouldApplyRemoteContent(
  local: DocContentStamp,
  remoteVersion: number | undefined | null,
  remoteUserId?: string | null,
): boolean {
  const remote = typeof remoteVersion === 'number' && Number.isFinite(remoteVersion) ? remoteVersion : 0
  if (!remote) return false
  if (remote > local.version) return true
  if (remote < local.version) return false
  const a = remoteUserId || ''
  const b = local.userId || ''
  return !!a && !!b && a > b
}

/** Monotonic-ish stamp for a local edit (never goes backwards vs prior). */
export function nextContentStamp(previousVersion: number): number {
  return Math.max(Date.now(), previousVersion + 1)
}
