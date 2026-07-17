import { useAppBreadcrumbs } from '../../hooks/useAppBreadcrumbs'
import { useCurrentContext } from '../../lib/queries'
import { isOrgLeader } from '../../lib/scopedRoles'
import { Breadcrumbs } from './Breadcrumbs'

export function AppBreadcrumbBar() {
  const items = useAppBreadcrumbs()
  const { org } = useCurrentContext()
  const showOrgInBar = org?.name && !isOrgLeader(org)

  if (items.length === 0) return null

  return (
    <div className="shrink-0 border-b border-ink-700/80 bg-ink-900/95 px-5 py-2 backdrop-blur-sm">
      <div className="flex min-w-0 items-center gap-3">
        {showOrgInBar && (
          <span
            className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-muted sm:inline-block"
            title={org.name}
          >
            {org.name}
          </span>
        )}
        {showOrgInBar && (
          <span className="hidden h-3 w-px shrink-0 bg-ink-700 sm:block" aria-hidden />
        )}
        <Breadcrumbs items={items} className="min-w-0 flex-1" />
      </div>
    </div>
  )
}
