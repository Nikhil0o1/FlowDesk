import { Check, LayoutPanelLeft, PanelTop, Plus, Star } from 'lucide-react'
import { useState } from 'react'

import { useFavorites } from '../../hooks/useFavorites'
import {
  addFavoriteSection,
  isFavorite,
  moveFavoriteToSection,
  setFavoritePlacement,
  toggleFavorite,
  type FavoritePlacement,
  type FavoriteTarget,
} from '../../lib/favorites'
import { cn } from '../../lib/utils'
import { Dropdown } from '../ui/Dropdown'
import { CreateFavoriteSectionModal } from './CreateFavoriteSectionModal'

export function FavoriteButton({ target, className }: { target: FavoriteTarget; className?: string }) {
  const { placement, sections, items } = useFavorites()
  const favorited = items.some((item) => item.key === target.key)
  const activeSectionId =
    items.find((item) => item.key === target.key)?.sectionId ?? sections[0]?.id ?? 'favorites'

  const [createSectionOpen, setCreateSectionOpen] = useState(false)

  const pickPlacement = (next: FavoritePlacement) => {
    setFavoritePlacement(next)
    if (!favorited) {
      toggleFavorite(target, activeSectionId)
    }
  }

  const onToggleFavorite = () => {
    toggleFavorite(target, activeSectionId)
  }

  const menu = (close: () => void) => (
    <div className="w-72 py-2" onMouseDown={(e) => e.stopPropagation()}>
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <PlacementCard
          label="Sidebar"
          active={placement === 'sidebar'}
          onSelect={() => pickPlacement('sidebar')}
          preview={
            <div className="flex h-14 overflow-hidden rounded-md border border-ink-600 bg-ink-900">
              <div className={cn('w-5 transition-colors', placement === 'sidebar' ? 'bg-brand/40' : 'bg-ink-700')} />
              <div className="flex-1 p-1">
                <div className="h-1.5 w-8 rounded bg-ink-700" />
              </div>
            </div>
          }
        />
        <PlacementCard
          label="Top"
          active={placement === 'top'}
          onSelect={() => pickPlacement('top')}
          preview={
            <div className="flex h-14 flex-col overflow-hidden rounded-md border border-ink-600 bg-ink-900">
              <div className={cn('h-3 border-b border-ink-700 transition-colors', placement === 'top' ? 'bg-brand/40' : 'bg-ink-700')} />
              <div className="flex-1 p-1">
                <div className="h-1.5 w-8 rounded bg-ink-700" />
              </div>
            </div>
          }
        />
      </div>

      <div className="border-t border-ink-700 px-3 pt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">Sections</span>
          <button
            type="button"
            className="btn-ghost !p-1 text-fg-muted"
            title="Create section"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => {
              close()
              setCreateSectionOpen(true)
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <ul className="space-y-0.5">
          {sections.map((section) => {
            const selected = favorited && activeSectionId === section.id
            return (
              <li key={section.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors',
                    selected ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-850',
                  )}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (!favorited) {
                      toggleFavorite(target, section.id)
                    } else {
                      moveFavoriteToSection(target.key, section.id)
                    }
                    close()
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {section.emoji && <span className="text-sm">{section.emoji}</span>}
                    <span className="truncate">{section.name}</span>
                  </span>
                  {selected && <Star size={13} className="shrink-0 fill-amber-400 text-amber-400" />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="mt-2 border-t border-ink-700 px-3 pt-2">
        <button
          type="button"
          className="menu-item w-full text-left text-sm"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            onToggleFavorite()
            close()
          }}
        >
          {favorited ? 'Remove from Favorites' : 'Add to Favorites'}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <Dropdown
        align="left"
        width="w-72"
        trigger={
          <button
            type="button"
            title="Favorite"
            aria-label="Favorite"
            aria-pressed={favorited}
            className={cn(
              'rounded p-0.5 transition-colors',
              favorited ? 'text-amber-400' : 'text-fg-muted hover:text-amber-400',
              className,
            )}
          >
            <Star size={14} className={cn(favorited && 'fill-current')} />
          </button>
        }
      >
        {menu}
      </Dropdown>

      <CreateFavoriteSectionModal
        open={createSectionOpen}
        onClose={() => setCreateSectionOpen(false)}
        onCreate={(name, emoji) => {
          const section = addFavoriteSection(name, emoji)
          if (section && !isFavorite(target.key)) {
            toggleFavorite(target, section.id)
          } else if (section && isFavorite(target.key)) {
            moveFavoriteToSection(target.key, section.id)
          }
        }}
      />
    </>
  )
}

function PlacementCard({
  label,
  active,
  onSelect,
  preview,
}: {
  label: string
  active: boolean
  onSelect: () => void
  preview: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onSelect()
      }}
      className={cn(
        'relative rounded-xl border p-2 text-left transition-colors',
        active
          ? 'border-brand bg-brand-soft/50 ring-2 ring-brand/30'
          : 'border-ink-700 hover:border-ink-600 hover:bg-ink-850',
      )}
    >
      {active && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-white">
          <Check size={10} strokeWidth={3} />
        </span>
      )}
      {preview}
      <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-fg-secondary">
        {label === 'Sidebar' ? <LayoutPanelLeft size={12} /> : <PanelTop size={12} />}
        {label}
      </span>
    </button>
  )
}
