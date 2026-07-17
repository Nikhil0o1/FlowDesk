import { useQueryClient } from '@tanstack/react-query'
import { FolderKanban, Layers } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { api, errorMessage } from '../../lib/api'
import { useProjects, useSpaces, useWorkspaceMemberCandidates } from '../../lib/queries'
import { formatScopedRole } from '../../lib/roleLabels'
import type { Project, Space, WorkspaceMemberCandidate } from '../../lib/types'
import { cn } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Modal } from '../ui/Modal'

type AssignKind = 'space' | 'project'
type ProjectRole = 'admin' | 'member' | 'viewer'

function toggleSelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}

async function runMany(
  requests: { method: 'post' | 'delete'; path: string; body?: Record<string, unknown> }[],
): Promise<{ ok: number; failed: number; firstError: string | null }> {
  const results = await Promise.allSettled(
    requests.map((req) =>
      req.method === 'post' ? api.post(req.path, req.body!) : api.delete(req.path),
    ),
  )
  let ok = 0
  let failed = 0
  let firstError: string | null = null
  for (const result of results) {
    if (result.status === 'fulfilled') {
      ok += 1
    } else {
      failed += 1
      if (!firstError) firstError = errorMessage(result.reason)
    }
  }
  return { ok, failed, firstError }
}

