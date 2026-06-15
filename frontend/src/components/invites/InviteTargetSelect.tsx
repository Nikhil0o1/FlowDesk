import type { Project, Workspace } from '../../lib/types'
import { projectLabel, workspaceLabel, type InviteScope } from './inviteScopes'

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (id: string) => void
  options: { id: string; label: string }[]
  placeholder?: string
}) {
  if (options.length === 0) {
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
      <select className="input-dark" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function InviteTargetSelect({
  scope,
  workspaces,
  workspacesLoading,
  workspaceId,
  onWorkspaceChange,
  projects,
  projectsLoading,
  projectId,
  onProjectChange,
}: {
  scope: InviteScope
  workspaces: Workspace[]
  workspacesLoading: boolean
  workspaceId: string
  onWorkspaceChange: (id: string) => void
  projects: Project[]
  projectsLoading: boolean
  projectId: string
  onProjectChange: (id: string) => void
}) {
  if (scope === 'organization') return null

  const workspaceOptions = workspaces.map((ws) => ({ id: ws.id, label: workspaceLabel(ws) }))
  const projectOptions = projects.map((p) => ({ id: p.id, label: projectLabel(p) }))

  if (scope === 'workspace') {
    if (workspacesLoading) {
      return <p className="text-xs text-fg-muted">Loading workspaces…</p>
    }
    return (
      <FieldSelect
        label="Workspace"
        value={workspaceId}
        onChange={onWorkspaceChange}
        options={workspaceOptions}
        placeholder="You don't have permission to invite anyone to a workspace yet."
      />
    )
  }

  return (
    <div className="space-y-4">
      {workspacesLoading ? (
        <p className="text-xs text-fg-muted">Loading workspaces…</p>
      ) : (
        <FieldSelect
          label="Workspace"
          value={workspaceId}
          onChange={onWorkspaceChange}
          options={workspaceOptions}
          placeholder="You don't have permission to invite anyone to a workspace yet."
        />
      )}
      {workspaceId &&
        (projectsLoading ? (
          <p className="text-xs text-fg-muted">Loading projects…</p>
        ) : (
          <FieldSelect
            label="Project"
            value={projectId}
            onChange={onProjectChange}
            options={projectOptions}
            placeholder="No projects in this workspace yet. Create a project first, or invite to the workspace instead."
          />
        ))}
    </div>
  )
}
