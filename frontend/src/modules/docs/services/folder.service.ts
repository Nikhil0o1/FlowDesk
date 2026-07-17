import type { Folder, FolderNode } from '../types/folder'

/**
 * Folder domain helpers (pure). CRUD lives in the persisted store today; these
 * are the tree/graph utilities the hooks and UI compose.
 *
 * TODO(backend): when a Docs API lands, add async `list/create/update/delete`
 * here and have `useFolders` call these instead of the store directly. The pure
 * helpers below stay unchanged.
 */

/** Build a nested tree from a flat folder list, sorted alphabetically per level. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byParent = new Map<string | null, FolderNode[]>()
  const nodes = new Map<string, FolderNode>()

  for (const f of folders) nodes.set(f.id, { ...f, children: [] })

  for (const node of nodes.values()) {
    const parentKey = node.parentId && nodes.has(node.parentId) ? node.parentId : null
    const bucket = byParent.get(parentKey) ?? []
    bucket.push(node)
    byParent.set(parentKey, bucket)
  }

  const attach = (parentId: string | null): FolderNode[] => {
    const bucket = byParent.get(parentId) ?? []
    bucket.sort((a, b) => a.name.localeCompare(b.name))
    for (const node of bucket) node.children = attach(node.id)
    return bucket
  }

  return attach(null)
}

/** All descendant folder ids of `id`, including `id` itself. */
export function collectFolderAndDescendants(folders: Folder[], id: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (!f.parentId) continue
    const arr = childrenOf.get(f.parentId) ?? []
    arr.push(f.id)
    childrenOf.set(f.parentId, arr)
  }
  const out: string[] = []
  const walk = (fid: string) => {
    out.push(fid)
    for (const child of childrenOf.get(fid) ?? []) walk(child)
  }
  walk(id)
  return out
}

/** Root → target chain, used for breadcrumbs. Returns `[]` if not found. */
export function folderPath(folders: Folder[], id: string | null): Folder[] {
  if (!id) return []
  const byId = new Map(folders.map((f) => [f.id, f]))
  const chain: Folder[] = []
  let cursor = byId.get(id)
  const guard = new Set<string>()
  while (cursor && !guard.has(cursor.id)) {
    guard.add(cursor.id)
    chain.unshift(cursor)
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
  }
  return chain
}

/**
 * A folder may not be moved into itself or any of its descendants (that would
 * create a cycle). Used to filter "Move to" targets.
 */
export function canMoveInto(folders: Folder[], sourceId: string, targetId: string | null): boolean {
  if (targetId === null) return true
  if (sourceId === targetId) return false
  return !collectFolderAndDescendants(folders, sourceId).includes(targetId)
}
