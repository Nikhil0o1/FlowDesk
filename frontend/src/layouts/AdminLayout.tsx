import { Building2, LayoutDashboard, LogOut, ShieldCheck } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'

import { logout } from '../lib/api'
import { cn } from '../lib/utils'
import { displayName, useAuthStore } from '../stores/auth'
import { Avatar } from '../components/ui/Avatar'
import { AdminBreadcrumbBar } from '../components/navigation/AdminBreadcrumbBar'

export default function AdminLayout() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()

  return (
    <div className="flex h-screen overflow-hidden bg-ink-950">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-850">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <ShieldCheck size={22} className="text-brand" />
          <div>
            <p className="text-sm font-bold text-fg">FlowDesk Admin</p>
            <p className="text-[11px] text-fg-muted">Platform control panel</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3">
          <NavLink
            to="/admin/platform"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-brand-soft font-medium text-fg' : 'text-fg-secondary hover:bg-ink-750',
              )
            }
          >
            <LayoutDashboard size={16} /> Platform overview
          </NavLink>
          <NavLink
            to="/admin/organizations"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-brand-soft font-medium text-fg' : 'text-fg-secondary hover:bg-ink-750',
              )
            }
          >
            <Building2 size={16} /> Organizations
          </NavLink>
        </nav>
        <div className="border-t border-ink-700 p-3">
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar name={displayName(user)} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-fg">{displayName(user)}</p>
              <p className="truncate text-[11px] text-fg-muted">Superadmin</p>
            </div>
            <button
              onClick={async () => {
                await logout()
                navigate('/login')
              }}
              className="rounded-lg p-1.5 text-fg-muted hover:bg-ink-750 hover:text-fg"
              title="Log out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AdminBreadcrumbBar />
        <main className="min-h-0 flex-1 overflow-y-auto bg-ink-900">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
