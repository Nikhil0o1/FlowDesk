import type { BreadcrumbItem } from '../../lib/breadcrumbs'
import { Breadcrumbs } from './Breadcrumbs'

const ROOT_CRUMB: BreadcrumbItem = { label: 'FlowDesk', href: '/' }

export function PublicBreadcrumbBar({ items }: { items: BreadcrumbItem[] }) {
  return (
    <div className="mb-6">
      <Breadcrumbs items={[ROOT_CRUMB, ...items]} showHomeIcon={false} />
    </div>
  )
}
