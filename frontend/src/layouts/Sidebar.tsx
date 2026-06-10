import { useQueryClient } from '@tanstack/react-query'
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ClipboardCheck,
  Clock,
  FolderKanban,
  Hash,
  Inbox,
  LayoutGrid,
  ListFilter,
  MoreHorizontal,
  Plus,
  Search,
  SquareCheck,
  SquareKanban,
  UserPlus,
  X,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../lib/api'
import {
  useChannels,
  useCurrentContext,
  useProjects,
  useSpaces,
  useUnreadNotifications,
} from '../lib/queries'
import type { Task } from '../lib/types'
import { cn } from '../lib/utils'
import { toast } from '../stores/toast'
import { useUIStore } from '../stores/ui'
import { Dropdown } from '../components/ui/Dropdown'
import { Modal } from '../components/ui/Modal'

export function Sidebar() {
  const { org, workspace } = useCurrentContext()
  const spaces = useSpaces(workspace?.id)
  const projects = useProjects(workspace?.id)
  const channels = useChannels(workspace?.id)
  const unread = useUnreadNotifications()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toggleSidebar, setSearchOpen, setInviteOpen } = useUIStore()

  // Sidebar filter (toggled by the filter icon)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterText, setFilterText] = useState('')

  // Create modal (space / project / task)
  const [createKind, setCreateKind] = useState<null | 'space' | 'project' | 'task'>(null)

  const canManage = workspace?.my_role === 'admin' || workspace?.my_role === 'owner'
  const isOrgOwner = org?.my_role === 'owner'

  const match = (name: string) =>
    !filterText.trim() || name.toLowerCase().includes(filterText.trim().toLowerCase())

  const visibleChannels = (channels.data ?? []).filter((c) => !c.is_direct && match(c.name))
  const visibleSpaces = (spaces.data ?? []).filter((space) => {
    const spaceProjects = (projects.data ?? []).filter((p) => p.space_id === space.id)
    return match(space.name) || spaceProjects.some((p) => match(p.name))
  })

  return (
    <aside className="group/sidebar flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-ink-700 bg-ink-850 pb-4">
      {/* ---- Header: Home · search · filter · collapse (on hover) · + Create ---- */}
      <div className="flex items-center gap-0.5 px-3 pb-1 pt-3">
        <button
          onClick={() => navigate('/app/dashboard')}
          className="mr-1 text-lg font-bold text-fg hover:text-white"
        >
          Home
        </button>
        <span className="flex-1" />
        <button
          onClick={() => setSearchOpen(true)}
          title="Search (Ctrl K)"
          className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <Search size={16} />
        </button>
        <button
          onClick={() => {
            setFilterOpen((v) => !v)
            setFilterText('')
          }}
          title="Filter sidebar"
          className={cn(
            'rounded-lg p-1.5 transition-colors hover:bg-ink-750 hover:text-fg',
            filterOpen ? 'bg-brand-soft text-brand' : 'text-fg-muted',
          )}
        >
          <ListFilter size={16} />
        </button>
        <button
          onClick={toggleSidebar}
          title="Collapse sidebar"
          className="rounded-lg p-1.5 text-fg-muted opacity-0 transition-all hover:bg-ink-750 hover:text-fg group-hover/sidebar:opacity-100"
        >
          <ChevronsLeft size={16} />
        </button>
        <CreateMenu
          canManage={canManage}
          isOrgOwner={isOrgOwner}
          onPick={(kind) => {
            if (kind === 'task' || kind === 'project' || kind === 'space') setCreateKind(kind)
            else if (kind === 'channel') navigate('/app/chat?new=1')
            else if (kind === 'sprint') navigate('/app/sprints?new=1')
            else if (kind === 'workspace') navigate('/app/workspaces?new=1')
            else if (kind === 'invite') setInviteOpen(true)
          }}
        />
      </div>

      {/* ---- Filter input ---- */}
      {filterOpen && (
        <div className="relative mx-3 mb-1 mt-1">
          <ListFilter size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            autoFocus
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilterOpen(false)}
            placeholder="Filter channels & projects…"
            className="w-full rounded-lg border border-ink-700 bg-ink-800 py-1.5 pl-8 pr-7 text-xs text-fg outline-none transition-colors focus:border-brand"
          />
          {filterText && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
              onClick={() => setFilterText('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* ---- Top nav ---- */}
      <nav className="mt-1">
        <SidebarLink to="/app/notifications" icon={<Inbox size={15} />} label="Inbox" badge={unread.data?.count} />
        <SidebarLink to="/app/list" icon={<SquareCheck size={15} />} label="My Tasks" />
        <SidebarLink to="/app/sprints" icon={<Zap size={15} />} label="Sprints" />
        <Dropdown
          className="mx-2"
          width="w-56"
          trigger={
            <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg">
              <MoreHorizontal size={15} />
              More
            </button>
          }
        >
          {(close) => (
            <>
              <MenuLink close={close} to="/app/board" icon={<SquareKanban size={15} />}>
                Board
              </MenuLink>
              <MenuLink close={close} to="/app/chat" icon={<Hash size={15} />}>
                All Channels
              </MenuLink>
              <div className="my-1 h-px bg-ink-700" />
              <MenuLink close={close} to="/app/workspaces" icon={<Briefcase size={15} />}>
                Workspaces
              </MenuLink>
            </>
          )}
        </Dropdown>
      </nav>

      {/* ---- Channels ---- */}
      <Section title="Channels">
        {visibleChannels.map((channel) => (
          <NavLink
            key={channel.id}
            to={`/app/chat?channel=${channel.id}`}
            className="mx-2 flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
          >
            <Hash size={14} className="shrink-0 text-fg-muted" />
            <span className="flex-1 truncate">{channel.name}</span>
            {channel.unread_count > 0 && (
              <span className="rounded-full bg-pink-500 px-1.5 text-[10px] font-bold text-white">
                {channel.unread_count}
              </span>
            )}
          </NavLink>
        ))}
        {visibleChannels.length === 0 && filterText && (
          <p className="px-5 py-1 text-xs text-fg-muted">No matching channels</p>
        )}
        <button
          onClick={() => navigate('/app/chat?new=1')}
          className="mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg-secondary"
        >
          <Plus size={14} /> Add Channel
        </button>
      </Section>

      {/* ---- Spaces ---- */}
      <Section
        title="Spaces"
        action={
          canManage ? (
            <button
              onClick={() => setCreateKind('space')}
              className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/section:opacity-100"
              title="New space"
            >
              <Plus size={13} />
            </button>
          ) : undefined
        }
      >
        {visibleSpaces.map((space) => {
          const spaceProjects = (projects.data ?? []).filter(
            (p) => p.space_id === space.id && (match(space.name) || match(p.name)),
          )
          return (
            <SpaceItem key={space.id} name={space.name} color={space.color}>
              {spaceProjects.map((project) => (
                <NavLink
                  key={project.id}
                  to={`/app/projects/${project.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-lg py-1.5 pl-9 pr-3 text-sm transition-colors',
                      isActive
                        ? 'bg-brand-soft font-medium text-fg'
                        : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
                    )
                  }
                >
                  <FolderKanban size={14} className="shrink-0" style={{ color: project.color }} />
                  <span className="flex-1 truncate">{project.name}</span>
                  {project.task_count != null && project.task_count > 0 && (
                    <span className="text-[10px] text-fg-muted">{project.task_count}</span>
                  )}
                </NavLink>
              ))}
              {spaceProjects.length === 0 && (
                <p className="py-1 pl-9 text-xs text-fg-muted">
                  {filterText ? 'No matching projects' : 'No projects yet'}
                </p>
              )}
            </SpaceItem>
          )
        })}
        {visibleSpaces.length === 0 && filterText && (
          <p className="px-5 py-1 text-xs text-fg-muted">No matching spaces</p>
        )}
        {canManage && (
          <button
            onClick={() => setCreateKind('space')}
            className="mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg-secondary"
          >
            <Plus size={14} /> New Space
          </button>
        )}
      </Section>

      <CreateModal
        kind={createKind}
        onClose={() => setCreateKind(null)}
        canManage={canManage}
        workspaceId={workspace?.id}
        onCreatedProject={(id) => {
          void queryClient.invalidateQueries({ queryKey: ['projects', workspace?.id] })
          navigate(`/app/projects/${id}`)
        }}
        onCreatedSpace={() => {
          void queryClient.invalidateQueries({ queryKey: ['spaces', workspace?.id] })
        }}
      />
    </aside>
  )
}

/* ---------------- Create menu (the white "+ Create" button) ---------------- */

type CreateKind = 'task' | 'project' | 'channel' | 'space' | 'sprint' | 'workspace' | 'invite'

function CreateMenu({
  canManage,
  isOrgOwner,
  onPick,
}: {
  canManage: boolean
  isOrgOwner: boolean
  onPick: (kind: CreateKind) => void
}) {
  return (
    <Dropdown
      align="right"
      width="w-64"
      className="ml-1"
      trigger={
        <button className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-900 transition-colors hover:bg-gray-200">
          <Plus size={13} /> Create
        </button>
      }
    >
      {(close) => (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Create
          </p>
          <CreateItem close={close} onPick={onPick} kind="task" icon={<ClipboardCheck size={15} className="text-sky-400" />} label="Task" />
          <div className="my-1 h-px bg-ink-700" />
          {canManage && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="project"
              icon={<FolderKanban size={15} className="text-purple-400" />}
              label="Project"
              description="Track tasks, lists & sprints"
            />
          )}
          <CreateItem
            close={close}
            onPick={onPick}
            kind="channel"
            icon={<Hash size={15} className="text-emerald-400" />}
            label="Channel"
            description="Conversations on specific topics"
          />
          {canManage && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="space"
              icon={<LayoutGrid size={15} className="text-blue-400" />}
              label="Space"
              description="Organize work by team or department"
            />
          )}
          {canManage && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="sprint"
              icon={<Zap size={15} className="text-amber-400" />}
              label="Sprint"
              description="Plan your next iteration"
            />
          )}
          {(isOrgOwner || canManage) && <div className="my-1 h-px bg-ink-700" />}
          {isOrgOwner && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="workspace"
              icon={<Briefcase size={15} className="text-pink-400" />}
              label="Workspace"
            />
          )}
          {canManage && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="invite"
              icon={<UserPlus size={15} className="text-brand" />}
              label="Invite people"
            />
          )}
        </>
      )}
    </Dropdown>
  )
}

function CreateItem({
  close,
  onPick,
  kind,
  icon,
  label,
  description,
}: {
  close: () => void
  onPick: (kind: CreateKind) => void
  kind: CreateKind
  icon: React.ReactNode
  label: string
  description?: string
}) {
  return (
    <button
      className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-ink-750"
      onClick={() => {
        close()
        onPick(kind)
      }}
    >
      <span className="mt-0.5">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm text-fg">{label}</span>
        {description && <span className="block text-[11px] text-fg-muted">{description}</span>}
      </span>
    </button>
  )
}

/* ---------------- Create modal: task / project / space ---------------- */

function CreateModal({
  kind,
  onClose,
  canManage,
  workspaceId,
  onCreatedProject,
  onCreatedSpace,
}: {
  kind: null | 'task' | 'project' | 'space'
  onClose: () => void
  canManage: boolean
  workspaceId: string | undefined
  onCreatedProject: (id: string) => void
  onCreatedSpace: () => void
}) {
  const spaces = useSpaces(workspaceId)
  const projects = useProjects(workspaceId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [busy, setBusy] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [projName, setProjName] = useState('')
  const [projKey, setProjKey] = useState('')
  const [projSpaceId, setProjSpaceId] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskProjectId, setTaskProjectId] = useState('')

  const createSpace = async () => {
    if (!workspaceId || !spaceName.trim()) return
    setBusy(true)
    try {
      await api.post(`/workspaces/${workspaceId}/spaces`, { name: spaceName.trim() })
      toast.success('Space created')
      setSpaceName('')
      onCreatedSpace()
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const createProject = async () => {
    const spaceId = projSpaceId || spaces.data?.[0]?.id
    if (!spaceId || !projName.trim() || projKey.trim().length < 2) return
    setBusy(true)
    try {
      const project = await api.post<{ id: string }>(`/spaces/${spaceId}/projects`, {
        name: projName.trim(),
        key: projKey.trim().toUpperCase(),
      })
      toast.success('Project created')
      setProjName('')
      setProjKey('')
      onClose()
      onCreatedProject(project.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const createTask = async () => {
    const projectId = taskProjectId || projects.data?.[0]?.id
    if (!projectId || !taskTitle.trim()) return
    setBusy(true)
    try {
      const task = await api.post<Task>(`/projects/${projectId}/tasks`, { title: taskTitle.trim() })
      toast.success(`${task.ref} created`)
      setTaskTitle('')
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
      navigate(`/app/tasks/${task.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Task */}
      <Modal open={kind === 'task'} onClose={onClose} title="Create task" width="max-w-md">
        <div className="space-y-3">
          <select className="input-dark" value={taskProjectId} onChange={(e) => setTaskProjectId(e.target.value)}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {(projects.data ?? []).length === 0 ? (
            <p className="text-xs text-fg-muted">You don't have access to any projects yet.</p>
          ) : (
            <>
              <input
                className="input-dark"
                placeholder="Task name"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createTask()}
                autoFocus
              />
              <button className="btn-primary w-full" disabled={busy || !taskTitle.trim()} onClick={createTask}>
                Create task
              </button>
            </>
          )}
        </div>
      </Modal>

      {/* Space */}
      <Modal open={kind === 'space'} onClose={onClose} title="Create Space" width="max-w-md">
        <div className="space-y-3">
          <input
            className="input-dark"
            placeholder="Space name"
            value={spaceName}
            onChange={(e) => setSpaceName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSpace()}
            autoFocus
          />
          <button className="btn-primary w-full" disabled={busy || !spaceName.trim() || !canManage} onClick={createSpace}>
            Create Space
          </button>
        </div>
      </Modal>

      {/* Project */}
      <Modal open={kind === 'project'} onClose={onClose} title="Create Project" width="max-w-md">
        <div className="space-y-3">
          <select
            className="input-dark"
            value={projSpaceId || spaces.data?.[0]?.id || ''}
            onChange={(e) => setProjSpaceId(e.target.value)}
          >
            {(spaces.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            className="input-dark"
            placeholder="Project name"
            value={projName}
            onChange={(e) => {
              setProjName(e.target.value)
              if (!projKey || projKey === autoKey(projName)) setProjKey(autoKey(e.target.value))
            }}
            autoFocus
          />
          <input
            className="input-dark uppercase"
            placeholder="Key (e.g. PHX)"
            maxLength={10}
            value={projKey}
            onChange={(e) => setProjKey(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
          />
          <button
            className="btn-primary w-full"
            disabled={busy || !projName.trim() || projKey.trim().length < 2}
            onClick={createProject}
          >
            Create Project
          </button>
        </div>
      </Modal>
    </>
  )
}

/* ---------------- Bits ---------------- */

function SidebarLink({
  to,
  icon,
  label,
  badge,
}: {
  to: string
  icon: React.ReactNode
  label: string
  badge?: number
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'mx-2 flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
          isActive ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-pink-500 px-1.5 text-[10px] font-bold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  )
}

function MenuLink({
  close,
  to,
  icon,
  children,
}: {
  close: () => void
  to: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  return (
    <button
      className="menu-item"
      onClick={() => {
        close()
        navigate(to)
      }}
    >
      {icon}
      {children}
    </button>
  )
}

function Section({
  title,
  children,
  defaultOpen = true,
  action,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  action?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="group/section mt-4">
      <div className="flex items-center justify-between px-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted hover:text-fg-secondary"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}

function SpaceItem({
  name,
  color,
  children,
}: {
  name: string
  color: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-ink-750"
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {name[0]?.toUpperCase()}
        </span>
        <span className="flex-1 truncate text-left">{name}</span>
        {open ? (
          <ChevronDown size={13} className="text-fg-muted" />
        ) : (
          <ChevronRight size={13} className="text-fg-muted" />
        )}
      </button>
      {open && children}
    </div>
  )
}

function autoKey(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 5)
}
