import {
  ChevronsRight,
  ShieldCheck,
  UserRoundPlus,
} from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useCurrentContext, useProjects, useSpaces, useUnreadNotifications, useUserRoles, useGoalsAccess } from '../lib/queries'
import { canInviteAnyone } from '../components/invites/inviteScopes'
import { canAccessGoalsSection, canAccessGoals } from '../lib/createAccess'
import { useOpenInvite } from '../hooks/useOpenInvite'
import { useSidebarSettings } from '../hooks/useSidebarSettings'
import { cn } from '../lib/utils'
import { useAuthStore } from '../stores/auth'
import { useUIStore } from '../stores/ui'
import { sectionFromPath } from './SectionSidebar'

/** ClickUp-style floating primary rail — inset from edges with rounded container. */
const RAIL_GUTTER = 'py-2 pl-2 pr-1.5'
const RAIL_WIDTH = 'w-[52px]'
const RAIL_RADIUS = 'rounded-[14px]'

export function IconRail() {
  const user = useAuthStore((s) => s.user)
  const { org, workspace, workspaces } = useCurrentContext()
  const { data: userRoles } = useUserRoles()
  const projects = useProjects(workspace?.id)
  const spaces = useSpaces(workspace?.id)
  const canInvite = canInviteAnyone(org, workspaces, spaces.data ?? [], projects.data ?? [])
  const unread = useUnreadNotifications()
  const navigate = useNavigate()
  const location = useLocation()
  const openInvite = useOpenInvite()
  const { visibleItems, appearance } = useSidebarSettings()
  const showLabels = appearance === 'labels'
  const {
    sidebarCollapsed,
    toggleSidebar,
    expandSidebar,
    setFlyout,
    scheduleFlyoutHide,
    notificationsMuted,
  } = useUIStore()

  const activeSection = sectionFromPath(location.pathname)
  const goalsAccessQuery = useGoalsAccess(workspace?.id)
  const goalsAccess = canAccessGoals(
    canAccessGoalsSection(org, workspace, userRoles, workspace?.id),
    goalsAccessQuery.data,
  )
  const railItems = visibleItems.filter((item) => item.id !== 'goals' || goalsAccess)

  return (
    <div
      className={cn('flex h-full shrink-0 flex-col', RAIL_GUTTER)}
      style={{ width: 'calc(52px + 0.875rem)' }}
      onMouseLeave={scheduleFlyoutHide}
    >
      <aside
        className={cn(
          'flex min-h-0 flex-1 flex-col items-center gap-0.5 self-center overflow-x-hidden overflow-y-auto px-1 pb-2 pt-2',
          RAIL_WIDTH,
          RAIL_RADIUS,
        )}
        style={{ background: 'var(--rail-bg)', boxShadow: 'var(--rail-shadow)' }}
      >
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Expand sidebar"
            className="mb-0.5 flex w-full items-center justify-center rounded-[10px] py-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ChevronsRight size={17} strokeWidth={1.8} />
          </button>
        )}

        {railItems.map((section) => {
          const isActive = activeSection === section.id
          const Icon = section.icon
          return (
            <button
              key={section.id}
              onClick={() => {
                setFlyout(null)
                expandSidebar()
                navigate(section.to)
              }}
              onMouseEnter={() => {
                setFlyout(section.id === activeSection && !sidebarCollapsed ? null : section.id)
              }}
              className={cn(
                'relative mx-0.5 flex w-[calc(100%-4px)] flex-col items-center gap-1 rounded-[10px] px-0.5 py-1.5 text-[9px] font-medium leading-tight transition-colors',
                isActive
                  ? 'bg-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                  : 'text-white/65 hover:bg-white/10 hover:text-white',
              )}
            >
              <span className="relative">
                {section.id === 'home' ? (
                  <img
                    src="/brightcone icon.png"
                    alt="Home"
                    className="h-6 w-6 transition-[filter]"
                    style={isActive ? { filter: 'drop-shadow(0 0 7px rgba(255,255,255,0.55))' } : undefined}
                  />
                ) : (
                  Icon && (
                    <span className="block">
                      <Icon size={18} strokeWidth={1.9} />
                    </span>
                  )
                )}
                {section.id === 'home' && !notificationsMuted && (unread.data?.count ?? 0) > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-pink-500 px-1 text-[8px] font-bold text-white ring-2 ring-black/10">
                    {unread.data!.count > 99 ? '99+' : unread.data!.count}
                  </span>
                )}
              </span>
              {showLabels && (
                <span className={cn('max-w-[44px] truncate', isActive && 'font-semibold')}>
                  {section.railLabel ?? section.label}
                </span>
              )}
            </button>
          )
        })}

        <div className="flex-1" />

        {user?.is_platform_superadmin && (
          <button
            onClick={() => navigate('/admin/platform')}
            onMouseEnter={scheduleFlyoutHide}
            className="mx-0.5 flex w-[calc(100%-4px)] flex-col items-center gap-1 rounded-[10px] px-0.5 py-1.5 text-[9px] font-medium leading-tight text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ShieldCheck size={18} strokeWidth={1.9} />
            {showLabels && 'Admin'}
          </button>
        )}
        {canInvite && (
          <button
            onClick={() => openInvite()}
            onMouseEnter={scheduleFlyoutHide}
            className="mx-0.5 flex w-[calc(100%-4px)] flex-col items-center gap-1 rounded-[10px] px-0.5 py-1.5 text-[9px] font-medium leading-tight text-white/65 transition-colors hover:bg-white/10 hover:text-white"
          >
            <UserRoundPlus size={18} strokeWidth={1.9} />
            {showLabels && 'Invite'}
          </button>
        )}
      </aside>
    </div>
  )
}
