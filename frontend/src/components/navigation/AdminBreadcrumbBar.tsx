import { useAdminBreadcrumbs } from '../../hooks/useAppBreadcrumbs'
import { ThemeToggle } from '../ui/ThemeToggle'
import { Breadcrumbs } from './Breadcrumbs'

export function AdminBreadcrumbBar() {
  const items = useAdminBreadcrumbs()

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-700/80 bg-ink-900/95 px-6 py-2.5 backdrop-blur-sm">
      <Breadcrumbs items={items} showHomeIcon={false} />
      <ThemeToggle />
    </div>
  )
}
