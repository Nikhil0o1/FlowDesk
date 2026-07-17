import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { cn } from '../../../lib/utils'

export interface Crumb {
  label: string
  to?: string
}

/** Workspace › Folder › Document breadcrumb. The last crumb renders as plain text. */
export function DocsBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {items.map((crumb, i) => {
        const last = i === items.length - 1
        return (
          <Fragment key={`${crumb.label}-${i}`}>
            {i > 0 && <ChevronRight size={14} className="shrink-0 text-fg-muted" aria-hidden />}
            {crumb.to && !last ? (
              <Link to={crumb.to} className="max-w-[200px] truncate text-fg-secondary hover:text-fg">
                {crumb.label}
              </Link>
            ) : (
              <span className={cn('max-w-[240px] truncate', last ? 'font-medium text-fg' : 'text-fg-secondary')}>
                {crumb.label}
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
