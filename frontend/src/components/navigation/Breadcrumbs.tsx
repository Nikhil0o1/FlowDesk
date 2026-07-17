import { ChevronRight, Home } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { BreadcrumbItem } from '../../lib/breadcrumbs'
import { cn } from '../../lib/utils'

export function Breadcrumbs({
  items,
  className,
  showHomeIcon = true,
}: {
  items: BreadcrumbItem[]
  className?: string
  showHomeIcon?: boolean
}) {
  if (items.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 flex-wrap items-center gap-1">
        {items.map((item, index) => {
          const isFirst = index === 0
          const isLast = index === items.length - 1
          const showLink = !!item.href && !item.current

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 max-w-full items-center gap-1">
              {index > 0 && (
                <ChevronRight
                  size={12}
                  className="shrink-0 text-fg-muted/70"
                  aria-hidden
                />
              )}
              {showLink ? (
                <Link
                  to={item.href!}
                  className={cn(
                    'inline-flex min-w-0 max-w-[200px] items-center gap-1 truncate rounded px-1 py-0.5 text-xs text-fg-secondary transition-colors hover:bg-ink-800 hover:text-fg',
                    isFirst && 'max-w-[160px]',
                  )}
                  title={item.label}
                >
                  {isFirst && showHomeIcon && <Home size={11} className="shrink-0 opacity-70" />}
                  <span className="truncate">{item.label}</span>
                </Link>
              ) : (
                <span
                  className={cn(
                    'inline-flex min-w-0 max-w-[280px] items-center gap-1 truncate px-1 py-0.5 text-xs',
                    isLast ? 'font-medium text-fg' : 'text-fg-secondary',
                  )}
                  aria-current={item.current ? 'page' : undefined}
                  title={item.label}
                >
                  {isFirst && showHomeIcon && <Home size={11} className="shrink-0 opacity-70" />}
                  <span className="truncate">{item.label}</span>
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
