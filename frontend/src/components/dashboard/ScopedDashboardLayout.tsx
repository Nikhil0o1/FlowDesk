import type { ReactNode } from 'react'

import { cn } from '../../lib/utils'
import { AdminScopeSwitcher, type ScopeOption } from './AdminScopeSwitcher'
import { SectionGlass } from './DashboardWidgets'

export function ScopedDashboardLayout({
  icon,
  iconStyle,
  title,
  subtitle,
  scopeOptions,
  scopeId,
  onScopeChange,
  scopeMenuHeading,
  headerRight,
  kpis,
  children,
}: {
  icon: ReactNode
  iconStyle: { background: string; boxShadow: string }
  title: string
  subtitle: ReactNode
  scopeOptions?: ScopeOption[]
  scopeId?: string
  onScopeChange?: (id: string) => void
  scopeMenuHeading?: string
  headerRight?: ReactNode
  kpis: ReactNode
  children: ReactNode
}) {
  const showSwitcher = (scopeOptions?.length ?? 0) > 1 && scopeId && onScopeChange

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-5 py-3">
      <header className="mb-2 flex shrink-0 items-center gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-lg"
          style={iconStyle}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-base font-bold text-fg">{title}</h1>
            {showSwitcher && (
              <AdminScopeSwitcher
                options={scopeOptions!}
                value={scopeId!}
                onChange={onScopeChange!}
                menuHeading={scopeMenuHeading}
              />
            )}
          </div>
          <div className="truncate text-[11px] text-fg-muted">{subtitle}</div>
        </div>
        {headerRight}
      </header>

      <div className="mb-2 grid shrink-0 grid-cols-6 gap-2">{kpis}</div>

      <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-2 gap-2">{children}</div>
    </div>
  )
}

export function DashboardPanel({
  className,
  children,
  ...props
}: {
  icon: ReactNode
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <SectionGlass fill className={cn('min-h-0', className)} {...props}>
      {children}
    </SectionGlass>
  )
}

export function KpiSlot({ children }: { children: ReactNode }) {
  return <div className="min-h-[84px] min-w-0">{children}</div>
}
