import {
  ArrowUp,
  CalendarDays,
  ChevronsRight,
  ClipboardList,
  Clock4,
  LayoutGrid,
  PenTool,
  ShieldCheck,
  UserRoundPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useUnreadNotifications } from '../lib/queries'
import { cn } from '../lib/utils'
import { useAuthStore } from '../stores/auth'
import { useUIStore, type SectionKey } from '../stores/ui'
import { sectionFromPath } from './SectionSidebar'

interface RailSection {
  key: SectionKey
  label: string
  to: string
  color: string
  icon?: LucideIcon
}

// Each section gets its own accent — the active icon glows in its color
const RAIL_SECTIONS: RailSection[] = [
  { key: 'home', label: 'Home', to: '/app/dashboard', color: '#8C5BFF' }, // glowing logo
  { key: 'planner', label: 'Planner', to: '/app/planner', color: '#4285F4', icon: CalendarDays },
  { key: 'teams', label: 'Teams', to: '/app/teams', color: '#E667A8', icon: UsersRound },
  { key: 'whiteboards', label: 'Whiteboa..', to: '/app/whiteboards', color: '#F2994A', icon: PenTool },
  { key: 'forms', label: 'Forms', to: '/app/forms', color: '#4CB782', icon: ClipboardList },
  { key: 'timesheet', label: 'Timesheet', to: '/app/timesheet', color: '#26B5CE', icon: Clock4 },
  { key: 'apps', label: 'More', to: '/app/apps', color: '#B07BE0', icon: LayoutGrid },
]

const glow = (color: string) => ({
  color,
  filter: `drop-shadow(0 0 9px ${color}D9)`,
})

export function IconRail() {
  const user = useAuthStore((s) => s.user)
  const unread = useUnreadNotifications()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    sidebarCollapsed,
    toggleSidebar,
    expandSidebar,
    setFlyout,
    scheduleFlyoutHide,
    setInviteOpen,
    notificationsMuted,
  } = useUIStore()

  const activeSection = sectionFromPath(location.pathname)

  return (
    <aside
      className="flex h-full w-[72px] shrink-0 flex-col items-center gap-0.5 border-r border-ink-700 bg-ink-850 px-1.5 pb-3 pt-2"
      onMouseLeave={scheduleFlyoutHide}
    >
      {sidebarCollapsed && (
        <button
          onClick={toggleSidebar}
          title="Expand sidebar"
          className="mb-0.5 flex w-full items-center justify-center rounded-xl py-1.5 text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg"
        >
          <ChevronsRight size={17} strokeWidth={1.8} />
        </button>
      )}

      {RAIL_SECTIONS.map((section) => {
        const isActive = activeSection === section.key
        const Icon = section.icon
        return (
          <button
            key={section.key}
            onClick={() => {
              setFlyout(null)
              expandSidebar()
              navigate(section.to)
            }}
            onMouseEnter={() => {
              setFlyout(section.key === activeSection && !sidebarCollapsed ? null : section.key)
            }}
            className={cn(
              'relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-medium transition-colors',
              isActive ? 'text-fg' : 'text-fg-muted hover:bg-ink-800 hover:text-fg-secondary',
            )}
          >
            <span className="relative">
              {section.key === 'home' ? (
                <img
                  src="/logo.svg"
                  alt="Home"
                  className="h-7 w-7 transition-[filter]"
                  style={isActive ? { filter: `drop-shadow(0 0 9px ${section.color}D9)` } : undefined}
                />
              ) : (
                Icon && (
                  <span className="block transition-[filter]" style={isActive ? glow(section.color) : undefined}>
                    <Icon size={20} strokeWidth={1.8} />
                  </span>
                )
              )}
              {section.key === 'home' && !notificationsMuted && (unread.data?.count ?? 0) > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[9px] font-bold text-white">
                  {unread.data!.count > 99 ? '99+' : unread.data!.count}
                </span>
              )}
            </span>
            <span className={cn('max-w-[62px] truncate', isActive && 'font-semibold text-fg')}>
              {section.label}
            </span>
          </button>
        )
      })}

      <div className="flex-1" />

      {user?.is_platform_superadmin && (
        <button
          onClick={() => navigate('/admin/platform')}
          onMouseEnter={scheduleFlyoutHide}
          className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-medium text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg-secondary"
        >
          <ShieldCheck size={20} strokeWidth={1.8} />
          Admin
        </button>
      )}
      <button
        onClick={() => setInviteOpen(true)}
        onMouseEnter={scheduleFlyoutHide}
        className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-medium text-fg-muted transition-colors hover:bg-ink-800 hover:text-fg-secondary"
      >
        <UserRoundPlus size={20} strokeWidth={1.8} />
        Invite
      </button>
      <div
        className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[10px] font-medium text-brand"
        onMouseEnter={scheduleFlyoutHide}
      >
        <ArrowUp size={20} strokeWidth={1.8} style={glow('#8C5BFF')} />
        Upgrade
      </div>
    </aside>
  )
}
