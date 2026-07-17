import { useMemo } from 'react'

import { cn } from '../../lib/utils'
import type { Project, Space, Workspace } from '../../lib/types'
import { projectLabel, workspaceLabel } from './inviteScopes'

function toggleSelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

function SelectAllRow({
  label,
  checked,
  indeterminate,
  onChange,
}: {
  label: string
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-fg-secondary hover:bg-ink-750">
      <input
        type="checkbox"
        className="rounded border-ink-600"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
        checked ? 'bg-brand-soft/40 text-fg' : 'text-fg-secondary hover:bg-ink-750',
      )}
    >
      <input
        type="checkbox"
        className="rounded border-ink-600"
        checked={checked}
        onChange={onChange}
      />
      <span className="truncate">{label}</span>
    </label>
  )
}

export function InviteSpaceMultiSelect({
  label,
  spaces,
  selectedIds,
  onChange,
  placeholder,
}: {
  label: string
  spaces: Space[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
}) {
  const allIds = useMemo(() => spaces.map((s) => s.id), [spaces])
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
  const someSelected = selectedIds.length > 0 && !allSelected

  if (spaces.length === 0) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
        <p className="text-xs text-fg-muted">{placeholder ?? `No ${label.toLowerCase()} available.`}</p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800/50 p-1">
        <SelectAllRow
          label="Select all"
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(checked) => onChange(checked ? allIds : [])}
        />
        {spaces.map((space) => (
          <CheckboxRow
            key={space.id}
            label={space.name}
            checked={selectedIds.includes(space.id)}
            onChange={() => onChange(toggleSelection(selectedIds, space.id))}
          />
        ))}
      </div>
      {selectedIds.length > 0 && (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          {selectedIds.length} space{selectedIds.length === 1 ? '' : 's'} selected
        </p>
      )}
    </div>
  )
}

export function InviteProjectMultiSelect({
  label,
  spaces,
  projects,
  selectedIds,
  onChange,
  placeholder,
  onCreateProject,
  workspaceId,
}: {
  label: string
  spaces: Space[]
  projects: Project[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  onCreateProject?: (workspaceId: string) => void
  workspaceId?: string
}) {
  const spaceNameById = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces])
  const grouped = useMemo(() => {
    const groups = new Map<string, Project[]>()
    for (const project of projects) {
      const key = project.space_id ?? '__none__'
      const list = groups.get(key) ?? []
      list.push(project)
      groups.set(key, list)
    }
    return [...groups.entries()].sort(([a], [b]) => {
      const nameA = a === '__none__' ? '' : spaceNameById.get(a) ?? ''
      const nameB = b === '__none__' ? '' : spaceNameById.get(b) ?? ''
      return nameA.localeCompare(nameB)
    })
  }, [projects, spaceNameById])

  const allIds = useMemo(() => projects.map((p) => p.id), [projects])
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
  const someSelected = selectedIds.length > 0 && !allSelected

  if (projects.length === 0) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
        <div className="flex items-center gap-3">
          <p className="flex-1 text-xs text-fg-muted">{placeholder ?? `No ${label.toLowerCase()} available.`}</p>
          {onCreateProject && workspaceId && (
            <button
              type="button"
              onClick={() => onCreateProject(workspaceId)}
              className="shrink-0 rounded-md border border-brand px-3 py-1.5 text-xs font-medium text-brand hover:bg-brand-soft transition-colors"
            >
              + Create project
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
      <div className="max-h-56 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800/50 p-1">
        <SelectAllRow
          label="Select all projects"
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(checked) => onChange(checked ? allIds : [])}
        />
        {grouped.map(([spaceKey, spaceProjects]) => {
          const heading =
            spaceKey === '__none__'
              ? 'Other projects'
              : spaceNameById.get(spaceKey) ?? 'Space'
          return (
            <div key={spaceKey} className="mt-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {heading}
              </p>
              {spaceProjects.map((project) => (
                <CheckboxRow
                  key={project.id}
                  label={projectLabel(project)}
                  checked={selectedIds.includes(project.id)}
                  onChange={() => onChange(toggleSelection(selectedIds, project.id))}
                />
              ))}
            </div>
          )
        })}
      </div>
      {selectedIds.length > 0 && (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          {selectedIds.length} project{selectedIds.length === 1 ? '' : 's'} selected
        </p>
      )}
    </div>
  )
}

export function InviteWorkspaceMultiSelect({
  label,
  workspaces,
  selectedIds,
  onChange,
  placeholder,
}: {
  label: string
  workspaces: Workspace[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
}) {
  const allIds = useMemo(() => workspaces.map((ws) => ws.id), [workspaces])
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id))
  const someSelected = selectedIds.length > 0 && !allSelected

  if (workspaces.length === 0) {
    return (
      <div>
        <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
        <p className="text-xs text-fg-muted">{placeholder ?? `No ${label.toLowerCase()} available.`}</p>
      </div>
    )
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-fg-secondary">{label}</label>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-ink-700 bg-ink-800/50 p-1">
        <SelectAllRow
          label="Select all"
          checked={allSelected}
          indeterminate={someSelected}
          onChange={(checked) => onChange(checked ? allIds : [])}
        />
        {workspaces.map((workspace) => (
          <CheckboxRow
            key={workspace.id}
            label={workspaceLabel(workspace)}
            checked={selectedIds.includes(workspace.id)}
            onChange={() => onChange(toggleSelection(selectedIds, workspace.id))}
          />
        ))}
      </div>
      {selectedIds.length > 0 && (
        <p className="mt-1.5 text-[11px] text-fg-muted">
          {selectedIds.length} workspace{selectedIds.length === 1 ? '' : 's'} selected
        </p>
      )}
    </div>
  )
}