export function AssignExistingPersonModal({
  open,
  onClose,
  candidate,
  workspaceId,
  orgId,
  onAssigned,
  assignScope = 'workspace',
  scopeSpaceId,
  scopeProjectIds,
}: {
  open: boolean
  onClose: () => void
  candidate: WorkspaceMemberCandidate | null
  workspaceId: string
  orgId: string
  onAssigned?: () => void
  assignScope?: 'workspace' | 'space' | 'project'
  scopeSpaceId?: string
  scopeProjectIds?: string[]
}) {
  const queryClient = useQueryClient()
  const spaces = useSpaces(open ? workspaceId : undefined)
  const projects = useProjects(open ? workspaceId : undefined)
  const candidatesQuery = useWorkspaceMemberCandidates(open ? workspaceId : undefined, open)

  const liveCandidate = useMemo(() => {
    if (!candidate) return null
    return candidatesQuery.data?.find((row) => row.user_id === candidate.user_id) ?? candidate
  }, [candidate, candidatesQuery.data])

  const [kind, setKind] = useState<AssignKind>(
    assignScope === 'project' || assignScope === 'space' ? 'project' : 'space',
  )
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([])
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([])
  const [removeSpaceIds, setRemoveSpaceIds] = useState<string[]>([])
  const [removeProjectIds, setRemoveProjectIds] = useState<string[]>([])
  const [projectRole, setProjectRole] = useState<ProjectRole>('member')
  const [busy, setBusy] = useState(false)

  const spaceList = spaces.data ?? []
  const assignedSpaces = (liveCandidate?.spaces ?? []).filter(
    (space) => assignScope !== 'space' || space.space_id === scopeSpaceId,
  )
  const assignedProjects = (liveCandidate?.projects ?? []).filter((project) => {
    if (assignScope === 'space' && scopeSpaceId) return project.space_id === scopeSpaceId
    if (assignScope === 'project' && scopeProjectIds?.length) {
      return scopeProjectIds.includes(project.project_id)
    }
    return true
  })
  const assignedSpaceIds = useMemo(
    () => new Set(assignedSpaces.map((s) => s.space_id)),
    [assignedSpaces],
  )
  const assignedProjectIds = useMemo(
    () => new Set(assignedProjects.map((p) => p.project_id)),
    [assignedProjects],
  )
  const availableSpaces = useMemo(() => {
    const list = spaceList.filter((space) => !assignedSpaceIds.has(space.id))
    if (assignScope === 'space' && scopeSpaceId) {
      return list.filter((space) => space.id === scopeSpaceId)
    }
    return list
  }, [assignedSpaceIds, spaceList, assignScope, scopeSpaceId])
  const availableProjects = useMemo(() => {
    let list = (projects.data ?? []).filter(
      (project) => !project.is_archived && !assignedProjectIds.has(project.id),
    )
    if (assignScope === 'space' && scopeSpaceId) {
      list = list.filter((project) => project.space_id === scopeSpaceId)
    }
    if (assignScope === 'project' && scopeProjectIds?.length) {
      list = list.filter((project) => scopeProjectIds.includes(project.id))
    }
    return list
  }, [assignedProjectIds, projects.data, assignScope, scopeProjectIds, scopeSpaceId])
  const spaceNameById = useMemo(
    () => new Map(spaceList.map((space) => [space.id, space.name])),
    [spaceList],
  )
  const projectsBySpace = useMemo(() => {
    const groups = new Map<string, Project[]>()
    for (const project of availableProjects) {
      if (project.space_id == null) continue
      const list = groups.get(project.space_id) ?? []
      list.push(project)
      groups.set(project.space_id, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
    return [...groups.entries()].sort(([a], [b]) =>
      (spaceNameById.get(a) ?? '').localeCompare(spaceNameById.get(b) ?? ''),
    )
  }, [availableProjects, spaceNameById])
  const assignedProjectsBySpace = useMemo(() => {
    const groups = new Map<string, typeof assignedProjects>()
    for (const project of assignedProjects) {
      const list = groups.get(project.space_id) ?? []
      list.push(project)
      groups.set(project.space_id, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.project_name.localeCompare(b.project_name))
    }
    return [...groups.entries()].sort(([a], [b]) =>
      (spaceNameById.get(a) ?? '').localeCompare(spaceNameById.get(b) ?? ''),
    )
  }, [assignedProjects, spaceNameById])

  useEffect(() => {
    if (!open) return
    setKind(assignScope === 'project' || assignScope === 'space' ? 'project' : 'space')
    setSelectedSpaceIds([])
    setSelectedProjectIds([])
    setRemoveSpaceIds([])
    setRemoveProjectIds([])
    setProjectRole('member')
  }, [open, candidate?.user_id])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['organization-members', orgId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace-member-candidates', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['spaces', workspaceId] })
    void queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] })
    onAssigned?.()
  }

  const submitAdd = async () => {
    if (!liveCandidate) return
    if (kind === 'space' && selectedSpaceIds.length === 0) {
      toast.error('Select at least one space to add')
      return
    }
    if (kind === 'project' && selectedProjectIds.length === 0) {
      toast.error('Select at least one project to add')
      return
    }

    setBusy(true)
    try {
      if (kind === 'space') {
        const { ok, failed, firstError } = await runMany(
          selectedSpaceIds.map((spaceId) => ({
            method: 'post' as const,
            path: `/spaces/${spaceId}/members`,
            body: {
              user_id: liveCandidate.user_id,
              role: assignScope === 'space' ? 'member' : 'admin',
            },
          })),
        )
        if (ok === 0) {
          toast.error(firstError ?? 'Could not add to any space')
          return
        }
        if (failed === 0) {
          toast.success(
            ok === 1
              ? assignScope === 'space'
                ? 'Added to space'
                : 'Added as space admin'
              : assignScope === 'space'
                ? `Added to ${ok} spaces`
                : `Added as space admin in ${ok} spaces`,
          )
        } else {
          toast.success(`Added to ${ok} space${ok === 1 ? '' : 's'}. ${failed} could not be added.`)
        }
        setSelectedSpaceIds([])
      } else {
        const { ok, failed, firstError } = await runMany(
          selectedProjectIds.map((projectId) => ({
            method: 'post' as const,
            path: `/projects/${projectId}/members`,
            body: { user_id: liveCandidate.user_id, role: projectRole },
          })),
        )
        if (ok === 0) {
          toast.error(firstError ?? 'Could not add to any project')
          return
        }
        const roleLabel =
          projectRole === 'admin'
            ? 'project admin'
            : projectRole === 'viewer'
              ? 'project viewer'
              : 'project member'
        if (failed === 0) {
          toast.success(
            ok === 1 ? `Added as ${roleLabel}` : `Added as ${roleLabel} in ${ok} projects`,
          )
        } else {
          toast.success(`Added to ${ok} project${ok === 1 ? '' : 's'}. ${failed} could not be added.`)
        }
        setSelectedProjectIds([])
      }
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submitRemove = async () => {
    if (!liveCandidate) return
    if (kind === 'space' && removeSpaceIds.length === 0) {
      toast.error('Select at least one space to remove')
      return
    }
    if (kind === 'project' && removeProjectIds.length === 0) {
      toast.error('Select at least one project to remove')
      return
    }

    setBusy(true)
    try {
      if (kind === 'space') {
        const { ok, failed, firstError } = await runMany(
          removeSpaceIds.map((spaceId) => ({
            method: 'delete' as const,
            path: `/spaces/${spaceId}/members/${liveCandidate.user_id}`,
          })),
        )
        if (ok === 0) {
          toast.error(firstError ?? 'Could not remove from any space')
          return
        }
        if (failed === 0) {
          toast.success(
            ok === 1 ? 'Removed from space' : `Removed from ${ok} spaces`,
          )
        } else {
          toast.success(
            `Removed from ${ok} space${ok === 1 ? '' : 's'}. ${failed} could not be removed.`,
          )
        }
        setRemoveSpaceIds([])
      } else {
        const { ok, failed, firstError } = await runMany(
          removeProjectIds.map((projectId) => ({
            method: 'delete' as const,
            path: `/projects/${projectId}/members/${liveCandidate.user_id}`,
          })),
        )
        if (ok === 0) {
          toast.error(firstError ?? 'Could not remove from any project')
          return
        }
        if (failed === 0) {
          toast.success(
            ok === 1 ? 'Removed from project' : `Removed from ${ok} projects`,
          )
        } else {
          toast.success(
            `Removed from ${ok} project${ok === 1 ? '' : 's'}. ${failed} could not be removed.`,
          )
        }
        setRemoveProjectIds([])
      }
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!liveCandidate) return null

  const name = liveCandidate.user?.full_name || liveCandidate.user?.email || 'Unknown'
  const addLabel = busy
    ? 'Saving…'
    : kind === 'space'
      ? selectedSpaceIds.length <= 1
        ? 'Add as space admin'
        : `Add to ${selectedSpaceIds.length} spaces`
      : selectedProjectIds.length <= 1
        ? 'Add to project'
        : `Add to ${selectedProjectIds.length} projects`
  const removeLabel = busy
    ? 'Saving…'
    : kind === 'space'
      ? removeSpaceIds.length <= 1
        ? 'Remove from space'
        : `Remove from ${removeSpaceIds.length} spaces`
      : removeProjectIds.length <= 1
        ? 'Remove from project'
        : `Remove from ${removeProjectIds.length} projects`

  return (
    <Modal open={open} onClose={onClose} title="Manage access" width="max-w-lg">
      <div className="mb-3 flex items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/50 px-3 py-2">
        <Avatar
          name={name}
          src={liveCandidate.user?.avatar_url}
          color={liveCandidate.user?.avatar_color}
          size={32}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{name}</p>
          {liveCandidate.user?.email && (
            <p className="truncate text-xs text-fg-muted">{liveCandidate.user.email}</p>
          )}
        </div>
      </div>

      <p className="mb-3 text-xs text-fg-secondary">
        {assignScope === 'space'
          ? 'Grant or revoke project access for this person in your space.'
          : assignScope === 'project'
            ? 'Grant or revoke access for this person on your projects.'
            : 'Grant or revoke space and project access for this person in your workspace.'}
      </p>

      {assignScope === 'workspace' && (
      <div className="mb-3 flex gap-2">
        <KindButton active={kind === 'space'} onClick={() => setKind('space')} icon={Layers}>
          Space
        </KindButton>
        <KindButton active={kind === 'project'} onClick={() => setKind('project')} icon={FolderKanban}>
          Project
        </KindButton>
      </div>
      )}

      {kind === 'space' ? (
        <div className="space-y-3">
          {assignedSpaces.length > 0 && (
            <AccessSection
              title="Current space access"
              hint={
              assignScope === 'space'
                ? 'Select projects in this space to remove this person from.'
                : 'Select spaces to remove this person from.'
            }
            >
              <MultiSelectHeader
                label="Assigned"
                selectedCount={removeSpaceIds.length}
                totalCount={assignedSpaces.length}
                onSelectAll={() => setRemoveSpaceIds(assignedSpaces.map((space) => space.space_id))}
                onClear={() => setRemoveSpaceIds([])}
              />
              <MultiSelectList isEmpty={false} isLoading={false}>
                {assignedSpaces.map((space) => (
                  <MultiSelectRow
                    key={space.space_id}
                    id={`remove-space-${space.space_id}`}
                    checked={removeSpaceIds.includes(space.space_id)}
                    onChange={() =>
                      setRemoveSpaceIds((current) => toggleSelection(current, space.space_id))
                    }
                    label={space.space_name}
                    detail={formatScopedRole('space', space.role)}
                    leading={
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-cyan-400"
                        aria-hidden
                      />
                    }
                  />
                ))}
              </MultiSelectList>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={busy || removeSpaceIds.length === 0}
                  onClick={() => void submitRemove()}
                >
                  {removeLabel}
                </button>
              </div>
            </AccessSection>
          )}

          <AccessSection
            title={assignScope === 'space' ? 'Add space membership' : 'Add space access'}
            hint={
              assignScope === 'space'
                ? 'Add this person to the space as a member.'
                : 'Select spaces where this person should become an admin.'
            }
          >
            <MultiSelectHeader
              label="Available"
              selectedCount={selectedSpaceIds.length}
              totalCount={availableSpaces.length}
              onSelectAll={() => setSelectedSpaceIds(availableSpaces.map((space) => space.id))}
              onClear={() => setSelectedSpaceIds([])}
            />
            <MultiSelectList
              emptyMessage={
                spaces.isLoading
                  ? 'Loading spaces…'
                  : spaceList.length === 0
                    ? 'No spaces in this workspace yet.'
                    : 'This person already has access to every space.'
              }
              isLoading={spaces.isLoading}
              isEmpty={availableSpaces.length === 0}
            >
              {availableSpaces.map((space) => (
                <MultiSelectRow
                  key={space.id}
                  id={`assign-space-${space.id}`}
                  checked={selectedSpaceIds.includes(space.id)}
                  onChange={() =>
                    setSelectedSpaceIds((current) => toggleSelection(current, space.id))
                  }
                  label={space.name}
                  leading={<SpaceDot space={space} />}
                />
              ))}
            </MultiSelectList>
            <p className="text-[11px] text-fg-muted">
              {assignScope === 'space'
                ? 'New assignments join the space as a member.'
                : 'New assignments are always space admin.'}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={busy || selectedSpaceIds.length === 0}
                onClick={() => void submitAdd()}
              >
                {addLabel}
              </button>
            </div>
          </AccessSection>
        </div>
      ) : (
        <div className="space-y-3">
          {assignedProjects.length > 0 && (
            <AccessSection
              title="Current project access"
              hint="Select projects to remove this person from."
            >
              <MultiSelectHeader
                label="Assigned"
                selectedCount={removeProjectIds.length}
                totalCount={assignedProjects.length}
                onSelectAll={() =>
                  setRemoveProjectIds(assignedProjects.map((project) => project.project_id))
                }
                onClear={() => setRemoveProjectIds([])}
              />
              <MultiSelectList isEmpty={false} isLoading={false}>
                {assignedProjectsBySpace.map(([spaceId, spaceProjects]) => (
                  <div key={spaceId}>
                    <p className="sticky top-0 z-10 bg-ink-850 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                      {spaceNameById.get(spaceId) ?? 'Space'}
                    </p>
                    {spaceProjects.map((project) => (
                      <MultiSelectRow
                        key={project.project_id}
                        id={`remove-project-${project.project_id}`}
                        checked={removeProjectIds.includes(project.project_id)}
                        onChange={() =>
                          setRemoveProjectIds((current) =>
                            toggleSelection(current, project.project_id),
                          )
                        }
                        label={project.project_name}
                        detail={formatScopedRole('project', project.role)}
                        leading={
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                            aria-hidden
                          />
                        }
                      />
                    ))}
                  </div>
                ))}
              </MultiSelectList>
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={busy || removeProjectIds.length === 0}
                  onClick={() => void submitRemove()}
                >
                  {removeLabel}
                </button>
              </div>
            </AccessSection>
          )}

          <AccessSection
            title="Add project access"
            hint="Select projects and choose a role for new assignments."
          >
            <MultiSelectHeader
              label="Available"
              selectedCount={selectedProjectIds.length}
              totalCount={availableProjects.length}
              onSelectAll={() =>
                setSelectedProjectIds(availableProjects.map((project) => project.id))
              }
              onClear={() => setSelectedProjectIds([])}
            />
            <MultiSelectList
              emptyMessage={
                projects.isLoading
                  ? 'Loading projects…'
                  : (projects.data ?? []).filter((p) => !p.is_archived).length === 0
                    ? 'No projects in this workspace yet.'
                    : 'This person is already on every project.'
              }
              isLoading={projects.isLoading}
              isEmpty={availableProjects.length === 0}
            >
              {projectsBySpace.map(([spaceId, spaceProjects]) => (
                <div key={spaceId}>
                  <p className="sticky top-0 z-10 bg-ink-850 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                    {spaceNameById.get(spaceId) ?? 'Space'}
                  </p>
                  {spaceProjects.map((project) => (
                    <MultiSelectRow
                      key={project.id}
                      id={`assign-project-${project.id}`}
                      checked={selectedProjectIds.includes(project.id)}
                      onChange={() =>
                        setSelectedProjectIds((current) => toggleSelection(current, project.id))
                      }
                      label={project.name}
                      leading={<ProjectDot project={project} />}
                    />
                  ))}
                </div>
              ))}
            </MultiSelectList>
            <div>
              <label
                htmlFor="assign-project-role-select"
                className="mb-1.5 block text-xs font-medium text-fg-secondary"
              >
                Role for new assignments
              </label>
              <select
                id="assign-project-role-select"
                className="input-dark w-full"
                value={projectRole}
                onChange={(e) => setProjectRole(e.target.value as ProjectRole)}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={busy || selectedProjectIds.length === 0}
                onClick={() => void submitAdd()}
              >
                {addLabel}
              </button>
            </div>
          </AccessSection>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button className="btn-secondary" onClick={onClose} disabled={busy}>
          Close
        </button>
      </div>
    </Modal>
  )
}

function AccessSection({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2 rounded-xl border border-ink-700/80 bg-ink-900/30 p-2.5">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{title}</h3>
        {hint && <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function MultiSelectHeader({
  label,
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
}: {
  label: string
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onClear: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs font-medium text-fg-secondary">
        {label}
        {selectedCount > 0 && (
          <span className="ml-1.5 text-fg-muted">({selectedCount} selected)</span>
        )}
      </label>
      {totalCount > 0 && (
        <div className="flex gap-2 text-[11px]">
          <button
            type="button"
            className="text-brand hover:underline disabled:text-fg-muted disabled:no-underline"
            disabled={selectedCount === totalCount}
            onClick={onSelectAll}
          >
            Select all
          </button>
          <button
            type="button"
            className="text-fg-muted hover:text-fg hover:underline disabled:no-underline"
            disabled={selectedCount === 0}
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

function MultiSelectList({
  children,
  emptyMessage,
  isLoading,
  isEmpty,
}: {
  children: React.ReactNode
  emptyMessage?: string
  isLoading: boolean
  isEmpty: boolean
}) {
  if (isLoading || isEmpty) {
    return (
      <div className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-4">
        <p className="text-center text-xs text-fg-muted">{emptyMessage ?? 'Nothing here yet.'}</p>
      </div>
    )
  }

  return (
    <div className="max-h-36 overflow-y-auto rounded-xl border border-ink-700 bg-ink-800/40">
      <div className="divide-y divide-ink-700/60">{children}</div>
    </div>
  )
}

function MultiSelectRow({
  id,
  checked,
  onChange,
  label,
  detail,
  leading,
}: {
  id: string
  checked: boolean
  onChange: () => void
  label: string
  detail?: string
  leading?: React.ReactNode
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-ink-750/60',
        checked && 'bg-brand-soft/40',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 rounded border-ink-600 text-brand focus:ring-brand/40"
      />
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-fg">{label}</span>
        {detail && <span className="block truncate text-[11px] text-fg-muted">{detail}</span>}
      </span>
    </label>
  )
}

function SpaceDot({ space }: { space: Space }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: space.color }}
      aria-hidden
    />
  )
}

function ProjectDot({ project }: { project: Project }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: project.color }}
      aria-hidden
    />
  )
}

function KindButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Layers
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-brand bg-brand-soft text-fg'
          : 'border-ink-700 bg-ink-800 text-fg-secondary hover:bg-ink-750',
      )}
    >
      <Icon size={16} />
      {children}
    </button>
  )
}
