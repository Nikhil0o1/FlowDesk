import { useHomeSidebarSettings } from '../../hooks/useHomeSidebarSettings'
import { SidebarSettingRow } from './SidebarSettingRow'

/**
 * The "Home" tab content: one toggle per Home shortcut. Changes apply instantly
 * (no save button) and persist via the home-sidebar store.
 */
export function HomeCustomization() {
  const { items, isVisible, isLocked, setItemVisible } = useHomeSidebarSettings()

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Home</h3>
      <p className="mb-2 text-xs text-fg-muted">
        Choose which shortcuts appear under Home. At least one must stay visible.
      </p>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <SidebarSettingRow
              key={item.id}
              icon={<Icon size={16} strokeWidth={1.9} className="text-fg-secondary" />}
              label={item.label}
              checked={isVisible(item.id)}
              disabled={isLocked(item.id)}
              onChange={(checked) => setItemVisible(item.id, checked)}
            />
          )
        })}
      </div>
    </section>
  )
}
