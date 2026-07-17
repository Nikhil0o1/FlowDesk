import { Star } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import { useFavorites } from '../../hooks/useFavorites'
import { getFavoriteSections } from '../../lib/favorites'
import { cn } from '../../lib/utils'

export function FavoritesSidebarSection() {
  const { placement, items } = useFavorites()

  if (placement !== 'sidebar') return null

  const sections = getFavoriteSections()

  return (
    <div className="mt-2 px-2">
      <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Favorites</p>
      {items.length === 0 ? (
        <p className="px-3 py-1 text-xs text-fg-muted">Star a view to pin it here.</p>
      ) : (
        sections.map((section) => {
          const sectionItems = items.filter((item) => item.sectionId === section.id)
          if (sectionItems.length === 0) return null
          return (
            <div key={section.id} className="mb-1">
              {sections.length > 1 && (
                <p className="flex items-center gap-1.5 px-3 py-0.5 text-[11px] text-fg-muted">
                  {section.emoji && <span>{section.emoji}</span>}
                  {section.name}
                </p>
              )}
              {sectionItems.map((item) => (
                <NavLink
                  key={item.key}
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      'mb-0.5 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      isActive ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
                    )
                  }
                >
                  <Star size={13} className="shrink-0 fill-amber-400/80 text-amber-400" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </div>
          )
        })
      )}
    </div>
  )
}

export function FavoritesTopBarStrip() {
  const { placement, items } = useFavorites()

  if (placement !== 'top') return null

  if (items.length === 0) {
    return (
      <div className="hidden items-center gap-1 border-l border-ink-700 pl-2 text-xs text-fg-muted md:flex">
        <Star size={12} className="text-amber-400/60" />
        <span>Favorites</span>
      </div>
    )
  }

  return (
    <div className="flex max-w-xs items-center gap-1 overflow-x-auto border-l border-ink-700 pl-2 lg:max-w-md">
      {items.map((item) => (
        <NavLink
          key={item.key}
          to={item.path}
          className={({ isActive }) =>
            cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
              isActive ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
            )
          }
        >
          <Star size={11} className="fill-amber-400/80 text-amber-400" />
          <span className="max-w-[8rem] truncate">{item.label}</span>
        </NavLink>
      ))}
    </div>
  )
}
