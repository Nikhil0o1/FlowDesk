import { Boxes, LayoutGrid, List, Star } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCurrentContext, useProjects } from '../../lib/queries'
import { EntityIcon } from '../../lib/entityIcons'
import { cn } from '../../lib/utils'
import { useAllSpaces, type AllSpacesItem } from '../../services/spaces.service'
import { ErrorState } from '../../components/home/ErrorState'
import { HomePageHeader } from '../../components/home/HomePageHeader'
import { SearchInput } from '../../components/home/SearchInput'
import { EmptyState } from '../../components/ui/EmptyState'
import { Skeleton } from '../../components/ui/Skeleton'

const FAVORITES_KEY = 'flowdesk-space-favorites'

function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

type View = 'grid' | 'list'

export default function AllSpacesPage() {
  const { data, isLoading, error } = useAllSpaces()
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [view, setView] = useState<View>('grid')
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites)

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  // First project per space powers the "Open" action (there is no space route).
  const firstProjectBySpace = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects.data ?? []) {
      if (!p.is_archived && p.space_id && !map.has(p.space_id)) map.set(p.space_id, p.id)
    }
    return map
  }, [projects.data])

  const visible = useMemo(() => {
    const query = q.trim().toLowerCase()
    return data.filter((s) => !query || s.name.toLowerCase().includes(query))
  }, [data, q])

  const favoriteSpaces = visible.filter((s) => favorites.has(s.id))
  const otherSpaces = visible.filter((s) => !favorites.has(s.id))

  const renderCard = (space: AllSpacesItem) => (
    <SpaceCard
      key={space.id}
      space={space}
      view={view}
      favorite={favorites.has(space.id)}
      onToggleFavorite={() => toggleFavorite(space.id)}
      openProjectId={firstProjectBySpace.get(space.id)}
      onOpen={(projectId) => navigate(`/app/projects/${projectId}`)}
    />
  )

  const groupClass =
    view === 'grid'
      ? 'grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1'
      : 'flex flex-col gap-2'

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      <HomePageHeader title="All Spaces" description="Every Space in this workspace." />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search spaces" className="max-w-xs flex-1" />
        <div className="flex rounded-lg border border-ink-700 bg-ink-850 p-0.5">
          <ViewToggle active={view === 'grid'} onClick={() => setView('grid')} label="Grid view">
            <LayoutGrid size={15} />
          </ViewToggle>
          <ViewToggle active={view === 'list'} onClick={() => setView('list')} label="List view">
            <List size={15} />
          </ViewToggle>
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <ErrorState />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={q ? 'No matching spaces' : 'No spaces available'}
            description="Spaces you can access will appear here."
          />
        ) : (
          <div className="space-y-6">
            {favoriteSpaces.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">Favorites</p>
                <div className={groupClass}>{favoriteSpaces.map(renderCard)}</div>
              </div>
            )}
            <div>
              {favoriteSpaces.length > 0 && (
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">All Spaces</p>
              )}
              <div className={groupClass}>{otherSpaces.map(renderCard)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ViewToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'rounded-md p-1.5 transition-colors',
        active ? 'bg-brand-soft text-fg' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function SpaceCard({
  space,
  view,
  favorite,
  onToggleFavorite,
  openProjectId,
  onOpen,
}: {
  space: AllSpacesItem
  view: View
  favorite: boolean
  onToggleFavorite: () => void
  openProjectId: string | undefined
  onOpen: (projectId: string) => void
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-ink-700 bg-ink-850/60 p-4 transition-colors hover:border-ink-600',
        view === 'list' && 'flex items-center gap-4',
      )}
    >
      <div className={cn('flex items-center gap-3', view === 'grid' && 'mb-3')}>
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: space.color }}
        >
          {space.icon ? <EntityIcon icon={space.icon} size={18} /> : space.name[0]?.toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{space.name}</p>
          <p className="text-xs text-fg-muted">
            {space.projectCount} project{space.projectCount === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className={cn('flex items-center gap-2', view === 'grid' ? 'justify-end' : 'ml-auto')}>
        <button
          onClick={onToggleFavorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={favorite}
          className={cn(
            'rounded-lg p-1.5 transition-colors hover:bg-ink-750',
            favorite ? 'text-amber-400' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Star size={15} fill={favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          className="btn-secondary !py-1.5 text-xs"
          disabled={!openProjectId}
          title={openProjectId ? 'Open first project' : 'No projects yet'}
          onClick={() => openProjectId && onOpen(openProjectId)}
        >
          Open
        </button>
      </div>
    </div>
  )
}
