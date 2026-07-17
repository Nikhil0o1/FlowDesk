/** A documentation folder. Folders nest arbitrarily via `parentId`. */
export interface Folder {
  id: string
  name: string
  /** `null` = top-level folder. */
  parentId: string | null
  /** When true, only the creator and invited share members can see it. */
  isPrivate?: boolean
  createdBy?: string | null
  createdAt: string
  updatedAt: string
}

/** A folder with its children resolved — the shape the tree renders from. */
export interface FolderNode extends Folder {
  children: FolderNode[]
}
