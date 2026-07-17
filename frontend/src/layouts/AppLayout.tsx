import { useEffect, useState } from 'react'
import { cn } from '../lib/utils'
import { Outlet, useLocation } from 'react-router-dom'

import { InviteModal } from '../components/invites/InviteModal'
import { PeopleInviteOverlays } from '../components/people/PeopleInviteOverlays'
import {
  SecondarySidebarResizeHandle,
} from '../components/layout/SecondarySidebarResizeHandle'
import { useGithubOAuthCallback } from '../lib/githubOAuth'
import { useDeletedTaskCleanup } from '../lib/taskDeletion'
import { usePresenceHeartbeat } from '../hooks/usePresenceHeartbeat'
import { useCurrentContext } from '../lib/queries'
import { isOrgLeader, isOrgWorkspaceDrillDownPath } from '../lib/scopedRoles'
import { isFullHeightDashboardPath } from '../lib/projectMemberDashboardRoutes'
import { useUIStore } from '../stores/ui'
import { IconRail } from './IconRail'
import { SectionSidebar, sectionFromPath } from './SectionSidebar'
import { Topbar } from './Topbar'
import { AppBreadcrumbBar } from '../components/navigation/AppBreadcrumbBar'

export default function AppLayout() {
  const {
    sidebarCollapsed,
    toggleSidebar,
    inviteOpen,
    setInviteOpen,
    flyoutSection,
    setFlyout,
    cancelFlyoutHide,
    scheduleFlyoutHide,
    expandSidebar,
    secondarySidebarWidth,
    setSecondarySidebarWidth,
    resetSecondarySidebarWidth,
  } = useUIStore()
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const location = useLocation()
  const { org } = useCurrentContext()
  const activeSection = sectionFromPath(location.pathname)
  const panelNoScroll =
    isFullHeightDashboardPath(location.pathname) ||
    (isOrgLeader(org) && isOrgWorkspaceDrillDownPath(location.pathname))

  useGithubOAuthCallback()
  useDeletedTaskCleanup()
  usePresenceHeartbeat()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar])

  // Any navigation settles the preview back to the active section
  useEffect(() => {
    setFlyout(null)
  }, [location.pathname, location.search, setFlyout])

  // Hover preview renders IN the sidebar slot — content is pushed, never covered
  const previewSection = flyoutSection && flyoutSection !== activeSection ? flyoutSection : null
  const showSidebar = !sidebarCollapsed || flyoutSection !== null
  const renderedSection = previewSection ?? activeSection

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950">
      <Topbar />
      <div className="flex min-h-0 flex-1 bg-ink-950">
        <IconRail />
        <div
          className={cn(
            'relative min-h-0 shrink-0 overflow-hidden',
            !isResizingSidebar && 'transition-[width] duration-200 ease-out',
          )}
          style={{ width: showSidebar ? secondarySidebarWidth : 0 }}
          onMouseEnter={flyoutSection ? cancelFlyoutHide : undefined}
          onMouseLeave={flyoutSection ? scheduleFlyoutHide : undefined}
          onClickCapture={
            flyoutSection
              ? () => {
                  expandSidebar()
                  setFlyout(null)
                }
              : undefined
          }
        >
          <div className="h-full w-full min-w-0">
            <SectionSidebar section={renderedSection} />
          </div>
          {showSidebar && (
            <SecondarySidebarResizeHandle
              width={secondarySidebarWidth}
              onWidthChange={setSecondarySidebarWidth}
              onReset={resetSecondarySidebarWidth}
              onResizingChange={setIsResizingSidebar}
            />
          )}
        </div>
        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col bg-ink-900',
          )}
        >
          <AppBreadcrumbBar />
          <div
            className={cn(
              'relative min-h-0 flex-1',
              panelNoScroll ? 'overflow-hidden' : 'overflow-y-auto',
            )}
          >
            <Outlet />
          </div>
        </main>
      </div>
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <PeopleInviteOverlays />
    </div>
  )
}
