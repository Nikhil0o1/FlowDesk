/** Favorites can point at either a document or a folder. */
export type FavoriteType = 'doc' | 'folder'

export interface FavoriteEntry {
  id: string
  type: FavoriteType
  /** Epoch ms — used to show "Recently favorited". */
  at: number
}
