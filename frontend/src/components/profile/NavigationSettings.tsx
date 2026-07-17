import { useSidebarSettings } from '../../hooks/useSidebarSettings'
import { canAccessGoalsSection, canAccessGoals } from '../../lib/createAccess'
import { useCurrentContext, useUserRoles, useGoalsAccess } from '../../lib/queries'
import { cn } from '../../lib/utils'
import type { NavAppearance } from '../../types/sidebarSettings'
import { NavigationSettingItem } from './NavigationSettingItem'

const APPEARANCE_OPTIONS: { key: NavAppearance; label: string }[] = [
  { key: 'icons', label: 'Icons only' },
  { key: 'labels', label: 'Icons & Labels' },
]

/** Tiny mock of the rail used inside the appearance option cards. */
function AppearancePreview({ withLabels }: { withLabels: boolean }) {
  return (
    <div className="flex h-14 w-full items-stretch gap-1.5 rounded-md bg-ink-900 p-1.5">
      <div className="flex w-6 flex-col items-center gap-1 rounded bg-ink-800 py-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col items-center gap-0.5">
            <div className="h-1.5 w-1.5 rounded-[2px] bg-fg-muted" />
            {withLabels && <div className="h-0.5 w-3 rounded-full bg-fg-muted/60" />}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1">
        <div className="h-1 w-2/3 rounded-full bg-ink-700" />
        <div className="h-1 w-full rounded-full bg-ink-700" />
        <div className="h-1 w-1/2 rounded-full bg-ink-700" />
      </div>
    </div>
  )
}

/**
 * The "Navigation" tab content: one toggle per rail item plus an Appearance
 * selector (icons only vs icons & labels). Everything applies instantly and
 * persists via the sidebar-nav store.
 */
export function NavigationSettings() {
  const { items, isVisible, isLocked, setItemVisible, appearance, setAppearance } =
    useSidebarSettings()
  const { org, workspace } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const goalsAccessQuery = useGoalsAccess(workspace?.id)
  const goalsAccess = canAccessGoals(
    canAccessGoalsSection(org, workspace, userRoles, workspace?.id),
    goalsAccessQuery.data,
  )
  const navItems = items.filter((item) => item.id !== 'goals' || goalsAccess)

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Navigation</h3>
        <p className="mb-2 text-xs text-fg-muted">
          Choose which items appear in your sidebar. At least one must stay visible.
        </p>
        <div className="space-y-0.5">
          {navItems.map((item) => (
            <NavigationSettingItem
              key={item.id}
              item={item}
              checked={isVisible(item.id)}
              locked={isLocked(item.id)}
              onChange={(checked) => setItemVisible(item.id, checked)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Appearance</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {APPEARANCE_OPTIONS.map((opt) => {
            const active = appearance === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                aria-pressed={active}
                onClick={() => setAppearance(opt.key)}
                className={cn(
                  'rounded-xl border p-1.5 text-left transition-colors',
                  active ? 'border-brand ring-1 ring-brand' : 'border-ink-700 hover:border-ink-600',
                )}
              >
                <AppearancePreview withLabels={opt.key === 'labels'} />
                <div className="mt-1.5 text-center text-xs">
                  <span className={cn('font-medium', active ? 'text-fg' : 'text-fg-secondary')}>
                    {opt.label}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
