import type { NavigationItem } from '../../constants/navigationItems'
import { SidebarSettingRow } from './SidebarSettingRow'

interface Props {
  item: NavigationItem
  checked: boolean
  /** When true the checkbox is rendered checked-and-disabled (e.g. Home / last item). */
  locked: boolean
  onChange: (checked: boolean) => void
}

/** A single row in the Navigation customization list. */
export function NavigationSettingItem({ item, checked, locked, onChange }: Props) {
  const Icon = item.icon
  const icon =
    item.id === 'home' ? (
      <img src="/brightcone icon.png" alt="" className="h-4 w-4" />
    ) : (
      Icon && (
        <span style={{ color: item.color }}>
          <Icon size={16} strokeWidth={1.9} />
        </span>
      )
    )

  return (
    <SidebarSettingRow
      icon={icon}
      label={item.label}
      checked={checked}
      disabled={locked}
      onChange={onChange}
    />
  )
}
