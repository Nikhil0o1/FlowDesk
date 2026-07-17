import type { ReactNode } from 'react'

export type DashboardScopeStatItem = {
  icon: ReactNode
  count: number
  noun: string
  onClick?: () => void
  title?: string
}

export function DashboardScopeStats({ items }: { items: DashboardScopeStatItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="hidden shrink-0 items-center gap-2.5 text-[11px] text-fg-muted lg:flex">
      {items.map((item) => {
        const label = `${item.count} ${item.noun}${item.count === 1 ? '' : 's'}`
        const content = (
          <>
            {item.icon}
            {label}
          </>
        )
        if (item.onClick) {
          return (
            <button
              key={item.noun}
              type="button"
              onClick={item.onClick}
              className="flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-ink-700/40 hover:text-fg"
              title={item.title}
            >
              {content}
            </button>
          )
        }
        return (
          <span key={item.noun} className="flex items-center gap-1">
            {content}
          </span>
        )
      })}
    </div>
  )
}
