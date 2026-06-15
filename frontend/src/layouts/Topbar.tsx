import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock4,
  Inbox,
  LogOut,
  Search,
  Settings,
  SmilePlus,
  Square,
  Timer,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage, logout } from '../lib/api'
import { useCurrentContext, useRunningTimer, useUnreadNotifications } from '../lib/queries'
import type { TimeEntry } from '../lib/types'
import { avatarColor, cn, formatTimer } from '../lib/utils'
import { useRealtime } from '../lib/ws'
import { displayName, useAuthStore } from '../stores/auth'
import { toast } from '../stores/toast'
import { useUIStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'
import { Avatar } from '../components/ui/Avatar'
import { Dropdown } from '../components/ui/Dropdown'
import { NotificationsDropdown } from '../components/notifications/NotificationsDropdown'
import { ProfileDrawer } from '../components/profile/ProfileDrawer'
import { SearchCommand } from '../components/search/SearchCommand'

function RunningTimer() {
  const timer = useRunningTimer()
  const queryClient = useQueryClient()
  const [elapsed, setElapsed] = useState(0)

  const entry = timer.data as TimeEntry | null

  useEffect(() => {
    if (!entry) return
    const update = () =>
      setElapsed(Math.floor((Date.now() - new Date(entry.started_at).getTime()) / 1000))
    update()
    const id = window.setInterval(update, 1000)
    return () => window.clearInterval(id)
  }, [entry?.id])

  useRealtime(['timer.started', 'timer.stopped'], () => {
    void queryClient.invalidateQueries({ queryKey: ['timer'] })
  })

  if (!entry) return null

  const stop = async () => {
    try {
      await api.post('/timer/stop')
      void queryClient.invalidateQueries({ queryKey: ['timer'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 py-1 pl-3 pr-1.5">
      <Timer size={13} className="text-emerald-400" />
      <span className="font-mono text-xs font-semibold text-emerald-300">{formatTimer(elapsed)}</span>
      <span className="hidden max-w-[140px] truncate text-xs text-fg-secondary md:block">
        {entry.task_ref} {entry.task_title}
      </span>
      <button
        onClick={stop}
        title="Stop timer"
        className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-400"
      >
        <Square size={9} fill="currentColor" />
      </button>
    </div>
  )
}

export function Topbar() {
  const { org, workspace, workspaces } = useCurrentContext()
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const { searchOpen, setSearchOpen, notificationsMuted, toggleNotificationsMuted } = useUIStore()
  const [profileOpen, setProfileOpen] = useState(false)
  const unread = useUnreadNotifications()
  const queryClient = useQueryClient()

  useRealtime('notification.created', (event) => {
    void queryClient.invalidateQueries({ queryKey: ['notifications-unread'] })
    void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    const notificationType = event.payload.type
    const roleOrMembershipChanged =
      notificationType === 'workspace_role_changed' ||
      notificationType === 'workspace_member_removed' ||
      notificationType === 'team_member_added' ||
      notificationType === 'team_role_changed' ||
      notificationType === 'team_member_removed'
    if (roleOrMembershipChanged) {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] })
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
      void queryClient.invalidateQueries({ queryKey: ['workspace-members'] })
      void queryClient.invalidateQueries({ queryKey: ['teams'] })
      void queryClient.invalidateQueries({ queryKey: ['spaces'] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['workspace-task-stats'] })
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen])

  const name = displayName(user)
  const avatarTint = user?.profile?.avatar_color
  const badgeCount = notificationsMuted ? 0 : (unread.data?.count ?? 0)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-ink-700 bg-ink-850 px-3">
      {/* Workspace switcher pill */}
      <Dropdown
        width="w-72"
        trigger={
          <button className="flex items-center gap-2 rounded-lg bg-ink-800 px-2 py-1.5 transition-colors hover:bg-ink-750">
            <span
              className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
              style={{ backgroundColor: workspace?.color ?? avatarColor(workspace?.name ?? 'W') }}
            >
              {(workspace?.name ?? 'W')[0].toUpperCase()}
            </span>
            <span className="max-w-[220px] truncate text-sm font-semibold text-fg">
              {workspace ? `${workspace.name}` : 'Workspace'}
            </span>
            <ChevronDown size={13} className="text-fg-muted" />
          </button>
        }
      >
        {(close) => (
          <>
            <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
              {org?.name ?? 'Organization'} — Workspaces
            </p>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                className={cn('menu-item', ws.id === workspace?.id && 'bg-ink-750 text-fg')}
                onClick={() => {
                  setWorkspace(ws.id)
                  close()
                }}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white"
                  style={{ backgroundColor: ws.color }}
                >
                  {ws.name[0].toUpperCase()}
                </span>
                <span className="flex-1 truncate">{ws.name}</span>
                {ws.my_role && <span className="text-[10px] uppercase text-fg-muted">{ws.my_role}</span>}
              </button>
            ))}
            <div className="my-1 h-px bg-ink-700" />
            <button
              className="menu-item"
              onClick={() => {
                navigate('/app/workspaces')
                close()
              }}
            >
              <Settings size={15} /> Manage workspaces
            </button>
          </>
        )}
      </Dropdown>

      {/* Calendar → Planner */}
      <button
        className="btn-ghost !px-2"
        title="Planner"
        onClick={() => navigate('/app/planner')}
      >
        <Calendar size={16} strokeWidth={1.8} />
      </button>

      {/* Center search pill */}
      <div className="flex flex-1 justify-center">
        <button
          onClick={() => setSearchOpen(true)}
          className="flex h-9 w-full max-w-xl items-center gap-2.5 rounded-full bg-ink-800 px-4 text-sm text-fg-muted transition-colors hover:bg-ink-750"
        >
          <Search size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded-md border border-ink-600 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary">
            Ctrl K
          </kbd>
        </button>
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-0.5">
        <RunningTimer />
        <button className="btn-ghost !px-2" title="My Tasks" onClick={() => navigate('/app/list')}>
          <CheckCircle2 size={17} strokeWidth={1.8} />
        </button>
        <button className="btn-ghost !px-2" title="Timesheet" onClick={() => navigate('/app/timesheet')}>
          <Clock4 size={17} strokeWidth={1.8} />
        </button>
        <Dropdown
          align="right"
          width="w-96"
          trigger={
            <button className="btn-ghost relative !px-2" title="Inbox">
              <Inbox size={17} strokeWidth={1.8} />
              {badgeCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-pink-500 px-1 text-[9px] font-bold text-white">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </button>
          }
        >
          {(close) => <NotificationsDropdown onClose={close} />}
        </Dropdown>

        {/* Profile menu */}
        <Dropdown
          align="right"
          width="w-72"
          className="ml-1"
          trigger={
            <button className="flex items-center gap-0.5 rounded-full py-0.5 pl-0.5 pr-1 transition-colors hover:bg-ink-750">
              <Avatar
                name={name}
                src={user?.profile?.avatar_url}
                color={avatarTint}
                size={30}
                userId={user?.id}
                showPresence
              />
              <ChevronDown size={12} className="text-fg-muted" />
            </button>
          }
        >
          {(close) => (
            <>
              <div className="flex items-center gap-3 px-3 py-3">
                <Avatar name={name} src={user?.profile?.avatar_url} color={avatarTint} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{name}</p>
                  <p className="flex items-center gap-1.5 truncate text-xs text-fg-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {user?.profile?.status_text || 'Online'}
                  </p>
                </div>
                <button
                  className="rounded-lg bg-ink-750 px-2.5 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-ink-700"
                  onClick={() => {
                    close()
                    setProfileOpen(true)
                  }}
                >
                  Profile
                </button>
              </div>
              <div className="my-1 h-px bg-ink-700" />
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  setProfileOpen(true)
                }}
              >
                <SmilePlus size={15} /> Set status
              </button>
              <button className="menu-item" onClick={toggleNotificationsMuted}>
                <BellOff size={15} />
                <span className="flex-1">Mute notifications</span>
                {notificationsMuted && <Check size={14} className="text-brand" />}
              </button>
              <div className="my-1 h-px bg-ink-700" />
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  navigate('/app/settings')
                }}
              >
                <Settings size={15} /> Settings
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  navigate('/app/notifications')
                }}
              >
                <Bell size={15} /> Notifications
              </button>
              <div className="my-1 h-px bg-ink-700" />
              <button
                className="menu-item text-red-400 hover:text-red-300"
                onClick={async () => {
                  close()
                  await logout()
                  navigate('/login')
                }}
              >
                <LogOut size={15} /> Log out
              </button>
            </>
          )}
        </Dropdown>
      </div>

      <SearchCommand open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  )
}
