import { useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArrowRightLeft,
  Briefcase,
  ChevronDown,
  ChevronRight,
  CalendarClock,
  CircleDot,
  ClipboardCheck,
  Clock,
  Copy,
  CopyPlus,
  FileSpreadsheet,
  FolderKanban,
  FolderPlus,
  Hash,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListFilter,
  MoreHorizontal,
  Palette,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareCheck,
  SquareKanban,
  Trash2,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../lib/api'
import { CHAT_CREATE_PATH } from '../lib/chatAccess'
import {
  canCreateChannel,
  canCreateProject,
  canCreateSpace,
  canCreateSprint,
  canCreateWorkspace,
  canOpenCreateInvite,
  creatableSpaces,
  isWorkspaceAdmin,
} from '../lib/createAccess'
import { EntityIcon } from '../lib/entityIcons'
import {
  useChannels,
  useCurrentContext,
  useProjects,
  useSpaces,
  useUnreadNotifications,
  useUserRoles,
} from '../lib/queries'
import { useRepliesUnreadCount } from '../lib/inboxQueries'
import { useMyTasksSummary } from '../lib/myTasksQueries'
import { isOrgLeader } from '../lib/scopedRoles'
import { canManageProjectSettings, canManageSpaceSettings } from '../lib/projectAccess'
import type { Project, Space, Task } from '../lib/types'
import { cn } from '../lib/utils'
import { useResetFormWhenOpen } from '../lib/useResetFormWhenOpen'
import { toast } from '../stores/toast'
import { useAuthStore } from '../stores/auth'
import { useUIStore } from '../stores/ui'
import { SidebarCollapseButton } from '../components/layout/SidebarCollapseButton'
import { ColorIconPicker } from '../components/ui/ColorIconPicker'
import { type MenuItem, useRowMenu } from '../components/ui/ContextMenu'
import { Dropdown } from '../components/ui/Dropdown'
import { Modal } from '../components/ui/Modal'
import { RenameModal } from '../components/ui/RenameModal'
import { CustomizeSidebarModal, type CustomizeTab } from '../components/profile/CustomizeSidebarModal'
import type { HomeItem } from '../constants/homeItems'
import { CustomFieldsModal } from '../components/projects/CustomFieldsModal'
import { FavoritesSidebarSection } from '../components/favorites/FavoritesNav'
import { ProjectMembersModal } from '../components/projects/ProjectMembersModal'
import { SheetsSyncModal } from '../components/projects/SheetsSyncModal'
import { SpaceMembersModal } from '../components/projects/SpaceMembersModal'
import { StatusEditorModal } from '../components/projects/StatusEditorModal'
import { SaveAsTemplateModal } from '../components/templates/SaveAsTemplateModal'
import { TemplateCenterModal } from '../components/templates/TemplateCenterModal'
import { useOpenInvite } from '../hooks/useOpenInvite'
import { useHomeSidebarSettings } from '../hooks/useHomeSidebarSettings'
import { useSidebarSections } from '../hooks/useSidebarSections'
import type { TemplateKind } from '../lib/templates'

export function Sidebar() {
  const { org, workspace, workspaces } = useCurrentContext()
  const spaces = useSpaces(workspace?.id)
  const projects = useProjects(workspace?.id)
  const channels = useChannels(workspace?.id)
  const unread = useUnreadNotifications()
  const repliesUnread = useRepliesUnreadCount()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const openInvite = useOpenInvite()
  const {
    visibleItems: homeItems,
    hiddenItems: hiddenHomeItems,
    setItemVisible: setHomeItemVisible,
  } = useHomeSidebarSettings()
  const { visibleSections } = useSidebarSections()
  const { setSearchOpen } = useUIStore()

  const homeItemBadge = (item: HomeItem) => {
    if (item.badge === 'inbox') return unread.data?.count
    if (item.badge === 'replies') return repliesUnread.data?.count
    return undefined
  }

  // Sidebar filter (toggled by the filter icon)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterText, setFilterText] = useState('')

  // Create modal (space / project / task)
  const [createKind, setCreateKind] = useState<null | 'space' | 'project' | 'task'>(null)
  const [createProjectSpaceId, setCreateProjectSpaceId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<
    null | { kind: 'space' | 'project'; id: string; name: string }
  >(null)
  const [renaming, setRenaming] = useState(false)
  // Row-menu targets
  const [deleteTarget, setDeleteTarget] = useState<
    null | { kind: 'space' | 'project'; id: string; name: string }
  >(null)
  const [deleting, setDeleting] = useState(false)
  const [shareTarget, setShareTarget] = useState<
    null | { kind: 'space' | 'project'; id: string }
  >(null)
  // Project-settings modals opened from the project ⋯ menu
  const [projectSettings, setProjectSettings] = useState<
    null | { kind: 'fields' | 'statuses' | 'sheets'; id: string }
  >(null)
  // Templates (opened from the Templates submenu on a space/project row)
  const [templateCenter, setTemplateCenter] = useState<
    null | { mode: 'apply' | 'update'; kind: TemplateKind; source: { id: string; name: string }; defaultSpaceId?: string }
  >(null)
  const [saveTemplateTarget, setSaveTemplateTarget] = useState<
    null | { kind: TemplateKind; source: { id: string; name: string } }
  >(null)
  // Spaces-section toggle: reveal archived projects in the tree
  const [showArchived, setShowArchived] = useState(false)
  // "Customize Sidebar" modal — `customizeTab` selects which tab it opens on.
  const [customizeSidebarOpen, setCustomizeSidebarOpen] = useState(false)
  const [customizeTab, setCustomizeTab] = useState<CustomizeTab>('navigation')
  const openCustomize = (tab: CustomizeTab = 'navigation') => {
    setCustomizeTab(tab)
    setCustomizeSidebarOpen(true)
  }

  const spaceList = spaces.data ?? []
  const projectList = projects.data ?? []
  const canManage = isWorkspaceAdmin(org, workspace)
  const canCreateProjectFlag = canCreateProject(org, workspace, spaceList)
  const canCreateSpaceFlag = canCreateSpace(org, workspace)
  const canCreateSprintFlag = canCreateSprint(org, workspace)
  const canCreateWorkspaceFlag = canCreateWorkspace(org)
  const canCreateChannelFlag = canCreateChannel(org, workspace)
  const canCreateInviteFlag = canOpenCreateInvite(org, workspaces, spaceList, projectList)
  const isOrgAdminOrOwner = isOrgLeader(org)

  const { data: roles } = useUserRoles()
  const highest = roles?.highest_role

  const match = (name: string) =>
    !filterText.trim() || name.toLowerCase().includes(filterText.trim().toLowerCase())

  const saveRename = async (name: string) => {
    if (!renameTarget || !workspace?.id) return
    setRenaming(true)
    try {
      if (renameTarget.kind === 'space') {
        await api.patch(`/spaces/${renameTarget.id}`, { name })
        void queryClient.invalidateQueries({ queryKey: ['spaces', workspace.id] })
        toast.success('Space renamed')
      } else {
        await api.patch(`/projects/${renameTarget.id}`, { name })
        void queryClient.invalidateQueries({ queryKey: ['projects', workspace.id] })
        toast.success('Project renamed')
      }
      setRenameTarget(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setRenaming(false)
    }
  }

  // ---- Row-menu mutations ----
  const refetchSpaces = () => queryClient.invalidateQueries({ queryKey: ['spaces', workspace?.id] })
  const refetchProjects = () => queryClient.invalidateQueries({ queryKey: ['projects', workspace?.id] })

  const patchSpace = async (id: string, changes: { color?: string; icon?: string | null }) => {
    try {
      await api.patch(`/spaces/${id}`, changes)
      void refetchSpaces()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const patchProject = async (
    id: string,
    changes: { color?: string; icon?: string | null; is_archived?: boolean; space_id?: string },
  ) => {
    try {
      await api.patch(`/projects/${id}`, changes)
      void refetchProjects()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const duplicateProject = async (id: string) => {
    try {
      const copy = await api.post<Project>(`/projects/${id}/duplicate`)
      void refetchProjects()
      toast.success('Project duplicated')
      navigate(`/app/projects/${copy.id}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.kind === 'space') {
        await api.delete(`/spaces/${deleteTarget.id}`)
        void refetchSpaces()
        toast.success('Space deleted')
      } else {
        await api.delete(`/projects/${deleteTarget.id}`)
        void refetchProjects()
        toast.success('Project deleted')
      }
      setDeleteTarget(null)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDeleting(false)
    }
  }
  const copyLink = (path: string) => {
    void navigator.clipboard?.writeText(`${window.location.origin}${path}`)
    toast.success('Link copied')
  }

  const visibleChannels = (channels.data ?? []).filter((c) => !c.is_direct && match(c.name))

  // Space admins: only see spaces they are admin of
  const adminSpaceIds = new Set(
    (roles?.space_roles ?? []).filter((sr) => sr.role === 'admin').map((sr) => sr.space_id),
  )
  // Project admins: only see projects they are admin of
  const adminProjectIds = new Set(
    (roles?.project_roles ?? []).filter((pr) => pr.role === 'admin').map((pr) => pr.project_id),
  )
  // Every project the user holds ANY role in (admin, member or viewer). Visibility
  // filters must use this — a project admin in X who is a member of Y still sees Y.
  const roleProjectIds = new Set((roles?.project_roles ?? []).map((pr) => pr.project_id))

  const allSpaces = spaces.data ?? []
  const allProjects = projects.data ?? []

  const scopeAdminOptions = {
    orgLeader: isOrgAdminOrOwner,
    workspaceAdmin: canManage,
    adminProjectIds: adminProjectIds,
    adminSpaceIds: adminSpaceIds,
  }
  const canAdminSpace = (space: Space) => canManageSpaceSettings(space, scopeAdminOptions)
  const canAdminProject = (project: Project) => canManageProjectSettings(project, scopeAdminOptions)

  // ---- Context-menu builders (ClickUp-style cascading menu) ----
  const templatesSubmenu = (
    kind: TemplateKind,
    source: { id: string; name: string },
    defaultSpaceId?: string,
  ): MenuItem => ({
    type: 'submenu',
    label: 'Templates',
    icon: <LayoutTemplate size={14} />,
    children: [
      {
        type: 'action',
        label: 'Apply a template',
        icon: <Sparkles size={14} />,
        onClick: () => setTemplateCenter({ mode: 'apply', kind, source, defaultSpaceId }),
      },
      {
        type: 'action',
        label: 'Save as template',
        icon: <Save size={14} />,
        onClick: () => setSaveTemplateTarget({ kind, source }),
      },
      {
        type: 'action',
        label: 'Update existing template',
        icon: <RefreshCw size={14} />,
        onClick: () => setTemplateCenter({ mode: 'update', kind, source }),
      },
    ],
  })

  const buildSpaceMenu = (space: Space): MenuItem[] => {
    const items: MenuItem[] = []
    if (isOrgAdminOrOwner) {
      items.push({
        type: 'action',
        label: 'Rename',
        icon: <Pencil size={14} />,
        onClick: () => setRenameTarget({ kind: 'space', id: space.id, name: space.name }),
      })
    }
    if (canAdminSpace(space)) {
      items.push({
        type: 'submenu',
        label: 'Color & Icon',
        icon: <Palette size={14} />,
        panel: () => (
          <ColorIconPicker
            color={space.color}
            icon={space.icon}
            onPick={(changes) => void patchSpace(space.id, changes)}
          />
        ),
      })
    }
    if (canManage || adminSpaceIds.has(space.id)) {
      if (items.length) items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: 'Create project',
        icon: <FolderPlus size={14} />,
        onClick: () => {
          setCreateProjectSpaceId(space.id)
          setCreateKind('project')
        },
      })
    }
    if (canAdminSpace(space)) {
      items.push({
        type: 'action',
        label: 'Sharing & Permissions',
        icon: <Users size={14} />,
        onClick: () => setShareTarget({ kind: 'space', id: space.id }),
      })
    }
    if (canAdminSpace(space)) {
      items.push(templatesSubmenu('space', { id: space.id, name: space.name }, space.id))
    }
    if (canAdminSpace(space)) {
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => setDeleteTarget({ kind: 'space', id: space.id, name: space.name }),
      })
    }
    return items
  }

  const buildProjectMenu = (project: Project): MenuItem[] => {
    const items: MenuItem[] = []
    if (isOrgAdminOrOwner) {
      items.push({
        type: 'action',
        label: 'Rename',
        icon: <Pencil size={14} />,
        onClick: () => setRenameTarget({ kind: 'project', id: project.id, name: project.name }),
      })
    }
    if (canAdminProject(project)) {
      items.push({
        type: 'submenu',
        label: 'Color & Icon',
        icon: <Palette size={14} />,
        panel: () => (
          <ColorIconPicker
            color={project.color}
            icon={project.icon}
            onPick={(changes) => void patchProject(project.id, changes)}
          />
        ),
      })
    }
    items.push({
      type: 'action',
      label: 'Copy link',
      icon: <Copy size={14} />,
      onClick: () => copyLink(`/app/projects/${project.id}`),
    })
    if (canAdminProject(project)) {
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: 'Custom Fields',
        icon: <SlidersHorizontal size={14} />,
        onClick: () => setProjectSettings({ kind: 'fields', id: project.id }),
      })
      items.push({
        type: 'action',
        label: 'Task statuses',
        icon: <CircleDot size={14} />,
        onClick: () => setProjectSettings({ kind: 'statuses', id: project.id }),
      })
      items.push({
        type: 'action',
        label: 'Google Sheets',
        icon: <FileSpreadsheet size={14} />,
        onClick: () => setProjectSettings({ kind: 'sheets', id: project.id }),
      })
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: 'Sharing & Permissions',
        icon: <Users size={14} />,
        onClick: () => setShareTarget({ kind: 'project', id: project.id }),
      })
    }
    // Move to another space (workspace admins only) — flyout space picker.
    if (canManage && allSpaces.length > 1) {
      items.push({
        type: 'submenu',
        label: 'Move to',
        icon: <ArrowRightLeft size={14} />,
        children: allSpaces.map((s) => ({
          type: 'action' as const,
          label: s.name,
          icon: (
            <span
              className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-white"
              style={{ backgroundColor: s.color }}
            >
              {s.name[0]?.toUpperCase()}
            </span>
          ),
          hint: s.id === project.space_id ? '✓' : undefined,
          disabled: s.id === project.space_id,
          onClick: () => void patchProject(project.id, { space_id: s.id }),
        })),
      })
    }
    if (canManage || (project.space_id != null && adminSpaceIds.has(project.space_id))) {
      items.push({
        type: 'action',
        label: 'Duplicate',
        icon: <CopyPlus size={14} />,
        onClick: () => void duplicateProject(project.id),
      })
    }
    if (canAdminProject(project)) {
      items.push({
        type: 'action',
        label: project.is_archived ? 'Unarchive' : 'Archive',
        icon: <Archive size={14} />,
        onClick: () => void patchProject(project.id, { is_archived: !project.is_archived }),
      })
    }
    if (canAdminProject(project)) {
      items.push(
        templatesSubmenu('project', { id: project.id, name: project.name }, project.space_id ?? undefined),
      )
    }
    if (canManage) {
      items.push({ type: 'separator' })
      items.push({
        type: 'action',
        label: 'Delete',
        icon: <Trash2 size={14} />,
        danger: true,
        onClick: () => setDeleteTarget({ kind: 'project', id: project.id, name: project.name }),
      })
    }
    return items
  }

  const visibleSpaces = allSpaces.filter((space) => {
    // Space admin: show spaces they admin, plus spaces holding projects they belong to
    if (highest === 'space_admin') {
      const hasRoleProject = allProjects.some(
        (p) => p.space_id === space.id && roleProjectIds.has(p.id),
      )
      if (!adminSpaceIds.has(space.id) && !hasRoleProject) return false
    }
    // Project admin: show spaces containing any project they belong to (admin OR member)
    if (highest === 'project_admin') {
      const hasRoleProject = allProjects.some(
        (p) => p.space_id === space.id && roleProjectIds.has(p.id),
      )
      if (!hasRoleProject) return false
    }
    const spaceProjects = allProjects.filter((p) => p.space_id === space.id)
    return match(space.name) || spaceProjects.some((p) => match(p.name))
  })

  // Built-in section id → rendered node. Order & visibility come from
  // useSidebarSections; the sidebar simply renders `visibleSections` in order.
  // Home shortcuts are driven solely by useHomeSidebarSettings (Customize → Home).
  const sectionNodes: Record<string, React.ReactNode> = {
    home: (
      <nav className="mt-1">
        {(() => {
          const renderHomeItem = (item: HomeItem) => {
            if (item.id === 'myTasks') return <MyTasksNav key={item.id} />
            const Icon = item.icon
            return (
              <SidebarLink
                key={item.id}
                to={item.to}
                icon={<Icon size={15} />}
                label={item.label}
                badge={homeItemBadge(item)}
              />
            )
          }
          // Keep Favorites between My Tasks and the rest (prior layout), or
          // after all shortcuts when My Tasks is hidden via Customize → Home.
          const myTasksIdx = homeItems.findIndex((i) => i.id === 'myTasks')
          const before = myTasksIdx >= 0 ? homeItems.slice(0, myTasksIdx + 1) : homeItems
          const after = myTasksIdx >= 0 ? homeItems.slice(myTasksIdx + 1) : []
          return (
            <>
              {before.map(renderHomeItem)}
              <FavoritesSidebarSection />
              {after.map(renderHomeItem)}
            </>
          )
        })()}
        <Dropdown
          className="mx-2"
          width="w-64"
          trigger={
            <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg">
              <MoreHorizontal size={15} />
              More
            </button>
          }
        >
          {(close) => (
            <>
              {/* Hidden Home shortcuts — pin one to bring it back into the sidebar. */}
              {hiddenHomeItems.length > 0 ? (
                hiddenHomeItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.id} className="group/more flex items-center">
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
                        onClick={() => {
                          close()
                          navigate(item.to)
                        }}
                      >
                        <Icon size={15} className="shrink-0 text-fg-muted" />
                        <span className="flex-1 truncate">{item.label}</span>
                      </button>
                      <button
                        title="Pin to sidebar"
                        aria-label={`Pin ${item.label} to sidebar`}
                        className="mr-1 shrink-0 rounded p-1 text-fg-muted opacity-0 transition-opacity hover:bg-ink-700 hover:text-fg group-hover/more:opacity-100"
                        onClick={() => setHomeItemVisible(item.id, true)}
                      >
                        <Pin size={14} />
                      </button>
                    </div>
                  )
                })
              ) : (
                <p className="px-3 py-2 text-xs text-fg-muted">All shortcuts are pinned</p>
              )}
              <div className="my-1 h-px bg-ink-700" />
              <MenuLink close={close} to="/app/board" icon={<SquareKanban size={15} />}>
                Board
              </MenuLink>
              <MenuLink close={close} to="/app/workspaces" icon={<Briefcase size={15} />}>
                Workspaces
              </MenuLink>
              <div className="my-1 h-px bg-ink-700" />
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  openCustomize('home')
                }}
              >
                <SlidersHorizontal size={15} />
                Customize
              </button>
            </>
          )}
        </Dropdown>
      </nav>
    ),
    channels: (
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
        {canCreateChannelFlag && (
          <button
            onClick={() => navigate(CHAT_CREATE_PATH)}
            className="mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg-secondary"
          >
            <Plus size={14} /> Add Channel
          </button>
        )}
      </Section>
    ),
    spaces: (
      <Section
        title="Spaces"
        action={
          <SpacesSectionControls
            canManage={canManage}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onCreateSpace={() => setCreateKind('space')}
          />
        }
      >
        {visibleSpaces.map((space) => {
          let spaceProjects = allProjects.filter(
            (p) => p.space_id === space.id && (match(space.name) || match(p.name)),
          )
          // Hide archived projects unless the user toggled "Show archived".
          if (!showArchived) {
            spaceProjects = spaceProjects.filter((p) => !p.is_archived)
          }
          // Project admin: filter to projects they belong to in any role (admin OR member)
          if (highest === 'project_admin') {
            spaceProjects = spaceProjects.filter((p) => roleProjectIds.has(p.id))
          }
          return (
            <SpaceRow
              key={space.id}
              space={space}
              menuItems={buildSpaceMenu(space)}
              canCreateProject={canManage || adminSpaceIds.has(space.id)}
              onCreateProject={() => {
                setCreateProjectSpaceId(space.id)
                setCreateKind('project')
              }}
            >
              {spaceProjects.map((project) => (
                <ProjectRow key={project.id} project={project} menuItems={buildProjectMenu(project)} />
              ))}
              {spaceProjects.length === 0 && (
                <p className="py-1 pl-9 text-xs text-fg-muted">
                  {filterText ? 'No matching projects' : 'No projects yet'}
                </p>
              )}
            </SpaceRow>
          )
        })}
        {visibleSpaces.length === 0 && filterText && (
          <p className="px-5 py-1 text-xs text-fg-muted">No matching spaces</p>
        )}
        {canCreateSpaceFlag && (
          <button
            onClick={() => setCreateKind('space')}
            className="mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg-secondary"
          >
            <Plus size={14} /> New Space
          </button>
        )}
      </Section>
    ),
  }

  return (
    <aside className="group/sidebar flex h-full min-h-0 w-full min-w-0 flex-col border-r border-ink-700 bg-ink-850">
      {/* Scrollable body — Customize stays pinned in a sibling footer below */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      {/* ---- Header: Home · search · filter · collapse (on hover) ---- */}
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <button
          onClick={() => navigate('/app/dashboard')}
          className="rounded-lg px-2 py-1 text-lg font-bold text-fg transition-colors hover:bg-ink-750 hover:text-fg"
        >
          Home
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          title="Search (Ctrl K)"
          className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <Search size={15} />
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
          <ListFilter size={15} />
        </button>
        <span className="flex-1" />
        <CreateMenu
          canCreateProject={canCreateProjectFlag}
          canCreateSpace={canCreateSpaceFlag}
          canCreateSprint={canCreateSprintFlag}
          canCreateWorkspace={canCreateWorkspaceFlag}
          canCreateChannel={canCreateChannelFlag}
          canCreateInvite={canCreateInviteFlag}
          onPick={(kind) => {
            if (kind === 'task' || kind === 'project' || kind === 'space') setCreateKind(kind)
            else if (kind === 'channel') navigate(CHAT_CREATE_PATH)
            else if (kind === 'sprint') navigate('/app/sprints?new=1')
            else if (kind === 'workspace') navigate('/app/workspaces?new=1')
            else if (kind === 'invite') openInvite()
          }}
        />
        <SidebarCollapseButton />
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

      {/* ---- Sections (Home shortcuts respect Customize → Home toggles) ---- */}
      {visibleSections.map((section) => (
        <div key={section.id} className="contents">
          {section.isCustom ? (
            <CustomSection title={section.title} />
          ) : (
            sectionNodes[section.id] ?? null
          )}
        </div>
      ))}
      </div>

      {/* ---- Footer: Customize Sidebar — pinned outside the scroller ---- */}
      <div className="shrink-0 border-t border-ink-700 bg-ink-850 px-2 pb-2 pt-2">
        <button
          onClick={() => openCustomize('navigation')}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-fg-secondary transition-colors hover:bg-ink-750 hover:text-fg"
        >
          <SlidersHorizontal size={15} /> Customize Sidebar
        </button>
      </div>

      <CustomizeSidebarModal
        open={customizeSidebarOpen}
        onClose={() => setCustomizeSidebarOpen(false)}
        initialTab={customizeTab}
      />

      <CreateModal
        kind={createKind}
        defaultProjectSpaceId={createProjectSpaceId}
        onClose={() => {
          setCreateKind(null)
          setCreateProjectSpaceId(null)
        }}
        org={org}
        workspace={workspace}
        workspaceId={workspace?.id}
        onCreatedProject={(id) => {
          void queryClient.invalidateQueries({ queryKey: ['projects', workspace?.id] })
          navigate(`/app/projects/${id}`)
        }}
        onCreatedSpace={() => {
          void queryClient.invalidateQueries({ queryKey: ['spaces', workspace?.id] })
        }}
      />

      <RenameModal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title={renameTarget?.kind === 'space' ? 'Rename space' : 'Rename project'}
        label={renameTarget?.kind === 'space' ? 'Space name' : 'Project name'}
        initialName={renameTarget?.name ?? ''}
        onSave={saveRename}
        saving={renaming}
      />

      {/* Delete confirmation */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.kind ?? ''}`}
        width="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Delete <span className="font-semibold text-fg">{deleteTarget?.name}</span>?
            {deleteTarget?.kind === 'space'
              ? ' All projects and tasks inside it will be removed.'
              : ' All tasks inside it will be removed.'}{' '}
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : `Delete ${deleteTarget?.kind ?? ''}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Sharing & Permissions */}
      {shareTarget?.kind === 'project' && (
        <ProjectMembersModal
          open
          onClose={() => setShareTarget(null)}
          projectId={shareTarget.id}
          workspaceId={workspace?.id}
          onInviteByEmail={() => {
            setShareTarget(null)
            openInvite()
          }}
        />
      )}
      {shareTarget?.kind === 'space' && (
        <SpaceMembersModal
          open
          onClose={() => setShareTarget(null)}
          spaceId={shareTarget.id}
          workspaceId={workspace?.id}
          canManage={(() => {
            const space = allSpaces.find((s) => s.id === shareTarget.id)
            return space ? canAdminSpace(space) : false
          })()}
        />
      )}

      {/* Project settings (opened from the project ⋯ menu) */}
      {projectSettings?.kind === 'fields' && (
        <CustomFieldsModal
          open
          onClose={() => setProjectSettings(null)}
          projectId={projectSettings.id}
          canManage={(() => {
            const project = allProjects.find((p) => p.id === projectSettings.id)
            return project ? canAdminProject(project) : false
          })()}
        />
      )}
      {projectSettings?.kind === 'statuses' && (
        <StatusEditorModal
          open
          onClose={() => setProjectSettings(null)}
          projectId={projectSettings.id}
          canManage={(() => {
            const project = allProjects.find((p) => p.id === projectSettings.id)
            return project ? canAdminProject(project) : false
          })()}
        />
      )}
      {projectSettings?.kind === 'sheets' && (
        <SheetsSyncModal
          open
          onClose={() => setProjectSettings(null)}
          projectId={projectSettings.id}
          canManage={(() => {
            const project = allProjects.find((p) => p.id === projectSettings.id)
            return project ? canAdminProject(project) : false
          })()}
        />
      )}

      {/* Templates (opened from the Templates submenu) */}
      {templateCenter && (
        <TemplateCenterModal
          open
          onClose={() => setTemplateCenter(null)}
          mode={templateCenter.mode}
          kind={templateCenter.kind}
          workspaceId={workspace?.id}
          source={templateCenter.source}
          spaces={allSpaces.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
          defaultSpaceId={templateCenter.defaultSpaceId}
          onDone={(result) => {
            void refetchSpaces()
            void refetchProjects()
            if (result?.project_id) navigate(`/app/projects/${result.project_id}`)
          }}
        />
      )}
      <SaveAsTemplateModal
        open={!!saveTemplateTarget}
        onClose={() => setSaveTemplateTarget(null)}
        kind={saveTemplateTarget?.kind ?? 'project'}
        source={saveTemplateTarget?.source ?? null}
      />
    </aside>
  )
}

/** Spaces section header controls: ⋯ (Create Space, Show archived toggle) + quick "+". */
function SpacesSectionControls({
  canManage,
  showArchived,
  onToggleArchived,
  onCreateSpace,
}: {
  canManage: boolean
  showArchived: boolean
  onToggleArchived: () => void
  onCreateSpace: () => void
}) {
  const menu = useRowMenu(() => {
    const items: MenuItem[] = []
    if (canManage) {
      items.push({ type: 'action', label: 'Create Space', icon: <Plus size={14} />, onClick: onCreateSpace })
      items.push({ type: 'separator' })
    }
    items.push({
      type: 'toggle',
      label: 'Show archived',
      icon: <Archive size={14} />,
      checked: showArchived,
      onToggle: onToggleArchived,
    })
    return items
  })
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={menu.onTriggerClick}
        className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/section:opacity-100 aria-expanded:opacity-100"
        title="Spaces settings"
      >
        <MoreHorizontal size={14} />
      </button>
      {canManage && (
        <button
          onClick={onCreateSpace}
          className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/section:opacity-100"
          title="New space"
        >
          <Plus size={13} />
        </button>
      )}
      {menu.node}
    </div>
  )
}

/* ---------------- Create menu (the white "+ Create" button) ---------------- */

type CreateKind = 'task' | 'project' | 'channel' | 'space' | 'sprint' | 'workspace' | 'invite'

function CreateMenu({
  canCreateProject: canCreateProjectOption,
  canCreateSpace: canCreateSpaceOption,
  canCreateSprint: canCreateSprintOption,
  canCreateWorkspace: canCreateWorkspaceOption,
  canCreateChannel: canCreateChannelOption,
  canCreateInvite: canCreateInviteOption,
  onPick,
}: {
  canCreateProject: boolean
  canCreateSpace: boolean
  canCreateSprint: boolean
  canCreateWorkspace: boolean
  canCreateChannel: boolean
  canCreateInvite: boolean
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
          {canCreateProjectOption && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="project"
              icon={<FolderKanban size={15} className="text-brand" />}
              label="Project"
              description="Track tasks, lists & sprints"
            />
          )}
          {canCreateChannelOption && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="channel"
              icon={<Hash size={15} className="text-emerald-400" />}
              label="Channel"
              description="Conversations on specific topics"
            />
          )}
          {canCreateSpaceOption && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="space"
              icon={<LayoutGrid size={15} className="text-blue-400" />}
              label="Space"
              description="Organize work by team or department"
            />
          )}
          {canCreateSprintOption && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="sprint"
              icon={<Zap size={15} className="text-amber-400" />}
              label="Sprint"
              description="Plan your next iteration"
            />
          )}
          {(canCreateWorkspaceOption ||
            canCreateProjectOption ||
            canCreateSpaceOption ||
            canCreateSprintOption ||
            canCreateInviteOption) && <div className="my-1 h-px bg-ink-700" />}
          {canCreateWorkspaceOption && (
            <CreateItem
              close={close}
              onPick={onPick}
              kind="workspace"
              icon={<Briefcase size={15} className="text-pink-400" />}
              label="Workspace"
            />
          )}
          {canCreateInviteOption && (
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
  defaultProjectSpaceId,
  onClose,
  org,
  workspace,
  workspaceId,
  onCreatedProject,
  onCreatedSpace,
}: {
  kind: null | 'task' | 'project' | 'space'
  defaultProjectSpaceId?: string | null
  onClose: () => void
  org: ReturnType<typeof useCurrentContext>['org']
  workspace: ReturnType<typeof useCurrentContext>['workspace']
  workspaceId: string | undefined
  onCreatedProject: (id: string) => void
  onCreatedSpace: () => void
}) {
  const spaces = useSpaces(workspaceId)
  const projects = useProjects(workspaceId)
  const creatableSpaceList = creatableSpaces(org, workspace, spaces.data ?? [])
  const canCreateSpaceFlag = canCreateSpace(org, workspace)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [busy, setBusy] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [projName, setProjName] = useState('')
  const [projSpaceId, setProjSpaceId] = useState('')
  const [newSpaceName, setNewSpaceName] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskProjectId, setTaskProjectId] = useState('')

  const resetSpaceForm = useCallback(() => {
    setSpaceName('')
  }, [])

  const resetProjectForm = useCallback(() => {
    setProjName('')
    setProjSpaceId('')
    setNewSpaceName('')
  }, [])

  const resetTaskForm = useCallback(() => {
    setTaskTitle('')
    setTaskProjectId('')
  }, [])

  useResetFormWhenOpen(kind === 'space', resetSpaceForm)
  useResetFormWhenOpen(kind === 'project', resetProjectForm)
  useResetFormWhenOpen(kind === 'task', resetTaskForm)

  // Prefill the destination space when "Create project" is launched from a space row.
  useEffect(() => {
    if (kind === 'project' && defaultProjectSpaceId) setProjSpaceId(defaultProjectSpaceId)
  }, [kind, defaultProjectSpaceId])

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
    if (!projName.trim()) return
    let spaceId = projSpaceId || creatableSpaceList[0]?.id
    if (!spaceId && !(canCreateSpaceFlag && workspaceId && newSpaceName.trim())) return
    setBusy(true)
    try {
      if (!spaceId && canCreateSpaceFlag && workspaceId && newSpaceName.trim()) {
        const space = await api.post<{ id: string }>(`/workspaces/${workspaceId}/spaces`, {
          name: newSpaceName.trim(),
        })
        spaceId = space.id
        setNewSpaceName('')
        onCreatedSpace()
      }
      const project = await api.post<{ id: string }>(`/spaces/${spaceId}/projects`, {
        name: projName.trim(),
      })
      toast.success('Project created')
      setProjName('')
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
          {(projects.data ?? []).length === 0 ? (
            <p className="text-xs text-fg-muted">You don't have access to any projects yet.</p>
          ) : (
            <>
              <select
                className="input-dark"
                value={taskProjectId || projects.data?.[0]?.id || ''}
                onChange={(e) => setTaskProjectId(e.target.value)}
              >
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
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
          <button className="btn-primary w-full" disabled={busy || !spaceName.trim() || !canCreateSpaceFlag} onClick={createSpace}>
            Create Space
          </button>
        </div>
      </Modal>

      {/* Project */}
      <Modal open={kind === 'project'} onClose={onClose} title="Create Project" width="max-w-md">
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Space</label>
            {spaces.isPending ? (
              <p className="text-xs text-fg-muted">Loading spaces…</p>
            ) : creatableSpaceList.length === 0 ? (
              canCreateSpaceFlag ? (
              <input
                className="input-dark"
                placeholder="New space name (e.g. Engineering)"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
              />
              ) : (
                <p className="text-xs text-fg-muted">No spaces you can add projects to.</p>
              )
            ) : (
              <select
                className="input-dark"
                value={projSpaceId || creatableSpaceList[0]?.id || ''}
                onChange={(e) => setProjSpaceId(e.target.value)}
              >
                {creatableSpaceList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {!spaces.isPending && creatableSpaceList.length === 0 && canCreateSpaceFlag && (
              <p className="mt-1 text-[11px] text-fg-muted">
                No spaces yet — one will be created along with your project.
              </p>
            )}
          </div>
          <input
            className="input-dark"
            placeholder="Project name"
            value={projName}
            onChange={(e) => setProjName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && projName.trim() && !busy) createProject() }}
            autoFocus
          />
          <button
            className="btn-primary w-full"
            disabled={
              busy ||
              !projName.trim() ||
              spaces.isPending ||
              (!creatableSpaceList.length &&
                !(canCreateSpaceFlag && newSpaceName.trim()))
            }
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

function MyTasksNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const summary = useMyTasksSummary()
  const { myTasksExpanded, setMyTasksExpanded, toggleMyTasksExpanded } = useUIStore()
  const inMyTasks = location.pathname.startsWith('/app/my-tasks')

  useEffect(() => {
    if (inMyTasks) setMyTasksExpanded(true)
  }, [inMyTasks, setMyTasksExpanded])

  const badge = summary.data?.today_and_overdue ?? 0
  const initial =
    user?.profile?.full_name?.trim()?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="mx-2">
      <div
        className={cn(
          'group/mytasks flex items-center gap-0.5 rounded-lg transition-colors',
          inMyTasks ? 'bg-brand-soft' : 'hover:bg-ink-750',
        )}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleMyTasksExpanded()
          }}
          className={cn(
            'max-w-0 shrink-0 overflow-hidden rounded-lg p-0 text-fg-muted opacity-0 transition-all',
            'group-hover/mytasks:max-w-8 group-hover/mytasks:p-2 group-hover/mytasks:opacity-100',
            'focus-visible:max-w-8 focus-visible:p-2 focus-visible:opacity-100',
            'hover:text-fg',
          )}
          aria-label={myTasksExpanded ? 'Collapse My Tasks' : 'Expand My Tasks'}
        >
          <ChevronRight size={14} className={cn('transition-transform', myTasksExpanded && 'rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => navigate('/app/my-tasks')}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm',
            inMyTasks ? 'text-fg' : 'text-fg-secondary hover:text-fg',
          )}
        >
          <SquareCheck size={15} className="shrink-0" />
          <span className="flex-1 truncate">My Tasks</span>
          {badge > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-fg-muted">
              <Clock size={12} />
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </button>
      </div>

      {myTasksExpanded && (
        <div className="relative ml-5 border-l border-ink-700 pl-2 pt-0.5">
          <MyTasksSubLink
            to="/app/my-tasks/assigned"
            icon={
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-[10px] font-bold text-fg">
                {initial}
              </span>
            }
            label="Assigned to me"
          />
          <MyTasksSubLink
            to="/app/my-tasks/today-overdue"
            icon={<CalendarClock size={15} />}
            label="Today & Overdue"
            trailing={
              badge > 0 ? (
                <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                  <Clock size={12} />
                  {badge}
                </span>
              ) : undefined
            }
          />
          <MyTasksSubLink to="/app/my-tasks/personal" icon={<List size={15} />} label="Personal List" />
        </div>
      )}
    </div>
  )
}

function MyTasksSubLink({
  to,
  icon,
  label,
  trailing,
}: {
  to: string
  icon: React.ReactNode
  label: string
  trailing?: React.ReactNode
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'mb-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors',
          isActive ? 'bg-brand-soft text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </NavLink>
  )
}

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

/** Placeholder body for a user-created section. Items support arrives with the
 * backend; until then a custom section renders as an empty, titled group. */
function CustomSection({ title }: { title: string }) {
  return (
    <Section title={title}>
      <p className="px-5 py-1 text-xs text-fg-muted">No items yet</p>
    </Section>
  )
}

/** A hover-revealed `⋯` context-menu trigger, matching ClickUp's row affordance. */
function RowMenuButton({ onClick, className }: { onClick: (e: React.MouseEvent) => void; className?: string }) {
  return (
    <button
      type="button"
      title="Show menu"
      aria-label="Show menu"
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/name:opacity-100 aria-expanded:opacity-100',
        className,
      )}
    >
      <MoreHorizontal size={14} />
    </button>
  )
}

function SpaceRow({
  space,
  menuItems,
  canCreateProject,
  onCreateProject,
  children,
}: {
  space: Space
  menuItems: MenuItem[]
  canCreateProject: boolean
  onCreateProject: () => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  const menu = useRowMenu(menuItems)
  const hasMenu = menuItems.length > 0
  return (
    <div>
      <div
        className="group/name mx-2 flex w-[calc(100%-16px)] items-center gap-0.5"
        onContextMenu={hasMenu ? menu.onContextMenu : undefined}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-ink-750"
        >
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
            style={{ backgroundColor: space.color }}
          >
            {space.icon ? <EntityIcon icon={space.icon} size={12} /> : space.name[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>
          {open ? (
            <ChevronDown size={13} className="shrink-0 text-fg-muted" />
          ) : (
            <ChevronRight size={13} className="shrink-0 text-fg-muted" />
          )}
        </button>
        {hasMenu && <RowMenuButton onClick={menu.onTriggerClick} />}
        {canCreateProject && (
          <button
            type="button"
            title="Create project"
            aria-label="Create project"
            onClick={onCreateProject}
            className="mr-1 inline-flex shrink-0 items-center justify-center rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:bg-ink-750 hover:text-fg group-hover/name:opacity-100"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      {open && children}
      {menu.node}
    </div>
  )
}

function ProjectRow({ project, menuItems }: { project: Project; menuItems: MenuItem[] }) {
  const menu = useRowMenu(menuItems)
  const hasMenu = menuItems.length > 0
  return (
    <div
      className={cn('group/name mx-2 flex items-center gap-0.5 pr-2', project.is_archived && 'opacity-60')}
      onContextMenu={hasMenu ? menu.onContextMenu : undefined}
    >
      <NavLink
        to={`/app/projects/${project.id}`}
        className={({ isActive }) =>
          cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-9 pr-2 text-sm transition-colors',
            isActive ? 'bg-brand-soft font-medium text-fg' : 'text-fg-secondary hover:bg-ink-750 hover:text-fg',
          )
        }
      >
        {project.icon ? (
          <EntityIcon icon={project.icon} size={14} className="shrink-0" style={{ color: project.color }} />
        ) : (
          <FolderKanban size={14} className="shrink-0" style={{ color: project.color }} />
        )}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {project.is_archived && <Archive size={11} className="shrink-0 text-fg-muted" />}
        {project.task_count != null && project.task_count > 0 && (
          <span className="shrink-0 text-[10px] text-fg-muted">{project.task_count}</span>
        )}
      </NavLink>
      {hasMenu && <RowMenuButton onClick={menu.onTriggerClick} />}
      {menu.node}
    </div>
  )
}
