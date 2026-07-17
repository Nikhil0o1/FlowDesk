import { useMemo } from 'react'
import { Star } from 'lucide-react'

import { DocsListView } from '../components/DocsListView'
import { FolderCard } from '../components/FolderCard'
import { useDocuments } from '../hooks/useDocuments'
import { useFavorites } from '../hooks/useFavorites'
import { useFolders } from '../hooks/useFolders'

/** Favorited folders + documents, most-recently-favorited first. */
export default function FavoritesPage() {
  const { activeDocuments } = useDocuments()
  const { folders } = useFolders()
  const { isFavorite, favoritedAt } = useFavorites()

  const favDocs = useMemo(
    () => activeDocuments.filter((d) => isFavorite(d.id)).sort((a, b) => favoritedAt(b.id) - favoritedAt(a.id)),
    [activeDocuments, isFavorite, favoritedAt],
  )
  const favFolders = useMemo(
    () => folders.filter((f) => isFavorite(f.id)).sort((a, b) => favoritedAt(b.id) - favoritedAt(a.id)),
    [folders, isFavorite, favoritedAt],
  )

  return (
    <DocsListView
      title="Favorites"
      crumbLabel="Favorites"
      docs={favDocs}
      context="active"
      emptyIcon={Star}
      emptyTitle="No favorites yet."
      emptyDescription="Star documents and folders to find them here quickly."
      searchPlaceholder="Search favorites"
      renderExtraTop={(query) => {
        const q = query.trim().toLowerCase()
        const shown = q ? favFolders.filter((f) => f.name.toLowerCase().includes(q)) : favFolders
        if (shown.length === 0) return null
        return (
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Folders</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((f) => (
                <FolderCard key={f.id} folder={f} />
              ))}
            </div>
          </section>
        )
      }}
    />
  )
}
