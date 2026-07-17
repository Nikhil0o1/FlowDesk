import { restore } from '@excalidraw/excalidraw'

import type { WhiteboardScene } from './types'

/** Merge remote elements into local, keeping the higher `version` per id (live collab only). */
export function mergeElementsByVersion(local: readonly any[], remote: readonly any[]): any[] {
  const map = new Map<string, any>()
  for (const el of local) map.set(el.id, el)
  for (const el of remote) {
    const cur = map.get(el.id)
    const newer =
      !cur ||
      (el.version ?? 0) > (cur.version ?? 0) ||
      ((el.version ?? 0) === (cur.version ?? 0) && (el.versionNonce ?? 0) > (cur.versionNonce ?? 0))
    if (newer) map.set(el.id, el)
  }
  return Array.from(map.values())
}

/** Restore and sanitise a stored whiteboard scene for Excalidraw. */
export function restoreBoardScene(content: WhiteboardScene | undefined | null) {
  const c = content || {}
  const restored = restore(
    {
      elements: (c.elements as any) ?? [],
      appState: (c.appState as any) ?? {},
      files: (c.files as any) ?? {},
    },
    null,
    null,
  )
  return { ...restored, scrollToContent: true as const }
}

/** Stable signature for a board's stored elements (per-board dedup). */
export function boardElementsSignature(boardId: string, elements: readonly any[]): string {
  return `${boardId}:${elements.map((e) => `${e.id}:${e.version ?? 0}`).join('|')}`
}
