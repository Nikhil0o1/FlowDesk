import { useQuery } from '@tanstack/react-query'
import {
  Boxes,
  Clock4,
  FolderKanban,
  Hash,
  Layers,
  Mail,
  MessageSquare,
  Shield,
  Trash2,
  Upload,
  User,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { usePresencePreferenceStore } from '../../lib/presence'
import { useUserRoles } from '../../lib/queries'
import { sprintPageUrl } from '../../lib/sprintRoutes'
import {
  adminProjectRoles,
  adminSpaceRoles,
  adminWorkspaceRoles,
  profileRoleDisplay,
} from '../../lib/scopedRoles'
import type { Activity, Page, Task, User as AppUser, UserRoleSummary } from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'
import { displayName, useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { ACTION_LABELS } from '../projects/ProjectActivity'
import { Avatar } from '../ui/Avatar'
import { Dropdown } from '../ui/Dropdown'
import { PriorityFlag, StatusPill } from '../ui/badges'
import { Spinner } from '../ui/Spinner'
import { UserStatusEditor, UserStatusLine } from './UserStatusEditor'

const AVATAR_COLORS = [
  '#2B88EE', '#4285F4', '#26B5CE', '#0F9D58', '#4CB782', '#FBBC04', '#F2994A',
  '#E5484D', '#E667A8', '#B07BE0', '#A1887F', '#87909E', '#ECECEE',
]

export function ProfileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, setUser } = useAuthStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'activity' | 'tasks'>('activity')
  const [fullName, setFullName] = useState('')
  const [about, setAbout] = useState('')
  const [editingName, setEditingName] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setFullName(user?.profile?.full_name ?? '')
      setAbout(user?.profile?.about ?? '')
      setEditingName(false)
    }
  }, [open, user?.profile?.full_name, user?.profile?.about])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const myTasks = useQuery({
    queryKey: ['profile-tasks'],
    queryFn: () => api.get<Page<Task>>('/me/tasks?relation=assigned&page_size=8'),
    enabled: open,
  })

  const activity = useQuery({
    queryKey: ['profile-activity'],
    queryFn: () => api.get<Activity[]>('/users/me/activity?limit=30'),
    enabled: open,
  })

  if (!open || !user) return null

  const name = displayName(user)
  const tint = user.profile?.avatar_color
  const hasUploadedAvatar = !!user.profile?.avatar_url

  const patchProfile = async (body: Record<string, unknown>) => {
    try {
      const updated = await api.patch<AppUser>('/users/me/profile', body)
      setUser(updated)
      if ('status_text' in body || 'clear_status' in body) {
        await usePresencePreferenceStore.getState().applyFromProfileStatus(updated.profile?.status_text)
      }
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const saveName = () => {
    const next = fullName.trim()
    if (!next) {
      setFullName(user.profile?.full_name ?? '')
      setEditingName(false)
      return
    }
    if (next !== (user.profile?.full_name ?? '')) {
      void patchProfile({ full_name: next })
    }
    setEditingName(false)
  }

  const uploadAvatar = async (file: File) => {
    try {
      const form = new FormData()
      form.append('file', file)
      const updated = await api.upload<AppUser>('/users/me/avatar', form)
      setUser(updated)
      toast.success('Avatar updated')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const deleteAvatar = async () => {
    try {
      const updated = await api.delete<AppUser>('/users/me/avatar')
      setUser(updated)
      toast.success('Avatar removed')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const localTime = (() => {
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: user.profile?.timezone || 'UTC',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date())
    } catch {
      return new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    }
  })()

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} />
      <aside className="fixed bottom-0 right-0 top-0 z-[70] w-[460px] max-w-full overflow-y-auto border-l border-ink-700 bg-ink-900 shadow-popover">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <X size={17} />
        </button>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <Dropdown
              width="w-56"
              trigger={
                <button className="rounded-2xl transition-transform hover:scale-[1.03]" title="Change avatar">
                  <Avatar
                    name={name}
                    src={user.profile?.avatar_url}
                    color={tint}
                    size={76}
                    userId={user.id}
                    showPresence
                    statusText={user.profile?.status_text}
                  />
                </button>
              }
            >
              {(close) => (
                <div className="p-2.5">
                  <p className="mb-2 text-xs font-semibold text-fg">Color</p>
                  <div className="grid grid-cols-7 gap-1.5">
                    {AVATAR_COLORS.map((c) => (
                      <button
                        key={c}
                        className={cn(
                          'h-6 w-6 rounded-full transition-transform hover:scale-110',
                          tint === c && 'ring-2 ring-white/70',
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => void patchProfile({ avatar_color: c })}
                      />
                    ))}
                  </div>
                  <div className="my-2 h-px bg-ink-700" />
                  <button
                    className="menu-item"
                    onClick={() => {
                      close()
                      fileRef.current?.click()
                    }}
                  >
                    <Upload size={14} /> Upload photo
                  </button>
                  {hasUploadedAvatar && (
                    <button
                      className="menu-item text-red-400 hover:text-red-300"
                      onClick={() => {
                        close()
                        void deleteAvatar()
                      }}
                    >
                      <Trash2 size={14} /> Remove photo
                    </button>
                  )}
                </div>
              )}
            </Dropdown>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadAvatar(file)
                e.target.value = ''
              }}
            />

            <div className="min-w-0 flex-1 pt-1">
              {editingName ? (
                <input
                  autoFocus
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') {
                      setFullName(user.profile?.full_name ?? '')
                      setEditingName(false)
                    }
                  }}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-brand bg-ink-850 px-2 py-1 text-lg font-bold text-fg outline-none"
                  maxLength={200}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingName(true)}
                  className="group flex max-w-full items-center gap-1.5 text-left"
                  title="Click to edit name"
                >
                  <h2 className="truncate text-lg font-bold text-fg">{name}</h2>
                  <User size={14} className="shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )}
              <input
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                onBlur={() => about.trim() !== (user.profile?.about ?? '') && void patchProfile({ about: about.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="Add description…"
                className="mt-0.5 w-full bg-transparent text-sm text-fg-secondary outline-none placeholder:text-fg-muted"
              />
              <UserStatusLine status={user.profile?.status_text} />
            </div>
          </div>

          {/* Status */}
          <div className="mt-4">
            <UserStatusEditor
              value={user.profile?.status_text}
              onSave={(status) => patchProfile(status ? { status_text: status } : { clear_status: true })}
            />
          </div>

          {/* Quick actions */}
          <div className="mt-4 flex gap-2">
            <button className="btn-secondary !py-1.5 text-xs" onClick={() => { onClose(); navigate('/app/chat') }}>
              <MessageSquare size={13} /> Chat
            </button>
            <button
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => {
                onClose()
                navigate(sprintPageUrl({ tab: 'standups' }))
              }}
            >
              <Zap size={13} /> Standups
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-6 flex gap-1 border-b border-ink-700">
            <DrawerTab active={tab === 'activity'} onClick={() => setTab('activity')}>
              Activity
            </DrawerTab>
            <DrawerTab active={tab === 'tasks'} onClick={() => setTab('tasks')}>
              Tasks{myTasks.data ? ` (${myTasks.data.total})` : ''}
            </DrawerTab>
          </div>

          {tab === 'activity' ? (
            <div className="pt-4">
              <div className="space-y-2.5 border-b border-ink-700 pb-4">
                <InfoRow icon={<Mail size={14} />}>{user.email}</InfoRow>
                <InfoRow icon={<Clock4 size={14} />}>
                  {localTime} local time
                  <span className="ml-1 text-fg-muted">({user.profile?.timezone || 'UTC'})</span>
                </InfoRow>
              </div>

              <RolesSection />

              <p className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-fg-muted">Activity</p>
              {activity.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : (activity.data ?? []).length === 0 ? (
                <p className="py-6 text-sm text-fg-muted">No recent activity.</p>
              ) : (
                <div className="space-y-0.5">
                  {(activity.data ?? []).map((entry) => {
                    const label = ACTION_LABELS[entry.action] ?? entry.action.replace(/\./g, ' ')
                    const target = (entry.data.ref as string)
                      ? `${entry.data.ref} — ${entry.data.title ?? ''}`
                      : ((entry.data.name as string) ?? '')
                    return (
                      <button
                        key={entry.id}
                        disabled={!entry.task_id}
                        onClick={() => {
                          if (entry.task_id) {
                            onClose()
                            navigate(`/app/tasks/${entry.task_id}`)
                          }
                        }}
                        className={cn(
                          'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                          entry.task_id && 'hover:bg-ink-850',
                        )}
                      >
                        <Hash size={13} className="mt-0.5 shrink-0 text-fg-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-fg-secondary">
                            You {label} <span className="text-fg">{target}</span>
                          </span>
                          <span className="text-[11px] text-fg-muted">{timeAgo(entry.created_at)}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="pt-4">
              {myTasks.isLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : (myTasks.data?.items.length ?? 0) === 0 ? (
                <p className="py-6 text-sm text-fg-muted">No open tasks assigned to you.</p>
              ) : (
                <div className="space-y-0.5">
                  {myTasks.data!.items.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => {
                        onClose()
                        navigate(`/app/tasks/${task.id}`)
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-ink-850"
                    >
                      <PriorityFlag priority={task.priority} />
                      <span className="w-12 shrink-0 text-[11px] text-fg-muted">{task.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{task.title}</span>
                      <StatusPill status={task.status} />
                    </button>
                  ))}
                  <button
                    className="w-full px-2.5 py-2 text-left text-xs font-medium text-brand hover:text-brand-hover"
                    onClick={() => {
                      onClose()
                      navigate('/app/my-tasks/assigned')
                    }}
                  >
                    View all tasks
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}

function DrawerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'border-b-2 px-3 py-2 text-sm transition-colors',
        active ? 'border-fg font-semibold text-fg' : 'border-transparent text-fg-secondary hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-sm text-fg-secondary">
      <span className="text-fg-muted">{icon}</span>
      {children}
    </p>
  )
}

function RolesSection() {
  const { data: roles } = useUserRoles()

  if (!roles) return null

  const summary = profileRoleDisplay(roles)
  const wsAdminRoles = adminWorkspaceRoles(roles)
  const spaceAdminRoles = adminSpaceRoles(roles)
  const projectAdminRoles = adminProjectRoles(roles)
  const projectMemberRoles = roles.project_roles.filter((p) => p.role === 'member')
  const projectViewerRoles = roles.project_roles.filter((p) => p.role === 'viewer')
  const hasScopedRoles =
    wsAdminRoles.length > 0 ||
    spaceAdminRoles.length > 0 ||
    projectAdminRoles.length > 0 ||
    projectMemberRoles.length > 0 ||
    projectViewerRoles.length > 0

  return (
    <div className="border-b border-ink-700 pb-4 pt-4">
      <div className="flex items-center gap-2">
        <Shield size={14} className="text-fg-muted" />
        <p className="flex-1 text-xs font-semibold uppercase tracking-wider text-fg-muted">Your roles</p>
      </div>

      <div className="mt-2 space-y-2">
        <RoleBadge icon={<Shield size={12} />} label={summary.title} detail={summary.detail} accent="brand" />

        {/* Full per-scope breakdown: every role this person holds, everywhere. */}
        {hasScopedRoles && (
          <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-900/50 p-2.5">
            {wsAdminRoles.length > 0 && (
              <ScopedRoleGroup
                icon={<Boxes size={11} />}
                title={`Workspace Admin (${wsAdminRoles.length})`}
                items={wsAdminRoles.map((wr) => wr.workspace_name)}
                chipClass="bg-brand/10 text-brand dark:bg-brand/15"
              />
            )}
            {spaceAdminRoles.length > 0 && (
              <ScopedRoleGroup
                icon={<Layers size={11} />}
                title={`Space Admin (${spaceAdminRoles.length})`}
                items={spaceAdminRoles.map((sr) => `${sr.space_name} · ${sr.workspace_name}`)}
                chipClass="bg-brand/10 text-brand dark:bg-brand/15"
              />
            )}
            {projectAdminRoles.length > 0 && (
              <ScopedRoleGroup
                icon={<FolderKanban size={11} />}
                title={`Project Admin (${projectAdminRoles.length})`}
                items={projectAdminRoles.map((pr) =>
                  pr.space_name ? `${pr.project_name} · ${pr.space_name}` : pr.project_name,
                )}
                chipClass="bg-brand/10 text-brand dark:bg-brand/15"
              />
            )}
            {projectMemberRoles.length > 0 && (
              <ScopedRoleGroup
                icon={<FolderKanban size={11} />}
                title={`Project Member (${projectMemberRoles.length})`}
                items={projectMemberRoles.map((pr) =>
                  pr.space_name ? `${pr.project_name} · ${pr.space_name}` : pr.project_name,
                )}
                chipClass="bg-gray-100 text-gray-600 dark:bg-ink-750 dark:text-fg-secondary"
              />
            )}
            {projectViewerRoles.length > 0 && (
              <ScopedRoleGroup
                icon={<FolderKanban size={11} />}
                title={`Project Viewer (${projectViewerRoles.length})`}
                items={projectViewerRoles.map((pr) =>
                  pr.space_name ? `${pr.project_name} · ${pr.space_name}` : pr.project_name,
                )}
                chipClass="bg-gray-100 text-gray-500 dark:bg-ink-750 dark:text-fg-muted"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ScopedRoleGroup({
  icon,
  title,
  items,
  chipClass,
}: {
  icon: React.ReactNode
  title: string
  items: string[]
  chipClass: string
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
        {icon} {title}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((item) => (
          <span key={item} className={cn('max-w-full truncate rounded-md px-2 py-0.5 text-xs font-medium', chipClass)}>
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function RoleBadge({
  icon,
  label,
  detail,
  accent,
}: {
  icon: React.ReactNode
  label: string
  detail?: string | null
  accent: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-ink-800 px-3 py-2">
      <span className="text-brand">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{label}</p>
        {detail && <p className="text-[11px] leading-snug text-fg-muted">{detail}</p>}
      </div>
    </div>
  )
}
