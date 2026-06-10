import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { InviteModal } from '../components/invites/InviteModal'
import { useUIStore } from '../stores/ui'
import { IconRail } from './IconRail'
import { SectionSidebar, sectionFromPath } from './SectionSidebar'
import { Topbar } from './Topbar'

export default function AppLayout() {
  const {
    sidebarCollapsed,
    inviteOpen,
    setInviteOpen,
    flyoutSection,
    setFlyout,
    cancelFlyoutHide,
    scheduleFlyoutHide,
    expandSidebar,
  } = useUIStore()
  const location = useLocation()
  const activeSection = sectionFromPath(location.pathname)

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
      <div className="flex min-h-0 flex-1">
        <IconRail />
        <div
          className={`min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${
            showSidebar ? 'w-64' : 'w-0'
          }`}
          onMouseEnter={flyoutSection ? cancelFlyoutHide : undefined}
          onMouseLeave={flyoutSection ? scheduleFlyoutHide : undefined}
          onClickCapture={
            flyoutSection
              ? () => {
                  // Selecting anything inside a preview docks the sidebar
                  expandSidebar()
                  setFlyout(null)
                }
              : undefined
          }
        >
          <SectionSidebar section={renderedSection} />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto bg-ink-900">
          <Outlet />
        </main>
      </div>
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
